package org.inkvoice.keyboard

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import org.inkvoice.keyboard.Ui.dp
import kotlin.math.sqrt

class InkVoiceImeService : InputMethodService() {
    private enum class Phase { IDLE, RECORDING, PROCESSING, READY, ERROR }
    private val handler = Handler(Looper.getMainLooper())
    private val guard = SessionGuard()
    private lateinit var models: ModelStore
    private lateinit var engine: WhisperEngine
    private var capture: AudioCapture? = null
    private var phase = Phase.IDLE
    private var workId = 0L
    private var message = "准备录音"
    private var lastText = ""
    private var activeTicket: SessionGuard.Ticket? = null
    private var activeConnection: InputConnection? = null
    private var retryNeeded = false
    private var sensitive = false
    private var committing = false
    private var shifted = false
    private var numberKeys = false
    private lateinit var keyPanel: LinearLayout

    private lateinit var status: TextView
    private lateinit var timer: TextView
    private lateinit var preview: TextView
    private lateinit var level: ProgressBar
    private lateinit var recordButton: Button
    private lateinit var cancelButton: Button
    private lateinit var retryButton: Button
    private val editorButtons = ArrayList<Button>()

    override fun onCreate() {
        super.onCreate()
        models = ModelStore(this)
        engine = WhisperEngine(this)
    }
    override fun onEvaluateFullscreenMode(): Boolean = false

    override fun onCreateInputView(): View {
        editorButtons.clear()
        val compact = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val root = Ui.column(this).apply {
            setPadding(dp(10), dp(if (compact) 3 else 8), dp(10), dp(if (compact) 3 else 6))
            setBackgroundColor(Ui.background)
            minimumHeight = dp(248)
        }
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        header.addView(Ui.text(this, "墨声 · 本地听写", 14f, true), LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(Ui.button(this, "设置") { cancelWork(); openSetup() }, LinearLayout.LayoutParams(dp(70), dp(if (compact) 34 else 42)))
        root.addView(header)

        val card = Ui.card(this).apply { setPadding(dp(12), dp(if (compact) 7 else 10), dp(12), dp(if (compact) 7 else 10)) }
        val statusRow = LinearLayout(this).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
        status = Ui.text(this, message, 14f, true).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        timer = Ui.text(this, "00:00", 12f)
        statusRow.addView(status, LinearLayout.LayoutParams(0, -2, 1f))
        statusRow.addView(timer)
        card.addView(statusRow)
        level = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; progress = 0 }
        card.addView(level, LinearLayout.LayoutParams(-1, dp(6)).apply { topMargin = dp(if (compact) 3 else 7); bottomMargin = dp(if (compact) 3 else 6) })
        preview = Ui.text(this, "录音结束后，识别结果将写入当前输入框。", 12f).apply {
            maxLines = 2; ellipsize = TextUtils.TruncateAt.END; minHeight = dp(30)
            if (compact) visibility = View.GONE
        }
        card.addView(preview)
        val buttons = LinearLayout(this)
        recordButton = Ui.button(this, "开始录音", true) { if (phase == Phase.RECORDING) stopRecording() else startRecording() }
        cancelButton = Ui.button(this, "取消") { cancelWork() }
        retryButton = Ui.button(this, "重试写入") { retryCommit() }
        val actionHeight = dp(if (compact) 42 else 46)
        buttons.addView(recordButton, LinearLayout.LayoutParams(0, actionHeight, 1f))
        buttons.addView(cancelButton, LinearLayout.LayoutParams(dp(78), actionHeight).apply { marginStart = dp(8) })
        buttons.addView(retryButton, LinearLayout.LayoutParams(dp(100), actionHeight).apply { marginStart = dp(8) })
        card.addView(buttons)
        root.addView(card, LinearLayout.LayoutParams(-1, -2))

        keyPanel = Ui.column(this)
        root.addView(keyPanel)
        buildKeys()
        root.addView(Ui.text(this, "本地识别 · 最长 5 分钟 · 不保留音频或文字历史", 11f).apply {
            if (compact) visibility = View.GONE
        })
        render()
        return root
    }

    private fun buildKeys() {
        keyPanel.removeAllViews(); editorButtons.clear()
        val compact = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val height = dp(if (compact) 40 else 44)
        fun row(inset: Int = 0): LinearLayout = LinearLayout(this).apply {
            setPadding(dp(inset), 0, dp(inset), 0)
            keyPanel.addView(this, LinearLayout.LayoutParams(-1, height))
        }
        fun key(row: LinearLayout, label: String, weight: Float = 1f, action: () -> Unit) {
            val button = Ui.button(this, label) { action() }.apply {
                minimumWidth = 0; minWidth = 0; setPadding(0, 0, 0, 0); maxLines = 1
                textSize = if (label.length <= 1) 17f else 12f
                contentDescription = when (label) { "⇧", "⇪" -> "切换字母大小写"; else -> label }
            }
            editorButtons.add(button)
            row.addView(button, LinearLayout.LayoutParams(0, height, weight).apply { marginEnd = dp(2) })
        }
        fun insert(text: String) { currentInputConnection?.commitText(text, 1) }
        val first = row()
        val second = row(if (numberKeys) 0 else 12)
        val third = row()
        val rows = if (numberKeys) listOf("1234567890", "@#¥%&*-+=/") else listOf("qwertyuiop", "asdfghjkl")
        for (character in rows[0]) key(first, character.toString().let { if (shifted && !numberKeys) it.uppercase() else it }) {
            insert(character.toString().let { if (shifted && !numberKeys) it.uppercase() else it })
        }
        for (character in rows[1]) key(second, character.toString().let { if (shifted && !numberKeys) it.uppercase() else it }) {
            insert(character.toString().let { if (shifted && !numberKeys) it.uppercase() else it })
        }
        if (numberKeys) {
            for (character in "()，。?!'") key(third, character.toString()) { insert(character.toString()) }
        } else {
            key(third, if (shifted) "⇪" else "⇧", 1.2f) { shifted = !shifted; buildKeys(); render() }
            for (character in "zxcvbnm") key(third, character.toString().let { if (shifted) it.uppercase() else it }) {
                insert(character.toString().let { if (shifted) it.uppercase() else it })
            }
        }
        key(third, "退格", 1.3f) { sendDownUpKeyEvents(android.view.KeyEvent.KEYCODE_DEL) }
        val bottom = row()
        key(bottom, if (numberKeys) "ABC" else "123", 1f) { numberKeys = !numberKeys; buildKeys(); render() }
        key(bottom, "切换", 1f) { switchKeyboard() }
        key(bottom, "空格", 2.8f) { insert(" ") }
        key(bottom, ",", .7f) { insert(",") }
        key(bottom, ".", .7f) { insert(".") }
        key(bottom, "回车", 1.2f) {
            val action = currentInputEditorInfo?.imeOptions?.and(EditorInfo.IME_MASK_ACTION) ?: EditorInfo.IME_ACTION_NONE
            val connection = currentInputConnection
            if (action == EditorInfo.IME_ACTION_NONE || action == EditorInfo.IME_ACTION_UNSPECIFIED || connection?.performEditorAction(action) != true) {
                connection?.commitText("\n", 1)
            }
        }
    }

    override fun onStartInput(attribute: EditorInfo?, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        cancelWork(renderNow = false)
        sensitive = InputPolicy.isSensitive(attribute?.inputType ?: 0)
        guard.startInput(attribute?.packageName ?: "", attribute?.fieldId ?: 0, attribute?.inputType ?: 0)
        render()
    }
    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        guard.show()
        render()
    }
    override fun onFinishInputView(finishingInput: Boolean) {
        guard.hide(); cancelWork(unload = true)
        super.onFinishInputView(finishingInput)
    }
    override fun onWindowHidden() {
        guard.hide(); cancelWork(unload = true)
        super.onWindowHidden()
    }
    override fun onFinishInput() {
        guard.hide(); cancelWork(unload = true)
        super.onFinishInput()
    }
    override fun onUpdateSelection(oldSelStart: Int, oldSelEnd: Int, newSelStart: Int, newSelEnd: Int,
            candidatesStart: Int, candidatesEnd: Int) {
        super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candidatesStart, candidatesEnd)
        if (!committing && (phase == Phase.RECORDING || phase == Phase.PROCESSING || retryNeeded) &&
            guard.selectionChanged(oldSelStart, oldSelEnd, newSelStart, newSelEnd)) {
            cancelWork()
            message = "光标或选区已改变，当前听写已取消"
            render()
        }
    }
    override fun onDestroy() {
        guard.hide(); workId++; capture?.stop(true); capture = null
        engine.close(); handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun openSetup() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    private fun switchKeyboard() {
        cancelWork()
        if (Build.VERSION.SDK_INT < 28 || !switchToNextInputMethod(false)) {
            getSystemService(InputMethodManager::class.java).showInputMethodPicker()
        }
    }
    private fun isCurrent(id: Long, ticket: SessionGuard.Ticket, connection: InputConnection): Boolean =
        id == workId && guard.canCommit(ticket) && isInputViewShown && currentInputConnection === connection

    private fun startRecording() {
        if (phase == Phase.RECORDING || phase == Phase.PROCESSING) return
        val ticket = guard.ticket() ?: run { fail("当前输入框不支持语音输入。"); return }
        val connection = currentInputConnection ?: run { fail("没有可用的输入框。"); return }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            fail("请先打开墨声设置允许麦克风。"); return
        }
        if (!models.appearsReady()) { fail("请先打开墨声设置下载并校验模型。"); return }
        val id = ++workId
        activeTicket = ticket; activeConnection = connection
        retryNeeded = false; lastText = ""; phase = Phase.RECORDING; message = "正在录音"
        timer.text = "00:00"; level.progress = 0; render()
        val recorder = AudioCapture(this); capture = recorder
        try {
            recorder.start(
                onLevel = { rms, seconds -> handler.post {
                    if (isCurrent(id, ticket, connection) && phase == Phase.RECORDING) {
                        level.progress = (sqrt(rms.coerceAtLeast(0.0)) * 250).toInt().coerceIn(0, 100)
                        timer.text = "%02d:%02d".format(seconds.toInt() / 60, seconds.toInt() % 60)
                    }
                } },
                onFinished = { samples -> handler.post {
                    if (isCurrent(id, ticket, connection)) {
                        capture = null; phase = Phase.PROCESSING; message = "正在准备本地识别…"; level.progress = 0; render()
                        val language = getSharedPreferences("keyboard", MODE_PRIVATE).getString("language", "auto") ?: "auto"
                        engine.transcribe(samples, language,
                            status = { value -> handler.post { if (isCurrent(id, ticket, connection)) { message = value; render() } } },
                            finished = { result -> handler.post {
                                if (isCurrent(id, ticket, connection)) {
                                    result.fold(onSuccess = { text ->
                                        lastText = text
                                        // Leave the busy phase before commit: its asynchronous selection
                                        // callback is our own result, not a user moving the destination.
                                        phase = Phase.READY; retryNeeded = false
                                        val committed = commitSafely(connection, text)
                                        retryNeeded = !committed
                                        message = if (committed) "已写入当前输入框" else "输入框未接受文字，可在本会话重试"
                                        render()
                                    }, onFailure = { error -> fail(error.message ?: "本地识别失败，请重试。") })
                                }
                            } })
                    }
                } },
                onError = { error -> handler.post { if (isCurrent(id, ticket, connection)) { capture = null; fail(error) } } }
            )
        } catch (error: Exception) { capture = null; fail(error.message ?: "无法开始录音。") }
    }
    private fun stopRecording() {
        if (phase != Phase.RECORDING) return
        phase = Phase.PROCESSING; message = "正在结束录音…"; render()
        capture?.stop()
    }
    private fun retryCommit() {
        val ticket = activeTicket ?: return
        val connection = activeConnection ?: return
        if (!retryNeeded || lastText.isBlank() || !isCurrent(workId, ticket, connection)) return
        retryNeeded = !commitSafely(connection, lastText)
        message = if (retryNeeded) "输入框未接受文字，请检查目标应用。" else "已写入当前输入框"
        render()
    }
    private fun commitSafely(connection: InputConnection, text: String): Boolean {
        committing = true
        return try { connection.commitText(text, 1) } catch (_: Exception) { false }
        finally { committing = false }
    }
    private fun cancelWork(unload: Boolean = false, renderNow: Boolean = true) {
        workId++; guard.invalidate()
        capture?.stop(true); capture = null
        if (::engine.isInitialized) { if (unload) engine.unload() else engine.cancel() }
        activeTicket = null; activeConnection = null; retryNeeded = false; lastText = ""
        phase = Phase.IDLE; message = "准备录音"
        if (::timer.isInitialized) { timer.text = "00:00"; level.progress = 0 }
        if (renderNow) render()
    }
    private fun fail(error: String) { phase = Phase.ERROR; message = error; retryNeeded = false; render() }
    private fun render() {
        if (!::status.isInitialized) return
        val busy = phase == Phase.RECORDING || phase == Phase.PROCESSING
        val permitted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val available = models.appearsReady()
        status.text = when {
            sensitive -> "密码等敏感字段已停用语音"
            !permitted -> "请打开设置授权麦克风"
            !available -> "请打开设置下载本地模型"
            else -> message
        }
        status.setTextColor(if (phase == Phase.ERROR || sensitive) Ui.red else Ui.text)
        recordButton.text = when (phase) { Phase.RECORDING -> "结束录音"; Phase.PROCESSING -> "正在识别…"; else -> "开始录音" }
        recordButton.isEnabled = permitted && available && !sensitive && guard.ticket() != null && phase != Phase.PROCESSING
        cancelButton.visibility = if (busy) View.VISIBLE else View.GONE
        retryButton.visibility = if (retryNeeded && !busy) View.VISIBLE else View.GONE
        preview.text = if (lastText.isNotBlank()) lastText else if (phase == Phase.RECORDING) "说完后点“结束录音”，识别完成后写入当前输入框。" else "录音结束后，识别结果将写入当前输入框。"
        preview.contentDescription = preview.text
        for (button in editorButtons) button.isEnabled = !busy
    }
}
