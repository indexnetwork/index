import CryptoKit
import Darwin
import Foundation

private final class FixtureCredentialStore: ConnectorCredentialStoring {
    var record: ConnectorCredentialRecord?
    var events: [String] = []
    var failWrites = false
    var failNextActiveWrite = false
    var failNextLabelWrite = false

    func putAndVerify(_ record: ConnectorCredentialRecord) throws {
        events.append("write:\(record.activationState):\(record.recoveryPhase.rawValue)")
        if failWrites { throw ConnectorCredentialStoreError.verificationFailed }
        if failNextActiveWrite && record.activationState == "active" {
            failNextActiveWrite = false
            throw ConnectorCredentialStoreError.verificationFailed
        }
        if failNextLabelWrite && record.activationState == "active" && !record.accountLabel.isEmpty {
            failNextLabelWrite = false
            throw ConnectorCredentialStoreError.verificationFailed
        }
        self.record = record
        events.append("read")
        guard try read() == record else { throw ConnectorCredentialStoreError.verificationFailed }
    }

    func read() throws -> ConnectorCredentialRecord? { record }
    func delete() throws { record = nil }
    func compareAndSet(
        expected: ConnectorCredentialRecord?,
        replacement: ConnectorCredentialRecord?
    ) throws -> Bool {
        guard record == expected else { return false }
        if let replacement { try putAndVerify(replacement) } else { try delete() }
        return true
    }
}

private final class AuthorizationInstallationStore: ConnectorInstallationStoring {
    private var state: ConnectorInstallationState
    var failNextSet = false
    var failPhase: ConnectorRecoveryPhase?

    init(installationId: String) {
        state = ConnectorInstallationState(installationId: installationId, recoveryPhase: .none)
    }
    var installationId: String { state.installationId }
    var recoveryPhase: ConnectorRecoveryPhase { state.recoveryPhase }
    var stateSnapshot: ConnectorInstallationState { state }
    func setRecoveryPhase(_ phase: ConnectorRecoveryPhase) throws {
        var replacement = state
        replacement.recoveryPhase = phase
        guard try compareAndSet(expected: state, replacement: replacement) else {
            throw ConnectorInstallationStoreError.invalidState
        }
    }
    func compareAndSet(
        expected: ConnectorInstallationState,
        replacement: ConnectorInstallationState
    ) throws -> Bool {
        guard state == expected else { return false }
        if failNextSet || failPhase == replacement.recoveryPhase {
            failNextSet = false
            failPhase = nil
            throw ConnectorInstallationStoreError.invalidState
        }
        state = replacement
        return true
    }
}

private final class AuthorizationFixtureServer {
    private let queue = DispatchQueue(label: "authorization.fixture.server", attributes: .concurrent)
    private let descriptor: Int32
    private let lock = NSLock()
    private(set) var port: UInt16 = 0
    private(set) var redirects: [String] = []
    private(set) var challenges: [String] = []
    private(set) var activationCount = 0
    private(set) var disconnectCount = 0
    var activationAllowed: () -> Bool = { true }
    var rejectNextExchangeAsExpired = false
    var blockExchange = false
    let exchangeArrived = DispatchSemaphore(value: 0)
    let releaseExchange = DispatchSemaphore(value: 0)
    var failNextActivation = false
    var failAccountLookup = false
    var blockActivation = false
    let activationArrived = DispatchSemaphore(value: 0)
    let releaseActivation = DispatchSemaphore(value: 0)
    private var revoked = false

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
            queue.async { [weak self] in
                self?.handle(connection)
                Darwin.close(connection)
            }
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
            revoked = false
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
            let issued = credentialBody(state: "pending", includeCredential: true)
            if blockExchange {
                exchangeArrived.signal()
                _ = releaseExchange.wait(timeout: .now() + 5)
            }
            respond(connection, status: 200, body: issued)
        case "/api/hermes-authorizations/activate":
            precondition(activationAllowed())
            lock.lock()
            activationCount += 1
            let failActivation = failNextActivation
            failNextActivation = false
            lock.unlock()
            if failActivation { return }
            if blockActivation {
                activationArrived.signal()
                _ = releaseActivation.wait(timeout: .now() + 5)
            }
            respond(connection, status: 200, body: credentialBody(state: "active", includeCredential: false))
        case "/api/hermes-authorizations/disconnect":
            lock.lock()
            disconnectCount += 1
            revoked = true
            lock.unlock()
            respond(connection, status: 200, body: [
                "revoked": true,
                "credentialId": "55555555-5555-4555-8555-555555555555",
                "setupAttemptId": "44444444-4444-4444-8444-444444444444",
            ])
        case "/api/auth/me":
            if revoked {
                respond(connection, status: 401, body: ["error": "invalid_credential"])
            } else if failAccountLookup {
                respond(connection, status: 503, body: ["error": "unavailable"])
            } else {
                respond(connection, status: 200, body: ["user": ["name": "Fixture Owner"]])
            }
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

private func disconnectRequest(_ id: String) -> ConnectorRequest {
    ConnectorRequest(protocolVersion: 1, id: id, operation: .disconnect, payload: [:])
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
        let installationId = "11111111-1111-4111-8111-111111111111"

        func automaticBrowser(code: String) -> BrowserAuthorization {
            BrowserAuthorization(
                endpoints: endpoints,
                openBrowser: { url in
                    let query = Dictionary(uniqueKeysWithValues: URLComponents(
                        url: url, resolvingAgainstBaseURL: false
                    )!.queryItems!.map { ($0.name, $0.value!) })
                    precondition(url.path == "/hermes-authorize")
                    precondition(query["redirect_uri"]!.hasPrefix("http://127.0.0.1:"))
                    precondition(!query.values.contains(where: { $0.contains("idxh_") }))
                    let callback = URL(string: query["redirect_uri"]!)!
                    return sendRawCallback(
                        port: UInt16(callback.port!),
                        target: "/callback?state=\(query["state"]!)&code=\(code)",
                        host: "127.0.0.1:\(callback.port!)"
                    )
                }
            )
        }

        func runtime(
            store: FixtureCredentialStore,
            journal: AuthorizationInstallationStore,
            process: ConnectorProcessRecoveryState,
            browser: BrowserAuthorization
        ) -> ConnectorRuntime {
            ConnectorRuntime(
                endpoints: endpoints,
                installationStore: journal,
                credentialStore: store,
                http: http,
                authorization: browser,
                processRecovery: process
            )
        }

        func start(_ runtime: ConnectorRuntime, id: String) -> ConnectorResponse {
            runtime.handle(ConnectorRequest(
                protocolVersion: 1, id: id, operation: .authorizeStart, payload: [:]
            ))
        }

        func poll(_ runtime: ConnectorRuntime, id: String) -> ConnectorResponse {
            runtime.handle(ConnectorRequest(
                protocolVersion: 1, id: id, operation: .authorizePoll, payload: [:]
            ))
        }

        let keychainWriteBeforeActivation = "keychainWriteBeforeActivation"
        let store = FixtureCredentialStore()
        let journal = AuthorizationInstallationStore(installationId: installationId)
        server.activationAllowed = { store.record?.recoveryPhase == .activationRequested }
        let process = ConnectorProcessRecoveryState()
        let normalRuntime = runtime(
            store: store, journal: journal, process: process,
            browser: automaticBrowser(code: "authorization-code")
        )
        let startResponse = start(normalRuntime, id: "authorize-start-fixture")
        precondition(startResponse.result == .object(["status": .string("pending")]))
        let encodedStartText = String(
            decoding: try StrictConnectorEncoder.encode(startResponse), as: UTF8.self
        )
        for forbidden in ["authorizationUrl", "requestId", "state", "redirectUri", "redirect_uri"] {
            precondition(!encodedStartText.contains(forbidden))
        }
        let connected = poll(normalRuntime, id: "authorize-poll-fixture")
        guard case let .object(connectedResult)? = connected.result else { preconditionFailure() }
        precondition(connectedResult["status"] == .string("connected"))
        precondition(store.record?.activationState == "active")
        precondition(store.record?.accountLabel == "Fixture Owner")
        precondition(journal.recoveryPhase == .none && journal.stateSnapshot.authorizationAttemptId == nil)
        server.activationAllowed = { true }

        let activationOmittedAfterKeychainFailure = "activationOmittedAfterKeychainFailure"
        let failedStore = FixtureCredentialStore(); failedStore.failWrites = true
        let failedJournal = AuthorizationInstallationStore(installationId: installationId)
        let failedRuntime = runtime(
            store: failedStore,
            journal: failedJournal,
            process: ConnectorProcessRecoveryState(),
            browser: automaticBrowser(code: "pending-write-failure")
        )
        precondition(start(failedRuntime, id: "failed-start").success)
        let activationCountBeforeFailure = server.activationCount
        precondition(poll(failedRuntime, id: "failed-poll").result != nil)
        precondition(server.activationCount == activationCountBeforeFailure)

        server.rejectNextExchangeAsExpired = true
        let expiredRuntime = runtime(
            store: FixtureCredentialStore(),
            journal: AuthorizationInstallationStore(installationId: installationId),
            process: ConnectorProcessRecoveryState(),
            browser: automaticBrowser(code: "expired-code")
        )
        precondition(start(expiredRuntime, id: "expired-start").success)
        let repeatedExpiredPoll = "repeatedExpiredPoll"
        let expiredFirstPoll = poll(expiredRuntime, id: "expired-poll")
        guard case let .object(expiredResult)? = expiredFirstPoll.result else { preconditionFailure() }
        precondition(expiredResult["status"] == .string("failed"))
        let expiredRepeatedPoll = poll(expiredRuntime, id: "expired-poll-repeated")
        precondition(expiredRepeatedPoll.result == expiredFirstPoll.result)
        precondition(expiredRepeatedPoll.result != .object(["status": .string("pending")]))

        let activationTimeout = "activationTimeout"
        server.failNextActivation = true
        let timeoutStore = FixtureCredentialStore()
        let timeoutJournal = AuthorizationInstallationStore(installationId: installationId)
        let timeoutProcess = ConnectorProcessRecoveryState()
        let timeoutRuntime = runtime(
            store: timeoutStore, journal: timeoutJournal, process: timeoutProcess,
            browser: automaticBrowser(code: "activation-timeout")
        )
        precondition(start(timeoutRuntime, id: "timeout-start").success)
        let repeatedAmbiguousFailurePoll = "repeatedAmbiguousFailurePoll"
        let timeoutFirstPoll = poll(timeoutRuntime, id: "timeout-poll")
        let timeoutRepeatedPoll = poll(timeoutRuntime, id: "timeout-poll-repeated")
        precondition(timeoutRepeatedPoll.result == timeoutFirstPoll.result)
        guard case let .object(timeoutRepeatedResult)? = timeoutRepeatedPoll.result else {
            preconditionFailure()
        }
        precondition(timeoutRepeatedResult["status"] == .string("failed"))
        precondition(timeoutStore.record?.recoveryPhase == .activationRequested)
        precondition(timeoutJournal.recoveryPhase == .activationRequested)
        precondition(timeoutProcess.isRecoveryOnly)
        timeoutJournal.failNextSet = true
        precondition(timeoutRuntime.handle(disconnectRequest("timeout-cleanup-fault")).result == .object([
            "status": .string("recovery_only")
        ]))
        precondition(poll(timeoutRuntime, id: "timeout-poll-after-failed-cleanup").result == timeoutFirstPoll.result)
        precondition(timeoutRuntime.handle(disconnectRequest("timeout-cleanup")).result == .object([
            "status": .string("disconnected")
        ]))
        precondition(poll(timeoutRuntime, id: "timeout-poll-after-cleanup").result == .object([
            "status": .string("pending")
        ]))

        let activationRequestedJournalFailure = "activationRequestedJournalFailure"
        let activationJournalStore = FixtureCredentialStore()
        let activationJournal = AuthorizationInstallationStore(installationId: installationId)
        activationJournal.failPhase = .activationRequested
        let activationJournalProcess = ConnectorProcessRecoveryState()
        let activationJournalRuntime = runtime(
            store: activationJournalStore,
            journal: activationJournal,
            process: activationJournalProcess,
            browser: automaticBrowser(code: "activation-journal-failure")
        )
        precondition(start(activationJournalRuntime, id: "activation-journal-start").success)
        _ = poll(activationJournalRuntime, id: "activation-journal-poll")
        precondition(activationJournalStore.record?.recoveryPhase == .activationRequested)
        precondition(activationJournal.recoveryPhase == .none)
        precondition(activationJournalProcess.isRecoveryOnly)

        let accountLabelFailure = "accountLabelFailure"
        server.failAccountLookup = true
        let labelStore = FixtureCredentialStore()
        let labelJournal = AuthorizationInstallationStore(installationId: installationId)
        let labelProcess = ConnectorProcessRecoveryState()
        let labelRuntime = runtime(
            store: labelStore, journal: labelJournal, process: labelProcess,
            browser: automaticBrowser(code: "account-label-failure")
        )
        precondition(start(labelRuntime, id: "label-start").success)
        _ = poll(labelRuntime, id: "label-poll")
        precondition(labelStore.record?.activationState == "active")
        precondition(labelStore.record?.accountLabel == "")
        precondition(labelStore.record?.recoveryPhase == .none)
        precondition(labelJournal.recoveryPhase == .none && !labelProcess.isRecoveryOnly)
        server.failAccountLookup = false

        let activeKeychainWriteFailure = "activeKeychainWriteFailure"
        let activeStore = FixtureCredentialStore(); activeStore.failNextActiveWrite = true
        let activeJournal = AuthorizationInstallationStore(installationId: installationId)
        let activeProcess = ConnectorProcessRecoveryState()
        let activeRuntime = runtime(
            store: activeStore, journal: activeJournal, process: activeProcess,
            browser: automaticBrowser(code: "active-write-failure")
        )
        precondition(start(activeRuntime, id: "active-write-start").success)
        _ = poll(activeRuntime, id: "active-write-poll")
        precondition(activeStore.record?.activationState == "pending")
        precondition(activeStore.record?.recoveryPhase == .activationRequested)
        precondition(activeJournal.recoveryPhase == .activationRequested)
        precondition(activeProcess.isRecoveryOnly)

        let labelUpdateKeychainFailure = "labelUpdateKeychainFailure"
        let labelWriteStore = FixtureCredentialStore(); labelWriteStore.failNextLabelWrite = true
        let labelWriteJournal = AuthorizationInstallationStore(installationId: installationId)
        let labelWriteProcess = ConnectorProcessRecoveryState()
        let labelWriteRuntime = runtime(
            store: labelWriteStore, journal: labelWriteJournal, process: labelWriteProcess,
            browser: automaticBrowser(code: "label-write-failure")
        )
        precondition(start(labelWriteRuntime, id: "label-write-start").success)
        _ = poll(labelWriteRuntime, id: "label-write-poll")
        precondition(labelWriteStore.record?.activationState == "active")
        precondition(labelWriteStore.record?.accountLabel == "")
        precondition(labelWriteStore.record?.recoveryPhase == .none)

        let disconnectBeforeCallback = "disconnectBeforeCallback"
        var deferredURL: URL?
        let deferredBrowser = BrowserAuthorization(
            endpoints: endpoints,
            openBrowser: { url in deferredURL = url; return true }
        )
        let deferredStore = FixtureCredentialStore()
        let deferredJournal = AuthorizationInstallationStore(installationId: installationId)
        let deferredRuntime = runtime(
            store: deferredStore,
            journal: deferredJournal,
            process: ConnectorProcessRecoveryState(),
            browser: deferredBrowser
        )
        precondition(start(deferredRuntime, id: "deferred-start").success)
        precondition(deferredRuntime.handle(disconnectRequest("deferred-disconnect")).result == .object(["status": .string("disconnected")]))
        let deferredCallback = URLComponents(url: deferredURL!, resolvingAgainstBaseURL: false)!.queryItems!
        let deferredQuery = Dictionary(uniqueKeysWithValues: deferredCallback.map { ($0.name, $0.value!) })
        let deferredTarget = URL(string: deferredQuery["redirect_uri"]!)!
        precondition(!sendRawCallback(
            port: UInt16(deferredTarget.port!),
            target: "/callback?state=\(deferredQuery["state"]!)&code=late-code",
            host: "127.0.0.1:\(deferredTarget.port!)"
        ))
        precondition(deferredStore.record == nil)

        let callbackBeforeDisconnectBeforePoll = "callbackBeforeDisconnectBeforePoll"
        let callbackStore = FixtureCredentialStore()
        let callbackJournal = AuthorizationInstallationStore(installationId: installationId)
        let callbackRuntime = runtime(
            store: callbackStore,
            journal: callbackJournal,
            process: ConnectorProcessRecoveryState(),
            browser: automaticBrowser(code: "callback-before-disconnect")
        )
        precondition(start(callbackRuntime, id: "callback-start").success)
        precondition(callbackRuntime.handle(disconnectRequest("callback-disconnect")).result == .object(["status": .string("disconnected")]))
        _ = poll(callbackRuntime, id: "stale-callback-poll")
        precondition(callbackStore.record == nil && callbackJournal.recoveryPhase == .none)

        let disconnectWhileExchangeBlocked = "disconnectWhileExchangeBlocked"
        server.blockExchange = true
        let exchangeStore = FixtureCredentialStore()
        let exchangeJournal = AuthorizationInstallationStore(installationId: installationId)
        let exchangeProcess = ConnectorProcessRecoveryState()
        let exchangeRuntime = runtime(
            store: exchangeStore,
            journal: exchangeJournal,
            process: exchangeProcess,
            browser: automaticBrowser(code: "blocked-exchange")
        )
        precondition(start(exchangeRuntime, id: "exchange-start").success)
        let exchangePollFinished = DispatchSemaphore(value: 0)
        let activationCountBeforeExchangeRace = server.activationCount
        DispatchQueue.global().async {
            let response = poll(exchangeRuntime, id: "exchange-poll")
            guard case let .object(result)? = response.result else { preconditionFailure() }
            precondition(result["status"] == .string("failed"))
            exchangePollFinished.signal()
        }
        precondition(server.exchangeArrived.wait(timeout: .now() + 3) == .success)
        let exchangeDisconnect = exchangeRuntime.handle(disconnectRequest("exchange-disconnect"))
        precondition(exchangeDisconnect.result == .object(["status": .string("recovery_only")]))
        precondition(exchangeStore.record == nil)
        precondition(exchangeJournal.recoveryPhase == .activationRequested)
        server.releaseExchange.signal()
        precondition(exchangePollFinished.wait(timeout: .now() + 3) == .success)
        server.blockExchange = false
        // The newer disconnect epoch remains authoritative. The stale exchange
        // credential is revoked directly and is never installed in Keychain.
        precondition(exchangeStore.record == nil)
        precondition(exchangeJournal.recoveryPhase == .none)
        precondition(!exchangeProcess.isRecoveryOnly)
        precondition(server.activationCount == activationCountBeforeExchangeRace)
        guard case let .object(exchangeStatus)? = exchangeRuntime.handle(ConnectorRequest(
            protocolVersion: 1, id: "exchange-status", operation: .status, payload: [:]
        )).result else { preconditionFailure() }
        precondition(exchangeStatus["health"] == .string("disconnected"))
        let disconnectCountBeforeExchangeCleanup = server.disconnectCount
        precondition(exchangeRuntime.handle(disconnectRequest("exchange-cleanup")).result == .object([
            "status": .string("disconnected")
        ]))
        precondition(server.disconnectCount == disconnectCountBeforeExchangeCleanup)
        precondition(exchangeStore.record == nil && exchangeJournal.recoveryPhase == .none)

        let disconnectWhileActivationBlocked = "disconnectWhileActivationBlocked"
        server.blockActivation = true
        let blockedStore = FixtureCredentialStore()
        let blockedJournal = AuthorizationInstallationStore(installationId: installationId)
        let blockedProcess = ConnectorProcessRecoveryState()
        let blockedRuntime = runtime(
            store: blockedStore,
            journal: blockedJournal,
            process: blockedProcess,
            browser: automaticBrowser(code: "blocked-activation")
        )
        precondition(start(blockedRuntime, id: "blocked-start").success)
        let pollFinished = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            _ = poll(blockedRuntime, id: "blocked-poll")
            pollFinished.signal()
        }
        precondition(server.activationArrived.wait(timeout: .now() + 3) == .success)
        let blockedDisconnect = blockedRuntime.handle(disconnectRequest("blocked-disconnect"))
        precondition(blockedDisconnect.result == .object(["status": .string("recovery_only")]))
        let staleStart = start(blockedRuntime, id: "stale-restart")
        precondition(staleStart.error?.code == "recovery_only")
        server.releaseActivation.signal()
        precondition(pollFinished.wait(timeout: .now() + 3) == .success)
        precondition(blockedStore.record == nil)
        precondition(blockedJournal.recoveryPhase.confirmsServerRevocation)
        precondition(blockedRuntime.handle(disconnectRequest("blocked-cleanup")).result == .object(["status": .string("disconnected")]))
        precondition(blockedStore.record == nil && blockedJournal.recoveryPhase == .none)

        precondition([
            keychainWriteBeforeActivation, activationOmittedAfterKeychainFailure,
            repeatedExpiredPoll, activationTimeout, repeatedAmbiguousFailurePoll,
            activationRequestedJournalFailure, accountLabelFailure,
            activeKeychainWriteFailure, labelUpdateKeychainFailure,
            disconnectBeforeCallback, callbackBeforeDisconnectBeforePoll,
            disconnectWhileExchangeBlocked, disconnectWhileActivationBlocked,
        ].allSatisfy { !$0.isEmpty })
        print("Authorization fixture passed")
    }
}
