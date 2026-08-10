import Foundation
import Darwin

// Darwin's Swift overlay imports `struct flock` under the same name as the
// flock(2) function. Bind the stable libc syscall explicitly rather than
// accidentally resolving the struct initializer.
@_silgen_name("flock")
private func connectorFlock(_ descriptor: CInt, _ operation: CInt) -> CInt

struct ConnectorInstallationState: Codable, Equatable {
    let installationId: String
    var recoveryPhase: ConnectorRecoveryPhase
    var authorizationAttemptId: String?
    var operationEpoch: UInt64

    private enum CodingKeys: String, CodingKey {
        case installationId, recoveryPhase, revocationPending, authorizationAttemptId, operationEpoch
    }

    init(
        installationId: String,
        recoveryPhase: ConnectorRecoveryPhase,
        authorizationAttemptId: String? = nil,
        operationEpoch: UInt64 = 0
    ) {
        self.installationId = installationId
        self.recoveryPhase = recoveryPhase
        self.authorizationAttemptId = authorizationAttemptId
        self.operationEpoch = operationEpoch
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        installationId = try container.decode(String.self, forKey: .installationId)
        if let phase = try container.decodeIfPresent(ConnectorRecoveryPhase.self, forKey: .recoveryPhase) {
            recoveryPhase = phase
        } else if try container.decodeIfPresent(Bool.self, forKey: .revocationPending) == true {
            recoveryPhase = .revocationRequested
        } else {
            recoveryPhase = .none
        }
        authorizationAttemptId = try container.decodeIfPresent(String.self, forKey: .authorizationAttemptId)
        operationEpoch = try container.decodeIfPresent(UInt64.self, forKey: .operationEpoch) ?? 0
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(installationId, forKey: .installationId)
        try container.encode(recoveryPhase, forKey: .recoveryPhase)
        try container.encodeIfPresent(authorizationAttemptId, forKey: .authorizationAttemptId)
        try container.encode(operationEpoch, forKey: .operationEpoch)
    }
}

protocol ConnectorInstallationStoring: AnyObject {
    var installationId: String { get }
    var recoveryPhase: ConnectorRecoveryPhase { get }
    var stateSnapshot: ConnectorInstallationState { get }
    func setRecoveryPhase(_ phase: ConnectorRecoveryPhase) throws
    func compareAndSet(
        expected: ConnectorInstallationState,
        replacement: ConnectorInstallationState
    ) throws -> Bool
}

enum ConnectorInstallationStoreError: Error, Equatable {
    case unsafePath
    case invalidState
}

/// A cross-process durable CAS journal. The lock file is a stable inode (unlike
/// the atomically replaced journal), so every reader and writer serializes on
/// the same OS lock and rereads the durable file while holding that lock.
final class ConnectorInstallationStore: ConnectorInstallationStoring {
    private static let maximumJournalBytes = 65_536
    private let fileManager: FileManager
    private let directoryURL: URL
    private let fileURL: URL
    private let lockURL: URL

    var installationId: String { stateSnapshot.installationId }
    var recoveryPhase: ConnectorRecoveryPhase { stateSnapshot.recoveryPhase }
    var stateSnapshot: ConnectorInstallationState {
        do {
            return try withFileLock { try readDurableState() }
        } catch {
            // The protocol's historical getter cannot throw. Crashing the
            // connector is fail-closed; returning an init-time cache would let
            // a stale process become authorization authority.
            preconditionFailure("Connector installation journal is unavailable: \(error)")
        }
    }

    init(
        fileManager: FileManager = .default,
        baseDirectory: URL? = nil,
        environment: String = ConnectorBuildIdentity.apiEnvironment
    ) throws {
        self.fileManager = fileManager
        let base = try baseDirectory ?? fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        // ~/Library/Application Support/network.index.connector stores only
        // the stable UUID and non-secret recovery/CAS journal.
        directoryURL = base.appendingPathComponent("network.index.connector", isDirectory: true)
        fileURL = directoryURL.appendingPathComponent("installation-\(environment).json", isDirectory: false)
        lockURL = directoryURL.appendingPathComponent("installation-\(environment).lock", isDirectory: false)
        try Self.prepareDirectory(directoryURL, fileManager: fileManager)
        try withFileLock {
            if try pathExistsWithoutFollowing(fileURL) {
                _ = try readDurableState()
            } else {
                try persist(ConnectorInstallationState(
                    installationId: UUID().uuidString.lowercased(),
                    recoveryPhase: .none
                ))
            }
        }
    }

    func setRecoveryPhase(_ phase: ConnectorRecoveryPhase) throws {
        try withFileLock {
            let current = try readDurableState()
            var replacement = current
            replacement.recoveryPhase = phase
            try validateTransition(current: current, replacement: replacement)
            try persist(replacement)
        }
    }

    func compareAndSet(
        expected: ConnectorInstallationState,
        replacement: ConnectorInstallationState
    ) throws -> Bool {
        try withFileLock {
            let current = try readDurableState()
            guard current == expected else { return false }
            try validateTransition(current: current, replacement: replacement)
            try persist(replacement)
            return true
        }
    }

    private func validateTransition(
        current: ConnectorInstallationState,
        replacement: ConnectorInstallationState
    ) throws {
        guard replacement.installationId == current.installationId,
              replacement.operationEpoch >= current.operationEpoch,
              replacement.authorizationAttemptId == nil
                || UUID(uuidString: replacement.authorizationAttemptId!) != nil else {
            throw ConnectorInstallationStoreError.invalidState
        }
    }

    private func withFileLock<T>(_ body: () throws -> T) throws -> T {
        try Self.validateDirectory(directoryURL)
        let descriptor = Darwin.open(
            lockURL.path,
            O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW,
            S_IRUSR | S_IWUSR
        )
        guard descriptor >= 0 else { throw ConnectorInstallationStoreError.unsafePath }
        defer { Darwin.close(descriptor) }
        try Self.validateDescriptor(descriptor, type: S_IFREG, permissions: 0o600)
        try Self.validatePathIdentity(lockURL, descriptor: descriptor)
        guard connectorFlock(descriptor, LOCK_EX) == 0 else {
            throw ConnectorInstallationStoreError.unsafePath
        }
        defer { _ = connectorFlock(descriptor, LOCK_UN) }
        // Revalidate after acquisition so a path manipulation cannot be hidden
        // behind time spent waiting for another process's lock.
        try Self.validateDirectory(directoryURL)
        try Self.validatePathIdentity(lockURL, descriptor: descriptor)
        return try body()
    }

    private func readDurableState() throws -> ConnectorInstallationState {
        let descriptor = Darwin.open(fileURL.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else { throw ConnectorInstallationStoreError.unsafePath }
        defer { Darwin.close(descriptor) }
        try Self.validateDescriptor(descriptor, type: S_IFREG, permissions: 0o600)
        try Self.validatePathIdentity(fileURL, descriptor: descriptor)
        var info = Darwin.stat()
        guard Darwin.fstat(descriptor, &info) == 0,
              info.st_size >= 0,
              info.st_size <= off_t(Self.maximumJournalBytes) else {
            throw ConnectorInstallationStoreError.invalidState
        }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            guard count >= 0 else { throw ConnectorInstallationStoreError.invalidState }
            if count == 0 { break }
            data.append(buffer, count: count)
            guard data.count <= Self.maximumJournalBytes else {
                throw ConnectorInstallationStoreError.invalidState
            }
        }
        let decoded = try JSONDecoder().decode(ConnectorInstallationState.self, from: data)
        guard UUID(uuidString: decoded.installationId)?.uuidString.lowercased()
                == decoded.installationId.lowercased(),
              decoded.authorizationAttemptId == nil
                || UUID(uuidString: decoded.authorizationAttemptId!) != nil else {
            throw ConnectorInstallationStoreError.invalidState
        }
        return decoded
    }

    private func persist(_ value: ConnectorInstallationState) throws {
        let data = try JSONEncoder().encode(value)
        guard data.count <= Self.maximumJournalBytes else {
            throw ConnectorInstallationStoreError.invalidState
        }
        if try pathExistsWithoutFollowing(fileURL) {
            try Self.validatePath(fileURL, type: S_IFREG, permissions: 0o600)
        }
        let temporaryURL = directoryURL.appendingPathComponent(".installation-\(UUID().uuidString).tmp")
        let descriptor = Darwin.open(
            temporaryURL.path,
            O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
            S_IRUSR | S_IWUSR
        )
        guard descriptor >= 0 else { throw ConnectorInstallationStoreError.unsafePath }
        var renamed = false
        defer {
            Darwin.close(descriptor)
            if !renamed { _ = Darwin.unlink(temporaryURL.path) }
        }
        try Self.validateDescriptor(descriptor, type: S_IFREG, permissions: 0o600)
        try data.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { return }
            var offset = 0
            while offset < rawBuffer.count {
                let written = Darwin.write(descriptor, base.advanced(by: offset), rawBuffer.count - offset)
                guard written > 0 else { throw ConnectorInstallationStoreError.invalidState }
                offset += written
            }
        }
        guard Darwin.fsync(descriptor) == 0 else {
            throw ConnectorInstallationStoreError.invalidState
        }
        if try pathExistsWithoutFollowing(fileURL) {
            try Self.validatePath(fileURL, type: S_IFREG, permissions: 0o600)
        }
        guard Darwin.rename(temporaryURL.path, fileURL.path) == 0 else {
            throw ConnectorInstallationStoreError.unsafePath
        }
        renamed = true
        try Self.validatePath(fileURL, type: S_IFREG, permissions: 0o600)
        try Self.fsyncDirectory(directoryURL)
    }

    private func pathExistsWithoutFollowing(_ url: URL) throws -> Bool {
        var info = Darwin.stat()
        if Darwin.lstat(url.path, &info) == 0 { return true }
        if errno == ENOENT { return false }
        throw ConnectorInstallationStoreError.unsafePath
    }

    private static func prepareDirectory(_ url: URL, fileManager: FileManager) throws {
        var info = Darwin.stat()
        if Darwin.lstat(url.path, &info) == 0 {
            guard (info.st_mode & S_IFMT) == S_IFDIR, info.st_uid == getuid() else {
                throw ConnectorInstallationStoreError.unsafePath
            }
        } else if errno == ENOENT {
            try fileManager.createDirectory(
                at: url,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        } else {
            throw ConnectorInstallationStoreError.unsafePath
        }
        guard Darwin.chmod(url.path, 0o700) == 0 else {
            throw ConnectorInstallationStoreError.unsafePath
        }
        try validateDirectory(url)
    }

    private static func validateDirectory(_ url: URL) throws {
        try validatePath(url, type: S_IFDIR, permissions: 0o700)
    }

    private static func validatePath(_ url: URL, type: mode_t, permissions: mode_t) throws {
        var info = Darwin.stat()
        guard Darwin.lstat(url.path, &info) == 0,
              (info.st_mode & S_IFMT) == type,
              info.st_uid == getuid(),
              info.st_nlink == 1 || type == S_IFDIR,
              (info.st_mode & 0o777) == permissions else {
            throw ConnectorInstallationStoreError.unsafePath
        }
    }

    private static func validatePathIdentity(_ url: URL, descriptor: Int32) throws {
        var pathInfo = Darwin.stat()
        var descriptorInfo = Darwin.stat()
        guard Darwin.lstat(url.path, &pathInfo) == 0,
              Darwin.fstat(descriptor, &descriptorInfo) == 0,
              pathInfo.st_dev == descriptorInfo.st_dev,
              pathInfo.st_ino == descriptorInfo.st_ino,
              pathInfo.st_mode == descriptorInfo.st_mode else {
            throw ConnectorInstallationStoreError.unsafePath
        }
    }

    private static func validateDescriptor(
        _ descriptor: Int32,
        type: mode_t,
        permissions: mode_t
    ) throws {
        var info = Darwin.stat()
        guard Darwin.fstat(descriptor, &info) == 0,
              (info.st_mode & S_IFMT) == type,
              info.st_uid == getuid(),
              info.st_nlink == 1 || type == S_IFDIR,
              (info.st_mode & 0o777) == permissions else {
            throw ConnectorInstallationStoreError.unsafePath
        }
    }

    private static func fsyncDirectory(_ url: URL) throws {
        let descriptor = Darwin.open(url.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else { throw ConnectorInstallationStoreError.unsafePath }
        defer { Darwin.close(descriptor) }
        try validateDescriptor(descriptor, type: S_IFDIR, permissions: 0o700)
        guard Darwin.fsync(descriptor) == 0 else {
            throw ConnectorInstallationStoreError.invalidState
        }
    }
}
