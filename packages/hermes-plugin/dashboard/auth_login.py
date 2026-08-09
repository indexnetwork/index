"""Mac/CLI-parity browser login for the Hermes Index dashboard.

Runs the same `/cli-auth` handshake used by `apps/mac` and `packages/cli`:

1. Bind an ephemeral loopback HTTP listener.
2. Open `{appUrl}/cli-auth?callback=…&version=2&state=…` in the browser.
3. The web app mints a CLI API key and redirects to the callback with
   `api_key` + `key_id`.
4. Persist the key into `~/.hermes/.env` and `os.environ` so subsequent
   `_api_request` / MCP calls in this process use it immediately.

Login start returns right away; the frontend polls the status until the
callback lands (or the attempt times out). Only one login runs at a time.
"""

from __future__ import annotations

import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

_API_KEY_ENV = "INDEX_API_KEY"
_KEY_ID_ENV = "INDEX_API_KEY_ID"
_CALLBACK_HOST = "127.0.0.1"
_LOGIN_TIMEOUT_SECONDS = 180.0

_lock = threading.Lock()
_session: "_LoginSession | None" = None


def _env_path() -> Path:
    """Resolve the Hermes `.env` file (overridable for tests via HERMES_ENV_PATH)."""
    override = os.environ.get("HERMES_ENV_PATH", "").strip()
    if override:
        return Path(override)
    return Path(os.path.expanduser("~/.hermes/.env"))


def _matches_key(line: str, name: str) -> bool:
    stripped = line.lstrip()
    return stripped.startswith(f"{name}=") or stripped.startswith(f"export {name}=")


def upsert_env_var(name: str, value: str, path: Path | None = None) -> None:
    """Insert or update `NAME=value` in the Hermes `.env`, leaving other vars intact."""
    target = path or _env_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    lines = target.read_text(encoding="utf-8").splitlines() if target.exists() else []
    replaced = False
    for index, line in enumerate(lines):
        if _matches_key(line, name):
            lines[index] = f"{name}={value}"
            replaced = True
            break
    if not replaced:
        lines.append(f"{name}={value}")
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")


def remove_env_var(name: str, path: Path | None = None) -> None:
    """Remove every `NAME=` (or `export NAME=`) entry from the Hermes `.env`."""
    target = path or _env_path()
    if not target.exists():
        return
    kept = [line for line in target.read_text(encoding="utf-8").splitlines() if not _matches_key(line, name)]
    target.write_text(("\n".join(kept) + "\n") if kept else "", encoding="utf-8")


def persist_api_key(api_key: str, key_id: str | None) -> None:
    """Persist the minted key (and its id) to `~/.hermes/.env` and the live process."""
    upsert_env_var(_API_KEY_ENV, api_key)
    os.environ[_API_KEY_ENV] = api_key
    if key_id:
        upsert_env_var(_KEY_ID_ENV, key_id)
        os.environ[_KEY_ID_ENV] = key_id


def clear_api_key() -> None:
    """Remove the persisted key + id from `~/.hermes/.env` and the live process."""
    remove_env_var(_API_KEY_ENV)
    remove_env_var(_KEY_ID_ENV)
    os.environ.pop(_API_KEY_ENV, None)
    os.environ.pop(_KEY_ID_ENV, None)


# The web frontend's index-wordmark.svg, inlined (same as apps/mac) so the page
# renders the same header without depending on the web origin being reachable.
_WORDMARK_SVG = """\
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
</svg>"""


def _callback_html(title: str, message: str, ok: bool = False) -> str:
    """Landing-styled response page matching the Mac app's login callback:
    web frontend header (wordmark on the dark green background) with a
    centered status, and a check on success."""
    check = (
        '<div class="check"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#0b1612" '
        'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>'
        if ok
        else ""
    )
    return f"""\
<!doctype html><html><head><meta charset="utf-8"><title>{title} · index</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Public+Sans:wght@300;400;500;600&display=swap">
<style>
body{{margin:0;min-height:100vh;display:flex;flex-direction:column;background:#14241f;color:#F4FBF6;\
font-family:'Public Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
.nav{{display:flex;align-items:center;padding:22px 56px}}
.nav svg{{height:14px;width:auto;display:block}}
main{{flex:1;display:flex;align-items:center;justify-content:center;padding:24px}}
.c{{text-align:center;max-width:420px}}
.check{{width:56px;height:56px;margin:0 auto 26px;border-radius:50%;background:#3FBF7F;\
display:flex;align-items:center;justify-content:center}}
h1{{font-size:20px;font-weight:600;margin:0 0 10px}}
p{{font-size:14px;font-weight:500;margin:0;color:rgba(244,251,246,0.78)}}
</style></head>
<body><nav class="nav">{_WORDMARK_SVG}</nav>
<main><div class="c">{check}<h1>{title}</h1><p>{message}</p></div></main></body></html>
"""


class _LoginSession:
    def __init__(self, state: str, server: HTTPServer) -> None:
        self.state = state
        self.server = server
        self.port = server.server_address[1]
        self.status = "pending"  # pending | success | failed
        self.error: str | None = None
        self.api_key: str | None = None
        self.key_id: str | None = None
        self.consumed = False
        self.created_at = time.monotonic()

    def expired(self) -> bool:
        return (time.monotonic() - self.created_at) > _LOGIN_TIMEOUT_SECONDS


def _make_handler(session: _LoginSession):
    class _CallbackHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args) -> None:  # noqa: A003 - silence stdlib logging
            pass

        def _respond(self, code: int, title: str, message: str, ok: bool = False) -> None:
            body = _callback_html(title, message, ok).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - stdlib handler contract
            parsed = urlparse(self.path)
            if parsed.path != "/callback":
                self._respond(404, "Not found", "Unexpected request.")
                return
            params = parse_qs(parsed.query)
            state = (params.get("state") or [None])[0]
            if not session.state or state != session.state:
                self._respond(400, "Authorization failed", "Invalid login state. Return to Hermes and try again.")
                return
            if session.consumed:
                self._respond(409, "Already completed", "This login callback has already been used.")
                return
            session.consumed = True
            api_key = (params.get("api_key") or [None])[0]
            key_id = (params.get("key_id") or [None])[0]
            if api_key and key_id:
                session.api_key = api_key
                session.key_id = key_id
                session.status = "success"
                self._respond(200, "Signed in to Index", "You can close this tab and return to Hermes.", ok=True)
                return
            session.status = "failed"
            session.error = (
                "CLI API-key callback did not include its key id."
                if api_key
                else "No CLI credential was received in the callback."
            )
            self._respond(400, "Authorization failed", "Incomplete credentials received. Please try again.")

    return _CallbackHandler


def _shutdown_locked() -> None:
    global _session
    if _session is not None:
        try:
            _session.server.shutdown()
            _session.server.server_close()
        except Exception:  # noqa: BLE001 - teardown is best-effort.
            pass
        _session = None


def start_login(app_base_url: str) -> str:
    """Bind a fresh loopback listener and return the `/cli-auth` URL to open."""
    global _session
    state = secrets.token_urlsafe(32)
    server = HTTPServer((_CALLBACK_HOST, 0), BaseHTTPRequestHandler)
    session = _LoginSession(state, server)
    server.RequestHandlerClass = _make_handler(session)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    with _lock:
        _shutdown_locked()
        _session = session
    callback = f"http://{_CALLBACK_HOST}:{session.port}/callback"
    query = urlencode({"callback": callback, "version": "2", "state": state})
    return f"{app_base_url.rstrip('/')}/cli-auth?{query}"


def poll_status() -> dict[str, str | None]:
    """Report and, on success, persist the pending login's result.

    Returns `{status: idle|pending|success|failed, error?}`. Success and
    failure are terminal: the loopback listener is torn down before returning.
    """
    with _lock:
        session = _session
        if session is None:
            return {"status": "idle"}
        if session.status == "pending" and session.expired():
            session.status = "failed"
            session.error = "Login timed out. Please try again."
        if session.status == "success":
            api_key, key_id = session.api_key, session.key_id
            _shutdown_locked()
        elif session.status == "failed":
            error = session.error or "Login failed."
            _shutdown_locked()
            return {"status": "failed", "error": error}
        else:
            return {"status": "pending"}
    if api_key:
        persist_api_key(api_key, key_id)
        return {"status": "success"}
    return {"status": "failed", "error": "Login completed without a credential."}
