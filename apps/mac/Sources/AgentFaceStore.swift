import Cocoa
import WebKit
import Network
import Security

/// Which avatar the negotiator wears: `{seed}` for a generated face, or
/// `{photo}` for an uploaded one. Purely cosmetic and purely local, so it lives
/// in UserDefaults rather than going anywhere near the credential store.
enum AgentFaceStore {
    private static let key = "AGENT_FACE"

    static func save(_ value: [String: Any]?) {
        guard let value = value,
              let data = try? JSONSerialization.data(withJSONObject: value),
              let json = String(data: data, encoding: .utf8) else {
            UserDefaults.standard.removeObject(forKey: key)
            return
        }
        UserDefaults.standard.set(json, forKey: key)
    }

    /// The stored JSON, ready to interpolate into the injection script.
    static func loadJSON() -> String {
        UserDefaults.standard.string(forKey: key) ?? "null"
    }
}

/// Which OS notifications interrupt the user (the settings pane's toggles).
/// Purely local preference state, so like the agent face it lives in
/// UserDefaults, which — unlike file:// localStorage — survives a relaunch.
enum NotifyPrefsStore {
    private static let key = "NOTIFY_PREFS"

    static func save(_ value: [String: Any]?) {
        guard let value = value,
              let data = try? JSONSerialization.data(withJSONObject: value),
              let json = String(data: data, encoding: .utf8) else {
            UserDefaults.standard.removeObject(forKey: key)
            return
        }
        UserDefaults.standard.set(json, forKey: key)
    }

    /// The stored JSON, ready to interpolate into the injection script.
    static func loadJSON() -> String {
        UserDefaults.standard.string(forKey: key) ?? "null"
    }
}

/// JSON-encode a string (or null) so it can be interpolated safely into JS.
func jsonValue(_ s: String?) -> String {
    guard let s = s, let d = try? JSONEncoder().encode(s), let out = String(data: d, encoding: .utf8) else {
        return "null"
    }
    return out
}
