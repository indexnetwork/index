import Foundation

struct OwnerCredentialRecord: Codable, Equatable {
    let credential: String
    let expiresAt: Date
}

enum OwnerCredentialStoreFailure: Error, Equatable {
    case invalidAccessGroup
    case keychainReadBackFailed
}

/// Owns the app-only Keychain descriptor for this device's session token.
/// Raw owner material is represented only by OwnerCredentialRecord in process
/// memory and by the generic-password value written through IndexKeychainStore.
struct OwnerCredentialStore {
    static let service = "network.index.system6.owner-credential"
    // Bumped from owner-v1: the stored value is a device session token rather
    // than an API key, so an older item must not be read back as one.
    static let account = "owner-v2"
    static let accessGroupSuffix = "network.index.system6.owner-credentials"
    static let credentialKeys: Set<String> = ["credential", "expiresAt"]

    private let keychain: IndexKeychainStore
    private let descriptor: IndexKeychainItemDescriptor

    init(
        accessGroup: String,
        keychain: IndexKeychainStore = IndexKeychainStore()
    ) throws {
        guard accessGroup.hasSuffix("." + Self.accessGroupSuffix) else {
            throw OwnerCredentialStoreFailure.invalidAccessGroup
        }
        self.keychain = keychain
        self.descriptor = IndexKeychainItemDescriptor(
            service: Self.service,
            account: Self.account,
            accessGroup: accessGroup
        )
    }

#if INDEX_DEVELOPMENT_BUILD
    /// Ad-hoc development builds carry no provisioning-profile-authorized
    /// access group, so the data-protection keychain is unavailable to them.
    /// Store the credential in the login keychain instead. Never compiled
    /// into production builds.
    init(developmentLoginKeychain keychain: IndexKeychainStore = IndexKeychainStore()) {
        self.keychain = keychain
        self.descriptor = IndexKeychainItemDescriptor(
            service: Self.service,
            account: Self.account,
            accessGroup: nil
        )
    }
#endif

    func loadCredential() throws -> OwnerCredentialRecord? {
        guard let data = try keychain.read(descriptor: descriptor) else { return nil }
        do {
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  Set(object.keys) == Self.credentialKeys else {
                throw OwnerCredentialStoreFailure.keychainReadBackFailed
            }
            let record = try JSONDecoder.ownerCredential.decode(OwnerCredentialRecord.self, from: data)
            guard !record.credential.isEmpty else {
                throw OwnerCredentialStoreFailure.keychainReadBackFailed
            }
            return record
        } catch let failure as OwnerCredentialStoreFailure { throw failure }
        catch { throw OwnerCredentialStoreFailure.keychainReadBackFailed }
    }

    func putAndVerify(_ record: OwnerCredentialRecord) throws {
        let data = try JSONEncoder.ownerCredential.encode(record)
        try keychain.putAndVerify(data, descriptor: descriptor)
        guard try loadCredential() == record else {
            throw OwnerCredentialStoreFailure.keychainReadBackFailed
        }
    }

    func deleteAndVerify() throws {
        try keychain.delete(descriptor: descriptor)
        guard try keychain.read(descriptor: descriptor) == nil else {
            throw OwnerCredentialStoreFailure.keychainReadBackFailed
        }
    }
}

private extension JSONEncoder {
    static var ownerCredential: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}
private extension JSONDecoder {
    static var ownerCredential: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
