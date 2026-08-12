import Foundation

// Production endpoint and release authority is embedded in Info.plist by the
// protected release build. Runtime defaults/overrides are development-only.
enum AppConfig {
    static let isDevelopmentBuild = requiredBool("IndexDevelopmentBuild")
    static let releaseChannel = requiredReleaseChannel()
    static let releaseVersion = requiredString("IndexReleaseVersion")
    static let releaseCommit = requiredString("IndexReleaseCommit")
    static let expectedTeamID = requiredString("IndexExpectedTeamID")
    static let connectorProtocolVersion = requiredString("IndexConnectorProtocolVersion")
    static let apiURL = configuredEndpoint(
        "IndexAPIURL", developmentOverride: "API_URL", production: "https://protocol.index.network"
    )
    static let appURL = configuredEndpoint(
        "IndexWebURL", developmentOverride: "APP_URL", production: "https://index.network"
    )

    static var deepLinkHosts: [String] {
        var hosts: [String] = []
        let bundleHost = Bundle.main.object(forInfoDictionaryKey: "IndexDeepLinkHost") as? String
        let configuredHost = bundleHost?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let configuredHost, !configuredHost.isEmpty {
            hosts.append(configuredHost)
        } else {
            hosts.append("index.network")
        }
        if isDevelopmentBuild,
           let appHost = URL(string: appURL)?.host?.lowercased(),
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

    private static func requiredString(_ key: String) -> String {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            fatalError("Missing embedded release configuration: \(key)")
        }
        return value
    }

    private static func requiredBool(_ key: String) -> Bool {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? Bool else {
            fatalError("Missing embedded release configuration: \(key)")
        }
        return value
    }

    private static func requiredReleaseChannel() -> String {
        let value = requiredString("IndexReleaseChannel")
        let expected = isDevelopmentBuild ? "development" : "production"
        guard value == expected else {
            fatalError("Invalid embedded release configuration: IndexReleaseChannel")
        }
        return value
    }

    private static func configuredEndpoint(
        _ key: String,
        developmentOverride: String,
        production: String
    ) -> String {
        let embedded = requiredString(key)
        if !isDevelopmentBuild {
            guard embedded == production else {
                fatalError("Invalid embedded production configuration: \(key)")
            }
            return embedded
        }
        if let value = UserDefaults.standard.string(forKey: developmentOverride), !value.isEmpty {
            return value
        }
        return embedded
    }

    static func trimTrailingSlash(_ s: String) -> String {
        var out = s
        while out.hasSuffix("/") { out.removeLast() }
        return out
    }
}
