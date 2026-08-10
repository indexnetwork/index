import Foundation

enum ConnectorRuntimeError: Error, Equatable {
    case invalidPayload
    case notConnected
    case reconnectRequired
    case recoveryOnly
    case alreadyConnected
}

final class ConnectorRuntime {
    private let endpoints: ConnectorEndpoints
    private let installationStore: ConnectorInstallationStoring
    private let credentialStore: ConnectorCredentialStoring
    private let http: ConnectorHTTPClient
    private let authorization: BrowserAuthorization

    init(
        endpoints: ConnectorEndpoints,
        installationStore: ConnectorInstallationStoring,
        credentialStore: ConnectorCredentialStoring,
        http: ConnectorHTTPClient,
        authorization: BrowserAuthorization
    ) {
        self.endpoints = endpoints
        self.installationStore = installationStore
        self.credentialStore = credentialStore
        self.http = http
        self.authorization = authorization
    }

    convenience init(
        endpoints: ConnectorEndpoints = .embedded,
        installationStore: ConnectorInstallationStore
    ) throws {
        let credentialStore = try ConnectorCredentialStore(installationId: installationStore.installationId)
        let http = ConnectorHTTPClient(endpoints: endpoints)
        let authorization = BrowserAuthorization(
            http: http,
            credentialStore: credentialStore,
            installationId: installationStore.installationId,
            endpoints: endpoints
        )
        self.init(
            endpoints: endpoints,
            installationStore: installationStore,
            credentialStore: credentialStore,
            http: http,
            authorization: authorization
        )
    }

    func handle(_ request: ConnectorRequest) -> ConnectorResponse {
        do {
            let result = try dispatch(request)
            return ConnectorResponse(
                protocolVersion: ConnectorProtocolVersion.current,
                id: request.id,
                success: true,
                result: result,
                error: nil
            )
        } catch {
            let sanitized = sanitize(error)
            return ConnectorResponse(
                protocolVersion: ConnectorProtocolVersion.current,
                id: request.id,
                success: false,
                result: nil,
                error: sanitized
            )
        }
    }

    private func dispatch(_ request: ConnectorRequest) throws -> JSONValue {
        if installationStore.revocationPending,
           request.operation != .hello,
           request.operation != .status,
           request.operation != .disconnect {
            throw ConnectorRuntimeError.recoveryOnly
        }
        switch request.operation {
        case .hello:
            try requireExactKeys(request.payload, allowed: [])
            return .object([
                "protocolVersion": .number(1),
                "buildMode": .string(ConnectorBuildIdentity.buildMode),
                "apiEnvironment": .string(ConnectorBuildIdentity.apiEnvironment),
            ])
        case .status:
            try requireExactKeys(request.payload, allowed: [])
            return try statusValue()
        case .authorizeStart:
            try requireExactKeys(request.payload, allowed: [])
            if let record = try credentialStore.read(), record.activationState == "active", record.expiresAt > Date() {
                throw ConnectorRuntimeError.alreadyConnected
            }
            let url = try authorization.start()
            return .object(["status": .string("pending"), "authorizationUrl": .string(url.absoluteString)])
        case .authorizePoll:
            try requireExactKeys(request.payload, allowed: [])
            switch authorization.snapshot() {
            case .idle, .pending:
                return .object(["status": .string("pending")])
            case let .connected(record):
                var result = statusObject(record: record, revocationPending: false)
                result["status"] = .string("connected")
                return .object(result)
            case let .failed(code, message):
                return .object([
                    "status": .string("failed"),
                    "error": .object(["code": .string(code), "message": .string(message)]),
                ])
            }
        case .rest:
            try requireExactKeys(request.payload, allowed: ["method", "path", "body"], required: ["method", "path"])
            guard case let .string(method)? = request.payload["method"],
                  case let .string(path)? = request.payload["path"] else {
                throw ConnectorRuntimeError.invalidPayload
            }
            let credential = try activeCredential()
            let result = try http.rest(
                method: method,
                path: path,
                body: request.payload["body"],
                credential: credential
            )
            return .object(["status": .number(Double(result.status)), "body": result.body])
        case .mcp:
            try requireExactKeys(request.payload, allowed: ["toolName", "arguments"], required: ["toolName", "arguments"])
            guard case let .string(toolName)? = request.payload["toolName"],
                  case let .object(arguments)? = request.payload["arguments"] else {
                throw ConnectorRuntimeError.invalidPayload
            }
            return try http.callMCP(toolName: toolName, arguments: arguments, credential: activeCredential())
        case .disconnect:
            try requireExactKeys(request.payload, allowed: [])
            return try disconnect()
        }
    }

    private func activeCredential() throws -> ConnectorCredentialRecord {
        guard let record = try credentialStore.read(), record.activationState == "active" else {
            throw ConnectorRuntimeError.notConnected
        }
        guard record.expiresAt > Date() else { throw ConnectorRuntimeError.reconnectRequired }
        return record
    }

    private func disconnect() throws -> JSONValue {
        guard let record = try credentialStore.read() else {
            if installationStore.revocationPending {
                return .object(["status": .string("recovery_only")])
            }
            return .object(["status": .string("disconnected")])
        }
        try installationStore.setRevocationPending(true)
        do {
            let receipt = try http.revoke(credential: record.rawCredential)
            guard receipt.credentialId == record.credentialId,
                  receipt.setupAttemptId == record.setupAttemptId else {
                throw ConnectorHTTPError.revocationUnconfirmed
            }
            if record.activationState == "active", record.expiresAt > Date() {
                try http.requireRevokedCredentialProbe(credential: record.rawCredential)
            }
            try credentialStore.delete()
            try installationStore.setRevocationPending(false)
            return .object(["status": .string("disconnected")])
        } catch {
            return .object(["status": .string("recovery_only")])
        }
    }

    private func statusValue() throws -> JSONValue {
        let record = try credentialStore.read()
        return .object(statusObject(record: record, revocationPending: installationStore.revocationPending))
    }

    private func statusObject(
        record: ConnectorCredentialRecord?,
        revocationPending: Bool
    ) -> [String: JSONValue] {
        let health: String
        let connected: Bool
        if revocationPending {
            health = "recovery_only"
            connected = false
        } else if let record, record.expiresAt <= Date() {
            health = "expired"
            connected = false
        } else if let record, record.activationState == "active" {
            health = "healthy"
            connected = true
        } else {
            health = "disconnected"
            connected = false
        }
        return [
            "connected": .bool(connected),
            "accountLabel": record.map { .string($0.accountLabel) } ?? .null,
            "installationId": .string(installationStore.installationId),
            "actions": .array(record?.actions.map(JSONValue.string) ?? []),
            "expiresAt": record.map { .string(Self.iso8601($0.expiresAt)) } ?? .null,
            "health": .string(health),
            "revocationPending": .bool(revocationPending),
        ]
    }

    private func requireExactKeys(
        _ payload: [String: JSONValue],
        allowed: Set<String>,
        required: Set<String> = []
    ) throws {
        let actual = Set(payload.keys)
        guard actual.isSubset(of: allowed), required.isSubset(of: actual) else {
            throw ConnectorRuntimeError.invalidPayload
        }
    }

    private func sanitize(_ error: Error) -> ConnectorError {
        if let runtimeError = error as? ConnectorRuntimeError {
            switch runtimeError {
            case .invalidPayload:
                return ConnectorError(code: "invalid_payload", message: "The operation payload is invalid.")
            case .notConnected:
                return ConnectorError(code: "not_connected", message: "Connect to Index first.")
            case .reconnectRequired:
                return ConnectorError(code: "reconnect_required", message: "Reconnect to Index.")
            case .recoveryOnly:
                return ConnectorError(code: "recovery_only", message: "Only disconnect recovery is available.")
            case .alreadyConnected:
                return ConnectorError(code: "already_connected", message: "Index is already connected.")
            }
        }
        if let authorizationError = error as? BrowserAuthorizationError,
           authorizationError == .alreadyInProgress {
            return ConnectorError(code: "authorization_in_progress", message: "Authorization is already pending.")
        }
        if let httpError = error as? ConnectorHTTPError {
            switch httpError {
            case .routeDenied:
                return ConnectorError(code: "route_denied", message: "This Index route is not allowed.")
            case .toolDenied:
                return ConnectorError(code: "tool_denied", message: "This Index tool is not allowed.")
            case .uploadTooLarge:
                return ConnectorError(code: "upload_too_large", message: "The request body is too large.")
            case .responseTooLarge:
                return ConnectorError(code: "response_too_large", message: "The Index response is too large.")
            case .timedOut:
                return ConnectorError(code: "timeout", message: "The Index request timed out.")
            case .unauthorized:
                return ConnectorError(code: "reconnect_required", message: "Reconnect to Index.")
            case let .serverRejected(code):
                return ConnectorError(code: code, message: "Index rejected the request.")
            case .endpointNotAllowed:
                return ConnectorError(code: "endpoint_denied", message: "The endpoint is not allowed.")
            case .networkFailure:
                return ConnectorError(code: "network_error", message: "Index could not be reached.")
            default:
                break
            }
        }
        return ConnectorError(code: "operation_failed", message: "The operation could not be completed.")
    }

    private static func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
