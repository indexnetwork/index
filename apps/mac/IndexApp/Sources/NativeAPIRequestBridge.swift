import Foundation
import WebKit

indirect enum NativeJSONValue: Codable, Equatable {
    case null, bool(Bool), number(Double), string(String)
    case array([NativeJSONValue]), object([String: NativeJSONValue])

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let decoded = try? value.decode(Bool.self) { self = .bool(decoded) }
        else if let decoded = try? value.decode(Double.self) { self = .number(decoded) }
        else if let decoded = try? value.decode(String.self) { self = .string(decoded) }
        else if let decoded = try? value.decode([NativeJSONValue].self) { self = .array(decoded) }
        else { self = .object(try value.decode([String: NativeJSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .null: try value.encodeNil()
        case .bool(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .string(let item): try value.encode(item)
        case .array(let item): try value.encode(item)
        case .object(let item): try value.encode(item)
        }
    }
}

enum NativeAPIOperationKind: String, Codable { case http, upload, mcp, sse, cancel }

struct NativeAPIOperation: Codable {
    let kind: NativeAPIOperationKind
    let method: String?
    let path: String?
    let body: NativeJSONValue?
    let tool: String?
    let arguments: NativeJSONValue?
    let fieldName: String?
    let basename: String?
    let dataUrl: String?
    let targetRequestId: String?
}

struct NativeAPIRequest: Codable {
    let requestId: String
    let operation: NativeAPIOperation
}

struct NativeAPIResponse: Codable {
    let requestId: String
    let ok: Bool
    let status: Int?
    let body: NativeJSONValue?
    let headers: [String: String]?
    let errorCode: String?
}

struct NativeAPIEvent: Codable {
    let requestId: String
    let sequence: Int
    let event: NativeJSONValue
}

enum NativeAPIRequestFailure: Error {
    case invalidRequest, deniedOperation, signedOut, oversizedRequest
    case oversizedUpload, oversizedResponse, timedOut, cancelled, transportFailure

    var code: String {
        switch self {
        case .invalidRequest: return "invalid_request"
        case .deniedOperation: return "operation_denied"
        case .signedOut: return "signed_out"
        case .oversizedRequest: return "request_too_large"
        case .oversizedUpload: return "upload_too_large"
        case .oversizedResponse: return "response_too_large"
        case .timedOut: return "request_timed_out"
        case .cancelled: return "request_cancelled"
        case .transportFailure: return "transport_failure"
        }
    }
}

/// Credential-owning, structured WebKit request boundary. JavaScript can choose
/// only an enumerated operation and relative allowlisted product path; Swift
/// alone reads Keychain and constructs transport authentication.
final class NativeAPIRequestBridge {
    static let maximumRequestBytes = 1_048_576
    static let maximumUploadBytes = 8_388_608
    static let maximumEncodedUploadRequestBytes = 11_184_896
    static let maximumResponseBytes = 1_048_576
    static let maximumEventBytes = 65_536
    static let maximumEvents = 256
    static let maximumPendingRequests = 32
    static let requestTimeout: TimeInterval = 30
    static let streamTimeout: TimeInterval = 300

    private static let exactOperationKeys: [NativeAPIOperationKind: [Set<String>]] = [
        .http: [["kind", "method", "path"], ["kind", "method", "path", "body"]],
        .upload: [["kind", "path", "fieldName", "basename", "dataUrl"]],
        .mcp: [["kind", "tool", "arguments"]],
        .sse: [["kind", "method", "path"], ["kind", "method", "path", "body"]],
        .cancel: [["kind", "targetRequestId"]],
    ]

    // Exact method + path patterns mirror the dedicated server audience. Query
    // strings are admitted only on routes whose wrappers need them.
    static let allowedHTTPRoutes: [(String, String)] = [
        ("GET", #"^/auth/me$"#), ("PATCH", #"^/auth/profile/update$"#),
        ("GET", #"^/agent-runtime(?:\?installationId=[A-Za-z0-9_-]+)?$"#),
        ("PUT", #"^/agent-runtime$"#),
        ("POST", #"^/agent-runtime/(?:hermes/prepare|rollback)$"#),
        ("DELETE", #"^/agent-runtime/hermes/[^/?]+$"#),
        ("GET", #"^/networks$"#), ("POST", #"^/networks$"#),
        ("GET", #"^/networks/[^/?]+/(?:overview|my-intents)$"#),
        ("POST", #"^/networks/[^/?]+/(?:join|leave)$"#),
        ("GET", #"^/network-requests$"#), ("POST", #"^/network-requests$"#),
        ("PATCH", #"^/network-requests/[^/?]+$"#), ("DELETE", #"^/network-requests/[^/?]+$"#),
        ("GET", #"^/agents$"#), ("GET", #"^/users/(?:batch(?:\?.*)?|[^/?]+(?:/negotiations(?:\?.*)?)?)$"#),
        ("POST", #"^/intents/(?:list|confirm|reject|intake/(?:start|question|prepare|proposal|revise))$"#),
        ("GET", #"^/intents/[^/?]+$"#), ("PATCH", #"^/intents/[^/?]+/(?:archive|status)$"#),
        ("GET", #"^/opportunities(?:\?.*)?$"#),
        ("GET", #"^/opportunities/(?:radar|chat-context)(?:\?.*)?$"#),
        ("GET", #"^/opportunities/[^/?]+(?:/invite-message)?$"#),
        ("PATCH", #"^/opportunities/[^/?]+/status$"#),
        ("POST", #"^/opportunities/[^/?]+/start-chat$"#),
        ("GET", #"^/questions(?:\?.*)?$"#),
        ("POST", #"^/questions/[^/?]+/(?:answer|dismiss)$"#),
        ("POST", #"^/tools/[^/?]+$"#), ("POST", #"^/enrichment/enrich$"#),
        ("GET", #"^/conversations(?:/negotiations)?$"#),
        ("GET", #"^/conversations/[^/?]+/messages(?:\?.*)?$"#),
        ("POST", #"^/conversations/(?:dm|[^/?]+/messages)$"#),
        ("PATCH", #"^/conversations/[^/?]+/metadata$"#),
        ("DELETE", #"^/conversations/[^/?]+$"#),
    ]
    static let allowedUploadRoutes: Set<String> = ["/storage/avatars", "/storage/index-images"]
    static let allowedUploadMedia: [String: (mimeType: String, extensionName: String)] = [
        "data:image/jpeg;base64": ("image/jpeg", "jpg"),
        "data:image/png;base64": ("image/png", "png"),
        "data:image/webp;base64": ("image/webp", "webp"),
    ]
    static let allowedSSERoutes: Set<String> = ["GET /conversations/stream", "POST /chat/stream"]
    static let allowedMCPTools: Set<String> = ["create_intent"]

    private let apiBaseURL: URL
    private let mcpURL: URL
    private let credentialProvider: () throws -> OwnerCredentialRecord?
    private let trustedMessage: (WKScriptMessage) -> Bool
    private let terminal: (NativeAPIResponse) -> Void
    private let event: (NativeAPIEvent) -> Void
    private let session: URLSession
    private let stateQueue = DispatchQueue(label: "network.index.native-api.state")
    private var tasks: [String: URLSessionTask] = [:]
    private var completed: Set<String> = []

    init(
        apiBaseURL: URL,
        mcpURL: URL,
        credentialProvider: @escaping () throws -> OwnerCredentialRecord?,
        trustedMessage: @escaping (WKScriptMessage) -> Bool,
        terminal: @escaping (NativeAPIResponse) -> Void,
        event: @escaping (NativeAPIEvent) -> Void
    ) {
        self.apiBaseURL = apiBaseURL
        self.mcpURL = mcpURL
        self.credentialProvider = credentialProvider
        self.trustedMessage = trustedMessage
        self.terminal = terminal
        self.event = event
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.requestTimeout
        configuration.timeoutIntervalForResource = Self.streamTimeout
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        self.session = URLSession(configuration: configuration)
    }

    func handle(_ message: WKScriptMessage) {
        // Admission precedes reading page-controlled data.
        guard message.frameInfo.isMainFrame, trustedMessage(message) else { return }
        let requestId = (message.body as? [String: Any])?["requestId"] as? String ?? ""
        do {
            let request = try decode(message.body)
            if request.operation.kind == .cancel {
                try cancel(request)
                finish(NativeAPIResponse(requestId: request.requestId, ok: true, status: 200,
                                         body: .object(["cancelled": .bool(true)]), headers: [:], errorCode: nil))
                return
            }
            try stateQueue.sync {
                guard tasks.count < Self.maximumPendingRequests,
                      tasks[request.requestId] == nil,
                      !completed.contains(request.requestId) else { throw NativeAPIRequestFailure.invalidRequest }
            }
            try execute(request)
        } catch let failure as NativeAPIRequestFailure {
            finishFailure(requestId: requestId, failure: failure)
        } catch {
            finishFailure(requestId: requestId, failure: .invalidRequest)
        }
    }

    private func decode(_ body: Any) throws -> NativeAPIRequest {
        guard let object = body as? [String: Any], Set(object.keys) == ["requestId", "operation"],
              let requestId = object["requestId"] as? String,
              !requestId.isEmpty, requestId.count <= 128,
              let operation = object["operation"] as? [String: Any],
              let kindValue = operation["kind"] as? String,
              let kind = NativeAPIOperationKind(rawValue: kindValue),
              Self.exactOperationKeys[kind]?.contains(Set(operation.keys)) == true,
              JSONSerialization.isValidJSONObject(object) else { throw NativeAPIRequestFailure.invalidRequest }
        let data = try JSONSerialization.data(withJSONObject: object)
        let limit = kind == .upload ? Self.maximumEncodedUploadRequestBytes : Self.maximumRequestBytes
        guard data.count <= limit else { throw NativeAPIRequestFailure.oversizedRequest }
        return try JSONDecoder().decode(NativeAPIRequest.self, from: data)
    }

    private func execute(_ request: NativeAPIRequest) throws {
        guard let credential = try credentialProvider(), credential.expiresAt > Date() else {
            throw NativeAPIRequestFailure.signedOut
        }
        switch request.operation.kind {
        case .http:
            guard let method = request.operation.method, let path = request.operation.path,
                  Self.isAllowedHTTP(method: method, path: path),
                  Self.isAllowedBody(method: method, path: path, body: request.operation.body) else {
                throw NativeAPIRequestFailure.deniedOperation
            }
            try perform(request, credential: credential, method: method, path: path,
                        body: request.operation.body, sse: false)
        case .sse:
            guard let method = request.operation.method, let path = request.operation.path,
                  Self.allowedSSERoutes.contains("\(method) \(path)"),
                  Self.isAllowedSSEBody(method: method, path: path, body: request.operation.body) else {
                throw NativeAPIRequestFailure.deniedOperation
            }
            try perform(request, credential: credential, method: method, path: path,
                        body: request.operation.body, sse: true)
        case .mcp:
            guard let tool = request.operation.tool, Self.allowedMCPTools.contains(tool),
                  Self.isAllowedMCPArguments(tool: tool, arguments: request.operation.arguments) else {
                throw NativeAPIRequestFailure.deniedOperation
            }
            let rpc: NativeJSONValue = .object([
                "jsonrpc": .string("2.0"), "id": .string(request.requestId),
                "method": .string("tools/call"),
                "params": .object(["name": .string(tool), "arguments": request.operation.arguments ?? .object([:])]),
            ])
            try performAbsolute(request, credential: credential, method: "POST", url: mcpURL, body: rpc, sse: false)
        case .upload:
            try performUpload(request, credential: credential)
        case .cancel:
            throw NativeAPIRequestFailure.invalidRequest
        }
    }

    private static func isAllowedHTTP(method: String, path: String) -> Bool {
        guard method == method.uppercased(), path.hasPrefix("/"), !path.contains("#"),
              !path.contains("://"), path.count <= 2_048 else { return false }
        let routeAllowed = allowedHTTPRoutes.contains { candidateMethod, pattern in
            candidateMethod == method && path.range(of: pattern, options: .regularExpression) != nil
        }
        return routeAllowed && hasAllowedQuery(path)
    }

    private static func objectKeys(_ body: NativeJSONValue?) -> Set<String>? {
        guard case .object(let object) = body else { return nil }
        return Set(object.keys)
    }

    private static func keysAllowed(
        _ body: NativeJSONValue?,
        required: Set<String> = [],
        allowed: Set<String>
    ) -> Bool {
        guard let keys = objectKeys(body) else { return false }
        return required.isSubset(of: keys) && keys.isSubset(of: allowed)
    }

    private static func isAllowedBody(method: String, path: String, body: NativeJSONValue?) -> Bool {
        let route = String(path.split(separator: "?", maxSplits: 1)[0])
        if method == "GET" || method == "DELETE" { return body == nil }
        if method == "PATCH" && route.range(of: #"^/intents/[^/?]+/archive$"#, options: .regularExpression) != nil {
            return body == nil
        }
        switch route {
        case "/auth/profile/update":
            return keysAllowed(body, allowed: ["name", "intro", "location", "socials", "avatar", "notificationPreferences"])
        case "/agent-runtime":
            return keysAllowed(body, required: ["runtime"], allowed: ["runtime", "installationId", "executorId", "setupAttemptId"])
        case "/agent-runtime/hermes/prepare":
            return keysAllowed(body, required: ["installationId", "setupAttemptId"], allowed: ["installationId", "setupAttemptId"])
        case "/agent-runtime/rollback":
            return keysAllowed(body, required: ["setupAttemptId"], allowed: ["setupAttemptId"])
        case "/networks":
            return keysAllowed(body, required: ["title"], allowed: ["title", "prompt", "imageUrl", "joinPolicy"])
        case let value where value.range(of: #"^/networks/[^/?]+/(?:join|leave)$"#, options: .regularExpression) != nil:
            return keysAllowed(body, allowed: [])
        case "/network-requests":
            return keysAllowed(body, required: ["name", "purpose", "expectedSize", "joinPolicy"],
                               allowed: ["name", "purpose", "expectedSize", "joinPolicy", "imageUrl"])
        case let value where value.range(of: #"^/network-requests/[^/?]+$"#, options: .regularExpression) != nil:
            return keysAllowed(body, required: ["name", "purpose", "expectedSize", "joinPolicy"],
                               allowed: ["name", "purpose", "expectedSize", "joinPolicy", "imageUrl"])
        case "/intents/list":
            return keysAllowed(body, allowed: ["status", "page", "limit", "networkId", "scopeType", "scopeId"])
        case "/intents/confirm":
            return keysAllowed(body, required: ["proposalId", "description"], allowed: ["proposalId", "description"])
        case "/intents/reject":
            return keysAllowed(body, required: ["proposalId"], allowed: ["proposalId"])
        case "/intents/intake/start": return keysAllowed(body, allowed: [])
        case "/intents/intake/question":
            return keysAllowed(body, required: ["rounds"], allowed: ["rounds", "plannedTotal"])
        case "/intents/intake/prepare":
            return keysAllowed(body, required: ["rounds"], allowed: ["rounds"])
        case "/intents/intake/proposal":
            return keysAllowed(body, required: ["runId", "rounds"], allowed: ["runId", "rounds"])
        case "/intents/intake/revise":
            return keysAllowed(body, required: ["runId", "rounds", "feedback"], allowed: ["runId", "rounds", "feedback"])
        case let value where value.range(of: #"^/intents/[^/?]+/status$"#, options: .regularExpression) != nil:
            return keysAllowed(body, required: ["status"], allowed: ["status"])
        case let value where value.range(of: #"^/opportunities/[^/?]+/status$"#, options: .regularExpression) != nil:
            return keysAllowed(body, required: ["status"], allowed: ["status", "scopeType", "scopeId"])
        case let value where value.range(of: #"^/opportunities/[^/?]+/start-chat$"#, options: .regularExpression) != nil:
            return keysAllowed(body, allowed: ["scopeType", "scopeId"])
        case let value where value.range(of: #"^/questions/[^/?]+/answer$"#, options: .regularExpression) != nil:
            return keysAllowed(body, required: ["selectedOptions"], allowed: ["selectedOptions", "freeText"])
        case let value where value.range(of: #"^/questions/[^/?]+/dismiss$"#, options: .regularExpression) != nil:
            return keysAllowed(body, allowed: [])
        case let value where value.range(of: #"^/tools/[^/?]+$"#, options: .regularExpression) != nil:
            return keysAllowed(body, required: ["query"], allowed: ["query"])
        case "/enrichment/enrich": return keysAllowed(body, allowed: [])
        case "/conversations/dm":
            return keysAllowed(body, required: ["peerUserId"], allowed: ["peerUserId"])
        case let value where value.range(of: #"^/conversations/[^/?]+/messages$"#, options: .regularExpression) != nil:
            return keysAllowed(body, required: ["parts"], allowed: ["parts"])
        case let value where value.range(of: #"^/conversations/[^/?]+/metadata$"#, options: .regularExpression) != nil:
            return keysAllowed(body, required: ["metadata"], allowed: ["metadata"])
        default: return false
        }
    }

    private static func isAllowedSSEBody(method: String, path: String, body: NativeJSONValue?) -> Bool {
        if method == "GET" && path == "/conversations/stream" { return body == nil }
        if method == "POST" && path == "/chat/stream" {
            return keysAllowed(body, required: ["message"],
                               allowed: ["message", "sessionId", "scopeType", "scopeId", "persona"])
        }
        return false
    }

    private static func isAllowedMCPArguments(tool: String, arguments: NativeJSONValue?) -> Bool {
        tool == "create_intent"
            && keysAllowed(arguments, required: ["description"], allowed: ["description", "autoApprove"])
    }

    private static func hasAllowedQuery(_ path: String) -> Bool {
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let route = String(parts[0])
        guard parts.count == 2 else { return true }
        guard !parts[1].isEmpty,
              let components = URLComponents(string: "https://index.invalid\(path)"),
              let items = components.queryItems,
              !items.isEmpty, items.count <= 8 else { return false }
        let names = items.map(\.name)
        guard Set(names).count == names.count,
              items.allSatisfy({ ($0.value?.count ?? 0) <= 1_024 }) else { return false }
        let allowed: Set<String>
        switch route {
        case "/agent-runtime": allowed = ["installationId"]
        case "/users/batch": allowed = ["ids"]
        case let value where value.range(of: #"^/users/[^/?]+/negotiations$"#, options: .regularExpression) != nil:
            allowed = ["status", "limit", "offset"]
        case "/opportunities", "/opportunities/radar":
            allowed = ["status", "limit", "offset", "scopeType", "scopeId", "noCache"]
        case "/opportunities/chat-context": allowed = ["peerUserId"]
        case "/questions": allowed = ["status", "sourceId", "scopeType", "scopeId", "limit", "offset"]
        case let value where value.range(of: #"^/conversations/[^/?]+/messages$"#, options: .regularExpression) != nil:
            allowed = ["limit", "before", "after"]
        default: return false
        }
        return Set(names).isSubset(of: allowed)
    }

    private func perform(
        _ request: NativeAPIRequest, credential: OwnerCredentialRecord,
        method: String, path: String, body: NativeJSONValue?, sse: Bool
    ) throws {
        guard var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false),
              let relative = URLComponents(string: path) else { throw NativeAPIRequestFailure.deniedOperation }
        components.path = apiBaseURL.path + relative.path
        components.percentEncodedQuery = relative.percentEncodedQuery
        guard let url = components.url else { throw NativeAPIRequestFailure.deniedOperation }
        try performAbsolute(request, credential: credential, method: method, url: url, body: body, sse: sse)
    }

    private func performAbsolute(
        _ request: NativeAPIRequest, credential: OwnerCredentialRecord,
        method: String, url: URL, body: NativeJSONValue?, sse: Bool
    ) throws {
        var transport = URLRequest(url: url)
        transport.httpMethod = method
        transport.timeoutInterval = sse ? Self.streamTimeout : Self.requestTimeout
        transport.setValue(credential.credential, forHTTPHeaderField: "x-api-key")
        if let body {
            let data = try JSONEncoder().encode(body)
            guard data.count <= Self.maximumRequestBytes else { throw NativeAPIRequestFailure.oversizedRequest }
            transport.httpBody = data
            transport.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if sse { transport.setValue("text/event-stream", forHTTPHeaderField: "Accept") }
        else if url == mcpURL { transport.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept") }
        start(requestId: request.requestId, transport: transport, sse: sse)
    }

    private func performUpload(_ request: NativeAPIRequest, credential: OwnerCredentialRecord) throws {
        guard let path = request.operation.path, Self.allowedUploadRoutes.contains(path),
              let field = request.operation.fieldName, ["avatar", "image"].contains(field),
              let basename = request.operation.basename, basename.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil,
              let dataURL = request.operation.dataUrl,
              let comma = dataURL.firstIndex(of: ","),
              let media = Self.allowedUploadMedia[String(dataURL[..<comma])],
              let bytes = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              bytes.count <= Self.maximumUploadBytes else { throw NativeAPIRequestFailure.oversizedUpload }
        let boundary = "IndexBoundary\(UUID().uuidString)"
        var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(field)\"; filename=\"\(basename).\(media.extensionName)\"\r\nContent-Type: \(media.mimeType)\r\n\r\n".utf8)
        body.append(bytes); body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        guard var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false) else {
            throw NativeAPIRequestFailure.deniedOperation
        }
        components.path = apiBaseURL.path + path
        components.query = nil
        guard let url = components.url else { throw NativeAPIRequestFailure.deniedOperation }
        var transport = URLRequest(url: url)
        transport.httpMethod = "POST"
        transport.setValue(credential.credential, forHTTPHeaderField: "x-api-key")
        transport.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        transport.httpBody = body
        start(requestId: request.requestId, transport: transport, sse: false)
    }

    private func start(requestId: String, transport: URLRequest, sse: Bool) {
        let task = session.dataTask(with: transport) { [weak self] data, response, error in
            guard let self else { return }
            if let urlError = error as? URLError, urlError.code == .cancelled {
                self.finishFailure(requestId: requestId, failure: .cancelled); return
            }
            guard error == nil, let http = response as? HTTPURLResponse else {
                self.finishFailure(requestId: requestId, failure: .transportFailure); return
            }
            let body = data ?? Data()
            guard body.count <= Self.maximumResponseBytes else {
                self.finishFailure(requestId: requestId, failure: .oversizedResponse); return
            }
            let contentType = http.value(forHTTPHeaderField: "Content-Type") ?? ""
            let eventStream = contentType.lowercased().contains("text/event-stream")
            let streamedValue = eventStream
                ? self.decodeSSE(requestId: requestId, data: body, emitEvents: sse)
                : nil
            let value = sse
                ? NativeJSONValue.object(["complete": .bool(true)])
                : (streamedValue ?? Self.decodeResponse(body))
            guard !Self.containsForbiddenResponseField(value) else {
                self.finishFailure(requestId: requestId, failure: .transportFailure); return
            }
            var headers: [String: String] = [:]
            if let sessionID = http.value(forHTTPHeaderField: "X-Session-Id"), sessionID.count <= 256 {
                headers["x-session-id"] = sessionID
            }
            self.finish(NativeAPIResponse(
                requestId: requestId, ok: (200..<300).contains(http.statusCode),
                status: http.statusCode, body: value, headers: headers,
                errorCode: (200..<300).contains(http.statusCode) ? nil : "http_error"
            ))
        }
        stateQueue.sync { tasks[requestId] = task }
        task.resume()
    }

    private func decodeSSE(requestId: String, data: Data, emitEvents: Bool) -> NativeJSONValue? {
        guard let text = String(data: data, encoding: .utf8) else { return nil }
        var sequence = 0
        var last: NativeJSONValue?
        for frame in text.components(separatedBy: "\n\n") where sequence < Self.maximumEvents {
            let payload = frame.split(separator: "\n").filter { $0.hasPrefix("data:") }
                .map { $0.dropFirst(5).trimmingCharacters(in: .whitespaces) }.joined()
            guard !payload.isEmpty, let bytes = payload.data(using: .utf8),
                  bytes.count <= Self.maximumEventBytes,
                  let value = try? JSONDecoder().decode(NativeJSONValue.self, from: bytes) else { continue }
            guard !Self.containsForbiddenResponseField(value) else { continue }
            last = value
            if emitEvents { event(NativeAPIEvent(requestId: requestId, sequence: sequence, event: value)) }
            sequence += 1
        }
        return last
    }

    private static func decodeResponse(_ data: Data) -> NativeJSONValue {
        if data.isEmpty { return .object([:]) }
        if let value = try? JSONDecoder().decode(NativeJSONValue.self, from: data) { return value }
        return .string(String(data: data, encoding: .utf8) ?? "")
    }

    private static func containsForbiddenResponseField(_ value: NativeJSONValue) -> Bool {
        let forbidden: Set<String> = [
            "apikey", "credential", "activationproof", "authorization",
            "x-api-key", "verifier", "targetkey",
        ]
        switch value {
        case .array(let values): return values.contains(where: containsForbiddenResponseField)
        case .object(let object):
            return object.keys.contains { forbidden.contains($0.lowercased()) }
                || object.values.contains(where: containsForbiddenResponseField)
        default: return false
        }
    }

    private func cancel(_ request: NativeAPIRequest) throws {
        guard let target = request.operation.targetRequestId, !target.isEmpty else {
            throw NativeAPIRequestFailure.invalidRequest
        }
        stateQueue.sync { tasks[target]?.cancel() }
    }

    private func finishFailure(requestId: String, failure: NativeAPIRequestFailure) {
        finish(NativeAPIResponse(requestId: requestId, ok: false, status: nil,
                                 body: nil, headers: nil, errorCode: failure.code))
    }

    private func finish(_ response: NativeAPIResponse) {
        let shouldEmit: Bool = stateQueue.sync {
            guard !response.requestId.isEmpty, !completed.contains(response.requestId) else { return false }
            tasks.removeValue(forKey: response.requestId)
            completed.insert(response.requestId)
            if completed.count > 1_024 { completed.removeAll(keepingCapacity: true) }
            return true
        }
        if shouldEmit { terminal(response) }
    }
}
