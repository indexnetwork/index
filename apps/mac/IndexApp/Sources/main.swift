import Cocoa
import WebKit
import Network
import Security
import CryptoKit

// ---------------------------------------------------------------------------
// Configuration. Release endpoints and identity are embedded in Info.plist by
// release-config.sh. Production never consults UserDefaults or the process
// environment for endpoint authority. Committed local bundles are explicitly
// marked development and carry localhost values in their plist templates.
// ---------------------------------------------------------------------------
enum AppConfig {
    static let isDevelopmentBuild = requiredBool("IndexDevelopmentBuild")
    static let releaseChannel = requiredReleaseChannel()
    static let releaseVersion = requiredString("IndexReleaseVersion")
    static let releaseCommit = requiredString("IndexReleaseCommit")
    static let expectedTeamID = requiredString("IndexExpectedTeamID")
    static let connectorProtocolVersion = requiredString("IndexConnectorProtocolVersion")
    static let apiURL = configuredEndpoint(
        "IndexAPIURL", production: "https://protocol.index.network"
    )
    static let appURL = configuredEndpoint(
        "IndexWebURL", production: "https://index.network"
    )

    static var deepLinkHosts: [String] {
        let host = Bundle.main.object(forInfoDictionaryKey: "IndexDeepLinkHost") as? String
        let configuredHost = host?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let configuredHost, !configuredHost.isEmpty {
            return [configuredHost]
        }
        return ["index.network"]
    }

    /// The REST base including the `/api` prefix applied in services/api main.ts.
    static var apiBaseURL: String { trimTrailingSlash(apiURL) + "/api" }
    static var mcpURL: String { trimTrailingSlash(apiURL) + "/mcp" }
    static var ownerKeychainAccessGroup: String? {
        let value = Bundle.main.object(forInfoDictionaryKey: "IndexOwnerKeychainAccessGroup") as? String
        return value?.isEmpty == false ? value : nil
    }

    private static func requiredString(_ key: String) -> String {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            fatalError("Missing embedded release configuration: \(key)")
        }
        return value
    }

    private static func requiredBool(_ key: String) -> Bool {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? Bool else {
            fatalError("Missing embedded release configuration: \(key)")
        }
        return value
    }

    private static func requiredReleaseChannel() -> String {
        let value = requiredString("IndexReleaseChannel")
        let expected = isDevelopmentBuild ? "development" : "production"
        guard value == expected else {
            fatalError("Invalid embedded release configuration: IndexReleaseChannel")
        }
        return value
    }

    private static func configuredEndpoint(_ key: String, production: String) -> String {
        let value = requiredString(key)
        if !isDevelopmentBuild && value != production {
            fatalError("Invalid embedded production configuration: \(key)")
        }
        return value
    }

    static func trimTrailingSlash(_ s: String) -> String {
        var out = s
        while out.hasSuffix("/") { out.removeLast() }
        return out
    }
}

/// Shared non-secret Application Support namespace used by Hermes persistence.
enum CredentialStore {
    static let service = "network.index.system6"
}

enum OwnerInstallationStore {
    private static let key = "INDEX_OWNER_INSTALLATION_ID"
    static func loadOrCreate() -> String {
        if let value = UserDefaults.standard.string(forKey: key), UUID(uuidString: value) != nil {
            return value.lowercased()
        }
        let value = UUID().uuidString.lowercased()
        UserDefaults.standard.set(value, forKey: key)
        return value
    }
}

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

/// JSON-encode a string (or null) so it can be interpolated safely into JS.
func jsonValue(_ s: String?) -> String {
    guard let s = s, let d = try? JSONEncoder().encode(s), let out = String(data: d, encoding: .utf8) else {
        return "null"
    }
    return out
}

/// Single-use loopback callback. It admits only request_id/code/state; no
/// credential field is parsed, retained, reflected, or returned by the browser.
final class LoopbackAuthServer {
    private let expectedState: String
    private var expectedRequestId: String?
    private let onResult: (Result<(requestId: String, code: String, state: String), Error>) -> Void
    private var listener: NWListener?
    private var timeout: DispatchWorkItem?
    private var finished = false

    init(state: String, onResult: @escaping (Result<(requestId: String, code: String, state: String), Error>) -> Void) {
        self.expectedState = state
        self.onResult = onResult
    }

    func bind(requestId: String) {
        guard !finished, UUID(uuidString: requestId) != nil else { return }
        expectedRequestId = requestId.lowercased()
    }

    /// Start listening and return the assigned loopback port.
    func start(timeoutMs: Int = 120_000, completion: @escaping (Result<Int, Error>) -> Void) {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: 0)
        do {
            let listener = try NWListener(using: params)
            self.listener = listener
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if let port = listener.port?.rawValue { completion(.success(Int(port))) }
                    else { completion(.failure(AuthError.noPort)) }
                case .failed(let error):
                    completion(.failure(error))
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] conn in
                conn.start(queue: .main)
                self?.receive(on: conn, buffer: Data())
            }
            listener.start(queue: .main)

            let work = DispatchWorkItem { [weak self] in
                self?.finish(.failure(AuthError.timedOut))
            }
            self.timeout = work
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: work)
        } catch {
            completion(.failure(error))
        }
    }

    func stop() {
        timeout?.cancel()
        timeout = nil
        listener?.cancel()
        listener = nil
    }

    private func finish(_ result: Result<(requestId: String, code: String, state: String), Error>) {
        if finished { return }
        finished = true
        stop()
        onResult(result)
    }

    private func receive(on conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            var acc = buffer
            if let data = data { acc.append(data) }
            let text = String(data: acc, encoding: .utf8) ?? ""
            if text.contains("\r\n\r\n") || isComplete {
                self.handle(requestText: text, conn: conn)
            } else if error == nil {
                self.receive(on: conn, buffer: acc)
            } else {
                conn.cancel()
            }
        }
    }

    private func handle(requestText: String, conn: NWConnection) {
        guard let firstLine = requestText.split(separator: "\r\n").first,
              firstLine.hasPrefix("GET "),
              let path = firstLine.split(separator: " ").dropFirst().first,
              let comps = URLComponents(string: "http://127.0.0.1\(path)"),
              comps.path == "/callback", comps.fragment == nil,
              let expectedRequestId else {
            respond(conn, status: "404 Not Found", title: "Not found", message: "Unexpected request.")
            return
        }
        let items = comps.queryItems ?? []
        let names = items.map(\.name)
        guard items.count == 3, Set(names) == ["request_id", "code", "state"],
              names.allSatisfy({ name in names.filter { $0 == name }.count == 1 }) else {
            respond(conn, status: "400 Bad Request", title: "Authorization failed", message: "Invalid callback.")
            finish(.failure(AuthError.invalidCallback)); return
        }
        func q(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard q("state") == expectedState,
              q("request_id")?.lowercased() == expectedRequestId,
              let code = q("code"), !code.isEmpty, code.count <= 256 else {
            respond(conn, status: "400 Bad Request", title: "Authorization failed",
                    message: "Invalid login state. Return to Index and try again.")
            finish(.failure(AuthError.invalidCallback)); return
        }
        respond(conn, status: "200 OK", title: "Authentication complete",
                message: "You may now close this window", ok: true)
        finish(.success((requestId: expectedRequestId, code: code, state: expectedState)))
    }

    /// The web frontend's index-wordmark.svg, inlined so the page renders the
    /// same header without depending on the web origin being reachable.
    private static let wordmarkSVG = """
    <svg viewBox="0 0 522 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M184.51 21.66C184.51 18.33 187.42 15.73 191.23 15.73C195.04 15.73 197.95 18.33 197.95 21.66C197.95 24.99 195.1 27.54 191.23 27.54C187.36 27.54 184.51 25 184.51 21.66Z" fill="white"/>
    <path d="M0 0.72998H7.47V42.61H0V0.72998Z" fill="white"/>
    <path d="M16.6301 0.72998H25.0701L44.3701 27.26H45.4001V0.72998H52.9301V42.61H44.4301L25.1901 16.08H24.1001V42.61H16.6301V0.72998Z" fill="white"/>
    <path d="M99.91 21.67C99.91 33.63 90.74 42.61 78.54 42.61H62.03V0.72998H78.54C90.74 0.72998 99.91 9.70995 99.91 21.67ZM92.2 21.67C92.2 14.93 86.25 9.88998 78.3 9.88998H69.5V33.44H78.3C86.25 33.44 92.2 28.4 92.2 21.66V21.67Z" fill="white"/>
    <path d="M137.61 33.45V42.62H107.08V0.73999H137.31V9.91H114.55V17.13H135.31V25.99H114.55V33.46H137.62L137.61 33.45Z" fill="white"/>
    <path d="M167.53 21.7899L181.49 42.61H172.75L162.43 27.86H160.97L150.71 42.61H141.3L155.56 21.37L141.84 0.72998H150.58L160.66 15.36H162.06L172.14 0.72998H181.55L167.53 21.7899Z" fill="white"/>
    <path d="M209.87 0.72998H218.31L237.61 27.26H238.64V0.72998H246.17V42.61H237.67L218.43 16.08H217.34V42.61H209.87V0.72998Z" fill="white"/>
    <path d="M285.8 33.45V42.62H255.27V0.73999H285.5V9.91H262.74V17.13H283.5V25.99H262.74V33.46H285.81L285.8 33.45Z" fill="white"/>
    <path d="M324.77 9.88998H311.48V42.61H304.01V9.88998H290.72V0.719971H324.77V9.88998Z" fill="white"/>
    <path d="M328.96 0.72998H336.91L346.14 28.35H347.41L356.09 0.72998H362.71L371.45 28.35H372.79L381.89 0.72998H390.33L376.92 42.61H368.42L360.59 17.24H358.71L350.88 42.61H342.38L328.97 0.72998H328.96Z" fill="white"/>
    <path d="M391.54 21.67C391.54 9.34998 401.07 0 413.7 0C426.33 0 435.86 9.34998 435.86 21.67C435.86 33.99 426.33 43.34 413.7 43.34C401.07 43.34 391.54 33.99 391.54 21.67ZM428.14 21.67C428.14 14.63 421.89 9.35004 413.69 9.35004C405.49 9.35004 399.24 14.63 399.24 21.67C399.24 28.71 405.49 33.99 413.69 33.99C421.89 33.99 428.14 28.71 428.14 21.67Z" fill="white"/>
    <path d="M459.46 29.5H450.42V42.61H442.95V0.72998H462.13C470.57 0.72998 477 6.91996 477 15.12C477 21.31 473.36 26.35 467.9 28.47L477.55 42.61H468.45L459.47 29.5H459.46ZM450.42 20.33H461.95C466.44 20.33 469.23 18.27 469.23 15.11C469.23 11.95 466.44 9.88998 461.95 9.88998H450.42V20.33Z" fill="white"/>
    <path d="M497.83 25.56L491.4 30.96V42.61H483.93V0.72998H491.4V17.67H492.92L509.07 0.72998H521.03L503.31 20.21L521.46 42.61H512.11L497.85 25.55L497.83 25.56Z" fill="white"/>
    </svg>
    """

    /// Landing-styled response page: web frontend header (wordmark on the dark
    /// green background) with a centered status, and a check on success.
    private func respond(_ conn: NWConnection, status: String, title: String, message: String, ok: Bool = false) {
        let check = ok ? """
        <div class="check"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#0b1612" \
        stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
        """ : ""
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><title>\(title) · index</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Public+Sans:wght@300;400;500;600&display=swap">
        <style>
        body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:#14241f;color:#F4FBF6;\
        font-family:'Public Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        .nav{display:flex;align-items:center;padding:22px 56px}
        .nav svg{height:14px;width:auto;display:block}
        main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px}
        .c{text-align:center;max-width:420px}
        .check{width:56px;height:56px;margin:0 auto 26px;border-radius:50%;background:#3FBF7F;\
        display:flex;align-items:center;justify-content:center}
        h1{font-size:20px;font-weight:600;margin:0 0 10px}
        p{font-size:14px;font-weight:500;margin:0;color:rgba(244,251,246,0.78)}
        </style></head>
        <body><nav class="nav">\(Self.wordmarkSVG)</nav>
        <main><div class="c">\(check)<h1>\(title)</h1><p>\(message)</p></div></main></body></html>
        """
        let body = Data(html.utf8)
        let headers = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        var out = Data(headers.utf8)
        out.append(body)
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }

    enum AuthError: Error { case noPort, timedOut, invalidCallback, secureRandomUnavailable }
}

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

// Injected into the page: pressing "chrome" (desktop background, menu bar, or a
// window's title bar) but not an interactive control asks the native side to
// drag the window. The frameless WKWebView otherwise swallows every mouse event,
// so there is no native title bar to grab.
private let windowDragScript = """
document.addEventListener('mousedown', function (e) {
  if (e.button !== 0) return;
  if (e.target.closest('a, button, input, textarea, select, [contenteditable], [role=button], .amiga-gadget, .mac-close, .mac-zoom')) return;
  // Inside a window's body, let clicks through; only its title bar drags.
  var win = e.target.closest('.amiga-window');
  if (win && !e.target.closest('.mac-titlebar')) return;
  window.webkit.messageHandlers.windowDrag.postMessage(null);
}, true);
"""

struct HermesRuntimeProgress: Encodable {
    let requestId: String
    let event: String
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    private var authServer: LoopbackAuthServer?
    private var ownerCredentialStore: OwnerCredentialStore?
    private var ownerMigrationJournal: OwnerCredentialMigrationJournal?
    private var ownerStartupFailure: String?
    private let ownerInstallationId = OwnerInstallationStore.loadOrCreate()
    private var nativeAPIBridge: NativeAPIRequestBridge?
    private var nativeAPIGenerations: [String: UInt64] = [:]
    private var pendingOwnerVerifier: String?
    private var pendingOwnerRedirectURI: String?
    var secureRandomBytesProvider: (Int) -> Data? = { count in
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        return Data(bytes)
    }
    private let ownerAuthQueue = DispatchQueue(label: "network.index.owner-authorization", qos: .userInitiated)
    private let hermesRuntime = HermesRuntimeManager()
    private let hermesRuntimeQueue = DispatchQueue(label: "network.index.hermes-runtime", qos: .userInitiated)
    /// Exact file URL authorized to invoke the credential-bearing runtime bridge.
    /// Set before navigation starts and never derived from page-controlled data.
    private var trustedBundledDocumentURL: URL?
    /// Process-lifetime document epoch. Every provisional main-frame navigation
    /// invalidates work admitted by the document it may replace, including a
    /// reload whose committed URL is byte-for-byte identical.
    private var trustedDocumentGeneration: UInt64 = 0

    /// Deep links that arrived before the page could receive them (cold launch,
    /// or a reload in flight). Flushed in arrival order from didFinish.
    private var pendingDeepLinks: [String] = []
    /// Bound so a page that never loads cannot grow the queue without limit;
    /// the oldest entries are dropped first, the user's latest click survives.
    private let maxPendingDeepLinks = 8
    private var webViewReady = false
    /// A failed initial navigation has no document to receive queued events.
    /// Once a page has finished, a later failed reload can safely use it.
    private var hasLoadedDocument = false

    /// Smallest window the web layout renders correctly at. See the note where
    /// it's applied, the screens clip below roughly 860x600. The width is held
    /// higher than that: the radar column keeps a 600px floor so its funnel
    /// strip stays on one line (mainview.jsx), and the signal column needs
    /// breathing room beside it.
    static let minContentSize = NSSize(width: 1080, height: 640)

    /// Fallback for the (unexpected) case of launching with no screen attached.
    static let fallbackContentSize = NSSize(width: 1280, height: 860)

    /// First-run frame: the whole usable screen, everything the menu bar and
    /// Dock aren't already using. The layout has plenty to do with the room
    /// (the mainview's three columns and the radar cards all get wider), and
    /// this is only the default: the frame autosave takes over the moment the
    /// window is moved or resized.
    static func defaultContentFrame(for screen: NSScreen?) -> NSRect {
        guard let visible = screen?.visibleFrame else {
            return NSRect(origin: .zero, size: fallbackContentSize)
        }
        return NSRect(
            x: visible.origin.x,
            y: visible.origin.y,
            width:  max(minContentSize.width,  visible.width),
            height: max(minContentSize.height, visible.height)
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureOwnerCredentialStore()
        let developmentBuild = AppConfig.isDevelopmentBuild
        if developmentBuild {
            NSLog("Index development build: release configuration is non-production")
        }
        let config = WKWebViewConfiguration()
        // Allow blob: URLs created from a file:// document to be fetched back 
        // the bundle loader reads its own blob assets, which a file origin
        // otherwise treats as cross-origin.
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        if developmentBuild {
            config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        }
        if #available(macOS 11.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }
        // Window-drag bridge (see windowDragScript above).
        config.userContentController.add(self, name: "windowDrag")
        config.userContentController.addUserScript(WKUserScript(
            source: windowDragScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

        // Native auth bridge: the page posts {action:"login"|"logout"} and reads
        // window.INDEX_NATIVE (injected at document start from CredentialStore).
        config.userContentController.add(self, name: "indexAuth")
        config.userContentController.add(self, name: "indexAPI")
        config.userContentController.add(self, name: "hermesRuntime")
        config.userContentController.addUserScript(WKUserScript(
            source: nativeInjectionScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let contentRect = Self.defaultContentFrame(for: NSScreen.main)
        webView = WKWebView(frame: contentRect, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.autoresizingMask = [.width, .height]
        // The System 6 desktop fills the whole surface; no rubber-band bounce.
        webView.setValue(false, forKey: "drawsBackground")
        // 2px frame drawn on the content layer so it follows the window's
        // rounded corners exactly (a CSS border can't match the native clip).
        webView.wantsLayer = true
        if let layer = webView.layer {
            layer.cornerRadius = 10
            // macOS windows use continuous (squircle) corners, a default
            // circular corner radius doesn't trace the same path and looks
            // broken at the corners. Match the window's curve.
            if #available(macOS 10.15, *) {
                layer.cornerCurve = .continuous
            }
            layer.masksToBounds = true
            layer.borderWidth = 2
            layer.borderColor = NSColor.black.cgColor
        }
        if developmentBuild {
            if #available(macOS 13.3, *) {
                webView.isInspectable = true
            }
        }

        window = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = developmentBuild
            ? "Index, Workbench 1.3 — Development"
            : "Index, Workbench 1.3"
        // Float the traffic lights directly over the content, no title bar
        // strip. The web content fills the full window height.
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.styleMask.insert(.fullSizeContentView)
        // Match the Amiga Workbench desktop blue so there's no white flash
        // before the React app paints.
        window.backgroundColor = NSColor(srgbRed: 0x00/255.0, green: 0x55/255.0, blue: 0xAA/255.0, alpha: 1.0)
        // No center(), the default frame is already the usable screen, and
        // centering a window that tall would push it up under the menu bar.
        // Setting the autosave name restores a saved frame over it when there
        // is one, which is what should happen after the first run.
        window.setFrameAutosaveName("IndexMainWindow")
        window.contentView = webView
        // The web layout has a real floor. Below roughly 860x600 the Workbench
        // windows start cutting into their own content, the intents hero and
        // account shelf, the onboarding pane, the radar cards, so resizing
        // past it produces a broken screen rather than a smaller one. Hold a
        // margin above that and refuse to shrink further. contentMinSize is
        // the one that matters (it's the web viewport); minSize keeps the
        // frame in step for anything that reads it.
        window.contentMinSize = Self.minContentSize
        window.minSize = Self.minContentSize
        // An autosaved frame from an earlier build can be smaller than the
        // current minimum, AppKit restores it verbatim, so grow it back.
        var restored = window.frame
        restored.size.width  = max(restored.size.width,  Self.minContentSize.width)
        restored.size.height = max(restored.size.height, Self.minContentSize.height)
        if restored.size != window.frame.size {
            // setFrame constrains to the screen, so growing a window that was
            // saved near an edge doesn't push it off one.
            window.setFrame(restored, display: false)
        }
        window.makeKeyAndOrderFront(nil)
        configureNativeAPIBridge()
        if let ownerStartupFailure { presentError(ownerStartupFailure) }

        loadBundledHTML()

        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadBundledHTML() {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html") else {
            presentError("Could not locate index.html inside the app bundle.")
            return
        }
        // Grant read access to the whole Resources dir so any sibling assets resolve.
        // The delegate still admits only this exact standardized main document.
        let trustedURL = url.standardizedFileURL
        trustedBundledDocumentURL = trustedURL
        let dir = trustedURL.deletingLastPathComponent()
        webView.loadFileURL(trustedURL, allowingReadAccessTo: dir)
    }

    /// The credential-bearing WebView is a single-document shell, not a
    /// browser. Only the exact bundled main document may commit. User-activated
    /// web links are handed to LaunchServices and every other navigation shape
    /// (redirect, replacement, subframe, popup, custom/data/javascript URL) is
    /// cancelled without attempting a permissive fallback.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let requestURL = navigationAction.request.url?.standardizedFileURL
        let isMainFrame = navigationAction.targetFrame?.isMainFrame == true
        if isMainFrame,
           let trustedBundledDocumentURL,
           requestURL == trustedBundledDocumentURL {
            decisionHandler(.allow)
            return
        }

        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url,
           let scheme = url.scheme?.lowercased(),
           scheme == "http" || scheme == "https" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        let responseURL = navigationResponse.response.url?.standardizedFileURL
        let exactMainDocument = navigationResponse.isForMainFrame
            && responseURL == trustedBundledDocumentURL
            && navigationResponse.canShowMIMEType
        decisionHandler(exactMainDocument ? .allow : .cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // Navigation policy already externalizes an approved link activation.
        // Never create a second credential-bearing WebView.
        return nil
    }

    private func presentError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Index, Workbench 1.3"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.runModal()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    // Surface JS alert()/confirm() as native dialogs so the experience matches.
    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView,
                 didFail navigation: WKNavigation!,
                 withError error: Error) {
        deepLinkNavigationFailed()
        presentError("Failed to load: \(error.localizedDescription)")
    }

    // A provisional failure is often just a cancelled navigation, so it stays
    // silent as before — but readiness still has to come back.
    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        deepLinkNavigationFailed()
    }

    /// didStartProvisionalNavigation clears `webViewReady` so links are not
    /// dispatched into a document about to be replaced. A failed reload can
    /// restore readiness against the previously loaded document; the initial
    /// load cannot, because flushing into about:blank silently loses events.
    private func deepLinkNavigationFailed() {
        guard webView != nil, hasLoadedDocument else { return }
        webViewReady = true
        flushPendingDeepLinks()
    }

    // MARK: - Deep links (index:// scheme + universal links)
    //
    // Deliberately thin: this side decides nothing about where a URL leads. It
    // raises the window and hands the raw absolute string to the page, which
    // asks window.IndexApi.parseDeepLink (apps/mac/api/deeplink.mjs, unit
    // tested) what it means. Adding or changing a route touches only that file.

    /// `index://o/<id>` and friends, opened via LaunchServices.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { deliverDeepLink(url) }
    }

    /// Universal links: macOS hands `https://index.network/...` over as a
    /// browsing NSUserActivity once the domain is verified against the app's
    /// associated-domains entitlement (Developer ID-signed builds only).
    func application(_ application: NSApplication,
                     continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([NSUserActivityRestoring]) -> Void) -> Bool {
        guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
              let url = userActivity.webpageURL else { return false }
        deliverDeepLink(url)
        return true
    }

    private func deliverDeepLink(_ url: URL) {
        let raw = url.absoluteString
        guard !raw.isEmpty else { return }

        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)

        guard webViewReady, webView != nil else {
            pendingDeepLinks.append(raw)
            if pendingDeepLinks.count > maxPendingDeepLinks {
                pendingDeepLinks.removeFirst(pendingDeepLinks.count - maxPendingDeepLinks)
            }
            return
        }
        dispatchDeepLink(raw)
    }

    private func dispatchDeepLink(_ raw: String) {
        let js = "window.dispatchEvent(new CustomEvent('index-deeplink', { detail: { url: \(jsonValue(raw)) } }));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        // A link arriving mid-load would be dispatched into a document that is
        // about to be replaced, so queue again until the new one is up. Advance
        // the epoch before doing anything asynchronous so even a same-URL
        // reload cannot inherit an earlier document's native result.
        trustedDocumentGeneration += 1
        webViewReady = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoadedDocument = true
        webViewReady = true
        flushPendingDeepLinks()
    }

    private func flushPendingDeepLinks() {
        let queued = pendingDeepLinks
        pendingDeepLinks.removeAll()
        for raw in queued { dispatchDeepLink(raw) }
    }

    // <input type="file"> does nothing in a WKWebView unless the host puts up
    // the panel itself, WebKit only asks, it can't present one on macOS.
    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    // Page reported a press on a draggable region. performDrag needs a live
    // event and is unreliable from an async handler, so run our own drag loop:
    // while the button stays down, follow the cursor and reposition the window.
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        if message.name == "hermesRuntime" {
            handleHermesRuntimeMessage(message)
            return
        }
        if message.name == "indexAPI" {
            handleNativeAPIMessage(message)
            return
        }
        if message.name == "indexAuth" {
            // Apply the same exact document + process generation admission as
            // the runtime bridge before even decoding page-controlled data.
            guard isTrustedBridgeMessage(message) else { return }
            let admittedGeneration = trustedDocumentGeneration
            let body = message.body as? [String: Any]
            let action = body?["action"] as? String
            if action == "login" { startLogin(admittedGeneration: admittedGeneration) }
            else if action == "completeLogout" {
                logout(
                    ownerId: body?["ownerId"] as? String,
                    admittedGeneration: admittedGeneration
                )
            }
            else if action == "detectHarnesses" { detectHarnesses(admittedGeneration: admittedGeneration) }
            else if action == "setAgentFace" {
                // The page is loaded from a file:// URL, where WebKit gives the
                // document an opaque origin and localStorage is not persisted.
                // UserDefaults is the store that actually survives a relaunch.
                AgentFaceStore.save(body?["value"] as? [String: Any])
            }
            return
        }
        guard message.name == "windowDrag" else { return }
        guard NSEvent.pressedMouseButtons & 0x1 != 0 else { return }

        let startMouse = NSEvent.mouseLocation
        let startOrigin = window.frame.origin
        while let event = NSApp.nextEvent(matching: [.leftMouseUp, .leftMouseDragged],
                                          until: .distantFuture,
                                          inMode: .eventTracking,
                                          dequeue: true) {
            if event.type == .leftMouseUp { break }
            let now = NSEvent.mouseLocation
            window.setFrameOrigin(NSPoint(
                x: startOrigin.x + (now.x - startMouse.x),
                y: startOrigin.y + (now.y - startMouse.y)))
        }
    }

    /// Scan for installed agent CLIs off the main thread, then hand the
    /// result to the page via window.__indexHarnessesDetected.
    private func detectHarnesses(admittedGeneration: UInt64) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let found = HarnessDetector.detect()
            let json = (try? JSONSerialization.data(withJSONObject: found))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
            DispatchQueue.main.async {
                guard let self,
                      self.webViewReady,
                      admittedGeneration == self.trustedDocumentGeneration,
                      self.webView.url?.standardizedFileURL == self.trustedBundledDocumentURL else { return }
                self.webView.evaluateJavaScript(
                    "if (typeof window.__indexHarnessesDetected === 'function') { window.__indexHarnessesDetected(\(json)); }",
                    completionHandler: nil)
            }
        }
    }

    /// Decode on the WebKit callback thread, execute all filesystem/Process
    /// work on one serial background queue, then deliver the correlated result
    /// back on the main thread. The decoded bootstrap credential never enters
    /// the callback result or an error/log message.
    private func handleHermesRuntimeMessage(_ message: WKScriptMessage) {
        // This trust check deliberately precedes even reading/decoding the body:
        // subframes and any replacement document get no bridge work or reply.
        guard isTrustedBridgeMessage(message) else { return }
        let admittedGeneration = trustedDocumentGeneration
        let body = message.body as? [String: Any]
        let requestId = body?["requestId"] as? String ?? ""
        guard let body,
              JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body),
              let request = try? JSONDecoder().decode(HermesRuntimeRequest.self, from: data) else {
            emitHermesRuntimeResult(HermesRuntimeResult(
                requestId: requestId,
                ok: false,
                stage: "decode",
                state: nil,
                errorCode: "invalid_request",
                retryable: false
            ), admittedGeneration: admittedGeneration)
            return
        }

        hermesRuntimeQueue.async { [weak self] in
            guard let self else { return }
            // Credential-free dequeue acknowledgement. It is emitted from
            // inside the serial queue immediately before handle so JavaScript
            // can distinguish bounded queue wait from bounded execution.
            self.emitHermesRuntimeProgress(
                HermesRuntimeProgress(requestId: request.requestId, event: "started"),
                admittedGeneration: admittedGeneration
            )
            let result = self.hermesRuntime.handle(request)
            DispatchQueue.main.async { [weak self] in
                self?.emitHermesRuntimeResult(
                    result,
                    admittedGeneration: admittedGeneration
                )
            }
        }
    }

    private func isTrustedBridgeMessage(_ message: WKScriptMessage) -> Bool {
        guard webViewReady,
              message.frameInfo.isMainFrame,
              let trustedBundledDocumentURL,
              let sourceURL = message.frameInfo.request.url?.standardizedFileURL,
              sourceURL == trustedBundledDocumentURL,
              webView.url?.standardizedFileURL == trustedBundledDocumentURL else {
            return false
        }
        return true
    }

    private func emitHermesRuntimeProgress(
        _ progress: HermesRuntimeProgress,
        admittedGeneration: UInt64
    ) {
        let json = (try? JSONEncoder().encode(progress))
            .flatMap { String(data: $0, encoding: .utf8) }
            ?? "{\"requestId\":\"\",\"event\":\"invalid\"}"
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  self.webViewReady,
                  admittedGeneration == self.trustedDocumentGeneration,
                  let trustedBundledDocumentURL = self.trustedBundledDocumentURL,
                  self.webView.url?.standardizedFileURL == trustedBundledDocumentURL else { return }
            self.webView.evaluateJavaScript(
                "if (typeof window.__indexHermesRuntimeProgress === 'function') { window.__indexHermesRuntimeProgress(\(json)); }",
                completionHandler: nil
            )
        }
    }

    private func emitHermesRuntimeResult(
        _ result: HermesRuntimeResult,
        admittedGeneration: UInt64
    ) {
        // A trusted request may finish after navigation. Readiness plus the
        // captured epoch distinguishes a same-URL replacement from its sender.
        guard webViewReady,
              admittedGeneration == trustedDocumentGeneration,
              let trustedBundledDocumentURL,
              webView.url?.standardizedFileURL == trustedBundledDocumentURL else { return }
        let json = (try? JSONEncoder().encode(result))
            .flatMap { String(data: $0, encoding: .utf8) }
            ?? "{\"requestId\":\"\",\"ok\":false,\"stage\":\"encode\",\"errorCode\":\"internal_failure\",\"retryable\":true}"
        webView.evaluateJavaScript(
            "if (typeof window.__indexHermesRuntimeResult === 'function') { window.__indexHermesRuntimeResult(\(json)); }",
            completionHandler: nil
        )
    }

    // MARK: - Native owner credential + request bridge

    private struct OwnerAuthorizationCreated: Decodable {
        let requestId: String
    }
    private struct OwnerAuthorizationExchange: Decodable {
        let credential: String
        let activationProof: String
        let credentialId: String
        let installationId: String
        let generation: String
        let expiresAt: String
        let activationState: String
    }

    private func configureOwnerCredentialStore() {
        guard let accessGroup = AppConfig.ownerKeychainAccessGroup,
              let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            ownerStartupFailure = "This build has no authorized owner Keychain group. Use a signed Index build."
            return
        }
        let support = root.appendingPathComponent(CredentialStore.service, isDirectory: true)
        do {
            var store = try OwnerCredentialStore(
                accessGroup: accessGroup,
                applicationSupportDirectory: support
            )
            ownerMigrationJournal = try store.prepareForStartup(installationId: ownerInstallationId)
            ownerCredentialStore = store
        } catch {
            ownerCredentialStore = nil
            ownerMigrationJournal = nil
            ownerStartupFailure = "Owner credential migration failed closed. The app remains signed out."
        }
    }

    private func configureNativeAPIBridge() {
        guard let api = URL(string: AppConfig.apiBaseURL),
              let mcp = URL(string: AppConfig.mcpURL) else { return }
        nativeAPIBridge = NativeAPIRequestBridge(
            apiBaseURL: api,
            mcpURL: mcp,
            credentialProvider: { [weak self] in
                guard let self, self.ownerMigrationJournal == nil else { return nil }
                return try self.ownerCredentialStore?.loadCredential()
            },
            trustedMessage: { [weak self] message in self?.isTrustedBridgeMessage(message) == true },
            terminal: { [weak self] response in self?.emitNativeAPIResponse(response) },
            event: { [weak self] event in self?.emitNativeAPIEvent(event) }
        )
        if ownerMigrationJournal == nil, currentOwnerCredential() != nil {
            try? nativeAPIBridge?.endQuarantineAfterCredentialReadBack()
        }
        if ownerMigrationJournal?.phase == .revocation_pending,
           ownerMigrationJournal?.legacyKeyId == nil,
           currentOwnerCredential() != nil {
            retryPendingOwnerRevocation()
        }
    }

    private func handleNativeAPIMessage(_ message: WKScriptMessage) {
        guard isTrustedBridgeMessage(message),
              let body = message.body as? [String: Any],
              let requestId = body["requestId"] as? String,
              !requestId.isEmpty, requestId.count <= 128 else { return }
        nativeAPIGenerations[requestId] = trustedDocumentGeneration
        nativeAPIBridge?.handle(message)
    }

    private func emitNativeAPIResponse(_ response: NativeAPIResponse) {
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  let generation = self.nativeAPIGenerations.removeValue(forKey: response.requestId),
                  generation == self.trustedDocumentGeneration,
                  self.webViewReady,
                  self.webView.url?.standardizedFileURL == self.trustedBundledDocumentURL,
                  let data = try? JSONEncoder().encode(response),
                  let json = String(data: data, encoding: .utf8) else { return }
            self.webView.evaluateJavaScript(
                "if (typeof window.__indexAPIResponse === 'function') { window.__indexAPIResponse(\(json)); }",
                completionHandler: nil
            )
        }
    }

    private func emitNativeAPIEvent(_ value: NativeAPIEvent) {
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  self.nativeAPIGenerations[value.requestId] == self.trustedDocumentGeneration,
                  self.webViewReady,
                  self.webView.url?.standardizedFileURL == self.trustedBundledDocumentURL,
                  let data = try? JSONEncoder().encode(value),
                  let json = String(data: data, encoding: .utf8) else { return }
            self.webView.evaluateJavaScript(
                "if (typeof window.__indexAPIEvent === 'function') { window.__indexAPIEvent(\(json)); }",
                completionHandler: nil
            )
        }
    }

    /// Document-start metadata is deliberately credential-free.
    private func nativeInjectionScript() -> String {
        let authenticated = ownerMigrationJournal == nil
            && (currentOwnerCredential()?.expiresAt ?? .distantPast) > Date()
        let obj: [String: Any] = [
            "apiBaseUrl": AppConfig.apiBaseURL,
            "authenticated": authenticated,
            "deepLinkHosts": AppConfig.deepLinkHosts,
        ]
        let json = (try? JSONSerialization.data(withJSONObject: obj))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        window.INDEX_NATIVE = \(json);
        window.INDEX_NATIVE.agentFace = \(AgentFaceStore.loadJSON());
        """
    }

    private func startLogin(admittedGeneration: UInt64) {
        guard let store = ownerCredentialStore else {
            notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration); return
        }
        do { try store.verifyLegacyCredentialAbsent() }
        catch { notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration); return }
        authServer?.stop()
        guard let state = try? secureRandomState(), let verifier = try? secureRandomState() else {
            ownerStartupFailure = "secure_random_unavailable"
            notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration)
            return
        }
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let server = LoopbackAuthServer(state: state) { [weak self] result in
            DispatchQueue.main.async {
                self?.finishLogin(result, admittedGeneration: admittedGeneration)
            }
        }
        authServer = server
        server.start { [weak self] portResult in
            guard let self else { return }
            switch portResult {
            case .failure:
                self.finishLogin(.failure(LoopbackAuthServer.AuthError.noPort), admittedGeneration: admittedGeneration)
            case .success(let port):
                let redirect = "http://127.0.0.1:\(port)/callback"
                let body: [String: Any] = [
                    "protocolVersion": 1,
                    "installationId": self.ownerInstallationId,
                    "redirectUri": redirect,
                    "state": state,
                    "codeChallenge": challenge,
                    "codeChallengeMethod": "S256",
                    "legacyKeyId": self.ownerMigrationJournal?.legacyKeyId ?? NSNull(),
                ]
                self.performOwnerRequest(path: "/index-app-owner-authorizations", body: body) { result in
                    DispatchQueue.main.async {
                        guard admittedGeneration == self.trustedDocumentGeneration else { return }
                        switch result {
                        case .failure:
                            self.finishLogin(.failure(LoopbackAuthServer.AuthError.invalidCallback), admittedGeneration: admittedGeneration)
                        case .success(let data):
                            guard let created = try? JSONDecoder().decode(OwnerAuthorizationCreated.self, from: data) else {
                                self.finishLogin(.failure(LoopbackAuthServer.AuthError.invalidCallback), admittedGeneration: admittedGeneration); return
                            }
                            server.bind(requestId: created.requestId)
                            self.pendingOwnerVerifier = verifier
                            self.pendingOwnerRedirectURI = redirect
                            var journal = self.ownerMigrationJournal ?? OwnerCredentialMigrationJournal(
                                version: 1, installationId: self.ownerInstallationId,
                                legacyKeyId: nil, requestId: nil, phase: .fresh_login_required
                            )
                            journal.requestId = created.requestId
                            do {
                                try store.saveJournal(journal)
                                self.ownerMigrationJournal = journal
                            } catch {
                                self.finishLogin(.failure(LoopbackAuthServer.AuthError.invalidCallback), admittedGeneration: admittedGeneration); return
                            }
                            var page = URLComponents(string: AppConfig.trimTrailingSlash(AppConfig.appURL) + "/index-app-authorize")
                            page?.queryItems = [
                                URLQueryItem(name: "request_id", value: created.requestId),
                                URLQueryItem(name: "state", value: state),
                                URLQueryItem(name: "redirect_uri", value: redirect),
                            ]
                            if let url = page?.url { NSWorkspace.shared.open(url) }
                        }
                    }
                }
            }
        }
    }

    private func finishLogin(
        _ result: Result<(requestId: String, code: String, state: String), Error>,
        admittedGeneration: UInt64
    ) {
        authServer?.stop(); authServer = nil
        guard case .success(let callback) = result,
              let verifier = pendingOwnerVerifier,
              let redirect = pendingOwnerRedirectURI else {
            pendingOwnerVerifier = nil; pendingOwnerRedirectURI = nil
            notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration); return
        }
        pendingOwnerVerifier = nil; pendingOwnerRedirectURI = nil
        guard var journal = ownerMigrationJournal else {
            notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration); return
        }
        journal.phase = .revocation_pending
        do {
            try ownerCredentialStore?.saveJournal(journal)
            ownerMigrationJournal = journal
        } catch {
            notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration); return
        }
        let body: [String: Any] = [
            "protocolVersion": 1, "requestId": callback.requestId,
            "code": callback.code, "state": callback.state,
            "verifier": verifier, "redirectUri": redirect,
        ]
        performOwnerRequest(path: "/index-app-owner-authorizations/exchange", body: body) { [weak self] exchangeResult in
            guard let self else { return }
            switch exchangeResult {
            case .failure:
                DispatchQueue.main.async { self.notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration) }
            case .success(let data):
                guard let exchange = try? JSONDecoder().decode(OwnerAuthorizationExchange.self, from: data),
                      exchange.activationState == "pending",
                      exchange.installationId == self.ownerInstallationId,
                      let expiry = self.parseServerDate(exchange.expiresAt),
                      let store = self.ownerCredentialStore else {
                    DispatchQueue.main.async { self.notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration) }; return
                }
                let record = OwnerCredentialRecord(
                    credential: exchange.credential, credentialId: exchange.credentialId,
                    installationId: exchange.installationId, generation: exchange.generation,
                    expiresAt: expiry
                )
                do { try store.putAndVerify(record) }
                catch {
                    self.rollbackFailedActivation(record: record, proof: exchange.activationProof, admittedGeneration: admittedGeneration); return
                }
                self.performOwnerRequest(
                    path: "/index-app-owner-authorizations/activate",
                    body: ["protocolVersion": 1, "activationProof": exchange.activationProof],
                    credential: exchange.credential
                ) { activation in
                    switch activation {
                    case .failure:
                        self.rollbackFailedActivation(record: record, proof: exchange.activationProof, admittedGeneration: admittedGeneration)
                    case .success:
                        do {
                            guard try store.loadCredential() == record else {
                                throw OwnerCredentialStoreFailure.keychainReadBackFailed
                            }
                            try store.clearJournal()
                            self.ownerMigrationJournal = nil
                            try self.nativeAPIBridge?.endQuarantineAfterCredentialReadBack()
                            DispatchQueue.main.async { self.notifyAuthChanged(authenticated: true, admittedGeneration: admittedGeneration) }
                        } catch {
                            let recovery = OwnerCredentialMigrationJournal(
                                version: 1, installationId: self.ownerInstallationId,
                                legacyKeyId: nil, requestId: nil, phase: .revocation_pending
                            )
                            try? store.saveJournal(recovery)
                            self.ownerMigrationJournal = recovery
                            self.rollbackFailedActivation(record: record, proof: exchange.activationProof, admittedGeneration: admittedGeneration)
                        }
                    }
                }
            }
        }
    }

    private func rollbackFailedActivation(record: OwnerCredentialRecord, proof: String, admittedGeneration: UInt64) {
        performOwnerRequest(
            path: "/index-app-owner-authorizations/rollback",
            body: ["protocolVersion": 1, "activationProof": proof],
            credential: record.credential
        ) { [weak self] rollback in
            guard let self else { return }
            switch rollback {
            case .success:
                self.finishFailedActivationRevocation(admittedGeneration: admittedGeneration)
            case .failure:
                // Activation may have committed while its response was lost.
                // Exact self-revocation handles pending, active, and already
                // revoked rows idempotently before local deletion.
                self.performOwnerRequest(
                    path: "/index-app-owner-authorizations/revoke",
                    body: ["protocolVersion": 1], credential: record.credential
                ) { revoke in
                    if case .success = revoke {
                        self.finishFailedActivationRevocation(admittedGeneration: admittedGeneration)
                    } else {
                        DispatchQueue.main.async {
                            self.notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration)
                        }
                    }
                }
            }
        }
    }

    private func finishFailedActivationRevocation(admittedGeneration: UInt64) {
        do { try ownerCredentialStore?.deleteAndVerify() }
        catch { return }
        DispatchQueue.main.async {
            self.notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration)
        }
    }

    private func logout(ownerId: String?, admittedGeneration: UInt64) {
        guard let ownerId,
              let evidence = hermesRuntime.logoutEvidence(ownerId: ownerId),
              let store = ownerCredentialStore,
              let record = currentOwnerCredential() else { return }
        let journal = OwnerCredentialMigrationJournal(
            version: 1, installationId: ownerInstallationId,
            legacyKeyId: nil, requestId: nil, phase: .revocation_pending
        )
        do { try store.saveJournal(journal); ownerMigrationJournal = journal }
        catch { return }
        notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration)
        guard let bridge = nativeAPIBridge else { return }
        bridge.beginQuarantine { [weak self] in
            self?.revokeAndDelete(record: record, evidence: evidence)
        }
    }

    private func currentOwnerCredential() -> OwnerCredentialRecord? {
        guard let store = ownerCredentialStore else { return nil }
        do { return try store.loadCredential() }
        catch { return nil }
    }

    private func retryPendingOwnerRevocation() {
        guard let record = currentOwnerCredential(), let bridge = nativeAPIBridge else { return }
        bridge.beginQuarantine { [weak self] in
            self?.revokeAndDelete(record: record, evidence: nil)
        }
    }

    private func revokeAndDelete(record: OwnerCredentialRecord, evidence: HermesSagaOperationRecord?) {
        performOwnerRequest(
            path: "/index-app-owner-authorizations/revoke",
            body: ["protocolVersion": 1], credential: record.credential
        ) { [weak self] revokeResult in
            guard let self, case .success = revokeResult else { return }
            self.verifyCredentialDenied(record.credential) { denied in
                guard denied, let store = self.ownerCredentialStore else { return }
                do {
                    try store.deleteAndVerify()
                    try store.clearJournal()
                    self.ownerMigrationJournal = nil
                    if let evidence { self.hermesRuntime.finishLogoutEvidence(evidence) }
                } catch { return }
            }
        }
    }

    private func verifyCredentialDenied(_ credential: String, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: AppConfig.apiBaseURL + "/auth/me") else { completion(false); return }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(credential, forHTTPHeaderField: "x-api-key")
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode
            completion(status == 401 || status == 403)
        }.resume()
    }

    private func parseServerDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private func performOwnerRequest(
        path: String,
        body: [String: Any],
        credential: String? = nil,
        completion: @escaping (Result<Data, Error>) -> Void
    ) {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body),
              data.count <= 1_048_576,
              let url = URL(string: AppConfig.apiBaseURL + path) else {
            completion(.failure(LoopbackAuthServer.AuthError.invalidCallback)); return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let credential { request.setValue(credential, forHTTPHeaderField: "x-api-key") }
        request.httpBody = data
        URLSession.shared.dataTask(with: request) { responseData, response, error in
            guard error == nil,
                  let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  let responseData, responseData.count <= 1_048_576 else {
                completion(.failure(LoopbackAuthServer.AuthError.invalidCallback)); return
            }
            completion(.success(responseData))
        }.resume()
    }

    private func notifyAuthChanged(authenticated: Bool, admittedGeneration: UInt64) {
        guard webViewReady,
              admittedGeneration == trustedDocumentGeneration,
              webView.url?.standardizedFileURL == trustedBundledDocumentURL else { return }
        let value = authenticated ? "true" : "false"
        let js = """
        window.INDEX_NATIVE = Object.assign(window.INDEX_NATIVE || {}, { apiBaseUrl: \(jsonValue(AppConfig.apiBaseURL)), authenticated: \(value) });
        if (typeof window.__indexAuthChanged === 'function') { window.__indexAuthChanged(\(value)); }
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func secureRandomState() throws -> String {
        guard let bytes = secureRandomBytesProvider(32), bytes.count == 32 else {
            throw LoopbackAuthServer.AuthError.secureRandomUnavailable
        }
        return bytes.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// Minimal menu so ⌘Q / ⌘W / copy-paste work like a real Mac app.
func buildMainMenu() -> NSMenu {
    let mainMenu = NSMenu()

    let appMenuItem = NSMenuItem()
    mainMenu.addItem(appMenuItem)
    let appMenu = NSMenu()
    appMenuItem.submenu = appMenu
    let appName = "Index"
    appMenu.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(NSMenuItem.separator())
    appMenu.addItem(withTitle: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

    let editMenuItem = NSMenuItem()
    mainMenu.addItem(editMenuItem)
    let editMenu = NSMenu(title: "Edit")
    editMenuItem.submenu = editMenu
    editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    editMenu.addItem(NSMenuItem.separator())
    editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

    let windowMenuItem = NSMenuItem()
    mainMenu.addItem(windowMenuItem)
    let windowMenu = NSMenu(title: "Window")
    windowMenuItem.submenu = windowMenu
    windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

    return mainMenu
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.mainMenu = buildMainMenu()
app.run()
