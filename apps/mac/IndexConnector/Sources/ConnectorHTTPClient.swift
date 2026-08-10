import Foundation

struct ConnectorCreatedAuthorization: Decodable {
    let requestId: String
    let state: String
    let expiresAt: Date
}

struct ConnectorCredentialExchange: Decodable {
    let credential: String
    let audience: String
    let credentialId: String
    let agentId: String
    let installationId: String
    let setupAttemptId: String
    let actions: [String]
    let expiresAt: Date
    let activationState: String
}

struct ConnectorActivatedCredential: Decodable {
    let audience: String
    let credentialId: String
    let agentId: String
    let installationId: String
    let setupAttemptId: String
    let actions: [String]
    let expiresAt: Date
    let activationState: String
}

struct ConnectorRESTResult {
    let status: Int
    let body: JSONValue
}

struct ConnectorRevocationReceipt: Decodable, Equatable {
    let revoked: Bool
    let credentialId: String
    let setupAttemptId: String
}

enum ConnectorHTTPError: Error, Equatable {
    case invalidRequest
    case routeDenied
    case toolDenied
    case uploadTooLarge
    case responseTooLarge
    case endpointNotAllowed
    case timedOut
    case networkFailure
    case invalidResponse
    case unauthorized
    case serverRejected(String)
    case revocationUnconfirmed
}

private final class BoundedRequestDelegate: NSObject, URLSessionDataDelegate {
    private let maximumBytes: Int
    private let completion: (HTTPURLResponse?, Data?, ConnectorHTTPError?) -> Void
    private var response: HTTPURLResponse?
    private var data = Data()
    private var exceededLimit = false

    init(
        maximumBytes: Int,
        completion: @escaping (HTTPURLResponse?, Data?, ConnectorHTTPError?) -> Void
    ) {
        self.maximumBytes = maximumBytes
        self.completion = completion
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        self.response = http
        if response.expectedContentLength > Int64(maximumBytes) {
            exceededLimit = true
            completionHandler(.cancel)
        } else {
            completionHandler(.allow)
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // Never forward the dedicated credential to a redirected origin.
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive bytes: Data) {
        guard !exceededLimit else { return }
        guard data.count <= maximumBytes - bytes.count else {
            exceededLimit = true
            dataTask.cancel()
            return
        }
        data.append(bytes)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        if exceededLimit {
            completion(response, nil, .responseTooLarge)
        } else if let urlError = error as? URLError, urlError.code == .timedOut {
            completion(response, nil, .timedOut)
        } else if error != nil {
            completion(response, nil, .networkFailure)
        } else {
            completion(response, data, nil)
        }
    }
}

final class ConnectorHTTPClient {
    static let maximumResponseBytes = 1_048_576
    static let maximumUploadBytes = 8_388_608
    static let timeoutInterval = 30.0

    private let endpoints: ConnectorEndpoints
    private let jsonEncoder: JSONEncoder
    private let jsonDecoder: JSONDecoder

    init(endpoints: ConnectorEndpoints = .embedded) {
        self.endpoints = endpoints
        jsonEncoder = JSONEncoder()
        jsonDecoder = JSONDecoder()
        jsonDecoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let ordinary = ISO8601DateFormatter()
            ordinary.formatOptions = [.withInternetDateTime]
            guard let date = fractional.date(from: value) ?? ordinary.date(from: value) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Invalid ISO-8601 timestamp"
                )
            }
            return date
        }
    }

    func createAuthorization(
        installationId: String,
        redirectURI: String,
        codeChallenge: String,
        state: String,
        actions: [String]
    ) throws -> ConnectorCreatedAuthorization {
        let body: JSONValue = .object([
            "protocolVersion": .number(1),
            "installationId": .string(installationId),
            "redirectUri": .string(redirectURI),
            "codeChallenge": .string(codeChallenge),
            "codeChallengeMethod": .string("S256"),
            "state": .string(state),
            "actions": .array(actions.map(JSONValue.string)),
        ])
        let result = try performAPI(method: "POST", path: "/hermes-authorizations", body: body)
        try requireSuccess(result)
        return try decode(ConnectorCreatedAuthorization.self, from: result.body)
    }

    func exchangeAuthorization(
        requestId: String,
        code: String,
        verifier: String,
        redirectURI: String
    ) throws -> ConnectorCredentialExchange {
        let body: JSONValue = .object([
            "protocolVersion": .number(1),
            "requestId": .string(requestId),
            "code": .string(code),
            "verifier": .string(verifier),
            "redirectUri": .string(redirectURI),
        ])
        let result = try performAPI(method: "POST", path: "/hermes-authorizations/exchange", body: body)
        try requireSuccess(result)
        return try decode(ConnectorCredentialExchange.self, from: result.body)
    }

    func activate(credential: String) throws -> ConnectorActivatedCredential {
        let result = try performAPI(
            method: "POST",
            path: "/hermes-authorizations/activate",
            body: .object(["protocolVersion": .number(1), "keychainConfirmed": .bool(true)]),
            credential: credential
        )
        try requireSuccess(result)
        return try decode(ConnectorActivatedCredential.self, from: result.body)
    }

    func fetchAccountLabel(credential: String) throws -> String {
        let result = try performAPI(method: "GET", path: "/auth/me", body: nil, credential: credential)
        try requireSuccess(result)
        guard case let .object(root) = result.body else { throw ConnectorHTTPError.invalidResponse }
        let account: [String: JSONValue]
        if case let .object(user)? = root["user"] { account = user } else { account = root }
        for key in ["name", "email"] {
            if case let .string(value)? = account[key], !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return value
            }
        }
        throw ConnectorHTTPError.invalidResponse
    }

    func rest(
        method: String,
        path: String,
        body: JSONValue?,
        credential: ConnectorCredentialRecord
    ) throws -> ConnectorRESTResult {
        guard ConnectorRoutePolicy.allows(method: method, path: path, agentId: credential.agentId) else {
            throw ConnectorHTTPError.routeDenied
        }
        return try performAPI(
            method: method.uppercased(),
            path: path,
            body: body,
            credential: credential.rawCredential
        )
    }

    func callMCP(
        toolName: String,
        arguments: [String: JSONValue],
        credential: ConnectorCredentialRecord
    ) throws -> JSONValue {
        guard ConnectorRoutePolicy.allowedMCPTools.contains(toolName) else {
            throw ConnectorHTTPError.toolDenied
        }
        let body: JSONValue = .object([
            "jsonrpc": .string("2.0"),
            "id": .string(UUID().uuidString),
            "method": .string("tools/call"),
            "params": .object([
                "name": .string(toolName),
                "arguments": .object(arguments),
            ]),
        ])
        let result = try perform(
            url: endpoints.mcp,
            method: "POST",
            body: body,
            credential: credential.rawCredential
        )
        try requireSuccess(result)
        guard case let .object(envelope) = result.body,
              envelope["error"] == nil,
              let decodedResult = envelope["result"] else {
            throw ConnectorHTTPError.invalidResponse
        }
        return decodedResult
    }

    func revoke(credential: String) throws -> ConnectorRevocationReceipt {
        let result = try performAPI(
            method: "POST",
            path: "/hermes-authorizations/disconnect",
            body: .object(["protocolVersion": .number(1)]),
            credential: credential
        )
        try requireSuccess(result)
        let receipt = try decode(ConnectorRevocationReceipt.self, from: result.body)
        guard receipt.revoked else { throw ConnectorHTTPError.invalidResponse }
        return receipt
    }

    func requireRevokedCredentialProbe(credential: String) throws {
        let result = try performAPI(method: "GET", path: "/auth/me", body: nil, credential: credential)
        guard result.status == 401 else { throw ConnectorHTTPError.revocationUnconfirmed }
    }

    private func performAPI(
        method: String,
        path: String,
        body: JSONValue?,
        credential: String? = nil
    ) throws -> ConnectorRESTResult {
        let url = try apiURL(for: path)
        return try perform(url: url, method: method, body: body, credential: credential)
    }

    private func apiURL(for relativePath: String) throws -> URL {
        guard relativePath.hasPrefix("/"), !relativePath.hasPrefix("//"),
              !relativePath.lowercased().contains("%2f"),
              let components = URLComponents(string: relativePath),
              components.scheme == nil, components.host == nil,
              components.user == nil, components.password == nil,
              components.fragment == nil,
              !components.path.split(separator: "/", omittingEmptySubsequences: false)
                .contains(where: { $0 == "." || $0 == ".." }) else {
            throw ConnectorHTTPError.endpointNotAllowed
        }
        var base = endpoints.api
        base.append(path: String(components.path.dropFirst()))
        if let query = components.percentEncodedQuery {
            guard var final = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
                throw ConnectorHTTPError.endpointNotAllowed
            }
            final.percentEncodedQuery = query
            guard let url = final.url else { throw ConnectorHTTPError.endpointNotAllowed }
            return url
        }
        return base
    }

    private func perform(
        url: URL,
        method: String,
        body: JSONValue?,
        credential: String?
    ) throws -> ConnectorRESTResult {
        guard url.scheme == "https" || (ConnectorBuildIdentity.buildMode == "development" && url.host == "127.0.0.1") else {
            throw ConnectorHTTPError.endpointNotAllowed
        }
        var request = URLRequest(url: url, timeoutInterval: Self.timeoutInterval)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let credential { request.setValue(credential, forHTTPHeaderField: "x-api-key") }
        if let body {
            let encoded = try JSONEncoder().encode(body)
            guard encoded.count <= Self.maximumUploadBytes else { throw ConnectorHTTPError.uploadTooLarge }
            request.httpBody = encoded
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let semaphore = DispatchSemaphore(value: 0)
        var completedResponse: HTTPURLResponse?
        var completedData: Data?
        var completedError: ConnectorHTTPError?
        let delegate = BoundedRequestDelegate(maximumBytes: Self.maximumResponseBytes) { response, data, error in
            completedResponse = response
            completedData = data
            completedError = error
            semaphore.signal()
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.timeoutInterval
        configuration.timeoutIntervalForResource = Self.timeoutInterval
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        let task = session.dataTask(with: request)
        task.resume()
        guard semaphore.wait(timeout: .now() + Self.timeoutInterval + 1) == .success else {
            task.cancel()
            session.invalidateAndCancel()
            throw ConnectorHTTPError.timedOut
        }
        session.finishTasksAndInvalidate()
        if let completedError { throw completedError }
        guard let response = completedResponse, let data = completedData else {
            throw ConnectorHTTPError.invalidResponse
        }
        let decoded = try decodeResponseBody(data, contentType: response.value(forHTTPHeaderField: "Content-Type"))
        return ConnectorRESTResult(status: response.statusCode, body: decoded)
    }

    private func decodeResponseBody(_ data: Data, contentType: String?) throws -> JSONValue {
        if data.isEmpty { return .null }
        if contentType?.lowercased().contains("text/event-stream") == true {
            let text = String(decoding: data, as: UTF8.self)
            for line in text.split(separator: "\n").reversed() {
                guard line.hasPrefix("data:") else { continue }
                let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                if payload == "[DONE]" { continue }
                guard let eventData = payload.data(using: .utf8) else { continue }
                return try JSONDecoder().decode(JSONValue.self, from: eventData)
            }
            throw ConnectorHTTPError.invalidResponse
        }
        do {
            return try JSONDecoder().decode(JSONValue.self, from: data)
        } catch {
            throw ConnectorHTTPError.invalidResponse
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from value: JSONValue) throws -> T {
        do {
            return try jsonDecoder.decode(type, from: JSONEncoder().encode(value))
        } catch {
            throw ConnectorHTTPError.invalidResponse
        }
    }

    private func requireSuccess(_ result: ConnectorRESTResult) throws {
        guard (200..<300).contains(result.status) else {
            if result.status == 401 { throw ConnectorHTTPError.unauthorized }
            if case let .object(body) = result.body, case let .string(code)? = body["error"] {
                throw ConnectorHTTPError.serverRejected(Self.sanitizedServerCode(code))
            }
            throw ConnectorHTTPError.serverRejected("request_rejected")
        }
    }

    private static func sanitizedServerCode(_ code: String) -> String {
        guard code.count <= 64,
              code.unicodeScalars.allSatisfy({
                  CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-")).contains($0)
              }) else { return "request_rejected" }
        return code
    }
}

enum ConnectorRoutePolicy {
    private static let staticRoutes: Set<String> = [
        "GET /agents/me", "GET /auth/me", "PATCH /auth/profile/update",
        "POST /intents/list", "GET /opportunities", "GET /questions",
        "GET /networks", "GET /networks/discovery/public", "GET /network-requests",
        "POST /network-requests", "POST /tools/read_user_contexts",
        "POST /tools/confirm_user_context", "POST /storage/avatars",
        "POST /storage/index-images", "POST /enrichment/sync", "POST /enrichment/enrich",
        "GET /conversations", "GET /conversations/stream", "POST /conversations/dm",
    ]

    static let allowedMCPTools: Set<String> = [
        "read_user_contexts", "preview_user_context", "confirm_user_context",
        "create_user_context", "update_user_context", "get_enrichment_run",
        "cancel_enrichment_run", "read_intents", "search_intents", "create_intent",
        "update_intent", "read_intent_indexes", "create_intent_index", "list_negotiations",
        "get_negotiation", "respond_to_negotiation", "read_networks",
        "read_network_memberships", "create_network", "update_network",
        "create_network_membership", "list_opportunities", "update_opportunity",
        "confirm_opportunity_delivery", "read_premises", "create_premise",
        "update_premise", "retract_premise", "read_pending_questions",
        "read_activity_summary", "read_docs",
    ]

    static func allows(method rawMethod: String, path rawPath: String, agentId: String) -> Bool {
        let method = rawMethod.uppercased()
        guard ["GET", "POST", "PATCH", "DELETE"].contains(method),
              let components = URLComponents(string: rawPath),
              components.scheme == nil, components.host == nil, components.fragment == nil else {
            return false
        }
        let path = components.path
        if staticRoutes.contains("\(method) \(path)") { return true }
        let segment = "[^/]+"
        let dynamic: [(String, String)] = [
            ("PATCH", "^/intents/\(segment)/(?:status|archive)$"),
            ("PATCH", "^/opportunities/\(segment)/status$"),
            ("POST", "^/opportunities/\(segment)/start-chat$"),
            ("POST", "^/questions/\(segment)/(?:answer|dismiss)$"),
            ("GET", "^/users/\(segment)$"),
            ("POST", "^/networks/\(segment)/join$"),
            ("PATCH", "^/network-requests/\(segment)$"),
            ("DELETE", "^/network-requests/\(segment)$"),
            ("GET", "^/conversations/\(segment)/messages$"),
            ("POST", "^/conversations/\(segment)/messages$"),
        ]
        if dynamic.contains(where: { $0.0 == method && path.range(of: $0.1, options: .regularExpression) != nil }) {
            return true
        }
        let escapedAgent = NSRegularExpression.escapedPattern(for: agentId)
        let negotiation = "^/agents/\(escapedAgent)/negotiations/(?:pickup|\(segment)/(?:respond|consult))$"
        return method == "POST" && path.range(of: negotiation, options: .regularExpression) != nil
    }
}
