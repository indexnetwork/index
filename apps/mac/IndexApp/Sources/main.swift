import Cocoa
import WebKit

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

        let contentRect = NSRect(x: 0, y: 0, width: 1200, height: 800)
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
        window.minSize = NSSize(width: 640, height: 480)
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
