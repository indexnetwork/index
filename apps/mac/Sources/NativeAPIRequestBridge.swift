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

private final class NativeAPIStreamContext {
    let delegate: NativeAPIStreamDelegate
    let session: URLSession
    let task: URLSessionDataTask
    init(delegate: NativeAPIStreamDelegate, session: URLSession, task: URLSessionDataTask) {
        self.delegate = delegate; self.session = session; self.task = task
    }
}

/// Incremental, strict SSE decoder. It never buffers a completed response:
/// response metadata and each complete frame are delivered by URLSessionDataDelegate.
final class NativeAPIStreamDelegate: NSObject, URLSessionDataDelegate {
    private let requestId: String
    private let publish: (NativeAPIEvent) -> Bool
    private let complete: (NativeAPIRequestFailure?, Int?, [String: String]) -> Void
    private let isSafe: (NativeJSONValue) -> Bool
    private var partial = Data()
    private var rawBytesReceived = 0
    private var eventCount = 0
    private var sequence = 0
    private var status: Int?
    private var headers: [String: String] = [:]
    private var terminal = false

    init(
        requestId: String,
        publish: @escaping (NativeAPIEvent) -> Bool,
        isSafe: @escaping (NativeJSONValue) -> Bool,
        complete: @escaping (NativeAPIRequestFailure?, Int?, [String: String]) -> Void
    ) {
        self.requestId = requestId; self.publish = publish; self.isSafe = isSafe; self.complete = complete
    }

    func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard !terminal, let http = response as? HTTPURLResponse,
              (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased().contains("text/event-stream") else {
            fail(.transportFailure, task: dataTask); completionHandler(.cancel); return
        }
        status = http.statusCode
        if let value = http.value(forHTTPHeaderField: "X-Session-Id"), value.utf8.count <= 256 {
            headers["x-session-id"] = value
        }
        let headerEvent: NativeJSONValue = .object([
            "type": .string("native_headers"), "status": .number(Double(http.statusCode)),
            "headers": .object(headers.mapValues(NativeJSONValue.string)),
        ])
        guard publish(NativeAPIEvent(requestId: requestId, sequence: sequence, event: headerEvent)) else {
            fail(.cancelled, task: dataTask); completionHandler(.cancel); return
        }
        sequence += 1
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !terminal else { return }
        guard rawBytesReceived <= NativeAPIRequestBridge.maximumEventAggregateBytes,
              data.count <= NativeAPIRequestBridge.maximumEventAggregateBytes - rawBytesReceived else {
            fail(.oversizedResponse, task: dataTask); return
        }
        rawBytesReceived += data.count
        partial.append(data)
        while let boundary = frameBoundary(in: partial) {
            guard boundary.lowerBound <= NativeAPIRequestBridge.maximumPartialFrameBytes else {
                fail(.oversizedResponse, task: dataTask); return
            }
            let frame = partial.subdata(in: 0..<boundary.lowerBound)
            partial.removeSubrange(0..<boundary.upperBound)
            guard decode(frame: frame, task: dataTask) else { return }
        }
        guard partial.count <= NativeAPIRequestBridge.maximumPartialFrameBytes else {
            fail(.oversizedResponse, task: dataTask); return
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !terminal else { return }
        if let urlError = error as? URLError, urlError.code == .cancelled {
            finish(.cancelled); return
        }
        guard error == nil, partial.isEmpty, let status else { finish(.transportFailure); return }
        terminal = true
        complete(nil, status, headers)
    }

    private func frameBoundary(in data: Data) -> Range<Data.Index>? {
        let lf = Data([0x0a, 0x0a]); let crlf = Data([0x0d, 0x0a, 0x0d, 0x0a])
        let a = data.range(of: lf); let b = data.range(of: crlf)
        if let a, let b { return a.lowerBound < b.lowerBound ? a : b }
        return a ?? b
    }

    private func decode(frame: Data, task: URLSessionTask) -> Bool {
        guard frame.count <= NativeAPIRequestBridge.maximumEventBytes,
              let text = String(data: frame, encoding: .utf8) else {
            fail(.transportFailure, task: task); return false
        }
        if text.split(whereSeparator: \.isNewline).allSatisfy({ $0.hasPrefix(":") }) { return true }
        var values: [String] = []
        for rawLine in text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false) {
            if rawLine.hasPrefix(":") { continue }
            guard rawLine == "data" || rawLine.hasPrefix("data:") else {
                fail(.transportFailure, task: task); return false
            }
            let value = rawLine == "data" ? "" : String(rawLine.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            values.append(value)
        }
        let payload = values.joined(separator: "\n")
        guard !payload.isEmpty, let bytes = payload.data(using: .utf8),
              bytes.count <= NativeAPIRequestBridge.maximumEventBytes,
              eventCount < NativeAPIRequestBridge.maximumEvents,
              let value = try? JSONDecoder().decode(NativeJSONValue.self, from: bytes),
              isSafe(value) else {
            fail(.transportFailure, task: task); return false
        }
        eventCount += 1
        guard publish(NativeAPIEvent(requestId: requestId, sequence: sequence, event: value)) else {
            fail(.cancelled, task: task); return false
        }
        sequence += 1
        return true
    }

    private func fail(_ failure: NativeAPIRequestFailure, task: URLSessionTask) {
        task.cancel(); finish(failure)
    }
    private func finish(_ failure: NativeAPIRequestFailure) {
        guard !terminal else { return }
        terminal = true; complete(failure, status, headers)
    }
}

/// Credential-owning, structured WebKit request boundary. JavaScript can choose
/// only an enumerated operation and relative allowlisted product path; Swift
/// alone reads Keychain and constructs transport authentication.
final class NativeAPIRequestBridge {
    static let maximumJSONRequestBytes = 262_144
    static let maximumJSONDepth = 16
    static let maximumObjectKeys = 64
    static let maximumArrayItems = 100
    static let maximumStringBytes = 65_536
    static let maximumUploadBytes = 8_388_608
    static let maximumEncodedUploadRequestBytes = 11_184_896
    static let maximumResponseBytes = 1_048_576
    static let maximumPartialFrameBytes = 65_536
    static let maximumEventBytes = 65_536
    static let maximumEventAggregateBytes = 1_048_576
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
        ("POST", #"^/agent-runtime/(?:hermes/prepare|rollback|reconcile-index)$"#),
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
        ("GET", #"^/notifications/snapshot$"#),
        ("POST", #"^/tools/(?:read_user_contexts|preview_user_context|confirm_user_context)$"#),
        ("POST", #"^/enrichment/enrich$"#),
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
    static let allowedSSERoutes: Set<String> = [
        "GET /notifications/stream", "GET /conversations/stream", "POST /chat/stream",
    ]
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
    private var streamContexts: [String: NativeAPIStreamContext] = [:]
    private var completed: Set<String> = []
    private var quarantined = false
    private var quarantineDrains: [() -> Void] = []

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
            guard stateQueue.sync(execute: { !quarantined }) else {
                throw NativeAPIRequestFailure.signedOut
            }
            if request.operation.kind == .cancel {
                try cancel(request)
                finish(NativeAPIResponse(requestId: request.requestId, ok: true, status: 200,
                                         body: .object(["cancelled": .bool(true)]), headers: [:], errorCode: nil))
                return
            }
            try stateQueue.sync {
                guard !quarantined,
                      tasks.count < Self.maximumPendingRequests,
                      tasks[request.requestId] == nil,
                      !completed.contains(request.requestId) else { throw NativeAPIRequestFailure.invalidRequest }
            }
            try validateBeforeCredentialRead(request)
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
        let limit = kind == .upload ? Self.maximumEncodedUploadRequestBytes : Self.maximumJSONRequestBytes
        guard data.count <= limit else { throw NativeAPIRequestFailure.oversizedRequest }
        return try JSONDecoder().decode(NativeAPIRequest.self, from: data)
    }

    private func validateBeforeCredentialRead(_ request: NativeAPIRequest) throws {
        let operation = request.operation
        switch operation.kind {
        case .http:
            guard let method = operation.method, let path = operation.path,
                  Self.isAllowedHTTP(method: method, path: path),
                  Self.isGloballyBoundedJSON(operation.body),
                  Self.isAllowedBody(method: method, path: path, body: operation.body) else {
                throw NativeAPIRequestFailure.deniedOperation
            }
        case .sse:
            guard let method = operation.method, let path = operation.path,
                  Self.allowedSSERoutes.contains("\(method) \(path)"),
                  Self.isGloballyBoundedJSON(operation.body),
                  Self.isAllowedSSEBody(method: method, path: path, body: operation.body) else {
                throw NativeAPIRequestFailure.deniedOperation
            }
        case .mcp:
            guard let tool = operation.tool, tool == "create_intent", Self.allowedMCPTools.contains(tool),
                  Self.isGloballyBoundedJSON(operation.arguments),
                  Self.isAllowedMCPArguments(tool: tool, arguments: operation.arguments) else {
                throw NativeAPIRequestFailure.deniedOperation
            }
        case .upload:
            guard operation.body == nil, operation.arguments == nil,
                  Self.isAllowedUploadOperation(operation) else { throw NativeAPIRequestFailure.deniedOperation }
        case .cancel:
            return
        }
    }

    private static func isGloballyBoundedJSON(_ value: NativeJSONValue?, depth: Int = 0) -> Bool {
        guard depth <= maximumJSONDepth else { return false }
        guard let value else { return true }
        if depth == 0 {
            guard let encoded = try? JSONEncoder().encode(value), encoded.count <= maximumJSONRequestBytes else { return false }
        }
        switch value {
        case .null, .bool: return true
        case .number(let number): return number.isFinite
        case .string(let string): return string.utf8.count <= maximumStringBytes
        case .array(let values):
            return values.count <= maximumArrayItems
                && values.allSatisfy { isGloballyBoundedJSON($0, depth: depth + 1) }
        case .object(let object):
            return object.count <= maximumObjectKeys
                && object.keys.allSatisfy { $0.utf8.count <= maximumStringBytes }
                && object.values.allSatisfy { isGloballyBoundedJSON($0, depth: depth + 1) }
        }
    }

    static func validateGlobalJSONForFixture(_ body: NativeJSONValue?) -> Bool { isGloballyBoundedJSON(body) }
    static func validateHTTPBodyForFixture(method: String, path: String, body: NativeJSONValue?) -> Bool {
        isAllowedHTTP(method: method, path: path) && isGloballyBoundedJSON(body)
            && isAllowedBody(method: method, path: path, body: body)
    }
    static func validateSSEBodyForFixture(method: String, path: String, body: NativeJSONValue?) -> Bool {
        isGloballyBoundedJSON(body) && isAllowedSSEBody(method: method, path: path, body: body)
    }
    static func validateMCPForFixture(tool: String = "create_intent", arguments: NativeJSONValue?) -> Bool {
        allowedMCPTools.contains(tool) && isGloballyBoundedJSON(arguments)
            && isAllowedMCPArguments(tool: tool, arguments: arguments)
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

    private static func object(_ value: NativeJSONValue?) -> [String: NativeJSONValue]? {
        guard case .object(let object) = value else { return nil }; return object
    }
    private static func boundedString(_ value: NativeJSONValue?, minimum: Int = 1, maximum: Int = 4_096) -> Bool {
        guard case .string(let string) = value else { return false }
        return string.utf8.count >= minimum && string.utf8.count <= maximum
    }
    private static func optionalString(_ object: [String: NativeJSONValue], _ key: String, maximum: Int = 4_096) -> Bool {
        guard let value = object[key] else { return true }; return boundedString(value, minimum: 0, maximum: maximum)
    }
    private static func optionalBool(_ object: [String: NativeJSONValue], _ key: String) -> Bool {
        guard let value = object[key] else { return true }; if case .bool = value { return true }; return false
    }
    private static func optionalInteger(
        _ object: [String: NativeJSONValue], _ key: String, minimum: Int, maximum: Int
    ) -> Bool {
        guard let value = object[key] else { return true }
        guard case .number(let number) = value, number.rounded() == number else { return false }
        return number >= Double(minimum) && number <= Double(maximum)
    }
    private static func identifier(_ value: NativeJSONValue?) -> Bool {
        guard case .string(let string) = value, string.count <= 128 else { return false }
        return string.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    }
    private static func uuidIdentifier(_ value: NativeJSONValue?) -> Bool {
        guard case .string(let string) = value else { return false }; return UUID(uuidString: string) != nil
    }
    private static func enumString(_ value: NativeJSONValue?, _ values: Set<String>) -> Bool {
        guard case .string(let string) = value else { return false }; return values.contains(string)
    }
    private static func boundedStringArray(_ value: NativeJSONValue?, maximumItems: Int = 50) -> Bool {
        guard case .array(let values) = value, values.count <= maximumItems else { return false }
        return values.allSatisfy { boundedString($0, maximum: 4_096) }
    }
    private static func exactTypedObject(
        _ body: NativeJSONValue?, required: Set<String> = [], optional: Set<String> = [],
        validate: ([String: NativeJSONValue]) -> Bool
    ) -> Bool {
        guard let object = object(body) else { return false }
        let keys = Set(object.keys)
        return required.isSubset(of: keys) && keys.isSubset(of: required.union(optional)) && validate(object)
    }
    private static func validSocials(_ value: NativeJSONValue?) -> Bool {
        guard case .array(let values) = value, values.count <= 50 else { return false }
        return values.allSatisfy { item in
            exactTypedObject(item, required: ["label", "value"]) { object in
                boundedString(object["label"], maximum: 64) && boundedString(object["value"], maximum: 2_048)
            }
        }
    }
    private static func validNetworkRequest(_ body: NativeJSONValue?) -> Bool {
        exactTypedObject(body, required: ["name"], optional: ["purpose", "audience", "expectedSize", "notes", "imageUrl", "joinPolicy"]) { item in
            boundedString(item["name"], maximum: 256)
                && ["purpose", "audience", "expectedSize", "notes"].allSatisfy { optionalString(item, $0, maximum: 8_192) }
                && optionalString(item, "imageUrl", maximum: 2_048)
                && (item["joinPolicy"] == nil || enumString(item["joinPolicy"], ["anyone", "invite_only"]))
        }
    }
    private static func validAnswer(_ value: NativeJSONValue?) -> Bool {
        exactTypedObject(value, optional: ["selectedOptions", "freeText"]) { answer in
            let selectedValid = answer["selectedOptions"] == nil || boundedStringArray(answer["selectedOptions"], maximumItems: 20)
            let selectedPresent: Bool
            if case .array(let values)? = answer["selectedOptions"] { selectedPresent = !values.isEmpty } else { selectedPresent = false }
            let textPresent: Bool
            if case .string(let text)? = answer["freeText"] { textPresent = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } else { textPresent = false }
            return selectedValid && optionalString(answer, "freeText", maximum: 65_536) && (selectedPresent || textPresent)
        }
    }
    private static func validRounds(_ value: NativeJSONValue?) -> Bool {
        guard case .array(let values) = value, !values.isEmpty, values.count <= 10 else { return false }
        return values.allSatisfy { item in
            exactTypedObject(item, required: ["prompt", "answer"]) { round in
                boundedString(round["prompt"], maximum: 400) && validAnswer(round["answer"])
            }
        }
    }
    private static func validDraft(_ value: NativeJSONValue?) -> Bool {
        exactTypedObject(value, required: ["identity", "narrative", "attributes"]) { draft in
            exactTypedObject(draft["identity"], required: ["name", "bio", "location"]) { identity in
                optionalString(identity, "name", maximum: 256) && optionalString(identity, "bio", maximum: 65_536)
                    && optionalString(identity, "location", maximum: 512)
            } && exactTypedObject(draft["narrative"], required: ["context"]) { narrative in
                optionalString(narrative, "context", maximum: 65_536)
            } && exactTypedObject(draft["attributes"], required: ["skills", "interests"]) { attributes in
                boundedStringArray(attributes["skills"]) && boundedStringArray(attributes["interests"])
            }
        }
    }
    private static func validMessageParts(_ value: NativeJSONValue?) -> Bool {
        guard case .array(let values) = value, !values.isEmpty, values.count <= 100 else { return false }
        return values.allSatisfy { item in
            exactTypedObject(item, required: ["text"], optional: ["type"]) { part in
                boundedString(part["text"], maximum: 65_536)
                    && (part["type"] == nil || enumString(part["type"], ["text"]))
            }
        }
    }

    private static func isAllowedBody(method: String, path: String, body: NativeJSONValue?) -> Bool {
        let route = String(path.split(separator: "?", maxSplits: 1)[0])
        if method == "GET" || method == "DELETE" { return body == nil }
        if method == "PATCH" && route.range(of: #"^/intents/[^/?]+/archive$"#, options: .regularExpression) != nil {
            return body == nil
        }
        switch route {
        case "/auth/profile/update":
            return exactTypedObject(body, optional: ["name", "intro", "location", "timezone", "socials", "avatar", "notificationPreferences"]) { item in
                optionalString(item, "name", maximum: 256) && optionalString(item, "intro", maximum: 65_536)
                    && optionalString(item, "location", maximum: 512) && optionalString(item, "timezone", maximum: 128)
                    && optionalString(item, "avatar", maximum: 2_048)
                    && (item["socials"] == nil || validSocials(item["socials"]))
                    && (item["notificationPreferences"] == nil || exactTypedObject(item["notificationPreferences"], optional: ["connectionUpdates", "weeklyNewsletter"]) { prefs in optionalBool(prefs, "connectionUpdates") && optionalBool(prefs, "weeklyNewsletter") })
            }
        case "/agent-runtime":
            return exactTypedObject(body, required: ["runtime"], optional: ["installationId", "executorId", "setupAttemptId"]) { item in
                enumString(item["runtime"], ["index", "hermes"])
                    && ["installationId", "executorId", "setupAttemptId"].allSatisfy { item[$0] == nil || uuidIdentifier(item[$0]) }
                    && (item["runtime"] == .string("index")
                        ? Set(item.keys) == ["runtime"]
                        : ["installationId", "executorId", "setupAttemptId"].allSatisfy { item[$0] != nil })
            }
        case "/agent-runtime/hermes/prepare":
            return exactTypedObject(body, required: ["installationId", "setupAttemptId"]) { uuidIdentifier($0["installationId"]) && uuidIdentifier($0["setupAttemptId"]) }
        case "/agent-runtime/rollback":
            return exactTypedObject(body, required: ["setupAttemptId"]) { uuidIdentifier($0["setupAttemptId"]) }
        case "/agent-runtime/reconcile-index":
            return exactTypedObject(
                body,
                required: ["agentId", "installationId", "setupAttemptId"]
            ) {
                uuidIdentifier($0["agentId"])
                    && uuidIdentifier($0["installationId"])
                    && uuidIdentifier($0["setupAttemptId"])
            }
        case "/networks":
            return exactTypedObject(body, required: ["title"], optional: ["prompt", "imageUrl", "joinPolicy"]) { item in
                boundedString(item["title"], maximum: 256) && optionalString(item, "prompt", maximum: 65_536)
                    && optionalString(item, "imageUrl", maximum: 2_048)
                    && (item["joinPolicy"] == nil || enumString(item["joinPolicy"], ["anyone", "invite_only"]))
            }
        case let value where value.range(of: #"^/networks/[^/?]+/(?:join|leave)$"#, options: .regularExpression) != nil:
            return keysAllowed(body, allowed: [])
        case "/network-requests": return validNetworkRequest(body)
        case let value where value.range(of: #"^/network-requests/[^/?]+$"#, options: .regularExpression) != nil:
            return validNetworkRequest(body)
        case "/intents/list":
            return exactTypedObject(body, optional: ["page", "limit", "archived", "sourceType"]) { item in
                optionalInteger(item, "page", minimum: 1, maximum: 10_000)
                    && optionalInteger(item, "limit", minimum: 1, maximum: 100)
                    && optionalBool(item, "archived") && optionalString(item, "sourceType", maximum: 128)
            }
        case "/intents/confirm":
            return exactTypedObject(body, required: ["proposalId", "description"], optional: ["networkId"]) { item in
                uuidIdentifier(item["proposalId"]) && boundedString(item["description"], maximum: 65_536)
                    && (item["networkId"] == nil || uuidIdentifier(item["networkId"]))
            }
        case "/intents/reject":
            return exactTypedObject(body, required: ["proposalId"]) { identifier($0["proposalId"]) }
        case "/intents/intake/start": return keysAllowed(body, allowed: [])
        case "/intents/intake/question":
            return exactTypedObject(body, required: ["rounds"], optional: ["plannedTotal"]) { validRounds($0["rounds"]) && optionalInteger($0, "plannedTotal", minimum: 1, maximum: 10) }
        case "/intents/intake/prepare":
            return exactTypedObject(body, required: ["rounds"]) { validRounds($0["rounds"]) }
        case "/intents/intake/proposal":
            return exactTypedObject(body, required: ["runId", "rounds"], optional: ["networkId", "whereText"]) { item in
                uuidIdentifier(item["runId"]) && validRounds(item["rounds"])
                    && (item["networkId"] == nil || uuidIdentifier(item["networkId"]))
                    && optionalString(item, "whereText", maximum: 280)
            }
        case "/intents/intake/revise":
            return exactTypedObject(body, required: ["runId", "rounds", "feedback"], optional: ["networkId"]) { item in
                uuidIdentifier(item["runId"]) && validRounds(item["rounds"]) && boundedString(item["feedback"], maximum: 600)
                    && (item["networkId"] == nil || uuidIdentifier(item["networkId"]))
            }
        case let value where value.range(of: #"^/intents/[^/?]+/status$"#, options: .regularExpression) != nil:
            return exactTypedObject(body, required: ["status"]) { enumString($0["status"], ["ACTIVE", "PAUSED"]) }
        case let value where value.range(of: #"^/opportunities/[^/?]+/status$"#, options: .regularExpression) != nil:
            return exactTypedObject(body, required: ["status"], optional: ["scopeType", "scopeId"]) { item in
                enumString(item["status"], ["accepted", "rejected"])
                    && (item["scopeType"] == nil || enumString(item["scopeType"], ["intent"]))
                    && (item["scopeId"] == nil || uuidIdentifier(item["scopeId"]))
                    && ((item["scopeType"] == nil) == (item["scopeId"] == nil))
            }
        case let value where value.range(of: #"^/opportunities/[^/?]+/start-chat$"#, options: .regularExpression) != nil:
            return exactTypedObject(body, optional: ["scopeType", "scopeId"]) { item in
                (item["scopeType"] == nil || enumString(item["scopeType"], ["intent"]))
                    && (item["scopeId"] == nil || uuidIdentifier(item["scopeId"]))
                    && ((item["scopeType"] == nil) == (item["scopeId"] == nil))
            }
        case let value where value.range(of: #"^/questions/[^/?]+/answer$"#, options: .regularExpression) != nil:
            return exactTypedObject(body, required: ["selectedOptions"], optional: ["freeText"]) { item in
                boundedStringArray(item["selectedOptions"], maximumItems: 20) && optionalString(item, "freeText", maximum: 65_536)
            }
        case let value where value.range(of: #"^/questions/[^/?]+/dismiss$"#, options: .regularExpression) != nil:
            return keysAllowed(body, allowed: [])
        case "/tools/read_user_contexts":
            return exactTypedObject(body, required: ["query"]) { keysAllowed($0["query"], allowed: []) }
        case "/tools/preview_user_context":
            return exactTypedObject(body, required: ["query"]) { item in
                exactTypedObject(item["query"], optional: ["linkedinUrl", "githubUrl", "twitterUrl", "bioOrDescription"]) { query in
                    query.keys.allSatisfy { optionalString(query, $0, maximum: $0 == "bioOrDescription" ? 65_536 : 2_048) }
                }
            }
        case "/tools/confirm_user_context":
            return exactTypedObject(body, required: ["query"]) { item in exactTypedObject(item["query"], required: ["draft"]) { validDraft($0["draft"]) } }
        case "/enrichment/enrich": return keysAllowed(body, allowed: [])
        case "/conversations/dm":
            return exactTypedObject(body, required: ["peerUserId"]) { identifier($0["peerUserId"]) }
        case let value where value.range(of: #"^/conversations/[^/?]+/messages$"#, options: .regularExpression) != nil:
            return exactTypedObject(body, required: ["parts"]) { validMessageParts($0["parts"]) }
        case let value where value.range(of: #"^/conversations/[^/?]+/metadata$"#, options: .regularExpression) != nil:
            return exactTypedObject(body, required: ["metadata"]) { item in
                exactTypedObject(item["metadata"], optional: ["title"]) { metadata in
                    optionalString(metadata, "title", maximum: 256)
                }
            }
        default: return false
        }
    }

    private static func isAllowedSSEBody(method: String, path: String, body: NativeJSONValue?) -> Bool {
        if method == "GET" && path == "/conversations/stream" { return body == nil }
        if method == "POST" && path == "/chat/stream" {
            return exactTypedObject(body, required: ["message"], optional: ["sessionId", "scopeType", "scopeId", "persona"]) { item in
                boundedString(item["message"], maximum: 65_536)
                    && (item["sessionId"] == nil || identifier(item["sessionId"]))
                    && (item["scopeType"] == nil || enumString(item["scopeType"], ["network", "intent"]))
                    && (item["scopeId"] == nil || identifier(item["scopeId"]))
                    && (item["persona"] == nil || enumString(item["persona"], ["negotiator", "signal", "reporter"]))
                    && ((item["scopeType"] == nil) == (item["scopeId"] == nil))
            }
        }
        return false
    }

    private static func isAllowedMCPArguments(tool: String, arguments: NativeJSONValue?) -> Bool {
        tool == "create_intent"
            && exactTypedObject(arguments, required: ["description"], optional: ["autoApprove"]) { item in
                boundedString(item["description"], maximum: 65_536) && optionalBool(item, "autoApprove")
            }
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
            guard data.count <= Self.maximumJSONRequestBytes else { throw NativeAPIRequestFailure.oversizedRequest }
            transport.httpBody = data
            transport.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if sse { transport.setValue("text/event-stream", forHTTPHeaderField: "Accept") }
        else if url == mcpURL { transport.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept") }
        start(requestId: request.requestId, transport: transport, sse: sse)
    }

    private static func isAllowedUploadOperation(_ operation: NativeAPIOperation) -> Bool {
        guard let path = operation.path, allowedUploadRoutes.contains(path),
              let field = operation.fieldName, ["avatar", "image"].contains(field),
              let basename = operation.basename, basename.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil,
              let dataURL = operation.dataUrl,
              let comma = dataURL.firstIndex(of: ","),
              allowedUploadMedia[String(dataURL[..<comma])] != nil,
              let bytes = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              bytes.count <= maximumUploadBytes else { return false }
        return true
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
        if sse { startStream(requestId: requestId, transport: transport); return }
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
            guard !contentType.lowercased().contains("text/event-stream") else {
                self.finishFailure(requestId: requestId, failure: .transportFailure); return
            }
            let value = Self.decodeResponse(body)
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
        guard register(task, requestId: requestId) else {
            task.cancel(); finishFailure(requestId: requestId, failure: .signedOut); return
        }
        task.resume()
    }

    private func startStream(requestId: String, transport: URLRequest) {
        let delegate = NativeAPIStreamDelegate(
            requestId: requestId,
            publish: { [weak self] value in self?.publishStreamEvent(value) == true },
            isSafe: { !Self.containsForbiddenResponseField($0) },
            complete: { [weak self] failure, status, headers in
                guard let self else { return }
                if let failure { self.finishFailure(requestId: requestId, failure: failure); return }
                self.finish(NativeAPIResponse(
                    requestId: requestId, ok: status.map { (200..<300).contains($0) } == true,
                    status: status, body: .object(["complete": .bool(true)]), headers: headers,
                    errorCode: status.map { (200..<300).contains($0) } == true ? nil : "http_error"
                ))
            }
        )
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.streamTimeout
        configuration.timeoutIntervalForResource = Self.streamTimeout
        configuration.httpCookieStorage = nil; configuration.urlCache = nil
        let streamSession = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        let task = streamSession.dataTask(with: transport)
        let context = NativeAPIStreamContext(delegate: delegate, session: streamSession, task: task)
        guard register(task, requestId: requestId, streamContext: context) else {
            task.cancel(); streamSession.invalidateAndCancel()
            finishFailure(requestId: requestId, failure: .signedOut); return
        }
        task.resume()
    }

    private func register(
        _ task: URLSessionTask, requestId: String, streamContext: NativeAPIStreamContext? = nil
    ) -> Bool {
        stateQueue.sync {
            guard !quarantined, tasks.count < Self.maximumPendingRequests,
                  tasks[requestId] == nil, !completed.contains(requestId) else { return false }
            tasks[requestId] = task
            if let streamContext { streamContexts[requestId] = streamContext }
            return true
        }
    }

    #if INDEX_NATIVE_FIXTURE
    func registerTaskForFixture(_ task: URLSessionTask, requestId: String) -> Bool {
        register(task, requestId: requestId)
    }
    func finishTaskForFixture(requestId: String) {
        finishFailure(requestId: requestId, failure: .cancelled)
    }
    #endif

    private func publishStreamEvent(_ value: NativeAPIEvent) -> Bool {
        let admitted = stateQueue.sync {
            !quarantined && tasks[value.requestId] != nil && !completed.contains(value.requestId)
        }
        if admitted { event(value) }
        return admitted
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

    /// Atomically rejects new work, cancels every REST/SSE task, and invokes the
    /// drain only after each request has emitted its one terminal callback.
    func beginQuarantine(_ drained: @escaping () -> Void) {
        let snapshot: [URLSessionTask] = stateQueue.sync {
            quarantined = true
            if tasks.isEmpty { return [] }
            quarantineDrains.append(drained)
            return Array(tasks.values)
        }
        if snapshot.isEmpty { drained(); return }
        snapshot.forEach { $0.cancel() }
    }

    /// Login may reopen the bridge only after the credential provider performs
    /// an active app-only Keychain read-back with no recovery journal.
    func endQuarantineAfterCredentialReadBack() throws {
        guard let credential = try credentialProvider(), credential.expiresAt > Date() else {
            throw NativeAPIRequestFailure.signedOut
        }
        stateQueue.sync { quarantined = false }
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
        var context: NativeAPIStreamContext?
        var drains: [() -> Void] = []
        let shouldEmit: Bool = stateQueue.sync {
            guard !response.requestId.isEmpty, !completed.contains(response.requestId) else { return false }
            tasks.removeValue(forKey: response.requestId)
            context = streamContexts.removeValue(forKey: response.requestId)
            completed.insert(response.requestId)
            if completed.count > 1_024 { completed.removeAll(keepingCapacity: true) }
            if quarantined && tasks.isEmpty {
                drains = quarantineDrains; quarantineDrains.removeAll()
            }
            return true
        }
        context?.session.finishTasksAndInvalidate()
        if shouldEmit { terminal(response); drains.forEach { $0() } }
    }
}
