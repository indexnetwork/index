import Foundation

struct ConnectorInstallationState: Codable, Equatable {
    let installationId: String
    var recoveryPhase: ConnectorRecoveryPhase

    private enum CodingKeys: String, CodingKey {
        case installationId, recoveryPhase, revocationPending
    }

    init(installationId: String, recoveryPhase: ConnectorRecoveryPhase) {
        self.installationId = installationId
        self.recoveryPhase = recoveryPhase
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
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(installationId, forKey: .installationId)
        try container.encode(recoveryPhase, forKey: .recoveryPhase)
    }
}

protocol ConnectorInstallationStoring: AnyObject {
    var installationId: String { get }
    var recoveryPhase: ConnectorRecoveryPhase { get }
    func setRecoveryPhase(_ phase: ConnectorRecoveryPhase) throws
}

enum ConnectorInstallationStoreError: Error, Equatable {
    case unsafePath
    case invalidState
}

final class ConnectorInstallationStore: ConnectorInstallationStoring {
    private let fileManager: FileManager
    private let directoryURL: URL
    private let fileURL: URL
    private let lock = NSLock()
    private var state: ConnectorInstallationState

    var installationId: String {
        lock.lock()
        defer { lock.unlock() }
        return state.installationId
    }

    var recoveryPhase: ConnectorRecoveryPhase {
        lock.lock()
        defer { lock.unlock() }
        return state.recoveryPhase
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
        // ~/Library/Application Support/network.index.connector/ contains only
        // the stable UUID and non-secret staged recovery journal.
        directoryURL = base.appendingPathComponent("network.index.connector", isDirectory: true)
        fileURL = directoryURL.appendingPathComponent("installation-\(environment).json", isDirectory: false)
        try Self.prepareDirectory(directoryURL, fileManager: fileManager)
        if fileManager.fileExists(atPath: fileURL.path) {
            try Self.rejectSymbolicLink(fileURL)
            let decoded = try JSONDecoder().decode(
                ConnectorInstallationState.self,
                from: Data(contentsOf: fileURL, options: [.mappedIfSafe])
            )
            guard UUID(uuidString: decoded.installationId)?.uuidString.lowercased()
                    == decoded.installationId.lowercased() else {
                throw ConnectorInstallationStoreError.invalidState
            }
            state = decoded
        } else {
            state = ConnectorInstallationState(
                installationId: UUID().uuidString.lowercased(),
                recoveryPhase: .none
            )
            try persist(state)
        }
    }

    func setRecoveryPhase(_ phase: ConnectorRecoveryPhase) throws {
        lock.lock()
        defer { lock.unlock() }
        var replacement = state
        replacement.recoveryPhase = phase
        try persist(replacement)
        state = replacement
    }

    private func persist(_ value: ConnectorInstallationState) throws {
        try Self.rejectSymbolicLinkIfPresent(fileURL, fileManager: fileManager)
        let data = try JSONEncoder().encode(value)
        try data.write(to: fileURL, options: [.atomic])
        try Self.rejectSymbolicLink(fileURL)
        try fileManager.setAttributes([.posixPermissions: 0o600], atPath: fileURL.path)
    }

    private static func prepareDirectory(_ url: URL, fileManager: FileManager) throws {
        if fileManager.fileExists(atPath: url.path) {
            try rejectSymbolicLink(url)
            let values = try url.resourceValues(forKeys: [.isDirectoryKey])
            guard values.isDirectory == true else { throw ConnectorInstallationStoreError.unsafePath }
        } else {
            try fileManager.createDirectory(
                at: url,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        }
        try fileManager.setAttributes([.posixPermissions: 0o700], atPath: url.path)
    }

    private static func rejectSymbolicLinkIfPresent(_ url: URL, fileManager: FileManager) throws {
        if fileManager.fileExists(atPath: url.path) { try rejectSymbolicLink(url) }
    }

    private static func rejectSymbolicLink(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey])
        guard values.isSymbolicLink != true else { throw ConnectorInstallationStoreError.unsafePath }
    }
}
