import Foundation

private enum ConnectorEmbeddedReleaseConfiguration {
    static let releaseChannel = requiredProductionValue("IndexReleaseChannel", expected: "production")
    static let releaseVersion = requiredString("IndexReleaseVersion")
    static let releaseCommit = requiredString("IndexReleaseCommit")
    static let expectedTeamID = requiredProductionValue(
        "IndexExpectedTeamID", expected: "LMQ3XNXLAD"
    )
    static let connectorProtocolVersion = requiredProductionValue(
        "IndexConnectorProtocolVersion", expected: "1"
    )
    static let apiURL = requiredProductionURL(
        "IndexAPIURL", expected: "https://protocol.index.network"
    )
    static let webURL = requiredProductionURL(
        "IndexWebURL", expected: "https://index.network"
    )

    private static func requiredString(_ key: String) -> String {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            fatalError("Missing embedded release configuration: \(key)")
        }
        return value
    }

    private static func requiredProductionValue(_ key: String, expected: String) -> String {
        let value = requiredString(key)
        guard value == expected else {
            fatalError("Invalid embedded production configuration: \(key)")
        }
        return value
    }

    private static func requiredProductionURL(_ key: String, expected: String) -> URL {
        let value = requiredProductionValue(key, expected: expected)
        guard let url = URL(string: value) else {
            fatalError("Invalid embedded production configuration: \(key)")
        }
        return url
    }
}

struct ConnectorEndpoints: Equatable {
    let web: URL
    let api: URL
    let mcp: URL

    static let production = ConnectorEndpoints(
        trustedWeb: ConnectorEmbeddedReleaseConfiguration.webURL,
        trustedAPI: ConnectorEmbeddedReleaseConfiguration.apiURL.appending(path: "api"),
        trustedMCP: ConnectorEmbeddedReleaseConfiguration.apiURL.appending(path: "mcp")
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

    static func markDevelopmentBuild() {
        if buildMode == "development" {
            FileHandle.standardError.write(
                Data("Index Connector development build: non-production endpoints\n".utf8)
            )
        }
    }
}
