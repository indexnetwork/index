import Cocoa
import WebKit
import Network
import Security

// ---------------------------------------------------------------------------
// Harness detection: which agent CLIs are installed on this Mac. Follows the
// approach block/buzz uses — a static catalog of known commands, each looked
// up across the login-shell PATH plus well-known install dirs that a GUI app
// doesn't inherit (homebrew, version-manager shims, nvm's node bins).
// ---------------------------------------------------------------------------
enum HarnessDetector {
    /// Known harnesses and the command that proves each one is installed.
    static let catalog: [(id: String, label: String, command: String)] = [
        ("hermes",   "Hermes",       "hermes"),
        ("claude",   "Claude Code",  "claude"),
        ("codex",    "Codex",        "codex"),
        ("goose",    "Goose",        "goose"),
        ("cursor",   "Cursor Agent", "cursor-agent"),
        ("gemini",   "Gemini CLI",   "gemini"),
        ("opencode", "OpenCode",     "opencode"),
        ("kimi",     "Kimi Code",    "kimi"),
        ("amp",      "Amp",          "amp"),
        ("aider",    "Aider",        "aider"),
    ]

    /// PATH from a login shell, fetched once (first access happens off the
    /// main thread). A GUI app's own PATH is the stripped launchd default,
    /// so this is where user-installed CLIs actually live.
    private static let loginShellPath: String? = {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-l", "-c", "echo $PATH"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = Pipe()
        do { try p.run() } catch { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        let out = String(data: data, encoding: .utf8)?
            .split(separator: "\n").last
            .map { $0.trimmingCharacters(in: .whitespaces) }
        return (out?.isEmpty == false) ? out : nil
    }()

    private static func searchDirs() -> [String] {
        let home = NSHomeDirectory()
        var dirs = (loginShellPath ?? "").split(separator: ":").map(String.init)
        dirs += [
            "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
            "\(home)/.local/bin", "\(home)/.volta/bin", "\(home)/.asdf/shims",
            "\(home)/.local/share/mise/shims", "\(home)/.bun/bin",
        ]
        // nvm initializes in interactive shells only, so its node bins are
        // invisible even to a login shell; probe every installed version.
        let nvmNode = "\(home)/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmNode) {
            dirs += versions.map { "\(nvmNode)/\($0)/bin" }
        }
        var seen = Set<String>()
        return dirs.filter { seen.insert($0).inserted }
    }

    /// One pass over the catalog: [{id, label, command, path}] per hit.
    static func detect() -> [[String: String]] {
        let fm = FileManager.default
        let dirs = searchDirs()
        return catalog.compactMap { harness in
            for dir in dirs {
                let path = "\(dir)/\(harness.command)"
                if fm.isExecutableFile(atPath: path) {
                    return ["id": harness.id, "label": harness.label,
                            "command": harness.command, "path": path]
                }
            }
            return nil
        }
    }
}
