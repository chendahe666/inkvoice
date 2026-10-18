package org.inkvoice.keyboard

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CancellationException

/** Opt-in real engine test; the developer supplies a non-private spoken audio fixture. */
@RunWith(AndroidJUnit4::class)
class NativeEngineInstrumentedTest {
    @Test fun actualModelTranscribesProvidedWavAndRejectsCancelledEpoch() {
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue("Pass nativeSmoke=true and prepare model + smoke.wav", arguments.getString("nativeSmoke") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val model = ModelStore(context).verifiedFile()
        val fixture = File(context.getExternalFilesDir(null), "smoke.wav")
        val samples = readPcmWav(fixture)
        val handle = WhisperNative.create(model.absolutePath)
        assertTrue(handle != 0L)
        try {
            val epoch = WhisperNative.epoch(handle)
            val result = String(WhisperNative.transcribe(handle, samples, "auto", 2, epoch), Charsets.UTF_8).trim()
            assertTrue("The real model returned an empty transcript", result.isNotBlank())
            arguments.getString("expectedText")?.takeIf { it.isNotBlank() }?.let {
                assertTrue("Transcript did not contain the supplied expectedText", result.contains(it, ignoreCase = true))
            }
            WhisperNative.abort(handle)
            assertThrows(CancellationException::class.java) {
                WhisperNative.transcribe(handle, samples, "auto", 2, epoch)
            }
        } finally { WhisperNative.release(handle) }
    }

    private fun readPcmWav(file: File): FloatArray {
        require(file.isFile && file.length() in 44..(PcmAudio.MAX_SAMPLES * 2L + 65536)) {
            "Provide a bounded 16 kHz mono PCM16 file at ${file.absolutePath}"
        }
        val bytes = file.readBytes()
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        fun tag(at: Int): String = String(bytes, at, 4, Charsets.US_ASCII)
        require(tag(0) == "RIFF" && tag(8) == "WAVE") { "Expected RIFF/WAVE" }
        var validFormat = false
        var audio: ShortArray? = null
        var cursor = 12
        while (cursor + 8 <= bytes.size) {
            val size = buffer.getInt(cursor + 4).toLong() and 0xffffffffL
            val body = cursor + 8
            require(size <= bytes.size.toLong() - body) { "Truncated WAV chunk" }
            when (tag(cursor)) {
                "fmt " -> {
                    require(size >= 16) { "Truncated WAV format" }
                    require(buffer.getShort(body).toInt() == 1 && buffer.getShort(body + 2).toInt() == 1 &&
                        buffer.getInt(body + 4) == 16000 && buffer.getShort(body + 14).toInt() == 16) {
                        "Only PCM16 mono 16 kHz is accepted"
                    }
                    validFormat = true
                }
                "data" -> {
                    require(size % 2 == 0L && size / 2 <= PcmAudio.MAX_SAMPLES) { "Invalid PCM size" }
                    audio = ShortArray((size / 2).toInt()) { buffer.getShort(body + it * 2) }
                }
            }
            cursor = (body + size + (size and 1)).toInt()
        }
        require(validFormat) { "WAV format chunk missing" }
        return PcmAudio.validateAndNormalize(requireNotNull(audio) { "WAV data missing" })
    }
}
