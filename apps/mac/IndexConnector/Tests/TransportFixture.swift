import CryptoKit
import Darwin
import Foundation

private final class TransportCredentialStore: ConnectorCredentialStoring {
    var record: ConnectorCredentialRecord?
    var failNextPut = false
    var failDelete = false
    init(record: ConnectorCredentialRecord?) { self.record = record }
    func putAndVerify(_ record: ConnectorCredentialRecord) throws {
        if failNextPut {
            failNextPut = false
            throw ConnectorCredentialStoreError.verificationFailed
        }
        self.record = record
    }
    func read() throws -> ConnectorCredentialRecord? { record }
    func delete() throws {
        if failDelete { throw ConnectorCredentialStoreError.verificationFailed }
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
}

private final class TransportInstallationStore: ConnectorInstallationStoring {
    private var state: ConnectorInstallationState
    var failNextSet = false
    var failPhase: ConnectorRecoveryPhase?
    var failClearCount = 0
    init(installationId: String) {
        state = ConnectorInstallationState(installationId: installationId, recoveryPhase: .none)
    }
    var installationId: String { state.installationId }
    var recoveryPhase: ConnectorRecoveryPhase {
        get { state.recoveryPhase }
        set { state.recoveryPhase = newValue }
    }
    var stateSnapshot: ConnectorInstallationState { state }
    func setRecoveryPhase(_ phase: ConnectorRecoveryPhase) throws {
        if failNextSet {
            failNextSet = false
            throw ConnectorInstallationStoreError.invalidState
        }
        if phase == .none && failClearCount > 0 {
            failClearCount -= 1
            throw ConnectorInstallationStoreError.invalidState
        }
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
        if replacement.recoveryPhase == .none && failClearCount > 0 {
            failClearCount -= 1
            throw ConnectorInstallationStoreError.invalidState
        }
        state = replacement
        return true
    }
}

private final class TransportFixtureServer {
    private let descriptor: Int32
    private let queue = DispatchQueue(label: "transport.fixture.server", attributes: .concurrent)
    private let lock = NSLock()
    private(set) var port: UInt16 = 0
    var failDisconnect = false
    var receiptCredentialId = "credential-1"
    var forceProbeFailure = false
    var sseMode = "normal"
    private(set) var disconnectCount = 0
    private(set) var lastHeader = ""
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
        lock.lock(); lastHeader = header; lock.unlock()
        let requestLine = header.components(separatedBy: "\r\n").first!
        let path = String(requestLine.split(separator: " ")[1])
        lock.lock(); let isRevoked = revoked; let shouldFail = failDisconnect; let probeFailure = forceProbeFailure; lock.unlock()
        if path == "/api/hermes-authorizations/disconnect" {
            lock.lock(); disconnectCount += 1; lock.unlock()
            if shouldFail { respond(connection, status: 503, body: .object(["error": .string("unavailable")])) }
            else {
                lock.lock(); revoked = true; lock.unlock()
                respond(connection, status: 200, body: .object([
                    "revoked": .bool(true),
                    "credentialId": .string(receiptCredentialId),
                    "setupAttemptId": .string("setup-1"),
                ]))
            }
        } else if path == "/api/auth/me" {
            let unauthorized = isRevoked && !probeFailure
            respond(connection, status: unauthorized ? 401 : 200, body: unauthorized ? .object(["error": .string("invalid_credential")]) : .object(["user": .object(["name": .string("Owner")])]))
        } else if path == "/api/opportunities?fixture=large" {
            respondDeclaredOversize(connection)
        } else if path == "/api/agents/me" {
            respond(connection, status: 200, body: .object(["agent": .object(["id": .string("agent-1")])]))
        } else if path == "/api/conversations/stream" {
            lock.lock(); let mode = sseMode; lock.unlock()
            if mode == "error" {
                respondRaw(connection, status: 503, contentType: "application/json", body: Data("{}".utf8))
            } else {
                let count = mode == "overflow" ? ConnectorHTTPClient.maximumSSEEvents + 1 : 1
                let body = Data((0..<count).map { "data: {\"sequence\":\($0)}\n\n" }.joined().utf8)
                respondRaw(connection, status: 200, contentType: "text/event-stream", body: body)
            }
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

private func makeRuntime(
    server: TransportFixtureServer,
    record: ConnectorCredentialRecord,
    credentialStore: TransportCredentialStore,
    installationStore: TransportInstallationStore,
    processRecovery: ConnectorProcessRecoveryState = ConnectorProcessRecoveryState()
) throws -> ConnectorRuntime {
    let endpoints = try server.endpoints
    let http = ConnectorHTTPClient(endpoints: endpoints)
    let authorization = BrowserAuthorization(endpoints: endpoints, openBrowser: { _ in false })
    return ConnectorRuntime(
        endpoints: endpoints,
        installationStore: installationStore,
        credentialStore: credentialStore,
        http: http,
        authorization: authorization,
        processRecovery: processRecovery
    )
}

private func disconnectRequest(_ id: String) -> ConnectorRequest {
    ConnectorRequest(protocolVersion: 1, id: id, operation: .disconnect, payload: [:])
}

private func awaitClosedStream(
    http: ConnectorHTTPClient,
    streamId: String
) throws -> JSONValue {
    // Bound the asynchronous URLSession fixture; production has no polling sleep.
    usleep(100_000)
    for _ in 0..<200 {
        let result = try http.pollSSE(streamId: streamId, maxEvents: 50)
        if case let .object(object) = result, object["closed"] == .bool(true) {
            return result
        }
        usleep(10_000)
    }
    preconditionFailure("stream did not reach a terminal state")
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

        let uploadSequencing = "uploadSequencing"
        let sequenceId = try http.startUpload(
            path: "/storage/avatars", field: "avatar", filename: "avatar.png",
            contentType: "image/png", totalBytes: 2,
            sha256: String(repeating: "0", count: 64)
        )
        precondition(try http.appendUpload(
            uploadId: sequenceId, sequence: 0, base64Data: Data([1]).base64EncodedString()
        ) == 1)
        expectHTTPError(.uploadSequenceMismatch) {
            _ = try http.appendUpload(
                uploadId: sequenceId, sequence: 2, base64Data: Data([2]).base64EncodedString()
            )
        }

        let uploadHashMismatch = "uploadHashMismatch"
        let hashId = try http.startUpload(
            path: "/storage/avatars", field: "avatar", filename: "avatar.png",
            contentType: "image/png", totalBytes: 1,
            sha256: String(repeating: "0", count: 64)
        )
        _ = try http.appendUpload(uploadId: hashId, sequence: 0, base64Data: Data([1]).base64EncodedString())
        expectHTTPError(.uploadHashMismatch) { _ = try http.finishUpload(uploadId: hashId, credential: record) }

        let uploadSizeMismatch = "uploadSizeMismatch"
        let sizeId = try http.startUpload(
            path: "/storage/avatars", field: "avatar", filename: "avatar.png",
            contentType: "image/png", totalBytes: 2,
            sha256: String(repeating: "0", count: 64)
        )
        _ = try http.appendUpload(uploadId: sizeId, sequence: 0, base64Data: Data([1]).base64EncodedString())
        expectHTTPError(.uploadSizeMismatch) { _ = try http.finishUpload(uploadId: sizeId, credential: record) }

        let uploadCleanup = "uploadCleanup"
        let cleanupId = try http.startUpload(
            path: "/storage/index-images", field: "image", filename: "network.png",
            contentType: "image/png", totalBytes: 0,
            sha256: SHA256.hash(data: Data()).map { String(format: "%02x", $0) }.joined()
        )
        precondition(http.abortUpload(uploadId: cleanupId))
        expectHTTPError(.uploadNotFound) {
            _ = try http.appendUpload(uploadId: cleanupId, sequence: 0, base64Data: "")
        }
        let uploadDisallowedPath = "uploadDisallowedPath"
        expectHTTPError(.invalidRequest) {
            _ = try http.startUpload(
                path: "/auth/me", field: "file", filename: "x", contentType: "text/plain",
                totalBytes: 0, sha256: String(repeating: "0", count: 64)
            )
        }

        let hiddenRun = ["runId": "opaque-run"]
        _ = try http.rest(
            method: "POST", path: "/agents/agent-1/negotiations/pickup",
            body: nil, hermesRun: hiddenRun, credential: record
        )
        precondition(server.lastHeader.lowercased().contains("x-index-hermes-run-id: opaque-run"))
        precondition(!server.lastHeader.lowercased().contains("x-index-hermes-run-capability"))
        expectHTTPError(.hermesRunDenied) {
            _ = try http.rest(
                method: "GET", path: "/agents/me", body: nil,
                hermesRun: hiddenRun, credential: record
            )
        }
        expectHTTPError(.hermesRunDenied) {
            _ = try http.rest(
                method: "POST", path: "/agents/agent-1/negotiations/n-1/respond", body: nil,
                hermesRun: ["runId": "bad\nrun", "capability": "cap"], credential: record
            )
        }

        let streamClose = "streamClose"
        let closeId = try http.startSSE(path: "/conversations/stream", credential: record)
        precondition(http.closeSSE(streamId: closeId))
        precondition(!http.closeSSE(streamId: closeId))

        let streamError = "streamError"
        server.sseMode = "error"
        let errorId = try http.startSSE(path: "/conversations/stream", credential: record)
        let errorPoll = try awaitClosedStream(http: http, streamId: errorId)
        guard case let .object(errorObject) = errorPoll else { preconditionFailure() }
        precondition(errorObject["error"] == .string("sse_rejected"))

        let streamOverflow = "streamOverflow"
        server.sseMode = "overflow"
        let overflowId = try http.startSSE(path: "/conversations/stream", credential: record)
        let overflowPoll = try awaitClosedStream(http: http, streamId: overflowId)
        guard case let .object(overflowObject) = overflowPoll else { preconditionFailure() }
        precondition(overflowObject["error"] == .string("sse_overflow"))
        precondition(![streamOverflow, streamClose, streamError].contains(""))
        http.closeResources()

        let credentialStore = TransportCredentialStore(record: record)
        let installationStore = TransportInstallationStore(installationId: record.installationId)
        let processRecovery = ConnectorProcessRecoveryState()
        let authorization = BrowserAuthorization(endpoints: endpoints, openBrowser: { _ in false })
        let runtime = ConnectorRuntime(
            endpoints: endpoints, installationStore: installationStore,
            credentialStore: credentialStore, http: http, authorization: authorization,
            processRecovery: processRecovery
        )
        let pendingRevocation = "pendingRevocation"
        server.failDisconnect = true
        let first = runtime.handle(ConnectorRequest(protocolVersion: 1, id: "disconnect-1", operation: .disconnect, payload: [:]))
        precondition(first.success)
        precondition(first.result == .object(["status": .string("recovery_only")]))
        precondition(installationStore.recoveryPhase == .revocationRequested && credentialStore.record != nil)
        let blocked = runtime.handle(ConnectorRequest(protocolVersion: 1, id: "rest-1", operation: .rest, payload: ["method": .string("GET"), "path": .string("/agents/me")]))
        precondition(blocked.error?.code == "recovery_only")

        server.failDisconnect = false
        let recovered = runtime.handle(ConnectorRequest(protocolVersion: 1, id: "disconnect-2", operation: .disconnect, payload: [:]))
        precondition(recovered.result == .object(["status": .string("disconnected")]))
        precondition(installationStore.recoveryPhase == .none && credentialStore.record == nil)

        let keyRecoveryRecord = record.replacing(
            activationState: "pending",
            recoveryPhase: .activationRequested
        )
        let keyRecoveryServer = TransportFixtureServer()
        let keyRecoveryCredentials = TransportCredentialStore(record: keyRecoveryRecord)
        let keyRecoveryJournal = TransportInstallationStore(installationId: record.installationId)
        let keyRecoveryRuntime = try makeRuntime(
            server: keyRecoveryServer, record: keyRecoveryRecord,
            credentialStore: keyRecoveryCredentials, installationStore: keyRecoveryJournal
        )
        let keyBlocked = keyRecoveryRuntime.handle(ConnectorRequest(
            protocolVersion: 1, id: "key-recovery", operation: .rest,
            payload: ["method": .string("GET"), "path": .string("/agents/me")]
        ))
        precondition(keyBlocked.error?.code == "recovery_only")
        let restartDenied = keyRecoveryRuntime.handle(ConnectorRequest(
            protocolVersion: 1, id: "authorize-recovery", operation: .authorizeStart, payload: [:]
        ))
        precondition(restartDenied.error?.code == "recovery_only")

        let journalRecoveryServer = TransportFixtureServer()
        let journalRecoveryCredentials = TransportCredentialStore(record: record)
        let journalRecoveryJournal = TransportInstallationStore(installationId: record.installationId)
        journalRecoveryJournal.recoveryPhase = .activationRequested
        let journalRecoveryRuntime = try makeRuntime(
            server: journalRecoveryServer, record: record,
            credentialStore: journalRecoveryCredentials, installationStore: journalRecoveryJournal
        )
        let journalBlocked = journalRecoveryRuntime.handle(ConnectorRequest(
            protocolVersion: 1, id: "journal-recovery", operation: .mcp,
            payload: ["toolName": .string("read_docs"), "arguments": .object([:])]
        ))
        precondition(journalBlocked.error?.code == "recovery_only")

        let initialRecoveryJournalFailure = "initialRecoveryJournalFailure"
        let initialJournalServer = TransportFixtureServer()
        let initialJournalCredentials = TransportCredentialStore(record: record)
        let initialJournal = TransportInstallationStore(installationId: record.installationId)
        initialJournal.failPhase = .revocationRequested
        let initialJournalRuntime = try makeRuntime(
            server: initialJournalServer, record: record,
            credentialStore: initialJournalCredentials, installationStore: initialJournal
        )
        precondition(initialJournalRuntime.handle(disconnectRequest("initial-journal-failure")).result == .object(["status": .string("recovery_only")]))
        precondition(initialJournalServer.disconnectCount == 0)
        precondition(initialJournalCredentials.record?.recoveryPhase == .revocationRequested)
        precondition(initialJournal.recoveryPhase == .none)

        let serverReceiptJournalFailure = "serverReceiptJournalFailure"
        let receiptJournalServer = TransportFixtureServer()
        let receiptJournalCredentials = TransportCredentialStore(record: record)
        let receiptJournal = TransportInstallationStore(installationId: record.installationId)
        receiptJournal.failPhase = .serverReceiptConfirmed
        let receiptJournalRuntime = try makeRuntime(
            server: receiptJournalServer, record: record,
            credentialStore: receiptJournalCredentials, installationStore: receiptJournal
        )
        precondition(receiptJournalRuntime.handle(disconnectRequest("receipt-journal-failure")).result == .object(["status": .string("recovery_only")]))
        precondition(receiptJournalCredentials.record?.recoveryPhase == .serverReceiptConfirmed)
        precondition(receiptJournal.recoveryPhase == .revocationRequested)

        let probeConfirmedJournalFailure = "probeConfirmedJournalFailure"
        let probeJournalServer = TransportFixtureServer()
        let probeJournalCredentials = TransportCredentialStore(record: record)
        let probeJournal = TransportInstallationStore(installationId: record.installationId)
        probeJournal.failPhase = .revocationProbeConfirmed
        let probeJournalRuntime = try makeRuntime(
            server: probeJournalServer, record: record,
            credentialStore: probeJournalCredentials, installationStore: probeJournal
        )
        precondition(probeJournalRuntime.handle(disconnectRequest("probe-journal-failure")).result == .object(["status": .string("recovery_only")]))
        precondition(probeJournalCredentials.record?.recoveryPhase == .revocationProbeConfirmed)
        precondition(probeJournal.recoveryPhase == .serverReceiptConfirmed)

        let firstRecoveryPersistenceFailure = "firstRecoveryPersistenceFailure"
        let persistenceServer = TransportFixtureServer()
        let persistenceCredentials = TransportCredentialStore(record: record); persistenceCredentials.failNextPut = true
        let persistenceJournal = TransportInstallationStore(installationId: record.installationId)
        let persistenceProcess = ConnectorProcessRecoveryState()
        let persistenceRuntime = try makeRuntime(
            server: persistenceServer, record: record,
            credentialStore: persistenceCredentials, installationStore: persistenceJournal,
            processRecovery: persistenceProcess
        )
        let persistenceFailure = persistenceRuntime.handle(disconnectRequest("persist-failure"))
        precondition(persistenceFailure.result == .object(["status": .string("recovery_only")]))
        precondition(persistenceServer.disconnectCount == 0)
        precondition(persistenceCredentials.record != nil && persistenceJournal.recoveryPhase == .revocationRequested)
        let persistenceBlocked = persistenceRuntime.handle(ConnectorRequest(
            protocolVersion: 1, id: "persist-blocked", operation: .mcp,
            payload: ["toolName": .string("read_docs"), "arguments": .object([:])]
        ))
        precondition(persistenceBlocked.error?.code == "recovery_only" && persistenceProcess.isRecoveryOnly)

        let receiptMismatch = "receiptMismatch"
        let mismatchServer = TransportFixtureServer(); mismatchServer.receiptCredentialId = "wrong-credential"
        let mismatchCredentials = TransportCredentialStore(record: record)
        let mismatchJournal = TransportInstallationStore(installationId: record.installationId)
        let mismatchRuntime = try makeRuntime(server: mismatchServer, record: record, credentialStore: mismatchCredentials, installationStore: mismatchJournal)
        precondition(mismatchRuntime.handle(disconnectRequest("receipt-mismatch")).result == .object(["status": .string("recovery_only")]))
        precondition(mismatchCredentials.record?.recoveryPhase == .revocationRequested)

        let activeProbeFailure = "activeProbeFailure"
        let probeServer = TransportFixtureServer(); probeServer.forceProbeFailure = true
        let probeCredentials = TransportCredentialStore(record: record)
        let probeJournal = TransportInstallationStore(installationId: record.installationId)
        let probeRuntime = try makeRuntime(server: probeServer, record: record, credentialStore: probeCredentials, installationStore: probeJournal)
        precondition(probeRuntime.handle(disconnectRequest("probe-failure")).result == .object(["status": .string("recovery_only")]))
        precondition(probeCredentials.record?.recoveryPhase == .serverReceiptConfirmed)
        precondition(probeJournal.recoveryPhase == .serverReceiptConfirmed)

        let serverUncertaintyKeyRetention = "serverUncertaintyKeyRetention"
        let uncertainServer = TransportFixtureServer(); uncertainServer.failDisconnect = true
        let uncertainCredentials = TransportCredentialStore(record: record)
        let uncertainJournal = TransportInstallationStore(installationId: record.installationId)
        let uncertainRuntime = try makeRuntime(server: uncertainServer, record: record, credentialStore: uncertainCredentials, installationStore: uncertainJournal)
        precondition(uncertainRuntime.handle(disconnectRequest("server-uncertain")).result == .object(["status": .string("recovery_only")]))
        precondition(uncertainCredentials.record != nil && uncertainCredentials.record?.recoveryPhase == .revocationRequested)

        let keychainDeletionFailure = "keychainDeletionFailure"
        let deleteServer = TransportFixtureServer()
        let deleteCredentials = TransportCredentialStore(record: record); deleteCredentials.failDelete = true
        let deleteJournal = TransportInstallationStore(installationId: record.installationId)
        let deleteRuntime = try makeRuntime(server: deleteServer, record: record, credentialStore: deleteCredentials, installationStore: deleteJournal)
        precondition(deleteRuntime.handle(disconnectRequest("delete-failure")).result == .object(["status": .string("recovery_only")]))
        precondition(deleteCredentials.record?.recoveryPhase == .revocationProbeConfirmed)
        precondition(deleteJournal.recoveryPhase == .revocationProbeConfirmed)

        let journalClearFailureNoKeyConvergence = "journalClearFailureNoKeyConvergence"
        let clearServer = TransportFixtureServer()
        let clearCredentials = TransportCredentialStore(record: record)
        let clearJournal = TransportInstallationStore(installationId: record.installationId); clearJournal.failClearCount = 1
        let clearRuntime = try makeRuntime(server: clearServer, record: record, credentialStore: clearCredentials, installationStore: clearJournal)
        precondition(clearRuntime.handle(disconnectRequest("clear-failure")).result == .object(["status": .string("recovery_only")]))
        precondition(clearCredentials.record == nil && clearJournal.recoveryPhase == .revocationProbeConfirmed)
        precondition(clearRuntime.handle(disconnectRequest("clear-retry")).result == .object(["status": .string("disconnected")]))
        precondition(clearJournal.recoveryPhase == .none)

        precondition([
            deniedRoute, deniedTool, endpointOverride, oversizedPayload, pendingRevocation,
            initialRecoveryJournalFailure, serverReceiptJournalFailure,
            probeConfirmedJournalFailure, firstRecoveryPersistenceFailure,
            receiptMismatch, activeProbeFailure,
            serverUncertaintyKeyRetention, keychainDeletionFailure,
            journalClearFailureNoKeyConvergence,
        ].allSatisfy { !$0.isEmpty })
        print("Transport fixture passed")
    }
}
