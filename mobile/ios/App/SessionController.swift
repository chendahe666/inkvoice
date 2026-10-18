import AVFoundation
import Speech
import SwiftUI

// The tap always runs during an explicitly enabled session. Outside a segment
// it immediately discards buffers. Audio is never written to disk or uploaded.
private final class AudioGate {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    func begin(_ value: SFSpeechAudioBufferRecognitionRequest) {
        lock.lock(); defer { lock.unlock() }
        request = value
    }
    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        request?.append(buffer)
    }
    func end() {
        lock.lock(); defer { lock.unlock() }
        request?.endAudio()
        request = nil
    }
}

final class SessionController: ObservableObject {
    @Published private(set) var state = VoiceState.off("会话未开启")
    @Published private(set) var starting = false
    @Published var localeID = "zh-CN"

    private let engine = AVAudioEngine()
    private let gate = AudioGate()
    private var mailbox: Mailbox?
    private var observer: MailboxObserver?
    private var timer: Timer?
    private var notifications: [NSObjectProtocol] = []
    private var recognizer: SFSpeechRecognizer?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var commandGate = CommandGate()
    private var active: VoiceCommand?
    private var sessionDeadline: LocalDeadline?
    private var segmentDeadline: LocalDeadline?
    private var processingDeadline: LocalDeadline?
    private var tapInstalled = false
    private var permissionGeneration = UUID()

    init() {
        do {
            mailbox = try Mailbox()
            try mailbox?.publish(state)
            try mailbox?.prune(now: Date())
        } catch { state.message = "共享容器不可用；请检查两个 target 的 App Group 签名配置。" }
        observer = MailboxObserver(name: VoiceProtocol.commandNotification) { [weak self] in self?.tick() }
        let center = NotificationCenter.default
        for name in [AVAudioSession.interruptionNotification,
                     AVAudioSession.mediaServicesWereResetNotification,
                     AVAudioSession.routeChangeNotification] {
            notifications.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                guard let self, self.state.phase != .off else { return }
                if name == AVAudioSession.interruptionNotification,
                   let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                   AVAudioSession.InterruptionType(rawValue: raw) == .ended { return }
                if name == AVAudioSession.routeChangeNotification,
                   let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                   let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
                   reason == .categoryChange || reason == .override { return }
                // Audio route changes are intentionally fail-closed for this first version.
                self.stopSession("音频被中断或设备发生变化；请在主 App 重新开启会话。")
            })
        }
    }

    deinit {
        timer?.invalidate()
        notifications.forEach { NotificationCenter.default.removeObserver($0) }
        recognitionTask?.cancel()
        engine.stop()
    }

    func startSession(minutes: Int) {
        guard !starting, state.phase == .off, [5, 15].contains(minutes), mailbox != nil else { return }
        starting = true
        state.message = "正在检查本机识别与权限……"
        let generation = UUID()
        permissionGeneration = generation
        // Only this user action asks for permissions; keyboard extensions never do.
        SFSpeechRecognizer.requestAuthorization { [weak self] authorization in
            DispatchQueue.main.async {
                guard let self, self.permissionGeneration == generation else { return }
                guard authorization == .authorized else {
                    self.permissionFailed("语音识别权限未允许；请在系统设置中启用。")
                    return
                }
                AVAudioApplication.requestRecordPermission { [weak self] granted in
                    DispatchQueue.main.async {
                        guard let self, self.permissionGeneration == generation else { return }
                        guard granted else {
                            self.permissionFailed("麦克风权限未允许；请在系统设置中启用。")
                            return
                        }
                        self.activate(minutes: minutes)
                    }
                }
            }
        }
    }

    private func permissionFailed(_ message: String) {
        starting = false
        state = .off(message)
        try? mailbox?.publish(state)
    }

    private func activate(minutes: Int) {
        guard UIApplication.shared.applicationState == .active else {
            permissionFailed("请保持主 App 在前台，再点击开启会话。")
            return
        }
        guard let speech = SFSpeechRecognizer(locale: Locale(identifier: localeID)),
              speech.supportsOnDeviceRecognition, speech.isAvailable else {
            permissionFailed("此设备或所选语言的本机识别不可用。不会切换到云端；请检查系统语言资源或更换语言。")
            return
        }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker])
            try audio.setActive(true)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw SessionError.noInput }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [gate] buffer, _ in gate.append(buffer) }
            tapInstalled = true
            engine.prepare()
            try engine.start()
            sessionDeadline = LocalDeadline(seconds: Double(minutes * 60))
            recognizer = speech
            commandGate = CommandGate()
            state = VoiceState(sessionID: UUID(), expiresAt: Date().addingTimeInterval(Double(minutes * 60)),
                               heartbeat: Date(), phase: .ready,
                               message: "会话已开启：麦克风持续监听；未开始分段时音频立即丢弃。")
            starting = false
            try mailbox?.publish(state)
            timer?.invalidate()
            let heartbeatTimer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in self?.tick() }
            timer = heartbeatTimer
            RunLoop.main.add(heartbeatTimer, forMode: .common)
        } catch {
            stopSession("无法启动录音。请检查麦克风占用、权限和共享容器配置后重试。")
        }
    }

    func stopSession(_ message: String = "会话已结束，麦克风已释放。") {
        permissionGeneration = UUID()
        starting = false
        gate.end()
        active = nil // Invalidate callback identity before cancelling the recognition task.
        recognitionTask?.cancel()
        recognitionTask = nil
        segmentDeadline = nil
        processingDeadline = nil
        sessionDeadline = nil
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        timer?.invalidate()
        timer = nil
        recognizer = nil
        state = .off(message)
        try? mailbox?.publish(state)
        try? mailbox?.prune(now: Date())
    }

    private func tick() {
        guard state.phase != .off, let mailbox else { return }
        let now = Date()
        guard let deadline = sessionDeadline, !deadline.isExpired(), engine.isRunning else {
            stopSession("会话已到期或录音已停止；请在主 App 重新开启。")
            return
        }
        do {
            // Wall-clock expiry is for cross-process UI only; the local deadline owns the mic limit.
            state.expiresAt = now.addingTimeInterval(deadline.remainingSeconds())
            state.heartbeat = now
            // A disappeared keyboard cannot leave a segment recording or insert later.
            if let active {
                let lease = try mailbox.lease(active.contextID)
                if lease == nil || !VoiceProtocol.fresh(lease!.updatedAt, now: now, ttl: VoiceProtocol.heartbeatTTL) {
                    cancelSegment("输入目标已离开，当前分段已取消。")
                }
            }
            for command in try mailbox.pendingCommands() {
                defer { try? mailbox.acknowledge(command) }
                let lease = try mailbox.lease(command.contextID)
                guard commandGate.accept(command, state: state, lease: lease, now: now) else { continue }
                handle(command)
                if state.phase == .off { return }
            }
            if let deadline = segmentDeadline, deadline.isExpired() { finishSegment() }
            if let deadline = processingDeadline, deadline.isExpired() {
                complete(text: nil, error: "本机识别超时；本段未插入，请重新说话。")
            }
            state.heartbeat = Date()
            try mailbox.publish(state)
            try mailbox.prune(now: now)
        } catch {
            stopSession("共享文件通信失败，已停止录音；请重新开启会话。")
        }
    }

    private func handle(_ command: VoiceCommand) {
        switch command.action {
        case .start:
            guard active == nil, state.phase == .ready else { return }
            beginSegment(command)
        case .finish:
            guard matchesActive(command), state.phase == .recording else { return }
            finishSegment()
        case .cancel:
            guard matchesActive(command) else { return }
            cancelSegment("本段已取消，麦克风会话仍然开启。")
        case .stopSession: stopSession()
        }
    }

    private func matchesActive(_ command: VoiceCommand) -> Bool {
        active?.sessionID == command.sessionID && active?.contextID == command.contextID
            && active?.requestID == command.requestID
    }

    private func beginSegment(_ command: VoiceCommand) {
        guard let recognizer, recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            active = command
            complete(text: nil, error: "本机识别不可用；未调用云端。")
            return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        request.taskHint = .dictation
        active = command
        state.phase = .recording
        state.requestID = command.requestID
        state.contextID = command.contextID
        state.message = "正在记录本段；45 秒自动结束本段，或点完成。"
        segmentDeadline = LocalDeadline(seconds: VoiceProtocol.segmentLimit)
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.matchesActive(command), self.state.sessionID == command.sessionID else { return }
                if let result, result.isFinal {
                    self.complete(text: result.bestTranscription.formattedString, error: nil)
                } else if error != nil {
                    self.complete(text: nil, error: "本机识别失败；本段未插入，也未上传云端。")
                }
            }
        }
        gate.begin(request)
    }

    private func finishSegment() {
        guard active != nil, state.phase == .recording else { return }
        gate.end() // Engine remains live for the explicitly enabled session.
        state.phase = .processing
        state.message = "本机识别中；麦克风会话仍开启。"
        segmentDeadline = nil
        processingDeadline = LocalDeadline(seconds: VoiceProtocol.recognitionTimeout)
    }

    private func cancelSegment(_ message: String) {
        gate.end()
        active = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        segmentDeadline = nil
        processingDeadline = nil
        state.phase = .ready
        state.requestID = nil
        state.contextID = nil
        state.message = message
    }

    private func complete(text: String?, error: String?) {
        guard let command = active, let sessionID = state.sessionID else { return }
        let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        let message = error ?? ((trimmed?.isEmpty ?? true) ? "未识别到文字，请重试。" : nil)
        let result = VoiceResult(sessionID: sessionID, contextID: command.contextID,
                                 requestID: command.requestID, createdAt: Date(),
                                 text: message == nil ? trimmed : nil, error: message)
        cancelSegment(message ?? "本段识别完成；会话继续监听。")
        do {
            try mailbox?.publish(result)
            try mailbox?.publish(state)
        } catch { stopSession("无法保存本段结果，已停止会话。") }
    }

    private enum SessionError: Error { case noInput }
}
