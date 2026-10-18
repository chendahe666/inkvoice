package org.inkvoice.keyboard

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.sin

class CorePolicyTest {
    private fun readyGuard() = SessionGuard().apply { startInput("example.editor", 7, 1); show() }
    @Test fun changingEditorInvalidatesAnInFlightResult() {
        val guard = readyGuard(); val ticket = guard.ticket()!!
        guard.startInput("example.editor", 8, 1); guard.show()
        assertFalse(guard.canCommit(ticket))
    }
    @Test fun sameEditorRestartStillInvalidatesOldWork() {
        val guard = readyGuard(); val ticket = guard.ticket()!!
        guard.startInput("example.editor", 7, 1); guard.show()
        assertFalse(guard.canCommit(ticket)); assertTrue(guard.canCommit(guard.ticket()!!))
    }
    @Test fun hideAndCancelPreventLateCommit() {
        val guard = readyGuard(); val first = guard.ticket()!!
        guard.invalidate(); assertFalse(guard.canCommit(first))
        val second = guard.ticket()!!; guard.hide(); assertFalse(guard.canCommit(second)); assertNull(guard.ticket())
    }
    @Test fun selectionMoveInvalidatesEvenTheSameEditor() {
        val guard = readyGuard(); val ticket = guard.ticket()!!
        assertFalse(guard.selectionChanged(3, 3, 3, 3)); assertTrue(guard.canCommit(ticket))
        assertTrue(guard.selectionChanged(3, 3, 4, 8)); assertFalse(guard.canCommit(ticket))
    }
    @Test fun passwordVariantsCannotStartDictation() {
        for (type in listOf(0x81, 0x91, 0xe1, 0x12)) {
            val guard = SessionGuard(); guard.startInput("example", 1, type); guard.show()
            assertNull(guard.ticket())
        }
        assertFalse(InputPolicy.isSensitive(1)); assertFalse(InputPolicy.isSensitive(2))
    }
    @Test fun shortAndSilentAudioAreRejected() {
        assertThrows(IllegalArgumentException::class.java) { PcmAudio.validateAndNormalize(ShortArray(100)) }
        assertThrows(IllegalArgumentException::class.java) { PcmAudio.validateAndNormalize(ShortArray(16000)) }
    }
    @Test fun oneSecondWaveformPreservesDurationAndPolarity() {
        val pcm = ShortArray(16000) { (sin(2 * Math.PI * 440 * it / 16000) * 16000).toInt().toShort() }
        val normalized = PcmAudio.validateAndNormalize(pcm)
        assertEquals(16000, normalized.size)
        assertTrue(normalized.max() > .48f); assertTrue(normalized.min() < -.48f)
        assertTrue(normalized.all { it.isFinite() && it >= -1f && it <= 1f })
    }
    @Test fun pcm16ExtremesDoNotOverflow() {
        val pcm = ShortArray(4000) { if (it % 2 == 0) Short.MIN_VALUE else Short.MAX_VALUE }
        val normalized = PcmAudio.validateAndNormalize(pcm)
        assertEquals(-1f, normalized[0]); assertEquals(32767 / 32768f, normalized[1])
    }
}
