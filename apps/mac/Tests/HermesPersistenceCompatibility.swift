import Foundation
import Darwin

// Minimal production-source dependencies: this executable compiles the real
// HermesRuntime.swift without the Cocoa/WebKit application entry point.
enum CredentialStore {
    static let service = "network.index.system6"
}

enum AppConfig {
    static let apiURL = "https://api.example.test"
    static let apiBaseURL = "https://api.example.test/api"
    static func trimTrailingSlash(_ value: String) -> String {
        var result = value
        while result.hasSuffix("/") { result.removeLast() }
        return result
    }
}

enum HarnessDetector {
    static func detect() -> [[String: String]] { [] }
}

private enum FixtureFailure: Error {
    case assertion(String)
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw FixtureFailure.assertion(message) }
}

private struct FixtureLayout {
    let root: URL
    let applicationSupport: URL
    let hermesHome: URL
    let binary: URL
    let installationURL: URL
    let jobsURL: URL
}

private final class FixtureConnectorStatus: HermesConnectorStatusProviding {
    func status() throws -> HermesConnectorStatus {
        HermesConnectorStatus(
            connected: true,
            health: "active",
            revocationPending: false,
            installationId: "installation-old",
            agentId: "executor-new",
            setupAttemptId: "attempt-new",
            actions: [
                "manage:identity", "manage:premises", "manage:intents",
                "manage:networks", "manage:opportunities", "manage:negotiations",
            ],
            expiresAt: ISO8601DateFormatter().string(
                from: Date().addingTimeInterval(29 * 24 * 60 * 60)
            )
        )
    }

    func disconnect(
        installationId: String,
        agentId: String,
        setupAttemptId: String
    ) throws -> HermesConnectorStatus {
        HermesConnectorStatus(
            connected: false,
            health: "disconnected",
            revocationPending: false,
            installationId: installationId,
            agentId: nil,
            setupAttemptId: nil,
            actions: [],
            expiresAt: nil
        )
    }
}

private final class FixtureRunner: HermesCommandRunning {
    private let jobsURL: URL

    init(jobsURL: URL) {
        self.jobsURL = jobsURL
    }

    func run(executable: String, arguments: [String]) throws -> HermesCommandOutput {
        _ = executable
        if arguments.starts(with: ["cron", "pause"]), arguments.count == 3 {
            try mutateJob(id: arguments[2]) { job in
                job["state"] = "paused"
                job["enabled"] = false
            }
        } else if arguments.starts(with: ["cron", "edit"]), arguments.count >= 3 {
            let id = arguments[2]
            try mutateJob(id: id) { job in
                if let schedule = Self.option("--schedule", in: arguments) {
                    job["schedule"] = schedule
                }
                if let prompt = Self.option("--prompt", in: arguments) {
                    job["prompt"] = prompt
                }
                if let name = Self.option("--name", in: arguments) {
                    job["name"] = name
                }
            }
        }
        return HermesCommandOutput(status: 0, output: "")
    }

    private static func option(_ name: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }

    private func mutateJob(id: String, _ mutation: (inout [String: Any]) -> Void) throws {
        let data = try Data(contentsOf: jobsURL)
        guard var root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              var jobs = root["jobs"] as? [[String: Any]],
              let index = jobs.firstIndex(where: { $0["id"] as? String == id }) else {
            throw FixtureFailure.assertion("runner could not find cron job \(id)")
        }
        mutation(&jobs[index])
        root["jobs"] = jobs
        try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
            .write(to: jobsURL, options: .atomic)
    }
}

@main
struct HermesPersistenceCompatibilityFixture {
    // Exact JSON emitted by the production installation record before owner,
    // executor, immutable-cron, and generation-marker fields existed.
    static let exactHistoricalInstallationJSON = #"{"installationId":"installation-old","currentSetupAttemptId":"attempt-old"}"#
    static let historicalCronID = "owned-cron-old"

    static func main() throws {
        trace("starting historical rebind")
        try runHistoricalRebind()

        trace("checking malformed record rejection")
        try assertRejected("malformed") {
            let layout = try makeLayout(label: "malformed", installationJSON: "{")
            defer { try? FileManager.default.removeItem(at: layout.root) }
            return throwsError {
                _ = try HermesLocalStore(applicationSupportURL: layout.applicationSupport)
                    .loadOrCreateInstallation()
            }
        }

        trace("checking newer record rejection")
        try assertRejected("newer") {
            let newer = #"{"installationId":"installation-old","currentSetupAttemptId":"attempt-old","version":2}"#
            let layout = try makeLayout(label: "newer", installationJSON: newer)
            defer { try? FileManager.default.removeItem(at: layout.root) }
            return throwsError {
                _ = try HermesLocalStore(applicationSupportURL: layout.applicationSupport)
                    .loadOrCreateInstallation()
            }
        }

        trace("checking tampered cron rejection")
        try assertRejected("tampered") {
            let layout = try makeLayout(
                label: "tampered",
                installationJSON: exactHistoricalInstallationJSON,
                cronPrompt: "Run arbitrary broad tools."
            )
            defer { try? FileManager.default.removeItem(at: layout.root) }
            let manager = makeManager(layout)
            let result = manager.handle(inspectRequest)
            return !result.ok && result.errorCode == "cron_store_invalid"
        }

        print("macOS native Hermes historical persistence compatibility passed")
    }

    private static func trace(_ message: String) {
        FileHandle.standardError.write(Data("[HermesPersistenceCompatibility] \(message)\n".utf8))
    }

    private static var inspectRequest: HermesRuntimeRequest {
        HermesRuntimeRequest(
            requestId: "inspect-history",
            command: .inspect,
            ownerId: "owner-new",
            installationId: nil,
            executorId: nil,
            setupAttemptId: nil,
            operationJournal: nil
        )
    }

    private static var rebindRequest: HermesRuntimeRequest {
        HermesRuntimeRequest(
            requestId: "rebind-history",
            command: .configureDisabled,
            ownerId: "owner-new",
            installationId: "installation-old",
            executorId: "executor-new",
            setupAttemptId: "attempt-new",
            operationJournal: nil
        )
    }

    private static func runHistoricalRebind() throws {
        let layout = try makeLayout(
            label: "historical-rebind",
            installationJSON: exactHistoricalInstallationJSON
        )
        defer { try? FileManager.default.removeItem(at: layout.root) }

        trace("constructed layout at \(layout.root.path)")
        let initialStore: HermesLocalStore
        do {
            initialStore = try HermesLocalStore(applicationSupportURL: layout.applicationSupport)
            trace("opened initial local store")
        } catch {
            trace("initial local store failed: \(error), errno=\(errno)")
            throw error
        }
        let decoded = try initialStore.loadOrCreateInstallation()
        trace("decoded historical installation")
        try require(decoded.installationId == "installation-old", "historical installation ID did not decode")
        try require(decoded.currentSetupAttemptId == "attempt-old", "historical setup did not decode")
        try require(decoded.currentOwnerId == nil, "historical record unexpectedly gained an owner")

        let manager = makeManager(layout)
        trace("constructed runtime manager")
        let inspected = manager.handle(inspectRequest)
        trace("completed pre-owner inspect: \(inspected.errorCode ?? "ok")")
        try require(!inspected.ok, "pre-owner inspect unexpectedly succeeded")
        try require(inspected.errorCode == "owner_unattributed", "inspect did not surface owner_unattributed")
        try require(inspected.state?.scheduleEnabled == false, "inspect did not pause the historical cron")

        let adoptedStore = try HermesLocalStore(applicationSupportURL: layout.applicationSupport)
        trace("opened adopted local store")
        let adopted = try adoptedStore.loadOrCreateInstallation()
        trace("decoded adopted installation")
        try require(adopted.installationId == "installation-old", "adoption changed installation ID")
        try require(adopted.currentSetupAttemptId == "attempt-old", "adoption changed historical setup")
        try require(adopted.currentCronJobId == historicalCronID, "adoption did not persist immutable cron ID")
        try require(adopted.currentCronSetupAttemptId == "attempt-old", "adoption lost cron generation")
        try require(adopted.currentOwnerId == nil, "inspect attributed an owner")

        trace("starting exact pre-owner rebind")
        let rebound = manager.handle(rebindRequest)
        trace("completed rebind: \(rebound.errorCode ?? "ok")")
        try require(rebound.ok, "exact pre-owner rebind failed: \(rebound.errorCode ?? "none")")
        try require(
            rebound.stage == "connectorActivationConfirmed",
            "rebind did not confirm connector activation"
        )
        try require(rebound.state?.scheduleEnabled == false, "rebind did not finish disabled")

        // Reload through a fresh production store to prove the saved tuple is
        // durable rather than merely retained by the manager instance.
        let reloadedStore = try HermesLocalStore(applicationSupportURL: layout.applicationSupport)
        let reloaded = try reloadedStore.loadOrCreateInstallation()
        try require(reloaded.installationId == "installation-old", "reload changed installation ID")
        try require(reloaded.currentCronJobId == historicalCronID, "reload changed immutable cron ID")
        try require(reloaded.currentSetupAttemptId == "attempt-new", "reload lost rebound setup")
        try require(reloaded.currentCronSetupAttemptId == "attempt-new", "reload lost cron setup marker")
        try require(reloaded.currentOwnerId == "owner-new", "reload lost owner")
        try require(reloaded.currentExecutorId == "executor-new", "reload lost executor")

        let foreignRebind = manager.handle(HermesRuntimeRequest(
            requestId: "foreign-rebind",
            command: .configureDisabled,
            ownerId: "owner-other",
            installationId: "installation-old",
            executorId: "executor-other",
            setupAttemptId: "attempt-other",
            operationJournal: nil
        ))
        try require(!foreignRebind.ok && foreignRebind.errorCode == "owner_mismatch", "owner fence accepted a foreign rebind")
        let afterForeignAttempt = try HermesLocalStore(
            applicationSupportURL: layout.applicationSupport
        ).loadOrCreateInstallation()
        try require(afterForeignAttempt.currentCronJobId == historicalCronID, "foreign rebind changed cron ID")
        try require(afterForeignAttempt.currentSetupAttemptId == "attempt-new", "foreign rebind changed setup")
        try require(afterForeignAttempt.currentOwnerId == "owner-new", "foreign rebind changed owner")

        let cron = try onlyCron(at: layout.jobsURL)
        try require(cron["id"] as? String == historicalCronID, "cron ID changed during rebind")
        try require(cron["index_app_installation_id"] as? String == "installation-old", "cron lost installation marker")
        try require(cron["index_app_owner_id"] as? String == "owner-new", "cron lost owner marker")
        try require(cron["index_app_setup_attempt_id"] as? String == "attempt-new", "cron lost setup marker")
    }

    private static func makeManager(_ layout: FixtureLayout) -> HermesRuntimeManager {
        HermesRuntimeManager(
            runner: FixtureRunner(jobsURL: layout.jobsURL),
            binaryProvider: { layout.binary.path },
            applicationSupportURL: layout.applicationSupport,
            hermesHomeURL: layout.hermesHome,
            connectorStatusProvider: FixtureConnectorStatus()
        )
    }

    private static func makeLayout(
        label: String,
        installationJSON: String,
        cronPrompt: String = HermesRuntimeManager.historicalPreOwnerCronPrompt
    ) throws -> FixtureLayout {
        let manager = FileManager.default
        // GitHub's macOS runner exports a real, job-owned temporary directory;
        // its /var and /private/tmp compatibility paths are symlinks that the
        // production no-symlink boundary must reject.
        guard let runnerTemp = ProcessInfo.processInfo.environment["RUNNER_TEMP"],
              !runnerTemp.isEmpty else {
            throw FixtureFailure.assertion("RUNNER_TEMP is required for the native fixture")
        }
        let root = URL(fileURLWithPath: runnerTemp, isDirectory: true)
            .appendingPathComponent("index-hermes-native-\(label)-\(UUID().uuidString)", isDirectory: true)
        let applicationSupport = root.appendingPathComponent("Application Support", isDirectory: true)
        let installationDirectory = applicationSupport
            .appendingPathComponent(CredentialStore.service, isDirectory: true)
        let hermesHome = root.appendingPathComponent(".hermes", isDirectory: true)
        let cronDirectory = hermesHome.appendingPathComponent("cron", isDirectory: true)
        let pluginDirectory = hermesHome
            .appendingPathComponent("plugins", isDirectory: true)
            .appendingPathComponent("index-network", isDirectory: true)
        try manager.createDirectory(at: installationDirectory, withIntermediateDirectories: true)
        try manager.createDirectory(at: cronDirectory, withIntermediateDirectories: true)
        try manager.createDirectory(at: pluginDirectory, withIntermediateDirectories: true)

        let installationURL = installationDirectory.appendingPathComponent("hermes-installation.json")
        try Data(installationJSON.utf8).write(to: installationURL)
        let jobsURL = cronDirectory.appendingPathComponent("jobs.json")
        let cron: [String: Any] = [
            "id": historicalCronID,
            "name": HermesRuntimeManager.ownedCronName,
            "prompt": cronPrompt,
            "schedule_display": HermesRuntimeManager.ownedCronSchedule,
            "state": "active",
        ]
        try JSONSerialization.data(
            withJSONObject: ["jobs": [cron]],
            options: [.prettyPrinted, .sortedKeys]
        ).write(to: jobsURL)

        let binary = root.appendingPathComponent("hermes-fixture")
        manager.createFile(atPath: binary.path, contents: Data("#!/bin/sh\n".utf8))
        try manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: binary.path)
        return FixtureLayout(
            root: root,
            applicationSupport: applicationSupport,
            hermesHome: hermesHome,
            binary: binary,
            installationURL: installationURL,
            jobsURL: jobsURL
        )
    }

    private static func onlyCron(at jobsURL: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: jobsURL)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let jobs = root["jobs"] as? [[String: Any]],
              jobs.count == 1 else {
            throw FixtureFailure.assertion("cron store did not contain exactly one job")
        }
        return jobs[0]
    }

    private static func throwsError(_ body: () throws -> Void) -> Bool {
        do {
            try body()
            return false
        } catch {
            return true
        }
    }

    private static func assertRejected(_ name: String, _ body: () throws -> Bool) throws {
        let rejected = try body()
        try require(rejected, "\(name) fixture was not rejected")
    }
}
