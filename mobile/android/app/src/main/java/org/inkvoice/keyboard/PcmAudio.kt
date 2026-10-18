package org.inkvoice.keyboard

import kotlin.math.sqrt

object PcmAudio {
    const val SAMPLE_RATE = 16000
    const val MAX_SECONDS = 300
    const val MAX_SAMPLES = SAMPLE_RATE * MAX_SECONDS
    const val MIN_SAMPLES = SAMPLE_RATE / 4
    const val MIN_RMS = 0.0008

    fun rms(samples: ShortArray, count: Int = samples.size): Double {
        if (count <= 0) return 0.0
        var sum = 0.0
        for (i in 0 until count) { val x = samples[i] / 32768.0; sum += x * x }
        return sqrt(sum / count)
    }
    fun validateAndNormalize(samples: ShortArray): FloatArray {
        require(samples.size >= MIN_SAMPLES) { "录音太短，请至少说一句话。" }
        require(samples.size <= MAX_SAMPLES) { "单次录音最长 5 分钟。" }
        require(rms(samples) >= MIN_RMS) { "录音几乎无声，请检查麦克风和系统隐私开关。" }
        return FloatArray(samples.size) { samples[it] / 32768f }
    }
}
