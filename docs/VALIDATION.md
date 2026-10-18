# 预览版验证记录

以下为 2026-10-18 UTC 的实际检查范围，不是准确率、体验或商业产品等效评分。

| 版本/平台 | 已执行 | 尚未验证 |
|---|---|---|
| Windows v0.1.1 x64 | 独立干净目录构建、实际 Electron 启动与界面、合成语音本地识别、发布包隐私扫描；原开发构建另有自有窗口 Unicode 输入验收 | 日常真人语音准确率、所有编辑器兼容性、代码签名 |
| Linux v0.2.0-preview.1，Ubuntu 24.04 x64 | 固定源码编译 Whisper；公开 JFK 样例实际识别；非 root 且保留 Chromium sandbox 的 Electron/Xvfb 启动、模拟设备 AudioWorklet→WAV→打包引擎识别；自有 Tk 窗口中文/英文/换行/emoji 精确写入及错误目标拒绝；真实文件权限 0700/0600 | 物理麦克风、真实 Wayland 桌面、所有发行版和编辑器、系统密钥环服务 |
| Android v0.2.0-preview.1 ARM64 | 实际 APK 编译和本地 Whisper JNI 链接；8 项 JVM 测试全部通过；16 KB ZIP/ELF 对齐、APK v2 签名；许可证入包和个人构建路径扫描 | 物理麦克风、真实手机 IME 权限和键盘生命周期、实际手机 JNI 识别、耗电与时延 |
| iOS v0.2.0-preview.1 源码 | GitHub macOS runner 使用 Apple SDK 实际编译主 App 和键盘，arm64/x86_64 Simulator 均通过，[构建日志](https://github.com/chendahe666/inkvoice/actions/runs/39093562728)；XML 配置静态检查 | 9 项 Foundation 测试尚未执行；签名安装、iPhone 录音、后台新建识别任务、跨 App 插入、5/15 分钟会话真实行为及商店审核 |

Node 离线源码、控制器、窗口及 Linux 平台策略检查全部通过；Linux Python 助手逻辑检查 10 项通过。模拟检查与真实平台集成检查分别报告。

Linux 隔离窗口输入和公开音频样例不是任意应用或物理设备验证。Android 的构建/单元测试也不能证明手机录音正常。iOS 的 Simulator 编译不能证明“整个会话内免跳”已经在真机实现；该行为仍是下一项关键验收。

发布使用独立的公共源码目录。个人数据、密钥、历史、录音、诊断证据与签名私钥不进入 Git；对源码索引执行敏感路径和凭据模式检查，并在本机内存中与已知私人值逐项比对。安装包再独立检查内容，不从使用过的个人便携目录直接打包。
