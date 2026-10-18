import SwiftUI

@main
struct InkVoiceApp: App {
    @StateObject private var session = SessionController()
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                Form {
                    Section("语音会话") {
                        Label(session.state.phase == .off ? "麦克风未开启" : "麦克风正在持续监听",
                              systemImage: session.state.phase == .off ? "mic.slash" : "mic.fill")
                            .foregroundStyle(session.state.phase == .off ? Color.secondary : Color.red)
                        Text(session.state.message)
                        if let expiry = session.state.expiresAt, session.state.phase != .off {
                            HStack { Text("自动结束"); Text(expiry, style: .timer) }
                        }
                        Picker("识别语言", selection: $session.localeID) {
                            Text("中文（普通话）").tag("zh-CN")
                            Text("English (US)").tag("en-US")
                        }.disabled(session.state.phase != .off || session.starting)
                        if session.state.phase == .off {
                            Button("开启 5 分钟") { session.startSession(minutes: 5) }.disabled(session.starting)
                            Button("开启 15 分钟") { session.startSession(minutes: 15) }.disabled(session.starting)
                            if session.starting { Button("取消") { session.stopSession() } }
                        } else {
                            Button("立即停止并释放麦克风", role: .destructive) { session.stopSession() }
                        }
                    }
                    Section("开启后如何使用") {
                        Text("手动返回你要输入的 App，切到 InkVoice 键盘，点“开始说话”，说完点“完成”。会话有效期间无需重复进入主 App。")
                        Text("第一次请在系统设置 → 通用 → 键盘 → 键盘中添加 InkVoice，并允许完全访问。麦克风和语音识别权限由本 App 单独请求。")
                    }
                    Section("请先了解") {
                        Text("开启会话即同意这 5 或 15 分钟内麦克风持续工作。空闲音频直接丢弃；只把你主动开始的分段交给本机识别。可随时在主 App 或键盘停止整个会话。")
                        Text("只使用 Apple 本机识别。设备或语言不支持时会明确失败，绝不自动切换云端。音频不落盘、不上传；结果临时存于本 App 的共享容器，过期清理，不建立历史。")
                        Text("切换输入目标会取消未完成分段。通话、音频设备变化、系统终止或会话到期后，请手动返回此处重新开启。安全输入框和禁止第三方键盘的 App 不支持。")
                    }
                    Section("开发状态") {
                        Text("原生原型：尚未完成 Xcode/iPhone 真机验收。系统权限提示及语言资源由 iOS 管理。")
                    }
                }.navigationTitle("InkVoice")
            }
        }
    }
}
