package org.inkvoice.keyboard

import android.content.Context
import java.util.concurrent.Executors
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** JNI returns bytes; Kotlin's UTF-8 decoder handles Chinese and supplementary Unicode correctly. */
object WhisperNative {
    init { System.loadLibrary("inkvoice_whisper") }
    external fun create(modelPath: String): Long
    external fun epoch(handle: Long): Long
    external fun abort(handle: Long)
    external fun transcribe(handle: Long, samples: FloatArray, language: String, threads: Int, expectedEpoch: Long): ByteArray
    external fun release(handle: Long)
}

class WhisperEngine(context: Context) {
    private val models = ModelStore(context.applicationContext)
    private val worker = Executors.newSingleThreadExecutor()
    private val handle = AtomicLong(0)
    private val generation = AtomicLong(0)
    private val closed = AtomicBoolean(false)

    fun transcribe(samples: ShortArray, language: String, status: (String) -> Unit, finished: (Result<String>) -> Unit) {
        check(!closed.get()) { "识别引擎已关闭。" }
        cancel()
        val ticket = generation.get()
        worker.execute {
            try {
                if (generation.get() != ticket) return@execute
                val floats = PcmAudio.validateAndNormalize(samples)
                var current = handle.get()
                if (current == 0L) {
                    status("正在校验并加载本地模型…")
                    val model = models.verifiedFile()
                    if (generation.get() != ticket) return@execute
                    current = WhisperNative.create(model.absolutePath)
                    handle.set(current)
                }
                // Epoch is read before the Java cancellation check: cancellation cannot be lost
                // between this check and entry to native inference.
                val nativeEpoch = WhisperNative.epoch(current)
                if (generation.get() != ticket) return@execute
                status("正在本机识别…")
                val bytes = WhisperNative.transcribe(current, floats, language,
                    (Runtime.getRuntime().availableProcessors() - 1).coerceIn(1, 4), nativeEpoch)
                if (generation.get() != ticket) return@execute
                val text = String(bytes, Charsets.UTF_8).trim()
                require(text.isNotBlank()) { "没有识别到可用文字，请重试。" }
                finished(Result.success(text))
            } catch (error: Throwable) {
                if (generation.get() == ticket && error !is CancellationException) finished(Result.failure(error))
            }
        }
    }
    fun cancel() {
        generation.incrementAndGet()
        val current = handle.get()
        if (current != 0L) WhisperNative.abort(current)
    }
    fun unload() {
        cancel()
        if (!closed.get()) worker.execute { val old = handle.getAndSet(0); if (old != 0L) WhisperNative.release(old) }
    }
    fun close() {
        if (!closed.compareAndSet(false, true)) return
        cancel()
        worker.execute { val old = handle.getAndSet(0); if (old != 0L) WhisperNative.release(old) }
        worker.shutdown()
    }
}
