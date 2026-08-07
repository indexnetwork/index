import Foundation
import Darwin

// Request-correlated, local-only Hermes reconciliation. This file deliberately
// has no networking: JavaScript owns the server saga and passes only one
// bootstrap credential transiently to configureDisabled.
enum HermesRuntimeCommand: String, Decodable {
    case inspect, configureDisabled, enable, confirmHealthy, disable, disconnect
}

struct HermesRuntimeRequest: Decodable {
    let requestId: String
    let command: HermesRuntimeCommand
    let installationId: String?
    let executorId: String?
    let setupAttemptId: String?
    let credential: String?
}

struct HermesLocalState: Codable {
    let installationId: String
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
    let errorCode: String?
    let retryable: Bool
}

enum HermesSetupStage: String, Codable {
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

struct HermesSetupJournal: Codable {
    let setupAttemptId: String
    let stage: HermesSetupStage
    let executorId: String?
}

/// The completed generation is retained separately from the in-progress
/// journal. A healthy confirmation may therefore clear the journal while a
/// later stale disconnect is still fenced from the current local wiring.
struct HermesInstallationRecord: Codable {
    let installationId: String
    var currentSetupAttemptId: String?
}

private enum HermesRuntimeFailure: Error {
    case invalidArguments
    case hermesNotFound
    case installationStoreInvalid
    case installationStoreFailed
    case journalInvalid
    case journalWriteFailed
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
        case .localCleanupFailed: return "local_cleanup_failed"
        case .internalFailure: return "internal_failure"
        }
    }

    var retryable: Bool {
        switch self {
        case .invalidArguments, .installationStoreInvalid, .journalInvalid,
             .cronStoreInvalid, .cronAmbiguous:
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

private final class HermesLocalStore {
    private let manager = FileManager.default
    private let directoryURL: URL
    let installationURL: URL
    private let journalURL: URL

    init() throws {
        guard let applicationSupport = manager
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first else {
            throw HermesRuntimeFailure.installationStoreFailed
        }
        directoryURL = applicationSupport
            .appendingPathComponent(CredentialStore.service, isDirectory: true)
        installationURL = directoryURL.appendingPathComponent("hermes-installation.json")
        journalURL = directoryURL.appendingPathComponent("hermes-setup-journal.json")
        do {
            try HermesFilesystem.removeOrphanTemporaryFiles(
                in: directoryURL,
                destinationName: installationURL.lastPathComponent
            )
            try HermesFilesystem.removeOrphanTemporaryFiles(
                in: directoryURL,
                destinationName: journalURL.lastPathComponent
            )
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
                return record
            }
        } catch let failure as HermesRuntimeFailure {
            if case .installationStoreInvalid = failure { throw failure }
            throw HermesRuntimeFailure.installationStoreFailed
        }
        let record = HermesInstallationRecord(
            installationId: UUID().uuidString.lowercased(),
            currentSetupAttemptId: nil
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
              !journal.setupAttemptId.isEmpty else {
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
}

private final class HermesCronStore {
    private let jobsURL: URL

    init(homeURL: URL) {
        jobsURL = homeURL
            .appendingPathComponent("cron", isDirectory: true)
            .appendingPathComponent("jobs.json")
    }

    func ownedJob() throws -> HermesCronJob? {
        let matches = try jobs().filter {
            $0.name.caseInsensitiveCompare(HermesRuntimeManager.ownedCronName) == .orderedSame
        }
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
                enabled: enabled && state != "paused"
            )
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
    static let ownedCronPrompt = #"Use skill_view("index-network:index-negotiator") and run one scheduled autonomous Index negotiation pass."#

    private let manager = FileManager.default
    private let runner: HermesCommandRunning
    private let binaryProvider: () -> String?
    private let hermesHome: URL
    private let environment: HermesEnvironmentFile
    private let cronStore: HermesCronStore

    init(
        runner: HermesCommandRunning = HermesCommandRunner(),
        binaryProvider: @escaping () -> String? = {
            HarnessDetector.detect().first(where: { $0["id"] == "hermes" })?["path"]
        }
    ) {
        self.runner = runner
        self.binaryProvider = binaryProvider
        hermesHome = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".hermes", isDirectory: true)
        environment = HermesEnvironmentFile(homeURL: hermesHome)
        cronStore = HermesCronStore(homeURL: hermesHome)
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
            case .disconnect:
                return try disconnect(request)
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

    private func inspect(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try HermesLocalStore()
        let installation = try store.loadOrCreateInstallation()
        var journal = try store.loadJournal()
        if installation.currentSetupAttemptId == nil,
           journal?.stage == .disconnectCleanupComplete {
            try finishTerminalDisconnect(store: store)
            journal = nil
        }
        let cron = try cronStore.ownedJob()
        if journal != nil, cron?.enabled == true {
            let hermes = try requireHermesBinary()
            try pauseOwnedCron(hermes, knownJob: cron)
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
        let store = try HermesLocalStore()
        var installation = try store.loadOrCreateInstallation()
        guard let requestedInstallationId = request.installationId,
              requestedInstallationId == installation.installationId,
              let executorId = validValue(request.executorId),
              let setupAttemptId = validValue(request.setupAttemptId),
              let credential = validValue(request.credential) else {
            throw HermesRuntimeFailure.invalidArguments
        }

        // Journal first: a crash after this point makes relaunch inspection
        // pause any owned schedule before JavaScript performs server rollback.
        try saveStage(.preparing, attempt: setupAttemptId, executor: executorId, store: store)
        installation.currentSetupAttemptId = setupAttemptId
        try store.saveInstallation(installation)

        let hermes = try requireHermesBinary()
        if let existing = try cronStore.ownedJob(), existing.enabled {
            try pauseOwnedCron(hermes, knownJob: existing)
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
        try saveStage(.environmentWritten, attempt: setupAttemptId, executor: executorId, store: store)

        try removeDesktopDashboard()
        try reconcilePlugin(hermes)
        try saveStage(.pluginInstalled, attempt: setupAttemptId, executor: executorId, store: store)

        try reconcileDisabledCron(hermes)
        try saveStage(.scheduleDisabled, attempt: setupAttemptId, executor: executorId, store: store)

        return try success(request, stage: HermesSetupStage.scheduleDisabled.rawValue)
    }

    private func enable(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try HermesLocalStore()
        let installation = try store.loadOrCreateInstallation()
        guard let expectedSetupAttemptId = validValue(request.setupAttemptId) else {
            throw HermesRuntimeFailure.invalidArguments
        }
        guard installation.currentSetupAttemptId == expectedSetupAttemptId else {
            return try success(request, stage: "enable_noop")
        }

        let journal = try store.loadJournal()
        let executor: String?
        if journal?.setupAttemptId == expectedSetupAttemptId {
            executor = journal?.executorId
        } else {
            executor = try environment.values()["INDEX_AGENT_ID"]
        }

        guard let job = try cronStore.ownedJob(),
              job.name == Self.ownedCronName,
              job.schedule == Self.ownedCronSchedule,
              job.prompt == Self.ownedCronPrompt else {
            throw HermesRuntimeFailure.cronStoreInvalid
        }
        if let stage = alreadyEnabledCurrentGeneration(
            journal: journal,
            attempt: expectedSetupAttemptId,
            job: job
        ) {
            return try success(request, stage: stage)
        }

        try saveStage(.enabling, attempt: expectedSetupAttemptId, executor: executor, store: store)
        let hermes = try requireHermesBinary()
        if !job.enabled {
            let resume = try runner.run(executable: hermes, arguments: ["cron", "resume", job.id])
            guard resume.status == 0 else { throw HermesRuntimeFailure.cronResumeFailed }
            guard let resumed = try cronStore.ownedJob(),
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
        try saveStage(.awaitingHeartbeat, attempt: expectedSetupAttemptId, executor: executor, store: store)
        return try success(request, stage: HermesSetupStage.awaitingHeartbeat.rawValue)
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
        let store = try HermesLocalStore()
        let installation = try store.loadOrCreateInstallation()
        guard let expectedSetupAttemptId = validValue(request.setupAttemptId) else {
            throw HermesRuntimeFailure.invalidArguments
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
        guard journal.stage == .awaitingHeartbeat else {
            throw HermesRuntimeFailure.invalidArguments
        }

        // Invocation of confirmHealthy is the JS saga's attestation that the
        // backend observed an active pickup heartbeat for this generation.
        try store.deleteJournal()
        return try success(request, stage: "confirmed_healthy")
    }

    private func disable(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try HermesLocalStore()
        let installation = try store.loadOrCreateInstallation()
        guard let expectedSetupAttemptId = validValue(request.setupAttemptId),
              installation.currentSetupAttemptId == expectedSetupAttemptId else {
            return try success(request, stage: "disable_noop")
        }
        guard let job = try cronStore.ownedJob() else {
            return try success(request, stage: "disabled")
        }
        if job.enabled {
            let hermes = try requireHermesBinary()
            try pauseOwnedCron(hermes, knownJob: job)
        }
        return try success(request, stage: "disabled")
    }

    private func disconnect(_ request: HermesRuntimeRequest) throws -> HermesRuntimeResult {
        let store = try HermesLocalStore()
        var installation = try store.loadOrCreateInstallation()
        guard let expectedSetupAttemptId = validValue(request.setupAttemptId) else {
            throw HermesRuntimeFailure.invalidArguments
        }
        let journal = try store.loadJournal()
        if installation.currentSetupAttemptId == nil {
            guard journal?.setupAttemptId == expectedSetupAttemptId,
                  journal?.stage == .disconnectCleanupComplete else {
                return try success(request, stage: "disconnect_noop")
            }
            try finishTerminalDisconnect(store: store)
            return try success(request, stage: "disconnected")
        }
        guard installation.currentSetupAttemptId == expectedSetupAttemptId else {
            return try success(request, stage: "disconnect_noop")
        }

        // Disconnect does not need to reread the credential-bearing env merely
        // to annotate recovery state; cleanup must still run if that file is
        // unreadable, with env removal itself reporting the stable failure.
        let executor = journal?.executorId
        try saveStage(.disconnecting, attempt: expectedSetupAttemptId, executor: executor, store: store)

        // Safe app-owned filesystem cleanup continues even when CLI work fails
        // or the executable disappeared. The generation/journal remain until
        // every exact postcondition (including cron and gateway bounce) proves.
        var pendingFailure: HermesRuntimeFailure?
        let job: HermesCronJob?
        do { job = try cronStore.ownedJob() }
        catch let failure as HermesRuntimeFailure {
            job = nil
            pendingFailure = failure
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

        if let job {
            if let hermes {
                do {
                    if job.enabled { try pauseOwnedCron(hermes, knownJob: job) }
                    let removed = try runner.run(
                        executable: hermes,
                        arguments: ["cron", "remove", job.id]
                    )
                    guard removed.status == 0 else {
                        throw HermesRuntimeFailure.cronRemoveFailed
                    }
                } catch let failure as HermesRuntimeFailure {
                    if pendingFailure == nil { pendingFailure = failure }
                } catch {
                    if pendingFailure == nil { pendingFailure = .cronRemoveFailed }
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

        do { try verifyDisconnectPostconditions() }
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
            attempt: expectedSetupAttemptId,
            executor: executor,
            store: store
        )
        installation.currentSetupAttemptId = nil
        try store.saveInstallation(installation)
        try finishTerminalDisconnect(store: store)
        return try success(request, stage: "disconnected")
    }

    private func finishTerminalDisconnect(store: HermesLocalStore) throws {
        try verifyDisconnectPostconditions()
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

    private func reconcileDisabledCron(_ hermes: String) throws {
        if let job = try cronStore.ownedJob() {
            if job.enabled { try pauseOwnedCron(hermes, knownJob: job) }
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
        } else {
            let created = try runner.run(
                executable: hermes,
                arguments: [
                    "cron", "create", Self.ownedCronSchedule, Self.ownedCronPrompt,
                    "--name", Self.ownedCronName,
                ]
            )
            guard created.status == 0 else { throw HermesRuntimeFailure.cronCreateFailed }
        }

        guard let reconciled = try cronStore.ownedJob() else {
            throw HermesRuntimeFailure.cronStoreInvalid
        }
        // `cron create` has no paused option. Resolve its generated ID from the
        // official jobs store and immediately pause via the documented CLI.
        if reconciled.enabled { try pauseOwnedCron(hermes, knownJob: reconciled) }

        guard let verified = try cronStore.ownedJob(),
              verified.name == Self.ownedCronName,
              verified.schedule == Self.ownedCronSchedule,
              verified.prompt == Self.ownedCronPrompt,
              verified.enabled == false else {
            throw HermesRuntimeFailure.cronStoreInvalid
        }
    }

    private func pauseOwnedCron(_ hermes: String, knownJob: HermesCronJob? = nil) throws {
        guard let job = knownJob ?? (try cronStore.ownedJob()) else { return }
        let result = try runner.run(executable: hermes, arguments: ["cron", "pause", job.id])
        guard result.status == 0 else { throw HermesRuntimeFailure.cronPauseFailed }
        guard let verified = try cronStore.ownedJob(),
              verified.id == job.id,
              verified.enabled == false else {
            throw HermesRuntimeFailure.cronPauseFailed
        }
    }

    private func rollbackActivation(_ hermes: String, job: HermesCronJob) throws {
        do {
            try pauseOwnedCron(hermes, knownJob: job)
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

    private func verifyDisconnectPostconditions() throws {
        guard try cronStore.ownedJob() == nil else {
            throw HermesRuntimeFailure.cronRemoveFailed
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
        attempt: String,
        executor: String?,
        store: HermesLocalStore
    ) throws {
        try store.saveJournal(HermesSetupJournal(
            setupAttemptId: attempt,
            stage: stage,
            executorId: executor
        ))
    }

    private func localState() throws -> HermesLocalState {
        let store = try HermesLocalStore()
        let installation = try store.loadOrCreateInstallation()
        let journal = try store.loadJournal()
        let env = try environment.values()
        let cron = try cronStore.ownedJob()
        return HermesLocalState(
            installationId: installation.installationId,
            executorId: journal?.executorId ?? env["INDEX_AGENT_ID"],
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
