import Foundation

// ---------------------------------------------------------------------------
// Hermes plugin setup: point the local hermes runtime at Index by writing the
// plugin's env into ~/.hermes/.env, then install/enable the
// indexnetwork/hermes-plugin. Non-interactive: the hermes CLI only prompts
// for env values that are missing, and --enable skips the enable prompt.
// ---------------------------------------------------------------------------
enum HermesSetup {
    /// Replace-or-append KEY=value lines in ~/.hermes/.env.
    private static func writeEnv(_ values: [(String, String)]) throws {
        let dir = NSHomeDirectory() + "/.hermes"
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = dir + "/.env"
        var lines = (try? String(contentsOfFile: path, encoding: .utf8))?
            .split(separator: "\n", omittingEmptySubsequences: true).map(String.init) ?? []
        for (key, _) in values {
            lines.removeAll { $0.hasPrefix("\(key)=") }
        }
        for (key, value) in values { lines.append("\(key)=\(value)") }
        try (lines.joined(separator: "\n") + "\n").write(toFile: path, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
    }

    static func isWired() -> Bool {
        FileManager.default.fileExists(
            atPath: NSHomeDirectory() + "/.hermes/plugins/index-network")
    }

    private static func runCommand(_ path: String, _ args: [String], timeout: TimeInterval = 90) -> (Int32, String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        p.standardInput = FileHandle.nullDevice
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do { try p.run() } catch { return (-1, "\(error)") }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
            if p.isRunning { p.terminate() }
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        if p.terminationReason == .uncaughtSignal && p.terminationStatus == SIGTERM {
            return (-1, "timed out after \(Int(timeout))s")
        }
        return (p.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }

    static func run(sessionToken: String, progress: (String) -> Void = { _ in }) -> [String: Any] {
        guard let hermes = HarnessDetector.detect().first(where: { $0["id"] == "hermes" })?["path"] else {
            return ["ok": false, "error": "hermes binary not found on this mac"]
        }
        progress("writing session into ~/.hermes/.env")
        do {
            try writeEnv([
                ("INDEX_SESSION_TOKEN", sessionToken),
                ("INDEX_API_URL", AppConfig.apiURL),
            ])
        } catch {
            return ["ok": false, "error": "could not write ~/.hermes/.env"]
        }
        let installed = isWired()
        let args = installed
            ? ["plugins", "enable", "index-network", "--no-allow-tool-override"]
            : ["plugins", "install", "indexnetwork/hermes-plugin", "--enable"]
        progress(installed ? "enabling the Index plugin" : "installing the Index plugin")
        let (status, output) = runCommand(hermes, args)
        if status != 0 {
            return ["ok": false, "error": "hermes \(args.joined(separator: " ")): \(String(output.suffix(300)))"]
        }
        // Point Hermes Desktop at the plugin's desktop/dist without waiting
        // for gateway register() to copy it (see plugin __init__.py).
        progress("linking the Hermes desktop tab")
        linkDesktopPlugin()
        restartGatewayIfRunning(hermes, progress: progress)
        return ["ok": true]
    }

    /// ~/.hermes/desktop-plugins/index-network → plugins/index-network/desktop/dist
    private static func linkDesktopPlugin() {
        let home = NSHomeDirectory() + "/.hermes"
        let dest = home + "/desktop-plugins/index-network"
        let src = home + "/plugins/index-network/desktop/dist"
        let fm = FileManager.default
        guard fm.fileExists(atPath: src + "/plugin.js") else { return }
        try? fm.createDirectory(
            atPath: home + "/desktop-plugins", withIntermediateDirectories: true)
        try? fm.removeItem(atPath: dest)
        try? fm.createSymbolicLink(atPath: dest, withDestinationPath: src)
    }

    /// Plugins only load at gateway startup. Bounce a launchd-supervised
    /// gateway so the change takes effect now. Do not wait: `hermes gateway
    /// restart` can block forever on `launchctl kickstart` when the service
    /// is stale. An unsupervised/manual gateway is left alone.
    private static func restartGatewayIfRunning(_ hermes: String, progress: (String) -> Void) {
        progress("checking the Hermes gateway")
        let (status, output) = runCommand(hermes, ["gateway", "status"], timeout: 10)
        guard status == 0, output.contains("supervised by launchd") else {
            progress("gateway will pick this up the next time it starts")
            return
        }
        progress("restarting the Hermes gateway")
        let p = Process()
        p.executableURL = URL(fileURLWithPath: hermes)
        p.arguments = ["gateway", "restart"]
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try? p.run()
    }

    /// Undo run(): uninstall the plugin and drop the Index credentials from
    /// ~/.hermes/.env. The agent (and its keys) are removed server-side by the
    /// caller; this only cleans the local runtime.
    static func teardown(progress: (String) -> Void = { _ in }) -> [String: Any] {
        progress("unlinking the desktop plugin")
        try? FileManager.default.removeItem(atPath: NSHomeDirectory() + "/.hermes/desktop-plugins/index-network")
        if FileManager.default.fileExists(atPath: NSHomeDirectory() + "/.hermes/plugins/index-network") {
            guard let hermes = HarnessDetector.detect().first(where: { $0["id"] == "hermes" })?["path"] else {
                return ["ok": false, "error": "hermes binary not found on this mac"]
            }
            progress("removing the Index plugin")
            let (status, output) = runCommand(hermes, ["plugins", "remove", "index-network"])
            if status != 0 {
                return ["ok": false, "error": "hermes plugins remove: \(String(output.suffix(300)))"]
            }
            progress("clearing Index credentials")
            removeEnv(["INDEX_SESSION_TOKEN", "INDEX_API_KEY", "INDEX_API_URL"])
            restartGatewayIfRunning(hermes, progress: progress)
            return ["ok": true]
        }
        progress("clearing Index credentials")
        removeEnv(["INDEX_SESSION_TOKEN", "INDEX_API_KEY", "INDEX_API_URL"])
        return ["ok": true]
    }

    /// Drop KEY=value lines from ~/.hermes/.env.
    private static func removeEnv(_ keys: [String]) {
        let path = NSHomeDirectory() + "/.hermes/.env"
        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else { return }
        let lines = content.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
            .filter { line in !keys.contains(where: { line.hasPrefix("\($0)=") }) }
        try? (lines.joined(separator: "\n") + "\n").write(toFile: path, atomically: true, encoding: .utf8)
    }
}
