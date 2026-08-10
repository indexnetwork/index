import Cocoa
import WebKit
import Network
import Security

// ---------------------------------------------------------------------------
// Configuration. API_URL / APP_URL are read from UserDefaults (e.g. `defaults
// write network.index.system6 API_URL https://…`) or Info.plist, so production
// URLs are switchable without recompiling. Defaults target a local dev backend.
// ---------------------------------------------------------------------------
enum AppConfig {
    static var apiURL: String { value(for: "API_URL", default: "http://localhost:3001") }
    static var appURL: String { value(for: "APP_URL", default: "http://localhost:3000") }

    static var deepLinkHosts: [String] {
        // Associated-domains host from the bundle (set by link-host.sh at build),
        // plus the configured APP_URL host so https links from the web
        // origin the app is pointed at (e.g. dev.index.network) also route.
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
