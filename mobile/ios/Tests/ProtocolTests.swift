import XCTest
@testable import InkVoiceProtocol

final class ProtocolTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func fixture() -> (VoiceState, KeyboardLease, VoiceCommand) {
        let session = UUID(), context = UUID()
        return (
            VoiceState(sessionID: session, expiresAt: now.addingTimeInterval(300), heartbeat: now,
                       phase: .ready, message: "synthetic"),
            KeyboardLease(contextID: context, documentID: UUID(), updatedAt: now),
            VoiceCommand(id: UUID(), sessionID: session, contextID: context, requestID: UUID(),
                         sequence: 1, action: .start, createdAt: now)
        )
    }

    func testLiveSessionRequiresFreshHeartbeatAndUnexpiredSession() {
        var (state, _, _) = fixture()
        XCTAssertTrue(state.isLive(now: now))
        XCTAssertFalse(state.isLive(now: now.addingTimeInterval(3.1)))
        state.heartbeat = now.addingTimeInterval(300)
        XCTAssertFalse(state.isLive(now: now.addingTimeInterval(300)))
        XCTAssertFalse(VoiceState.off("synthetic").isLive(now: now))
    }

    func testClockRollbackDoesNotExtendAuthorization() {
        let (state, _, _) = fixture()
        XCTAssertFalse(state.isLive(now: now.addingTimeInterval(-1)))
    }

    func testLocalDeadlineHasAnExactMonotonicBoundary() {
        let start = ContinuousClock.now
        let deadline = LocalDeadline(seconds: 300, now: start)
        XCTAssertFalse(deadline.isExpired(now: start.advanced(by: .seconds(299))))
        XCTAssertTrue(deadline.isExpired(now: start.advanced(by: .seconds(300))))
        XCTAssertEqual(deadline.remainingSeconds(now: start.advanced(by: .seconds(120))), 180, accuracy: 0.001)
        XCTAssertEqual(deadline.remainingSeconds(now: start.advanced(by: .seconds(301))), 0)
    }

    func testDuplicateCommandCannotRunTwice() {
        let (state, lease, command) = fixture()
        var gate = CommandGate()
        XCTAssertTrue(gate.accept(command, state: state, lease: lease, now: now))
        XCTAssertFalse(gate.accept(command, state: state, lease: lease, now: now))
    }

    func testOlderSequenceCannotOverrideNewCommand() {
        let (state, lease, first) = fixture()
        let later = VoiceCommand(id: UUID(), sessionID: first.sessionID, contextID: first.contextID,
            requestID: first.requestID, sequence: 2, action: .cancel, createdAt: now)
        var gate = CommandGate()
        XCTAssertTrue(gate.accept(later, state: state, lease: lease, now: now))
        XCTAssertFalse(gate.accept(first, state: state, lease: lease, now: now))
    }

    func testOldSessionAndMissingContextLeaseAreRejected() {
        var (state, lease, command) = fixture()
        var gate = CommandGate()
        XCTAssertFalse(gate.accept(command, state: state, lease: nil, now: now))
        state.sessionID = UUID()
        XCTAssertFalse(gate.accept(command, state: state, lease: lease, now: now))
    }

    func testExpiredLeaseAndCommandAreRejected() {
        let (state, lease, command) = fixture()
        let staleLease = KeyboardLease(contextID: lease.contextID, documentID: lease.documentID,
                                       updatedAt: now.addingTimeInterval(-4))
        let staleCommand = VoiceCommand(id: UUID(), sessionID: command.sessionID, contextID: command.contextID,
            requestID: command.requestID, sequence: 1, action: .start, createdAt: now.addingTimeInterval(-11))
        var gate = CommandGate()
        XCTAssertFalse(gate.accept(command, state: state, lease: staleLease, now: now))
        XCTAssertFalse(gate.accept(staleCommand, state: state, lease: lease, now: now))
    }

    func testResultCannotBeInsertedInNewContextOrRequest() throws {
        let (_, _, command) = fixture()
        let result = VoiceResult(sessionID: command.sessionID, contextID: command.contextID,
            requestID: command.requestID, createdAt: now, text: "Synthetic test.", error: nil)
        XCTAssertTrue(result.matches(session: command.sessionID, context: command.contextID,
                                     request: command.requestID, now: now))
        XCTAssertFalse(result.matches(session: command.sessionID, context: UUID(), request: command.requestID, now: now))
        XCTAssertFalse(result.matches(session: command.sessionID, context: command.contextID, request: UUID(), now: now))
        XCTAssertFalse(result.matches(session: UUID(), context: command.contextID, request: command.requestID, now: now))
        XCTAssertFalse(result.matches(session: command.sessionID, context: command.contextID,
                                      request: command.requestID, now: now.addingTimeInterval(61)))
        let roundTrip = try JSONDecoder().decode(VoiceResult.self, from: JSONEncoder().encode(result))
        XCTAssertEqual(roundTrip.text, "Synthetic test.")
    }

    func testFullCommandIdentitySurvivesMailboxEncoding() throws {
        let (_, _, command) = fixture()
        let decoded = try JSONDecoder().decode(VoiceCommand.self, from: JSONEncoder().encode(command))
        XCTAssertEqual(decoded.id, command.id)
        XCTAssertEqual(decoded.sessionID, command.sessionID)
        XCTAssertEqual(decoded.contextID, command.contextID)
        XCTAssertEqual(decoded.requestID, command.requestID)
        XCTAssertEqual(decoded.action, .start)
    }
}
