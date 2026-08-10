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

enum BrowserAuthorizationSnapshot: Equatable {
    case idle
    case pending
    case connected(ConnectorCredentialRecord)
    case failed(code: String, message: String)
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

final class BrowserAuthorization {
    static let canonicalActions = [
        "manage:identity", "manage:premises", "manage:intents",
        "manage:networks", "manage:opportunities", "manage:negotiations",
    ]

    private struct Attempt {
        let requestId: String
        let verifier: String
        let redirectURI: String
        let expiresAt: Date
        let listener: LoopbackCallbackListener
    }

    private let http: ConnectorHTTPClient
    private let credentialStore: ConnectorCredentialStoring
    private let installationStore: ConnectorInstallationStoring
    private let processRecovery: ConnectorProcessRecoveryState
    private let installationId: String
    private let endpoints: ConnectorEndpoints
    private let openBrowser: (URL) -> Bool
    private let lock = NSLock()
    private let workQueue = DispatchQueue(label: "network.index.connector.authorization")
    private var attempt: Attempt?
    private var currentSnapshot: BrowserAuthorizationSnapshot = .idle

    init(
        http: ConnectorHTTPClient,
        credentialStore: ConnectorCredentialStoring,
        installationStore: ConnectorInstallationStoring,
        processRecovery: ConnectorProcessRecoveryState,
        installationId: String,
        endpoints: ConnectorEndpoints = .embedded,
        openBrowser: @escaping (URL) -> Bool = { NSWorkspace.shared.open($0) }
    ) {
        self.http = http
        self.credentialStore = credentialStore
        self.installationStore = installationStore
        self.processRecovery = processRecovery
        self.installationId = installationId
        self.endpoints = endpoints
        self.openBrowser = openBrowser
    }

    func start() throws {
        lock.lock()
        if case .pending = currentSnapshot {
            lock.unlock()
            throw BrowserAuthorizationError.alreadyInProgress
        }
        lock.unlock()

        let state = base64URL(try secureRandomBytes(count: 32))
        let verifier = base64URL(try secureRandomBytes(count: 32))
        let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        var callbackListener: LoopbackCallbackListener!
        callbackListener = try LoopbackCallbackListener(expectedState: state) { [weak self] code in
            self?.workQueue.async { self?.complete(code: code) }
        }
        do {
            let created = try http.createAuthorization(
                installationId: installationId,
                redirectURI: callbackListener.redirectURI,
                codeChallenge: challenge,
                state: state,
                actions: Self.canonicalActions
            )
            guard constantTimeEqual(created.state, state), created.expiresAt > Date() else {
                callbackListener.close()
                throw BrowserAuthorizationError.invalidAuthorizationResponse
            }
            var components = URLComponents(url: endpoints.web.appending(path: "hermes-authorize"), resolvingAgainstBaseURL: false)!
            components.queryItems = [
                URLQueryItem(name: "request_id", value: created.requestId),
                URLQueryItem(name: "state", value: state),
                URLQueryItem(name: "redirect_uri", value: callbackListener.redirectURI),
            ]
            guard let authorizationURL = components.url else {
                callbackListener.close()
                throw BrowserAuthorizationError.invalidAuthorizationResponse
            }
            lock.lock()
            attempt = Attempt(
                requestId: created.requestId,
                verifier: verifier,
                redirectURI: callbackListener.redirectURI,
                expiresAt: created.expiresAt,
                listener: callbackListener
            )
            currentSnapshot = .pending
            lock.unlock()
            guard openBrowser(authorizationURL) else {
                fail(code: "browser_open_failed", message: "The authorization page could not be opened.")
                throw BrowserAuthorizationError.browserOpenFailed
            }
            return
        } catch {
            callbackListener.close()
            throw error
        }
    }

    func snapshot() -> BrowserAuthorizationSnapshot {
        lock.lock()
        defer { lock.unlock() }
        if case .pending = currentSnapshot, let attempt, attempt.expiresAt <= Date() {
            attempt.listener.close()
            self.attempt = nil
            currentSnapshot = .failed(
                code: "authorization_expired",
                message: "Authorization expired. Start again."
            )
        }
        return currentSnapshot
    }

    private func complete(code: String) {
        lock.lock()
        guard let activeAttempt = attempt else {
            lock.unlock()
            return
        }
        lock.unlock()
        guard activeAttempt.expiresAt > Date() else {
            fail(code: "authorization_expired", message: "Authorization expired. Start again.")
            return
        }
        do {
            let exchanged = try http.exchangeAuthorization(
                requestId: activeAttempt.requestId,
                code: code,
                verifier: activeAttempt.verifier,
                redirectURI: activeAttempt.redirectURI
            )
            guard exchanged.audience == "hermes-agent",
                  exchanged.installationId == installationId,
                  exchanged.activationState == "pending",
                  exchanged.actions == Self.canonicalActions,
                  exchanged.expiresAt > Date() else {
                throw BrowserAuthorizationError.invalidCredentialMetadata
            }
            let pendingRecord = ConnectorCredentialRecord(
                rawCredential: exchanged.credential,
                audience: exchanged.audience,
                agentId: exchanged.agentId,
                installationId: exchanged.installationId,
                setupAttemptId: exchanged.setupAttemptId,
                credentialId: exchanged.credentialId,
                actions: exchanged.actions,
                expiresAt: exchanged.expiresAt,
                activationState: exchanged.activationState,
                accountLabel: ""
            )
            do {
                try credentialStore.putAndVerify(pendingRecord)
            } catch {
                throw BrowserAuthorizationError.keychainFailure
            }

            // Fail-close this process first, then persist activation uncertainty
            // to both authoritative Keychain state and the non-secret journal.
            processRecovery.failClosed()
            let activationRequested = pendingRecord.replacing(recoveryPhase: .activationRequested)
            guard persistRecovery(record: activationRequested, phase: .activationRequested) else {
                throw BrowserAuthorizationError.keychainFailure
            }

            let activated = try http.activate(credential: exchanged.credential)
            guard activated.audience == exchanged.audience,
                  activated.credentialId == exchanged.credentialId,
                  activated.agentId == exchanged.agentId,
                  activated.installationId == exchanged.installationId,
                  activated.setupAttemptId == exchanged.setupAttemptId,
                  activated.actions == exchanged.actions,
                  activated.expiresAt == exchanged.expiresAt,
                  activated.activationState == "active" else {
                throw BrowserAuthorizationError.activationFailure
            }

            // Server activation is confirmed. Persist active authority before the
            // optional account-label request so that lookup failure cannot regress it.
            let activeRecord = pendingRecord.replacing(
                activationState: "active",
                recoveryPhase: .none
            )
            do {
                try credentialStore.putAndVerify(activeRecord)
            } catch {
                throw BrowserAuthorizationError.keychainFailure
            }
            do {
                try installationStore.setRecoveryPhase(.none)
            } catch {
                throw BrowserAuthorizationError.keychainFailure
            }
            processRecovery.clear()
            setConnected(activeRecord)

            guard let accountLabel = try? http.fetchAccountLabel(credential: exchanged.credential),
                  !accountLabel.isEmpty else { return }
            let labeledRecord = activeRecord.replacing(accountLabel: accountLabel)
            if (try? credentialStore.putAndVerify(labeledRecord)) != nil {
                setConnected(labeledRecord)
            }
        } catch BrowserAuthorizationError.keychainFailure {
            fail(code: "credential_storage_failed", message: "Secure credential storage failed.")
        } catch {
            fail(code: "authorization_failed", message: "Authorization could not be completed.")
        }
    }

    private func persistRecovery(
        record: ConnectorCredentialRecord,
        phase: ConnectorRecoveryPhase
    ) -> Bool {
        var keychainPersisted = true
        var journalPersisted = true
        do { try credentialStore.putAndVerify(record) } catch { keychainPersisted = false }
        do { try installationStore.setRecoveryPhase(phase) } catch { journalPersisted = false }
        return keychainPersisted && journalPersisted
    }

    private func setConnected(_ record: ConnectorCredentialRecord) {
        lock.lock()
        attempt = nil
        currentSnapshot = .connected(record)
        lock.unlock()
    }

    private func fail(code: String, message: String) {
        lock.lock()
        attempt?.listener.close()
        attempt = nil
        currentSnapshot = .failed(code: code, message: message)
        lock.unlock()
    }
}
