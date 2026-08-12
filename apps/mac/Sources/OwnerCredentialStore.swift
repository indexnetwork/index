import Foundation

struct OwnerCredentialRecord: Codable, Equatable {
    let credential: String
    let credentialId: String
    let installationId: String
    let generation: String
    let expiresAt: Date
}

enum OwnerCredentialMigrationPhase: String, Codable {
    case fresh_login_required
    case revocation_pending
}

struct OwnerCredentialMigrationJournal: Codable, Equatable {
    let version: Int
    let installationId: String
    let legacyKeyId: String?
    var requestId: String?
    var phase: OwnerCredentialMigrationPhase
}

enum OwnerCredentialStoreFailure: Error, Equatable {
    case invalidAccessGroup
    case malformedLegacyCredential
    case malformedJournal
    case fileReadFailed
    case fileWriteFailed
    case fileDeletionFailed
    case fileReadBackFailed
    case keychainReadBackFailed
}

struct OwnerCredentialFileOperations {
    let read: (URL) throws -> Data
    let writeAtomic: (Data, URL) throws -> Void
    let remove: (URL) throws -> Void
    let exists: (URL) -> Bool
    let isRegularNonSymlink: (URL) throws -> Bool

    static let live = OwnerCredentialFileOperations(
        // The migration zeroes the mutable buffer after use. A memory-mapped
        // read can be read-only and may SIGBUS after the plaintext file is
        // unlinked, so materialize owned bytes before decoding and wiping.
        read: { try Data(contentsOf: $0) },
        writeAtomic: { data, url in try data.write(to: url, options: [.atomic]) },
        remove: { try FileManager.default.removeItem(at: $0) },
        exists: { FileManager.default.fileExists(atPath: $0.path) },
        isRegularNonSymlink: { url in
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            return values.isRegularFile == true && values.isSymbolicLink != true
        }
    )
}

/// Owns the app-only Keychain descriptor and the strict plaintext revocation journal.
/// Raw owner material is represented only by OwnerCredentialRecord in process memory
/// and by the generic-password value written through IndexKeychainStore.
struct OwnerCredentialStore {
    static let service = "network.index.system6.owner-credential"
    static let account = "owner-v1"
    static let accessGroupSuffix = "network.index.system6.owner-credentials"
    static let legacyCredentialFileName = "credential.json"
    static let migrationJournalFileName = "owner-credential-migration.json"
    static let legacyCredentialKeys: Set<String> = ["key", "keyId", "apiUrl"]
    static let journalKeys: Set<String> = ["version", "installationId", "legacyKeyId", "requestId", "phase"]
    static let credentialKeys: Set<String> = ["credential", "credentialId", "installationId", "generation", "expiresAt"]

    private let keychain: IndexKeychainStore
    private let descriptor: IndexKeychainItemDescriptor
    private let applicationSupportDirectory: URL
    private let files: OwnerCredentialFileOperations

    init(
        accessGroup: String,
        applicationSupportDirectory: URL,
        keychain: IndexKeychainStore = IndexKeychainStore(),
        files: OwnerCredentialFileOperations = .live
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
        self.applicationSupportDirectory = applicationSupportDirectory
        self.files = files
    }

    var legacyCredentialURL: URL {
        applicationSupportDirectory.appendingPathComponent(Self.legacyCredentialFileName, isDirectory: false)
    }
    var migrationJournalURL: URL {
        applicationSupportDirectory.appendingPathComponent(Self.migrationJournalFileName, isDirectory: false)
    }

    /// Startup migration never authenticates from plaintext. It first persists
    /// only the strict legacy key ID, then deletes and verifies the exact file.
    mutating func prepareForStartup(installationId: String) throws -> OwnerCredentialMigrationJournal? {
        if files.exists(legacyCredentialURL) {
            guard (try? files.isRegularNonSymlink(legacyCredentialURL)) == true else {
                throw OwnerCredentialStoreFailure.fileReadFailed
            }
            var bytes: Data
            do { bytes = try files.read(legacyCredentialURL) }
            catch { throw OwnerCredentialStoreFailure.fileReadFailed }
            defer { bytes.resetBytes(in: 0..<bytes.count) }
            let legacyKeyId = try Self.decodeLegacyKeyId(bytes)
            var journal = OwnerCredentialMigrationJournal(
                version: 1,
                installationId: installationId,
                legacyKeyId: legacyKeyId,
                requestId: nil,
                phase: .revocation_pending
            )
            try saveJournal(journal)
            do { try files.remove(legacyCredentialURL) }
            catch { throw OwnerCredentialStoreFailure.fileDeletionFailed }
            try verifyLegacyCredentialAbsent()
            journal.phase = .revocation_pending
            return journal
        }
        return try loadJournal()
    }

    func verifyLegacyCredentialAbsent() throws {
        guard !files.exists(legacyCredentialURL) else {
            throw OwnerCredentialStoreFailure.fileReadBackFailed
        }
    }

    func loadCredential() throws -> OwnerCredentialRecord? {
        guard let data = try keychain.read(descriptor: descriptor) else { return nil }
        do {
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  Set(object.keys) == Self.credentialKeys else {
                throw OwnerCredentialStoreFailure.keychainReadBackFailed
            }
            let record = try JSONDecoder.ownerCredential.decode(OwnerCredentialRecord.self, from: data)
            guard record.credential.hasPrefix("idxo_"), record.credential.count > 5,
                  !record.credentialId.isEmpty, UUID(uuidString: record.installationId) != nil,
                  UUID(uuidString: record.generation) != nil else {
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

    func saveJournal(_ journal: OwnerCredentialMigrationJournal) throws {
        guard journal.version == 1, !journal.installationId.isEmpty,
              journal.phase == .fresh_login_required || journal.phase == .revocation_pending else {
            throw OwnerCredentialStoreFailure.malformedJournal
        }
        do {
            try FileManager.default.createDirectory(
                at: applicationSupportDirectory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            let object: [String: Any] = [
                "version": journal.version,
                "installationId": journal.installationId,
                "legacyKeyId": journal.legacyKeyId ?? NSNull(),
                "requestId": journal.requestId ?? NSNull(),
                "phase": journal.phase.rawValue,
            ]
            let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            try files.writeAtomic(data, migrationJournalURL)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600], ofItemAtPath: migrationJournalURL.path
            )
            guard try loadJournal() == journal else { throw OwnerCredentialStoreFailure.fileReadBackFailed }
        } catch let failure as OwnerCredentialStoreFailure { throw failure }
        catch { throw OwnerCredentialStoreFailure.fileWriteFailed }
    }

    func loadJournal() throws -> OwnerCredentialMigrationJournal? {
        guard files.exists(migrationJournalURL) else { return nil }
        let data: Data
        do { data = try files.read(migrationJournalURL) }
        catch { throw OwnerCredentialStoreFailure.fileReadFailed }
        do {
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  Set(object.keys) == Self.journalKeys else {
                throw OwnerCredentialStoreFailure.malformedJournal
            }
            let journal = try JSONDecoder.ownerCredential.decode(OwnerCredentialMigrationJournal.self, from: data)
            guard journal.version == 1, !journal.installationId.isEmpty else {
                throw OwnerCredentialStoreFailure.malformedJournal
            }
            return journal
        } catch let failure as OwnerCredentialStoreFailure { throw failure }
        catch { throw OwnerCredentialStoreFailure.malformedJournal }
    }

    func clearJournal() throws {
        guard files.exists(migrationJournalURL) else { return }
        do { try files.remove(migrationJournalURL) }
        catch { throw OwnerCredentialStoreFailure.fileDeletionFailed }
        guard !files.exists(migrationJournalURL) else {
            throw OwnerCredentialStoreFailure.fileReadBackFailed
        }
    }

    private static func decodeLegacyKeyId(_ data: Data) throws -> String {
        do {
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  Set(object.keys) == Self.legacyCredentialKeys,
                  (object["key"] as? String)?.isEmpty == false,
                  let keyId = object["keyId"] as? String,
                  keyId.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
                  keyId.count <= 256,
                  let apiURL = object["apiUrl"] as? String,
                  let parsedURL = URL(string: apiURL),
                  ["http", "https"].contains(parsedURL.scheme?.lowercased() ?? ""),
                  parsedURL.host != nil else {
                throw OwnerCredentialStoreFailure.malformedLegacyCredential
            }
            return keyId
        } catch let failure as OwnerCredentialStoreFailure { throw failure }
        catch { throw OwnerCredentialStoreFailure.malformedLegacyCredential }
    }
}

private enum OwnerCredentialDateCoding {
    static let fractionalISO8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let wholeSecondISO8601 = ISO8601DateFormatter()
}

private extension JSONEncoder {
    static var ownerCredential: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(OwnerCredentialDateCoding.fractionalISO8601.string(from: date))
        }
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}
private extension JSONDecoder {
    static var ownerCredential: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            guard let date = OwnerCredentialDateCoding.fractionalISO8601.date(from: value)
                    ?? OwnerCredentialDateCoding.wholeSecondISO8601.date(from: value) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Invalid owner credential expiry"
                )
            }
            return date
        }
        return decoder
    }
}
