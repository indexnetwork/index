import Foundation

struct ConnectorEndpoints: Equatable {
    let web: URL
    let api: URL
    let mcp: URL

    static let production = ConnectorEndpoints(
        trustedWeb: URL(string: "https://index.network")!,
        trustedAPI: URL(string: "https://protocol.index.network/api")!,
        trustedMCP: URL(string: "https://protocol.index.network/mcp")!
    )

    #if INDEX_CONNECTOR_NONPRODUCTION
    static let embedded = ConnectorEndpoints(
        trustedWeb: URL(string: ConnectorEmbeddedDevelopmentEndpoints.web)!,
        trustedAPI: URL(string: ConnectorEmbeddedDevelopmentEndpoints.api)!,
        trustedMCP: URL(string: ConnectorEmbeddedDevelopmentEndpoints.mcp)!
    )

    init(developmentWeb: URL, developmentAPI: URL, developmentMCP: URL) throws {
        guard Self.validDevelopmentURL(developmentWeb),
              Self.validDevelopmentURL(developmentAPI),
              Self.validDevelopmentURL(developmentMCP),
              developmentAPI.path.hasSuffix("/api"),
              developmentMCP.path.hasSuffix("/mcp") else {
            throw ConnectorIdentityError.invalidDevelopmentEndpoints
        }
        self.init(trustedWeb: developmentWeb, trustedAPI: developmentAPI, trustedMCP: developmentMCP)
    }
    #else
    static let embedded = production
    #endif

    private init(trustedWeb: URL, trustedAPI: URL, trustedMCP: URL) {
        web = trustedWeb
        api = trustedAPI
        mcp = trustedMCP
    }

    #if INDEX_CONNECTOR_NONPRODUCTION
    private static func validDevelopmentURL(_ url: URL) -> Bool {
        guard url.user == nil, url.password == nil, url.fragment == nil,
              let host = url.host, !host.isEmpty else { return false }
        return url.scheme == "https" || (url.scheme == "http" && host == "127.0.0.1")
    }
    #endif
}

enum ConnectorIdentityError: Error {
    case invalidDevelopmentEndpoints
}

enum ConnectorBuildIdentity {
    #if INDEX_CONNECTOR_NONPRODUCTION
    static let buildMode = "development"
    static let apiEnvironment = "development"
    #else
    static let buildMode = "production"
    static let apiEnvironment = "production"
    #endif
}
