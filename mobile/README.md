# 墨声手机键盘

Android 首版是独立的原生系统输入法：在其他应用的文本框中切换到墨声，点“开始录音”，结束后使用本机 CPU 识别并直接写入该输入框。它使用真实麦克风和固定版本的 whisper.cpp；不依赖桌面 Electron，也没有演示用的假转写。

当前 Android 源码仍属预览版本。APK 构建结果与设备验证范围以根目录的发布说明为准。iPhone 版本尚未交付；iOS 系统键盘扩展不能自行获取麦克风，不能照搬 Android 的录音方案。

## Android 使用

1. 安装适合设备的 APK，打开“墨声键盘”。首版支持 Android 8.0 / API 26 及以上，默认构建包含 ARM64 和 x86_64。
2. 在主界面点“允许麦克风”，完成系统的一次运行时授权。系统全局麦克风隐私开关仍须允许录音。
3. 点“下载并校验模型”。约 60 MB 的多语言 Whisper base Q5_1 模型保存到应用私有目录；首次下载需要网络，后续识别可离线使用。
4. 打开系统输入法设置，启用墨声，再通过“选择当前键盘”选中它。Android 会显示标准的第三方输入法提示。
5. 在普通文本框中使用墨声键盘，点“开始录音”，说完点“结束录音”。识别完成后，文字写入当前输入框。取消、隐藏键盘或切换输入框会丢弃当前任务。

这是语音键盘，附基本 QWERTY 英文字母、大小写切换、数字和常用标点，方便修改短词，另有空格、退格、回车和切换输入法按钮，尚不包含中文拼音、词库预测或完整文本编辑功能。密码、可见密码、网页密码和数字密码字段禁用录音。单次录音最长 5 分钟；过短或近乎无声的音频会被拒绝。首版没有 Gemini、云端整理、跨设备同步或文字历史。

音频仅保留在当前进程内存中，不保存到音频文件、不上传到识别服务。键盘可见时由用户点按开始录音，隐藏时停止，不使用后台常驻录音。识别结果仅暂存于当前输入会话并写入用户选中的文本框；目标应用自行决定如何保存文字。系统输入法的权限和平台行为仍需在具体厂商设备上验证。

## 从源码构建 Android

需要 JDK 17、Android SDK Platform 35 / Build Tools 35.0.0、NDK `28.2.13676358`、CMake `3.22.1`。项目固定 AGP `8.9.2`、Gradle `8.11.1`、Kotlin `2.1.20`，最小 API 26，目标 API 35。构建脚本会下载固定源码和 Maven 依赖；模型不打进 APK。

Android Studio 可打开 [android](android) 目录并安装上述 SDK 组件。命令行构建时设置 `JAVA_HOME` 为 JDK 17，设置 `ANDROID_HOME` 为 SDK 目录；或者在 `android/local.properties` 中写入本机 `sdk.dir`。不要提交该文件或签名密钥。

Windows PowerShell：

```powershell
cd mobile/android
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug --no-daemon
```

macOS / Linux：

```sh
cd mobile/android
./gradlew :app:testDebugUnitTest :app:assembleDebug --no-daemon
```

APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk`。它由本机调试密钥签名，供开发测试；发布版需要开发者自己的签名和分发流程。只编译 ARM64 可追加 `-PinkvoiceAbis=arm64-v8a`，模拟器可用 `-PinkvoiceAbis=x86_64`。项目限制 Gradle 2 个 worker、2 GB JVM 堆和原生编译并发 1，方便在内存有限的机器上构建。若工具链报 `LLVM ERROR: out of memory`，先减少并行任务并释放主机内存；保留已有编译缓存后重试。

有设备或模拟器连接后安装：

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

不要在缺乏麦克风输入的模拟器上把构建成功当成真实语音验证。ARM64 手机上的录音权限、静音/隐私开关、速度、输入框兼容性和长时录音需要实测。

## 固定依赖和隐私边界

- 引擎：whisper.cpp commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`，通过 CMake 下载固定 archive 并校验 SHA-256。
- 模型：`ggerganov/whisper.cpp` revision `5359861c739e955e79d9a303bcbc70fb988958b1` 的 `ggml-base-q5_1.bin`；大小 `59707625` 字节；SHA-256 `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898`。
- 下载先写入同目录临时文件；完整大小和哈希通过后才原子替换。已有有效模型不被覆盖。引擎加载前重新计算哈希，界面中的准备提示不会跳过该校验。
- APK 不含个人 API key、个人音频、文字历史或预置用户模型。模型、临时下载和设置均在应用私有目录；系统备份已禁用。卸载应用会移除这些本地数据。
- whisper.cpp、ggml 和 Whisper 模型的 MIT 声明随 APK 保留在 `assets/THIRD_PARTY_NOTICES.txt`。InkVoice 自身沿用仓库 MIT 许可证。

## 验证

`testDebugUnitTest` 在 JVM 上检查输入会话切换/重启/隐藏后的结果失效、密码字段策略，以及 PCM 时长、静音、归一化和数值范围。它不证明麦克风或 Android 输入服务已在设备上通过。

可选原生识别测试使用你明确准备的非私密语音样本，不下载测试音频，不伪造结果：

1. 先安装调试 APK，在主界面下载并校验模型。
2. 准备一段 16 kHz、单声道、16-bit PCM WAV，复制到应用的外部私有目录：

```sh
adb shell mkdir -p /sdcard/Android/data/org.inkvoice.keyboard/files
adb push speech.wav /sdcard/Android/data/org.inkvoice.keyboard/files/smoke.wav
./gradlew :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.nativeSmoke=true -Pandroid.testInstrumentationRunnerArguments.expectedText=hello
```

PowerShell 使用 `.\gradlew.bat`。`expectedText` 是可选的不区分大小写的文本片段；选用与样本相符的短词。测试会加载实际模型、解析实际 WAV、执行 JNI 识别，并确认取消后的旧 epoch 不能继续识别。未显式传入 `nativeSmoke=true` 时跳过此项。该测试验证引擎链路，完整键盘还需手动在输入框中验证开始/结束/取消、切换输入框不写入旧结果、隐藏键盘停止以及密码字段禁用。

构建缓存、下载模型、APK、签名和设备样本均不应提交到仓库。
