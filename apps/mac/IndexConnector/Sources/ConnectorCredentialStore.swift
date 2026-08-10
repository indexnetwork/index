import Foundation
import Security

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
