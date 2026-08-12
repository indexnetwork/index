import CryptoKit
import Darwin
import Foundation

private final class FixtureCredentialStore: ConnectorCredentialStoring {
    var record: ConnectorCredentialRecord?
    var recoveryRecord: ConnectorCredentialRecord?
    var events: [String] = []
    var failWrites = false
    var failNextActiveWrite = false
    var failNextLabelWrite = false
    var failNextRecoveryWrite = false
    var failNextRecoveryDeletion = false
    var failNextRecoveryRead = false
    private(set) var primaryMutationCount = 0
    private(set) var recoveryMutationCount = 0

    func putAndVerify(_ record: ConnectorCredentialRecord) throws {
        primaryMutationCount += 1
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
    func delete() throws {
        primaryMutationCount += 1
        record = nil
    }
    func compareAndSet(
        expected: ConnectorCredentialRecord?,
        replacement: ConnectorCredentialRecord?
    ) throws -> Bool {
        guard record == expected else { return false }
        if let replacement { try putAndVerify(replacement) } else { try delete() }
        return true
    }
    func putRecoveryAndVerify(_ record: ConnectorCredentialRecord) throws {
        recoveryMutationCount += 1
        if failNextRecoveryWrite {
            failNextRecoveryWrite = false
            throw ConnectorCredentialStoreError.verificationFailed
        }
        recoveryRecord = record
        guard try readRecovery() == record else { throw ConnectorCredentialStoreError.verificationFailed }
    }
    func readRecovery() throws -> ConnectorCredentialRecord? {
        if failNextRecoveryRead {
            failNextRecoveryRead = false
            throw ConnectorCredentialStoreError.verificationFailed
        }
        return recoveryRecord
    }
    func compareAndSetRecovery(
        expected: ConnectorCredentialRecord?, replacement: ConnectorCredentialRecord?
    ) throws -> Bool {
        recoveryMutationCount += 1
        guard recoveryRecord == expected else { return false }
        if replacement == nil && failNextRecoveryDeletion {
            failNextRecoveryDeletion = false
            throw ConnectorCredentialStoreError.verificationFailed
        }
        recoveryRecord = replacement
        return recoveryRecord == replacement
    }
}

private final class AuthorizationInstallationStore: ConnectorInstallationStoring {
    private var state: ConnectorInstallationState
    var failNextSet = false
    var failPhase: ConnectorRecoveryPhase?
    private(set) var compareAndSetCount = 0

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
        compareAndSetCount += 1
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
    private(set) var probeCount = 0
    var activationAllowed: () -> Bool = { true }
    var rejectNextExchangeAsExpired = false
    var blockExchange = false
    var failNextDisconnect = false
    var mismatchNextDisconnectReceipt = false
    var blockDisconnect = false
    var failNextProbe = false
    var blockProbe = false
    let disconnectArrived = DispatchSemaphore(value: 0)
    let releaseDisconnect = DispatchSemaphore(value: 0)
    let probeArrived = DispatchSemaphore(value: 0)
    let releaseProbe = DispatchSemaphore(value: 0)
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
            let shouldBlock = blockDisconnect
            lock.unlock()
            if shouldBlock {
                disconnectArrived.signal()
                _ = releaseDisconnect.wait(timeout: .now() + 5)
            }
            lock.lock()
            let fail = failNextDisconnect
            failNextDisconnect = false
            let mismatch = mismatchNextDisconnectReceipt
            mismatchNextDisconnectReceipt = false
            if !fail { revoked = true }
            lock.unlock()
            if fail {
                respond(connection, status: 503, body: ["error": "uncertain"])
            } else {
                respond(connection, status: 200, body: [
                    "revoked": true,
                    "credentialId": mismatch
                        ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                        : "55555555-5555-4555-8555-555555555555",
                    "setupAttemptId": "44444444-4444-4444-8444-444444444444",
                ])
            }
        case "/api/auth/me":
            lock.lock()
            probeCount += 1
            let shouldBlock = blockProbe
            lock.unlock()
            if shouldBlock {
                probeArrived.signal()
                _ = releaseProbe.wait(timeout: .now() + 5)
            }
            lock.lock()
            let failProbe = failNextProbe
            failNextProbe = false
            let isRevoked = revoked
            lock.unlock()
            if failProbe {
                respond(connection, status: 503, body: ["error": "unavailable"])
            } else if isRevoked {
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
        let legacyRecoveryPhase = try JSONDecoder().decode(
            ConnectorRecoveryPhase.self, from: Data(#""revocation_requested""#.utf8)
        )
        precondition(legacyRecoveryPhase == .revocationRequested)
        let encodedRecoveryPhase = try JSONEncoder().encode(ConnectorRecoveryPhase.revocationRequested)
        precondition(String(decoding: encodedRecoveryPhase, as: UTF8.self) == #""revocation_pending""#)
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

        func issuedRecovery(
            phase: ConnectorRecoveryPhase,
            epoch: UInt64,
            installation: String? = nil,
            credentialId: String = "55555555-5555-4555-8555-555555555555"
        ) -> ConnectorCredentialRecord {
            ConnectorCredentialRecord(
                rawCredential: "idxh_fixture-credential", audience: "hermes-agent",
                agentId: "22222222-2222-4222-8222-222222222222",
                installationId: installation ?? installationId,
                setupAttemptId: "44444444-4444-4444-8444-444444444444",
                credentialId: credentialId,
                actions: BrowserAuthorization.canonicalActions,
                expiresAt: Date(timeIntervalSinceNow: 3600), activationState: "pending",
                accountLabel: "", recoveryPhase: phase,
                authorizationAttemptId: nil, operationEpoch: epoch
            )
        }

        func seedJournal(
            _ journal: AuthorizationInstallationStore,
            phase: ConnectorRecoveryPhase,
            epoch: UInt64
        ) {
            let current = journal.stateSnapshot
            var replacement = current
            replacement.authorizationAttemptId = nil
            replacement.recoveryPhase = phase
            replacement.operationEpoch = epoch
            precondition((try? journal.compareAndSet(expected: current, replacement: replacement)) == true)
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
        precondition(activationJournalStore.record == nil)
        precondition(activationJournalStore.recoveryRecord?.recoveryPhase == .revocationRequested)
        precondition(activationJournal.recoveryPhase == .revocationRequested)
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
        precondition(labelStore.record?.recoveryPhase == ConnectorRecoveryPhase.none)
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
        precondition(labelWriteStore.record?.recoveryPhase == ConnectorRecoveryPhase.none)

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

        let recoveryReadErrorWithoutAttempt = "recoveryReadErrorWithoutAttempt"
        let readErrorIdleStore = FixtureCredentialStore()
        let readErrorIdleJournal = AuthorizationInstallationStore(installationId: installationId)
        let readErrorIdleProcess = ConnectorProcessRecoveryState()
        let readErrorIdleRuntime = runtime(
            store: readErrorIdleStore, journal: readErrorIdleJournal,
            process: readErrorIdleProcess, browser: automaticBrowser(code: "unused")
        )
        let idleDisconnectCount = server.disconnectCount
        let idleProbeCount = server.probeCount
        readErrorIdleStore.failNextRecoveryRead = true
        precondition(readErrorIdleRuntime.handle(disconnectRequest("recovery-read-error-idle")).result
            == .object(["status": .string("recovery_only")]))
        precondition(readErrorIdleJournal.stateSnapshot.authorizationAttemptId == nil)
        precondition(readErrorIdleJournal.stateSnapshot.operationEpoch == 1)
        precondition(readErrorIdleJournal.recoveryPhase == .activationRequested)
        precondition(readErrorIdleStore.record == nil && readErrorIdleStore.recoveryRecord == nil)
        precondition(server.disconnectCount == idleDisconnectCount)
        precondition(server.probeCount == idleProbeCount)
        precondition(readErrorIdleProcess.isRecoveryOnly)

        let recoveryReadErrorPreservesProof = "recoveryReadErrorPreservesProof"
        let proofErrorStore = FixtureCredentialStore()
        let proofErrorJournal = AuthorizationInstallationStore(installationId: installationId)
        seedJournal(proofErrorJournal, phase: .serverReceiptConfirmed, epoch: 5)
        let proofErrorRuntime = runtime(
            store: proofErrorStore, journal: proofErrorJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        proofErrorStore.failNextRecoveryRead = true
        precondition(proofErrorRuntime.handle(disconnectRequest("recovery-read-error-proof")).result
            == .object(["status": .string("recovery_only")]))
        precondition(proofErrorJournal.stateSnapshot.operationEpoch == 6)
        precondition(proofErrorJournal.recoveryPhase == .serverReceiptConfirmed)
        precondition(proofErrorJournal.stateSnapshot.authorizationAttemptId == nil)
        precondition(server.disconnectCount == idleDisconnectCount)
        precondition(server.probeCount == idleProbeCount)

        let recoveryReadErrorDuringExchange = "recoveryReadErrorDuringExchange"
        server.blockExchange = true
        let readErrorStore = FixtureCredentialStore()
        let readErrorJournal = AuthorizationInstallationStore(installationId: installationId)
        let readErrorProcess = ConnectorProcessRecoveryState()
        let readErrorRuntime = runtime(
            store: readErrorStore, journal: readErrorJournal, process: readErrorProcess,
            browser: automaticBrowser(code: "read-error-exchange")
        )
        precondition(start(readErrorRuntime, id: "read-error-start").success)
        let readErrorPollFinished = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            _ = poll(readErrorRuntime, id: "read-error-poll")
            readErrorPollFinished.signal()
        }
        precondition(server.exchangeArrived.wait(timeout: .now() + 3) == .success)
        let readErrorEntryJournal = readErrorJournal.stateSnapshot
        let activationBeforeReadError = server.activationCount
        let disconnectBeforeReadError = server.disconnectCount
        let probesBeforeReadError = server.probeCount
        readErrorStore.failNextRecoveryRead = true
        precondition(readErrorRuntime.handle(disconnectRequest("read-error-disconnect")).result
            == .object(["status": .string("recovery_only")]))
        precondition(readErrorJournal.stateSnapshot.authorizationAttemptId == nil)
        precondition(readErrorJournal.stateSnapshot.operationEpoch == readErrorEntryJournal.operationEpoch + 1)
        precondition(readErrorJournal.recoveryPhase == .activationRequested)
        precondition(start(readErrorRuntime, id: "read-error-restart-blocked").error?.code == "recovery_only")
        precondition(readErrorStore.record == nil)
        server.failNextDisconnect = true
        server.releaseExchange.signal()
        precondition(readErrorPollFinished.wait(timeout: .now() + 3) == .success)
        server.blockExchange = false
        precondition(server.activationCount == activationBeforeReadError)
        precondition(server.disconnectCount == disconnectBeforeReadError + 1)
        precondition(server.probeCount == probesBeforeReadError)
        precondition(readErrorStore.record == nil)
        precondition(readErrorStore.recoveryRecord?.rawCredential == "idxh_fixture-credential")
        precondition(readErrorStore.recoveryRecord?.recoveryPhase == .revocationRequested)
        precondition(readErrorJournal.recoveryPhase == .revocationRequested)
        guard case let .object(readErrorStatus)? = readErrorRuntime.handle(ConnectorRequest(
            protocolVersion: 1, id: "read-error-status", operation: .status, payload: [:]
        )).result else { preconditionFailure() }
        precondition(readErrorStatus["connected"] == .bool(false))
        precondition(readErrorStatus["health"] == .string("recovery_only"))

        let recoveryReadErrorCASFailureRace = "recoveryReadErrorCASFailureRace"
        server.blockExchange = true
        let readErrorRaceStore = FixtureCredentialStore()
        let readErrorRaceJournal = AuthorizationInstallationStore(installationId: installationId)
        let readErrorRaceProcess = ConnectorProcessRecoveryState()
        let readErrorRaceRuntime = runtime(
            store: readErrorRaceStore, journal: readErrorRaceJournal,
            process: readErrorRaceProcess, browser: automaticBrowser(code: "read-error-race")
        )
        precondition(start(readErrorRaceRuntime, id: "read-error-race-start").success)
        let readErrorRacePollFinished = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            _ = poll(readErrorRaceRuntime, id: "read-error-race-poll")
            readErrorRacePollFinished.signal()
        }
        precondition(server.exchangeArrived.wait(timeout: .now() + 3) == .success)
        let readErrorRaceEntryJournal = readErrorRaceJournal.stateSnapshot
        let activationBeforeReadErrorRace = server.activationCount
        let disconnectBeforeReadErrorRace = server.disconnectCount
        let probesBeforeReadErrorRace = server.probeCount
        readErrorRaceStore.failNextRecoveryRead = true
        readErrorRaceJournal.failNextSet = true
        precondition(readErrorRaceRuntime.handle(disconnectRequest("read-error-race-disconnect")).result
            == .object(["status": .string("recovery_only")]))
        precondition(readErrorRaceJournal.stateSnapshot == readErrorRaceEntryJournal)
        precondition(readErrorRaceProcess.isRecoveryOnly)
        precondition(start(readErrorRaceRuntime, id: "read-error-race-restart-blocked").error?.code
            == "recovery_only")
        server.releaseExchange.signal()
        precondition(readErrorRacePollFinished.wait(timeout: .now() + 3) == .success)
        server.blockExchange = false
        precondition(server.activationCount == activationBeforeReadErrorRace)
        precondition(server.disconnectCount == disconnectBeforeReadErrorRace)
        precondition(server.probeCount == probesBeforeReadErrorRace)
        precondition(readErrorRaceStore.record == nil)
        precondition(readErrorRaceStore.recoveryRecord?.rawCredential == "idxh_fixture-credential")
        precondition(readErrorRaceStore.recoveryRecord?.recoveryPhase == .revocationRequested)
        precondition(readErrorRaceJournal.stateSnapshot.authorizationAttemptId == nil)
        precondition(readErrorRaceJournal.recoveryPhase == .revocationRequested)

        func beginStaleExchange(
            suffix: String,
            store: FixtureCredentialStore,
            journal: AuthorizationInstallationStore,
            process: ConnectorProcessRecoveryState
        ) -> (ConnectorRuntime, DispatchSemaphore) {
            server.blockExchange = true
            let candidate = runtime(
                store: store, journal: journal, process: process,
                browser: automaticBrowser(code: "stale-\(suffix)")
            )
            precondition(start(candidate, id: "stale-start-\(suffix)").success)
            let finished = DispatchSemaphore(value: 0)
            DispatchQueue.global().async {
                _ = poll(candidate, id: "stale-poll-\(suffix)")
                finished.signal()
            }
            precondition(server.exchangeArrived.wait(timeout: .now() + 3) == .success)
            precondition(candidate.handle(disconnectRequest("stale-disconnect-\(suffix)")).result
                == .object(["status": .string("recovery_only")]))
            return (candidate, finished)
        }

        let staleIssuedPreparationFailureNoNetwork = "staleIssuedPreparationFailureNoNetwork"
        let preparationStore = FixtureCredentialStore()
        preparationStore.failNextRecoveryWrite = true
        let preparationJournal = AuthorizationInstallationStore(installationId: installationId)
        let preparationProcess = ConnectorProcessRecoveryState()
        let (_, preparationFinished) = beginStaleExchange(
            suffix: "preparation-failure", store: preparationStore,
            journal: preparationJournal, process: preparationProcess
        )
        let disconnectsBeforePreparationFailure = server.disconnectCount
        server.releaseExchange.signal()
        precondition(preparationFinished.wait(timeout: .now() + 3) == .success)
        server.blockExchange = false
        precondition(server.disconnectCount == disconnectsBeforePreparationFailure)
        precondition(preparationStore.recoveryRecord == nil)
        precondition(preparationJournal.recoveryPhase == .activationRequested)
        precondition(preparationProcess.isRecoveryOnly)

        let staleIssuedJournalPreparationFailureNoNetwork = "staleIssuedJournalPreparationFailureNoNetwork"
        let journalPreparationStore = FixtureCredentialStore()
        let journalPreparationJournal = AuthorizationInstallationStore(installationId: installationId)
        let journalPreparationProcess = ConnectorProcessRecoveryState()
        let (_, journalPreparationFinished) = beginStaleExchange(
            suffix: "journal-preparation-failure", store: journalPreparationStore,
            journal: journalPreparationJournal, process: journalPreparationProcess
        )
        journalPreparationJournal.failPhase = .revocationRequested
        let disconnectsBeforeJournalPreparationFailure = server.disconnectCount
        server.releaseExchange.signal()
        precondition(journalPreparationFinished.wait(timeout: .now() + 3) == .success)
        server.blockExchange = false
        precondition(server.disconnectCount == disconnectsBeforeJournalPreparationFailure)
        precondition(journalPreparationStore.recoveryRecord?.recoveryPhase == .revocationRequested)
        precondition(journalPreparationJournal.recoveryPhase == .activationRequested)
        let journalPreparationRestart = runtime(
            store: journalPreparationStore, journal: journalPreparationJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        precondition(journalPreparationRestart.handle(disconnectRequest("journal-preparation-final")).result
            == .object(["status": .string("disconnected")]))

        let staleIssuedReceiptIdentityMismatch = "staleIssuedReceiptIdentityMismatch"
        let receiptMismatchStore = FixtureCredentialStore()
        let receiptMismatchJournal = AuthorizationInstallationStore(installationId: installationId)
        let receiptMismatchProcess = ConnectorProcessRecoveryState()
        let (_, receiptMismatchFinished) = beginStaleExchange(
            suffix: "receipt-identity-mismatch", store: receiptMismatchStore,
            journal: receiptMismatchJournal, process: receiptMismatchProcess
        )
        let probesBeforeReceiptMismatch = server.probeCount
        server.mismatchNextDisconnectReceipt = true
        server.releaseExchange.signal()
        precondition(receiptMismatchFinished.wait(timeout: .now() + 3) == .success)
        server.blockExchange = false
        precondition(receiptMismatchStore.recoveryRecord?.recoveryPhase == .revocationRequested)
        precondition(receiptMismatchJournal.recoveryPhase == .revocationRequested)
        precondition(server.probeCount == probesBeforeReceiptMismatch)
        let receiptMismatchRestart = runtime(
            store: receiptMismatchStore, journal: receiptMismatchJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        precondition(receiptMismatchRestart.handle(disconnectRequest("receipt-mismatch-final")).result
            == .object(["status": .string("disconnected")]))

        let staleIssuedPreparedBeforeRevoke = "staleIssuedPreparedBeforeRevoke"
        let revokeStore = FixtureCredentialStore()
        let revokeJournal = AuthorizationInstallationStore(installationId: installationId)
        let revokeProcess = ConnectorProcessRecoveryState()
        let (_, revokeFinished) = beginStaleExchange(
            suffix: "blocked-revoke", store: revokeStore,
            journal: revokeJournal, process: revokeProcess
        )
        server.blockDisconnect = true
        server.releaseExchange.signal()
        precondition(server.disconnectArrived.wait(timeout: .now() + 3) == .success)
        precondition(revokeStore.recoveryRecord?.recoveryPhase == .revocationRequested)
        precondition(revokeJournal.recoveryPhase == .revocationRequested)
        precondition(revokeStore.recoveryRecord?.rawCredential == "idxh_fixture-credential")
        server.failNextDisconnect = true
        server.blockDisconnect = false
        server.releaseDisconnect.signal()
        precondition(revokeFinished.wait(timeout: .now() + 3) == .success)
        server.blockExchange = false
        let requestedEpoch = revokeJournal.stateSnapshot.operationEpoch
        let requestedRestart = runtime(
            store: revokeStore, journal: revokeJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        server.failNextDisconnect = true
        precondition(requestedRestart.handle(disconnectRequest("requested-adoption")).result
            == .object(["status": .string("recovery_only")]))
        precondition(revokeStore.recoveryRecord?.recoveryPhase == .revocationRequested)
        precondition(revokeStore.recoveryRecord?.operationEpoch == requestedEpoch + 1)
        precondition(revokeJournal.recoveryPhase == .revocationRequested)
        let requestedFinalRestart = runtime(
            store: revokeStore, journal: revokeJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        precondition(requestedFinalRestart.handle(disconnectRequest("requested-final")).result
            == .object(["status": .string("disconnected")]))
        precondition(revokeStore.recoveryRecord == nil && revokeJournal.recoveryPhase == .none)

        let staleIssuedReceiptBeforeProbe = "staleIssuedReceiptBeforeProbe"
        let probeFailureAfterReceiptRestart = "probeFailureAfterReceiptRestart"
        let receiptStore = FixtureCredentialStore()
        let receiptJournal = AuthorizationInstallationStore(installationId: installationId)
        let receiptProcess = ConnectorProcessRecoveryState()
        let (_, receiptFinished) = beginStaleExchange(
            suffix: "blocked-probe", store: receiptStore,
            journal: receiptJournal, process: receiptProcess
        )
        server.blockProbe = true
        server.releaseExchange.signal()
        precondition(server.probeArrived.wait(timeout: .now() + 3) == .success)
        precondition(receiptStore.recoveryRecord?.recoveryPhase == .serverReceiptConfirmed)
        precondition(receiptJournal.recoveryPhase == .serverReceiptConfirmed)
        server.failNextProbe = true
        server.blockProbe = false
        server.releaseProbe.signal()
        precondition(receiptFinished.wait(timeout: .now() + 3) == .success)
        server.blockExchange = false
        let receiptDisconnectCount = server.disconnectCount
        let receiptEpoch = receiptJournal.stateSnapshot.operationEpoch
        let receiptRestart = runtime(
            store: receiptStore, journal: receiptJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        server.failNextProbe = true
        precondition(receiptRestart.handle(disconnectRequest("receipt-adoption")).result
            == .object(["status": .string("recovery_only")]))
        precondition(server.disconnectCount == receiptDisconnectCount)
        precondition(receiptStore.recoveryRecord?.recoveryPhase == .serverReceiptConfirmed)
        precondition(receiptStore.recoveryRecord?.operationEpoch == receiptEpoch + 1)
        let receiptFinalRestart = runtime(
            store: receiptStore, journal: receiptJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        precondition(receiptFinalRestart.handle(disconnectRequest("receipt-final")).result
            == .object(["status": .string("disconnected")]))
        precondition(server.disconnectCount == receiptDisconnectCount)
        precondition(receiptStore.recoveryRecord == nil && receiptJournal.recoveryPhase == .none)

        let recoveryDeletionFailureAfterProbe = "recoveryDeletionFailureAfterProbe"
        let deletionStore = FixtureCredentialStore()
        deletionStore.failNextRecoveryDeletion = true
        let deletionJournal = AuthorizationInstallationStore(installationId: installationId)
        let deletionProcess = ConnectorProcessRecoveryState()
        let (_, deletionFinished) = beginStaleExchange(
            suffix: "deletion-failure", store: deletionStore,
            journal: deletionJournal, process: deletionProcess
        )
        server.releaseExchange.signal()
        precondition(deletionFinished.wait(timeout: .now() + 3) == .success)
        server.blockExchange = false
        precondition(deletionStore.recoveryRecord?.recoveryPhase == .revocationProbeConfirmed)
        precondition(deletionJournal.recoveryPhase == .revocationProbeConfirmed)
        let deletionDisconnectCount = server.disconnectCount
        let deletionProbeCount = server.probeCount
        let deletionEpoch = deletionJournal.stateSnapshot.operationEpoch
        deletionStore.failNextRecoveryDeletion = true
        let deletionRestart = runtime(
            store: deletionStore, journal: deletionJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        precondition(deletionRestart.handle(disconnectRequest("probe-adoption")).result
            == .object(["status": .string("recovery_only")]))
        precondition(deletionStore.recoveryRecord?.recoveryPhase == .revocationProbeConfirmed)
        precondition(deletionStore.recoveryRecord?.operationEpoch == deletionEpoch + 1)
        precondition(server.disconnectCount == deletionDisconnectCount)
        precondition(server.probeCount == deletionProbeCount)
        let deletionFinalRestart = runtime(
            store: deletionStore, journal: deletionJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        precondition(deletionFinalRestart.handle(disconnectRequest("probe-final")).result
            == .object(["status": .string("disconnected")]))
        precondition(server.disconnectCount == deletionDisconnectCount)
        precondition(server.probeCount == deletionProbeCount)
        precondition(deletionStore.recoveryRecord == nil && deletionJournal.recoveryPhase == .none)

        let immediateJournalClearFailureAfterProbe = "immediateJournalClearFailureAfterProbe"
        let clearStore = FixtureCredentialStore()
        let clearNewerPrimary = ConnectorCredentialRecord(
            rawCredential: "idxh_clear-newer-fixture", audience: "hermes-agent",
            agentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            installationId: installationId,
            setupAttemptId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            credentialId: "abababab-abab-4bab-8bab-abababababab",
            actions: BrowserAuthorization.canonicalActions,
            expiresAt: Date(timeIntervalSinceNow: 3600), activationState: "active",
            accountLabel: "Newer After Clear", recoveryPhase: .none,
            authorizationAttemptId: nil, operationEpoch: 1
        )
        let primaryEncoder = JSONEncoder()
        primaryEncoder.outputFormatting = [.sortedKeys]
        let clearNewerPrimaryBytes = try primaryEncoder.encode(clearNewerPrimary)
        let clearJournal = AuthorizationInstallationStore(installationId: installationId)
        let clearProcess = ConnectorProcessRecoveryState()
        let (_, clearFinished) = beginStaleExchange(
            suffix: "journal-clear-failure", store: clearStore,
            journal: clearJournal, process: clearProcess
        )
        clearStore.record = clearNewerPrimary
        clearJournal.failPhase = ConnectorRecoveryPhase.none
        server.releaseExchange.signal()
        precondition(clearFinished.wait(timeout: .now() + 3) == .success)
        server.blockExchange = false
        precondition(clearStore.recoveryRecord == nil)
        precondition(clearStore.record == clearNewerPrimary)
        precondition(clearJournal.recoveryPhase == .revocationProbeConfirmed)
        let clearDisconnectCount = server.disconnectCount
        let clearProbeCount = server.probeCount
        let clearRestart = runtime(
            store: clearStore, journal: clearJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        precondition(clearRestart.handle(disconnectRequest("clear-final")).result
            == .object(["status": .string("connected")]))
        precondition(server.disconnectCount == clearDisconnectCount)
        precondition(server.probeCount == clearProbeCount)
        precondition(clearJournal.recoveryPhase == .none)
        precondition(clearStore.record == clearNewerPrimary)
        guard let retainedClearPrimary = clearStore.record else { preconditionFailure() }
        let retainedClearPrimaryBytes = try primaryEncoder.encode(retainedClearPrimary)
        precondition(retainedClearPrimaryBytes == clearNewerPrimaryBytes)
        guard case let .object(clearConnectedStatus)? = clearRestart.handle(ConnectorRequest(
            protocolVersion: 1, id: "clear-connected-status", operation: .status, payload: [:]
        )).result else { preconditionFailure() }
        precondition(clearConnectedStatus["connected"] == .bool(true))
        precondition(clearConnectedStatus["health"] == .string("active"))
        precondition(clearConnectedStatus["agentId"] == .string(clearNewerPrimary.agentId))
        precondition(clearConnectedStatus["setupAttemptId"] == .string(clearNewerPrimary.setupAttemptId))
        precondition(server.disconnectCount == clearDisconnectCount)
        precondition(server.probeCount == clearProbeCount)

        let recoveryIdentityGenerationMismatch = "recoveryIdentityGenerationMismatch"
        let futureRecoveryBoundaryFence = "futureRecoveryBoundaryFence"
        for invalidRecovery in [
            issuedRecovery(phase: .revocationRequested, epoch: 31),
            issuedRecovery(phase: .revocationRequested, epoch: 99),
            issuedRecovery(
                phase: .revocationRequested, epoch: 30,
                installation: "99999999-9999-4999-8999-999999999999"
            ),
        ] {
            let mismatchStore = FixtureCredentialStore()
            mismatchStore.record = clearNewerPrimary
            mismatchStore.recoveryRecord = invalidRecovery
            let mismatchJournal = AuthorizationInstallationStore(installationId: installationId)
            seedJournal(mismatchJournal, phase: .revocationRequested, epoch: 30)
            let entryJournal = mismatchJournal.stateSnapshot
            let journalCASCount = mismatchJournal.compareAndSetCount
            let primaryMutationCount = mismatchStore.primaryMutationCount
            let recoveryMutationCount = mismatchStore.recoveryMutationCount
            let mismatchDisconnectCount = server.disconnectCount
            let mismatchProbeCount = server.probeCount
            let mismatchProcess = ConnectorProcessRecoveryState()
            let mismatchRuntime = runtime(
                store: mismatchStore, journal: mismatchJournal,
                process: mismatchProcess, browser: automaticBrowser(code: "unused")
            )
            precondition(mismatchRuntime.handle(disconnectRequest("identity-generation-mismatch")).result
                == .object(["status": .string("recovery_only")]))
            precondition(mismatchJournal.stateSnapshot == entryJournal)
            precondition(mismatchJournal.compareAndSetCount == journalCASCount)
            precondition(mismatchStore.record == clearNewerPrimary)
            precondition(mismatchStore.recoveryRecord == invalidRecovery)
            precondition(mismatchStore.primaryMutationCount == primaryMutationCount)
            precondition(mismatchStore.recoveryMutationCount == recoveryMutationCount)
            precondition(!mismatchProcess.isRecoveryOnly)
            precondition(server.disconnectCount == mismatchDisconnectCount)
            precondition(server.probeCount == mismatchProbeCount)
        }

        let legitimateRecoveryEpochAdoption = "legitimateRecoveryEpochAdoption"
        let adoptionStore = FixtureCredentialStore()
        adoptionStore.recoveryRecord = issuedRecovery(phase: .revocationRequested, epoch: 30)
        let adoptionJournal = AuthorizationInstallationStore(installationId: installationId)
        seedJournal(adoptionJournal, phase: .revocationRequested, epoch: 30)
        let adoptionRuntime = runtime(
            store: adoptionStore, journal: adoptionJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        server.failNextDisconnect = true
        precondition(adoptionRuntime.handle(disconnectRequest("legitimate-epoch-adoption")).result
            == .object(["status": .string("recovery_only")]))
        precondition(adoptionJournal.stateSnapshot.operationEpoch == 31)
        precondition(adoptionJournal.recoveryPhase == .revocationRequested)
        precondition(adoptionStore.recoveryRecord?.operationEpoch == 31)
        precondition(adoptionStore.recoveryRecord?.recoveryPhase == .revocationRequested)
        let adoptionFinalRuntime = runtime(
            store: adoptionStore, journal: adoptionJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        precondition(adoptionFinalRuntime.handle(disconnectRequest("legitimate-epoch-final")).result
            == .object(["status": .string("disconnected")]))
        precondition(adoptionStore.recoveryRecord == nil && adoptionJournal.recoveryPhase == .none)

        let recoveryEpochAdoption = "recoveryEpochAdoption"
        let newerPrimaryRecoveryFence = "newerPrimaryRecoveryFence"
        let newer = ConnectorCredentialRecord(
            rawCredential: "idxh_newer-fixture", audience: "hermes-agent",
            agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            installationId: installationId,
            setupAttemptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            credentialId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            actions: BrowserAuthorization.canonicalActions,
            expiresAt: Date(timeIntervalSinceNow: 3600), activationState: "active",
            accountLabel: "Newer Owner", recoveryPhase: .none,
            authorizationAttemptId: nil, operationEpoch: 41
        )
        let newerStore = FixtureCredentialStore()
        newerStore.record = newer
        newerStore.recoveryRecord = issuedRecovery(phase: .revocationProbeConfirmed, epoch: 40)
        let newerJournal = AuthorizationInstallationStore(installationId: installationId)
        seedJournal(newerJournal, phase: .revocationProbeConfirmed, epoch: 40)
        let newerDisconnectCount = server.disconnectCount
        let newerProbeCount = server.probeCount
        let newerRuntime = runtime(
            store: newerStore, journal: newerJournal,
            process: ConnectorProcessRecoveryState(), browser: automaticBrowser(code: "unused")
        )
        precondition(newerRuntime.handle(disconnectRequest("newer-primary-fence")).result
            == .object(["status": .string("connected")]))
        precondition(newerStore.record == newer)
        precondition(newerStore.recoveryRecord == nil)
        precondition(newerJournal.recoveryPhase == .none)
        precondition(server.disconnectCount == newerDisconnectCount)
        precondition(server.probeCount == newerProbeCount)

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
            disconnectWhileExchangeBlocked, recoveryReadErrorWithoutAttempt,
            recoveryReadErrorPreservesProof, recoveryReadErrorDuringExchange,
            recoveryReadErrorCASFailureRace,
            staleIssuedPreparationFailureNoNetwork,
            staleIssuedJournalPreparationFailureNoNetwork,
            staleIssuedReceiptIdentityMismatch, staleIssuedPreparedBeforeRevoke,
            staleIssuedReceiptBeforeProbe,
            probeFailureAfterReceiptRestart, recoveryDeletionFailureAfterProbe,
            immediateJournalClearFailureAfterProbe, recoveryIdentityGenerationMismatch,
            futureRecoveryBoundaryFence, legitimateRecoveryEpochAdoption,
            recoveryEpochAdoption, newerPrimaryRecoveryFence,
            disconnectWhileActivationBlocked,
        ].allSatisfy { !$0.isEmpty })
        print("Authorization fixture passed")
    }
}
