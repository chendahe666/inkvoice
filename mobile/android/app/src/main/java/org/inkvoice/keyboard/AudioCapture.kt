package org.inkvoice.keyboard

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicBoolean

/** Owns its AudioRecord until its capture thread finishes. No audio is written to storage. */
class AudioCapture(private val context: Context) {
    private val running = AtomicBoolean(false)
    private val discard = AtomicBoolean(false)
    private val lifecycleLock = Any()
    @Volatile private var recorder: AudioRecord? = null
    private var thread: Thread? = null

    @SuppressLint("MissingPermission")
    fun start(onLevel: (Double, Double) -> Unit, onFinished: (ShortArray) -> Unit, onError: (String) -> Unit) {
        check(thread == null) { "录音已经开始。" }
        check(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            "请先打开墨声设置允许麦克风。"
        }
        running.set(true); discard.set(false)
        thread = Thread({
            var local: AudioRecord? = null
            var completed: ShortArray? = null
            var failure: String? = null
            try {
                val minimum = AudioRecord.getMinBufferSize(PcmAudio.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                check(minimum > 0) { "设备不支持 16 kHz 单声道录音。" }
                val device = AudioRecord.Builder()
                    .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(PcmAudio.SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
                    .setBufferSizeInBytes(maxOf(minimum * 2, 8192)).build()
                local = device
                check(device.state == AudioRecord.STATE_INITIALIZED) { "麦克风初始化失败。" }
                synchronized(lifecycleLock) {
                    if (running.get()) { recorder = device; device.startRecording() }
                }
                val chunks = ArrayList<ShortArray>()
                var total = 0
                var lastLevel = 0L
                val buffer = ShortArray(2048)
                while (running.get() && total < PcmAudio.MAX_SAMPLES) {
                    val count = device.read(buffer, 0, minOf(buffer.size, PcmAudio.MAX_SAMPLES - total), AudioRecord.READ_BLOCKING)
                    if (count < 0) { if (running.get()) error("麦克风读取失败（$count）。"); break }
                    if (count == 0) continue
                    chunks.add(buffer.copyOf(count)); total += count
                    val now = SystemClock.elapsedRealtime()
                    if (now - lastLevel >= 90) {
                        lastLevel = now; onLevel(PcmAudio.rms(buffer, count), total.toDouble() / PcmAudio.SAMPLE_RATE)
                    }
                }
                if (!discard.get()) {
                    val audio = ShortArray(total)
                    var offset = 0
                    for (chunk in chunks) { chunk.copyInto(audio, offset); offset += chunk.size }
                    completed = audio
                }
            } catch (error: Exception) {
                if (!discard.get()) failure = error.message ?: "无法录音，请检查麦克风权限和系统隐私开关。"
            } finally {
                running.set(false)
                synchronized(lifecycleLock) {
                    local?.let { device ->
                        runCatching { if (device.recordingState == AudioRecord.RECORDSTATE_RECORDING) device.stop() }
                        device.release()
                    }
                    recorder = null
                }
            }
            if (!discard.get()) {
                if (failure != null) onError(failure)
                else completed?.let(onFinished)
            }
        }, "InkVoice-capture").apply { start() }
    }
    fun stop(cancel: Boolean = false) {
        if (cancel) discard.set(true)
        running.set(false)
        synchronized(lifecycleLock) {
            runCatching { recorder?.let { if (it.recordingState == AudioRecord.RECORDSTATE_RECORDING) it.stop() } }
        }
    }
}
