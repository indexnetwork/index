"""Direct HTTP transport authenticated with the INDEX_API_KEY environment key."""

from __future__ import annotations

import base64
import json
import os
import secrets
import urllib.error
import urllib.request
from typing import Any, Iterator

_DEFAULT_API = "https://protocol.index.network/api"
_DEFAULT_MCP = "https://protocol.index.network/mcp"

_API_KEY_HELP = (
    "Sign in from the Hermes dashboard (log in with browser), or set "
    "INDEX_API_KEY in the Hermes environment as a manual override."
)


class TransportError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_payload(self) -> dict[str, Any]:
        return {"success": False, "error": self.message, "code": self.code}


class EnvironmentCredentialTransport:
    """The production transport: plain HTTPS with an `x-api-key` header."""

    def __init__(self) -> None:
        self._api_key = os.environ.get("INDEX_API_KEY", "").strip()
        if not self._api_key:
            raise TransportError("api_key_missing", _API_KEY_HELP)
        self._api = os.environ.get("INDEX_API_URL", _DEFAULT_API).strip().rstrip("/") or _DEFAULT_API
        self._mcp = os.environ.get("INDEX_MCP_URL", _DEFAULT_MCP).strip() or _DEFAULT_MCP

    def _headers(self, *, content_type: str = "application/json", accept: str = "application/json") -> dict[str, str]:
        return {"x-api-key": self._api_key, "Content-Type": content_type, "Accept": accept}

    @staticmethod
    def _timeout() -> float:
        try:
            value = float(os.environ.get("INDEX_MCP_TIMEOUT_SECONDS", "30"))
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

    def call_mcp(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        data = json.dumps({
            "jsonrpc": "2.0", "id": secrets.randbits(53), "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }).encode("utf-8")
        request = urllib.request.Request(
            self._mcp, data=data,
            headers=self._headers(accept="application/json, text/event-stream"), method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout()) as response:
                raw = response.read().decode("utf-8", errors="replace")
                if "text/event-stream" in response.headers.get("Content-Type", "").lower():
                    candidates = [line[5:].strip() for line in raw.splitlines() if line.startswith("data:") and line[5:].strip() != "[DONE]"]
                    if not candidates:
                        raise ValueError("SSE response did not contain data")
                    envelope = json.loads(candidates[-1])
                else:
                    envelope = json.loads(raw)
        except urllib.error.HTTPError as exc:
            raise TransportError("mcp_http_error", f"Index MCP request failed with status {exc.code}.") from exc
        except urllib.error.URLError as exc:
            raise TransportError("network_error", f"Index MCP request failed: {exc.reason}") from exc
        if not isinstance(envelope, dict) or "error" in envelope:
            error = envelope.get("error") if isinstance(envelope, dict) else None
            raise TransportError("mcp_error", str(error or "Index MCP request failed."))
        result = envelope.get("result")
        if not isinstance(result, dict):
            raise TransportError("mcp_invalid_response", "Index MCP returned an invalid response.")
        return result

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
