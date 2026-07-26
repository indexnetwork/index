import UIKit
import WebKit

// iOS counterpart to the macOS IndexApp shell: a full-screen WKWebView that
// loads the bundled, self-contained index.html. The web layer reads the system
// safe-area insets via CSS env(safe-area-inset-*), so the view fills the whole
// screen (including under the notch and home indicator) and the React app keeps
// its own chrome clear of them.

final class RootViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        // Same file:// blob allowances as the macOS build, so the inlined bundle
        // can read any sibling assets it creates.
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        if #available(iOS 14.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }
        // It's a single-screen app — no pinch-zoom, no scroll bounce on the body.
        config.allowsInlineMediaPlayback = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0x00/255.0, green: 0x55/255.0, blue: 0xAA/255.0, alpha: 1.0)
        webView.scrollView.backgroundColor = .clear
        // The page manages its own scrolling regions; the outer view never bounces.
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        loadBundledHTML()
    }

    // Match the Workbench desktop blue under the status bar / home indicator.
    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    private func loadBundledHTML() {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html") else {
            presentError("Could not locate index.html inside the app bundle.")
            return
        }
        let dir = url.deletingLastPathComponent()
        webView.loadFileURL(url, allowingReadAccessTo: dir)
    }

    private func presentError(_ message: String) {
        let alert = UIAlertController(title: "index — pocket", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    // Surface JS alert() as a native dialog, mirroring the macOS shell.
    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        presentError("Failed to load: \(error.localizedDescription)")
    }
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let win = UIWindow(frame: UIScreen.main.bounds)
        win.rootViewController = RootViewController()
        win.backgroundColor = UIColor(red: 0x00/255.0, green: 0x55/255.0, blue: 0xAA/255.0, alpha: 1.0)
        win.makeKeyAndVisible()
        self.window = win
        return true
    }
}

UIApplicationMain(
    CommandLine.argc,
    CommandLine.unsafeArgv,
    nil,
    NSStringFromClass(AppDelegate.self)
)
