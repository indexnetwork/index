"""CLI tools and direct HTTP operations using this device's Index session token."""

from __future__ import annotations

import base64
import json
import os
import subprocess
import urllib.error
import urllib.request
from typing import Any, Iterator

_DEFAULT_API = "https://protocol.index.network"

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
    """The production transport for CLI tools, dashboard HTTP, uploads, and streams."""

    def __init__(self) -> None:
        self._api_key = os.environ.get("INDEX_SESSION_TOKEN", "").strip()
        if not self._api_key:
            raise TransportError("api_key_missing", _API_KEY_HELP)
        self._origin = os.environ.get("INDEX_API_URL", _DEFAULT_API).strip().rstrip("/") or _DEFAULT_API
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

    def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Invoke the installed matching CLI once; credentials never enter argv."""
        env = dict(os.environ)
        env["INDEX_SESSION_TOKEN"] = self._api_key
        env.pop("INDEX_API_KEY", None)
        try:
            result = subprocess.run(
                ["index", "--api-url", self._origin, "tool", "call", tool_name,
                 "--query", json.dumps(arguments), "--json"],
                env=env, capture_output=True, text=True, check=False, timeout=self._timeout(),
            )
        except FileNotFoundError as exc:
            raise TransportError("cli_missing", "Install @indexnetwork/cli@0.24.0 on the Hermes process PATH.") from exc
        except subprocess.TimeoutExpired as exc:
            raise TransportError("cli_timeout", "Index CLI timed out. Re-read state before deciding whether to write again.") from exc
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise TransportError("cli_invalid_response", "Index CLI did not return JSON.") from exc
        if not isinstance(payload, dict):
            raise TransportError("cli_invalid_response", "Index CLI did not return an object.")
        if result.returncode != 0:
            payload["success"] = False
        return payload

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
