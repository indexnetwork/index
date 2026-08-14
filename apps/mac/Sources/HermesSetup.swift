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

    private static func runCommand(_ path: String, _ args: [String]) -> (Int32, String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do { try p.run() } catch { return (-1, "\(error)") }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }

    static func run(apiKey: String) -> [String: Any] {
        guard let hermes = HarnessDetector.detect().first(where: { $0["id"] == "hermes" })?["path"] else {
            return ["ok": false, "error": "hermes binary not found on this mac"]
        }
        do {
            try writeEnv([
                ("INDEX_API_KEY", apiKey),
                ("INDEX_API_URL", AppConfig.apiBaseURL),
                ("INDEX_MCP_URL", AppConfig.mcpURL),
            ])
        } catch {
            return ["ok": false, "error": "could not write ~/.hermes/.env"]
        }
        let installed = FileManager.default.fileExists(
            atPath: NSHomeDirectory() + "/.hermes/plugins/index-network")
        let args = installed
            ? ["plugins", "enable", "index-network"]
            : ["plugins", "install", "indexnetwork/hermes-plugin", "--enable"]
        let (status, output) = runCommand(hermes, args)
        if status != 0 {
            return ["ok": false, "error": "hermes \(args.joined(separator: " ")): \(String(output.suffix(300)))"]
        }
        // The plugin self-installs its Hermes Desktop bundle into
        // ~/.hermes/desktop-plugins when the gateway loads it (see the
        // plugin's __init__.py), so the restart below covers the desktop app.
        restartGatewayIfRunning(hermes)
        return ["ok": true]
    }

    /// Plugins only load at gateway startup: if a gateway is running, bounce
    /// it so an install/remove takes effect now instead of at next launch.
    /// Best-effort — a stopped gateway picks the change up whenever it starts.
    private static func restartGatewayIfRunning(_ hermes: String) {
        let (status, output) = runCommand(hermes, ["gateway", "status"])
        guard status == 0, output.contains("PID") else { return }
        _ = runCommand(hermes, ["gateway", "restart"])
    }

    /// Undo run(): uninstall the plugin and drop the Index credentials from
    /// ~/.hermes/.env. The agent (and its keys) are removed server-side by the
    /// caller; this only cleans the local runtime.
    static func teardown() -> [String: Any] {
        try? FileManager.default.removeItem(atPath: NSHomeDirectory() + "/.hermes/desktop-plugins/index-network")
        if FileManager.default.fileExists(atPath: NSHomeDirectory() + "/.hermes/plugins/index-network") {
            guard let hermes = HarnessDetector.detect().first(where: { $0["id"] == "hermes" })?["path"] else {
                return ["ok": false, "error": "hermes binary not found on this mac"]
            }
            let (status, output) = runCommand(hermes, ["plugins", "remove", "index-network"])
            if status != 0 {
                return ["ok": false, "error": "hermes plugins remove: \(String(output.suffix(300)))"]
            }
            removeEnv(["INDEX_API_KEY", "INDEX_API_URL", "INDEX_MCP_URL"])
            restartGatewayIfRunning(hermes)
            return ["ok": true]
        }
        removeEnv(["INDEX_API_KEY", "INDEX_API_URL", "INDEX_MCP_URL"])
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
