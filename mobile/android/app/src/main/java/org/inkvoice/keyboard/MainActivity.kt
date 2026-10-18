package org.inkvoice.keyboard

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import org.inkvoice.keyboard.Ui.dp
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var models: ModelStore
    private lateinit var micStatus: TextView
    private lateinit var keyboardStatus: TextView
    private lateinit var modelStatus: TextView
    private lateinit var micButton: Button
    private lateinit var modelButton: Button
    private var download: ModelStore.DownloadControl? = null

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        models = ModelStore(this)
        val scroll = ScrollView(this).apply { setBackgroundColor(Ui.background); isFillViewport = true }
        val content = Ui.column(this).apply { setPadding(dp(20), dp(24), dp(20), dp(24)) }
        scroll.addView(content)
        scroll.setOnApplyWindowInsetsListener { view, insets ->
            val top: Int; val bottom: Int
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars()); top = bars.top; bottom = bars.bottom
            } else { top = insets.systemWindowInsetTop; bottom = insets.systemWindowInsetBottom }
            view.setPadding(0, top, 0, bottom); insets
        }
        content.addView(Ui.text(this, "墨声键盘", 25f, true))
        content.addView(Ui.text(this, "直接在系统键盘里录音，本机识别后写入输入框。"))
        content.addView(Ui.space(this, 22))

        val microphoneCard = Ui.card(this)
        microphoneCard.addView(Ui.text(this, "麦克风", 16f, true))
        micStatus = Ui.text(this, "")
        microphoneCard.addView(micStatus)
        micButton = Ui.button(this, "允许麦克风", true) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 10)
        }
        microphoneCard.addView(micButton)
        content.addView(microphoneCard)
        content.addView(Ui.space(this, 14))

        val modelCard = Ui.card(this)
        modelCard.addView(Ui.text(this, "本地语音模型", 16f, true))
        modelStatus = Ui.text(this, "")
        modelCard.addView(modelStatus)
        modelCard.addView(Ui.text(this, "Whisper base Q5_1 · 多语言 · 约 60 MB。首次下载需要网络，识别时不上传音频。", 12f))
        modelButton = Ui.button(this, "下载并校验模型", true) { downloadModel() }
        modelCard.addView(modelButton)
        content.addView(modelCard)
        content.addView(Ui.space(this, 14))

        val keyboardCard = Ui.card(this)
        keyboardCard.addView(Ui.text(this, "启用系统键盘", 16f, true))
        keyboardStatus = Ui.text(this, "")
        keyboardCard.addView(keyboardStatus)
        keyboardCard.addView(Ui.button(this, "打开系统输入法设置") { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) })
        keyboardCard.addView(Ui.button(this, "选择当前键盘") { getSystemService(InputMethodManager::class.java).showInputMethodPicker() })
        keyboardCard.addView(Ui.text(this, "在任意文本框切换到“墨声本地语音键盘”，然后点“开始录音”。首次授权后，正常使用不需要反复打开主界面。", 12f))
        content.addView(keyboardCard)
        content.addView(Ui.space(this, 14))

        val languageCard = Ui.card(this)
        languageCard.addView(Ui.text(this, "识别语言", 16f, true))
        val codes = listOf("auto", "zh", "en", "ja", "ko", "es", "fr", "de")
        val names = listOf("自动识别", "中文", "English", "日本語", "한국어", "Español", "Français", "Deutsch")
        val preferences = getSharedPreferences("keyboard", MODE_PRIVATE)
        val spinner = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, names)
            setSelection(codes.indexOf(preferences.getString("language", "auto")).coerceAtLeast(0))
            onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) {
                    preferences.edit().putString("language", codes[position]).apply()
                }
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
            }
        }
        languageCard.addView(spinner, LinearLayout.LayoutParams(-1, dp(48)))
        content.addView(languageCard)
        content.addView(Ui.space(this, 20))
        content.addView(Ui.text(this, "首版提供本地听写、基本英文字母/数字/标点按键，不含云端整理、文字历史或中文拼音。录音仅在键盘可见时进行；隐藏键盘、移动光标或切换输入框会取消任务。密码字段禁用语音。", 12f))
        content.addView(Ui.space(this, 10))
        content.addView(Ui.text(this, "开源原型 · 语音引擎与模型采用 MIT 许可。Android 设备和厂商系统仍需实测。", 12f))
        setContentView(scroll)
    }

    override fun onResume() { super.onResume(); if (::micStatus.isInitialized) refresh() }
    private fun refresh() {
        val granted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        micStatus.text = if (granted) "已授权。系统隐私开关仍可能暂停麦克风。" else "尚未授权。系统只在你主动开始录音时使用麦克风。"
        micButton.isEnabled = !granted
        micButton.text = if (granted) "麦克风已授权" else "允许麦克风"
        if (download == null) {
            val ready = models.appearsReady()
            modelStatus.text = if (ready) "模型已下载；加载前会再次校验。" else "尚未准备好本地模型。"
            modelButton.text = if (ready) "重新检查模型" else "下载并校验模型"
        }
        val manager = getSystemService(InputMethodManager::class.java)
        val enabled = manager.enabledInputMethodList.any { it.packageName == packageName }
        val selected = Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)?.startsWith("$packageName/") == true
        keyboardStatus.text = when { selected -> "墨声已设为当前输入法。"; enabled -> "已启用，请选择墨声作为当前键盘。"; else -> "先在系统设置中启用墨声，再切换到该键盘。" }
    }
    private fun downloadModel() {
        if (download != null) return
        val control = ModelStore.DownloadControl(); download = control
        modelButton.isEnabled = false
        modelStatus.text = "正在检查模型…"
        worker.execute {
            try {
                models.download(control) { percent -> handler.post { if (!isDestroyed) modelStatus.text = "下载并校验模型：$percent%" } }
                handler.post { if (!isDestroyed) modelStatus.text = "模型校验通过，可以使用本地语音键盘。" }
            } catch (error: Exception) {
                handler.post { if (!isDestroyed) modelStatus.text = error.message ?: "下载失败，请重试。" }
            } finally {
                handler.post { download = null; if (!isDestroyed) { modelButton.isEnabled = true; modelButton.text = "检查或重新下载模型" } }
            }
        }
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults); refresh()
    }
    override fun onDestroy() { download?.cancel(); worker.shutdownNow(); super.onDestroy() }
}
