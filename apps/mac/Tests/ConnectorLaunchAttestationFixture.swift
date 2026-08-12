import Darwin
import Foundation
import Security

private enum FixtureFailure: Error {
    case assertion(String)
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw FixtureFailure.assertion(message) }
}

private struct FixtureSigningLabels {
    let staticCode: SecStaticCode
    let teamIdentifier: String?
    let bundleIdentifier: String
}

private struct FixtureArtifact {
    let identity: HermesConnectorLaunchIdentity
    let requirement: SecRequirement
}

private struct SuspendedChild {
    let pid: pid_t
    let outputFD: Int32
}

@main
struct ConnectorLaunchAttestationFixture {
    private static let nativeTimeoutNanoseconds: UInt64 = 5_000_000_000
    private static let injectedPollNanoseconds: UInt64 = 10_000_000

    static func main() throws {
        try injectedAttestationFailureWritesNoStdin()
        try injectedResumeFailureCleansUp()
        try injectedTimeoutEscalates()
        try injectedCleanupErrorsStayBounded()
        try positiveSuspendedAttestation()
        try replacementIsKilledBeforeResume()
        try closeOnExecDefaultRejectsUnrelatedDescriptor()
        print("macOS suspended connector launch attestation passed")
    }

    private static func injectedAttestationFailureWritesNoStdin() throws {
        let child = pid_t(41)
        var events: [String] = []
        let operations = HermesSuspendedChildOperations(
            signal: { pid, signal in
                events.append(signal == SIGKILL ? "kill" : "unexpected-signal")
                return HermesChildSignalCallResult(
                    result: pid == child && signal == SIGKILL ? 0 : -1,
                    error: pid == child && signal == SIGKILL ? 0 : EINVAL
                )
            },
            wait: { pid, options in
                events.append("wait")
                return HermesChildWaitCallResult(
                    result: pid == child && options == WNOHANG ? child : -1,
                    status: SIGKILL,
                    error: pid == child && options == WNOHANG ? 0 : EINVAL
                )
            },
            now: { 0 },
            sleep: { _ in }
        )

        do {
            _ = try HermesSuspendedChildLifecycle.run(
                spawnSuspended: { events.append("spawn"); return child },
                attest: { _ in
                    events.append("attest")
                    throw HermesConnectorAttestationError.invalidIdentity
                },
                startIO: { events.append("stdin") },
                timeoutNanoseconds: injectedPollNanoseconds,
                operations: operations,
                terminationGraceNanoseconds: injectedPollNanoseconds,
                cleanupTimeoutNanoseconds: injectedPollNanoseconds
            )
            throw FixtureFailure.assertion("attestation failure unexpectedly succeeded")
        } catch let error as HermesSuspendedChildLifecycleError {
            try require(error == .attestationFailed, "attestation failure was not preserved")
        }
        try require(events == ["spawn", "attest", "kill", "wait"],
                    "attestation failure reached stdin or skipped cleanup")
    }

    private static func injectedResumeFailureCleansUp() throws {
        let child = pid_t(42)
        var events: [String] = []
        let operations = HermesSuspendedChildOperations(
            signal: { _, signal in
                if signal == SIGCONT {
                    events.append("resume")
                    return HermesChildSignalCallResult(result: -1, error: EPERM)
                }
                events.append(signal == SIGKILL ? "kill" : "unexpected-signal")
                return HermesChildSignalCallResult(
                    result: signal == SIGKILL ? 0 : -1,
                    error: signal == SIGKILL ? 0 : EINVAL
                )
            },
            wait: { _, _ in
                events.append("wait")
                return HermesChildWaitCallResult(result: child, status: SIGKILL, error: 0)
            },
            now: { 0 },
            sleep: { _ in }
        )

        do {
            _ = try HermesSuspendedChildLifecycle.run(
                spawnSuspended: { events.append("spawn"); return child },
                attest: { _ in events.append("attest") },
                startIO: { events.append("stdin") },
                timeoutNanoseconds: injectedPollNanoseconds,
                operations: operations,
                terminationGraceNanoseconds: injectedPollNanoseconds,
                cleanupTimeoutNanoseconds: injectedPollNanoseconds
            )
            throw FixtureFailure.assertion("resume failure unexpectedly succeeded")
        } catch let error as HermesSuspendedChildLifecycleError {
            try require(error == .resumeFailed, "resume failure was not preserved")
        }
        try require(events == ["spawn", "attest", "resume", "kill", "wait"],
                    "resume failure reached stdin or skipped cleanup")
    }

    private static func injectedTimeoutEscalates() throws {
        let child = pid_t(43)
        var now: UInt64 = 0
        var signals: [Int32] = []
        var waitCalls = 0
        var stdinStarts = 0
        let operations = HermesSuspendedChildOperations(
            signal: { _, signal in
                signals.append(signal)
                return HermesChildSignalCallResult(result: 0, error: 0)
            },
            wait: { _, _ in
                waitCalls += 1
                if signals.last == SIGKILL {
                    return HermesChildWaitCallResult(result: child, status: SIGKILL, error: 0)
                }
                return HermesChildWaitCallResult(result: 0, status: 0, error: 0)
            },
            now: { now },
            sleep: { microseconds in
                now += UInt64(microseconds) * 1_000
            }
        )

        let outcome = try HermesSuspendedChildLifecycle.run(
            spawnSuspended: { child },
            attest: { _ in },
            startIO: { stdinStarts += 1 },
            timeoutNanoseconds: 2 * injectedPollNanoseconds,
            operations: operations,
            terminationGraceNanoseconds: injectedPollNanoseconds,
            cleanupTimeoutNanoseconds: injectedPollNanoseconds
        )
        try require(outcome.timedOut, "timeout did not return a timed-out outcome")
        try require(stdinStarts == 1, "verified child did not start I/O exactly once")
        try require(signals == [SIGCONT, SIGTERM, SIGKILL],
                    "timeout did not resume, terminate, then kill")
        try require(waitCalls <= 6, "timeout cleanup exceeded its injected bound")
    }

    private static func injectedCleanupErrorsStayBounded() throws {
        try injectedFailedKillStaysBounded()
        try injectedInterruptedWaitReachesECHILD()
        try injectedUnexpectedWaitFailsCleanup()
    }

    private static func injectedFailedKillStaysBounded() throws {
        let child = pid_t(44)
        var now: UInt64 = 0
        var waitCalls = 0
        var stdinStarts = 0
        let operations = HermesSuspendedChildOperations(
            signal: { _, signal in
                HermesChildSignalCallResult(
                    result: signal == SIGKILL ? -1 : 0,
                    error: signal == SIGKILL ? EPERM : 0
                )
            },
            wait: { _, _ in
                waitCalls += 1
                return HermesChildWaitCallResult(result: 0, status: 0, error: 0)
            },
            now: { now },
            sleep: { microseconds in now += UInt64(microseconds) * 1_000 }
        )

        do {
            _ = try HermesSuspendedChildLifecycle.run(
                spawnSuspended: { child },
                attest: { _ in throw HermesConnectorAttestationError.invalidIdentity },
                startIO: { stdinStarts += 1 },
                timeoutNanoseconds: injectedPollNanoseconds,
                operations: operations,
                terminationGraceNanoseconds: injectedPollNanoseconds,
                cleanupTimeoutNanoseconds: 2 * injectedPollNanoseconds
            )
            throw FixtureFailure.assertion("failed SIGKILL unexpectedly cleaned up")
        } catch let error as HermesSuspendedChildLifecycleError {
            try require(error == .cleanupFailed, "failed SIGKILL was not surfaced")
        }
        try require(stdinStarts == 0, "failed attestation wrote stdin")
        try require(waitCalls <= 3, "failed SIGKILL entered an unbounded wait")
    }

    private static func injectedInterruptedWaitReachesECHILD() throws {
        let child = pid_t(45)
        var waitCalls = 0
        var now: UInt64 = 0
        let operations = HermesSuspendedChildOperations(
            signal: { _, signal in
                HermesChildSignalCallResult(
                    result: signal == SIGKILL ? -1 : 0,
                    error: signal == SIGKILL ? ESRCH : 0
                )
            },
            wait: { _, _ in
                waitCalls += 1
                if waitCalls == 1 {
                    return HermesChildWaitCallResult(result: -1, status: 0, error: EINTR)
                }
                return HermesChildWaitCallResult(result: -1, status: 0, error: ECHILD)
            },
            now: { now },
            sleep: { microseconds in now += UInt64(microseconds) * 1_000 }
        )

        do {
            _ = try HermesSuspendedChildLifecycle.run(
                spawnSuspended: { child },
                attest: { _ in throw HermesConnectorAttestationError.invalidIdentity },
                startIO: {},
                timeoutNanoseconds: injectedPollNanoseconds,
                operations: operations,
                terminationGraceNanoseconds: injectedPollNanoseconds,
                cleanupTimeoutNanoseconds: 3 * injectedPollNanoseconds
            )
            throw FixtureFailure.assertion("attestation failure unexpectedly succeeded")
        } catch let error as HermesSuspendedChildLifecycleError {
            try require(error == .attestationFailed, "EINTR/ECHILD cleanup lost root failure")
        }
        try require(waitCalls == 2, "waitpid did not retry EINTR exactly once")
    }

    private static func injectedUnexpectedWaitFailsCleanup() throws {
        let child = pid_t(46)
        var waitCalls = 0
        let operations = HermesSuspendedChildOperations(
            signal: { _, _ in HermesChildSignalCallResult(result: 0, error: 0) },
            wait: { _, _ in
                waitCalls += 1
                return HermesChildWaitCallResult(result: -1, status: 0, error: EIO)
            },
            now: { 0 },
            sleep: { _ in }
        )

        do {
            _ = try HermesSuspendedChildLifecycle.run(
                spawnSuspended: { child },
                attest: { _ in throw HermesConnectorAttestationError.invalidIdentity },
                startIO: {},
                timeoutNanoseconds: injectedPollNanoseconds,
                operations: operations,
                terminationGraceNanoseconds: injectedPollNanoseconds,
                cleanupTimeoutNanoseconds: injectedPollNanoseconds
            )
            throw FixtureFailure.assertion("unexpected wait error was accepted")
        } catch let error as HermesSuspendedChildLifecycleError {
            try require(error == .cleanupFailed, "unexpected wait error was not surfaced")
        }
        try require(waitCalls == 1, "unexpected wait error was retried")
    }

    private static func positiveSuspendedAttestation() throws {
        let root = try makePrivateRoot(label: "positive")
        defer { try? FileManager.default.removeItem(at: root) }
        let candidate = try copyCandidate(from: "/bin/echo", named: "candidate", into: root)
        let artifact = try fixtureArtifact(at: candidate)
        var child: SuspendedChild?
        defer { if let child { _ = Darwin.close(child.outputFD) } }

        let outcome = try HermesSuspendedChildLifecycle.run(
            spawnSuspended: {
                let spawned = try spawnSuspended(executable: candidate, arguments: [])
                child = spawned
                return spawned.pid
            },
            attest: { pid in
                try HermesConnectorCodeAttestor.attestSuspendedChild(
                    pid: pid,
                    expected: artifact.identity,
                    requirement: artifact.requirement
                )
            },
            startIO: {},
            timeoutNanoseconds: nativeTimeoutNanoseconds
        )
        try require(!outcome.timedOut && exitedSuccessfully(outcome.status),
                    "positive child failed")
        guard let child else { throw FixtureFailure.assertion("positive child was not spawned") }
        let output = try readAll(from: child.outputFD)
        try require(output == Data("\n".utf8), "positive child output was not exactly one newline")
    }

    private static func replacementIsKilledBeforeResume() throws {
        let root = try makePrivateRoot(label: "replacement")
        defer { try? FileManager.default.removeItem(at: root) }
        let candidate = try copyCandidate(from: "/usr/bin/false", named: "candidate", into: root)
        let artifact = try fixtureArtifact(at: candidate)
        let replacement = try copyCandidate(from: "/bin/echo", named: "replacement", into: root)
        try require(
            Darwin.rename(replacement.path, candidate.path) == 0,
            "candidate replacement was not atomic"
        )

        var child: SuspendedChild?
        var stdinStarted = false
        defer { if let child { _ = Darwin.close(child.outputFD) } }
        do {
            _ = try HermesSuspendedChildLifecycle.run(
                spawnSuspended: {
                    let spawned = try spawnSuspended(executable: candidate, arguments: [])
                    child = spawned
                    return spawned.pid
                },
                attest: { pid in
                    try HermesConnectorCodeAttestor.attestSuspendedChild(
                        pid: pid,
                        expected: artifact.identity,
                        requirement: artifact.requirement
                    )
                },
                startIO: { stdinStarted = true },
                timeoutNanoseconds: nativeTimeoutNanoseconds
            )
            throw FixtureFailure.assertion("replacement child passed attestation")
        } catch let error as HermesSuspendedChildLifecycleError {
            try require(error == .attestationFailed, "replacement failure was not attestation")
        }
        try require(!stdinStarted, "replacement child reached stdin")
        guard let child else { throw FixtureFailure.assertion("replacement child was not spawned") }
        let output = try readAll(from: child.outputFD)
        try require(output.isEmpty, "replacement child wrote output before attestation")
    }

    private static func closeOnExecDefaultRejectsUnrelatedDescriptor() throws {
        let root = try makePrivateRoot(label: "cloexec")
        defer { try? FileManager.default.removeItem(at: root) }
        let unrelated = root.appendingPathComponent("unrelated")
        try Data("unrelated".utf8).write(to: unrelated)
        let unrelatedFD = Darwin.open(unrelated.path, O_RDONLY | O_NOFOLLOW)
        try require(unrelatedFD >= 0, "unrelated descriptor did not open")
        defer { _ = Darwin.close(unrelatedFD) }

        let candidate = try copyCandidate(from: "/bin/sh", named: "candidate", into: root)
        let artifact = try fixtureArtifact(at: candidate)
        var child: SuspendedChild?
        defer { if let child { _ = Darwin.close(child.outputFD) } }
        let outcome = try HermesSuspendedChildLifecycle.run(
            spawnSuspended: {
                let spawned = try spawnSuspended(
                    executable: candidate,
                    arguments: ["-c", "test ! -e /dev/fd/\(unrelatedFD)"]
                )
                child = spawned
                return spawned.pid
            },
            attest: { pid in
                try HermesConnectorCodeAttestor.attestSuspendedChild(
                    pid: pid,
                    expected: artifact.identity,
                    requirement: artifact.requirement
                )
            },
            startIO: {},
            timeoutNanoseconds: nativeTimeoutNanoseconds
        )
        try require(!outcome.timedOut && exitedSuccessfully(outcome.status),
                    "unrelated descriptor entered the child")
    }

    private static func makePrivateRoot(label: String) throws -> URL {
        let base = URL(
            fileURLWithPath: ProcessInfo.processInfo.environment["RUNNER_TEMP"]
                ?? NSTemporaryDirectory(),
            isDirectory: true
        )
        let root = base.appendingPathComponent(
            "connector-launch-attestation-\(label)-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        return root
    }

    private static func copyCandidate(
        from sourcePath: String,
        named name: String,
        into root: URL
    ) throws -> URL {
        let destination = root.appendingPathComponent(name)
        try FileManager.default.copyItem(
            at: URL(fileURLWithPath: sourcePath),
            to: destination
        )
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: destination.path)
        return destination
    }

    private static func signingLabels(at executable: URL) throws -> FixtureSigningLabels {
        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(
            executable as CFURL,
            SecCSFlags(),
            &staticCode
        ) == errSecSuccess, let staticCode else {
            throw FixtureFailure.assertion("fixture static code could not be created")
        }
        var signingInformation: CFDictionary?
        guard SecCodeCopySigningInformation(
            staticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &signingInformation
        ) == errSecSuccess,
              let information = signingInformation as? [String: Any],
              let bundleIdentifier = information[kSecCodeInfoIdentifier as String] as? String,
              !bundleIdentifier.isEmpty else {
            throw FixtureFailure.assertion("fixture signing labels were unavailable")
        }
        return FixtureSigningLabels(
            staticCode: staticCode,
            teamIdentifier: information[kSecCodeInfoTeamIdentifier as String] as? String,
            bundleIdentifier: bundleIdentifier
        )
    }

    private static func fixtureArtifact(at executable: URL) throws -> FixtureArtifact {
        let labels = try signingLabels(at: executable)
        var requirement: SecRequirement?
        guard SecCodeCopyDesignatedRequirement(
            labels.staticCode,
            SecCSFlags(),
            &requirement
        ) == errSecSuccess, let requirement else {
            throw FixtureFailure.assertion("fixture designated requirement was unavailable")
        }
        let validityFlags = SecCSFlags(rawValue:
            kSecCSStrictValidate | kSecCSCheckAllArchitectures | kSecCSCheckNestedCode
        )
        guard SecStaticCodeCheckValidity(
            labels.staticCode,
            validityFlags,
            requirement
        ) == errSecSuccess else {
            throw FixtureFailure.assertion("fixture static code was invalid")
        }
        let identity = try HermesConnectorCodeAttestor.captureExpectedIdentity(
            staticCode: labels.staticCode,
            expectedTeamID: labels.teamIdentifier,
            expectedBundleID: labels.bundleIdentifier
        )
        return FixtureArtifact(identity: identity, requirement: requirement)
    }

    private static func spawnSuspended(executable: URL, arguments: [String]) throws -> SuspendedChild {
        var output = [Int32](repeating: -1, count: 2)
        guard output.withUnsafeMutableBufferPointer({ Darwin.pipe($0.baseAddress!) }) == 0 else {
            throw FixtureFailure.assertion("output pipe could not be created")
        }
        defer { output.filter { $0 >= 0 }.forEach { _ = Darwin.close($0) } }

        var actions: posix_spawn_file_actions_t? = nil
        guard posix_spawn_file_actions_init(&actions) == 0 else {
            throw FixtureFailure.assertion("spawn file actions could not be initialized")
        }
        defer { posix_spawn_file_actions_destroy(&actions) }
        guard posix_spawn_file_actions_adddup2(&actions, output[1], STDOUT_FILENO) == 0,
              posix_spawn_file_actions_addclose(&actions, output[0]) == 0,
              posix_spawn_file_actions_addclose(&actions, output[1]) == 0 else {
            throw FixtureFailure.assertion("spawn file actions could not be configured")
        }

        var attributes: posix_spawnattr_t? = nil
        guard posix_spawnattr_init(&attributes) == 0 else {
            throw FixtureFailure.assertion("spawn attributes could not be initialized")
        }
        defer { posix_spawnattr_destroy(&attributes) }
        let flags = POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_START_SUSPENDED
        guard posix_spawnattr_setflags(&attributes, Int16(flags)) == 0 else {
            throw FixtureFailure.assertion("spawn attributes could not be configured")
        }

        var argv: [UnsafeMutablePointer<CChar>?] = ([executable.path] + arguments).map {
            strdup($0)
        } + [nil]
        var environment: [UnsafeMutablePointer<CChar>?] = [nil]
        defer { argv.compactMap { $0 }.forEach { free($0) } }
        var child = pid_t()
        let result = executable.path.withCString { path in
            argv.withUnsafeMutableBufferPointer { argvBuffer in
                environment.withUnsafeMutableBufferPointer { environmentBuffer in
                    posix_spawn(
                        &child,
                        path,
                        &actions,
                        &attributes,
                        argvBuffer.baseAddress,
                        environmentBuffer.baseAddress
                    )
                }
            }
        }
        guard result == 0 else {
            throw FixtureFailure.assertion(
                "suspended spawn failed: \(result) \(String(cString: strerror(result)))"
            )
        }
        _ = Darwin.close(output[1])
        output[1] = -1
        let outputFD = output[0]
        output[0] = -1
        return SuspendedChild(pid: child, outputFD: outputFD)
    }

    private static func readAll(from descriptor: Int32) throws -> Data {
        try FileHandle(fileDescriptor: descriptor, closeOnDealloc: false).readToEnd() ?? Data()
    }

    private static func exitedSuccessfully(_ status: Int32) -> Bool {
        status & 0x7f == 0 && (status >> 8) & 0xff == 0
    }
}
