import Foundation

/// Shared non-secret Application Support namespace used by Hermes persistence.
enum CredentialStore {
    static let service = "network.index.system6"
}

enum OwnerInstallationStore {
    private static let key = "INDEX_OWNER_INSTALLATION_ID"

    static func loadOrCreate() -> String {
        if let value = UserDefaults.standard.string(forKey: key), UUID(uuidString: value) != nil {
            return value.lowercased()
        }
        let value = UUID().uuidString.lowercased()
        UserDefaults.standard.set(value, forKey: key)
        return value
    }
}
