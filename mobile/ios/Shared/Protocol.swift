import Foundation

// Process-local deadline only: never serialize an Instant across process launches.
// Unlike Date, ContinuousClock advances through sleep and cannot be set backwards.
struct LocalDeadline {
    let instant: ContinuousClock.Instant
    init(seconds: TimeInterval, now: ContinuousClock.Instant = .now) {
        instant = now.advanced(by: .seconds(seconds))
    }
    func isExpired(now: ContinuousClock.Instant = .now) -> Bool { now >= instant }
    func remainingSeconds(now: ContinuousClock.Instant = .now) -> TimeInterval {
        let components = now.duration(to: instant).components
        return max(0, Double(components.seconds) + Double(components.attoseconds) / 1e18)
    }
}

// No audio or surrounding document text crosses this mailbox.
enum VoiceProtocol {
    static let version = 1
    static let heartbeatTTL: TimeInterval = 3
    static let commandTTL: TimeInterval = 10
    static let resultTTL: TimeInterval = 60
    static let segmentLimit: TimeInterval = 45
    static let recognitionTimeout: TimeInterval = 15

    static func fresh(_ timestamp: Date, now: Date, ttl: TimeInterval) -> Bool {
        let age = now.timeIntervalSince(timestamp)
        return age >= 0 && age <= ttl
    }
}

enum VoiceAction: String, Codable { case start, finish, cancel, stopSession }
enum VoicePhase: String, Codable { case off, ready, recording, processing }

struct VoiceCommand: Codable {
    var version = VoiceProtocol.version
    let id: UUID
    let sessionID: UUID
    let contextID: UUID
    let requestID: UUID
    let sequence: Int
    let action: VoiceAction
    let createdAt: Date
}

struct KeyboardLease: Codable {
    var version = VoiceProtocol.version
    let contextID: UUID
    let documentID: UUID
    let updatedAt: Date
}

struct VoiceState: Codable {
    var version = VoiceProtocol.version
    var sessionID: UUID?
    var expiresAt: Date?
    var heartbeat: Date
    var phase: VoicePhase
    var requestID: UUID?
    var contextID: UUID?
    var message: String

    static func off(_ message: String) -> VoiceState {
        VoiceState(heartbeat: Date(), phase: .off, message: message)
    }

    func isLive(now: Date) -> Bool {
        version == VoiceProtocol.version && sessionID != nil && phase != .off
            && (expiresAt.map { $0 > now } ?? false)
            && VoiceProtocol.fresh(heartbeat, now: now, ttl: VoiceProtocol.heartbeatTTL)
    }
}

struct VoiceResult: Codable {
    var version = VoiceProtocol.version
    let sessionID: UUID
    let contextID: UUID
    let requestID: UUID
    let createdAt: Date
    let text: String?
    let error: String?

    func matches(session: UUID, context: UUID, request: UUID, now: Date) -> Bool {
        version == VoiceProtocol.version && sessionID == session && contextID == context
            && requestID == request
            && VoiceProtocol.fresh(createdAt, now: now, ttl: VoiceProtocol.resultTTL)
    }
}

// Host owns this reducer. File names and UUIDs alone are not permission to act.
struct CommandGate {
    private var seen = Set<UUID>()
    private var sequences: [UUID: Int] = [:]

    mutating func accept(_ command: VoiceCommand, state: VoiceState,
                         lease: KeyboardLease?, now: Date) -> Bool {
        guard state.isLive(now: now), command.version == VoiceProtocol.version,
              command.sessionID == state.sessionID, command.sequence > 0,
              !seen.contains(command.id),
              VoiceProtocol.fresh(command.createdAt, now: now, ttl: VoiceProtocol.commandTTL),
              let lease, lease.version == VoiceProtocol.version,
              lease.contextID == command.contextID,
              VoiceProtocol.fresh(lease.updatedAt, now: now, ttl: VoiceProtocol.heartbeatTTL),
              command.sequence > (sequences[command.contextID] ?? 0) else { return false }
        seen.insert(command.id)
        sequences[command.contextID] = command.sequence
        return true
    }
}
