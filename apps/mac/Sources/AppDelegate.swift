import Cocoa
import WebKit
import Network
import Security
import UserNotifications
import CryptoKit

private extension CharacterSet {
    /// Matches JavaScript encodeURIComponent for the authorization tuple.
    static let urlQueryValueAllowed = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
    )
}

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
struct HermesRuntimeProgress: Encodable {
    let requestId: String
    let event: String
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
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
        config.userContentController.add(self, name: "hermesRuntime")
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

    // MARK: - Desktop notifications
    //
    // Delivery is native (UNUserNotificationCenter); everything else — which
    // events toast, copy, dedupe, preference gating — is decided by the web
    // layer before it posts here. The payload is {id,title,body,url?,imageUrl?}:
    // `url` is an index:// deep link replayed through deliverDeepLink on tap,
    // `imageUrl` an https avatar attached to the toast (fail-open on any error).

    private func postNotification(_ body: [String: Any]) {
        // Hermes-style background gating: never toast over the app itself.
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

    // MARK: - Native auth bridge

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
                            let queryValues = [
                                ("request_id", created.requestId),
                                ("state", state),
                                ("redirect_uri", redirect),
                            ]
                            page?.percentEncodedQuery = queryValues.compactMap { name, value in
                                value.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed)
                                    .map { "\(name)=\($0)" }
                            }.joined(separator: "&")
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
        window.INDEX_NATIVE = Object.assign(window.INDEX_NATIVE || {}, { apiBaseUrl: \(jsonValue(AppConfig.apiBaseURL)), appUrl: \(jsonValue(AppConfig.trimTrailingSlash(AppConfig.appURL))), authenticated: \(value) });
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
