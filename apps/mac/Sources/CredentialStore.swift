import Cocoa
import WebKit
import Network
import Security

/// Credential persisted in the login keychain item (kept in memory in the page,
/// never written to localStorage).
struct StoredCredential: Codable {
    var key: String
    var keyId: String
    var apiUrl: String
}

// ---------------------------------------------------------------------------
// ⚠️  DEVELOPMENT-GRADE CREDENTIAL STORAGE, DO NOT SHIP THIS AS-IS.
//
// The single CLI API key is written as plain JSON to
//   ~/Library/Application Support/network.index.system6/credential.json
// with 0600 on the file and 0700 on its directory.
//
// This replaced a login-Keychain generic-password item, and it is a deliberate
// downgrade made for one reason: the dev build is signed ad-hoc, so its code
// identity is its exact binary hash. Every rebuild looked like a different
// application to the Keychain's ACL, which re-prompted for the login password
// on every single launch. A file has no ACL and therefore no prompt.
//
// What that costs, stated plainly:
//   · The key sits in cleartext on disk. Anything running as this user can read
//     it, no per-application gate, no prompt, no audit.
//   · It is not encrypted at rest beyond FileVault (which protects a powered-off
//     disk, not a logged-in session).
//   · It is swept up by Time Machine and any backup or sync tool pointed at
//     Application Support, and by "copy my whole home directory" migrations.
//   · POSIX permissions are the only barrier, and they do not survive being
//     copied through an archive that drops modes.
//
// PROD CHECKLIST, every box below must be ticked before a build that touches
// real user credentials ships:
//
//   [ ] Obtain a Developer ID Application certificate and sign with it. This is
//       the actual fix for the prompt problem: a real identity gives a stable
//       code requirement, so the Keychain ACL keeps matching across rebuilds.
//       Ad-hoc signing was the root cause, not the Keychain.
//   [ ] Restore Keychain storage, revert this type to the SecItem generic
//       password it replaced (see git history for the exact query), keeping
//       kSecAttrAccessibleAfterFirstUnlock.
//   [ ] Prefer the data-protection keychain: kSecUseDataProtectionKeychain =
//       true plus a keychain-access-group entitlement. Access is then governed
//       by entitlement rather than by per-binary ACL, which removes the prompt
//       class of bug entirely.
//   [ ] Enable the hardened runtime and App Sandbox; notarize the bundle.
//   [ ] Migrate on upgrade: read this file once, write it to the Keychain, then
//       delete the file AND its parent directory. Shipping without this strands
//       a cleartext key on every dev machine that ever ran this build.
//   [ ] Confirm the key never reaches localStorage, a WKWebView data store, or
//       a log line. It is injected into the page in memory only, keep it so.
//   [ ] Give the minted credential a real TTL server-side and re-check that
//       logout still revokes it (see revokeCredential).
//
// Tracked so this cannot be forgotten: see docs in apps/mac/README.md.
// ---------------------------------------------------------------------------

/// File-backed store for the single CLI API credential. Development-grade:
/// read the block above before extending or shipping it.
enum CredentialStore {
    /// Reused as the Application Support subdirectory name.
    static let service = "network.index.system6"
    static let fileName = "credential.json"

    private static var directoryURL: URL? {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent(service, isDirectory: true)
    }

    private static var fileURL: URL? {
        directoryURL?.appendingPathComponent(fileName, isDirectory: false)
    }

    static func save(_ cred: StoredCredential) {
        guard let dir = directoryURL, let url = fileURL,
              let data = try? JSONEncoder().encode(cred) else { return }
        try? FileManager.default.createDirectory(
            at: dir, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        // An atomic write swaps in a fresh inode, so the mode has to be set
        // afterwards, doing it before would apply to a file that no longer
        // exists by the time anyone can read it.
        guard (try? data.write(to: url, options: [.atomic])) != nil else { return }
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    static func load() -> StoredCredential? {
        guard let url = fileURL,
              let data = try? Data(contentsOf: url),
              let cred = try? JSONDecoder().decode(StoredCredential.self, from: data)
        else { return nil }
        return cred
    }

    static func delete() {
        guard let url = fileURL else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
