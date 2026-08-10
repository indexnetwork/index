import Darwin
import Foundation

private final class TransportCredentialStore: ConnectorCredentialStoring {
    var record: ConnectorCredentialRecord?
    init(record: ConnectorCredentialRecord?) { self.record = record }
    func putAndVerify(_ record: ConnectorCredentialRecord) throws { self.record = record }
    func read() throws -> ConnectorCredentialRecord? { record }
    func delete() throws { record = nil }
}

private final class TransportInstallationStore: ConnectorInstallationStoring {
    let installationId: String
    var revocationPending = false
    init(installationId: String) { self.installationId = installationId }
    func setRevocationPending(_ pending: Bool) throws { revocationPending = pending }
}

private final class TransportFixtureServer {
    private let descriptor: Int32
    private let queue = DispatchQueue(label: "transport.fixture.server", attributes: .concurrent)
    private let lock = NSLock()
    private(set) var port: UInt16 = 0
    var failDisconnect = false
    private var revoked = false

    init() {
        descriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        precondition(descriptor >= 0)
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        precondition(bound == 0 && Darwin.listen(descriptor, 8) == 0)
        var actual = sockaddr_in(); var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &actual) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                _ = Darwin.getsockname(descriptor, $0, &length)
            }
        }
        port = UInt16(bigEndian: actual.sin_port)
        queue.async { [weak self] in self?.serve() }
    }

    deinit { Darwin.shutdown(descriptor, SHUT_RDWR); Darwin.close(descriptor) }

    var endpoints: ConnectorEndpoints {
        get throws {
            try ConnectorEndpoints(
                developmentWeb: URL(string: "http://127.0.0.1:\(port)")!,
                developmentAPI: URL(string: "http://127.0.0.1:\(port)/api")!,
                developmentMCP: URL(string: "http://127.0.0.1:\(port)/mcp")!
            )
        }
    }

    private func serve() {
        while true {
            let connection = Darwin.accept(descriptor, nil, nil)
            if connection < 0 { return }
            queue.async { [weak self] in
                self?.handle(connection)
                Darwin.close(connection)
            }
        }
    }

    private func handle(_ connection: Int32) {
        var request = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
        while request.count < 9_000_000 {
            let count = buffer.withUnsafeMutableBytes { Darwin.recv(connection, $0.baseAddress, $0.count, 0) }
            if count <= 0 { break }
            request.append(contentsOf: buffer.prefix(count))
            if let range = request.range(of: Data("\r\n\r\n".utf8)) {
                let header = String(decoding: request[..<range.lowerBound], as: UTF8.self)
                let length = header.components(separatedBy: "\r\n").first(where: { $0.lowercased().hasPrefix("content-length:") })
                    .flatMap { Int($0.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces)) } ?? 0
                if request.count - range.upperBound >= length {
                    route(connection, header: header, body: Data(request[range.upperBound..<(range.upperBound + length)]))
                    return
                }
            }
        }
    }

    private func route(_ connection: Int32, header: String, body: Data) {
        let requestLine = header.components(separatedBy: "\r\n").first!
        let path = String(requestLine.split(separator: " ")[1])
        lock.lock(); let isRevoked = revoked; let shouldFail = failDisconnect; lock.unlock()
        if path == "/api/hermes-authorizations/disconnect" {
            if shouldFail { respond(connection, status: 503, body: .object(["error": .string("unavailable")])) }
            else {
                lock.lock(); revoked = true; lock.unlock()
                respond(connection, status: 200, body: .object([
                    "revoked": .bool(true),
                    "credentialId": .string("credential-1"),
                    "setupAttemptId": .string("setup-1"),
                ]))
            }
        } else if path == "/api/auth/me" {
            respond(connection, status: isRevoked ? 401 : 200, body: isRevoked ? .object(["error": .string("invalid_credential")]) : .object(["user": .object(["name": .string("Owner")])]))
        } else if path == "/api/opportunities?fixture=large" {
            respondDeclaredOversize(connection)
        } else if path == "/api/agents/me" {
            respond(connection, status: 200, body: .object(["agent": .object(["id": .string("agent-1")])]))
        } else if path == "/mcp" {
            respond(connection, status: 200, body: .object([
                "jsonrpc": .string("2.0"), "id": .number(1),
                "result": .object(["content": .array([.object(["type": .string("text"), "text": .string("ok")])])]),
            ]))
        } else {
            respond(connection, status: 404, body: .object(["error": .string("not_found")]))
        }
    }

    private func respond(_ connection: Int32, status: Int, body: JSONValue) {
        respondRaw(connection, status: status, contentType: "application/json", body: try! JSONEncoder().encode(body))
    }

    private func respondDeclaredOversize(_ connection: Int32) {
        let header = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(ConnectorHTTPClient.maximumResponseBytes + 1)\r\nConnection: close\r\n\r\n"
        Data(header.utf8).withUnsafeBytes { _ = Darwin.send(connection, $0.baseAddress, $0.count, 0) }
    }

    private func respondRaw(_ connection: Int32, status: Int, contentType: String, body: Data) {
        let header = "HTTP/1.1 \(status) Result\r\nContent-Type: \(contentType)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        var response = Data(header.utf8); response.append(body)
        response.withUnsafeBytes { _ = Darwin.send(connection, $0.baseAddress, $0.count, 0) }
    }
}

private func expectHTTPError(_ expected: ConnectorHTTPError, _ body: () throws -> Void) {
    do { try body(); preconditionFailure("expected \(expected)") }
    catch let error as ConnectorHTTPError { precondition(error == expected) }
    catch { preconditionFailure("unexpected \(error)") }
}

@main
struct TransportFixture {
    static func main() throws {
        let server = TransportFixtureServer()
        let endpoints = try server.endpoints
        let http = ConnectorHTTPClient(endpoints: endpoints)
        let record = ConnectorCredentialRecord(
            rawCredential: "idxh_transport-fixture", audience: "hermes-agent",
            agentId: "agent-1", installationId: "11111111-1111-4111-8111-111111111111",
            setupAttemptId: "setup-1", credentialId: "credential-1",
            actions: BrowserAuthorization.canonicalActions,
            expiresAt: Date().addingTimeInterval(3600), activationState: "active",
            accountLabel: "Owner"
        )

        let deniedRoute = "deniedRoute"
        expectHTTPError(.routeDenied) {
            _ = try http.rest(method: "POST", path: "/auth/api-key", body: .object([:]), credential: record)
        }
        let deniedTool = "deniedTool"
        expectHTTPError(.toolDenied) {
            _ = try http.callMCP(toolName: "delete_intent", arguments: [:], credential: record)
        }
        let endpointOverride = "endpointOverride"
        do {
            _ = try ConnectorEndpoints(
                developmentWeb: URL(string: "http://localhost:3000")!,
                developmentAPI: URL(string: "http://localhost:3001/api")!,
                developmentMCP: URL(string: "http://localhost:3001/mcp")!
            )
            preconditionFailure("endpoint override should fail")
        } catch ConnectorIdentityError.invalidDevelopmentEndpoints {}

        let oversizedPayload = "oversizedPayload"
        expectHTTPError(.uploadTooLarge) {
            _ = try http.rest(
                method: "POST", path: "/intents/list",
                body: .object(["value": .string(String(repeating: "x", count: ConnectorHTTPClient.maximumUploadBytes + 1))]),
                credential: record
            )
        }
        expectHTTPError(.responseTooLarge) {
            _ = try http.rest(method: "GET", path: "/opportunities?fixture=large", body: nil, credential: record)
        }
        let rest = try http.rest(method: "GET", path: "/agents/me", body: nil, credential: record)
        precondition(rest.status == 200)
        let mcp = try http.callMCP(toolName: "read_docs", arguments: [:], credential: record)
        guard case let .object(mcpObject) = mcp else { preconditionFailure() }
        precondition(mcpObject["content"] != nil)

        let credentialStore = TransportCredentialStore(record: record)
        let installationStore = TransportInstallationStore(installationId: record.installationId)
        let authorization = BrowserAuthorization(
            http: http, credentialStore: credentialStore,
            installationId: record.installationId, endpoints: endpoints,
            openBrowser: { _ in false }
        )
        let runtime = ConnectorRuntime(
            endpoints: endpoints, installationStore: installationStore,
            credentialStore: credentialStore, http: http, authorization: authorization
        )
        let pendingRevocation = "pendingRevocation"
        server.failDisconnect = true
        let first = runtime.handle(ConnectorRequest(protocolVersion: 1, id: "disconnect-1", operation: .disconnect, payload: [:]))
        precondition(first.success)
        precondition(first.result == .object(["status": .string("recovery_only")]))
        precondition(installationStore.revocationPending && credentialStore.record != nil)
        let blocked = runtime.handle(ConnectorRequest(protocolVersion: 1, id: "rest-1", operation: .rest, payload: ["method": .string("GET"), "path": .string("/agents/me")]))
        precondition(blocked.error?.code == "recovery_only")

        server.failDisconnect = false
        let recovered = runtime.handle(ConnectorRequest(protocolVersion: 1, id: "disconnect-2", operation: .disconnect, payload: [:]))
        precondition(recovered.result == .object(["status": .string("disconnected")]))
        precondition(!installationStore.revocationPending && credentialStore.record == nil)
        precondition([deniedRoute, deniedTool, endpointOverride, oversizedPayload, pendingRevocation].allSatisfy { !$0.isEmpty })
        print("Transport fixture passed")
    }
}
