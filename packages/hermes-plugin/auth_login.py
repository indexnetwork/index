"""Mac/CLI-parity browser login for the Hermes Index dashboard.

Runs the same `/cli-auth` handshake used by `apps/mac` and `packages/cli`:

1. Bind an ephemeral loopback HTTP listener.
2. Open `{appUrl}/cli-auth?callback=…&version=2&state=…` in the browser.
3. The web app runs the device authorization grant against the owner's browser
   session and redirects to the callback with the approved `device_code`.
4. Redeem that code for this device's own session token and persist it. It
   authenticates as the user; which agent speaks for them is `GET /agents/me`.

Login start returns right away; the frontend polls the status until the
callback lands (or the attempt times out). Only one login runs at a time.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

from .env_transport import api_origin, remove_index_env, upsert_index_env

_SESSION_ENV = "INDEX_SESSION_TOKEN"
_CALLBACK_HOST = "127.0.0.1"
_LOGIN_TIMEOUT_SECONDS = 180.0
_DEVICE_CLIENT_ID = "index-device"


def api_root() -> str:
    """Resolve the API root (including its `/api` prefix) for auth calls.

    Shares the transport's resolver so the code approved in the browser is
    redeemed against the same environment every later request uses.
    """
    return api_origin() + "/api"

_lock = threading.Lock()
_session: "_LoginSession | None" = None


def upsert_env_var(name: str, value: str, path: Path | None = None) -> None:
    """Insert or update `NAME=value` in the Hermes `.env`, leaving other vars intact."""
    upsert_index_env(name, value, path)


def remove_env_var(name: str, path: Path | None = None) -> None:
    """Remove every `NAME=` (or `export NAME=`) entry from the Hermes `.env`.

    A leftover Index var on the negotiator profile is removed with it.
    """
    remove_index_env(name, path)


def persist_session_token(token: str) -> None:
    """Persist the device session and the API host that issued it.

    The host has to be stored with the token. A later process that sees only the
    token otherwise calls production with a dev or local session.
    """
    upsert_env_var(_SESSION_ENV, token)
    os.environ[_SESSION_ENV] = token
    from .env_transport import remember_api_origin

    remember_api_origin(api_origin())
    from .transport import reset_transport

    reset_transport()
    from .mcp import sync_index_mcp

    sync_index_mcp()


def clear_session_token() -> None:
    """Remove the persisted session token from the Hermes env file and the process."""
    remove_env_var(_SESSION_ENV)
    os.environ.pop(_SESSION_ENV, None)
    from .mcp import sync_index_mcp

    sync_index_mcp()


def _http_error_detail(exc: urllib.error.HTTPError) -> str:
    """Summarize an error body, preferring the grant's `error_description`."""
    try:
        raw = exc.read().decode("utf-8", errors="replace")[:200].strip()
    except Exception:  # noqa: BLE001 - the status alone is still worth reporting.
        return ""
    if not raw:
        return ""
    try:
        parsed = json.loads(raw)
    except ValueError:
        return f": {raw}"
    if isinstance(parsed, dict):
        described = parsed.get("error_description") or parsed.get("error")
        if described:
            return f": {described}"
    return f": {raw}"


def redeem_device_code(device_code: str) -> tuple[str | None, str | None]:
    """Exchange an approved device code for this device's own session token.

    :param device_code: Code the browser claimed and approved for the owner.
    :returns: `(token, None)` on success, else `(None, reason)`. The reason names
        the endpoint and status, because the common cause is an environment
        answering for a code it never issued.
    """
    endpoint = f"{api_root()}/auth/device/token"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": device_code,
                "client_id": _DEVICE_CLIENT_ID,
            }
        ).encode("utf-8"),
        # The session records this request's user agent, and that is what names
        # the device in Index settings.
        headers={"Content-Type": "application/json", "User-Agent": "Index-Hermes"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return None, f"{endpoint} rejected the device code ({exc.code}{_http_error_detail(exc)})."
    except Exception as exc:  # noqa: BLE001 - transport, DNS, or malformed body.
        return None, f"Could not reach {endpoint}: {exc}"
    token = payload.get("access_token") if isinstance(payload, dict) else None
    if isinstance(token, str) and token:
        return token, None
    return None, f"{endpoint} returned no access token."


def revoke_session(token: str) -> bool:
    """Revoke a device session server-side using the session's own token.

    :param token: The session token to revoke.
    :returns: Whether the server confirmed the revocation.
    """
    request = urllib.request.Request(
        f"{api_root()}/auth/sign-out",
        data=b"",
        headers={"Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return 200 <= response.status < 300
    except Exception:  # noqa: BLE001 - best-effort; local state is cleared anyway.
        return False


_CHECK_SVG = (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" '
    'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
)


def _callback_html(title: str, message: str, ok: bool = False) -> str:
    """Callback page in the web app's sign-in status look (/cli-auth "you're
    signed in"): title and grey line in a narrow centred column, green check
    when it worked. The CLI's loopback page is the same."""
    check = f'<div class="check" aria-hidden="true">{_CHECK_SVG}</div>' if ok else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · index</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>
*{{box-sizing:border-box}}
html,body{{margin:0}}
body{{
  min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px;
  background:#fdfdfd;color:#141414;
  font:400 13px/1.4 "IBM Plex Sans","Helvetica Neue",-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased;
}}
main{{width:100%;max-width:432px;display:flex;flex-direction:column;gap:24px}}
h1{{margin:0;font-size:22px;font-weight:600;line-height:1.3;text-wrap:pretty}}
.status{{display:flex;flex-direction:column;align-items:flex-start;gap:12px}}
.check{{width:28px;height:28px;border-radius:3px;background:#3b7a57;color:#fff;display:flex;align-items:center;justify-content:center}}
p{{margin:0;font-size:13px;line-height:1.6;color:#555}}
@media (max-width:600px){{main{{gap:20px}}}}
</style></head>
<body>
<main><h1>{title}</h1><div class="status">{check}<p>{message}</p></div></main>
</body></html>"""


class _LoginSession:
    def __init__(self, state: str, server: HTTPServer) -> None:
        self.state = state
        self.server = server
        self.port = server.server_address[1]
        self.status = "pending"  # pending | success | failed
        self.error: str | None = None
        self.device_code: str | None = None
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
                self._respond(404, "not found", "this isn't a sign-in callback.")
                return
            params = parse_qs(parsed.query)
            state = (params.get("state") or [None])[0]
            if not session.state or state != session.state:
                self._respond(400, "sign-in didn't go through", "this sign-in doesn't match the one hermes started. sign in from hermes again.")
                return
            if session.consumed:
                self._respond(409, "already signed in", "this sign-in link was already used. you can close this tab.")
                return
            session.consumed = True
            device_code = (params.get("device_code") or [None])[0]
            if device_code:
                session.device_code = device_code
                session.status = "success"
                self._respond(200, "you're signed in", "you can close this tab and go back to hermes.", ok=True)
                return
            session.status = "failed"
            session.error = "No device code was received in the callback."
            self._respond(400, "sign-in didn't go through", "the sign-in came back incomplete. sign in from hermes again.")

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


def accept_callback(url: str) -> bool:
    """Mark the pending login complete from a pasted callback URL.

    The browser lands on this host's loopback listener. On a remote machine
    that page never arrives, so the CLI accepts the same URL from stdin.
    A URL that does not match the pending login is ignored, and the listener
    can still finish it.

    :param url: The address bar value, including `state` and `device_code`.
    :returns: Whether this login was marked complete.
    """
    params = parse_qs(urlparse(url.strip()).query)
    state = (params.get("state") or [None])[0]
    device_code = (params.get("device_code") or [None])[0]
    with _lock:
        session = _session
        if session is None or session.status != "pending" or session.consumed:
            return False
        if not session.state or state != session.state or not device_code:
            return False
        session.consumed = True
        session.device_code = device_code
        session.status = "success"
        return True


def poll_status() -> dict[str, Any]:
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
            device_code = session.device_code
            _shutdown_locked()
        elif session.status == "failed":
            error = session.error or "Login failed."
            _shutdown_locked()
            return {"status": "failed", "error": error}
        else:
            return {"status": "pending"}
    if not device_code:
        return {"status": "failed", "error": "Login completed without a device code."}
    # Redeem outside the lock: this is a network call, and the loopback
    # listener is already torn down.
    token, failure = redeem_device_code(device_code)
    if not token:
        return {"status": "failed", "error": failure or "Could not complete device sign-in."}
    persist_session_token(token)
    return {"status": "success"}
