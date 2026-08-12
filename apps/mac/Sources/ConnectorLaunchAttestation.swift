import Darwin
import Dispatch
import Foundation
import Security

struct HermesConnectorLaunchIdentity: Equatable {
    let teamIdentifier: String?
    let bundleIdentifier: String
    let allowedCDHashes: Set<Data>
}

enum HermesConnectorAttestationError: Error {
    case invalidIdentity
}

enum HermesConnectorCodeAttestor {
    static func captureExpectedIdentity(
        staticCode: SecStaticCode,
        expectedTeamID: String?,
        expectedBundleID: String
    ) throws -> HermesConnectorLaunchIdentity {
        var signingInformation: CFDictionary?
        guard SecCodeCopySigningInformation(
            staticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &signingInformation
        ) == errSecSuccess,
              let information = signingInformation as? [String: Any],
              information[kSecCodeInfoTeamIdentifier as String] as? String == expectedTeamID,
              information[kSecCodeInfoIdentifier as String] as? String == expectedBundleID,
              let cdHashes = information[kSecCodeInfoCdHashes as String] as? [Data],
              !cdHashes.isEmpty,
              cdHashes.allSatisfy({ !$0.isEmpty }) else {
            throw HermesConnectorAttestationError.invalidIdentity
        }
        return HermesConnectorLaunchIdentity(
            teamIdentifier: expectedTeamID,
            bundleIdentifier: expectedBundleID,
            allowedCDHashes: Set(cdHashes)
        )
    }

    static func attestSuspendedChild(
        pid: pid_t,
        expected: HermesConnectorLaunchIdentity,
        requirement: SecRequirement
    ) throws {
        let attributes = [kSecGuestAttributePid as String: NSNumber(value: pid)] as CFDictionary
        var dynamicCode: SecCode?
        guard SecCodeCopyGuestWithAttributes(
            nil,
            attributes,
            SecCSFlags(),
            &dynamicCode
        ) == errSecSuccess,
              let dynamicCode,
              SecCodeCheckValidity(
                dynamicCode,
                SecCSFlags(rawValue: kSecCSStrictValidate),
                requirement
              ) == errSecSuccess else {
            throw HermesConnectorAttestationError.invalidIdentity
        }

        // Swift does not expose SecCodeCopySigningInformation's documented
        // implicit SecCode-to-SecStaticCode conversion. Use the explicit bridge
        // after dynamic validity succeeds. With default flags the static view is
        // narrowed to the architecture loaded by this child, so its labels and
        // kSecCodeInfoUnique describe the validated running image.
        var loadedStaticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(
            dynamicCode,
            SecCSFlags(),
            &loadedStaticCode
        ) == errSecSuccess, let loadedStaticCode else {
            throw HermesConnectorAttestationError.invalidIdentity
        }

        var signingInformation: CFDictionary?
        guard SecCodeCopySigningInformation(
            loadedStaticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &signingInformation
        ) == errSecSuccess,
              let information = signingInformation as? [String: Any],
              information[kSecCodeInfoTeamIdentifier as String] as? String
                == expected.teamIdentifier,
              information[kSecCodeInfoIdentifier as String] as? String
                == expected.bundleIdentifier,
              let loadedCDHash = information[kSecCodeInfoUnique as String] as? Data,
              !loadedCDHash.isEmpty,
              expected.allowedCDHashes.contains(loadedCDHash) else {
            throw HermesConnectorAttestationError.invalidIdentity
        }
    }
}

struct HermesChildSignalCallResult {
    let result: Int32
    let error: Int32
}

struct HermesChildWaitCallResult {
    let result: pid_t
    let status: Int32
    let error: Int32
}

struct HermesSuspendedChildOperations {
    let signal: (pid_t, Int32) -> HermesChildSignalCallResult
    let wait: (pid_t, Int32) -> HermesChildWaitCallResult
    let now: () -> UInt64
    let sleep: (useconds_t) -> Void

    static let live = HermesSuspendedChildOperations(
        signal: { pid, signal in
            let result = Darwin.kill(pid, signal)
            return HermesChildSignalCallResult(
                result: result,
                error: result == 0 ? 0 : errno
            )
        },
        wait: { pid, options in
            var status: Int32 = 0
            let result = Darwin.waitpid(pid, &status, options)
            return HermesChildWaitCallResult(
                result: result,
                status: status,
                error: result >= 0 ? 0 : errno
            )
        },
        now: { DispatchTime.now().uptimeNanoseconds },
        sleep: { _ = Darwin.usleep($0) }
    )
}

enum HermesSuspendedChildLifecycleError: Error, Equatable {
    case spawnFailed
    case attestationFailed
    case resumeFailed
    case ioStartFailed
    case waitFailed
    case cleanupFailed
}

struct HermesSuspendedChildOutcome {
    let status: Int32
    let timedOut: Bool
}

private final class HermesSuspendedChildOwnership {
    let pid: pid_t
    private(set) var reaped = false

    init(pid: pid_t) {
        self.pid = pid
    }

    func markReaped() {
        reaped = true
    }
}

enum HermesSuspendedChildLifecycle {
    private static let pollIntervalMicroseconds: useconds_t = 10_000

    private enum WaitOutcome {
        case exited(Int32)
        case deadline
        case noChild
    }

    static func run(
        spawnSuspended: () throws -> pid_t,
        attest: (pid_t) throws -> Void,
        startIO: () throws -> Void,
        timeoutNanoseconds: UInt64,
        operations: HermesSuspendedChildOperations = .live,
        terminationGraceNanoseconds: UInt64 = 2_000_000_000,
        cleanupTimeoutNanoseconds: UInt64 = 2_000_000_000
    ) throws -> HermesSuspendedChildOutcome {
        let child: pid_t
        do {
            child = try spawnSuspended()
        } catch {
            throw HermesSuspendedChildLifecycleError.spawnFailed
        }
        guard child > 0 else { throw HermesSuspendedChildLifecycleError.spawnFailed }
        let ownership = HermesSuspendedChildOwnership(pid: child)

        do {
            try attest(child)
        } catch {
            do {
                _ = try killAndReap(
                    ownership,
                    operations: operations,
                    timeoutNanoseconds: cleanupTimeoutNanoseconds
                )
            } catch {
                throw HermesSuspendedChildLifecycleError.cleanupFailed
            }
            throw HermesSuspendedChildLifecycleError.attestationFailed
        }

        let resume = operations.signal(child, SIGCONT)
        guard resume.result == 0 else {
            do {
                _ = try killAndReap(
                    ownership,
                    operations: operations,
                    timeoutNanoseconds: cleanupTimeoutNanoseconds
                )
            } catch {
                throw HermesSuspendedChildLifecycleError.cleanupFailed
            }
            throw HermesSuspendedChildLifecycleError.resumeFailed
        }

        do {
            try startIO()
        } catch {
            do {
                _ = try killAndReap(
                    ownership,
                    operations: operations,
                    timeoutNanoseconds: cleanupTimeoutNanoseconds
                )
            } catch {
                throw HermesSuspendedChildLifecycleError.cleanupFailed
            }
            throw HermesSuspendedChildLifecycleError.ioStartFailed
        }

        let deadline = boundedDeadline(
            from: operations.now(), interval: timeoutNanoseconds
        )
        let waited: WaitOutcome
        do {
            waited = try waitUntil(
                ownership,
                deadline: deadline,
                operations: operations
            )
        } catch {
            do {
                _ = try killAndReap(
                    ownership,
                    operations: operations,
                    timeoutNanoseconds: cleanupTimeoutNanoseconds
                )
            } catch {
                throw HermesSuspendedChildLifecycleError.cleanupFailed
            }
            throw HermesSuspendedChildLifecycleError.waitFailed
        }

        switch waited {
        case .exited(let status):
            return HermesSuspendedChildOutcome(status: status, timedOut: false)
        case .noChild:
            throw HermesSuspendedChildLifecycleError.waitFailed
        case .deadline:
            return try terminateTimedOutChild(
                ownership,
                operations: operations,
                terminationGraceNanoseconds: terminationGraceNanoseconds,
                cleanupTimeoutNanoseconds: cleanupTimeoutNanoseconds
            )
        }
    }

    private static func terminateTimedOutChild(
        _ ownership: HermesSuspendedChildOwnership,
        operations: HermesSuspendedChildOperations,
        terminationGraceNanoseconds: UInt64,
        cleanupTimeoutNanoseconds: UInt64
    ) throws -> HermesSuspendedChildOutcome {
        let termination = operations.signal(ownership.pid, SIGTERM)
        let terminationAccepted = termination.result == 0 || termination.error == ESRCH
        if terminationAccepted {
            let deadline = boundedDeadline(
                from: operations.now(), interval: terminationGraceNanoseconds
            )
            if let waited = try? waitUntil(
                ownership,
                deadline: deadline,
                operations: operations
            ) {
                switch waited {
                case .exited(let status):
                    return HermesSuspendedChildOutcome(status: status, timedOut: true)
                case .noChild:
                    return HermesSuspendedChildOutcome(status: 0, timedOut: true)
                case .deadline:
                    break
                }
            }
        }

        do {
            let status = try killAndReap(
                ownership,
                operations: operations,
                timeoutNanoseconds: cleanupTimeoutNanoseconds
            )
            return HermesSuspendedChildOutcome(status: status ?? 0, timedOut: true)
        } catch {
            throw HermesSuspendedChildLifecycleError.cleanupFailed
        }
    }

    private static func killAndReap(
        _ ownership: HermesSuspendedChildOwnership,
        operations: HermesSuspendedChildOperations,
        timeoutNanoseconds: UInt64
    ) throws -> Int32? {
        guard !ownership.reaped else { return nil }

        let killResult = operations.signal(ownership.pid, SIGKILL)
        let killAccepted = killResult.result == 0 || killResult.error == ESRCH
        let deadline = boundedDeadline(
            from: operations.now(), interval: timeoutNanoseconds
        )
        let waited: WaitOutcome
        do {
            waited = try waitUntil(
                ownership,
                deadline: deadline,
                operations: operations
            )
        } catch {
            throw HermesSuspendedChildLifecycleError.cleanupFailed
        }
        guard killAccepted else {
            throw HermesSuspendedChildLifecycleError.cleanupFailed
        }
        switch waited {
        case .exited(let status):
            return status
        case .noChild:
            return nil
        case .deadline:
            throw HermesSuspendedChildLifecycleError.cleanupFailed
        }
    }

    private static func waitUntil(
        _ ownership: HermesSuspendedChildOwnership,
        deadline: UInt64,
        operations: HermesSuspendedChildOperations
    ) throws -> WaitOutcome {
        guard !ownership.reaped else { return .noChild }
        while true {
            let waitResult = operations.wait(ownership.pid, WNOHANG)
            if waitResult.result == ownership.pid {
                ownership.markReaped()
                return .exited(waitResult.status)
            }
            if waitResult.result == 0 {
                if operations.now() >= deadline { return .deadline }
                operations.sleep(pollIntervalMicroseconds)
                continue
            }
            if waitResult.result == -1 && waitResult.error == EINTR {
                if operations.now() >= deadline { return .deadline }
                operations.sleep(pollIntervalMicroseconds)
                continue
            }
            if waitResult.result == -1 && waitResult.error == ECHILD {
                ownership.markReaped()
                return .noChild
            }
            throw HermesSuspendedChildLifecycleError.waitFailed
        }
    }

    private static func boundedDeadline(from now: UInt64, interval: UInt64) -> UInt64 {
        interval > UInt64.max - now ? UInt64.max : now + interval
    }
}
