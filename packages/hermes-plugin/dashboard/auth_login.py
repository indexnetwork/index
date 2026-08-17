"""Mac/CLI-parity browser login for the Hermes Index dashboard.

Runs the same `/cli-auth` handshake used by `apps/mac` and `packages/cli`:

1. Bind an ephemeral loopback HTTP listener.
2. Open `{appUrl}/cli-auth?callback=…&version=2&state=…` in the browser.
3. The web app mints a CLI API key and redirects to the callback with
   `api_key` + `key_id`.
4. Persist that CLI key, then replace it with a Hermes agent-bound token
   (register/reuse the agent and mint) so pickup can authenticate.

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
from typing import Any, Callable
from urllib.parse import parse_qs, urlencode, urlparse

_API_KEY_ENV = "INDEX_API_KEY"
_KEY_ID_ENV = "INDEX_API_KEY_ID"
_CALLBACK_HOST = "127.0.0.1"
_LOGIN_TIMEOUT_SECONDS = 180.0

_lock = threading.Lock()
_session: "_LoginSession | None" = None
_post_login: Callable[[str, str | None], dict[str, Any]] | None = None


def set_post_login(callback: Callable[[str, str | None], dict[str, Any]] | None) -> None:
    """Install the CLI→agent-key promotion run after a successful handshake."""
    global _post_login
    _post_login = callback


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
            api_key = (params.get("api_key") or [None])[0]
            key_id = (params.get("key_id") or [None])[0]
            if api_key and key_id:
                session.api_key = api_key
                session.key_id = key_id
                session.status = "success"
                self._respond(200, "Signed in to Index", "You can close this tab and return to Hermes.")
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


def poll_status() -> dict[str, Any]:
    """Report and, on success, persist the pending login's result.

    Returns `{status: idle|pending|success|failed, error?, negotiatorReady?}`.
    Success and failure are terminal: the loopback listener is torn down
    before returning. The CLI key is persisted first, then optional
    post-login promotion may replace it with a Hermes agent token.
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
    if not api_key:
        return {"status": "failed", "error": "Login completed without a credential."}
    persist_api_key(api_key, key_id)
    extra: dict[str, Any] = {}
    if _post_login is not None:
        try:
            extra = _post_login(api_key, key_id) or {}
        except Exception as exc:  # noqa: BLE001 - login stays signed in as the CLI key.
            extra = {"negotiatorReady": False, "error": str(exc)}
    return {"status": "success", **extra}
