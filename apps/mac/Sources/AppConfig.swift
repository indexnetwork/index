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

    /// Where the Help menu sends people. APP_URL is usually unset — the web layer
    /// derives its origin from the API host instead — so fall back to the host
    /// this build was made for rather than to the localhost default.
    static var productURL: String {
        let configured = trimTrailingSlash(appURL)
        if let host = URL(string: configured)?.host, host != "localhost", host != "127.0.0.1" {
            return configured
        }
        return "https://" + (deepLinkHosts.first ?? "index.network")
    }

    /// Point the app at another protocol deployment. UserDefaults is the layer
    /// the reads above consult first, so this outranks the built-in default and
    /// whatever Info.plist carries. The web origin is derived rather than asked
    /// for: every deployment pairs `protocol.<host>` with `<host>`, and a local
    /// API on 3001 pairs with the dev web server on 3000.
    ///
    /// - Parameter apiURL: A bare http(s) origin, without the `/api` prefix.
    static func setProtocolServer(apiURL: String) {
        let api = trimTrailingSlash(apiURL)
        UserDefaults.standard.set(api, forKey: "API_URL")
        UserDefaults.standard.set(webOrigin(forAPI: api), forKey: "APP_URL")
    }

    /// Whether a page-supplied value is addressable as a protocol server: an
    /// http(s) origin and nothing more, never a path or a query.
    static func isProtocolOrigin(_ value: String) -> Bool {
        guard let url = URL(string: trimTrailingSlash(value)),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty,
              url.path.isEmpty, url.query == nil, url.fragment == nil,
              url.user == nil else { return false }
        return true
    }

    private static func webOrigin(forAPI api: String) -> String {
        guard let url = URL(string: api), let host = url.host else { return api }
        if host == "localhost" || host == "127.0.0.1" {
            return "\(url.scheme ?? "http")://\(host):3000"
        }
        let webHost = host.hasPrefix("protocol.") ? String(host.dropFirst("protocol.".count)) : host
        return "https://\(webHost)"
    }

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
