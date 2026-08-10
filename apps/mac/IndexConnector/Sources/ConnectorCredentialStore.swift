import Foundation
import Security

enum ConnectorRecoveryPhase: String, Codable, Equatable {
    case none
    case activationRequested = "activation_requested"
    case revocationRequested = "revocation_requested"
    case serverReceiptConfirmed = "server_receipt_confirmed"
    case revocationProbeConfirmed = "revocation_probe_confirmed"

    var requiresRecovery: Bool { self != .none }
    var confirmsServerRevocation: Bool {
        self == .serverReceiptConfirmed || self == .revocationProbeConfirmed
    }
}

final class ConnectorProcessRecoveryState {
    private let lock = NSLock()
    private var recoveryOnly = false

    var isRecoveryOnly: Bool {
        lock.lock()
        defer { lock.unlock() }
        return recoveryOnly
    }

    func failClosed() {
        lock.lock()
        recoveryOnly = true
        lock.unlock()
    }

    func clear() {
        lock.lock()
        recoveryOnly = false
        lock.unlock()
    }
}

struct ConnectorCredentialRecord: Codable, Equatable {
    let rawCredential: String
    let audience: String
    let agentId: String
    let installationId: String
    let setupAttemptId: String
    let credentialId: String
    let actions: [String]
    let expiresAt: Date
    let activationState: String
    let accountLabel: String
    let recoveryPhase: ConnectorRecoveryPhase

    init(
        rawCredential: String,
        audience: String,
        agentId: String,
        installationId: String,
        setupAttemptId: String,
        credentialId: String,
        actions: [String],
        expiresAt: Date,
        activationState: String,
        accountLabel: String,
        recoveryPhase: ConnectorRecoveryPhase = .none
    ) {
        self.rawCredential = rawCredential
        self.audience = audience
        self.agentId = agentId
        self.installationId = installationId
        self.setupAttemptId = setupAttemptId
        self.credentialId = credentialId
        self.actions = actions
        self.expiresAt = expiresAt
        self.activationState = activationState
        self.accountLabel = accountLabel
        self.recoveryPhase = recoveryPhase
    }

    private enum CodingKeys: String, CodingKey {
        case rawCredential, audience, agentId, installationId, setupAttemptId
        case credentialId, actions, expiresAt, activationState, accountLabel, recoveryPhase
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        rawCredential = try container.decode(String.self, forKey: .rawCredential)
        audience = try container.decode(String.self, forKey: .audience)
        agentId = try container.decode(String.self, forKey: .agentId)
        installationId = try container.decode(String.self, forKey: .installationId)
        setupAttemptId = try container.decode(String.self, forKey: .setupAttemptId)
        credentialId = try container.decode(String.self, forKey: .credentialId)
        actions = try container.decode([String].self, forKey: .actions)
        expiresAt = try container.decode(Date.self, forKey: .expiresAt)
        activationState = try container.decode(String.self, forKey: .activationState)
        accountLabel = try container.decodeIfPresent(String.self, forKey: .accountLabel) ?? ""
        recoveryPhase = try container.decodeIfPresent(ConnectorRecoveryPhase.self, forKey: .recoveryPhase) ?? .none
    }

    func replacing(
        activationState: String? = nil,
        accountLabel: String? = nil,
        recoveryPhase: ConnectorRecoveryPhase? = nil
    ) -> ConnectorCredentialRecord {
        ConnectorCredentialRecord(
            rawCredential: rawCredential,
            audience: audience,
            agentId: agentId,
            installationId: installationId,
            setupAttemptId: setupAttemptId,
            credentialId: credentialId,
            actions: actions,
            expiresAt: expiresAt,
            activationState: activationState ?? self.activationState,
            accountLabel: accountLabel ?? self.accountLabel,
            recoveryPhase: recoveryPhase ?? self.recoveryPhase
        )
    }
}

protocol ConnectorCredentialStoring {
    func putAndVerify(_ record: ConnectorCredentialRecord) throws
    func read() throws -> ConnectorCredentialRecord?
    func delete() throws
}

enum ConnectorCredentialStoreError: Error, Equatable {
    case invalidRecord
    case verificationFailed
    case accessGroupUnavailable
}

struct ConnectorCredentialStore: ConnectorCredentialStoring {
    private let keychain: IndexKeychainStore
    private let descriptor: IndexKeychainItemDescriptor
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(
        installationId: String,
        environment: String = ConnectorBuildIdentity.apiEnvironment,
        keychain: IndexKeychainStore = IndexKeychainStore(),
        accessGroup: String? = nil
    ) throws {
        self.keychain = keychain
        descriptor = IndexKeychainItemDescriptor(
            service: "network.index.connector.credentials.\(environment)",
            account: installationId,
            accessGroup: try accessGroup ?? Self.signedConnectorAccessGroup()
        )
        encoder = JSONEncoder()
        decoder = JSONDecoder()
    }

    private static func signedConnectorAccessGroup() throws -> String {
        guard let task = SecTaskCreateFromSelf(nil),
              let entitlement = SecTaskCopyValueForEntitlement(
                  task,
                  "keychain-access-groups" as CFString,
                  nil
              ),
              let groups = entitlement as? [String],
              groups.count == 1,
              let group = groups.first,
              group.hasSuffix(".network.index.connector.credentials") else {
            throw ConnectorCredentialStoreError.accessGroupUnavailable
        }
        return group
    }

    func putAndVerify(_ record: ConnectorCredentialRecord) throws {
        guard record.installationId == descriptor.account,
              record.rawCredential.hasPrefix("idxh_"),
              record.audience == "hermes-agent",
              record.activationState == "pending" || record.activationState == "active" else {
            throw ConnectorCredentialStoreError.invalidRecord
        }
        let encoded = try encoder.encode(record)
        try keychain.putAndVerify(encoded, descriptor: descriptor)
        guard try read() == record else {
            throw ConnectorCredentialStoreError.verificationFailed
        }
    }

    func read() throws -> ConnectorCredentialRecord? {
        guard let data = try keychain.read(descriptor: descriptor) else { return nil }
        let record = try decoder.decode(ConnectorCredentialRecord.self, from: data)
        guard record.installationId == descriptor.account,
              record.rawCredential.hasPrefix("idxh_"),
              record.audience == "hermes-agent" else {
            throw ConnectorCredentialStoreError.invalidRecord
        }
        return record
    }

    func delete() throws {
        try keychain.delete(descriptor: descriptor)
    }
}
