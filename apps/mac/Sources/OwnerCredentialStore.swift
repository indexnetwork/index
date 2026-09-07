import Foundation

struct OwnerCredentialRecord: Codable, Equatable {
    let credential: String
    let expiresAt: Date
}

enum OwnerCredentialStoreFailure: Error, Equatable {
    case invalidAccessGroup
    case keychainReadBackFailed
}

/// Owns this device's session token. Production writes it through
/// IndexKeychainStore into the app-only Keychain group. Ad-hoc development
/// builds cannot use that group, and login-keychain ACLs bind to the binary
/// hash, so they store the same record in Application Support instead.
struct OwnerCredentialStore {
    static let service = "network.index.system6.owner-credential"
    // Bumped from owner-v1: the stored value is a device session token rather
    // than an API key, so an older item must not be read back as one.
    static let account = "owner-v2"
    static let accessGroupSuffix = "network.index.system6.owner-credentials"
    static let credentialKeys: Set<String> = ["credential", "expiresAt"]

    private let keychain: IndexKeychainStore
    private let descriptor: IndexKeychainItemDescriptor
    private let fileURL: URL?

    init(
        accessGroup: String,
        keychain: IndexKeychainStore = IndexKeychainStore()
    ) throws {
        guard accessGroup.hasSuffix("." + Self.accessGroupSuffix) else {
            throw OwnerCredentialStoreFailure.invalidAccessGroup
        }
        self.keychain = keychain
        self.fileURL = nil
        self.descriptor = IndexKeychainItemDescriptor(
            service: Self.service,
            account: Self.account,
            accessGroup: accessGroup
        )
    }

#if INDEX_DEVELOPMENT_BUILD
    /// Never compiled into production builds.
    init() {
        self.keychain = IndexKeychainStore()
        self.descriptor = IndexKeychainItemDescriptor(
            service: Self.service,
            account: Self.account
        )
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Index", isDirectory: true)
        self.fileURL = dir.appendingPathComponent("owner-credential.json")
    }
#endif

    func loadCredential() throws -> OwnerCredentialRecord? {
        guard let data = try readData() else { return nil }
        return try record(from: data)
    }

    func putAndVerify(_ record: OwnerCredentialRecord) throws {
        let data = try JSONEncoder.ownerCredential.encode(record)
        try writeData(data)
        guard try loadCredential() == record else {
            throw OwnerCredentialStoreFailure.keychainReadBackFailed
        }
    }

    func deleteAndVerify() throws {
        try deleteData()
        guard try loadCredential() == nil else {
            throw OwnerCredentialStoreFailure.keychainReadBackFailed
        }
    }

    private func record(from data: Data) throws -> OwnerCredentialRecord {
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

    private func readData() throws -> Data? {
        if let fileURL {
            guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
            do { return try Data(contentsOf: fileURL) }
            catch { throw OwnerCredentialStoreFailure.keychainReadBackFailed }
        }
        return try keychain.read(descriptor: descriptor)
    }

    private func writeData(_ data: Data) throws {
        if let fileURL {
            do {
                try FileManager.default.createDirectory(
                    at: fileURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try data.write(to: fileURL, options: .atomic)
                try FileManager.default.setAttributes(
                    [.posixPermissions: 0o600],
                    ofItemAtPath: fileURL.path
                )
            } catch { throw OwnerCredentialStoreFailure.keychainReadBackFailed }
            return
        }
        try keychain.putAndVerify(data, descriptor: descriptor)
    }

    private func deleteData() throws {
        if let fileURL {
            if FileManager.default.fileExists(atPath: fileURL.path) {
                do { try FileManager.default.removeItem(at: fileURL) }
                catch { throw OwnerCredentialStoreFailure.keychainReadBackFailed }
            }
            return
        }
        try keychain.delete(descriptor: descriptor)
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
