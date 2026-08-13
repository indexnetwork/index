import Foundation
import WebKit

private enum FixtureFailure: Error { case assertion(String) }
private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw FixtureFailure.assertion(message) }
}

@main
enum NativeAPIQuarantineFixture {
    static func main() throws {
        let now = Date()
        let record = OwnerCredentialRecord(
            credential: "fixture-owner-key", credentialId: "credential-1",
            expiresAt: now.addingTimeInterval(600)
        )
        var ordering: [String] = []
        let bridge = NativeAPIRequestBridge(
            apiBaseURL: URL(string: "https://api.example.test/api")!,
            mcpURL: URL(string: "https://api.example.test/mcp")!,
            credentialProvider: { record }, trustedMessage: { _ in true },
            terminal: { ordering.append("terminal:\($0.requestId)") }, event: { _ in }
        )
        let session = URLSession(configuration: .ephemeral)
        let mutation = session.dataTask(with: URL(string: "https://api.example.test/api/intents/confirm")!)
        let stream = session.dataTask(with: URL(string: "https://api.example.test/api/chat/stream")!)
        try require(bridge.registerTaskForFixture(mutation, requestId: "mutation"), "mutation registration failed")
        try require(bridge.registerTaskForFixture(stream, requestId: "stream"), "SSE registration failed")

        bridge.beginQuarantine { ordering.append("drain") }
        try require(!ordering.contains("drain"), "logout revoked before active requests drained")
        let late = session.dataTask(with: URL(string: "https://api.example.test/api/networks")!)
        try require(!bridge.registerTaskForFixture(late, requestId: "late"), "quarantine admitted a new request")

        bridge.finishTaskForFixture(requestId: "mutation")
        try require(ordering == ["terminal:mutation"], "mutation terminal did not precede drain")
        bridge.finishTaskForFixture(requestId: "stream")
        try require(ordering == ["terminal:mutation", "terminal:stream", "drain"], "SSE terminal did not precede revoke drain")

        try bridge.endQuarantineAfterCredentialReadBack()
        let afterReadBack = session.dataTask(with: URL(string: "https://api.example.test/api/auth/me")!)
        try require(bridge.registerTaskForFixture(afterReadBack, requestId: "after-readback"), "verified activation did not reopen quarantine")
        bridge.finishTaskForFixture(requestId: "after-readback")
    }
}
