import Foundation
import Network

/// Single-use loopback callback for the /cli-auth v2 handshake. It admits
/// exactly api_key/key_id/state and requires the one-time state to match.
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
        guard let firstLine = requestText.split(separator: "\r\n").first,
              firstLine.hasPrefix("GET "),
              let path = firstLine.split(separator: " ").dropFirst().first,
              let comps = URLComponents(string: "http://127.0.0.1\(path)"),
              comps.path == "/callback", comps.fragment == nil else {
            respond(conn, status: "404 Not Found", title: "Not found", message: "Unexpected request.")
            return
        }
        let items = comps.queryItems ?? []
        let names = items.map(\.name)
        guard items.count == 3, Set(names) == ["api_key", "key_id", "state"],
              names.allSatisfy({ name in names.filter { $0 == name }.count == 1 }) else {
            respond(conn, status: "400 Bad Request", title: "Authorization failed", message: "Invalid callback.")
            finish(.failure(AuthError.invalidCallback)); return
        }
        func q(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard q("state") == expectedState,
              let apiKey = q("api_key"), !apiKey.isEmpty, apiKey.count <= 256,
              let keyId = q("key_id"), !keyId.isEmpty, keyId.count <= 256,
              keyId.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            respond(conn, status: "400 Bad Request", title: "Authorization failed",
                    message: "Invalid login state. Return to Index and try again.")
            finish(.failure(AuthError.invalidCallback)); return
        }
        respond(conn, status: "200 OK", title: "Authentication complete",
                message: "You may now close this window", ok: true)
        finish(.success((apiKey: apiKey, keyId: keyId)))
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
