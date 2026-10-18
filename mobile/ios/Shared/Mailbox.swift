import Foundation
import CoreFoundation

extension VoiceProtocol {
    static let commandNotification = "org.inkvoice.mobile.command" as CFString
    static let stateNotification = "org.inkvoice.mobile.state" as CFString
}

enum MailboxError: Error { case missingAppGroup, unavailable, oversized }

// Each command gets a new immutable file. Only the host writes state/results;
// each keyboard context writes its own lease. There is no shared RMW queue.
final class Mailbox {
    private let root: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let coordinator = NSFileCoordinator(filePresenter: nil)

    init() throws {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "InkVoiceAppGroup") as? String,
              !group.isEmpty else { throw MailboxError.missingAppGroup }
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
        else { throw MailboxError.unavailable }
        root = container.appendingPathComponent("VoiceMailbox", isDirectory: true)
        for folder in [root, root.appendingPathComponent("commands", isDirectory: true)] {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        }
        var excludedRoot = root
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try excludedRoot.setResourceValues(values)
    }

    private func read<T: Decodable>(_ type: T.Type, at url: URL) throws -> T? {
        var coordinationError: NSError?
        var outcome: Result<T?, Error> = .success(nil)
        coordinator.coordinate(readingItemAt: url, options: [], error: &coordinationError) { accessURL in
            outcome = Result {
                guard FileManager.default.fileExists(atPath: accessURL.path) else { return nil }
                let data = try Data(contentsOf: accessURL)
                guard data.count <= 128 * 1024 else { throw MailboxError.oversized }
                return try decoder.decode(type, from: data)
            }
        }
        if let coordinationError { throw coordinationError }
        return try outcome.get()
    }

    private func write<T: Encodable>(_ value: T, at url: URL) throws {
        let data = try encoder.encode(value)
        var coordinationError: NSError?
        var writeError: Error?
        coordinator.coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { accessURL in
            do {
                try data.write(to: accessURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            } catch { writeError = error }
        }
        if let coordinationError { throw coordinationError }
        if let writeError { throw writeError }
    }

    private func remove(_ url: URL) throws {
        var coordinationError: NSError?
        var removeError: Error?
        coordinator.coordinate(writingItemAt: url, options: .forDeleting, error: &coordinationError) { accessURL in
            do {
                if FileManager.default.fileExists(atPath: accessURL.path) {
                    try FileManager.default.removeItem(at: accessURL)
                }
            } catch { removeError = error }
        }
        if let coordinationError { throw coordinationError }
        if let removeError { throw removeError }
    }

    private func named(_ prefix: String, _ id: UUID) -> URL {
        root.appendingPathComponent("\(prefix)-\(id.uuidString).json")
    }

    func state() throws -> VoiceState? { try read(VoiceState.self, at: root.appendingPathComponent("state.json")) }
    func publish(_ state: VoiceState) throws {
        try write(state, at: root.appendingPathComponent("state.json"))
        Self.signal(VoiceProtocol.stateNotification)
    }
    func lease(_ context: UUID) throws -> KeyboardLease? { try read(KeyboardLease.self, at: named("lease", context)) }
    func publish(_ lease: KeyboardLease) throws { try write(lease, at: named("lease", lease.contextID)) }
    func removeLease(_ context: UUID) throws { try remove(named("lease", context)) }
    func result(_ request: UUID) throws -> VoiceResult? { try read(VoiceResult.self, at: named("result", request)) }
    func publish(_ result: VoiceResult) throws {
        try write(result, at: named("result", result.requestID))
        Self.signal(VoiceProtocol.stateNotification)
    }
    func removeResult(_ request: UUID) throws { try remove(named("result", request)) }
    func send(_ command: VoiceCommand) throws {
        try write(command, at: commandURL(command.id))
        Self.signal(VoiceProtocol.commandNotification)
    }
    private func commandURL(_ id: UUID) -> URL {
        root.appendingPathComponent("commands", isDirectory: true).appendingPathComponent("\(id.uuidString).json")
    }

    func pendingCommands() throws -> [VoiceCommand] {
        let directory = root.appendingPathComponent("commands", isDirectory: true)
        var error: NSError?
        var files: [URL] = []
        var listError: Error?
        coordinator.coordinate(readingItemAt: directory, options: [], error: &error) { url in
            do { files = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) }
            catch { listError = error }
        }
        if let error { throw error }
        if let listError { throw listError }
        var commands: [VoiceCommand] = []
        for file in files where file.pathExtension == "json" {
            do {
                if let command = try read(VoiceCommand.self, at: file),
                   file.deletingPathExtension().lastPathComponent == command.id.uuidString {
                    commands.append(command)
                } else { try remove(file) }
            } catch { try? remove(file) }
        }
        return commands.sorted {
            if $0.contextID == $1.contextID { return $0.sequence < $1.sequence }
            return $0.contextID.uuidString < $1.contextID.uuidString
        }
    }
    func acknowledge(_ command: VoiceCommand) throws { try remove(commandURL(command.id)) }

    // Called by the host, never by a keyboard. Old plaintext results have a short TTL.
    func prune(now: Date) throws {
        let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        for file in files {
            if file.lastPathComponent.hasPrefix("result-") {
                let result = try? read(VoiceResult.self, at: file)
                if result == nil || !VoiceProtocol.fresh(result!.createdAt, now: now, ttl: VoiceProtocol.resultTTL) {
                    try? remove(file)
                }
            } else if file.lastPathComponent.hasPrefix("lease-") {
                let lease = try? read(KeyboardLease.self, at: file)
                if lease == nil || !VoiceProtocol.fresh(lease!.updatedAt, now: now, ttl: 30) { try? remove(file) }
            }
        }
    }

    static func signal(_ name: CFString) {
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
                                             CFNotificationName(rawValue: name), nil, nil, true)
    }
}

// Darwin notifications carry no text and are hints, not a wake/launch guarantee.
// Polling and TTL checks remain authoritative if a notification is dropped.
final class MailboxObserver {
    private let name: CFString
    let callback: () -> Void
    init(name: CFString, callback: @escaping () -> Void) {
        self.name = name
        self.callback = callback
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(), { _, observer, _, _, _ in
                guard let observer else { return }
                let object = Unmanaged<MailboxObserver>.fromOpaque(observer).takeUnretainedValue()
                let callback = object.callback
                DispatchQueue.main.async(execute: callback)
            }, name, nil, .deliverImmediately)
    }
    deinit {
        CFNotificationCenterRemoveObserver(CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(), CFNotificationName(rawValue: name), nil)
    }
}
