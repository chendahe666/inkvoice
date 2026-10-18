import UIKit

final class KeyboardViewController: UIInputViewController {
    private var mailbox: Mailbox?
    private var observer: MailboxObserver?
    private var timer: Timer?
    private var visible = false
    private var contextID = UUID()
    private var sequence = 0
    private var snapshot: DocumentSnapshot?
    private var lastState: VoiceState?
    private var pending: Pending?
    private var inserting = false
    private var localMessage: String?
    private let status = UILabel()
    private let speak = UIButton(type: .system)
    private let cancel = UIButton(type: .system)
    private let endSession = UIButton(type: .system)

    private struct DocumentSnapshot: Equatable {
        let id: UUID
        let before: String?
        let after: String?
        let selected: String?
    }
    private struct Pending {
        let session: UUID
        let request: UUID
        let confirmationDeadline = LocalDeadline(seconds: 4)
        let overallDeadline = LocalDeadline(seconds: 65)
        var acknowledged = false
        var finishing = false
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .secondarySystemBackground
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8),
            view.heightAnchor.constraint(greaterThanOrEqualToConstant: 286)
        ])
        status.font = .preferredFont(forTextStyle: .caption1)
        status.numberOfLines = 3
        status.accessibilityTraits.insert(.updatesFrequently)
        stack.addArrangedSubview(status)
        speak.setTitle("开始说话", for: .normal)
        speak.addTarget(self, action: #selector(toggleDictation), for: .touchUpInside)
        cancel.setTitle("取消本段", for: .normal)
        cancel.addTarget(self, action: #selector(cancelDictation), for: .touchUpInside)
        endSession.setTitle("停止会话", for: .normal)
        endSession.addTarget(self, action: #selector(stopSession), for: .touchUpInside)
        stack.addArrangedSubview(row([speak, cancel, endSession]))
        // Basic typed input works even when Full Access is off or speech is unavailable.
        for letters in ["qwertyuiop", "asdfghjkl", "zxcvbnm"] {
            stack.addArrangedSubview(row(letters.map { character in
                let button = key(String(character))
                button.addTarget(self, action: #selector(typeCharacter(_:)), for: .touchUpInside)
                return button
            }))
        }
        let next = key("🌐")
        next.accessibilityLabel = "切换键盘"
        next.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
        let space = key("空格")
        space.addTarget(self, action: #selector(insertSpace), for: .touchUpInside)
        let punctuation = key("，")
        punctuation.addTarget(self, action: #selector(typeCharacter(_:)), for: .touchUpInside)
        let delete = key("删除")
        delete.addTarget(self, action: #selector(deleteCharacter), for: .touchUpInside)
        let enter = key("回车")
        enter.addTarget(self, action: #selector(insertReturn), for: .touchUpInside)
        stack.addArrangedSubview(row([next, space, punctuation, delete, enter]))
        observer = MailboxObserver(name: VoiceProtocol.stateNotification) { [weak self] in self?.poll() }
        render()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        visible = true
        rotateContext()
        poll()
        timer?.invalidate()
        let heartbeatTimer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in self?.poll() }
        timer = heartbeatTimer
        RunLoop.main.add(heartbeatTimer, forMode: .common)
    }

    override func viewWillDisappear(_ animated: Bool) {
        visible = false
        timer?.invalidate()
        timer = nil
        abandonContext()
        super.viewWillDisappear(animated)
    }

    override func textWillChange(_ textInput: UITextInput?) {
        super.textWillChange(textInput)
        if !inserting { rotateContext() }
    }
    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        if !inserting, snapshot != currentDocument() { rotateContext() }
    }
    override func selectionWillChange(_ textInput: UITextInput?) {
        super.selectionWillChange(textInput)
        if !inserting { rotateContext() }
    }
    override func selectionDidChange(_ textInput: UITextInput?) {
        super.selectionDidChange(textInput)
        if !inserting, snapshot != currentDocument() { rotateContext() }
    }

    deinit { timer?.invalidate() }

    private func currentDocument() -> DocumentSnapshot {
        DocumentSnapshot(id: textDocumentProxy.documentIdentifier,
                         before: textDocumentProxy.documentContextBeforeInput,
                         after: textDocumentProxy.documentContextAfterInput,
                         selected: textDocumentProxy.selectedText)
    }

    private func abandonContext() {
        if let pending {
            try? send(.cancel, session: pending.session, request: pending.request)
            try? mailbox?.removeResult(pending.request)
            localMessage = "输入目标改变，本段已作废。"
        }
        self.pending = nil
        try? mailbox?.removeLease(contextID)
    }

    private func rotateContext() {
        abandonContext()
        contextID = UUID()
        sequence = 0
        snapshot = currentDocument()
    }

    private func poll() {
        guard visible else { return }
        guard hasFullAccess else {
            abandonContext()
            mailbox = nil
            lastState = nil
            localMessage = "普通打字可用。语音需在系统键盘设置允许完全访问，并手动打开 InkVoice 开启会话。"
            render()
            return
        }
        do {
            if mailbox == nil { mailbox = try Mailbox(); localMessage = nil }
            guard let mailbox else { return }
            if snapshot != currentDocument() { rotateContext() }
            try mailbox.publish(KeyboardLease(contextID: contextID,
                documentID: textDocumentProxy.documentIdentifier, updatedAt: Date()))
            let previousSession = lastState?.sessionID
            lastState = try mailbox.state()
            if previousSession != lastState?.sessionID, pending == nil { localMessage = nil }
            guard let state = lastState, state.isLive(now: Date()) else {
                if pending != nil { abandonContext() }
                localMessage = "会话未开启或已失效。请手动打开 InkVoice，开启 5 或 15 分钟后返回。"
                render()
                return
            }
            if var pending {
                guard pending.session == state.sessionID else {
                    abandonContext(); render(); return
                }
                if state.requestID == pending.request && state.contextID == contextID {
                    pending.acknowledged = true
                    self.pending = pending
                }
                if let result = try mailbox.result(pending.request) {
                    guard result.matches(session: pending.session, context: contextID,
                                         request: pending.request, now: Date()),
                          snapshot == currentDocument() else {
                        abandonContext(); render(); return
                    }
                    self.pending = nil // Consume identity before insertText can trigger callbacks.
                    try mailbox.removeResult(pending.request)
                    if let text = result.text, !text.isEmpty {
                        inserting = true
                        textDocumentProxy.insertText(text)
                        inserting = false
                        rotateContext()
                        localMessage = "已插入；麦克风会话仍开启。"
                    } else { localMessage = result.error ?? "本段未识别到文字。" }
                } else if (!pending.acknowledged && pending.confirmationDeadline.isExpired())
                            || pending.overallDeadline.isExpired() {
                    abandonContext()
                    localMessage = "本段未收到确认或已超时，已取消；请重新开始。"
                }
            }
            render()
        } catch {
            abandonContext()
            lastState = nil
            localMessage = "共享容器通信失败。请手动打开 InkVoice 检查会话与权限。"
            render()
        }
    }

    private func send(_ action: VoiceAction, session: UUID, request: UUID) throws {
        guard let mailbox else { throw MailboxError.unavailable }
        try mailbox.publish(KeyboardLease(contextID: contextID,
            documentID: textDocumentProxy.documentIdentifier, updatedAt: Date()))
        sequence += 1
        try mailbox.send(VoiceCommand(id: UUID(), sessionID: session, contextID: contextID,
                                     requestID: request, sequence: sequence, action: action, createdAt: Date()))
    }

    @objc private func toggleDictation() {
        poll()
        guard hasFullAccess, let state = lastState, state.isLive(now: Date()),
              let session = state.sessionID else { return }
        do {
            if var pending {
                guard !pending.finishing else { return }
                pending.finishing = true
                self.pending = pending
                try send(.finish, session: pending.session, request: pending.request)
                localMessage = "正在结束本段……"
            } else {
                guard state.phase == .ready else {
                    localMessage = "其他输入目标正在处理，请等待或停止整个会话。"
                    render(); return
                }
                rotateContext()
                try mailbox?.publish(KeyboardLease(contextID: contextID,
                    documentID: textDocumentProxy.documentIdentifier, updatedAt: Date()))
                let request = UUID()
                pending = Pending(session: session, request: request)
                try send(.start, session: session, request: request)
                localMessage = "等待主 App 确认开始；请看到“正在记录”后说话。"
            }
        } catch { abandonContext(); localMessage = "命令发送失败，请重试。" }
        render()
    }

    @objc private func cancelDictation() {
        if let pending {
            try? send(.cancel, session: pending.session, request: pending.request)
            try? mailbox?.removeResult(pending.request)
        }
        pending = nil
        localMessage = "本段已取消；麦克风会话仍开启。"
        render()
    }

    @objc private func stopSession() {
        guard let session = lastState?.sessionID else { return }
        do {
            try send(.stopSession, session: session, request: pending?.request ?? UUID())
            pending = nil
            localMessage = "已请求停止；等待主 App 确认麦克风释放。"
        } catch { localMessage = "停止请求失败；请手动打开主 App 点击停止。" }
        render()
    }

    private func render() {
        let live = hasFullAccess && (lastState?.isLive(now: Date()) ?? false)
        let ours = pending != nil && lastState?.requestID == pending?.request
            && lastState?.contextID == contextID
        if ours, let state = lastState { status.text = "● 麦克风会话开启 · " + state.message }
        else if let localMessage { status.text = localMessage }
        else if live { status.text = "● 麦克风持续监听；空闲音频丢弃。点开始说话记录本段。" }
        else { status.text = "请手动打开 InkVoice 开启语音会话，再返回此键盘。" }
        status.textColor = live ? .systemRed : .secondaryLabel
        speak.setTitle(pending == nil ? "开始说话" : "完成", for: .normal)
        speak.isEnabled = live && (pending == nil ? lastState?.phase == .ready : pending?.finishing == false)
        cancel.isEnabled = pending != nil
        endSession.isEnabled = live
    }

    private func row(_ buttons: [UIButton]) -> UIStackView {
        let row = UIStackView(arrangedSubviews: buttons)
        row.axis = .horizontal
        row.distribution = .fillEqually
        row.spacing = 5
        row.heightAnchor.constraint(equalToConstant: 38).isActive = true
        return row
    }
    private func key(_ text: String) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(text, for: .normal)
        button.backgroundColor = .tertiarySystemBackground
        button.layer.cornerRadius = 5
        button.titleLabel?.font = .systemFont(ofSize: 18)
        return button
    }
    private func type(_ text: String) {
        rotateContext()
        inserting = true
        textDocumentProxy.insertText(text)
        inserting = false
        snapshot = currentDocument()
    }
    @objc private func typeCharacter(_ sender: UIButton) { type(sender.title(for: .normal) ?? "") }
    @objc private func insertSpace() { type(" ") }
    @objc private func insertReturn() { type("\n") }
    @objc private func deleteCharacter() {
        rotateContext()
        inserting = true
        textDocumentProxy.deleteBackward()
        inserting = false
        snapshot = currentDocument()
    }
}
