"""Direct HTTP operations using this device's Index session token."""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterator

_DEFAULT_API = "https://protocol.index.network"
_INDEX_DOMAIN = "index.network"
NEGOTIATOR_PROFILE = "negotiator"


def hermes_env_path() -> Path:
    """The default Hermes `.env` (overridable for tests via HERMES_ENV_PATH)."""
    override = os.environ.get("HERMES_ENV_PATH", "").strip()
    if override:
        return Path(override)
    return Path.home() / ".hermes" / ".env"


def negotiator_env_path() -> Path | None:
    """The negotiator profile `.env`, once that profile directory exists."""
    try:
        from hermes_cli.profiles import get_profile_dir
    except ImportError:
        return None
    directory = get_profile_dir(NEGOTIATOR_PROFILE)
    if not directory.is_dir():
        return None
    return directory / ".env"


def _matches_env_key(line: str, name: str) -> bool:
    stripped = line.lstrip()
    return stripped.startswith(f"{name}=") or stripped.startswith(f"export {name}=")


def upsert_env_file(path: Path, name: str, value: str) -> None:
    """Insert or update `NAME=value` in one env file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    replaced = False
    for index, line in enumerate(lines):
        if _matches_env_key(line, name):
            lines[index] = f"{name}={value}"
            replaced = True
            break
    if not replaced:
        lines.append(f"{name}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def remove_env_file(path: Path, name: str) -> None:
    """Remove every `NAME=` entry from one env file."""
    if not path.exists():
        return
    kept = [line for line in path.read_text(encoding="utf-8").splitlines() if not _matches_env_key(line, name)]
    path.write_text(("\n".join(kept) + "\n") if kept else "", encoding="utf-8")


def _stored_env(name: str) -> str:
    """One Hermes env value, from the process or the gateway env file."""
    value = os.environ.get(name, "").strip().strip('"').strip("'")
    if value:
        return value
    path = hermes_env_path()
    if not path.is_file():
        return ""
    prefix = f"{name}="
    export = f"export {name}="
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith(prefix) or stripped.startswith(export):
            raw = stripped.split("=", 1)[1].strip().strip('"').strip("'")
            if raw:
                os.environ[name] = raw
            return raw
    return ""


def ensure_negotiator_api_key() -> str:
    """Return `INDEX_API_KEY`, minting one from the device session when it is missing.

    The secret is returned only on create, so it is written to the gateway env
    before the caller starts the negotiator. It is not copied onto the
    negotiator profile.

    @returns The API key.
    @throws RuntimeError when no session is available or the mint fails.
    """
    existing = _stored_env("INDEX_API_KEY")
    if existing:
        return existing
    token = _stored_env("INDEX_SESSION_TOKEN")
    if not token:
        raise RuntimeError("INDEX_API_KEY is required to run the Index negotiator.")
    endpoint = api_origin() + "/api/auth/api-key/create"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps({"name": "Hermes"}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Index-Hermes",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:200].strip()
        raise RuntimeError(f"Could not mint an Index API key ({exc.code}{': ' + detail if detail else ''}).") from exc
    except Exception as exc:  # noqa: BLE001 - transport, DNS, or a malformed body.
        raise RuntimeError(f"Could not reach {endpoint}: {exc}") from exc
    key = payload.get("key") if isinstance(payload, dict) else None
    if not isinstance(key, str) or not key.strip():
        raise RuntimeError(f"{endpoint} returned no API key.")
    key = key.strip()
    upsert_env_file(hermes_env_path(), "INDEX_API_KEY", key)
    os.environ["INDEX_API_KEY"] = key
    return key


def upsert_index_env(name: str, value: str, path: Path | None = None) -> None:
    """Write one env var to the gateway Hermes env.

    The negotiator profile is only the model home, so Index credentials stay
    on the gateway env.
    """
    upsert_env_file(path or hermes_env_path(), name, value)


def remove_index_env(name: str, path: Path | None = None) -> None:
    """Remove one env var from the gateway Hermes env and a leftover on the negotiator profile."""
    remove_env_file(path or hermes_env_path(), name)
    if path is None and name.startswith("INDEX_"):
        extra = negotiator_env_path()
        if extra is not None:
            remove_env_file(extra, name)


def api_origin() -> str:
    """Resolve the Index API origin, without its `/api` prefix.

    `INDEX_API_URL` wins. Failing that the origin is derived from
    `INDEX_APP_BASE_URL` by adding the `protocol.` host label
    (`dev.index.network` -> `protocol.dev.index.network`), because sign-in and
    every REST call have to name one environment: an env carrying only the web
    origin would otherwise approve a device code on dev and redeem it on
    production, which answers 404. Hosts outside `index.network` are left alone,
    since a local API's port cannot be derived from the web app's.
    """
    configured = os.environ.get("INDEX_API_URL", "").strip().rstrip("/")
    if configured:
        return configured.removesuffix("/api")
    app_url = os.environ.get("INDEX_APP_BASE_URL", "").strip().rstrip("/")
    if not app_url:
        return _DEFAULT_API
    parts = urllib.parse.urlsplit(app_url)
    host = parts.netloc
    if parts.scheme not in ("http", "https") or not host:
        return _DEFAULT_API
    if host != _INDEX_DOMAIN and not host.endswith(f".{_INDEX_DOMAIN}"):
        return _DEFAULT_API
    if host.startswith("protocol."):
        return f"{parts.scheme}://{host}"
    return f"{parts.scheme}://protocol.{host}"

_API_KEY_HELP = (
    "Sign in from the Hermes dashboard (log in with browser), or set "
    "INDEX_SESSION_TOKEN in the Hermes environment as a manual override."
)


class TransportError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_payload(self) -> dict[str, Any]:
        return {"success": False, "error": self.message, "code": self.code}


class EnvironmentCredentialTransport:
    """The production transport for tool handlers, dashboard HTTP, uploads, and streams."""

    def __init__(self) -> None:
        self._api_key = os.environ.get("INDEX_SESSION_TOKEN", "").strip()
        if not self._api_key:
            raise TransportError("api_key_missing", _API_KEY_HELP)
        self._origin = api_origin()
        self._api = self._origin + "/api"

    def _headers(self, *, content_type: str = "application/json", accept: str = "application/json") -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": content_type,
            "Accept": accept,
        }

    @staticmethod
    def _timeout() -> float:
        try:
            value = float(os.environ.get("INDEX_HTTP_TIMEOUT_SECONDS", "30"))
            return value if value > 0 else 30.0
        except ValueError:
            return 30.0

    @staticmethod
    def _decode(data: bytes) -> Any:
        if not data:
            return None
        return json.loads(data.decode("utf-8", errors="replace"))

    def status(self) -> dict[str, Any]:
        payload = self.request_rest("GET", "/auth/me")
        connected = payload.get("success") is not False
        return {
            "connected": connected,
            "accountLabel": None,
            "installationId": os.environ.get("INDEX_INSTALLATION_ID") or None,
            "actions": [],
            "expiresAt": None,
            "health": "active" if connected else "disconnected",
            "revocationPending": False,
            "reconnectSoon": False,
            "reconnectRequired": False,
        }

    def start_authorization(self) -> dict[str, Any]:
        raise TransportError("api_key_required", _API_KEY_HELP)

    def poll_authorization(self) -> dict[str, Any]:
        return {"status": "idle"}

    def request_rest(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = self._headers()
        request = urllib.request.Request(
            self._api + (path if path.startswith("/") else "/" + path),
            data=data,
            headers=headers,
            method=method.upper(),
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout()) as response:
                status = getattr(response, "status", getattr(response, "code", 200))
                payload = self._decode(response.read())
                if status == 204 or payload is None:
                    return {"success": True, "no_content": True}
                return payload if isinstance(payload, dict) else {"success": True, "data": payload}
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")[:2000]
            payload: dict[str, Any] = {
                "success": False,
                "error": f"Index API HTTP request failed with status {exc.code}.",
                "status": exc.code,
            }
            if raw:
                try:
                    details = json.loads(raw)
                except json.JSONDecodeError:
                    payload["body"] = raw
                else:
                    payload["details"] = details
            return payload
        except urllib.error.URLError as exc:
            return {
                "success": False,
                "error": f"Index API request failed: {exc.reason}",
                "code": "network_error",
            }

    def disconnect(self) -> dict[str, Any]:
        self._api_key = ""
        return {"status": "disconnected"}

    def upload(
        self, path: str, field: str, filename: str, content: bytes, content_type: str
    ) -> dict[str, Any]:
        boundary = "----IndexHermesBoundary" + base64.urlsafe_b64encode(os.urandom(12)).decode().rstrip("=")
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
        request = urllib.request.Request(
            self._api + path, data=body,
            headers=self._headers(content_type=f"multipart/form-data; boundary={boundary}"), method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout()) as response:
                payload = self._decode(response.read())
                return payload if isinstance(payload, dict) else {"success": True, "data": payload}
        except urllib.error.HTTPError as exc:
            return {"success": False, "error": f"Upload failed with status {exc.code}.", "status": exc.code}

    def stream_sse(self, path: str) -> Iterator[bytes]:
        request = urllib.request.Request(
            self._api + path,
            headers=self._headers(accept="text/event-stream"), method="GET",
        )
        response = urllib.request.urlopen(request, timeout=75)
        try:
            while True:
                line = response.readline()
                if not line:
                    return
                yield line
        finally:
            response.close()
