import CryptoKit
import Darwin
import Foundation

private final class FixtureCredentialStore: ConnectorCredentialStoring {
    var record: ConnectorCredentialRecord?
    var events: [String] = []
    var failWrites = false

    func putAndVerify(_ record: ConnectorCredentialRecord) throws {
        events.append("write")
        if failWrites { throw ConnectorCredentialStoreError.verificationFailed }
        self.record = record
        events.append("read")
        guard try read() == record else { throw ConnectorCredentialStoreError.verificationFailed }
    }

    func read() throws -> ConnectorCredentialRecord? { record }
    func delete() throws { record = nil }
}

private final class AuthorizationFixtureServer {
    private let queue = DispatchQueue(label: "authorization.fixture.server")
    private let descriptor: Int32
    private let lock = NSLock()
    private(set) var port: UInt16 = 0
    private(set) var redirects: [String] = []
    private(set) var challenges: [String] = []
    private(set) var activationCount = 0
    var activationAllowed: () -> Bool = { true }
    var rejectNextExchangeAsExpired = false

    init() throws {
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
        var actual = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &actual) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                _ = Darwin.getsockname(descriptor, $0, &length)
            }
        }
        port = UInt16(bigEndian: actual.sin_port)
        queue.async { [weak self] in self?.serve() }
    }

    deinit {
        Darwin.shutdown(descriptor, SHUT_RDWR)
        Darwin.close(descriptor)
    }

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
            handle(connection)
            Darwin.close(connection)
        }
    }

    private func handle(_ connection: Int32) {
        guard let request = readRequest(connection),
              let line = request.header.components(separatedBy: "\r\n").first else {
            respond(connection, status: 400, body: ["error": "invalid_request"])
            return
        }
        let parts = line.split(separator: " ")
        guard parts.count >= 2 else { return }
        let path = String(parts[1])
        let json = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any] ?? [:]
        switch path {
        case "/api/hermes-authorizations":
            let exactKeys = Set(json.keys) == Set([
                "protocolVersion", "installationId", "redirectUri", "codeChallenge",
                "codeChallengeMethod", "state", "actions",
            ])
            precondition(exactKeys && json["codeChallengeMethod"] as? String == "S256")
            let redirect = json["redirectUri"] as! String
            let state = json["state"] as! String
            lock.lock()
            redirects.append(redirect)
            challenges.append(json["codeChallenge"] as! String)
            lock.unlock()
            respond(connection, status: 201, body: [
                "requestId": UUID().uuidString.lowercased(),
                "state": state,
                "expiresAt": "2099-01-01T00:10:00.000Z",
            ])
        case "/api/hermes-authorizations/exchange":
            lock.lock()
            let rejectExpired = rejectNextExchangeAsExpired
            rejectNextExchangeAsExpired = false
            let expectedChallenge = challenges.last!
            let redirect = redirects.last!
            lock.unlock()
            if rejectExpired {
                respond(connection, status: 400, body: ["error": "expired_grant"])
                return
            }
            let verifier = json["verifier"] as! String
            let digest = Data(SHA256.hash(data: Data(verifier.utf8)))
                .base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            precondition(digest == expectedChallenge)
            precondition(json["redirectUri"] as? String == redirect)
            respond(connection, status: 200, body: credentialBody(state: "pending", includeCredential: true))
        case "/api/hermes-authorizations/activate":
            precondition(activationAllowed())
            lock.lock(); activationCount += 1; lock.unlock()
            respond(connection, status: 200, body: credentialBody(state: "active", includeCredential: false))
        case "/api/auth/me":
            respond(connection, status: 200, body: ["user": ["name": "Fixture Owner"]])
        default:
            respond(connection, status: 404, body: ["error": "not_found"])
        }
    }

    private func credentialBody(state: String, includeCredential: Bool) -> [String: Any] {
        var body: [String: Any] = [
            "audience": "hermes-agent",
            "credentialId": "55555555-5555-4555-8555-555555555555",
            "agentId": "22222222-2222-4222-8222-222222222222",
            "installationId": "11111111-1111-4111-8111-111111111111",
            "setupAttemptId": "44444444-4444-4444-8444-444444444444",
            "actions": BrowserAuthorization.canonicalActions,
            "expiresAt": "2099-01-31T00:00:00.000Z",
            "activationState": state,
        ]
        if includeCredential { body["credential"] = "idxh_fixture-credential" }
        return body
    }

    private func readRequest(_ connection: Int32) -> (header: String, body: Data)? {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        var headerRange: Range<Data.Index>?
        while data.count < 9_000_000 {
            let count = buffer.withUnsafeMutableBytes { Darwin.recv(connection, $0.baseAddress, $0.count, 0) }
            if count <= 0 { break }
            data.append(contentsOf: buffer.prefix(count))
            headerRange = data.range(of: Data("\r\n\r\n".utf8))
            if let headerRange {
                let headerData = data[..<headerRange.lowerBound]
                let header = String(decoding: headerData, as: UTF8.self)
                let length = header.components(separatedBy: "\r\n").first(where: {
                    $0.lowercased().hasPrefix("content-length:")
                }).flatMap { Int($0.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces)) } ?? 0
                let bodyStart = headerRange.upperBound
                if data.count - bodyStart >= length {
                    return (header, Data(data[bodyStart..<(bodyStart + length)]))
                }
            }
        }
        return nil
    }

    private func respond(_ connection: Int32, status: Int, body: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: body)
        let reason = status < 300 ? "OK" : "Error"
        let header = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: application/json\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\r\n"
        var response = Data(header.utf8); response.append(data)
        response.withUnsafeBytes { _ = Darwin.send(connection, $0.baseAddress, $0.count, 0) }
    }
}

private func sendRawCallback(port: UInt16, target: String, host: String) -> Bool {
    let descriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { return false }
    defer { Darwin.close(descriptor) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = port.bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let connected = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    guard connected == 0 else { return false }
    let request = Data("GET \(target) HTTP/1.1\r\nHost: \(host)\r\nConnection: close\r\n\r\n".utf8)
    request.withUnsafeBytes { _ = Darwin.send(descriptor, $0.baseAddress, $0.count, 0) }
    var response = [UInt8](repeating: 0, count: 1024)
    let count = response.withUnsafeMutableBytes { Darwin.recv(descriptor, $0.baseAddress, $0.count, 0) }
    return count > 0 && String(decoding: response.prefix(max(0, count)), as: UTF8.self).contains(" 200 ")
}

private func waitFor(_ predicate: () -> Bool) {
    let deadline = Date().addingTimeInterval(5)
    while Date() < deadline {
        if predicate() { return }
        Thread.sleep(forTimeInterval: 0.02)
    }
    preconditionFailure("fixture timed out")
}

@main
struct AuthorizationFixture {
    static func main() throws {
        let wrongState = "wrongState"
        let wrongPath = "wrongPath"
        let wrongHost = "wrongHost"
        let callbackReplay = "callbackReplay"
        let callbackReceived = DispatchSemaphore(value: 0)
        let listener = try LoopbackCallbackListener(expectedState: "expected-state") { code in
            precondition(code == "authorization-code")
            callbackReceived.signal()
        }
        precondition(listener.redirectURI.hasPrefix("http://127.0.0.1:"))
        precondition((49_152...65_535).contains(Int(listener.port)))
        precondition(!sendRawCallback(port: listener.port, target: "/callback?state=\(wrongState)&code=x", host: "127.0.0.1:\(listener.port)"))
        precondition(!sendRawCallback(port: listener.port, target: "/\(wrongPath)?state=expected-state&code=x", host: "127.0.0.1:\(listener.port)"))
        precondition(!sendRawCallback(port: listener.port, target: "/callback?state=expected-state&code=x", host: wrongHost))
        precondition(sendRawCallback(port: listener.port, target: "/callback?state=expected-state&code=authorization-code", host: "127.0.0.1:\(listener.port)"))
        precondition(callbackReceived.wait(timeout: .now() + 2) == .success)
        precondition(!sendRawCallback(port: listener.port, target: "/callback?state=expected-state&code=\(callbackReplay)", host: "127.0.0.1:\(listener.port)"))

        let server = try AuthorizationFixtureServer()
        let endpoints = try server.endpoints
        let http = ConnectorHTTPClient(endpoints: endpoints)
        let store = FixtureCredentialStore()
        let keychainWriteBeforeActivation = "keychainWriteBeforeActivation"
        server.activationAllowed = { store.events.suffix(2) == ["write", "read"] }
        let authorization = BrowserAuthorization(
            http: http,
            credentialStore: store,
            installationId: "11111111-1111-4111-8111-111111111111",
            endpoints: endpoints,
            openBrowser: { url in
                let query = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
                precondition(url.path == "/hermes-authorize")
                precondition(query["redirect_uri"]!.hasPrefix("http://127.0.0.1:"))
                precondition(!query.values.contains(where: { $0.contains("idxh_") }))
                let callback = URL(string: query["redirect_uri"]!)!
                return sendRawCallback(
                    port: UInt16(callback.port!),
                    target: "/callback?state=\(query["state"]!)&code=authorization-code",
                    host: "127.0.0.1:\(callback.port!)"
                )
            }
        )
        _ = try authorization.start()
        waitFor { if case .connected = authorization.snapshot() { return true }; return false }
        precondition(store.record?.accountLabel == "Fixture Owner")
        precondition(server.activationCount == 1)
        precondition(keychainWriteBeforeActivation == "keychainWriteBeforeActivation")

        let failedStore = FixtureCredentialStore(); failedStore.failWrites = true
        let activationOmittedAfterKeychainFailure = "activationOmittedAfterKeychainFailure"
        let failedAuthorization = BrowserAuthorization(
            http: http,
            credentialStore: failedStore,
            installationId: "11111111-1111-4111-8111-111111111111",
            endpoints: endpoints,
            openBrowser: { url in
                let query = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
                let callback = URL(string: query["redirect_uri"]!)!
                return sendRawCallback(port: UInt16(callback.port!), target: "/callback?state=\(query["state"]!)&code=authorization-code-2", host: "127.0.0.1:\(callback.port!)")
            }
        )
        _ = try failedAuthorization.start()
        waitFor { if case .failed = failedAuthorization.snapshot() { return true }; return false }
        precondition(server.activationCount == 1)
        precondition(activationOmittedAfterKeychainFailure == "activationOmittedAfterKeychainFailure")

        server.rejectNextExchangeAsExpired = true
        let expiredAuthorization = BrowserAuthorization(
            http: http,
            credentialStore: FixtureCredentialStore(),
            installationId: "11111111-1111-4111-8111-111111111111",
            endpoints: endpoints,
            openBrowser: { url in
                let query = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
                let callback = URL(string: query["redirect_uri"]!)!
                return sendRawCallback(port: UInt16(callback.port!), target: "/callback?state=\(query["state"]!)&code=expired-code", host: "127.0.0.1:\(callback.port!)")
            }
        )
        _ = try expiredAuthorization.start()
        waitFor { if case .failed = expiredAuthorization.snapshot() { return true }; return false }
        print("Authorization fixture passed")
    }
}
