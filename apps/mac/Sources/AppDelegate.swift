import Cocoa
import WebKit
import Network
import Security
import UserNotifications

// Pressing noninteractive window chrome asks the native shell to drag the
// frameless window. Interactive controls and window content remain untouched.
private let windowDragScript = """
document.addEventListener('mousedown', function (e) {
  if (e.button !== 0) return;
  if (e.target.closest('a, button, input, textarea, select, [contenteditable], [role=button], .amiga-gadget, .mac-close, .mac-zoom')) return;
  var win = e.target.closest('.amiga-window');
  if (win && !e.target.closest('.mac-titlebar')) return;
  window.webkit.messageHandlers.windowDrag.postMessage(null);
}, true);
"""

// ---------------------------------------------------------------------------
// Configuration. API_URL / APP_URL are read from UserDefaults (e.g. `defaults
// write network.index.system6 API_URL https://…`) or Info.plist, so production
// URLs are switchable without recompiling. Defaults target a local dev backend.
// ---------------------------------------------------------------------------
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    private var authServer: LoopbackAuthServer?
    private var ownerCredentialStore: OwnerCredentialStore?
    private var ownerStartupFailure: String?
    private var nativeAPIBridge: NativeAPIRequestBridge?
    private var nativeAPIGenerations: [String: UInt64] = [:]
    var secureRandomBytesProvider: (Int) -> Data? = { count in
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        return Data(bytes)
    }
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
        let config = WKWebViewConfiguration()
        // Allow blob: URLs created from a file:// document to be fetched back 
        // the bundle loader reads its own blob assets, which a file origin
        // otherwise treats as cross-origin.
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
#if INDEX_DEVELOPMENT_BUILD
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
#endif
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
        config.userContentController.addUserScript(WKUserScript(
            source: nativeInjectionScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))

        // Desktop notification bridge: the page posts {id,title,body,url?,imageUrl?}
        // and the native side owns delivery (UNUserNotificationCenter) plus the
        // tap → deep-link round trip. The delegate is set during launch so a
        // toast tapped while the app was closed still routes once it boots.
        config.userContentController.add(self, name: "indexNotify")
        UNUserNotificationCenter.current().delegate = self
        if currentOwnerCredential() != nil {
            // Signed-in relaunch: surface the permission prompt now rather than
            // at the moment the first toast would otherwise silently drop.
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }

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
#if INDEX_DEVELOPMENT_BUILD
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
#endif

        window = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Index, Workbench 1.3"
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

        if navigationAction.navigationType == .linkActivated {
            openExternally(navigationAction.request.url)
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
        // Never create a second credential-bearing WebView. Preserve dev's
        // browser handoff for target=_blank/window.open links.
        openExternally(navigationAction.request.url)
        return nil
    }

    /// Only web and mail addresses may leave the credential-bearing shell.
    private func isExternalScheme(_ url: URL) -> Bool {
        switch url.scheme?.lowercased() {
        case "http", "https", "mailto": return true
        default: return false
        }
    }

    private func openExternally(_ url: URL?) {
        guard let url, isExternalScheme(url) else { return }
        NSWorkspace.shared.open(url)
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
                logout(admittedGeneration: admittedGeneration)
            }
            else if action == "detectHarnesses" { detectHarnesses(admittedGeneration: admittedGeneration) }
            else if action == "setupHermes" {
                setupHermes(admittedGeneration: admittedGeneration)
            }
            else if action == "teardownHermes" {
                teardownHermes(admittedGeneration: admittedGeneration)
            }
            else if action == "setAgentFace" {
                // The page is loaded from a file:// URL, where WebKit gives the
                // document an opaque origin and localStorage is not persisted.
                // UserDefaults is the store that actually survives a relaunch.
                AgentFaceStore.save(body?["value"] as? [String: Any])
            }
            else if action == "setNotifyPrefs" {
                // Same story as the agent face: prefs must survive a relaunch,
                // and file:// localStorage does not.
                NotifyPrefsStore.save(body?["value"] as? [String: Any])
            }
            return
        }
        if message.name == "indexNotify" {
            if let body = message.body as? [String: Any] { postNotification(body) }
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

    /// Write ~/.hermes/.env and install/enable the Index plugin off the main
    /// thread, then hand the result to the page via window.__indexHermesSetup.
    private func setupHermes(admittedGeneration: UInt64) {
        let credential = currentOwnerCredential()?.credential
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result: [String: Any] = credential
                .map { HermesSetup.run(sessionToken: $0) }
                ?? ["ok": false, "error": "sign in first"]
            let json = (try? JSONSerialization.data(withJSONObject: result))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{\"ok\":false}"
            DispatchQueue.main.async {
                guard let self,
                      self.webViewReady,
                      admittedGeneration == self.trustedDocumentGeneration,
                      self.webView.url?.standardizedFileURL == self.trustedBundledDocumentURL else { return }
                self.webView.evaluateJavaScript(
                    "if (typeof window.__indexHermesSetup === 'function') { window.__indexHermesSetup(\(json)); }",
                    completionHandler: nil)
            }
        }
    }

    /// Uninstall the hermes plugin and scrub its env off the main thread,
    /// then hand the result to the page via window.__indexHermesSetup.
    private func teardownHermes(admittedGeneration: UInt64) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = HermesSetup.teardown()
            let json = (try? JSONSerialization.data(withJSONObject: result))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{\"ok\":false}"
            DispatchQueue.main.async {
                guard let self,
                      self.webViewReady,
                      admittedGeneration == self.trustedDocumentGeneration,
                      self.webView.url?.standardizedFileURL == self.trustedBundledDocumentURL else { return }
                self.webView.evaluateJavaScript(
                    "if (typeof window.__indexHermesSetup === 'function') { window.__indexHermesSetup(\(json)); }",
                    completionHandler: nil)
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

    // MARK: - Desktop notifications
    //
    // Delivery is native (UNUserNotificationCenter); everything else — which
    // events toast, copy, dedupe, preference gating — is decided by the web
    // layer before it posts here. The payload is {id,title,body,url?,imageUrl?}:
    // `url` is an index:// deep link replayed through deliverDeepLink on tap,
    // `imageUrl` an https avatar attached to the toast (fail-open on any error).

    private func postNotification(_ body: [String: Any]) {
        // Never toast over the app itself.
        guard !NSApp.isActive else { return }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = (body["title"] as? String) ?? "Index"
            content.body = (body["body"] as? String) ?? ""
            if let url = body["url"] as? String, !url.isEmpty {
                content.userInfo = ["url": url]
            }
            let id = (body["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? UUID().uuidString
            let deliver = {
                center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
            }
            guard let raw = body["imageUrl"] as? String,
                  let imageURL = URL(string: raw),
                  imageURL.scheme == "https" || imageURL.scheme == "http" else {
                deliver()
                return
            }
            URLSession.shared.downloadTask(with: imageURL) { tmp, response, _ in
                if let tmp = tmp,
                   let attachment = Self.notificationAttachment(tmp: tmp, response: response) {
                    content.attachments = [attachment]
                }
                deliver()
            }.resume()
        }
    }

    /// UNNotificationAttachment types the file by extension, and the download
    /// lands extension-less, so move it under a name matching its MIME type.
    /// Anything unrecognizable is skipped and the toast goes out without art.
    private static func notificationAttachment(tmp: URL, response: URLResponse?) -> UNNotificationAttachment? {
        let ext: String
        switch response?.mimeType {
        case "image/png": ext = "png"
        case "image/gif": ext = "gif"
        case "image/jpeg", "image/jpg": ext = "jpg"
        default: return nil
        }
        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent("index-notify-\(UUID().uuidString).\(ext)")
        do {
            try FileManager.default.moveItem(at: tmp, to: dest)
            return try UNNotificationAttachment(identifier: "avatar", url: dest)
        } catch {
            return nil
        }
    }

    /// Tap on the toast body: raise the window and replay the stored deep link
    /// through the same pipeline as an `index://` open from LaunchServices.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let raw = response.notification.request.content.userInfo["url"] as? String
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let raw = raw, let url = URL(string: raw) {
                self.deliverDeepLink(url)
            } else {
                NSApp.activate(ignoringOtherApps: true)
                self.window?.makeKeyAndOrderFront(nil)
            }
        }
        completionHandler()
    }

    // MARK: - Native owner credential + request bridge

    private func configureOwnerCredentialStore() {
        if let accessGroup = AppConfig.ownerKeychainAccessGroup {
            do {
                ownerCredentialStore = try OwnerCredentialStore(accessGroup: accessGroup)
            } catch {
                ownerCredentialStore = nil
                ownerStartupFailure = "This build has no authorized owner Keychain group. Use a signed Index build."
            }
        } else {
#if INDEX_DEVELOPMENT_BUILD
            ownerCredentialStore = OwnerCredentialStore(developmentLoginKeychain: IndexKeychainStore())
#else
            ownerStartupFailure = "This build has no authorized owner Keychain group. Use a signed Index build."
#endif
        }
    }

    private func configureNativeAPIBridge() {
        guard let api = URL(string: AppConfig.apiBaseURL),
              let mcp = URL(string: AppConfig.mcpURL) else { return }
        nativeAPIBridge = NativeAPIRequestBridge(
            apiBaseURL: api,
            mcpURL: mcp,
            credentialProvider: { [weak self] in
                try self?.ownerCredentialStore?.loadCredential()
            },
            trustedMessage: { [weak self] message in self?.isTrustedBridgeMessage(message) == true },
            terminal: { [weak self] response in self?.emitNativeAPIResponse(response) },
            event: { [weak self] event in self?.emitNativeAPIEvent(event) }
        )
        if currentOwnerCredential() != nil {
            try? nativeAPIBridge?.endQuarantineAfterCredentialReadBack()
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
        let authenticated = (currentOwnerCredential()?.expiresAt ?? .distantPast) > Date()
        let obj: [String: Any] = [
            "apiBaseUrl": AppConfig.apiBaseURL,
            "authenticated": authenticated,
            // Share / invitation links use the configured web origin.
            "appUrl": AppConfig.trimTrailingSlash(AppConfig.appURL),
            "deepLinkHosts": AppConfig.deepLinkHosts,
        ]
        let json = (try? JSONSerialization.data(withJSONObject: obj))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        window.INDEX_NATIVE = \(json);
        window.INDEX_NATIVE.agentFace = \(AgentFaceStore.loadJSON());
        window.INDEX_NATIVE.notifyPrefs = \(NotifyPrefsStore.loadJSON());
        """
    }

    /// Client id presented to the device authorization grant. The web page
    /// mints the code and this app redeems it, so both must send the same value.
    private static let deviceClientId = "index-device"

    private func startLogin(admittedGeneration: UInt64) {
        guard ownerCredentialStore != nil else {
            notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration); return
        }
        authServer?.stop()
        guard let state = try? secureRandomState() else {
            ownerStartupFailure = "secure_random_unavailable"
            notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration)
            return
        }
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
                let callback = "http://127.0.0.1:\(port)/callback"
                var page = URLComponents(string: AppConfig.trimTrailingSlash(AppConfig.appURL) + "/cli-auth")
                // The auth page requires every query value in strict
                // encodeURIComponent canonical form; URLQueryItem leaves
                // ':' and '/' unescaped, which the page rejects.
                page?.percentEncodedQuery = [
                    "callback=\(Self.encodeURIComponent(callback))",
                    "version=2",
                    "state=\(Self.encodeURIComponent(state))",
                ].joined(separator: "&")
                if let url = page?.url { NSWorkspace.shared.open(url) }
            }
        }
    }

    private func finishLogin(
        _ result: Result<String, Error>,
        admittedGeneration: UInt64
    ) {
        authServer?.stop(); authServer = nil
        guard case .success(let deviceCode) = result else {
            notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration); return
        }
        // The browser only ever hands over the approved code; this app trades
        // it for a session of its own so the token never touches the browser.
        redeemDeviceCode(deviceCode) { [weak self] redeemed in
            guard let self else { return }
            guard let redeemed, let store = self.ownerCredentialStore else {
                self.notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration); return
            }
            // The .iso8601 Keychain encoding drops fractional seconds, so
            // truncate up front or the read-back equality check can never match.
            let record = OwnerCredentialRecord(
                credential: redeemed.token,
                expiresAt: Date(timeIntervalSince1970: (Date().timeIntervalSince1970 + redeemed.expiresIn).rounded(.down))
            )
            do {
                try store.putAndVerify(record)
                try self.nativeAPIBridge?.endQuarantineAfterCredentialReadBack()
            } catch {
                try? self.ownerCredentialStore?.deleteAndVerify()
                self.notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration); return
            }
            self.notifyAuthChanged(authenticated: true, admittedGeneration: admittedGeneration)
        }
    }

    /// Exchange an approved device code for this device's own session.
    ///
    /// - Parameters:
    ///   - deviceCode: Code delivered to the loopback callback.
    ///   - completion: Receives the session token and its lifetime, or nil on
    ///     any transport, status or decoding failure. Always called on main.
    private func redeemDeviceCode(
        _ deviceCode: String,
        completion: @escaping ((token: String, expiresIn: TimeInterval)?) -> Void
    ) {
        // apiBaseURL already ends in /api.
        guard let url = URL(string: AppConfig.apiBaseURL + "/auth/device/token") else {
            completion(nil); return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // The session records this request's user agent, and that is what names
        // the device in Index settings.
        request.setValue("Index/mac", forHTTPHeaderField: "User-Agent")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": deviceCode,
            "client_id": Self.deviceClientId,
        ])
        URLSession(configuration: .ephemeral).dataTask(with: request) { data, response, _ in
            let token: (token: String, expiresIn: TimeInterval)? = {
                guard let data,
                      (response as? HTTPURLResponse)?.statusCode == 200,
                      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let access = object["access_token"] as? String, !access.isEmpty,
                      let expires = object["expires_in"] as? NSNumber else { return nil }
                return (token: access, expiresIn: expires.doubleValue)
            }()
            DispatchQueue.main.async { completion(token) }
        }.resume()
    }

    private func logout(admittedGeneration: UInt64) {
        // Reject new work and cancel in-flight tasks before the credential goes
        // away. The drain is empty on purpose: deletion below must not wait for
        // a cancelled stream to emit its terminal callback, or a logout could
        // strand the app quarantined with a live session.
        nativeAPIBridge?.beginQuarantine {}

        // A session may revoke itself, so kill it server-side before dropping
        // the Keychain item. Local deletion happens either way: leaving the
        // token on disk because the network failed would strand the app.
        let credential = currentOwnerCredential()
        var signedOut = true
        if let store = ownerCredentialStore {
            do { try store.deleteAndVerify() } catch { signedOut = false }
        }
        guard signedOut else {
            // The credential outlived the attempt. Reopen the bridge instead of
            // leaving the app unable to either use or drop the session.
            try? nativeAPIBridge?.endQuarantineAfterCredentialReadBack()
            notifyAuthChanged(authenticated: true, admittedGeneration: admittedGeneration)
            return
        }
        if let credential { revokeSession(credential.credential) }
        notifyAuthChanged(authenticated: false, admittedGeneration: admittedGeneration)
    }

    /// Revoke a device session server-side using the session's own token.
    /// Fire-and-forget: the local credential is already gone, so a failure here
    /// only means the row outlives this device until it expires or is revoked
    /// from Index web settings.
    ///
    /// - Parameter token: The session token being retired.
    private func revokeSession(_ token: String) {
        // apiBaseURL already ends in /api.
        guard let url = URL(string: AppConfig.apiBaseURL + "/auth/sign-out") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        URLSession(configuration: .ephemeral).dataTask(with: request).resume()
    }

    private func currentOwnerCredential() -> OwnerCredentialRecord? {
        guard let store = ownerCredentialStore else { return nil }
        do { return try store.loadCredential() }
        catch { return nil }
    }

    private func notifyAuthChanged(authenticated: Bool, admittedGeneration: UInt64) {
        guard webViewReady,
              admittedGeneration == trustedDocumentGeneration,
              webView.url?.standardizedFileURL == trustedBundledDocumentURL else { return }
        let value = authenticated ? "true" : "false"
        let js = """
        window.INDEX_NATIVE = Object.assign(window.INDEX_NATIVE || {}, { apiBaseUrl: \(jsonValue(AppConfig.apiBaseURL)), appUrl: \(jsonValue(AppConfig.trimTrailingSlash(AppConfig.appURL))), authenticated: \(value) });
        if (typeof window.__indexAuthChanged === 'function') { window.__indexAuthChanged(\(value)); }
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Matches JavaScript encodeURIComponent exactly: only A-Za-z0-9 and
    /// !'()*-._~ stay literal, everything else becomes uppercase %XX.
    static func encodeURIComponent(_ value: String) -> String {
        let allowed = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
        )
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
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
