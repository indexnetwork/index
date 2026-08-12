import Foundation
import Security

private enum FixtureFailure: Error { case assertion(String), injectedDeletion }
private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw FixtureFailure.assertion(message) }
}

@main
enum OwnerCredentialMigrationFixture {
    static func main() throws {
        let root = URL(fileURLWithPath: ProcessInfo.processInfo.environment["RUNNER_TEMP"] ?? NSTemporaryDirectory())
            .appendingPathComponent("owner-migration-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let group = "FIXTURE.network.index.system6.owner-credentials"
        let installation = UUID().uuidString.lowercased()

        // Valid plaintext preserves only key ID, removes and verifies the exact
        // file, retains the parent, and remains in durable revocation recovery.
        let validRoot = root.appendingPathComponent("valid", isDirectory: true)
        try FileManager.default.createDirectory(at: validRoot, withIntermediateDirectories: true)
        let legacy = validRoot.appendingPathComponent("credential.json")
        try Data(#"{"apiUrl":"https://api.example.test","key":"raw-legacy-secret","keyId":"legacy-id"}"#.utf8)
            .write(to: legacy)
        var valid = try OwnerCredentialStore(accessGroup: group, applicationSupportDirectory: validRoot)
        let journal = try valid.prepareForStartup(installationId: installation)
        try require(journal?.legacyKeyId == "legacy-id", "legacy key ID missing")
        try require(journal?.phase == .revocation_pending, "revocation recovery missing")
        try require(!FileManager.default.fileExists(atPath: legacy.path), "plaintext survived")
        try require(FileManager.default.fileExists(atPath: validRoot.path), "parent was deleted")
        let encoded = try Data(contentsOf: valid.migrationJournalURL)
        try require(!String(decoding: encoded, as: UTF8.self).contains("raw-legacy-secret"), "secret entered journal")

        // Offline relaunch keeps strict non-secret evidence and requires fresh login.
        var relaunched = try OwnerCredentialStore(accessGroup: group, applicationSupportDirectory: validRoot)
        let relaunchedJournal = try relaunched.prepareForStartup(installationId: installation)
        try require(relaunchedJournal == journal, "offline revocation evidence was not durable")

        // Malformed files fail closed and are not deleted.
        let malformedRoot = root.appendingPathComponent("malformed", isDirectory: true)
        try FileManager.default.createDirectory(at: malformedRoot, withIntermediateDirectories: true)
        let malformedURL = malformedRoot.appendingPathComponent("credential.json")
        try Data(#"{"key":"secret","keyId":"id","apiUrl":"https://api.example.test","extra":true}"#.utf8)
            .write(to: malformedURL)
        var malformed = try OwnerCredentialStore(accessGroup: group, applicationSupportDirectory: malformedRoot)
        do {
            _ = try malformed.prepareForStartup(installationId: installation)
            throw FixtureFailure.assertion("malformed plaintext accepted")
        } catch OwnerCredentialStoreFailure.malformedLegacyCredential {}
        try require(FileManager.default.fileExists(atPath: malformedURL.path), "malformed evidence was deleted")

        // Legacy IDs must match the server's exact safe identifier grammar before
        // any journal write or plaintext deletion occurs.
        let invalidIDRoot = root.appendingPathComponent("invalid-id", isDirectory: true)
        try FileManager.default.createDirectory(at: invalidIDRoot, withIntermediateDirectories: true)
        let invalidIDURL = invalidIDRoot.appendingPathComponent("credential.json")
        try Data(#"{"key":"secret","keyId":"unsafe/id","apiUrl":"https://api.example.test"}"#.utf8)
            .write(to: invalidIDURL)
        var invalidID = try OwnerCredentialStore(accessGroup: group, applicationSupportDirectory: invalidIDRoot)
        do {
            _ = try invalidID.prepareForStartup(installationId: installation)
            throw FixtureFailure.assertion("invalid legacy key ID accepted")
        } catch OwnerCredentialStoreFailure.malformedLegacyCredential {}
        try require(FileManager.default.fileExists(atPath: invalidIDURL.path), "invalid legacy key ID source was deleted")
        try require(!FileManager.default.fileExists(atPath: invalidID.migrationJournalURL.path), "invalid legacy key ID was journaled")

        // Deletion failure preserves the exact file and durable key-ID journal.
        let deletionRoot = root.appendingPathComponent("deletion", isDirectory: true)
        try FileManager.default.createDirectory(at: deletionRoot, withIntermediateDirectories: true)
        let deletionURL = deletionRoot.appendingPathComponent("credential.json")
        try Data(#"{"key":"secret","keyId":"delete-id","apiUrl":"https://api.example.test"}"#.utf8)
            .write(to: deletionURL)
        let live = OwnerCredentialFileOperations.live
        let failingFiles = OwnerCredentialFileOperations(
            read: live.read, writeAtomic: live.writeAtomic,
            remove: { url in if url.lastPathComponent == "credential.json" { throw FixtureFailure.injectedDeletion }; try live.remove(url) },
            exists: live.exists,
            isRegularNonSymlink: live.isRegularNonSymlink
        )
        var deletion = try OwnerCredentialStore(
            accessGroup: group, applicationSupportDirectory: deletionRoot, files: failingFiles
        )
        do {
            _ = try deletion.prepareForStartup(installationId: installation)
            throw FixtureFailure.assertion("deletion failure accepted")
        } catch OwnerCredentialStoreFailure.fileDeletionFailed {}
        try require(FileManager.default.fileExists(atPath: deletionURL.path), "failed deletion removed file")
        let deletionJournal = try deletion.loadJournal()
        try require(deletionJournal?.legacyKeyId == "delete-id", "revocation ID not journaled first")

        // A failed absence read-back remains signed out even after remove returns.
        let readBackRoot = root.appendingPathComponent("readback", isDirectory: true)
        try FileManager.default.createDirectory(at: readBackRoot, withIntermediateDirectories: true)
        let readBackURL = readBackRoot.appendingPathComponent("credential.json")
        try Data(#"{"key":"secret","keyId":"readback-id","apiUrl":"https://api.example.test"}"#.utf8)
            .write(to: readBackURL)
        var removed = false
        let staleReadBack = OwnerCredentialFileOperations(
            read: live.read, writeAtomic: live.writeAtomic,
            remove: { url in try live.remove(url); if url == readBackURL { removed = true } },
            exists: { url in url == readBackURL && removed ? true : live.exists(url) },
            isRegularNonSymlink: live.isRegularNonSymlink
        )
        var readBack = try OwnerCredentialStore(
            accessGroup: group, applicationSupportDirectory: readBackRoot, files: staleReadBack
        )
        do {
            _ = try readBack.prepareForStartup(installationId: installation)
            throw FixtureFailure.assertion("absence read-back failure accepted")
        } catch OwnerCredentialStoreFailure.fileReadBackFailed {}

        // Keychain write with mismatched read-back fails closed.
        let security = IndexKeychainSecurityOperations(
            add: { _, _ in errSecSuccess },
            copyMatching: { _, result in result?.pointee = Data("wrong".utf8) as CFData; return errSecSuccess },
            update: { _, _ in errSecSuccess },
            delete: { _ in errSecSuccess }
        )
        let keychain = IndexKeychainStore(security: security)
        let keychainRoot = root.appendingPathComponent("keychain", isDirectory: true)
        let keychainOwner = try OwnerCredentialStore(
            accessGroup: group, applicationSupportDirectory: keychainRoot, keychain: keychain
        )
        let record = OwnerCredentialRecord(
            credential: "idxo_process-only", credentialId: UUID().uuidString,
            installationId: installation, generation: UUID().uuidString,
            expiresAt: Date().addingTimeInterval(60)
        )
        do {
            try keychainOwner.putAndVerify(record)
            throw FixtureFailure.assertion("Keychain read-back mismatch accepted")
        } catch IndexKeychainStoreError.verificationFailed {}

        // Server expiry timestamps include milliseconds. Keychain serialization
        // must preserve them so strict write/read-back equality does not roll a
        // successfully exchanged credential back before activation.
        var storedData: Data?
        let roundTripSecurity = IndexKeychainSecurityOperations(
            add: { query, _ in
                let attributes = query as NSDictionary
                storedData = attributes[kSecValueData as String] as? Data
                return errSecSuccess
            },
            copyMatching: { _, result in
                guard let storedData else { return errSecItemNotFound }
                result?.pointee = storedData as CFData
                return errSecSuccess
            },
            update: { _, _ in errSecSuccess },
            delete: { _ in errSecSuccess }
        )
        let fractionalOwner = try OwnerCredentialStore(
            accessGroup: group,
            applicationSupportDirectory: root.appendingPathComponent("fractional-keychain", isDirectory: true),
            keychain: IndexKeychainStore(security: roundTripSecurity)
        )
        let fractionalRecord = OwnerCredentialRecord(
            credential: "idxo_fractional-expiry", credentialId: UUID().uuidString,
            installationId: installation, generation: UUID().uuidString,
            expiresAt: Date(timeIntervalSince1970: 2_000_000_000.270)
        )
        try fractionalOwner.putAndVerify(fractionalRecord)
        let fractionalReadBack = try fractionalOwner.loadCredential()
        try require(fractionalReadBack == fractionalRecord, "fractional expiry was truncated")
    }
}
