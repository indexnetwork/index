import Foundation

enum AppConfig {
    static var apiURL: String { value(for: "API_URL", default: "http://localhost:3001") }
    static var appURL: String { value(for: "APP_URL", default: "http://localhost:3000") }

    static var deepLinkHosts: [String] {
        var hosts: [String] = []
        let bundleHost = Bundle.main.object(forInfoDictionaryKey: "IndexDeepLinkHost") as? String
        let configuredHost = bundleHost?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let configuredHost, !configuredHost.isEmpty {
            hosts.append(configuredHost)
        } else {
            hosts.append("index.network")
        }
        if let appHost = URL(string: appURL)?.host?.lowercased(),
           !appHost.isEmpty,
           !hosts.contains(where: { $0.lowercased() == appHost }) {
            hosts.append(appHost)
        }
        return hosts
    }

    /// The REST base including the `/api` prefix applied in services/api main.ts.
    static var apiBaseURL: String { trimTrailingSlash(apiURL) + "/api" }
    static var mcpURL: String { trimTrailingSlash(apiURL) + "/mcp" }
    static var ownerKeychainAccessGroup: String? {
        let value = Bundle.main.object(forInfoDictionaryKey: "IndexOwnerKeychainAccessGroup") as? String
        return value?.isEmpty == false ? value : nil
    }

    private static func value(for key: String, default fallback: String) -> String {
        if let v = UserDefaults.standard.string(forKey: key), !v.isEmpty { return v }
        if let v = Bundle.main.object(forInfoDictionaryKey: key) as? String, !v.isEmpty { return v }
        return fallback
    }

    static func trimTrailingSlash(_ s: String) -> String {
        var out = s
        while out.hasSuffix("/") { out.removeLast() }
        return out
    }
}
