import Cocoa
import WebKit
import Network
import Security

// ---------------------------------------------------------------------------
// Configuration. API_URL / APP_URL are read from UserDefaults (e.g. `defaults
// write network.index.system6 API_URL https://…`) or Info.plist, so production
// URLs are switchable without recompiling. Defaults target a local dev backend.
// ---------------------------------------------------------------------------
enum AppConfig {
    static var apiURL: String { value(for: "API_URL", default: "http://localhost:3001") }
    static var appURL: String { value(for: "APP_URL", default: "http://localhost:3000") }

    /// The REST base including the `/api` prefix applied in services/api main.ts.
    static var apiBaseURL: String { trimTrailingSlash(apiURL) + "/api" }

    private static func value(for key: String, default fallback: String) -> String {
        if let v = UserDefaults.standard.string(forKey: key), !v.isEmpty { return v }
        if let v = Bundle.main.object(forInfoDictionaryKey: key) as? String, !v.isEmpty { return v }
        return fallback
    }

    static func trimTrailingSlash(_ s: String) -> String {
        var out = s
        while out.hasSuffix("/") { out.removeLast() }
        return out
    }
}

/// Credential persisted in the login keychain item (kept in memory in the page,
/// never written to localStorage).
struct StoredCredential: Codable {
    var key: String
    var keyId: String
    var apiUrl: String
}

/// Generic-password Keychain wrapper for the single CLI API credential.
enum Keychain {
    static let service = "network.index.system6"
    static let account = "api-key"

    static func save(_ cred: StoredCredential) {
        guard let data = try? JSONEncoder().encode(cred) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func load() -> StoredCredential? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data,
              let cred = try? JSONDecoder().decode(StoredCredential.self, from: data)
        else { return nil }
        return cred
    }

    static func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

/// JSON-encode a string (or null) so it can be interpolated safely into JS.
func jsonValue(_ s: String?) -> String {
    guard let s = s, let d = try? JSONEncoder().encode(s), let out = String(data: d, encoding: .utf8) else {
        return "null"
    }
    return out
}

/// Minimal loopback HTTP listener that mirrors the CLI browser-login callback:
/// it binds an ephemeral port on 127.0.0.1, validates the one-time state, and
/// captures `api_key` + `key_id` from a single `GET /callback` request.
final class LoopbackAuthServer {
    private let expectedState: String
    private let onResult: (Result<(apiKey: String, keyId: String), Error>) -> Void
    private var listener: NWListener?
    private var timeout: DispatchWorkItem?
    private var finished = false

    init(state: String, onResult: @escaping (Result<(apiKey: String, keyId: String), Error>) -> Void) {
        self.expectedState = state
        self.onResult = onResult
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

    private func finish(_ result: Result<(apiKey: String, keyId: String), Error>) {
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
        // First line: "GET /callback?…&api_key=…&key_id=…&state=… HTTP/1.1"
        guard let firstLine = requestText.split(separator: "\r\n").first,
              let path = firstLine.split(separator: " ").dropFirst().first,
              let comps = URLComponents(string: "http://127.0.0.1\(path)"),
              comps.path == "/callback"
        else {
            respond(conn, status: "404 Not Found", title: "Not found", message: "Unexpected request.")
            return
        }

        let items = comps.queryItems ?? []
        func q(_ name: String) -> String? { items.first { $0.name == name }?.value }

        guard q("state") == expectedState else {
            respond(conn, status: "400 Bad Request", title: "Authorization failed",
                    message: "Invalid login state. Return to index and try again.")
            finish(.failure(AuthError.badState))
            return
        }

        if let apiKey = q("api_key"), let keyId = q("key_id"), !apiKey.isEmpty, !keyId.isEmpty {
            respond(conn, status: "200 OK", title: "index authorized",
                    message: "You can close this window and return to index.")
            finish(.success((apiKey: apiKey, keyId: keyId)))
        } else {
            respond(conn, status: "400 Bad Request", title: "Authorization failed",
                    message: "Incomplete credentials received. Please try again.")
            finish(.failure(AuthError.missingCredential))
        }
    }

    private func respond(_ conn: NWConnection, status: String, title: String, message: String) {
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><title>\(title) — index</title>
        <style>body{font-family:-apple-system,system-ui,sans-serif;background:#FDFDFD;color:#111;\
        display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}\
        .c{text-align:center;max-width:400px;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}\
        p{font-size:.875rem;color:#666}</style></head>\
        <body><div class="c"><h1>\(title)</h1><p>\(message)</p></div></body></html>
        """
        let body = Data(html.utf8)
        let headers = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        var out = Data(headers.utf8)
        out.append(body)
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }

    enum AuthError: Error { case noPort, timedOut, badState, missingCredential }
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

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    private var authServer: LoopbackAuthServer?

    /// Smallest window the web layout renders correctly at. See the note where
    /// it's applied — the screens clip below roughly 860x600.
    static let minContentSize = NSSize(width: 900, height: 640)

    /// Size the app wants on first run, picked off what the layout is drawn at.
    ///
    /// Width — the mainview is the constraint. Its three columns split 40/30/30
    /// of the space left after the desktop margins, so 1280 gives the radar and
    /// the chat/profile column ~368pt each (1200 gave them 344) while still
    /// leaving the Workbench desktop visible around the 980pt screens.
    ///
    /// Height — onboarding is the constraint: it asks for `min(720, 100vh-80)`,
    /// so 860 is the first size that hands it the full 720 it's drawn at, with
    /// settings (660) and intents (560) comfortably clear of their own caps.
    static let idealContentSize = NSSize(width: 1280, height: 860)

    /// The ideal, shrunk to fit the screen it actually opens on — a 1280x800
    /// display has no room for the full height — and never below the minimum.
    static func defaultContentSize(for screen: NSScreen?) -> NSSize {
        guard let visible = screen?.visibleFrame.size else { return idealContentSize }
        return NSSize(
            width:  max(minContentSize.width,  min(idealContentSize.width,  visible.width  - 40)),
            height: max(minContentSize.height, min(idealContentSize.height, visible.height - 40))
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        // Allow blob: URLs created from a file:// document to be fetched back —
        // the bundle loader reads its own blob assets, which a file origin
        // otherwise treats as cross-origin.
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        if #available(macOS 11.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }
        // Window-drag bridge (see windowDragScript above).
        config.userContentController.add(self, name: "windowDrag")
        config.userContentController.addUserScript(WKUserScript(
            source: windowDragScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

        // Native auth bridge: the page posts {action:"login"|"logout"} and reads
        // window.INDEX_NATIVE (injected at document start from the Keychain).
        config.userContentController.add(self, name: "indexAuth")
        config.userContentController.addUserScript(WKUserScript(
            source: Self.nativeInjectionScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let contentRect = NSRect(origin: .zero, size: Self.defaultContentSize(for: NSScreen.main))
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
            // macOS windows use continuous (squircle) corners — a default
            // circular corner radius doesn't trace the same path and looks
            // broken at the corners. Match the window's curve.
            if #available(macOS 10.15, *) {
                layer.cornerCurve = .continuous
            }
            layer.masksToBounds = true
            layer.borderWidth = 2
            layer.borderColor = NSColor.black.cgColor
        }
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

        window = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "index — Workbench 1.3"
        // Float the traffic lights directly over the content — no title bar
        // strip. The web content fills the full window height.
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.styleMask.insert(.fullSizeContentView)
        // Match the Amiga Workbench desktop blue so there's no white flash
        // before the React app paints.
        window.backgroundColor = NSColor(srgbRed: 0x00/255.0, green: 0x55/255.0, blue: 0xAA/255.0, alpha: 1.0)
        window.center()
        window.setFrameAutosaveName("IndexMainWindow")
        window.contentView = webView
        // The web layout has a real floor. Below roughly 860x600 the Workbench
        // windows start cutting into their own content — the intents hero and
        // account shelf, the onboarding pane, the radar cards — so resizing
        // past it produces a broken screen rather than a smaller one. Hold a
        // margin above that and refuse to shrink further. contentMinSize is
        // the one that matters (it's the web viewport); minSize keeps the
        // frame in step for anything that reads it.
        window.contentMinSize = Self.minContentSize
        window.minSize = Self.minContentSize
        // An autosaved frame from an earlier build can be smaller than the
        // current minimum — AppKit restores it verbatim, so grow it back.
        var restored = window.frame
        restored.size.width  = max(restored.size.width,  Self.minContentSize.width)
        restored.size.height = max(restored.size.height, Self.minContentSize.height)
        if restored.size != window.frame.size {
            window.setFrame(restored, display: false)
            window.center()
        }
        window.makeKeyAndOrderFront(nil)

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
        let dir = url.deletingLastPathComponent()
        webView.loadFileURL(url, allowingReadAccessTo: dir)
    }

    private func presentError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "index — Workbench 1.3"
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
        presentError("Failed to load: \(error.localizedDescription)")
    }

    // <input type="file"> does nothing in a WKWebView unless the host puts up
    // the panel itself — WebKit only asks, it can't present one on macOS.
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
        if message.name == "indexAuth" {
            let action = (message.body as? [String: Any])?["action"] as? String
            if action == "login" { startLogin() }
            else if action == "logout" { logout() }
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

    // MARK: - Native auth bridge

    /// document-start script exposing the current API base + stored key to the page.
    private static func nativeInjectionScript() -> String {
        let cred = Keychain.load()
        let obj: [String: Any] = [
            "apiBaseUrl": AppConfig.apiBaseURL,
            "apiKey": cred?.key ?? NSNull(),
        ]
        let json = (try? JSONSerialization.data(withJSONObject: obj))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.INDEX_NATIVE = \(json);"
    }

    /// Begin the browser login flow: open /cli-auth with a one-time state and a
    /// loopback callback that captures the minted API key.
    private func startLogin() {
        authServer?.stop()
        let state = randomState()
        let server = LoopbackAuthServer(state: state) { [weak self] result in
            DispatchQueue.main.async { self?.finishLogin(result) }
        }
        authServer = server
        server.start { [weak self] portResult in
            guard let self = self else { return }
            switch portResult {
            case .success(let port):
                var comps = URLComponents(string: AppConfig.trimTrailingSlash(AppConfig.appURL) + "/cli-auth")
                comps?.queryItems = [
                    URLQueryItem(name: "callback", value: "http://127.0.0.1:\(port)/callback"),
                    URLQueryItem(name: "version", value: "2"),
                    URLQueryItem(name: "state", value: state),
                ]
                if let url = comps?.url { NSWorkspace.shared.open(url) }
            case .failure:
                self.finishLogin(.failure(LoopbackAuthServer.AuthError.noPort))
            }
        }
    }

    private func finishLogin(_ result: Result<(apiKey: String, keyId: String), Error>) {
        authServer?.stop()
        authServer = nil
        switch result {
        case .success(let cred):
            Keychain.save(StoredCredential(
                key: cred.apiKey, keyId: cred.keyId,
                apiUrl: AppConfig.trimTrailingSlash(AppConfig.apiURL)))
            notifyAuthChanged(apiKey: cred.apiKey)
        case .failure:
            // Null tells the page login didn't complete, so it returns to sign-in.
            notifyAuthChanged(apiKey: nil)
        }
    }

    private func logout() {
        if let cred = Keychain.load() { revokeCredential(cred) }
        Keychain.delete()
        notifyAuthChanged(apiKey: nil)
    }

    /// Best-effort server-side revoke so a signed-out key can't be reused.
    private func revokeCredential(_ cred: StoredCredential) {
        guard let url = URL(string: AppConfig.trimTrailingSlash(cred.apiUrl) + "/api/auth/cli-credential/revoke") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(cred.key, forHTTPHeaderField: "x-api-key")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["keyId": cred.keyId, "targetKey": cred.key])
        URLSession.shared.dataTask(with: req).resume()
    }

    private func notifyAuthChanged(apiKey: String?) {
        let key = jsonValue(apiKey)
        let js = """
        window.INDEX_NATIVE = Object.assign(window.INDEX_NATIVE || {}, { apiBaseUrl: \(jsonValue(AppConfig.apiBaseURL)), apiKey: \(key) });
        if (typeof window.__indexAuthChanged === 'function') { window.__indexAuthChanged(\(key)); }
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func randomState() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString()
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
    let appName = "index"
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
