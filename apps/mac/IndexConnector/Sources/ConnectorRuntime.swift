import Foundation

enum ConnectorRuntimeError: Error, Equatable {
    case invalidPayload
    case notConnected
    case reconnectRequired
    case recoveryOnly
    case alreadyConnected
    case staleAuthorization
}

private struct ConnectorAuthorizationAttempt {
    let id: String
    let epoch: UInt64
    var preparation: BrowserAuthorizationPreparation?
    var requestId: String?
    var expiresAt: Date?
}

final class ConnectorRuntime {
    private let installationStore: ConnectorInstallationStoring
    private let credentialStore: ConnectorCredentialStoring
    private let http: ConnectorHTTPClient
    private let browser: BrowserAuthorization
    private let processRecovery: ConnectorProcessRecoveryState
    private let stateLock = NSLock()
    private let transitionLock = NSLock()
    private var operationEpoch: UInt64
    private var currentAttempt: ConnectorAuthorizationAttempt?
    private var inFlightCredentialAttempts: Set<String> = []
    private var lastAuthorizationFailure: (code: String, message: String)?

    init(
        endpoints: ConnectorEndpoints,
        installationStore: ConnectorInstallationStoring,
        credentialStore: ConnectorCredentialStoring,
        http: ConnectorHTTPClient,
        authorization: BrowserAuthorization,
        processRecovery: ConnectorProcessRecoveryState
    ) {
        _ = endpoints
        self.installationStore = installationStore
        self.credentialStore = credentialStore
        self.http = http
        browser = authorization
        self.processRecovery = processRecovery
        operationEpoch = installationStore.stateSnapshot.operationEpoch
    }

    convenience init(
        endpoints: ConnectorEndpoints = .embedded,
        installationStore: ConnectorInstallationStore
    ) throws {
        let credentialStore = try ConnectorCredentialStore(installationId: installationStore.installationId)
        let http = ConnectorHTTPClient(endpoints: endpoints)
        let processRecovery = ConnectorProcessRecoveryState()
        let browser = BrowserAuthorization(endpoints: endpoints)
        self.init(
            endpoints: endpoints,
            installationStore: installationStore,
            credentialStore: credentialStore,
            http: http,
            authorization: browser,
            processRecovery: processRecovery
        )
    }

    func closeResources() {
        http.closeResources()
    }

    func handle(_ request: ConnectorRequest) -> ConnectorResponse {
        do {
            return ConnectorResponse(
                protocolVersion: ConnectorProtocolVersion.current,
                id: request.id,
                success: true,
                result: try dispatch(request),
                error: nil
            )
        } catch {
            return ConnectorResponse(
                protocolVersion: ConnectorProtocolVersion.current,
                id: request.id,
                success: false,
                result: nil,
                error: sanitize(error)
            )
        }
    }

    private func dispatch(_ request: ConnectorRequest) throws -> JSONValue {
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
            return statusValue()
        case .authorizeStart:
            try requireExactKeys(request.payload, allowed: [])
            return try startAuthorization()
        case .authorizePoll:
            try requireExactKeys(request.payload, allowed: [])
            return pollAuthorization()
        case .rest:
            return try dispatchREST(request.payload, credential: activeCredential())
        case .mcp:
            try requireExactKeys(request.payload, allowed: ["toolName", "arguments"], required: ["toolName", "arguments"])
            guard case let .string(toolName)? = request.payload["toolName"],
                  case let .object(arguments)? = request.payload["arguments"] else {
                throw ConnectorRuntimeError.invalidPayload
            }
            return try http.callMCP(toolName: toolName, arguments: arguments, credential: activeCredential())
        case .disconnect:
            try requireExactKeys(request.payload, allowed: [])
            return disconnect()
        }
    }

    private func dispatchREST(
        _ payload: [String: JSONValue],
        credential: ConnectorCredentialRecord
    ) throws -> JSONValue {
        guard case let .string(kind)? = payload["kind"] else {
            throw ConnectorRuntimeError.invalidPayload
        }
        switch kind {
        case "json":
            try requireExactKeys(
                payload, allowed: ["kind", "method", "path", "body", "hermesRun"],
                required: ["kind", "method", "path"]
            )
            guard case let .string(method)? = payload["method"],
                  case let .string(path)? = payload["path"] else {
                throw ConnectorRuntimeError.invalidPayload
            }
            var hermesRun: [String: String]?
            if let value = payload["hermesRun"] {
                guard case let .object(raw) = value,
                      Set(raw.keys).isSubset(of: ["runId", "capability"]) else {
                    throw ConnectorRuntimeError.invalidPayload
                }
                var parsed: [String: String] = [:]
                for (key, item) in raw {
                    guard case let .string(string) = item else { throw ConnectorRuntimeError.invalidPayload }
                    parsed[key] = string
                }
                hermesRun = parsed
            }
            let result = try http.rest(
                method: method, path: path, body: payload["body"],
                hermesRun: hermesRun, credential: credential
            )
            return restResult(result)
        case "upload.start":
            try requireExactKeys(
                payload,
                allowed: ["kind", "method", "path", "field", "filename", "contentType", "totalBytes", "sha256"],
                required: ["kind", "method", "path", "field", "filename", "contentType", "totalBytes", "sha256"]
            )
            guard case let .string(method)? = payload["method"], method == "POST",
                  case let .string(path)? = payload["path"],
                  case let .string(field)? = payload["field"],
                  case let .string(filename)? = payload["filename"],
                  case let .string(contentType)? = payload["contentType"],
                  let totalBytes = exactInteger(payload["totalBytes"]),
                  case let .string(sha256)? = payload["sha256"] else {
                throw ConnectorRuntimeError.invalidPayload
            }
            return .object(["uploadId": .string(try http.startUpload(
                path: path, field: field, filename: filename, contentType: contentType,
                totalBytes: totalBytes, sha256: sha256
            ))])
        case "upload.chunk":
            try requireExactKeys(
                payload, allowed: ["kind", "uploadId", "sequence", "data"],
                required: ["kind", "uploadId", "sequence", "data"]
            )
            guard case let .string(uploadId)? = payload["uploadId"],
                  let sequence = exactInteger(payload["sequence"]), sequence >= 0,
                  case let .string(data)? = payload["data"] else {
                throw ConnectorRuntimeError.invalidPayload
            }
            return .object(["acceptedBytes": .number(Double(try http.appendUpload(
                uploadId: uploadId, sequence: sequence, base64Data: data
            )))])
        case "upload.finish":
            try requireExactKeys(payload, allowed: ["kind", "uploadId"], required: ["kind", "uploadId"])
            guard case let .string(uploadId)? = payload["uploadId"] else {
                throw ConnectorRuntimeError.invalidPayload
            }
            return restResult(try http.finishUpload(uploadId: uploadId, credential: credential))
        case "upload.abort":
            try requireExactKeys(payload, allowed: ["kind", "uploadId"], required: ["kind", "uploadId"])
            guard case let .string(uploadId)? = payload["uploadId"] else {
                throw ConnectorRuntimeError.invalidPayload
            }
            _ = http.abortUpload(uploadId: uploadId)
            return .object(["aborted": .bool(true)])
        case "sse.start":
            try requireExactKeys(
                payload, allowed: ["kind", "method", "path"],
                required: ["kind", "method", "path"]
            )
            guard case let .string(method)? = payload["method"], method == "GET",
                  case let .string(path)? = payload["path"], path == "/conversations/stream" else {
                throw ConnectorRuntimeError.invalidPayload
            }
            return .object(["streamId": .string(try http.startSSE(path: path, credential: credential))])
        case "sse.poll":
            try requireExactKeys(
                payload, allowed: ["kind", "streamId", "maxEvents"],
                required: ["kind", "streamId", "maxEvents"]
            )
            guard case let .string(streamId)? = payload["streamId"],
                  let maxEvents = exactInteger(payload["maxEvents"]), (1...50).contains(maxEvents) else {
                throw ConnectorRuntimeError.invalidPayload
            }
            return try http.pollSSE(streamId: streamId, maxEvents: maxEvents)
        case "sse.close":
            try requireExactKeys(payload, allowed: ["kind", "streamId"], required: ["kind", "streamId"])
            guard case let .string(streamId)? = payload["streamId"] else {
                throw ConnectorRuntimeError.invalidPayload
            }
            _ = http.closeSSE(streamId: streamId)
            return .object(["closed": .bool(true)])
        default:
            throw ConnectorRuntimeError.invalidPayload
        }
    }

    private func restResult(_ result: ConnectorRESTResult) -> JSONValue {
        .object(["status": .number(Double(result.status)), "body": result.body])
    }

    private func exactInteger(_ value: JSONValue?) -> Int? {
        guard case let .number(number)? = value,
              number.isFinite, number.rounded(.towardZero) == number,
              number >= 0, number <= Double(Int.max) else { return nil }
        return Int(number)
    }

    private func startAuthorization() throws -> JSONValue {
        let existing = try readCredentialFailClosed()
        let journal = installationStore.stateSnapshot
        stateLock.lock()
        let hasAttempt = currentAttempt != nil
        stateLock.unlock()
        if processRecovery.isRecoveryOnly || journal.recoveryPhase.requiresRecovery
            || journal.authorizationAttemptId != nil || existing?.recoveryPhase.requiresRecovery == true {
            throw ConnectorRuntimeError.recoveryOnly
        }
        guard existing == nil, !hasAttempt else { throw ConnectorRuntimeError.alreadyConnected }

        let attemptId = UUID().uuidString.lowercased()
        stateLock.lock()
        operationEpoch &+= 1
        let epoch = operationEpoch
        currentAttempt = ConnectorAuthorizationAttempt(
            id: attemptId, epoch: epoch, preparation: nil, requestId: nil, expiresAt: nil
        )
        lastAuthorizationFailure = nil
        stateLock.unlock()

        transitionLock.lock()
        let persisted = installationStore.stateSnapshot
        var attemptJournal = persisted
        attemptJournal.authorizationAttemptId = attemptId
        attemptJournal.operationEpoch = epoch
        let journalStarted = (try? installationStore.compareAndSet(
            expected: persisted, replacement: attemptJournal
        )) == true
        transitionLock.unlock()
        guard journalStarted else {
            failAuthorizationOwnership(attemptId: attemptId, epoch: epoch)
            throw ConnectorRuntimeError.recoveryOnly
        }

        do {
            let preparation = try browser.prepare(attemptId: attemptId)
            try updateAttempt(attemptId: attemptId, epoch: epoch) { $0.preparation = preparation }
            try assertAuthorizationOwned(attemptId: attemptId, epoch: epoch, allowedPhases: [.none])
            let created = try http.createAuthorization(
                installationId: installationStore.installationId,
                redirectURI: preparation.redirectURI,
                codeChallenge: preparation.codeChallenge,
                state: preparation.state,
                actions: BrowserAuthorization.canonicalActions
            )
            try assertAuthorizationOwned(attemptId: attemptId, epoch: epoch, allowedPhases: [.none])
            guard created.state == preparation.state, created.expiresAt > Date() else {
                throw BrowserAuthorizationError.invalidAuthorizationResponse
            }
            try updateAttempt(attemptId: attemptId, epoch: epoch) {
                $0.requestId = created.requestId
                $0.expiresAt = created.expiresAt
            }
            try browser.open(preparation: preparation, requestId: created.requestId, expiresAt: created.expiresAt)
            try assertAuthorizationOwned(attemptId: attemptId, epoch: epoch, allowedPhases: [.none])
            return .object(["status": .string("pending")])
        } catch {
            browser.cancel(attemptId: attemptId)
            clearAttemptIfOwned(attemptId: attemptId, epoch: epoch)
            throw error
        }
    }

    private func pollAuthorization() -> JSONValue {
        stateLock.lock()
        let attempt = currentAttempt
        let failure = lastAuthorizationFailure
        stateLock.unlock()
        if let failure {
            return failedAuthorizationResult(code: failure.code, message: failure.message)
        }
        guard let attempt else {
            if let record = try? credentialStore.read(), record.activationState == "active",
               record.recoveryPhase == .none {
                var result = statusObject(record: record, recoveryOnly: recoveryRequired(record: record))
                result["status"] = .string("connected")
                return .object(result)
            }
            return .object(["status": .string("pending")])
        }
        guard let callback = browser.takeCallback(attemptId: attempt.id), callback.attemptId == attempt.id else {
            return .object(["status": .string("pending")])
        }
        do {
            let active = try completeAuthorization(attempt: attempt, code: callback.code)
            var result = statusObject(record: active, recoveryOnly: recoveryRequired(record: active))
            result["status"] = .string("connected")
            return .object(result)
        } catch {
            let sanitized = authorizationFailure(error)
            stateLock.lock()
            if currentAttempt?.id == attempt.id && currentAttempt?.epoch == attempt.epoch {
                lastAuthorizationFailure = sanitized
            }
            stateLock.unlock()
            return failedAuthorizationResult(code: sanitized.code, message: sanitized.message)
        }
    }

    private func completeAuthorization(
        attempt: ConnectorAuthorizationAttempt,
        code: String
    ) throws -> ConnectorCredentialRecord {
        guard let preparation = attempt.preparation,
              let requestId = attempt.requestId,
              let expiresAt = attempt.expiresAt,
              expiresAt > Date() else {
            throw BrowserAuthorizationError.authorizationExpired
        }
        try assertAuthorizationOwned(attemptId: attempt.id, epoch: attempt.epoch, allowedPhases: [.none])
        markCredentialNetworkStarted(attempt.id)
        let exchanged: ConnectorCredentialExchange
        do {
            exchanged = try http.exchangeAuthorization(
                requestId: requestId,
                code: code,
                verifier: preparation.verifier,
                redirectURI: preparation.redirectURI
            )
        } catch {
            markCredentialNetworkFinished(attempt.id)
            throw error
        }
        markCredentialNetworkFinished(attempt.id)

        let pending = ConnectorCredentialRecord(
            rawCredential: exchanged.credential,
            audience: exchanged.audience,
            agentId: exchanged.agentId,
            installationId: exchanged.installationId,
            setupAttemptId: exchanged.setupAttemptId,
            credentialId: exchanged.credentialId,
            actions: exchanged.actions,
            expiresAt: exchanged.expiresAt,
            activationState: exchanged.activationState,
            accountLabel: "",
            recoveryPhase: .none,
            authorizationAttemptId: attempt.id,
            operationEpoch: attempt.epoch
        )
        guard exchanged.audience == "hermes-agent",
              exchanged.installationId == installationStore.installationId,
              exchanged.activationState == "pending",
              exchanged.actions == BrowserAuthorization.canonicalActions,
              exchanged.expiresAt > Date() else {
            retainStaleIssuedCredential(pending)
            throw BrowserAuthorizationError.invalidCredentialMetadata
        }
        guard authorizationOwned(attemptId: attempt.id, epoch: attempt.epoch, allowedPhases: [.none]) else {
            retainStaleIssuedCredential(pending)
            throw ConnectorRuntimeError.staleAuthorization
        }

        transitionLock.lock()
        guard authorizationOwned(attemptId: attempt.id, epoch: attempt.epoch, allowedPhases: [.none]) else {
            transitionLock.unlock()
            retainStaleIssuedCredential(pending)
            throw ConnectorRuntimeError.staleAuthorization
        }
        let pendingStored = (try? credentialStore.compareAndSet(expected: nil, replacement: pending)) == true
        transitionLock.unlock()
        guard pendingStored else {
            processRecovery.failClosed()
            throw ConnectorRuntimeError.recoveryOnly
        }

        processRecovery.failClosed()
        let activationRequested = pending.replacing(recoveryPhase: .activationRequested)
        guard transitionAuthorization(
            attemptId: attempt.id,
            epoch: attempt.epoch,
            expectedRecord: pending,
            replacementRecord: activationRequested,
            expectedPhase: .none,
            replacementPhase: .activationRequested
        ) else { throw ConnectorRuntimeError.recoveryOnly }

        try assertAuthorizationOwned(
            attemptId: attempt.id, epoch: attempt.epoch, allowedPhases: [.activationRequested]
        )
        markCredentialNetworkStarted(attempt.id)
        let activated: ConnectorActivatedCredential
        do {
            activated = try http.activate(credential: exchanged.credential)
        } catch {
            markCredentialNetworkFinished(attempt.id)
            throw error
        }
        markCredentialNetworkFinished(attempt.id)
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
        guard authorizationOwned(
            attemptId: attempt.id, epoch: attempt.epoch, allowedPhases: [.activationRequested]
        ) else {
            throw ConnectorRuntimeError.staleAuthorization
        }

        let active = activationRequested.replacing(activationState: "active", recoveryPhase: .none)
        guard transitionAuthorization(
            attemptId: attempt.id,
            epoch: attempt.epoch,
            expectedRecord: activationRequested,
            replacementRecord: active,
            expectedPhase: .activationRequested,
            replacementPhase: .none
        ) else { throw ConnectorRuntimeError.recoveryOnly }

        var finalRecord = active
        if authorizationOwned(attemptId: attempt.id, epoch: attempt.epoch, allowedPhases: [.none]),
           let label = try? http.fetchAccountLabel(credential: active.rawCredential),
           authorizationOwned(attemptId: attempt.id, epoch: attempt.epoch, allowedPhases: [.none]),
           !label.isEmpty {
            let labeled = active.replacing(accountLabel: label)
            transitionLock.lock()
            if authorizationOwned(attemptId: attempt.id, epoch: attempt.epoch, allowedPhases: [.none]),
               (try? credentialStore.compareAndSet(expected: active, replacement: labeled)) == true {
                finalRecord = labeled
            }
            transitionLock.unlock()
        }
        guard finishAuthorization(attemptId: attempt.id, epoch: attempt.epoch) else {
            throw ConnectorRuntimeError.staleAuthorization
        }
        return finalRecord
    }

    private func transitionAuthorization(
        attemptId: String,
        epoch: UInt64,
        expectedRecord: ConnectorCredentialRecord,
        replacementRecord: ConnectorCredentialRecord,
        expectedPhase: ConnectorRecoveryPhase,
        replacementPhase: ConnectorRecoveryPhase
    ) -> Bool {
        transitionLock.lock()
        defer { transitionLock.unlock() }
        guard authorizationOwned(attemptId: attemptId, epoch: epoch, allowedPhases: [expectedPhase]) else {
            return false
        }
        let keychainPersisted = (try? credentialStore.compareAndSet(
            expected: expectedRecord, replacement: replacementRecord
        )) == true
        let journal = installationStore.stateSnapshot
        guard journal.authorizationAttemptId == attemptId,
              journal.operationEpoch == epoch,
              journal.recoveryPhase == expectedPhase else { return false }
        var replacement = journal
        replacement.recoveryPhase = replacementPhase
        let journalPersisted: Bool
        if replacementPhase == .none && !keychainPersisted {
            journalPersisted = false
        } else {
            journalPersisted = (try? installationStore.compareAndSet(
                expected: journal, replacement: replacement
            )) == true
        }
        return keychainPersisted && journalPersisted
            && authorizationOwned(attemptId: attemptId, epoch: epoch, allowedPhases: [replacementPhase])
    }

    private func finishAuthorization(attemptId: String, epoch: UInt64) -> Bool {
        transitionLock.lock()
        defer { transitionLock.unlock() }
        guard authorizationOwned(attemptId: attemptId, epoch: epoch, allowedPhases: [.none]) else {
            return false
        }
        let journal = installationStore.stateSnapshot
        var replacement = journal
        replacement.authorizationAttemptId = nil
        guard (try? installationStore.compareAndSet(expected: journal, replacement: replacement)) == true else {
            return false
        }
        stateLock.lock()
        guard currentAttempt?.id == attemptId, currentAttempt?.epoch == epoch else {
            stateLock.unlock()
            return false
        }
        currentAttempt = nil
        lastAuthorizationFailure = nil
        stateLock.unlock()
        browser.cancel(attemptId: attemptId)
        processRecovery.clear()
        return true
    }

    private func retainStaleIssuedCredential(_ issued: ConnectorCredentialRecord) {
        processRecovery.failClosed()
        transitionLock.lock()
        defer { transitionLock.unlock() }
        guard (try? credentialStore.read()) == nil else { return }
        let journal = installationStore.stateSnapshot
        var recovery = issued.replacing(
            recoveryPhase: .activationRequested,
            authorizationAttemptId: .some(nil),
            operationEpoch: journal.operationEpoch
        )
        recovery = recovery.replacing(activationState: "pending")
        guard (try? credentialStore.compareAndSet(expected: nil, replacement: recovery)) == true else { return }
        var replacement = journal
        replacement.authorizationAttemptId = nil
        replacement.recoveryPhase = .activationRequested
        _ = try? installationStore.compareAndSet(expected: journal, replacement: replacement)
    }

    private func disconnect() -> JSONValue {
        http.closeResources()
        let invalidatedAttempt: String?
        let epoch: UInt64
        stateLock.lock()
        invalidatedAttempt = currentAttempt?.id
        currentAttempt = nil
        operationEpoch &+= 1
        epoch = operationEpoch
        let credentialNetworkInFlight = !inFlightCredentialAttempts.isEmpty
        stateLock.unlock()
        processRecovery.failClosed()
        if let invalidatedAttempt { browser.cancel(attemptId: invalidatedAttempt) }

        transitionLock.lock()
        let journal = installationStore.stateSnapshot
        var invalidated = journal
        invalidated.authorizationAttemptId = nil
        invalidated.operationEpoch = epoch
        if credentialNetworkInFlight && invalidated.recoveryPhase == .none {
            invalidated.recoveryPhase = .activationRequested
        }
        let invalidationPersisted = (try? installationStore.compareAndSet(
            expected: journal, replacement: invalidated
        )) == true
        transitionLock.unlock()
        guard invalidationPersisted else { return recoveryOnlyResult }

        let record: ConnectorCredentialRecord?
        do { record = try credentialStore.read() } catch { return recoveryOnlyResult }
        guard var working = record else {
            if credentialNetworkInFlight { return recoveryOnlyResult }
            if invalidated.recoveryPhase.confirmsServerRevocation {
                return clearConfirmedNoKey(epoch: epoch)
            }
            if invalidated.recoveryPhase == .none {
                processRecovery.clear()
                clearAuthorizationFailure()
                return disconnectedResult
            }
            return recoveryOnlyResult
        }

        if !working.recoveryPhase.confirmsServerRevocation {
            let requested = working.replacing(
                recoveryPhase: .revocationRequested,
                authorizationAttemptId: .some(nil),
                operationEpoch: epoch
            )
            guard transitionDisconnect(
                epoch: epoch,
                expectedRecord: working,
                replacementRecord: requested,
                replacementPhase: .revocationRequested
            ) else { return recoveryOnlyResult }
            working = requested
        } else if working.operationEpoch != epoch || working.authorizationAttemptId != nil {
            let adopted = working.replacing(
                authorizationAttemptId: .some(nil), operationEpoch: epoch
            )
            guard transitionDisconnect(
                epoch: epoch,
                expectedRecord: working,
                replacementRecord: adopted,
                replacementPhase: working.recoveryPhase
            ) else { return recoveryOnlyResult }
            working = adopted
        }

        if working.recoveryPhase == .revocationRequested {
            guard disconnectOwned(epoch) else { return recoveryOnlyResult }
            let receipt: ConnectorRevocationReceipt
            do { receipt = try http.revoke(credential: working.rawCredential) }
            catch { return recoveryOnlyResult }
            guard disconnectOwned(epoch),
                  receipt.credentialId == working.credentialId,
                  receipt.setupAttemptId == working.setupAttemptId else {
                return recoveryOnlyResult
            }
            let confirmed = working.replacing(recoveryPhase: .serverReceiptConfirmed)
            guard transitionDisconnect(
                epoch: epoch,
                expectedRecord: working,
                replacementRecord: confirmed,
                replacementPhase: .serverReceiptConfirmed
            ) else { return recoveryOnlyResult }
            working = confirmed
        }

        if working.activationState == "active", working.expiresAt > Date(),
           working.recoveryPhase != .revocationProbeConfirmed {
            guard disconnectOwned(epoch) else { return recoveryOnlyResult }
            do { try http.requireRevokedCredentialProbe(credential: working.rawCredential) }
            catch { return recoveryOnlyResult }
            guard disconnectOwned(epoch) else { return recoveryOnlyResult }
            let probed = working.replacing(recoveryPhase: .revocationProbeConfirmed)
            guard transitionDisconnect(
                epoch: epoch,
                expectedRecord: working,
                replacementRecord: probed,
                replacementPhase: .revocationProbeConfirmed
            ) else { return recoveryOnlyResult }
            working = probed
        }

        guard working.recoveryPhase.confirmsServerRevocation, disconnectOwned(epoch) else {
            return recoveryOnlyResult
        }
        transitionLock.lock()
        let deleted = disconnectOwned(epoch)
            && (try? credentialStore.compareAndSet(expected: working, replacement: nil)) == true
        transitionLock.unlock()
        guard deleted else { return recoveryOnlyResult }
        return clearConfirmedNoKey(epoch: epoch)
    }

    private func transitionDisconnect(
        epoch: UInt64,
        expectedRecord: ConnectorCredentialRecord,
        replacementRecord: ConnectorCredentialRecord,
        replacementPhase: ConnectorRecoveryPhase
    ) -> Bool {
        transitionLock.lock()
        defer { transitionLock.unlock() }
        guard disconnectOwned(epoch) else { return false }
        let keychainPersisted = (try? credentialStore.compareAndSet(
            expected: expectedRecord, replacement: replacementRecord
        )) == true
        let journal = installationStore.stateSnapshot
        guard journal.operationEpoch == epoch, journal.authorizationAttemptId == nil else { return false }
        var replacement = journal
        replacement.recoveryPhase = replacementPhase
        let journalPersisted = (try? installationStore.compareAndSet(
            expected: journal, replacement: replacement
        )) == true
        return keychainPersisted && journalPersisted && disconnectOwned(epoch)
    }

    private func clearConfirmedNoKey(epoch: UInt64) -> JSONValue {
        transitionLock.lock()
        defer { transitionLock.unlock() }
        guard disconnectOwned(epoch) else { return recoveryOnlyResult }
        let journal = installationStore.stateSnapshot
        guard journal.operationEpoch == epoch,
              journal.authorizationAttemptId == nil,
              journal.recoveryPhase.confirmsServerRevocation else {
            return recoveryOnlyResult
        }
        stateLock.lock()
        let credentialNetworkInFlight = !inFlightCredentialAttempts.isEmpty
        stateLock.unlock()
        guard !credentialNetworkInFlight else { return recoveryOnlyResult }
        var cleared = journal
        cleared.recoveryPhase = .none
        guard (try? installationStore.compareAndSet(expected: journal, replacement: cleared)) == true else {
            return recoveryOnlyResult
        }
        processRecovery.clear()
        clearAuthorizationFailure()
        return disconnectedResult
    }

    private func clearAuthorizationFailure() {
        stateLock.lock()
        lastAuthorizationFailure = nil
        stateLock.unlock()
    }

    private func disconnectOwned(_ epoch: UInt64) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return operationEpoch == epoch && currentAttempt == nil
    }

    private func authorizationOwned(
        attemptId: String,
        epoch: UInt64,
        allowedPhases: Set<ConnectorRecoveryPhase>
    ) -> Bool {
        stateLock.lock()
        let memoryOwned = currentAttempt?.id == attemptId
            && currentAttempt?.epoch == epoch
            && operationEpoch == epoch
        stateLock.unlock()
        guard memoryOwned else { return false }
        let journal = installationStore.stateSnapshot
        return journal.authorizationAttemptId == attemptId
            && journal.operationEpoch == epoch
            && allowedPhases.contains(journal.recoveryPhase)
    }

    private func assertAuthorizationOwned(
        attemptId: String,
        epoch: UInt64,
        allowedPhases: Set<ConnectorRecoveryPhase>
    ) throws {
        guard authorizationOwned(attemptId: attemptId, epoch: epoch, allowedPhases: allowedPhases) else {
            throw ConnectorRuntimeError.staleAuthorization
        }
    }

    private func updateAttempt(
        attemptId: String,
        epoch: UInt64,
        update: (inout ConnectorAuthorizationAttempt) -> Void
    ) throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard var attempt = currentAttempt, attempt.id == attemptId, attempt.epoch == epoch else {
            throw ConnectorRuntimeError.staleAuthorization
        }
        update(&attempt)
        currentAttempt = attempt
    }

    private func clearAttemptIfOwned(attemptId: String, epoch: UInt64) {
        transitionLock.lock()
        let journal = installationStore.stateSnapshot
        if journal.authorizationAttemptId == attemptId, journal.operationEpoch == epoch,
           journal.recoveryPhase == .none {
            var cleared = journal
            cleared.authorizationAttemptId = nil
            _ = try? installationStore.compareAndSet(expected: journal, replacement: cleared)
        }
        transitionLock.unlock()
        stateLock.lock()
        if currentAttempt?.id == attemptId, currentAttempt?.epoch == epoch {
            currentAttempt = nil
        }
        stateLock.unlock()
    }

    private func failAuthorizationOwnership(attemptId: String, epoch: UInt64) {
        processRecovery.failClosed()
        stateLock.lock()
        if currentAttempt?.id == attemptId, currentAttempt?.epoch == epoch { currentAttempt = nil }
        stateLock.unlock()
    }

    private func markCredentialNetworkStarted(_ attemptId: String) {
        stateLock.lock()
        inFlightCredentialAttempts.insert(attemptId)
        stateLock.unlock()
    }

    private func markCredentialNetworkFinished(_ attemptId: String) {
        stateLock.lock()
        inFlightCredentialAttempts.remove(attemptId)
        stateLock.unlock()
    }

    private func activeCredential() throws -> ConnectorCredentialRecord {
        guard let record = try readCredentialFailClosed() else { throw ConnectorRuntimeError.notConnected }
        guard !recoveryRequired(record: record), record.activationState == "active" else {
            throw ConnectorRuntimeError.recoveryOnly
        }
        guard record.expiresAt > Date() else { throw ConnectorRuntimeError.reconnectRequired }
        return record
    }

    private func readCredentialFailClosed() throws -> ConnectorCredentialRecord? {
        do { return try credentialStore.read() }
        catch {
            processRecovery.failClosed()
            throw ConnectorRuntimeError.recoveryOnly
        }
    }

    private func recoveryRequired(record: ConnectorCredentialRecord?) -> Bool {
        stateLock.lock()
        let attemptPending = currentAttempt != nil || !inFlightCredentialAttempts.isEmpty
        stateLock.unlock()
        let journal = installationStore.stateSnapshot
        return processRecovery.isRecoveryOnly || attemptPending
            || journal.recoveryPhase.requiresRecovery || journal.authorizationAttemptId != nil
            || record?.recoveryPhase.requiresRecovery == true || record?.activationState == "pending"
    }

    private func statusValue() -> JSONValue {
        let record: ConnectorCredentialRecord?
        do { record = try credentialStore.read() }
        catch {
            processRecovery.failClosed()
            record = nil
        }
        return .object(statusObject(record: record, recoveryOnly: recoveryRequired(record: record)))
    }

    private func statusObject(
        record: ConnectorCredentialRecord?,
        recoveryOnly: Bool
    ) -> [String: JSONValue] {
        let health: String
        let connected: Bool
        if recoveryOnly {
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
            "revocationPending": .bool(recoveryOnly),
        ]
    }

    private var disconnectedResult: JSONValue { .object(["status": .string("disconnected")]) }
    private var recoveryOnlyResult: JSONValue { .object(["status": .string("recovery_only")]) }

    private func failedAuthorizationResult(code: String, message: String) -> JSONValue {
        .object([
            "status": .string("failed"),
            "error": .object(["code": .string(code), "message": .string(message)]),
        ])
    }

    private func authorizationFailure(_ error: Error) -> (code: String, message: String) {
        if error is ConnectorRuntimeError {
            return ("authorization_stale", "Authorization was superseded. Disconnect recovery is required.")
        }
        if error is ConnectorCredentialStoreError || error is ConnectorInstallationStoreError {
            return ("credential_storage_failed", "Secure credential recovery is required.")
        }
        return ("authorization_failed", "Authorization could not be completed.")
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
            case .recoveryOnly, .staleAuthorization:
                return ConnectorError(code: "recovery_only", message: "Only disconnect recovery is available.")
            case .alreadyConnected:
                return ConnectorError(code: "already_connected", message: "Index is already connected.")
            }
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
            case .uploadNotFound:
                return ConnectorError(code: "upload_not_found", message: "The upload no longer exists.")
            case .uploadSequenceMismatch:
                return ConnectorError(code: "upload_sequence_mismatch", message: "The upload sequence is invalid.")
            case .uploadHashMismatch:
                return ConnectorError(code: "upload_hash_mismatch", message: "The upload hash did not match.")
            case .uploadSizeMismatch:
                return ConnectorError(code: "upload_size_mismatch", message: "The upload size did not match.")
            case .streamNotFound:
                return ConnectorError(code: "stream_not_found", message: "The stream no longer exists.")
            case .streamOverflow:
                return ConnectorError(code: "sse_overflow", message: "The stream buffer overflowed.")
            case .hermesRunDenied:
                return ConnectorError(code: "hermes_run_denied", message: "Hermes run authority is invalid for this route.")
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
