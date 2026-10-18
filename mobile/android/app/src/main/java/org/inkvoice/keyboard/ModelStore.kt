package org.inkvoice.keyboard

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean

class ModelStore(context: Context) {
    companion object {
        const val MODEL_NAME = "ggml-base-q5_1.bin"
        const val MODEL_BYTES = 59707625L
        const val MODEL_SHA256 = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"
        const val MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin?download=true"
        private val downloadLock = Any()
    }
    class DownloadControl {
        val cancelled = AtomicBoolean(false)
        @Volatile var connection: HttpURLConnection? = null
        fun cancel() { cancelled.set(true); connection?.disconnect() }
        fun check() { if (cancelled.get()) throw CancellationException("已取消下载") }
    }
    private val directory = File(context.applicationContext.filesDir, "models")
    val file = File(directory, MODEL_NAME)
    private val marker = File(directory, "$MODEL_NAME.verified")

    /** Fast UI hint only. The engine verifies the full SHA-256 before loading. */
    fun appearsReady(): Boolean = file.isFile && file.length() == MODEL_BYTES &&
        marker.isFile && runCatching { marker.readText().trim() == MODEL_SHA256 }.getOrDefault(false)

    fun verifiedFile(): File {
        require(isValid(file)) { "模型未准备好或校验失败，请打开墨声设置下载模型。" }
        return file
    }
    private fun isValid(candidate: File): Boolean = candidate.isFile && candidate.length() == MODEL_BYTES &&
        sha256(candidate) == MODEL_SHA256

    private fun sha256(candidate: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        candidate.inputStream().buffered().use { input ->
            val buffer = ByteArray(65536)
            while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }
    private fun moveAtomically(source: File, destination: File) {
        try {
            Files.move(source.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: AtomicMoveNotSupportedException) {
            // Same-directory rename remains atomic on the app's normal private Android filesystem.
            check(source.renameTo(destination)) { "无法保存已校验的模型文件。" }
        }
    }
    private fun markVerified() {
        val temporary = File.createTempFile("verified-", ".partial", directory)
        try {
            FileOutputStream(temporary).use { it.write(MODEL_SHA256.toByteArray(Charsets.US_ASCII)); it.fd.sync() }
            moveAtomically(temporary, marker)
        } finally { temporary.delete() }
    }
    fun download(control: DownloadControl, progress: (Int) -> Unit): File = synchronized(downloadLock) {
        directory.mkdirs()
        control.check()
        if (isValid(file)) { markVerified(); progress(100); return@synchronized file }
        val temporary = File.createTempFile("model-", ".partial", directory)
        var connection: HttpURLConnection? = null
        try {
            val activeConnection = URL(MODEL_URL).openConnection() as HttpURLConnection
            connection = activeConnection
            control.connection = activeConnection
            activeConnection.connectTimeout = 20000
            activeConnection.readTimeout = 30000
            activeConnection.instanceFollowRedirects = true
            activeConnection.setRequestProperty("Accept-Encoding", "identity")
            check(activeConnection.responseCode == HttpURLConnection.HTTP_OK) { "模型下载失败（HTTP ${activeConnection.responseCode}）。" }
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            var lastPercent = -1
            activeConnection.inputStream.buffered().use { input ->
                FileOutputStream(temporary).use { output ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        control.check()
                        val count = input.read(buffer)
                        if (count < 0) break
                        received += count
                        check(received <= MODEL_BYTES) { "下载文件大小不符合预期，已停止。" }
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                        val percent = (received * 100 / MODEL_BYTES).toInt()
                        if (percent != lastPercent) { lastPercent = percent; progress(percent) }
                    }
                    output.fd.sync()
                }
            }
            control.check()
            val actualHash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
            check(received == MODEL_BYTES && actualHash == MODEL_SHA256) { "模型校验失败，未替换已有文件。请检查网络后重试。" }
            // Another valid file must never be overwritten. All in-process writers share this lock.
            if (!isValid(file)) moveAtomically(temporary, file)
            markVerified()
            progress(100)
            file
        } finally {
            control.connection = null
            connection?.disconnect()
            temporary.delete()
        }
    }
}
