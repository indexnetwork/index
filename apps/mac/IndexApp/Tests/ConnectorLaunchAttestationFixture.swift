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
    static func main() throws {
        try positiveSuspendedAttestation()
        try replacementIsKilledBeforeResume()
        try closeOnExecDefaultRejectsUnrelatedDescriptor()
        print("macOS suspended connector launch attestation passed")
    }

    private static func positiveSuspendedAttestation() throws {
        let root = try makePrivateRoot(label: "positive")
        defer { try? FileManager.default.removeItem(at: root) }
        let candidate = try copyCandidate(from: "/bin/echo", named: "candidate", into: root)
        let artifact = try fixtureArtifact(at: candidate)
        let child = try spawnSuspended(executable: candidate, arguments: [])
        var reaped = false
        defer {
            _ = Darwin.close(child.outputFD)
            if !reaped { try? killAndReap(child.pid) }
        }

        try HermesConnectorCodeAttestor.attestSuspendedChild(
            pid: child.pid,
            expected: artifact.identity,
            requirement: artifact.requirement
        )
        try require(Darwin.kill(child.pid, SIGCONT) == 0, "positive child did not resume")
        let status = try waitForChild(child.pid)
        reaped = true
        try require(exitedSuccessfully(status), "positive child failed")
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

        let child = try spawnSuspended(executable: candidate, arguments: [])
        var reaped = false
        defer {
            _ = Darwin.close(child.outputFD)
            if !reaped { try? killAndReap(child.pid) }
        }
        do {
            try HermesConnectorCodeAttestor.attestSuspendedChild(
                pid: child.pid,
                expected: artifact.identity,
                requirement: artifact.requirement
            )
            throw FixtureFailure.assertion("replacement child passed attestation")
        } catch HermesConnectorAttestationError.invalidIdentity {
            // The child remains suspended and receives no resume signal.
        }
        try killAndReap(child.pid)
        reaped = true
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
        let child = try spawnSuspended(
            executable: candidate,
            arguments: ["-c", "test ! -e /dev/fd/\(unrelatedFD)"]
        )
        var reaped = false
        defer {
            _ = Darwin.close(child.outputFD)
            if !reaped { try? killAndReap(child.pid) }
        }

        try HermesConnectorCodeAttestor.attestSuspendedChild(
            pid: child.pid,
            expected: artifact.identity,
            requirement: artifact.requirement
        )
        try require(Darwin.kill(child.pid, SIGCONT) == 0, "CLOEXEC child did not resume")
        let status = try waitForChild(child.pid)
        reaped = true
        try require(exitedSuccessfully(status), "unrelated descriptor entered the child")
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

    private static func copyCandidate(from sourcePath: String, named name: String, into root: URL) throws -> URL {
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

    private static func waitForChild(_ pid: pid_t) throws -> Int32 {
        var status: Int32 = 0
        while true {
            let result = Darwin.waitpid(pid, &status, 0)
            if result == pid { return status }
            if result == -1 && errno == EINTR { continue }
            throw FixtureFailure.assertion("waitpid did not converge")
        }
    }

    private static func killAndReap(_ pid: pid_t) throws {
        let result = Darwin.kill(pid, SIGKILL)
        let killError = errno
        guard result == 0 || killError == ESRCH else {
            throw FixtureFailure.assertion("suspended child could not be killed")
        }
        _ = try waitForChild(pid)
    }

    private static func readAll(from descriptor: Int32) throws -> Data {
        try FileHandle(fileDescriptor: descriptor, closeOnDealloc: false).readToEnd() ?? Data()
    }

    private static func exitedSuccessfully(_ status: Int32) -> Bool {
        status & 0x7f == 0 && (status >> 8) & 0xff == 0
    }
}
