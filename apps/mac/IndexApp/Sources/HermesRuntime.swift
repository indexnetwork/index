import Foundation
import Darwin

// Request-correlated, local-only Hermes reconciliation. This file deliberately
// has no networking: JavaScript owns the server saga and passes only one
// bootstrap credential transiently to configureDisabled.
enum HermesRuntimeCommand: String, Decodable {
    case inspect, configureDisabled, enable, confirmHealthy, disable, prepareLogout, disconnect
    case loadOperation, saveOperation, clearOperation
}

struct HermesRuntimeRequest: Decodable {
    let requestId: String
    let command: HermesRuntimeCommand
    let ownerId: String?
    let installationId: String?
    let executorId: String?
    let setupAttemptId: String?
    let credential: String?
    let operationJournal: HermesSagaOperationRecord?
}

struct HermesLocalState: Codable {
    let installationId: String
    let ownerId: String?
    let executorId: String?
    let pluginInstalled: Bool
    let negotiatorMode: Bool
    let schedulePresent: Bool
    let scheduleEnabled: Bool
    let setupAttemptId: String?
}

struct HermesRuntimeResult: Encodable {
    let requestId: String
    let ok: Bool
    let stage: String
    let state: HermesLocalState?
    let operationJournal: HermesSagaOperationRecord?
    let errorCode: String?
    let retryable: Bool

    init(
        requestId: String,
        ok: Bool,
        stage: String,
        state: HermesLocalState?,
        operationJournal: HermesSagaOperationRecord? = nil,
        errorCode: String?,
        retryable: Bool
    ) {
        self.requestId = requestId
        self.ok = ok
        self.stage = stage
        self.state = state
        self.operationJournal = operationJournal
        self.errorCode = errorCode
        self.retryable = retryable
    }
}

enum HermesSetupStage: String, Codable, Hashable {
    case preparing
    case environmentWritten
    case pluginInstalled
    case scheduleDisabled
    case enabling
    case awaitingHeartbeat
    case disconnecting
    /// All external/local postconditions are proven and generation publication
    /// may be nil; only durable journal unlink remains retryable.
    case disconnectCleanupComplete
}

struct HermesSetupJournal: Codable, Equatable {
    let setupAttemptId: String
    let stage: HermesSetupStage
    let ownerId: String
    let executorId: String
    let cronJobId: String?
}

/// The completed generation is retained separately from the in-progress
/// journal. A healthy confirmation may therefore clear the journal while a
/// later stale disconnect is still fenced from the current local wiring.
struct HermesInstallationRecord: Codable {
    let installationId: String
    var currentOwnerId: String?
    var currentExecutorId: String?
    var currentSetupAttemptId: String?
    /// Immutable capability for the one app-created Hermes job. The adjacent
    /// generation prevents a retained ID from being rebound to newer wiring.
    var currentCronJobId: String?
    var currentCronSetupAttemptId: String?

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case installationId, currentOwnerId, currentExecutorId, currentSetupAttemptId
        case currentCronJobId, currentCronSetupAttemptId
    }

    init(
        installationId: String,
        currentOwnerId: String?,
        currentExecutorId: String?,
        currentSetupAttemptId: String?,
        currentCronJobId: String?,
        currentCronSetupAttemptId: String?
    ) {
        self.installationId = installationId
        self.currentOwnerId = currentOwnerId
        self.currentExecutorId = currentExecutorId
        self.currentSetupAttemptId = currentSetupAttemptId
        self.currentCronJobId = currentCronJobId
        self.currentCronSetupAttemptId = currentCronSetupAttemptId
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.container(keyedBy: HermesAnyCodingKey.self)
        let allowed = Set(CodingKeys.allCases.map(\.rawValue))
        guard Set(raw.allKeys.map(\.stringValue)).isSubset(of: allowed) else {
            throw HermesRuntimeFailure.installationStoreInvalid
        }
        let values = try decoder.container(keyedBy: CodingKeys.self)
        installationId = try values.decode(String.self, forKey: .installationId)
        currentOwnerId = try values.decodeIfPresent(String.self, forKey: .currentOwnerId)
        currentExecutorId = try values.decodeIfPresent(String.self, forKey: .currentExecutorId)
        currentSetupAttemptId = try values.decodeIfPresent(String.self, forKey: .currentSetupAttemptId)
        currentCronJobId = try values.decodeIfPresent(String.self, forKey: .currentCronJobId)
        currentCronSetupAttemptId = try values.decodeIfPresent(
            String.self,
            forKey: .currentCronSetupAttemptId
        )
        guard !installationId.isEmpty,
              installationId.rangeOfCharacter(from: .newlines) == nil,
              (currentCronJobId == nil) == (currentCronSetupAttemptId == nil) else {
            throw HermesRuntimeFailure.installationStoreInvalid
        }
    }
}

private struct HermesAnyCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

/// Strict, non-secret crash-recovery evidence shared with JavaScript. Unknown
/// keys are rejected so a future page cannot smuggle credentials or prose into
/// the app-owned Application Support journal.
struct HermesSagaOperationRecord: Codable, Equatable {
    let version: Int
    let operation: String
    let stage: String
    let ownerId: String
    let installationId: String
    let setupAttemptId: String?
    let executorId: String?

    private static let stageMap: [String: Set<String>] = [
        "select-hermes": ["prepare-pending", "prepared", "configured", "activated", "native-recovery"],
        "select-index": ["server-pending", "server-complete"],
        "disconnect": ["server-pending", "server-complete"],
    ]
    private static let exactKeys: Set<String> = [
        "version", "operation", "stage", "ownerId", "installationId", "setupAttemptId", "executorId",
    ]

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: HermesAnyCodingKey.self)
        guard Set(values.allKeys.map(\.stringValue)) == Self.exactKeys else {
            throw HermesRuntimeFailure.operationStoreInvalid
        }
        func key(_ name: String) -> HermesAnyCodingKey { HermesAnyCodingKey(stringValue: name)! }
        version = try values.decode(Int.self, forKey: key("version"))
        operation = try values.decode(String.self, forKey: key("operation"))
        stage = try values.decode(String.self, forKey: key("stage"))
        ownerId = try values.decode(String.self, forKey: key("ownerId"))
        installationId = try values.decode(String.self, forKey: key("installationId"))
        setupAttemptId = try values.decodeIfPresent(String.self, forKey: key("setupAttemptId"))
        executorId = try values.decodeIfPresent(String.self, forKey: key("executorId"))
        guard isValid else { throw HermesRuntimeFailure.operationStoreInvalid }
    }

    init(
        version: Int,
        operation: String,
        stage: String,
        ownerId: String,
        installationId: String,
        setupAttemptId: String?,
        executorId: String?
    ) throws {
        self.version = version
        self.operation = operation
        self.stage = stage
        self.ownerId = ownerId
        self.installationId = installationId
        self.setupAttemptId = setupAttemptId
        self.executorId = executorId
        guard isValid else { throw HermesRuntimeFailure.operationStoreInvalid }
    }

    private var isValid: Bool {
        func validIdentifier(_ value: String?) -> Bool {
            guard let value else { return false }
            return !value.isEmpty && !value.contains("\0")
                && value.rangeOfCharacter(from: .newlines) == nil
        }
        guard version == 1,
              Self.stageMap[operation]?.contains(stage) == true,
              validIdentifier(ownerId), validIdentifier(installationId) else { return false }
        if operation == "select-hermes" {
            guard validIdentifier(setupAttemptId) else { return false }
            return stage == "prepare-pending"
                ? executorId == nil
                : validIdentifier(executorId)
        }
        let bothAbsent = setupAttemptId == nil && executorId == nil
        let bothPresent = validIdentifier(setupAttemptId) && validIdentifier(executorId)
        return bothAbsent || bothPresent
    }
}

private enum HermesRuntimeFailure: Error {
    case invalidArguments
    case hermesNotFound
    case installationStoreInvalid
    case installationStoreFailed
    case journalInvalid
    case journalWriteFailed
    case operationStoreInvalid
    case operationStoreFailed
    case envWriteFailed
    case environmentChanged
    case pluginInstallFailed
    case pluginEnableFailed
    case pluginRemoveFailed
    case cronStoreInvalid
    case cronAmbiguous
    case cronCreateFailed
    case cronEditFailed
    case cronPauseFailed
    case cronResumeFailed
    case cronRemoveFailed
    case gatewayFailed
    case gatewayStatusFailed
    case commandTimedOut
    case activationRollbackFailed
    case ownerMismatch
    case ownerUnattributed
    case localCleanupFailed
    case internalFailure

    var code: String {
        switch self {
        case .invalidArguments: return "invalid_arguments"
        case .hermesNotFound: return "hermes_not_found"
        case .installationStoreInvalid: return "installation_store_invalid"
        case .installationStoreFailed: return "installation_store_failed"
        case .journalInvalid: return "journal_invalid"
        case .journalWriteFailed: return "journal_write_failed"
        case .operationStoreInvalid: return "operation_store_invalid"
        case .operationStoreFailed: return "operation_store_failed"
        case .envWriteFailed: return "env_write_failed"
        case .environmentChanged: return "env_write_failed"
        case .pluginInstallFailed: return "plugin_install_failed"
        case .pluginEnableFailed: return "plugin_enable_failed"
        case .pluginRemoveFailed: return "plugin_remove_failed"
        case .cronStoreInvalid: return "cron_store_invalid"
        case .cronAmbiguous: return "cron_ambiguous"
        case .cronCreateFailed: return "cron_create_failed"
        case .cronEditFailed: return "cron_edit_failed"
        case .cronPauseFailed: return "cron_pause_failed"
        case .cronResumeFailed: return "cron_resume_failed"
        case .cronRemoveFailed: return "cron_remove_failed"
        case .gatewayFailed: return "gateway_failed"
        case .gatewayStatusFailed: return "gateway_status_failed"
        case .commandTimedOut: return "command_timed_out"
        case .activationRollbackFailed: return "activation_rollback_failed"
        case .ownerMismatch: return "owner_mismatch"
        case .ownerUnattributed: return "owner_unattributed"
        case .localCleanupFailed: return "local_cleanup_failed"
        case .internalFailure: return "internal_failure"
        }
    }

    var retryable: Bool {
        switch self {
        case .invalidArguments, .installationStoreInvalid, .journalInvalid,
             .operationStoreInvalid, .cronStoreInvalid, .cronAmbiguous, .ownerMismatch:
            return false
        default:
            return true
        }
    }

}

struct HermesCommandOutput {
    let status: Int32
    /// Used only for gateway status detection. It is never returned, logged, or
    /// persisted, and command failures expose only stable error codes.
    let output: String
}

protocol HermesCommandRunning {
    func run(executable: String, arguments: [String]) throws -> HermesCommandOutput
}

private final class HermesBoundedOutputBuffer {
    private let lock = NSLock()
    private let limit: Int
    private var data = Data()

    init(limit: Int) { self.limit = limit }

    func append(_ chunk: Data) {
        guard !chunk.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        data.append(chunk)
        if data.count > limit { data.removeFirst(data.count - limit) }
    }

    func snapshot() -> Data {
        lock.lock()
        defer { lock.unlock() }
        return data
    }
}

final class HermesCommandRunner: HermesCommandRunning {
    private let commandDeadline: TimeInterval
    private let terminationGrace: TimeInterval

    init(commandDeadline: TimeInterval = 60, terminationGrace: TimeInterval = 2) {
        self.commandDeadline = commandDeadline
        self.terminationGrace = terminationGrace
    }

    func run(executable: String, arguments: [String]) throws -> HermesCommandOutput {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments

        let output = Pipe()
        let boundedOutput = HermesBoundedOutputBuffer(limit: 16_384)
        let finished = DispatchSemaphore(value: 0)
        process.standardOutput = output
        process.standardError = output
        process.standardInput = FileHandle.nullDevice
        process.terminationHandler = { _ in finished.signal() }
        output.fileHandleForReading.readabilityHandler = { handle in
            boundedOutput.append(handle.availableData)
        }

        do {
            try process.run()
        } catch {
            output.fileHandleForReading.readabilityHandler = nil
            try? output.fileHandleForReading.close()
            process.terminationHandler = nil
            throw HermesRuntimeFailure.hermesNotFound
        }

        let completed = finished.wait(timeout: .now() + commandDeadline) == .success
        if !completed {
            if process.isRunning { process.terminate() }
            if finished.wait(timeout: .now() + terminationGrace) == .timedOut,
               process.isRunning {
                _ = Darwin.kill(process.processIdentifier, SIGKILL)
                _ = finished.wait(timeout: .now() + terminationGrace)
            }
        }

        output.fileHandleForReading.readabilityHandler = nil
        drainAvailableOutput(
            descriptor: output.fileHandleForReading.fileDescriptor,
            into: boundedOutput
        )
        try? output.fileHandleForReading.close()
        process.terminationHandler = nil
        process.standardOutput = nil
        process.standardError = nil

        guard completed else { throw HermesRuntimeFailure.commandTimedOut }
        return HermesCommandOutput(
            status: process.terminationStatus,
            output: String(data: boundedOutput.snapshot(), encoding: .utf8) ?? ""
        )
    }

    /// Drain bytes already buffered in the pipe without waiting for EOF. This
    /// captures a short-lived command's final status output while descendants
    /// that inherited the pipe cannot hold this runner open past its deadline.
    private func drainAvailableOutput(
        descriptor: Int32,
        into buffer: HermesBoundedOutputBuffer
    ) {
        let originalFlags = Darwin.fcntl(descriptor, F_GETFL)
        guard originalFlags >= 0,
              Darwin.fcntl(descriptor, F_SETFL, originalFlags | O_NONBLOCK) == 0 else { return }
        defer { _ = Darwin.fcntl(descriptor, F_SETFL, originalFlags) }
        var bytes = [UInt8](repeating: 0, count: 4_096)
        while true {
            let count = bytes.withUnsafeMutableBytes { storage in
                Darwin.read(descriptor, storage.baseAddress, storage.count)
            }
            guard count > 0 else { return }
            buffer.append(Data(bytes.prefix(Int(count))))
        }
    }
}

private struct HermesFileIdentity: Equatable {
    let device: UInt64
    let inode: UInt64
    let size: Int64
    let modifiedSeconds: Int64
    let modifiedNanoseconds: Int64

    init(_ status: stat) {
        device = UInt64(status.st_dev)
        inode = UInt64(status.st_ino)
        size = Int64(status.st_size)
        modifiedSeconds = Int64(status.st_mtimespec.tv_sec)
        modifiedNanoseconds = Int64(status.st_mtimespec.tv_nsec)
    }
}

private struct HermesFileSnapshot {
    let data: Data
    let identity: HermesFileIdentity
}

private enum HermesExpectedFileState {
    case any
    case absent
    case identity(HermesFileIdentity)
}

/// A retained capability for one checked directory. Sensitive operations never
/// re-resolve its absolute path after this descriptor has been opened.
private final class HermesDirectoryDescriptor {
    let rawValue: Int32

    init(rawValue: Int32) { self.rawValue = rawValue }
    deinit { _ = Darwin.close(rawValue) }
}

/// Descriptor-oriented boundary checks used by every sensitive read, publish,
/// and destructive cleanup. Existing path components must be real directories;
/// no parent symlink is followed.
private enum HermesFilesystem {
    private static let fileTypeMask = mode_t(S_IFMT)
    private static let directoryType = mode_t(S_IFDIR)
    private static let regularType = mode_t(S_IFREG)
    private static let symbolicLinkType = mode_t(S_IFLNK)

    static func openDirectory(
        _ directory: URL,
        createMissing: Bool
    ) throws -> HermesDirectoryDescriptor? {
        let standardized = directory.standardizedFileURL
        guard standardized.isFileURL, standardized.path.hasPrefix("/") else {
            throw HermesRuntimeFailure.localCleanupFailed
        }
        let root = Darwin.open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard root >= 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        var current = HermesDirectoryDescriptor(rawValue: root)
        for component in standardized.pathComponents.dropFirst() {
            let opened = component.withCString {
                Darwin.openat(current.rawValue, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
            }
            var next = opened
            if next < 0, errno == ENOENT, createMissing {
                let made = component.withCString {
                    Darwin.mkdirat(current.rawValue, $0, mode_t(0o700))
                }
                guard made == 0 || errno == EEXIST else {
                    throw HermesRuntimeFailure.localCleanupFailed
                }
                next = component.withCString {
                    Darwin.openat(current.rawValue, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
                }
            }
            if next < 0, errno == ENOENT, !createMissing { return nil }
            guard next >= 0 else { throw HermesRuntimeFailure.localCleanupFailed }
            current = HermesDirectoryDescriptor(rawValue: next)
        }
        return current
    }

    static func entryStatus(
        in directory: HermesDirectoryDescriptor,
        name: String
    ) throws -> stat? {
        var status = stat()
        let result = name.withCString {
            Darwin.fstatat(directory.rawValue, $0, &status, AT_SYMLINK_NOFOLLOW)
        }
        if result == 0 { return status }
        if errno == ENOENT { return nil }
        throw HermesRuntimeFailure.localCleanupFailed
    }

    private static func names(in directory: HermesDirectoryDescriptor) throws -> [String] {
        let duplicate = Darwin.dup(directory.rawValue)
        guard duplicate >= 0, let stream = Darwin.fdopendir(duplicate) else {
            if duplicate >= 0 { _ = Darwin.close(duplicate) }
            throw HermesRuntimeFailure.localCleanupFailed
        }
        defer { _ = Darwin.closedir(stream) }
        var result: [String] = []
        errno = 0
        while let entry = Darwin.readdir(stream) {
            let nameCapacity = MemoryLayout.size(ofValue: entry.pointee.d_name)
            let name = withUnsafePointer(to: &entry.pointee.d_name) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: nameCapacity) {
                    String(cString: $0)
                }
            }
            if name != ".", name != ".." { result.append(name) }
            errno = 0
        }
        guard errno == 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        return result
    }

    static func readRegularFile(_ url: URL) throws -> HermesFileSnapshot? {
        guard let parent = try openDirectory(
            url.deletingLastPathComponent(),
            createMissing: false
        ) else { return nil }
        return try readRegularFile(in: parent, name: url.lastPathComponent)
    }

    static func readRegularFile(
        in parent: HermesDirectoryDescriptor,
        name: String
    ) throws -> HermesFileSnapshot? {
        let descriptor = name.withCString {
            Darwin.openat(parent.rawValue, $0, O_RDONLY | O_NOFOLLOW)
        }
        if descriptor < 0, errno == ENOENT { return nil }
        guard descriptor >= 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        var status = stat()
        guard Darwin.fstat(descriptor, &status) == 0,
              status.st_mode & fileTypeMask == regularType else {
            try? handle.close()
            throw HermesRuntimeFailure.localCleanupFailed
        }
        do {
            let data = try handle.readToEnd() ?? Data()
            try handle.close()
            return HermesFileSnapshot(data: data, identity: HermesFileIdentity(status))
        } catch {
            try? handle.close()
            throw error
        }
    }

    static func verifyRegularFile(
        in parent: HermesDirectoryDescriptor,
        name: String,
        permissions: mode_t? = nil
    ) throws {
        guard let status = try entryStatus(in: parent, name: name),
              status.st_mode & fileTypeMask == regularType else {
            throw HermesRuntimeFailure.localCleanupFailed
        }
        if let permissions,
           status.st_mode & mode_t(0o777) != permissions {
            throw HermesRuntimeFailure.localCleanupFailed
        }
    }

    static func removeOwnedDirectory(_ url: URL) throws {
        guard let parent = try openDirectory(
            url.deletingLastPathComponent(),
            createMissing: false
        ) else { return }
        let name = url.lastPathComponent
        guard let status = try entryStatus(in: parent, name: name) else { return }
        guard status.st_mode & fileTypeMask == directoryType,
              status.st_mode & fileTypeMask != symbolicLinkType else {
            throw HermesRuntimeFailure.localCleanupFailed
        }
        let quarantine = ".\(name).\(UUID().uuidString).removing"
        let detached = name.withCString { source in
            quarantine.withCString { destination in
                Darwin.renameat(parent.rawValue, source, parent.rawValue, destination)
            }
        }
        guard detached == 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        guard let quarantineDirectory = try openChildDirectory(
            in: parent,
            name: quarantine
        ) else { throw HermesRuntimeFailure.localCleanupFailed }
        try removeDirectoryContents(quarantineDirectory)
        let removed = quarantine.withCString {
            Darwin.unlinkat(parent.rawValue, $0, AT_REMOVEDIR)
        }
        guard removed == 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        try fsyncDirectory(parent)
    }

    static func removeRegularFile(_ url: URL) throws {
        guard let parent = try openDirectory(
            url.deletingLastPathComponent(),
            createMissing: false
        ) else { return }
        let name = url.lastPathComponent
        guard try entryStatus(in: parent, name: name) != nil else { return }
        try verifyRegularFile(in: parent, name: name)
        let removed = name.withCString { Darwin.unlinkat(parent.rawValue, $0, 0) }
        guard removed == 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        try fsyncDirectory(parent)
    }

    private static func openChildDirectory(
        in parent: HermesDirectoryDescriptor,
        name: String
    ) throws -> HermesDirectoryDescriptor? {
        let descriptor = name.withCString {
            Darwin.openat(parent.rawValue, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        }
        if descriptor < 0, errno == ENOENT { return nil }
        guard descriptor >= 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        return HermesDirectoryDescriptor(rawValue: descriptor)
    }

    private static func removeDirectoryContents(
        _ directory: HermesDirectoryDescriptor
    ) throws {
        for name in try names(in: directory) {
            guard let status = try entryStatus(in: directory, name: name) else { continue }
            if status.st_mode & fileTypeMask == directoryType,
               status.st_mode & fileTypeMask != symbolicLinkType {
                guard let child = try openChildDirectory(in: directory, name: name) else { continue }
                try removeDirectoryContents(child)
                let removed = name.withCString {
                    Darwin.unlinkat(directory.rawValue, $0, AT_REMOVEDIR)
                }
                guard removed == 0 else { throw HermesRuntimeFailure.localCleanupFailed }
            } else {
                let removed = name.withCString {
                    Darwin.unlinkat(directory.rawValue, $0, 0)
                }
                guard removed == 0 else { throw HermesRuntimeFailure.localCleanupFailed }
            }
        }
    }

    static func removeOrphanTemporaryFiles(in directory: URL, destinationName: String) throws {
        guard let parent = try openDirectory(directory, createMissing: false) else { return }
        try removeOrphanTemporaryFiles(in: parent, destinationName: destinationName)
    }

    static func removeOrphanTemporaryFiles(
        in directory: HermesDirectoryDescriptor,
        destinationName: String
    ) throws {
        let prefix = ".\(destinationName)."
        // Only the writer's exact destination + UUID + .tmp namespace is
        // app-owned; similarly named unrelated files are never removed.
        for name in try names(in: directory) {
            guard name.hasPrefix(prefix), name.hasSuffix(".tmp") else { continue }
            let start = name.index(name.startIndex, offsetBy: prefix.count)
            let end = name.index(name.endIndex, offsetBy: -4)
            guard UUID(uuidString: String(name[start..<end])) != nil,
                  let status = try entryStatus(in: directory, name: name),
                  status.st_mode & fileTypeMask == regularType else { continue }
            let removed = name.withCString {
                Darwin.unlinkat(directory.rawValue, $0, 0)
            }
            guard removed == 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        }
    }

    static func withAdvisoryLock<T>(
        siblingOf url: URL,
        lockName: String,
        _ body: (HermesDirectoryDescriptor) throws -> T
    ) throws -> T {
        guard let parent = try openDirectory(
            url.deletingLastPathComponent(),
            createMissing: true
        ) else { throw HermesRuntimeFailure.localCleanupFailed }
        let descriptor = lockName.withCString {
            Darwin.openat(
                parent.rawValue,
                $0,
                O_RDWR | O_CREAT | O_NOFOLLOW,
                mode_t(0o600)
            )
        }
        guard descriptor >= 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        defer { _ = Darwin.close(descriptor) }
        var status = stat()
        guard Darwin.fstat(descriptor, &status) == 0,
              status.st_mode & fileTypeMask == regularType,
              Darwin.fchmod(descriptor, mode_t(0o600)) == 0,
              Darwin.flock(descriptor, LOCK_EX) == 0 else {
            throw HermesRuntimeFailure.localCleanupFailed
        }
        defer { _ = Darwin.flock(descriptor, LOCK_UN) }
        return try body(parent)
    }

    static func fsyncDirectory(_ directory: HermesDirectoryDescriptor) throws {
        guard Darwin.fsync(directory.rawValue) == 0 || errno == EINVAL || errno == ENOTSUP else {
            throw HermesRuntimeFailure.localCleanupFailed
        }
    }
}

/// Writes sensitive material through a same-directory 0600 temporary inode,
/// publishes it atomically with the new inode's metadata, then verifies the
/// final file and fsyncs the containing directory.
private enum HermesSecureFileWriter {
    static func write(
        _ data: Data,
        to url: URL,
        expected: HermesExpectedFileState = .any
    ) throws {
        guard let directory = try HermesFilesystem.openDirectory(
            url.deletingLastPathComponent(),
            createMissing: true
        ) else { throw HermesRuntimeFailure.localCleanupFailed }
        try write(
            data,
            in: directory,
            destinationName: url.lastPathComponent,
            expected: expected
        )
    }

    static func write(
        _ data: Data,
        in directory: HermesDirectoryDescriptor,
        destinationName: String,
        expected: HermesExpectedFileState = .any
    ) throws {
        guard Darwin.fchmod(directory.rawValue, mode_t(0o700)) == 0 else {
            throw HermesRuntimeFailure.localCleanupFailed
        }
        try HermesFilesystem.removeOrphanTemporaryFiles(
            in: directory,
            destinationName: destinationName
        )

        let temporary = ".\(destinationName).\(UUID().uuidString).tmp"
        let descriptor = temporary.withCString {
            Darwin.openat(
                directory.rawValue,
                $0,
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
                mode_t(0o600)
            )
        }
        guard descriptor >= 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer {
            _ = temporary.withCString { Darwin.unlinkat(directory.rawValue, $0, 0) }
        }
        do {
            try handle.write(contentsOf: data)
            handle.synchronizeFile()
            guard Darwin.fchmod(descriptor, mode_t(0o600)) == 0 else {
                throw HermesRuntimeFailure.localCleanupFailed
            }
            try handle.close()
        } catch {
            try? handle.close()
            throw error
        }
        try HermesFilesystem.verifyRegularFile(
            in: directory,
            name: temporary,
            permissions: mode_t(0o600)
        )

        // For env mutations this identity check runs while the sibling advisory
        // lock is held and is deliberately adjacent to publication. All native
        // env writers honor that lock. Unmanaged external writers cannot be
        // transactionally coordinated; a pre-publication identity mismatch is
        // detected and retried, while the remaining check/rename window is kept
        // to these two descriptor-relative syscalls rather than claimed as CAS.
        let current = try HermesFilesystem.readRegularFile(
            in: directory,
            name: destinationName
        )?.identity
        switch expected {
        case .any:
            break
        case .absent where current != nil:
            throw HermesRuntimeFailure.environmentChanged
        case .identity(let identity) where current != identity:
            throw HermesRuntimeFailure.environmentChanged
        default:
            break
        }
        let published = temporary.withCString { source in
            destinationName.withCString { destination in
                Darwin.renameat(directory.rawValue, source, directory.rawValue, destination)
            }
        }
        guard published == 0 else { throw HermesRuntimeFailure.localCleanupFailed }
        try HermesFilesystem.verifyRegularFile(
            in: directory,
            name: destinationName,
            permissions: mode_t(0o600)
        )
        try HermesFilesystem.fsyncDirectory(directory)
    }
}

final class HermesLocalStore {
    private let manager = FileManager.default
    private let directoryURL: URL
    let installationURL: URL
    private let journalURL: URL
    private let operationURL: URL

    init(applicationSupportURL: URL? = nil) throws {
        let applicationSupport: URL
        if let applicationSupportURL {
            applicationSupport = applicationSupportURL
        } else {
            guard let resolved = manager
                .urls(for: .applicationSupportDirectory, in: .userDomainMask)
                .first else {
                throw HermesRuntimeFailure.installationStoreFailed
            }
            applicationSupport = resolved
        }
        directoryURL = applicationSupport
            .appendingPathComponent(CredentialStore.service, isDirectory: true)
        installationURL = directoryURL.appendingPathComponent("hermes-installation.json")
        journalURL = directoryURL.appendingPathComponent("hermes-setup-journal.json")
        operationURL = directoryURL.appendingPathComponent("hermes-saga-operation.json")
        do {
            for destination in [installationURL, journalURL, operationURL] {
                try HermesFilesystem.removeOrphanTemporaryFiles(
                    in: directoryURL,
                    destinationName: destination.lastPathComponent
                )
            }
        } catch {
            throw HermesRuntimeFailure.installationStoreFailed
        }
    }

    func loadOrCreateInstallation() throws -> HermesInstallationRecord {
        do {
            if let snapshot = try HermesFilesystem.readRegularFile(installationURL) {
                guard let record = try? JSONDecoder().decode(
                    HermesInstallationRecord.self,
                    from: snapshot.data
                ), !record.installationId.isEmpty else {
                    throw HermesRuntimeFailure.installationStoreInvalid
                }
                // Records written before owner fencing contain a confirmed
                // generation but no owner/executor fields. Preserve and return
                // that evidence so inspect can pause the owned schedule before
                // surfacing an unattributed state; rejecting here would skip
                // the safety action and make the error-state fallback fail too.
                return record
            }
        } catch let failure as HermesRuntimeFailure {
            if case .installationStoreInvalid = failure { throw failure }
            throw HermesRuntimeFailure.installationStoreFailed
        }
        let record = HermesInstallationRecord(
            installationId: UUID().uuidString.lowercased(),
            currentOwnerId: nil,
            currentExecutorId: nil,
            currentSetupAttemptId: nil,
            currentCronJobId: nil,
            currentCronSetupAttemptId: nil
        )
        try saveInstallation(record)
        return record
    }

    func saveInstallation(_ record: HermesInstallationRecord) throws {
        do {
            try HermesSecureFileWriter.write(try JSONEncoder().encode(record), to: installationURL)
        } catch {
            throw HermesRuntimeFailure.installationStoreFailed
        }
    }

    func loadJournal() throws -> HermesSetupJournal? {
        let snapshot: HermesFileSnapshot?
        do { snapshot = try HermesFilesystem.readRegularFile(journalURL) }
        catch { throw HermesRuntimeFailure.journalInvalid }
        guard let snapshot else { return nil }
        guard let journal = try? JSONDecoder().decode(HermesSetupJournal.self, from: snapshot.data),
              !journal.setupAttemptId.isEmpty,
              !journal.ownerId.isEmpty,
              !journal.executorId.isEmpty else {
            throw HermesRuntimeFailure.journalInvalid
        }
        return journal
    }

    func saveJournal(_ journal: HermesSetupJournal) throws {
        do {
            try HermesSecureFileWriter.write(try JSONEncoder().encode(journal), to: journalURL)
        } catch {
            throw HermesRuntimeFailure.journalWriteFailed
        }
    }

    func deleteJournal() throws {
        do { try HermesFilesystem.removeRegularFile(journalURL) }
        catch { throw HermesRuntimeFailure.journalWriteFailed }
    }

    func loadOperation() throws -> HermesSagaOperationRecord? {
        do {
            guard let snapshot = try HermesFilesystem.readRegularFile(operationURL) else { return nil }
            guard let record = try? JSONDecoder().decode(
                HermesSagaOperationRecord.self,
                from: snapshot.data
            ) else { throw HermesRuntimeFailure.operationStoreInvalid }
            return record
        } catch let failure as HermesRuntimeFailure {
            throw failure
        } catch {
            throw HermesRuntimeFailure.operationStoreFailed
        }
    }

    func saveOperation(_ record: HermesSagaOperationRecord) throws {
        // Reconstructing through the strict initializer validates programmatic
        // requests as strongly as records decoded after a relaunch.
        do {
            let validated = try HermesSagaOperationRecord(
                version: record.version,
                operation: record.operation,
                stage: record.stage,
                ownerId: record.ownerId,
                installationId: record.installationId,
                setupAttemptId: record.setupAttemptId,
                executorId: record.executorId
            )
            try HermesSecureFileWriter.write(
                try JSONEncoder().encode(validated),
                to: operationURL
            )
        } catch HermesRuntimeFailure.operationStoreInvalid {
            throw HermesRuntimeFailure.operationStoreInvalid
        } catch {
            throw HermesRuntimeFailure.operationStoreFailed
        }
    }

    func clearOperation(expected: HermesSagaOperationRecord) throws -> HermesSagaOperationRecord? {
        guard let current = try loadOperation() else { return nil }
        guard current == expected else { return current }
        do { try HermesFilesystem.removeRegularFile(operationURL) }
        catch { throw HermesRuntimeFailure.operationStoreFailed }
        return nil
    }
}

private final class HermesEnvironmentFile {
    static let ownedKeys = [
        "INDEX_API_KEY",
        "INDEX_API_URL",
        "INDEX_MCP_URL",
        "INDEX_AGENT_ID",
        "INDEX_INSTALLATION_ID",
        "INDEX_PLUGIN_MODE",
    ]

    private static let mutationLockName = ".index-network.env.lock"

    private let url: URL
    private let readSnapshot: (HermesDirectoryDescriptor, String) throws -> HermesFileSnapshot?
    private let secureWrite: (
        Data,
        HermesDirectoryDescriptor,
        String,
        HermesExpectedFileState
    ) throws -> Void
    private let cleanupOrphans: (HermesDirectoryDescriptor, String) throws -> Void
    private let forbiddenEnvValueCharacters = CharacterSet.newlines
        .union(CharacterSet(charactersIn: "\0"))

    init(
        homeURL: URL,
        readSnapshot: @escaping (
            HermesDirectoryDescriptor,
            String
        ) throws -> HermesFileSnapshot? = {
            try HermesFilesystem.readRegularFile(in: $0, name: $1)
        },
        secureWrite: @escaping (
            Data,
            HermesDirectoryDescriptor,
            String,
            HermesExpectedFileState
        ) throws -> Void = {
            try HermesSecureFileWriter.write(
                $0,
                in: $1,
                destinationName: $2,
                expected: $3
            )
        },
        cleanupOrphans: @escaping (
            HermesDirectoryDescriptor,
            String
        ) throws -> Void = {
            try HermesFilesystem.removeOrphanTemporaryFiles(
                in: $0,
                destinationName: $1
            )
        }
    ) {
        url = homeURL.appendingPathComponent(".env")
        self.readSnapshot = readSnapshot
        self.secureWrite = secureWrite
        self.cleanupOrphans = cleanupOrphans
    }

    func values() throws -> [String: String] {
        var values: [String: String] = [:]
        for line in try existingLines() {
            guard let separator = line.firstIndex(of: "=") else { continue }
            let key = String(line[..<separator])
            if Self.ownedKeys.contains(key) {
                values[key] = String(line[line.index(after: separator)...])
            }
        }
        return values
    }

    func upsert(_ updates: [(String, String)]) throws {
        guard updates.allSatisfy({ Self.ownedKeys.contains($0.0) && isValidValue($0.1) }) else {
            throw HermesRuntimeFailure.invalidArguments
        }
        let keys = Set(updates.map(\.0))
        try mutate { lines in
            lines.removeAll { line in
                guard let separator = line.firstIndex(of: "=") else { return false }
                return keys.contains(String(line[..<separator]))
            }
            lines.append(contentsOf: updates.map { "\($0.0)=\($0.1)" })
        }
    }

    func removeOwnedValues() throws {
        let keys = Set(Self.ownedKeys)
        try mutate { lines in
            lines.removeAll { line in
                guard let separator = line.firstIndex(of: "=") else { return false }
                return keys.contains(String(line[..<separator]))
            }
        }
    }

    /// A missing file is the only readable-empty state. Permission, I/O, and
    /// UTF-8 decoding failures must never become an empty replacement because
    /// doing so would erase unrelated Hermes configuration.
    private func existingLines() throws -> [String] {
        let parent: HermesDirectoryDescriptor?
        do {
            parent = try HermesFilesystem.openDirectory(
                url.deletingLastPathComponent(),
                createMissing: false
            )
        } catch {
            throw HermesRuntimeFailure.envWriteFailed
        }
        guard let parent else { return [] }
        return try readExisting(in: parent, cleanupTemporaryFiles: false).lines
    }

    private func readExisting(
        in parent: HermesDirectoryDescriptor,
        cleanupTemporaryFiles: Bool
    ) throws -> (lines: [String], expected: HermesExpectedFileState) {
        let snapshot: HermesFileSnapshot?
        do {
            // Cleanup mutates the directory and therefore runs only while the
            // same advisory lock used by publication is held. Plain reads do
            // not unlink a different app process's in-flight temporary inode.
            if cleanupTemporaryFiles {
                try cleanupOrphans(parent, url.lastPathComponent)
            }
            snapshot = try readSnapshot(parent, url.lastPathComponent)
        } catch {
            if Self.isNoSuchFileError(error) { return ([], .absent) }
            throw HermesRuntimeFailure.envWriteFailed
        }
        guard let snapshot else { return ([], .absent) }
        guard let contents = String(data: snapshot.data, encoding: .utf8) else {
            throw HermesRuntimeFailure.envWriteFailed
        }
        return (
            contents.components(separatedBy: "\n"),
            .identity(snapshot.identity)
        )
    }

    private static func isNoSuchFileError(_ error: Error) -> Bool {
        let cocoaError = error as NSError
        if cocoaError.domain == NSCocoaErrorDomain,
           cocoaError.code == NSFileReadNoSuchFileError {
            return true
        }
        let enoent = Int(POSIXErrorCode.ENOENT.rawValue)
        if cocoaError.domain == NSPOSIXErrorDomain, cocoaError.code == enoent {
            return true
        }
        if let underlying = cocoaError.userInfo[NSUnderlyingErrorKey] as? NSError {
            return underlying.domain == NSPOSIXErrorDomain && underlying.code == enoent
        }
        return false
    }

    private func isValidValue(_ value: String) -> Bool {
        !value.isEmpty && value.rangeOfCharacter(from: forbiddenEnvValueCharacters) == nil
    }

    /// Every native env writer holds the sibling advisory lock for the complete
    /// read / identity recheck / descriptor-relative publish transaction. A
    /// writer that does not honor this app-owned protocol cannot be made part of
    /// the transaction, so detected pre-publish changes retry from fresh state.
    private func mutate(_ transform: (inout [String]) -> Void) throws {
        do {
            try HermesFilesystem.withAdvisoryLock(
                siblingOf: url,
                lockName: Self.mutationLockName
            ) { parent in
                for _ in 0..<3 {
                    var existing = try readExisting(
                        in: parent,
                        cleanupTemporaryFiles: true
                    )
                    while existing.lines.last == "" { existing.lines.removeLast() }
                    transform(&existing.lines)
                    while existing.lines.last == "" { existing.lines.removeLast() }
                    let contents = existing.lines.isEmpty
                        ? ""
                        : existing.lines.joined(separator: "\n") + "\n"
                    do {
                        try secureWrite(
                            Data(contents.utf8),
                            parent,
                            url.lastPathComponent,
                            existing.expected
                        )
                        return
                    } catch HermesRuntimeFailure.environmentChanged {
                        continue
                    } catch {
                        throw HermesRuntimeFailure.envWriteFailed
                    }
                }
                throw HermesRuntimeFailure.envWriteFailed
            }
        } catch HermesRuntimeFailure.envWriteFailed {
            throw HermesRuntimeFailure.envWriteFailed
        } catch {
            throw HermesRuntimeFailure.envWriteFailed
        }
    }
}

private struct HermesCronJob {
    let id: String
    let name: String
    let prompt: String?
    let schedule: String?
    let enabled: Bool
    let skills: [String]
    let legacySkill: String?
    let enabledToolsets: [String]
    let appInstallationId: String?
    let appOwnerId: String?
    let appSetupAttemptId: String?
}

private struct HermesCronOwnership {
    let jobId: String
    let installationId: String
    let ownerId: String
    let setupAttemptId: String
}

private struct HermesCronInventory {
    let ownedJob: HermesCronJob?
    let attributableJobs: [HermesCronJob]
    let enabledAttributableJobs: [HermesCronJob]
    let isExact: Bool
}

private final class HermesCronStore {
    private let jobsURL: URL

    init(homeURL: URL) {
        jobsURL = homeURL
            .appendingPathComponent("cron", isDirectory: true)
            .appendingPathComponent("jobs.json")
    }

    /// Display-name lookup exists only for one-time migration or immediately
    /// after `cron create`, before the generated immutable ID is known.
    func legacyJob() throws -> HermesCronJob? {
        let matches = try jobs().filter {
            $0.name == HermesRuntimeManager.ownedCronName
        }
        guard matches.count <= 1 else { throw HermesRuntimeFailure.cronAmbiguous }
        return matches.first
    }

    func inventory(ownership: HermesCronOwnership) throws -> HermesCronInventory {
        let allJobs = try jobs()
        let exactIdJobs = allJobs.filter { job in
            job.id == ownership.jobId
        }
        let attributable = allJobs.filter { job in
            job.id == ownership.jobId
                || job.appInstallationId == ownership.installationId
                || job.appOwnerId == ownership.ownerId
                || job.appSetupAttemptId == ownership.setupAttemptId
        }
        let owned = exactIdJobs.count == 1 ? exactIdJobs[0] : nil
        let exactMarkers = owned?.appInstallationId == ownership.installationId
            && owned?.appOwnerId == ownership.ownerId
            && owned?.appSetupAttemptId == ownership.setupAttemptId
        let duplicateAttribution = attributable.contains { job in
            guard let owned else { return true }
            return job.id != owned.id || job.appInstallationId != owned.appInstallationId
                || job.appOwnerId != owned.appOwnerId
                || job.appSetupAttemptId != owned.appSetupAttemptId
        } || attributable.count != 1
        return HermesCronInventory(
            ownedJob: owned,
            attributableJobs: attributable,
            enabledAttributableJobs: attributable.filter(\.enabled),
            isExact: exactIdJobs.count == 1 && exactMarkers && !duplicateAttribution
        )
    }

    /// Resolve the sole paused, marker-fenced job that may be rebound from the
    /// historical pre-owner installation schema. This is intentionally narrower
    /// than ordinary ownership: owner attribution must be absent, while the
    /// immutable ID plus installation and old setup generation must all match.
    func preOwnerRebindJob(
        jobId: String,
        installationId: String,
        setupAttemptId: String
    ) throws -> HermesCronJob {
        let allJobs = try jobs()
        let attributable = allJobs.filter {
            $0.id == jobId
                || $0.appInstallationId == installationId
                || $0.appSetupAttemptId == setupAttemptId
        }
        guard attributable.count == 1,
              let job = attributable.first,
              job.id == jobId,
              job.appInstallationId == installationId,
              job.appSetupAttemptId == setupAttemptId,
              job.appOwnerId == nil,
              job.enabled == false else {
            throw HermesRuntimeFailure.cronStoreInvalid
        }
        return job
    }

    /// Upgrade only the exact historical, paused, owner-less job shape. This
    /// creates the installation + old-generation fence needed for a later
    /// explicit rebind without treating a same-name or modified job as owned.
    func adoptHistoricalPreOwnerMarkers(
        jobId: String,
        installationId: String,
        setupAttemptId: String,
        expectedName: String,
        expectedSchedule: String,
        expectedPrompt: String
    ) throws {
        do {
            try HermesFilesystem.withAdvisoryLock(
                siblingOf: jobsURL,
                lockName: ".jobs.lock"
            ) { parent in
                guard let snapshot = try HermesFilesystem.readRegularFile(
                    in: parent,
                    name: jobsURL.lastPathComponent
                ),
                var root = try JSONSerialization.jsonObject(with: snapshot.data) as? [String: Any],
                var jobs = root["jobs"] as? [[String: Any]] else {
                    throw HermesRuntimeFailure.cronStoreInvalid
                }
                let matches = jobs.indices.filter { jobs[$0]["id"] as? String == jobId }
                guard matches.count == 1 else {
                    throw matches.isEmpty
                        ? HermesRuntimeFailure.cronStoreInvalid
                        : HermesRuntimeFailure.cronAmbiguous
                }
                let index = matches[0]
                let raw = jobs[index]
                var schedule = raw["schedule_display"] as? String
                if let direct = raw["schedule"] as? String { schedule = direct }
                if let object = raw["schedule"] as? [String: Any] {
                    schedule = (object["expr"] as? String)
                        ?? (object["display"] as? String)
                        ?? schedule
                }
                let state = (raw["state"] as? String)?.lowercased()
                let enabled = ((raw["enabled"] as? Bool) ?? (state != "paused"))
                    && state != "paused"
                let markerTupleIsAbsent = raw["index_app_installation_id"] == nil
                    && raw["index_app_owner_id"] == nil
                    && raw["index_app_setup_attempt_id"] == nil
                let markerTupleIsAlreadyExact = raw["index_app_installation_id"] as? String == installationId
                    && raw["index_app_owner_id"] == nil
                    && raw["index_app_setup_attempt_id"] as? String == setupAttemptId
                guard raw["name"] as? String == expectedName,
                      schedule?.trimmingCharacters(in: .whitespacesAndNewlines) == expectedSchedule,
                      raw["prompt"] as? String == expectedPrompt,
                      !enabled, state == "paused",
                      (raw["skills"] as? [String] ?? []).isEmpty,
                      raw["skill"] == nil,
                      (raw["enabled_toolsets"] as? [String] ?? []).isEmpty,
                      markerTupleIsAbsent || markerTupleIsAlreadyExact else {
                    throw HermesRuntimeFailure.cronStoreInvalid
                }
                jobs[index]["index_app_installation_id"] = installationId
                jobs[index]["index_app_setup_attempt_id"] = setupAttemptId
                root["jobs"] = jobs
                let data = try JSONSerialization.data(
                    withJSONObject: root,
                    options: [.prettyPrinted, .sortedKeys]
                )
                try HermesSecureFileWriter.write(
                    data,
                    in: parent,
                    destinationName: jobsURL.lastPathComponent,
                    expected: .identity(snapshot.identity)
                )
            }
        } catch let failure as HermesRuntimeFailure {
            throw failure
        } catch {
            throw HermesRuntimeFailure.cronStoreInvalid
        }
    }

    /// Find pre-ID marker residue without ever treating a display name as an
    /// operational capability. This is used only to fail closed before initial
    /// adoption/creation.
    func markedJobs(installationId: String) throws -> [HermesCronJob] {
        try jobs().filter { $0.appInstallationId == installationId }
    }

    func job(id: String) throws -> HermesCronJob? {
        let matches = try jobs().filter { $0.id == id }
        guard matches.count <= 1 else { throw HermesRuntimeFailure.cronAmbiguous }
        return matches.first
    }

    private func jobs() throws -> [HermesCronJob] {
        let snapshot: HermesFileSnapshot?
        do { snapshot = try HermesFilesystem.readRegularFile(jobsURL) }
        catch { throw HermesRuntimeFailure.cronStoreInvalid }
        guard let snapshot else { return [] }
        guard let root = try? JSONSerialization.jsonObject(with: snapshot.data) as? [String: Any],
              let rawJobs = root["jobs"] as? [[String: Any]] else {
            throw HermesRuntimeFailure.cronStoreInvalid
        }

        return try rawJobs.map { raw in
            guard let id = raw["id"] as? String, !id.isEmpty,
                  let name = raw["name"] as? String, !name.isEmpty else {
                throw HermesRuntimeFailure.cronStoreInvalid
            }
            let state = (raw["state"] as? String)?.lowercased()
            let explicitEnabled = raw["enabled"] as? Bool
            let enabled = explicitEnabled ?? (state != "paused")

            var schedule = raw["schedule_display"] as? String
            if let direct = raw["schedule"] as? String { schedule = direct }
            if let object = raw["schedule"] as? [String: Any] {
                schedule = (object["expr"] as? String)
                    ?? (object["display"] as? String)
                    ?? schedule
            }
            return HermesCronJob(
                id: id,
                name: name,
                prompt: raw["prompt"] as? String,
                schedule: schedule?.trimmingCharacters(in: .whitespacesAndNewlines),
                enabled: enabled && state != "paused",
                skills: raw["skills"] as? [String] ?? [],
                legacySkill: raw["skill"] as? String,
                enabledToolsets: raw["enabled_toolsets"] as? [String] ?? [],
                appInstallationId: raw["index_app_installation_id"] as? String,
                appOwnerId: raw["index_app_owner_id"] as? String,
                appSetupAttemptId: raw["index_app_setup_attempt_id"] as? String
            )
        }
    }

    /// Hermes' public CLI can attach skills but currently does not expose the
    /// per-job enabled_toolsets or app ownership markers. Patch only the job
    /// selected by immutable ID while holding Hermes' own `.jobs.lock`.
    func enforceOwnedSandbox(
        ownership: HermesCronOwnership,
        markersOnly: Bool = false
    ) throws {
        do {
            try HermesFilesystem.withAdvisoryLock(
                siblingOf: jobsURL,
                lockName: ".jobs.lock"
            ) { parent in
                guard let snapshot = try HermesFilesystem.readRegularFile(
                    in: parent,
                    name: jobsURL.lastPathComponent
                ),
                var root = try JSONSerialization.jsonObject(with: snapshot.data) as? [String: Any],
                var jobs = root["jobs"] as? [[String: Any]] else {
                    throw HermesRuntimeFailure.cronStoreInvalid
                }
                let matches = jobs.indices.filter { index in
                    jobs[index]["id"] as? String == ownership.jobId
                }
                guard matches.count == 1 else {
                    throw matches.isEmpty
                        ? HermesRuntimeFailure.cronStoreInvalid
                        : HermesRuntimeFailure.cronAmbiguous
                }
                let index = matches[0]
                if !markersOnly {
                    jobs[index]["skills"] = [HermesRuntimeManager.ownedCronSkill]
                    jobs[index]["skill"] = HermesRuntimeManager.ownedCronSkill
                    jobs[index]["enabled_toolsets"] = [HermesRuntimeManager.ownedCronToolset]
                }
                jobs[index]["index_app_installation_id"] = ownership.installationId
                jobs[index]["index_app_owner_id"] = ownership.ownerId
                jobs[index]["index_app_setup_attempt_id"] = ownership.setupAttemptId
                root["jobs"] = jobs
                let data = try JSONSerialization.data(
                    withJSONObject: root,
                    options: [.prettyPrinted, .sortedKeys]
                )
                try HermesSecureFileWriter.write(
                    data,
                    in: parent,
                    destinationName: jobsURL.lastPathComponent,
                    expected: .identity(snapshot.identity)
                )
            }
        } catch let failure as HermesRuntimeFailure {
            throw failure
        } catch {
            throw HermesRuntimeFailure.cronEditFailed
        }
    }
}

private enum HermesGatewayState {
    case running(pid: Int32)
    case stopped

    static func parse(_ result: HermesCommandOutput) throws -> HermesGatewayState {
        guard result.status == 0 else { throw HermesRuntimeFailure.gatewayStatusFailed }
        let pidPattern = try NSRegularExpression(
            pattern: #"^\s*(?:PID\s*[:=]\s*|\"pid\"\s*:\s*)([0-9]+)\s*[,;]?\s*$"#,
            options: [.caseInsensitive]
        )
        for line in result.output.components(separatedBy: .newlines) {
            let range = NSRange(line.startIndex..<line.endIndex, in: line)
            if let match = pidPattern.firstMatch(in: line, range: range),
               let capture = Range(match.range(at: 1), in: line),
               let pid = Int32(String(line[capture])), pid > 0 {
                return .running(pid: pid)
            }
        }
        let stoppedPattern = try NSRegularExpression(
            pattern: #"^\s*(?:(?:Status\s*:|state\s*=)\s*|Gateway\s+is\s+)?(?:stopped|not running|exited)\.?\s*$"#,
            options: [.caseInsensitive]
        )
        if result.output.components(separatedBy: .newlines).contains(where: { line in
            let range = NSRange(line.startIndex..<line.endIndex, in: line)
            return stoppedPattern.firstMatch(in: line, range: range) != nil
        }) {
            return .stopped
        }
        throw HermesRuntimeFailure.gatewayStatusFailed
    }
}

final class HermesRuntimeManager {
    static let ownedCronName = "Index Personal Agent Negotiator"
    static let ownedCronSchedule = "every 1m"
    static let ownedCronPrompt = #"Run one scheduled autonomous Index negotiation pass."#
    static let historicalPreOwnerCronPrompt = #"Use skill_view("index-network:index-negotiator") and run one scheduled autonomous Index negotiation pass."#
    static let ownedCronSkill = "index-network:index-negotiator"
    static let ownedCronToolset = "index-network"

    private let manager = FileManager.default
    private let runner: HermesCommandRunning
    private let binaryProvider: () -> String?
    private let applicationSupportURL: URL?
    private let hermesHome: URL
    private let environment: HermesEnvironmentFile
    private let cronStore: HermesCronStore

    init(
        runner: HermesCommandRunning = HermesCommandRunner(),
        binaryProvider: @escaping () -> String? = {
            HarnessDetector.detect().first(where: { $0["id"] == "hermes" })?["path"]
        },
        applicationSupportURL: URL? = nil,
        hermesHomeURL: URL? = nil
    ) {
        self.runner = runner
        self.binaryProvider = binaryProvider
        self.applicationSupportURL = applicationSupportURL
        hermesHome = hermesHomeURL ?? URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".hermes", isDirectory: true)
        environment = HermesEnvironmentFile(homeURL: hermesHome)
        cronStore = HermesCronStore(homeURL: hermesHome)
    }

    private func localStore() throws -> HermesLocalStore {
        try HermesLocalStore(applicationSupportURL: applicationSupportURL)
    }

    private func cronOwnership(_ installation: HermesInstallationRecord) throws -> HermesCronOwnership? {
        let fields = [
            installation.currentCronJobId,
            installation.currentOwnerId,
            installation.currentCronSetupAttemptId,
        ]
        if fields.allSatisfy({ $0 == nil }) { return nil }
        guard let jobId = validValue(installation.currentCronJobId),
              let ownerId = validValue(installation.currentOwnerId),
              let setupAttemptId = validValue(installation.currentCronSetupAttemptId) else {
            throw HermesRuntimeFailure.installationStoreInvalid
        }
        return HermesCronOwnership(
            jobId: jobId,
            installationId: installation.installationId,
            ownerId: ownerId,
            setupAttemptId: setupAttemptId
        )
    }

    /// Native half of the logout barrier. A page message alone can never revoke
    /// the owner key: the same owner must have durable disconnect evidence, and
    /// native independently reproves both schedule quarantine and secret scrub.
    func logoutEvidence(ownerId: String) -> HermesSagaOperationRecord? {
        guard validValue(ownerId) != nil else { return nil }
        do {
            let store = try localStore()
            guard let evidence = try store.loadOperation(),
                  evidence.operation == "disconnect",
                  evidence.stage == "server-complete",
                  evidence.ownerId == ownerId else { return nil }
            let installation = try store.loadOrCreateInstallation()
            guard evidence.installationId == installation.installationId,
                  installation.currentOwnerId == nil || installation.currentOwnerId == ownerId,
                  evidence.setupAttemptId == installation.currentSetupAttemptId,
                  evidence.executorId == installation.currentExecutorId else {
                return nil
            }
            try verifyLogoutPostconditions(installation: installation)
            return evidence
        } catch {
            return nil
        }
    }

    func finishLogoutEvidence(_ evidence: HermesSagaOperationRecord) {
        guard evidence.operation == "disconnect",
              evidence.stage == "server-complete",
              let store = try? localStore() else { return }
        _ = try? store.clearOperation(expected: evidence)
    }

    func handle(_ request: HermesRuntimeRequest) -> HermesRuntimeResult {
        do {
            guard !request.requestId.isEmpty else { throw HermesRuntimeFailure.invalidArguments }
            switch request.command {
            case .inspect:
                return try inspect(request)
            case .configureDisabled:
                return try configureDisabled(request)
            case .enable:
                return try enable(request)
            case .confirmHealthy:
                return try confirmHealthy(request)
            case .disable:
                return try disable(request)
            case .prepareLogout:
                return try prepareLogout(request)
            case .disconnect:
                return try disconnect(request)
            case .loadOperation:
                return try loadOperation(request)
            case .saveOperation:
                return try saveOperation(request)
            case .clearOperation:
                return try clearOperation(request)
            }
        } catch let failure as HermesRuntimeFailure {
            return HermesRuntimeResult(
                requestId: request.requestId,
                ok: false,
                stage: request.command.rawValue,
                state: try? localState(),
                errorCode: failure.code,
                retryable: failure.retryable
            )
        } catch {
            return HermesRuntimeResult(
                requestId: request.requestId,
                ok: false,
                stage: request.command.rawValue,
                state: try? localState(),
                errorCode: HermesRuntimeFailure.internalFailure.code,
                retryable: true
            )
        }
    }

    private func loadOperation(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        HermesRuntimeResult(
            requestId: request.requestId,
            ok: true,
            stage: "operation_loaded",
            state: nil,
            operationJournal: try localStore().loadOperation(),
            errorCode: nil,
            retryable: false
        )
    }

    private func saveOperation(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        guard let record = request.operationJournal else {
            throw HermesRuntimeFailure.operationStoreInvalid
        }
        let store = try localStore()
        try store.saveOperation(record)
        return HermesRuntimeResult(
            requestId: request.requestId,
            ok: true,
            stage: "operation_saved",
            state: nil,
            operationJournal: try store.loadOperation(),
            errorCode: nil,
            retryable: false
        )
    }

    private func clearOperation(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        guard let expected = request.operationJournal else {
            throw HermesRuntimeFailure.operationStoreInvalid
        }
        return HermesRuntimeResult(
            requestId: request.requestId,
            ok: true,
            stage: "operation_cleared",
            state: nil,
            operationJournal: try localStore().clearOperation(expected: expected),
            errorCode: nil,
            retryable: false
        )
    }

    private func pauseCronByID(_ hermes: String, jobId: String) throws {
        let result = try runner.run(executable: hermes, arguments: ["cron", "pause", jobId])
        guard result.status == 0 else { throw HermesRuntimeFailure.cronPauseFailed }
        guard let verified = try cronStore.job(id: jobId), verified.enabled == false else {
            throw HermesRuntimeFailure.cronPauseFailed
        }
    }

    /// Best-effort quarantine operates only on immutable IDs discovered from
    /// the stored ID or app markers. It never turns a display-name collision
    /// into an operational capability.
    private func quarantineAttributableCron(_ ownership: HermesCronOwnership) throws {
        var inventory = try cronStore.inventory(ownership: ownership)
        if !inventory.enabledAttributableJobs.isEmpty {
            let hermes = try requireHermesBinary()
            for jobId in Set(inventory.enabledAttributableJobs.map(\.id)) {
                let result = try runner.run(
                    executable: hermes,
                    arguments: ["cron", "pause", jobId]
                )
                guard result.status == 0 else { throw HermesRuntimeFailure.cronPauseFailed }
            }
            inventory = try cronStore.inventory(ownership: ownership)
        }
        guard inventory.enabledAttributableJobs.isEmpty else {
            throw HermesRuntimeFailure.cronPauseFailed
        }
    }

    private func verifiedOwnedCron(
        installation: HermesInstallationRecord
    ) throws -> (HermesCronOwnership, HermesCronJob)? {
        guard let ownership = try cronOwnership(installation) else {
            let marked = try cronStore.markedJobs(installationId: installation.installationId)
            if !marked.isEmpty {
                if marked.contains(where: \.enabled) {
                    let hermes = try requireHermesBinary()
                    for jobId in Set(marked.filter(\.enabled).map(\.id)) {
                        let result = try runner.run(
                            executable: hermes,
                            arguments: ["cron", "pause", jobId]
                        )
                        guard result.status == 0 else {
                            throw HermesRuntimeFailure.cronPauseFailed
                        }
                    }
                }
                throw HermesRuntimeFailure.cronStoreInvalid
            }
            return nil
        }
        let inventory = try cronStore.inventory(ownership: ownership)
        guard inventory.isExact,
              let job = inventory.ownedJob,
              isExactOwnedCron(job) else {
            try quarantineAttributableCron(ownership)
            throw HermesRuntimeFailure.cronStoreInvalid
        }
        return (ownership, job)
    }

    /// One-time migration from the historical unique exact display name. The
    /// generated ID is persisted before any later operation; all subsequent
    /// reads, pauses, edits, and removals use that ID and marker inventory.
    private func adoptLegacyCronIfNeeded(
        installation: inout HermesInstallationRecord,
        store: HermesLocalStore
    ) throws {
        guard let generation = validValue(installation.currentSetupAttemptId) else { return }
        let legacy: HermesCronJob
        if let capturedID = validValue(installation.currentCronJobId) {
            // Resume a crash-interrupted pre-owner adoption by immutable ID.
            guard installation.currentOwnerId == nil,
                  installation.currentExecutorId == nil,
                  installation.currentCronSetupAttemptId == generation,
                  let captured = try cronStore.job(id: capturedID) else { return }
            legacy = captured
        } else {
            guard let namedLegacy = try cronStore.legacyJob() else { return }
            legacy = namedLegacy
            installation.currentCronJobId = legacy.id
            installation.currentCronSetupAttemptId = generation
            try store.saveInstallation(installation)
        }

        // A display name is sufficient only to capture and pause the historical
        // ID. It never makes legacy prompt/tool fields trusted or executable.
        if legacy.enabled {
            try pauseCronByID(try requireHermesBinary(), jobId: legacy.id)
        }
        if let journal = try? store.loadJournal(),
           journal.setupAttemptId == generation {
            try store.saveJournal(HermesSetupJournal(
                setupAttemptId: journal.setupAttemptId,
                stage: journal.stage,
                ownerId: journal.ownerId,
                executorId: journal.executorId,
                cronJobId: legacy.id
            ))
        }
        guard let ownerId = validValue(installation.currentOwnerId) else {
            guard installation.currentExecutorId == nil else {
                throw HermesRuntimeFailure.installationStoreInvalid
            }
            try cronStore.adoptHistoricalPreOwnerMarkers(
                jobId: legacy.id,
                installationId: installation.installationId,
                setupAttemptId: generation,
                expectedName: Self.ownedCronName,
                expectedSchedule: Self.ownedCronSchedule,
                expectedPrompt: Self.historicalPreOwnerCronPrompt
            )
            return
        }
        let ownership = HermesCronOwnership(
            jobId: legacy.id,
            installationId: installation.installationId,
            ownerId: ownerId,
            setupAttemptId: generation
        )
        try cronStore.enforceOwnedSandbox(
            ownership: ownership,
            markersOnly: true
        )
    }

    private func inspect(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try localStore()
        var installation = try store.loadOrCreateInstallation()
        try adoptLegacyCronIfNeeded(installation: &installation, store: store)
        var journal: HermesSetupJournal?
        do {
            journal = try store.loadJournal()
        } catch let failure as HermesRuntimeFailure {
            // Preserve malformed native recovery evidence. Quarantine only the
            // immutable ID/marker inventory before surfacing journal_invalid.
            if case .journalInvalid = failure,
               let ownership = try cronOwnership(installation) {
                try quarantineAttributableCron(ownership)
            }
            throw failure
        }
        if let journal {
            let terminalDisconnect = installation.currentSetupAttemptId == nil
                && journal.stage == .disconnectCleanupComplete
            let generationMismatch = !terminalDisconnect
                && (journal.setupAttemptId != installation.currentSetupAttemptId
                    || journal.ownerId != installation.currentOwnerId
                    || journal.executorId != installation.currentExecutorId)
            let cronPublishedStages: Set<HermesSetupStage> = [
                .scheduleDisabled, .enabling, .awaitingHeartbeat,
                .disconnecting, .disconnectCleanupComplete,
            ]
            let mismatchedCronFence = journal.cronJobId != nil
                && journal.cronJobId != installation.currentCronJobId
            let missingCronFence = cronPublishedStages.contains(journal.stage)
                && journal.cronJobId == nil
            if generationMismatch || mismatchedCronFence || missingCronFence {
                if let ownership = try cronOwnership(installation) {
                    try quarantineAttributableCron(ownership)
                }
                throw HermesRuntimeFailure.journalInvalid
            }
        }
        if installation.currentSetupAttemptId == nil,
           journal?.stage == .disconnectCleanupComplete {
            try finishTerminalDisconnect(store: store, installation: installation)
            installation.currentOwnerId = nil
            installation.currentExecutorId = nil
            installation.currentCronJobId = nil
            installation.currentCronSetupAttemptId = nil
            try store.saveInstallation(installation)
            journal = nil
        }
        let generationOwnerIsUnattributed = installation.currentSetupAttemptId != nil
            && (installation.currentOwnerId?.isEmpty != false
                || installation.currentExecutorId?.isEmpty != false)
        if generationOwnerIsUnattributed {
            // Pre-owner migration is observation-only. The one-time exact-name
            // adoption persisted the immutable ID, then this path pauses it
            // without assigning the inspecting login.
            if let jobId = installation.currentCronJobId,
               try cronStore.job(id: jobId)?.enabled == true {
                try pauseCronByID(try requireHermesBinary(), jobId: jobId)
            }
            throw HermesRuntimeFailure.ownerUnattributed
        }
        let cron = try verifiedOwnedCron(installation: installation)?.1
        if journal != nil, cron?.enabled == true {
            try pauseCronByID(try requireHermesBinary(), jobId: cron!.id)
        }
        return HermesRuntimeResult(
            requestId: request.requestId,
            ok: true,
            stage: journal?.stage.rawValue ?? "inspected",
            state: try localState(),
            errorCode: nil,
            retryable: false
        )
    }

    private func configureDisabled(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try localStore()
        var installation = try store.loadOrCreateInstallation()
        guard let ownerId = validValue(request.ownerId),
              let requestedInstallationId = request.installationId,
              requestedInstallationId == installation.installationId,
              let executorId = validValue(request.executorId),
              let setupAttemptId = validValue(request.setupAttemptId),
              let credential = validValue(request.credential) else {
            throw HermesRuntimeFailure.invalidArguments
        }

        // Resolve a historical job once before publishing the new generation.
        // A pre-owner record has no owner with which to construct ordinary
        // ownership, so its one explicit rebind path runs first and accepts only
        // a paused immutable ID with exact installation + old-generation markers
        // and the shipping sandbox. Every attributed generation then uses the
        // ordinary strict owner validation below.
        try adoptLegacyCronIfNeeded(installation: &installation, store: store)
        var priorCron: HermesCronJob?
        let preOwnerGeneration = validValue(installation.currentSetupAttemptId)
        let preOwnerRecord = preOwnerGeneration != nil
            && installation.currentOwnerId == nil
            && installation.currentExecutorId == nil
        if preOwnerRecord {
            guard try store.loadJournal() == nil,
                  let jobId = validValue(installation.currentCronJobId),
                  installation.currentCronSetupAttemptId == preOwnerGeneration else {
                throw HermesRuntimeFailure.installationStoreInvalid
            }
            let candidate = try cronStore.preOwnerRebindJob(
                jobId: jobId,
                installationId: installation.installationId,
                setupAttemptId: preOwnerGeneration!
            )
            guard isExactOwnedCron(candidate)
                    || isExactHistoricalPreOwnerCron(
                        candidate,
                        installationId: installation.installationId,
                        setupAttemptId: preOwnerGeneration!
                    ) else {
                throw HermesRuntimeFailure.cronStoreInvalid
            }
            priorCron = candidate
        } else {
            guard installation.currentOwnerId == nil
                    || installation.currentOwnerId == ownerId else {
                throw HermesRuntimeFailure.ownerMismatch
            }
            if let ownership = try cronOwnership(installation) {
                let inventory = try cronStore.inventory(ownership: ownership)
                if !inventory.isExact
                    || inventory.ownedJob.map({ isExactOwnedCron($0) }) != true {
                    try quarantineAttributableCron(ownership)
                }
                guard let stored = try cronStore.job(id: ownership.jobId) else {
                    throw HermesRuntimeFailure.cronStoreInvalid
                }
                priorCron = stored
            }
        }

        // Journal first: a crash after this point makes relaunch inspection
        // pause any owned schedule before JavaScript performs server rollback.
        try saveStage(
            .preparing, owner: ownerId, attempt: setupAttemptId,
            executor: executorId, cronJobId: installation.currentCronJobId, store: store
        )
        installation.currentOwnerId = ownerId
        installation.currentExecutorId = executorId
        installation.currentSetupAttemptId = setupAttemptId
        try store.saveInstallation(installation)

        let hermes = try requireHermesBinary()
        if priorCron?.enabled == true {
            try pauseCronByID(hermes, jobId: priorCron!.id)
        }

        do {
            try environment.upsert([
                ("INDEX_API_KEY", credential),
                ("INDEX_API_URL", AppConfig.apiBaseURL),
                ("INDEX_MCP_URL", AppConfig.trimTrailingSlash(AppConfig.apiURL) + "/mcp"),
                ("INDEX_AGENT_ID", executorId),
                ("INDEX_INSTALLATION_ID", installation.installationId),
                ("INDEX_PLUGIN_MODE", "negotiator"),
            ])
        } catch let failure as HermesRuntimeFailure {
            throw failure
        } catch {
            throw HermesRuntimeFailure.envWriteFailed
        }
        try saveStage(
            .environmentWritten, owner: ownerId, attempt: setupAttemptId,
            executor: executorId, store: store
        )

        try removeDesktopDashboard()
        try reconcilePlugin(hermes)
        try saveStage(
            .pluginInstalled, owner: ownerId, attempt: setupAttemptId,
            executor: executorId, store: store
        )

        try reconcileDisabledCron(
            hermes,
            installation: &installation,
            ownerId: ownerId,
            setupAttemptId: setupAttemptId,
            store: store
        )
        try saveStage(
            .scheduleDisabled, owner: ownerId, attempt: setupAttemptId,
            executor: executorId, cronJobId: installation.currentCronJobId, store: store
        )

        return try success(request, stage: HermesSetupStage.scheduleDisabled.rawValue)
    }

    private func enable(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try localStore()
        let installation = try store.loadOrCreateInstallation()
        guard let ownerId = validValue(request.ownerId),
              let expectedSetupAttemptId = validValue(request.setupAttemptId) else {
            throw HermesRuntimeFailure.invalidArguments
        }
        guard installation.currentOwnerId == ownerId else {
            throw HermesRuntimeFailure.ownerMismatch
        }
        guard installation.currentSetupAttemptId == expectedSetupAttemptId else {
            return try success(request, stage: "enable_noop")
        }

        let journal = try store.loadJournal()
        let executor: String
        if journal?.setupAttemptId == expectedSetupAttemptId {
            guard journal?.ownerId == ownerId, let journalExecutor = journal?.executorId else {
                throw HermesRuntimeFailure.journalInvalid
            }
            executor = journalExecutor
        } else if let currentExecutor = installation.currentExecutorId {
            executor = currentExecutor
        } else {
            throw HermesRuntimeFailure.installationStoreInvalid
        }

        guard let (_, job) = try verifiedOwnedCron(installation: installation) else {
            throw HermesRuntimeFailure.cronStoreInvalid
        }
        if let stage = alreadyEnabledCurrentGeneration(
            journal: journal,
            attempt: expectedSetupAttemptId,
            job: job
        ) {
            return try success(request, stage: stage)
        }

        try saveStage(
            .enabling, owner: ownerId, attempt: expectedSetupAttemptId,
            executor: executor, cronJobId: job.id, store: store
        )
        let hermes = try requireHermesBinary()
        if !job.enabled {
            let resume = try runner.run(executable: hermes, arguments: ["cron", "resume", job.id])
            guard resume.status == 0 else { throw HermesRuntimeFailure.cronResumeFailed }
            guard let (_, resumed) = try verifiedOwnedCron(installation: installation),
                  resumed.id == job.id,
                  resumed.enabled == true else {
                throw HermesRuntimeFailure.cronResumeFailed
            }
        }

        do {
            try startOrRestartGateway(hermes)
        } catch let failure as HermesRuntimeFailure {
            // Retain the enabling journal for relaunch recovery. A gateway
            // failure is safe only after the exact resumed job is confirmed
            // paused; otherwise report a distinct retryable rollback failure.
            try rollbackActivation(hermes, job: job)
            switch failure {
            case .gatewayStatusFailed, .commandTimedOut:
                throw failure
            default:
                throw HermesRuntimeFailure.gatewayFailed
            }
        } catch {
            try rollbackActivation(hermes, job: job)
            throw HermesRuntimeFailure.gatewayFailed
        }
        try saveStage(
            .awaitingHeartbeat, owner: ownerId, attempt: expectedSetupAttemptId,
            executor: executor, cronJobId: job.id, store: store
        )
        return try success(request, stage: HermesSetupStage.awaitingHeartbeat.rawValue)
    }

    private func isExactOwnedCron(_ job: HermesCronJob) -> Bool {
        job.name == Self.ownedCronName
            && job.schedule == Self.ownedCronSchedule
            && job.prompt == Self.ownedCronPrompt
            && job.skills == [Self.ownedCronSkill]
            && job.legacySkill == Self.ownedCronSkill
            && job.enabledToolsets == [Self.ownedCronToolset]
    }

    private func isExactHistoricalPreOwnerCron(
        _ job: HermesCronJob,
        installationId: String,
        setupAttemptId: String
    ) -> Bool {
        job.name == Self.ownedCronName
            && job.schedule == Self.ownedCronSchedule
            && job.prompt == Self.historicalPreOwnerCronPrompt
            && job.skills.isEmpty
            && job.legacySkill == nil
            && job.enabledToolsets.isEmpty
            && job.appInstallationId == installationId
            && job.appOwnerId == nil
            && job.appSetupAttemptId == setupAttemptId
            && !job.enabled
    }

    private func alreadyEnabledCurrentGeneration(
        journal: HermesSetupJournal?,
        attempt: String,
        job: HermesCronJob
    ) -> String? {
        guard job.enabled else { return nil }
        if journal == nil { return "confirmed_healthy" }
        guard journal?.setupAttemptId == attempt,
              journal?.stage == .awaitingHeartbeat else { return nil }
        return HermesSetupStage.awaitingHeartbeat.rawValue
    }

    private func confirmHealthy(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try localStore()
        let installation = try store.loadOrCreateInstallation()
        guard let ownerId = validValue(request.ownerId),
              let expectedSetupAttemptId = validValue(request.setupAttemptId) else {
            throw HermesRuntimeFailure.invalidArguments
        }
        guard installation.currentOwnerId == ownerId else {
            throw HermesRuntimeFailure.ownerMismatch
        }
        guard installation.currentSetupAttemptId == expectedSetupAttemptId else {
            return try success(request, stage: "confirm_healthy_noop")
        }
        guard let journal = try store.loadJournal() else {
            return try success(request, stage: "confirmed_healthy")
        }
        guard journal.setupAttemptId == expectedSetupAttemptId else {
            return try success(request, stage: "confirm_healthy_noop")
        }
        guard journal.ownerId == ownerId else {
            throw HermesRuntimeFailure.ownerMismatch
        }
        guard journal.stage == .awaitingHeartbeat else {
            throw HermesRuntimeFailure.invalidArguments
        }

        // Invocation of confirmHealthy is the JS saga's attestation that the
        // backend observed an active pickup heartbeat for this generation. The
        // immutable job and sandbox are reverified before recovery evidence is
        // cleared, closing the enable-to-heartbeat tamper window.
        guard let (_, job) = try verifiedOwnedCron(installation: installation),
              job.enabled else {
            throw HermesRuntimeFailure.cronStoreInvalid
        }
        try store.deleteJournal()
        return try success(request, stage: "confirmed_healthy")
    }

    private func verifyNoEnabledAttributableCron(
        installation: HermesInstallationRecord
    ) throws {
        if let ownership = try cronOwnership(installation) {
            let inventory = try cronStore.inventory(ownership: ownership)
            guard inventory.enabledAttributableJobs.isEmpty else {
                throw HermesRuntimeFailure.cronPauseFailed
            }
            return
        }
        guard try cronStore.markedJobs(installationId: installation.installationId)
            .contains(where: \.enabled) == false else {
            throw HermesRuntimeFailure.cronPauseFailed
        }
    }

    private func verifyLogoutPostconditions(
        installation: HermesInstallationRecord
    ) throws {
        try verifyNoEnabledAttributableCron(installation: installation)
        if let ownership = try cronOwnership(installation) {
            let inventory = try cronStore.inventory(ownership: ownership)
            guard inventory.isExact,
                  let job = inventory.ownedJob,
                  isExactOwnedCron(job),
                  job.enabled == false else {
                throw HermesRuntimeFailure.cronStoreInvalid
            }
        } else {
            guard try cronStore.markedJobs(installationId: installation.installationId).isEmpty else {
                throw HermesRuntimeFailure.cronStoreInvalid
            }
        }
        let env = try environment.values()
        guard env["INDEX_API_KEY"] == nil,
              Set(env.keys).intersection(HermesEnvironmentFile.ownedKeys).isEmpty else {
            throw HermesRuntimeFailure.envWriteFailed
        }
    }

    private func disable(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try localStore()
        var installation = try store.loadOrCreateInstallation()
        guard let ownerId = validValue(request.ownerId),
              installation.currentOwnerId == ownerId,
              let expectedSetupAttemptId = validValue(request.setupAttemptId),
              installation.currentSetupAttemptId == expectedSetupAttemptId else {
            return try success(request, stage: "disable_noop")
        }
        try adoptLegacyCronIfNeeded(installation: &installation, store: store)
        guard let (_, job) = try verifiedOwnedCron(installation: installation) else {
            return try success(request, stage: "disabled")
        }
        if job.enabled {
            try pauseCronByID(try requireHermesBinary(), jobId: job.id)
        }
        try verifyNoEnabledAttributableCron(installation: installation)
        return try success(request, stage: "disabled")
    }

    /// Local logout cleanup is deliberately separate from server reachability.
    /// It fences the current owner/generation, quarantines attributable cron
    /// jobs, and scrubs all app-owned Hermes environment wiring before the Mac
    /// owner CLI credential can be revoked.
    private func prepareLogout(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try localStore()
        var installation = try store.loadOrCreateInstallation()
        guard let ownerId = validValue(request.ownerId) else {
            throw HermesRuntimeFailure.invalidArguments
        }
        if let currentAttempt = installation.currentSetupAttemptId {
            guard installation.currentOwnerId == ownerId,
                  request.setupAttemptId == currentAttempt else {
                throw HermesRuntimeFailure.ownerMismatch
            }
        } else {
            guard installation.currentOwnerId == nil || installation.currentOwnerId == ownerId,
                  request.setupAttemptId == nil else {
                throw HermesRuntimeFailure.ownerMismatch
            }
        }

        var pendingFailure: HermesRuntimeFailure?
        do {
            try adoptLegacyCronIfNeeded(installation: &installation, store: store)
            if let (_, job) = try verifiedOwnedCron(installation: installation), job.enabled {
                try pauseCronByID(try requireHermesBinary(), jobId: job.id)
            }
            try verifyNoEnabledAttributableCron(installation: installation)
        } catch let failure as HermesRuntimeFailure {
            pendingFailure = failure
        }

        // Scrub the dedicated key and its app-owned companion wiring even when
        // server disconnect or cron quarantine is uncertain.
        do { try environment.removeOwnedValues() }
        catch let failure as HermesRuntimeFailure {
            if pendingFailure == nil { pendingFailure = failure }
        }

        do { try verifyLogoutPostconditions(installation: installation) }
        catch let failure as HermesRuntimeFailure {
            if pendingFailure == nil { pendingFailure = failure }
        }
        if let pendingFailure { throw pendingFailure }
        return try success(request, stage: "logout_prepared")
    }

    private func disconnect(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try localStore()
        var installation = try store.loadOrCreateInstallation()
        try adoptLegacyCronIfNeeded(installation: &installation, store: store)
        guard let ownerId = validValue(request.ownerId),
              let expectedSetupAttemptId = validValue(request.setupAttemptId) else {
            throw HermesRuntimeFailure.invalidArguments
        }
        let journal = try store.loadJournal()
        if installation.currentSetupAttemptId == nil {
            // A prepare response can be lost before configureDisabled publishes
            // any native generation. Nil owner + nil setup journal is positive
            // local evidence that there is nothing to clean; treat this exact
            // generation request as a safe terminal no-op. A retained owner,
            // terminal journal, newer generation, or cross-owner record still
            // follows the strict fences below.
            if installation.currentOwnerId == nil, journal == nil {
                return try success(request, stage: "disconnected")
            }
            guard installation.currentOwnerId == ownerId else {
                throw HermesRuntimeFailure.ownerMismatch
            }
            guard journal?.ownerId == ownerId,
                  journal?.setupAttemptId == expectedSetupAttemptId,
                  journal?.stage == .disconnectCleanupComplete else {
                return try success(request, stage: "disconnect_noop")
            }
            try finishTerminalDisconnect(store: store, installation: installation)
            installation.currentOwnerId = nil
            installation.currentExecutorId = nil
            installation.currentCronJobId = nil
            installation.currentCronSetupAttemptId = nil
            try store.saveInstallation(installation)
            return try success(request, stage: "disconnected")
        }
        guard installation.currentOwnerId == ownerId else {
            throw HermesRuntimeFailure.ownerMismatch
        }
        guard installation.currentSetupAttemptId == expectedSetupAttemptId else {
            return try success(request, stage: "disconnect_noop")
        }

        // Disconnect does not need to reread the credential-bearing env merely
        // to annotate recovery state; cleanup must still run if that file is
        // unreadable, with env removal itself reporting the stable failure.
        guard let executor = installation.currentExecutorId else {
            throw HermesRuntimeFailure.installationStoreInvalid
        }
        try saveStage(
            .disconnecting, owner: ownerId, attempt: expectedSetupAttemptId,
            executor: executor, cronJobId: installation.currentCronJobId, store: store
        )

        // Safe app-owned filesystem cleanup continues even when CLI work fails
        // or the executable disappeared. The generation/journal remain until
        // every exact postcondition (including cron and gateway bounce) proves.
        var pendingFailure: HermesRuntimeFailure?
        var disconnectOwnership: HermesCronOwnership?
        var attributableJobs: [HermesCronJob] = []
        do {
            disconnectOwnership = try cronOwnership(installation)
            if let disconnectOwnership {
                let inventory = try cronStore.inventory(ownership: disconnectOwnership)
                attributableJobs = inventory.attributableJobs
                // A missing immutable ID with no remaining marker cannot be
                // proven removed: it may have been renamed and stripped.
                if inventory.ownedJob == nil && attributableJobs.isEmpty {
                    pendingFailure = .cronStoreInvalid
                }
                try quarantineAttributableCron(disconnectOwnership)
                attributableJobs = try cronStore.inventory(
                    ownership: disconnectOwnership
                ).attributableJobs
            } else {
                attributableJobs = try cronStore.markedJobs(
                    installationId: installation.installationId
                )
            }
        } catch let failure as HermesRuntimeFailure {
            if pendingFailure == nil { pendingFailure = failure }
        }

        let pluginInstalled: Bool
        do { pluginInstalled = try isPluginInstalled() }
        catch let failure as HermesRuntimeFailure {
            pluginInstalled = false
            if pendingFailure == nil { pendingFailure = failure }
        }

        let hermes = availableHermesBinary()
        var gatewayWasRunning = false
        if let hermes {
            do {
                if case .running = try gatewayState(hermes) { gatewayWasRunning = true }
            } catch let failure as HermesRuntimeFailure {
                if pendingFailure == nil { pendingFailure = failure }
            } catch {
                if pendingFailure == nil { pendingFailure = .gatewayStatusFailed }
            }
        } else if pendingFailure == nil {
            pendingFailure = .hermesNotFound
        }

        if !attributableJobs.isEmpty {
            if let hermes {
                for jobId in Set(attributableJobs.map(\.id)) {
                    do {
                        let removed = try runner.run(
                            executable: hermes,
                            arguments: ["cron", "remove", jobId]
                        )
                        guard removed.status == 0 else {
                            throw HermesRuntimeFailure.cronRemoveFailed
                        }
                    } catch let failure as HermesRuntimeFailure {
                        if pendingFailure == nil { pendingFailure = failure }
                    } catch {
                        if pendingFailure == nil { pendingFailure = .cronRemoveFailed }
                    }
                }
            } else if pendingFailure == nil {
                pendingFailure = .hermesNotFound
            }
        }

        if pluginInstalled {
            if let hermes {
                do {
                    let removed = try runner.run(
                        executable: hermes,
                        arguments: ["plugins", "remove", "index-network"]
                    )
                    guard removed.status == 0 else {
                        throw HermesRuntimeFailure.pluginRemoveFailed
                    }
                } catch let failure as HermesRuntimeFailure {
                    if pendingFailure == nil { pendingFailure = failure }
                } catch {
                    if pendingFailure == nil { pendingFailure = .pluginRemoveFailed }
                }
            } else {
                do { try removePluginDirectory() }
                catch let failure as HermesRuntimeFailure {
                    if pendingFailure == nil { pendingFailure = failure }
                } catch {
                    if pendingFailure == nil { pendingFailure = .localCleanupFailed }
                }
            }
        }

        do { try removeDesktopDashboard() }
        catch let failure as HermesRuntimeFailure {
            if pendingFailure == nil { pendingFailure = failure }
        } catch {
            if pendingFailure == nil { pendingFailure = .localCleanupFailed }
        }
        do { try environment.removeOwnedValues() }
        catch let failure as HermesRuntimeFailure {
            if pendingFailure == nil { pendingFailure = failure }
        } catch {
            if pendingFailure == nil { pendingFailure = .envWriteFailed }
        }

        if gatewayWasRunning, let hermes {
            do { try restartConfirmedRunningGateway(hermes) }
            catch let failure as HermesRuntimeFailure {
                if pendingFailure == nil { pendingFailure = failure }
            } catch {
                if pendingFailure == nil { pendingFailure = .gatewayFailed }
            }
        }

        do {
            try verifyDisconnectPostconditions(
                installation: installation,
                expectedOwnership: disconnectOwnership
            )
        }
        catch let failure as HermesRuntimeFailure {
            if pendingFailure == nil { pendingFailure = failure }
        } catch {
            if pendingFailure == nil { pendingFailure = .localCleanupFailed }
        }
        if let pendingFailure { throw pendingFailure }

        // Publish a durable terminal state before clearing the generation. If
        // journal unlink then fails, a retry or relaunch inspection recognizes
        // this exact state, reproves postconditions, and completes the unlink.
        try saveStage(
            .disconnectCleanupComplete,
            owner: ownerId,
            attempt: expectedSetupAttemptId,
            executor: executor,
            cronJobId: installation.currentCronJobId,
            store: store
        )
        installation.currentSetupAttemptId = nil
        try store.saveInstallation(installation)
        try finishTerminalDisconnect(store: store, installation: installation)
        installation.currentOwnerId = nil
        installation.currentExecutorId = nil
        installation.currentCronJobId = nil
        installation.currentCronSetupAttemptId = nil
        try store.saveInstallation(installation)
        return try success(request, stage: "disconnected")
    }

    private func finishTerminalDisconnect(
        store: HermesLocalStore,
        installation: HermesInstallationRecord
    ) throws {
        try verifyDisconnectPostconditions(installation: installation)
        try store.deleteJournal()
    }

    private func reconcilePlugin(_ hermes: String) throws {
        let arguments: [String]
        let failure: HermesRuntimeFailure
        if try isPluginInstalled() {
            arguments = ["plugins", "enable", "index-network"]
            failure = .pluginEnableFailed
        } else {
            arguments = ["plugins", "install", "indexnetwork/hermes-plugin", "--enable"]
            failure = .pluginInstallFailed
        }
        let result = try runner.run(executable: hermes, arguments: arguments)
        guard result.status == 0 else { throw failure }
    }

    private func reconcileDisabledCron(
        _ hermes: String,
        installation: inout HermesInstallationRecord,
        ownerId: String,
        setupAttemptId: String,
        store: HermesLocalStore
    ) throws {
        let job: HermesCronJob
        if let storedId = installation.currentCronJobId {
            guard let stored = try cronStore.job(id: storedId) else {
                throw HermesRuntimeFailure.cronStoreInvalid
            }
            job = stored
        } else {
            guard try cronStore.markedJobs(
                installationId: installation.installationId
            ).isEmpty else {
                throw HermesRuntimeFailure.cronStoreInvalid
            }
            if let legacy = try cronStore.legacyJob() {
                job = legacy
            } else {
                let created = try runner.run(
                    executable: hermes,
                    arguments: [
                        "cron", "create", Self.ownedCronSchedule, Self.ownedCronPrompt,
                        "--name", Self.ownedCronName,
                    ]
                )
                guard created.status == 0,
                      let createdJob = try cronStore.legacyJob() else {
                    throw HermesRuntimeFailure.cronCreateFailed
                }
                job = createdJob
            }
        }

        // Persist the generated/adopted immutable ID and its generation before
        // the first pause/edit. A crash can therefore never force a later
        // display-name lookup.
        installation.currentCronJobId = job.id
        installation.currentCronSetupAttemptId = setupAttemptId
        try store.saveInstallation(installation)
        if let journal = try store.loadJournal(),
           journal.setupAttemptId == setupAttemptId {
            try store.saveJournal(HermesSetupJournal(
                setupAttemptId: journal.setupAttemptId,
                stage: journal.stage,
                ownerId: journal.ownerId,
                executorId: journal.executorId,
                cronJobId: job.id
            ))
        }
        let ownership = HermesCronOwnership(
            jobId: job.id,
            installationId: installation.installationId,
            ownerId: ownerId,
            setupAttemptId: setupAttemptId
        )

        if job.enabled { try pauseCronByID(hermes, jobId: job.id) }
        let edited = try runner.run(
            executable: hermes,
            arguments: [
                "cron", "edit", job.id,
                "--schedule", Self.ownedCronSchedule,
                "--prompt", Self.ownedCronPrompt,
                "--name", Self.ownedCronName,
            ]
        )
        guard edited.status == 0 else { throw HermesRuntimeFailure.cronEditFailed }

        // Hermes CLI supports skill attachment but not enabled_toolsets or our
        // marker fence. Update all of them under the official cron store lock.
        try cronStore.enforceOwnedSandbox(ownership: ownership)
        var inventory = try cronStore.inventory(ownership: ownership)
        guard inventory.isExact, let reconciled = inventory.ownedJob else {
            try quarantineAttributableCron(ownership)
            throw HermesRuntimeFailure.cronStoreInvalid
        }
        if reconciled.enabled {
            try pauseCronByID(hermes, jobId: reconciled.id)
            inventory = try cronStore.inventory(ownership: ownership)
        }
        guard inventory.isExact,
              let verified = inventory.ownedJob,
              isExactOwnedCron(verified),
              verified.enabled == false else {
            try quarantineAttributableCron(ownership)
            throw HermesRuntimeFailure.cronStoreInvalid
        }
    }

    private func rollbackActivation(_ hermes: String, job: HermesCronJob) throws {
        do {
            try pauseCronByID(hermes, jobId: job.id)
        } catch {
            throw HermesRuntimeFailure.activationRollbackFailed
        }
    }

    private func gatewayState(_ hermes: String) throws -> HermesGatewayState {
        try HermesGatewayState.parse(
            try runner.run(executable: hermes, arguments: ["gateway", "status"])
        )
    }

    private func startOrRestartGateway(_ hermes: String) throws {
        let action: String
        switch try gatewayState(hermes) {
        case .running:
            action = "restart"
        case .stopped:
            action = "start"
        }
        let transition = try runner.run(executable: hermes, arguments: ["gateway", action])
        guard transition.status == 0 else { throw HermesRuntimeFailure.gatewayFailed }
    }

    private func restartConfirmedRunningGateway(_ hermes: String) throws {
        let restarted = try runner.run(executable: hermes, arguments: ["gateway", "restart"])
        guard restarted.status == 0 else { throw HermesRuntimeFailure.gatewayFailed }
    }

    private var pluginURL: URL {
        hermesHome
            .appendingPathComponent("plugins", isDirectory: true)
            .appendingPathComponent("index-network", isDirectory: true)
    }

    private var dashboardURL: URL {
        hermesHome
            .appendingPathComponent("desktop-plugins", isDirectory: true)
            .appendingPathComponent("index-network", isDirectory: true)
    }

    private func ownedDirectoryExists(_ url: URL) throws -> Bool {
        guard let parent = try HermesFilesystem.openDirectory(
            url.deletingLastPathComponent(),
            createMissing: false
        ) else { return false }
        guard let status = try HermesFilesystem.entryStatus(
            in: parent,
            name: url.lastPathComponent
        ) else { return false }
        guard status.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              status.st_mode & mode_t(S_IFMT) != mode_t(S_IFLNK) else {
            throw HermesRuntimeFailure.localCleanupFailed
        }
        return true
    }

    private func isPluginInstalled() throws -> Bool {
        try ownedDirectoryExists(pluginURL)
    }

    private func removePluginDirectory() throws {
        try HermesFilesystem.removeOwnedDirectory(pluginURL)
    }

    private func removeDesktopDashboard() throws {
        try HermesFilesystem.removeOwnedDirectory(dashboardURL)
    }

    private func verifyDisconnectPostconditions(
        installation: HermesInstallationRecord,
        expectedOwnership: HermesCronOwnership? = nil
    ) throws {
        let ownership = try expectedOwnership ?? cronOwnership(installation)
        if let ownership {
            let inventory = try cronStore.inventory(ownership: ownership)
            guard inventory.attributableJobs.isEmpty,
                  inventory.enabledAttributableJobs.isEmpty,
                  try cronStore.job(id: ownership.jobId) == nil else {
                throw HermesRuntimeFailure.cronRemoveFailed
            }
        } else {
            guard try cronStore.markedJobs(
                installationId: installation.installationId
            ).isEmpty else {
                throw HermesRuntimeFailure.cronRemoveFailed
            }
        }
        guard try isPluginInstalled() == false,
              try ownedDirectoryExists(dashboardURL) == false else {
            throw HermesRuntimeFailure.localCleanupFailed
        }
        let remainingOwnedKeys = Set(try environment.values().keys)
            .intersection(HermesEnvironmentFile.ownedKeys)
        guard remainingOwnedKeys.isEmpty else {
            throw HermesRuntimeFailure.envWriteFailed
        }
    }

    private func availableHermesBinary() -> String? {
        guard let binary = binaryProvider(), !binary.isEmpty,
              manager.isExecutableFile(atPath: binary) else { return nil }
        return binary
    }

    private func requireHermesBinary() throws -> String {
        guard let binary = availableHermesBinary() else {
            throw HermesRuntimeFailure.hermesNotFound
        }
        return binary
    }

    private func saveStage(
        _ stage: HermesSetupStage,
        owner: String,
        attempt: String,
        executor: String,
        cronJobId: String? = nil,
        store: HermesLocalStore
    ) throws {
        try store.saveJournal(HermesSetupJournal(
            setupAttemptId: attempt,
            stage: stage,
            ownerId: owner,
            executorId: executor,
            cronJobId: cronJobId
        ))
    }

    private func localState() throws -> HermesLocalState {
        let store = try localStore()
        let installation = try store.loadOrCreateInstallation()
        let journal = try store.loadJournal()
        let env = try environment.values()
        let generationOwnerIsUnattributed = installation.currentSetupAttemptId != nil
            && (installation.currentOwnerId?.isEmpty != false
                || installation.currentExecutorId?.isEmpty != false)
        let cron: HermesCronJob?
        if generationOwnerIsUnattributed {
            // Legacy adoption may have durably captured the immutable ID before
            // owner/executor attribution existed. That partial tuple is not an
            // operational capability, but direct ID observation keeps the
            // stable installation identity and paused state available to the
            // JS reprovision path instead of making the error state unreadable.
            if let jobId = validValue(installation.currentCronJobId) {
                cron = try cronStore.job(id: jobId)
            } else {
                cron = nil
            }
        } else {
            cron = try verifiedOwnedCron(installation: installation)?.1
        }
        return HermesLocalState(
            installationId: installation.installationId,
            ownerId: journal?.ownerId ?? installation.currentOwnerId,
            executorId: journal?.executorId ?? installation.currentExecutorId ?? env["INDEX_AGENT_ID"],
            pluginInstalled: try isPluginInstalled(),
            negotiatorMode: env["INDEX_PLUGIN_MODE"] == "negotiator",
            schedulePresent: cron != nil,
            scheduleEnabled: cron?.enabled ?? false,
            setupAttemptId: journal?.setupAttemptId ?? installation.currentSetupAttemptId
        )
    }

    private func success(
        _ request: HermesRuntimeRequest,
        stage: String
    ) throws -> HermesRuntimeResult {
        HermesRuntimeResult(
            requestId: request.requestId,
            ok: true,
            stage: stage,
            state: try localState(),
            errorCode: nil,
            retryable: false
        )
    }

    private func validValue(_ value: String?) -> String? {
        guard let value, !value.isEmpty,
              value.rangeOfCharacter(from: .newlines) == nil,
              !value.contains("\0") else { return nil }
        return value
    }
}
