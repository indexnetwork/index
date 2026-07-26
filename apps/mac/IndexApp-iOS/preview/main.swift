import Cocoa
import WebKit

// Preview shell — NOT the shipping app. A macOS WKWebView fixed at iPhone
// dimensions that loads the same assembled Resources/index.html, so the mobile
// React UI can be built and eyeballed on a machine that only has the Command
// Line Tools (no iOS SDK). The real app is Sources/main.swift (UIKit / iOS).

let PHONE_W: CGFloat = 393   // iPhone 15 logical points
let PHONE_H: CGFloat = 852

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        if #available(macOS 11.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }

        let rect = NSRect(x: 0, y: 0, width: PHONE_W, height: PHONE_H)
        webView = WKWebView(frame: rect, configuration: config)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(contentRect: rect,
                          styleMask: [.titled, .closable, .miniaturizable],
                          backing: .buffered, defer: false)
        window.title = "index — pocket (preview \(Int(PHONE_W))×\(Int(PHONE_H)))"
        window.backgroundColor = NSColor(srgbRed: 0x00/255.0, green: 0x55/255.0, blue: 0xAA/255.0, alpha: 1.0)
        // Deterministic placement (top-left, floating) so a screenshot can be
        // cropped to exactly the web view. Honored only in preview.
        if let screen = NSScreen.main {
            let top = screen.frame.maxY - 80
            window.setFrameTopLeftPoint(NSPoint(x: 40, y: top))
        }
        window.level = .floating
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        // Print the web view's pixel rectangle so a crop can be computed exactly.
        if let scr = window.screen {
            let scale = scr.backingScaleFactor
            let wf = webView.window!.convertToScreen(webView.convert(webView.bounds, to: nil))
            let px = wf.origin.x * scale
            // Cocoa origin is bottom-left; screencapture is top-left.
            let pyTop = (scr.frame.maxY - wf.maxY) * scale
            FileHandle.standardError.write(
                "PREVIEW_PX \(Int(px)) \(Int(pyTop)) \(Int(wf.width*scale)) \(Int(wf.height*scale)) scale \(scale)\n".data(using: .utf8)!)
        }

        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            let alert = NSAlert()
            alert.messageText = "index — preview"
            alert.informativeText = "Could not locate index.html in the bundle. Run assemble.py first."
            alert.runModal()
        }

        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate

let menu = NSMenu()
let appItem = NSMenuItem(); menu.addItem(appItem)
let appMenu = NSMenu(); appItem.submenu = appMenu
appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
app.mainMenu = menu

app.run()
