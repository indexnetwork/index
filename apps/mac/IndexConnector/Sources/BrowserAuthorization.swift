import AppKit
import CryptoKit
import Darwin
import Foundation
import Security

enum BrowserAuthorizationError: Error, Equatable {
    case alreadyInProgress
    case randomGenerationFailed
    case callbackBindFailed
    case authorizationExpired
    case browserOpenFailed
    case invalidAuthorizationResponse
    case invalidCredentialMetadata
    case keychainFailure
    case activationFailure
}

private func secureRandomBytes(count: Int) throws -> Data {
    var data = Data(count: count)
    let status = data.withUnsafeMutableBytes { bytes in
        SecRandomCopyBytes(kSecRandomDefault, count, bytes.baseAddress!)
    }
    guard status == errSecSuccess else { throw BrowserAuthorizationError.randomGenerationFailed }
    return data
}

private func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private func constantTimeEqual(_ left: String, _ right: String) -> Bool {
    let lhs = Array(left.utf8)
    let rhs = Array(right.utf8)
    guard lhs.count == rhs.count else { return false }
    var difference: UInt8 = 0
    for index in lhs.indices { difference |= lhs[index] ^ rhs[index] }
    return difference == 0
}

final class LoopbackCallbackListener {
    private let expectedState: String
    private let queue = DispatchQueue(label: "network.index.connector.callback")
    private let lock = NSLock()
    private var descriptor: Int32 = -1
    private var consumed = false
    private let handler: (String) -> Void

    let port: UInt16
    var redirectURI: String { "http://127.0.0.1:\(port)/callback" }

    init(expectedState: String, handler: @escaping (String) -> Void) throws {
        self.expectedState = expectedState
        self.handler = handler
        var selectedDescriptor: Int32 = -1
        var selectedPort: UInt16 = 0

        for _ in 0..<64 {
            let randomBytes = [UInt8](try secureRandomBytes(count: 2))
            let random = (UInt16(randomBytes[0]) << 8) | UInt16(randomBytes[1])
            let candidate = UInt16(49_152) + (random % UInt16(65_535 - 49_152 + 1))
            let socketDescriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
            guard socketDescriptor >= 0 else { continue }
            var address = sockaddr_in()
            address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            address.sin_family = sa_family_t(AF_INET)
            address.sin_port = candidate.bigEndian
            address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
            let bound = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.bind(socketDescriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            if bound == 0 && Darwin.listen(socketDescriptor, 4) == 0 {
                selectedDescriptor = socketDescriptor
                selectedPort = candidate
                break
            }
            Darwin.close(socketDescriptor)
        }
        guard selectedDescriptor >= 0 else { throw BrowserAuthorizationError.callbackBindFailed }
        descriptor = selectedDescriptor
        port = selectedPort
        queue.async { [weak self] in self?.acceptRequests() }
    }

    deinit { close() }

    func close() {
        lock.lock()
        let current = descriptor
        descriptor = -1
        lock.unlock()
        if current >= 0 {
            Darwin.shutdown(current, SHUT_RDWR)
            Darwin.close(current)
        }
    }

    private func acceptRequests() {
        while true {
            lock.lock()
            let listening = descriptor
            let alreadyConsumed = consumed
            lock.unlock()
            guard listening >= 0, !alreadyConsumed else { return }
            let connection = Darwin.accept(listening, nil, nil)
            if connection < 0 { return }
            handle(connection)
            Darwin.close(connection)
        }
    }

    private func handle(_ connection: Int32) {
        var request = Data()
        var buffer = [UInt8](repeating: 0, count: 2048)
        while request.count <= 16_384 {
            let count = buffer.withUnsafeMutableBytes {
                Darwin.recv(connection, $0.baseAddress, $0.count, 0)
            }
            if count <= 0 { break }
            request.append(contentsOf: buffer.prefix(count))
            if request.range(of: Data("\r\n\r\n".utf8)) != nil { break }
        }
        guard request.count <= 16_384,
              let text = String(data: request, encoding: .utf8),
              let headerEnd = text.range(of: "\r\n\r\n") else {
            respond(connection, status: 400, message: "Invalid callback")
            return
        }
        let lines = text[..<headerEnd.lowerBound].components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            respond(connection, status: 400, message: "Invalid callback")
            return
        }
        let parts = requestLine.split(separator: " ")
        let hostHeaders = lines.dropFirst().compactMap { line -> String? in
            guard let separator = line.firstIndex(of: ":") else { return nil }
            let name = line[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
            guard name == "host" else { return nil }
            return line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
        }
        guard parts.count == 3, parts[0] == "GET", parts[2] == "HTTP/1.1",
              hostHeaders == ["127.0.0.1:\(port)"],
              let components = URLComponents(string: "http://127.0.0.1:\(port)\(parts[1])"),
              components.path == "/callback", components.fragment == nil,
              let items = components.queryItems, items.count == 2 else {
            respond(connection, status: 400, message: "Invalid callback")
            return
        }
        var values: [String: String] = [:]
        for item in items {
            guard (item.name == "state" || item.name == "code"),
                  values[item.name] == nil,
                  let value = item.value, !value.isEmpty else {
                respond(connection, status: 400, message: "Invalid callback")
                return
            }
            values[item.name] = value
        }
        guard let state = values["state"], let code = values["code"],
              constantTimeEqual(state, expectedState) else {
            respond(connection, status: 400, message: "Invalid callback")
            return
        }

        lock.lock()
        guard !consumed else {
            lock.unlock()
            respond(connection, status: 409, message: "Callback already used")
            return
        }
        consumed = true
        lock.unlock()
        respond(connection, status: 200, message: "Authorization received. You may close this window.")
        close()
        handler(code)
    }

    private func respond(_ connection: Int32, status: Int, message: String) {
        let reason = status == 200 ? "OK" : (status == 409 ? "Conflict" : "Bad Request")
        let body = Data(message.utf8)
        let header = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n"
        var response = Data(header.utf8)
        response.append(body)
        response.withUnsafeBytes { bytes in
            _ = Darwin.send(connection, bytes.baseAddress, bytes.count, 0)
        }
    }
}

struct BrowserAuthorizationPreparation: Equatable {
    let attemptId: String
    let state: String
    let verifier: String
    let codeChallenge: String
    let redirectURI: String
}

struct BrowserAuthorizationCallback: Equatable {
    let attemptId: String
    let code: String
}

final class BrowserAuthorization {
    static let canonicalActions = [
        "manage:identity", "manage:premises", "manage:intents",
        "manage:networks", "manage:opportunities", "manage:negotiations",
    ]

    private struct Session {
        let state: String
        let listener: LoopbackCallbackListener
        var callbackCode: String?
    }

    private let endpoints: ConnectorEndpoints
    private let openBrowser: (URL) -> Bool
    private let lock = NSLock()
    private var sessions: [String: Session] = [:]

    init(
        endpoints: ConnectorEndpoints = .embedded,
        openBrowser: @escaping (URL) -> Bool = { NSWorkspace.shared.open($0) }
    ) {
        self.endpoints = endpoints
        self.openBrowser = openBrowser
    }

    func prepare(attemptId: String) throws -> BrowserAuthorizationPreparation {
        let state = base64URL(try secureRandomBytes(count: 32))
        let verifier = base64URL(try secureRandomBytes(count: 32))
        let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let listener = try LoopbackCallbackListener(expectedState: state) { [weak self] code in
            self?.publishCallback(attemptId: attemptId, code: code)
        }
        lock.lock()
        guard sessions[attemptId] == nil else {
            lock.unlock()
            listener.close()
            throw BrowserAuthorizationError.alreadyInProgress
        }
        sessions[attemptId] = Session(state: state, listener: listener, callbackCode: nil)
        lock.unlock()
        return BrowserAuthorizationPreparation(
            attemptId: attemptId,
            state: state,
            verifier: verifier,
            codeChallenge: challenge,
            redirectURI: listener.redirectURI
        )
    }

    func open(
        preparation: BrowserAuthorizationPreparation,
        requestId: String,
        expiresAt: Date
    ) throws {
        guard expiresAt > Date() else {
            cancel(attemptId: preparation.attemptId)
            throw BrowserAuthorizationError.authorizationExpired
        }
        lock.lock()
        let session = sessions[preparation.attemptId]
        lock.unlock()
        guard let session, constantTimeEqual(session.state, preparation.state) else {
            throw BrowserAuthorizationError.invalidAuthorizationResponse
        }
        var components = URLComponents(
            url: endpoints.web.appending(path: "hermes-authorize"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "request_id", value: requestId),
            URLQueryItem(name: "state", value: preparation.state),
            URLQueryItem(name: "redirect_uri", value: preparation.redirectURI),
        ]
        guard let authorizationURL = components.url, openBrowser(authorizationURL) else {
            cancel(attemptId: preparation.attemptId)
            throw BrowserAuthorizationError.browserOpenFailed
        }
    }

    func takeCallback(attemptId: String) -> BrowserAuthorizationCallback? {
        lock.lock()
        defer { lock.unlock() }
        guard var session = sessions[attemptId], let code = session.callbackCode else { return nil }
        session.callbackCode = nil
        sessions[attemptId] = session
        return BrowserAuthorizationCallback(attemptId: attemptId, code: code)
    }

    func cancel(attemptId: String) {
        lock.lock()
        let session = sessions.removeValue(forKey: attemptId)
        lock.unlock()
        session?.listener.close()
    }

    private func publishCallback(attemptId: String, code: String) {
        lock.lock()
        guard var session = sessions[attemptId], session.callbackCode == nil else {
            lock.unlock()
            return
        }
        session.callbackCode = code
        sessions[attemptId] = session
        lock.unlock()
    }
}
