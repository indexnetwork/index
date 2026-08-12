import Cocoa
import WebKit
import Network
import Security

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
        let config = WKWebViewConfiguration()
        // Allow blob: URLs created from a file:// document to be fetched back 
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
        // window.INDEX_NATIVE (injected at document start from CredentialStore).
        config.userContentController.add(self, name: "indexAuth")
        config.userContentController.add(self, name: "hermesRuntime")
        config.userContentController.addUserScript(WKUserScript(
            source: Self.nativeInjectionScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))

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
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

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
        if message.name == "hermesRuntime" {
            handleHermesRuntimeMessage(message)
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

    // MARK: - Native auth bridge

    /// document-start script exposing the current API base + stored key to the
    /// page, plus the negotiator's saved avatar so it is already correct on the
    /// first paint rather than flashing a different face and then settling.
    private static func nativeInjectionScript() -> String {
        let cred = CredentialStore.load()
        let obj: [String: Any] = [
            "apiBaseUrl": AppConfig.apiBaseURL,
            // Share / invitation links use the configured web origin.
            "appUrl": AppConfig.trimTrailingSlash(AppConfig.appURL),
            "apiKey": cred?.key ?? NSNull(),
            "deepLinkHosts": AppConfig.deepLinkHosts,
        ]
        let json = (try? JSONSerialization.data(withJSONObject: obj))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        window.INDEX_NATIVE = \(json);
        window.INDEX_NATIVE.agentFace = \(AgentFaceStore.loadJSON());
        """
    }

    /// Begin the browser login flow: open /cli-auth with a one-time state and a
    /// loopback callback that captures the minted API key.
    private func startLogin(admittedGeneration: UInt64) {
        authServer?.stop()
        let state = randomState()
        let server = LoopbackAuthServer(state: state) { [weak self] result in
            DispatchQueue.main.async {
                self?.finishLogin(result, admittedGeneration: admittedGeneration)
            }
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
                self.finishLogin(
                    .failure(LoopbackAuthServer.AuthError.noPort),
                    admittedGeneration: admittedGeneration
                )
            }
        }
    }

    private func finishLogin(
        _ result: Result<(apiKey: String, keyId: String), Error>,
        admittedGeneration: UInt64
    ) {
        authServer?.stop()
        authServer = nil
        switch result {
        case .success(let cred):
            CredentialStore.save(StoredCredential(
                key: cred.apiKey, keyId: cred.keyId,
                apiUrl: AppConfig.trimTrailingSlash(AppConfig.apiURL)))
            notifyAuthChanged(apiKey: cred.apiKey, admittedGeneration: admittedGeneration)
        case .failure:
            // Null tells the page login didn't complete, so it returns to sign-in.
            notifyAuthChanged(apiKey: nil, admittedGeneration: admittedGeneration)
        }
    }

    private func logout(ownerId: String?, admittedGeneration: UInt64) {
        guard let ownerId,
              let evidence = hermesRuntime.logoutEvidence(ownerId: ownerId) else { return }
        if let cred = CredentialStore.load() { revokeCredential(cred) }
        CredentialStore.delete()
        hermesRuntime.finishLogoutEvidence(evidence)
        notifyAuthChanged(apiKey: nil, admittedGeneration: admittedGeneration)
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

    private func notifyAuthChanged(apiKey: String?, admittedGeneration: UInt64) {
        guard webViewReady,
              admittedGeneration == trustedDocumentGeneration,
              webView.url?.standardizedFileURL == trustedBundledDocumentURL else { return }
        let key = jsonValue(apiKey)
        let js = """
        window.INDEX_NATIVE = Object.assign(window.INDEX_NATIVE || {}, { apiBaseUrl: \(jsonValue(AppConfig.apiBaseURL)), appUrl: \(jsonValue(AppConfig.trimTrailingSlash(AppConfig.appURL))), apiKey: \(key) });
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
