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
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

_SESSION_ENV = "INDEX_SESSION_TOKEN"
_LEGACY_API_KEY_ENV = "INDEX_API_KEY"
_LEGACY_KEY_ID_ENV = "INDEX_API_KEY_ID"
_CALLBACK_HOST = "127.0.0.1"
_LOGIN_TIMEOUT_SECONDS = 180.0
_DEVICE_CLIENT_ID = "index-device"
# Mirrors env_transport: INDEX_API_URL already ends in /api, so auth paths hang
# directly off it rather than off the bare origin.
_DEFAULT_API = "https://protocol.index.network/api"


def api_root() -> str:
    """Resolve the API root (including its `/api` prefix) for auth calls."""
    return os.environ.get("INDEX_API_URL", _DEFAULT_API).strip().rstrip("/") or _DEFAULT_API

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


def persist_session_token(token: str) -> None:
    """Persist the device session token to `~/.hermes/.env` and the live process.

    Any API key left by an older install is removed in the same pass so the
    transport cannot keep authenticating with a credential nothing renews.
    """
    upsert_env_var(_SESSION_ENV, token)
    os.environ[_SESSION_ENV] = token
    clear_legacy_api_key()


def clear_legacy_api_key() -> None:
    """Remove an API key persisted by an install from before the device grant."""
    remove_env_var(_LEGACY_API_KEY_ENV)
    remove_env_var(_LEGACY_KEY_ID_ENV)
    os.environ.pop(_LEGACY_API_KEY_ENV, None)
    os.environ.pop(_LEGACY_KEY_ID_ENV, None)


def clear_session_token() -> None:
    """Remove the persisted session token from `~/.hermes/.env` and the process."""
    remove_env_var(_SESSION_ENV)
    os.environ.pop(_SESSION_ENV, None)
    clear_legacy_api_key()


def redeem_device_code(device_code: str) -> str | None:
    """Exchange an approved device code for this device's own session token.

    :param device_code: Code the browser claimed and approved for the owner.
    :returns: The session token, or None on any transport or status failure.
    """
    request = urllib.request.Request(
        f"{api_root()}/auth/device/token",
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
    except Exception:  # noqa: BLE001 - any failure means "not signed in".
        return None
    token = payload.get("access_token")
    return token if isinstance(token, str) and token else None


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


def _callback_html(title: str, message: str) -> str:
    return (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        f"<title>{title}</title></head><body style=\"font-family:system-ui;"
        "text-align:center;padding-top:80px;color:#111\">"
        f"<h2>{title}</h2><p>{message}</p></body></html>"
    )


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

        def _respond(self, code: int, title: str, message: str) -> None:
            body = _callback_html(title, message).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - stdlib handler contract
            parsed = urlparse(self.path)
            if parsed.path != "/callback":
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Not Found")
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
            device_code = (params.get("device_code") or [None])[0]
            if device_code:
                session.device_code = device_code
                session.status = "success"
                self._respond(200, "Signed in to Index", "You can close this tab and return to Hermes.")
                return
            session.status = "failed"
            session.error = "No device code was received in the callback."
            self._respond(400, "Authorization failed", "Incomplete sign-in received. Please try again.")

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
    token = redeem_device_code(device_code)
    if not token:
        return {"status": "failed", "error": "Could not complete device sign-in. Please try again."}
    persist_session_token(token)
    return {"status": "success"}
