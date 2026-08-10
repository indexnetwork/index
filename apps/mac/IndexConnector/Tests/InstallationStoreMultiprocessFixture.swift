import Foundation

private enum FixtureFailure: Error {
    case invalidArguments
    case timeout
    case staleWriteAccepted
    case childFailed(Int32)
}

private func waitForFiles(_ urls: [URL], timeout: TimeInterval = 10) throws {
    let deadline = Date().addingTimeInterval(timeout)
    while !urls.allSatisfy({ FileManager.default.fileExists(atPath: $0.path) }) {
        if Date() >= deadline { throw FixtureFailure.timeout }
        Thread.sleep(forTimeInterval: 0.01)
    }
}

private func runStaleChild() throws {
    guard CommandLine.arguments.count == 7 else { throw FixtureFailure.invalidArguments }
    let role = CommandLine.arguments[2]
    let base = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
    let ready = URL(fileURLWithPath: CommandLine.arguments[4])
    let release = URL(fileURLWithPath: CommandLine.arguments[5])
    let credential = URL(fileURLWithPath: CommandLine.arguments[6])
    let store = try ConnectorInstallationStore(baseDirectory: base)
    let expected = store.stateSnapshot
    try Data("ready".utf8).write(to: ready)
    try waitForFiles([release])

    var replacement = expected
    if role == "authorization" {
        replacement.authorizationAttemptId = UUID().uuidString.lowercased()
        replacement.operationEpoch = expected.operationEpoch + 1
    } else if role == "exchange" {
        replacement.authorizationAttemptId = nil
        replacement.recoveryPhase = .activationRequested
    } else {
        throw FixtureFailure.invalidArguments
    }
    if try store.compareAndSet(expected: expected, replacement: replacement) {
        // Models the credential installation that is allowed only after the
        // exchange journal CAS proves this process still owns the operation.
        try Data("post-disconnect credential".utf8).write(to: credential)
        throw FixtureFailure.staleWriteAccepted
    }
}

private func process(
    role: String,
    base: URL,
    ready: URL,
    release: URL,
    credential: URL
) throws -> Process {
    let child = Process()
    child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    child.arguments = ["--stale-child", role, base.path, ready.path, release.path, credential.path]
    child.standardOutput = FileHandle.nullDevice
    child.standardError = FileHandle.nullDevice
    try child.run()
    return child
}

@main
struct InstallationStoreMultiprocessFixture {
    static func main() throws {
        if CommandLine.arguments.dropFirst().first == "--stale-child" {
            try runStaleChild()
            return
        }

        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("connector-installation-cas-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }

        let first = try ConnectorInstallationStore(baseDirectory: root)
        let second = try ConnectorInstallationStore(baseDirectory: root)
        let initial = first.stateSnapshot
        precondition(second.stateSnapshot == initial)

        let readyAuthorization = root.appendingPathComponent("authorization.ready")
        let readyExchange = root.appendingPathComponent("exchange.ready")
        let release = root.appendingPathComponent("release")
        let authorizationCredential = root.appendingPathComponent("authorization.credential")
        let exchangeCredential = root.appendingPathComponent("exchange.credential")
        let authorization = try process(
            role: "authorization", base: root, ready: readyAuthorization,
            release: release, credential: authorizationCredential
        )
        let exchange = try process(
            role: "exchange", base: root, ready: readyExchange,
            release: release, credential: exchangeCredential
        )
        try waitForFiles([readyAuthorization, readyExchange])

        var disconnected = first.stateSnapshot
        disconnected.authorizationAttemptId = nil
        disconnected.recoveryPhase = .none
        disconnected.operationEpoch += 1
        let disconnectedAccepted = try first.compareAndSet(expected: initial, replacement: disconnected)
        precondition(disconnectedAccepted)
        // A second store must reread durable authority, never return its init cache.
        precondition(second.stateSnapshot == disconnected)
        let staleAccepted = try second.compareAndSet(expected: initial, replacement: initial)
        precondition(!staleAccepted)

        try Data("release".utf8).write(to: release)
        authorization.waitUntilExit()
        exchange.waitUntilExit()
        guard authorization.terminationStatus == 0 else {
            throw FixtureFailure.childFailed(authorization.terminationStatus)
        }
        guard exchange.terminationStatus == 0 else {
            throw FixtureFailure.childFailed(exchange.terminationStatus)
        }
        guard !FileManager.default.fileExists(atPath: authorizationCredential.path),
              !FileManager.default.fileExists(atPath: exchangeCredential.path) else {
            throw FixtureFailure.staleWriteAccepted
        }

        let durable = try ConnectorInstallationStore(baseDirectory: root).stateSnapshot
        precondition(durable == disconnected)
        print("Installation store multi-process CAS fixture passed")
    }
}
