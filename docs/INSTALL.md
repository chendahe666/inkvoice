# 安装与构建

本文介绍 **Windows x64 v0.1.1**。跨平台开发预览分别见 [Linux](LINUX.md)、[Android](../mobile/android/README.md) 和 [iOS](IOS.md)。浅色桌面界面不代表已支持 macOS。

## 使用便携版

无需 Node.js 或编译环境。先打开 [发布页面](https://github.com/chendahe666/inkvoice/releases)，选择 [v0.1.1 预发布版本](https://github.com/chendahe666/inkvoice/releases/tag/v0.1.1) 的 **Windows x64 便携 ZIP**。不要把自动生成的 Source code ZIP 当作可运行程序。

1. 完整解压到当前用户有写入权限的目录。
2. 运行文件夹中的 `InkVoice.exe`。
3. 打开“设置”，确认麦克风与本地模型状态，然后保存。

保留 exe、DLL、`resources` 和其他随附文件的相对位置。只复制 exe 无法启动。便携版包含运行时与默认模型，不需要安装 Node.js。

可用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 计算下载 ZIP 的校验值，与同一发布页的 `SHA256SUMS` 对照。校验值应完全一致。

当前构建未进行代码签名，没有安装器或自动更新。Windows 可能显示未识别发布者提示；应自行核对下载来源与发布者提供的校验信息，不必关闭系统安全保护。

## 从源码运行

### 环境要求

- Windows x64，能够使用麦克风的桌面会话。
- Node.js **22.12.0 或更高版本**及 npm；此下限来自锁定的 Electron 包要求。
- Windows PowerShell；Git 仅在使用克隆方式时需要。
- Windows .NET Framework x64 C# 编译器。构建脚本使用 `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`，不使用 .NET SDK 或 Visual Studio 工程。
- 首次配置可访问 npm、GitHub 和 Hugging Face；完成配置后，本地识别可以离线使用。

源码仓库有意不包含 `node_modules`、`runtime`、`models`、`native/bin`、`release`、个人数据、测试证据或音频样例。

### 1. 获取源码

从仓库首页使用 **Code → Download ZIP** 并解压，或使用该页面提供的地址克隆。在解压或克隆后的项目目录中打开 PowerShell；以下命令均从项目根目录执行。

```powershell
git clone https://github.com/chendahe666/inkvoice.git
cd inkvoice
```

### 2. 安装桌面运行时

```powershell
npm ci
node node_modules/electron/install.js
```

`npm ci` 按 `package-lock.json` 安装依赖。正常情况下它会安装 Electron；第二条命令会检查并补齐 Electron 运行时，便于处理安装脚本曾被跳过的环境。

### 3. 下载本地语音引擎与模型

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-engine.ps1
```

脚本下载并校验固定版本：

| 内容 | 版本或文件 | 输出目录 |
|---|---|---|
| whisper.cpp CPU 运行时 | v1.9.5 对应的 b5454 Windows x64 构建 | `runtime/whisper` |
| 多语言 Whisper 模型 | `ggml-base-q5_1.bin`，约 60 MB | `models` |

下载地址、固定哈希和文件大小写在脚本中。符合校验的缓存可以复用；不匹配时脚本会停止，保留 `.partial` 文件供检查。执行策略参数只作用于本次 PowerShell 进程。

本步骤还会生成本地 `evidence/engine-setup.json`，记录依赖校验结果；它不调用麦克风，也不转写用户音频。

### 4. 编译 Windows 输入助手

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-native.ps1
```

脚本将 `native/InkVoice.Input.cs` 编译为 `native/bin/InkVoice.Input.exe`，再执行结构自检。此自检不证明所有应用都能接受自动写入。

### 5. 启动

```powershell
npm start
```

确认侧栏显示“本地识别已就绪”。如需其他兼容的 Whisper 模型，可以在“设置 → 模型与存储”指定模型路径；默认下载和打包流程仍使用随附模型。

## 检查与打包

新克隆仓库可以先运行不依赖既有识别证据的检查：

```powershell
npm run check
```

此命令依次执行 `check:source`、`check:controller`、`check:windows`。这些检查使用源码和模拟依赖，不需要模型、麦克风、云端密钥或预先存在的测试产物；也可以分别运行。

编译输入助手后，可另外运行：

```powershell
npm run check:native
```

这验证本地助手布局和无效输入处理，不会证明其在任意目标应用中都能写入。

完成安装、模型下载和助手编译后，可以启动桌面壳检查：

```powershell
npm run smoke
```

生成便携目录：

```powershell
npm run package
```

输出为 `release/InkVoice`，入口为 `release/InkVoice/InkVoice.exe`。请分发整个目录。打包脚本会拒绝覆盖已经存在的目标目录；关闭旧应用并将旧目录移到其他位置，再重新执行。

新打包不会包含开发版 `data`、测试证据或个人 API 密钥。应用首次运行后会在 exe 旁新建 `data`。分发已经运行过的便携目录前，仍需检查其中是否有个人数据。

默认检查不包含听写准确率、真实桌面输入或云端服务验证。这些集成测试需要各自的运行环境及样例。更多测试范围见 [贡献指南](../CONTRIBUTING.md)。

## 常见问题

| 现象 | 处理方式 |
|---|---|
| Electron 运行时缺失 | 检查 Node.js 版本与网络，重新执行 `npm ci` 和 `node node_modules/electron/install.js`。 |
| 识别引擎或模型未就绪 | 重新执行 `setup-engine.ps1`；检查设置中的自定义模型路径是否仍存在。 |
| 下载校验失败 | 检查网络响应、代理或下载中断原因，保留错误信息；不要跳过哈希校验。 |
| 提示找不到 C# 编译器 | 检查系统 .NET Framework 组件与上述 x64 编译器路径。 |
| 麦克风不可用 | 在 Windows 隐私设置中允许桌面应用访问麦克风，并在墨声设置中选择实际设备。 |
| 快捷键被占用 | 使用工作台当前显示的组合；在设置中选择其他录音快捷键。 |
| 写入失败 | 确认目标输入框有焦点，并检查双方权限。可以先复制文字，手动粘贴。 |
| 便携目录无法保存数据 | 将完整目录移到当前用户可写的位置，不要放在只读目录。 |

使用过程见 [使用说明](USAGE.md)。提交问题前请移除 API 密钥、私人转写和个人路径。
