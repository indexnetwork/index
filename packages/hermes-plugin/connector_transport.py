"""Verified JSON-lines client for the signed native Index Connector."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import pathlib
import stat
import subprocess
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterator

DOWNLOAD_URL = "https://index.network/download"
PROTOCOL_VERSION = 1
_MAX_LINE_BYTES = 1_048_576
_MAX_UPLOAD_BYTES = 8_388_608
_UPLOAD_CHUNK_BYTES = 131_072
_RELEASE_KEYS = {
    "schemaVersion", "teamId", "bundleId", "designatedRequirement",
    "connectorProtocolVersion", "sha256", "downloadUrl",
}


class TransportError(RuntimeError):
    def __init__(self, code: str, message: str, *, download_url: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.download_url = download_url

    def as_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"success": False, "error": self.message, "code": self.code}
        if self.download_url:
            payload["downloadUrl"] = self.download_url
        return payload


class ConnectorTransport:
    """Launch and correlate requests with one verified connector subprocess."""

    def __init__(
        self,
        *,
        plugin_root: pathlib.Path | None = None,
        platform: str | None = None,
        candidate_paths: list[pathlib.Path] | None = None,
        command_runner: Callable[..., Any] = subprocess.run,
        process_factory: Callable[..., Any] = subprocess.Popen,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        import platform as platform_module

        self._plugin_root = pathlib.Path(plugin_root or pathlib.Path(__file__).resolve().parent)
        self._platform = (platform or platform_module.system()).lower()
        self._candidate_paths = candidate_paths
        self._command_runner = command_runner
        self._process_factory = process_factory
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._lock = threading.RLock()
        self._process = None
        self._verified_executable: pathlib.Path | None = None
        self._fixture_verified = False

    @classmethod
    def for_verified_fixture(cls, process: Any) -> "ConnectorTransport":
        transport = cls(platform="darwin", candidate_paths=[])
        transport._process = process
        transport._fixture_verified = True
        transport._handshake()
        return transport

    def _unverified(self) -> TransportError:
        return TransportError(
            "connector_unverified",
            "A verified Index Connector is required.",
            download_url=DOWNLOAD_URL,
        )

    def _paths(self) -> list[pathlib.Path]:
        if self._candidate_paths is not None:
            return list(self._candidate_paths)
        return [
            pathlib.Path("/Applications/Index Connector.app/Contents/MacOS/IndexConnector"),
            pathlib.Path.home() / "Applications/Index Connector.app/Contents/MacOS/IndexConnector",
        ]

    @staticmethod
    def _secure_regular_file(path: pathlib.Path, *, executable: bool) -> os.stat_result:
        try:
            info = path.lstat()
        except OSError as exc:
            raise TransportError("connector_unverified", "A verified Index Connector is required.", download_url=DOWNLOAD_URL) from exc
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise TransportError("connector_unverified", "A verified Index Connector is required.", download_url=DOWNLOAD_URL)
        if info.st_uid not in {0, os.getuid()} or info.st_mode & (
            stat.S_IWGRP | stat.S_IWOTH | stat.S_ISUID | stat.S_ISGID
        ):
            raise TransportError("connector_unverified", "A verified Index Connector is required.", download_url=DOWNLOAD_URL)
        if executable and not info.st_mode & stat.S_IXUSR:
            raise TransportError("connector_unverified", "A verified Index Connector is required.", download_url=DOWNLOAD_URL)
        return info

    def _decode_release_metadata(self) -> dict[str, Any]:
        cms_path = self._plugin_root / "connector-release.cms"
        self._secure_regular_file(cms_path, executable=False)
        result = self._command_runner(
            ["/usr/bin/security", "cms", "-D", "-i", str(cms_path)],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if result.returncode != 0:
            raise self._unverified()
        try:
            metadata = json.loads(result.stdout)
        except (TypeError, json.JSONDecodeError) as exc:
            raise self._unverified() from exc
        if not isinstance(metadata, dict) or set(metadata) != _RELEASE_KEYS:
            raise self._unverified()
        exact = (
            metadata.get("schemaVersion") == 1
            and metadata.get("bundleId") == "network.index.connector"
            and metadata.get("connectorProtocolVersion") == PROTOCOL_VERSION
            and metadata.get("downloadUrl") == DOWNLOAD_URL
            and isinstance(metadata.get("teamId"), str) and bool(metadata["teamId"])
            and metadata["teamId"].upper() not in {"TEAMID", "TEAM_ID", "REPLACE_ME", "PLACEHOLDER"}
            and isinstance(metadata.get("designatedRequirement"), str) and bool(metadata["designatedRequirement"])
            and "placeholder" not in metadata["designatedRequirement"].lower()
            and "replace_me" not in metadata["designatedRequirement"].lower()
            and isinstance(metadata.get("sha256"), str) and len(metadata["sha256"]) == 64
            and metadata["sha256"] != "0" * 64
        )
        if not exact:
            raise self._unverified()
        return metadata

    def _verify_executable(self) -> pathlib.Path:
        if self._fixture_verified:
            return pathlib.Path("/fixture/IndexConnector")
        if self._platform != "darwin":
            raise self._unverified()
        executable = next((path for path in self._paths() if path.exists()), None)
        if executable is None:
            raise self._unverified()
        for component in (executable, executable.parent, executable.parent.parent, executable.parent.parent.parent):
            if component.is_symlink():
                raise self._unverified()
        self._secure_regular_file(executable, executable=True)
        metadata = self._decode_release_metadata()
        verified = self._command_runner(
            ["/usr/bin/codesign", "--verify", "--strict", str(executable)],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if verified.returncode != 0:
            raise self._unverified()
        result = self._command_runner(
            ["/usr/bin/codesign", "-d", "-r-", "--verbose=4", str(executable)],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        details = f"{result.stdout or ''}\n{result.stderr or ''}"
        fields: dict[str, str] = {}
        requirement = None
        for raw in details.splitlines():
            line = raw.strip()
            if "=" in line:
                key, value = line.split("=", 1)
                fields[key.strip()] = value.strip()
            if line.startswith("designated =>"):
                requirement = line.removeprefix("designated =>").strip()
        digest = hashlib.sha256(executable.read_bytes()).hexdigest()
        if (
            result.returncode != 0
            or fields.get("TeamIdentifier") != metadata["teamId"]
            or fields.get("Identifier") != metadata["bundleId"]
            or requirement != metadata["designatedRequirement"]
            or digest.lower() != metadata["sha256"].lower()
        ):
            raise self._unverified()
        self._verified_executable = executable
        return executable

    def _ensure_process(self):
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                return self._process
            executable = self._verify_executable()
            try:
                child_environment = {
                    name: value
                    for name in ("HOME", "TMPDIR", "LANG", "LC_ALL")
                    if (value := os.environ.get(name)) is not None
                }
                self._process = self._process_factory(
                    [str(executable)],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    text=True,
                    bufsize=1,
                    close_fds=True,
                    env=child_environment,
                )
                self._handshake()
            except TransportError:
                self._stop_process()
                raise
            except Exception as exc:  # noqa: BLE001
                self._stop_process()
                raise TransportError("connector_unavailable", "Index Connector could not be started.") from exc
            return self._process

    def _stop_process(self) -> None:
        process, self._process = self._process, None
        if process is not None and process.poll() is None:
            try:
                process.terminate()
            except Exception:  # noqa: BLE001
                pass

    def _handshake(self) -> None:
        hello = self._request("hello", {}, ensure=False)
        if (
            hello.get("protocolVersion") != PROTOCOL_VERSION
            or hello.get("buildMode") != "production"
            or hello.get("apiEnvironment") != "production"
        ):
            raise self._unverified()

    def _request(self, operation: str, payload: dict[str, Any], *, ensure: bool = True) -> Any:
        with self._lock:
            process = self._ensure_process() if ensure else self._process
            if process is None or process.poll() is not None or process.stdin is None or process.stdout is None:
                raise TransportError("connector_unavailable", "Index Connector is unavailable.")
            correlation_id = uuid.uuid4().hex
            message = {
                "protocolVersion": PROTOCOL_VERSION,
                "id": correlation_id,
                "operation": operation,
                "payload": payload,
            }
            encoded = json.dumps(message, separators=(",", ":"), ensure_ascii=False)
            if len(encoded.encode("utf-8")) > 262_144:
                raise TransportError("request_too_large", "The connector request is too large.")
            try:
                process.stdin.write(encoded + "\n")
                process.stdin.flush()
                line = process.stdout.readline(_MAX_LINE_BYTES + 1)
            except Exception as exc:  # noqa: BLE001
                self._stop_process()
                raise TransportError("connector_unavailable", "Index Connector communication failed.") from exc
            if not line or len(line.encode("utf-8")) > _MAX_LINE_BYTES:
                self._stop_process()
                raise TransportError("connector_invalid_response", "Index Connector returned an invalid response.")
            try:
                response = json.loads(line)
            except json.JSONDecodeError as exc:
                self._stop_process()
                raise TransportError("connector_invalid_response", "Index Connector returned an invalid response.") from exc
            if (
                not isinstance(response, dict)
                or set(response) != {"protocolVersion", "id", "success", "result", "error"}
                or response.get("protocolVersion") != PROTOCOL_VERSION
                or response.get("id") != correlation_id
                or not isinstance(response.get("success"), bool)
            ):
                self._stop_process()
                raise TransportError("connector_invalid_response", "Index Connector returned an invalid response.")
            if not response["success"]:
                error = response.get("error")
                code = error.get("code") if isinstance(error, dict) else "operation_failed"
                message_text = error.get("message") if isinstance(error, dict) else "The connector operation failed."
                raise TransportError(str(code), str(message_text))
            return response.get("result")

    def status(self) -> dict[str, Any]:
        result = self._request("status", {})
        if not isinstance(result, dict):
            raise TransportError("connector_invalid_response", "Index Connector returned an invalid status.")
        expires_at = result.get("expiresAt")
        reconnect_soon = False
        reconnect_required = result.get("health") == "expired"
        if isinstance(expires_at, str):
            try:
                expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                now = self._now()
                remaining = expiry - now
                reconnect_required = remaining <= timedelta(0)
                reconnect_soon = timedelta(0) < remaining <= timedelta(days=7)
            except ValueError:
                reconnect_required = True
        enriched = dict(result)
        enriched["reconnectSoon"] = reconnect_soon
        enriched["reconnectRequired"] = reconnect_required
        if reconnect_required:
            enriched["connected"] = False
        return enriched

    def start_authorization(self) -> dict[str, Any]:
        result = self._request("authorize.start", {})
        return result if isinstance(result, dict) else {"status": "pending"}

    def poll_authorization(self) -> dict[str, Any]:
        result = self._request("authorize.poll", {})
        return result if isinstance(result, dict) else {"status": "failed"}

    @staticmethod
    def _rest_body(result: Any) -> dict[str, Any]:
        if not isinstance(result, dict) or not isinstance(result.get("status"), (int, float)):
            raise TransportError("connector_invalid_response", "Index Connector returned an invalid REST response.")
        status = int(result["status"])
        body = result.get("body")
        if 200 <= status < 300:
            if body is None:
                return {"success": True, "no_content": True}
            return body if isinstance(body, dict) else {"success": True, "data": body}
        payload: dict[str, Any] = {
            "success": False,
            "error": f"Index API HTTP request failed with status {status}.",
            "status": status,
        }
        if isinstance(body, dict):
            payload["details"] = body
        elif body is not None:
            payload["body"] = str(body)[:2000]
        return payload

    def request_rest(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        hermes_run: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"kind": "json", "method": method.upper(), "path": path}
        if body is not None:
            payload["body"] = body
        if hermes_run is not None:
            payload["hermesRun"] = dict(hermes_run)
        return self._rest_body(self._request("rest", payload))

    def call_mcp(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        result = self._request("mcp", {"toolName": tool_name, "arguments": arguments})
        if not isinstance(result, dict):
            raise TransportError("connector_invalid_response", "Index Connector returned an invalid MCP response.")
        return result

    def disconnect(self) -> dict[str, Any]:
        try:
            result = self._request("disconnect", {})
            return result if isinstance(result, dict) else {"status": "disconnected"}
        finally:
            self._stop_process()

    def upload(
        self, path: str, field: str, filename: str, content: bytes, content_type: str
    ) -> dict[str, Any]:
        if len(content) > _MAX_UPLOAD_BYTES:
            raise TransportError("upload_too_large", "The upload is too large.")
        digest = hashlib.sha256(content).hexdigest()
        started = self._request("rest", {
            "kind": "upload.start", "method": "POST", "path": path,
            "field": field, "filename": filename, "contentType": content_type,
            "totalBytes": len(content), "sha256": digest,
        })
        upload_id = started.get("uploadId") if isinstance(started, dict) else None
        if not isinstance(upload_id, str):
            raise TransportError("connector_invalid_response", "Index Connector did not start the upload.")
        try:
            for sequence, offset in enumerate(range(0, len(content), _UPLOAD_CHUNK_BYTES)):
                chunk = content[offset:offset + _UPLOAD_CHUNK_BYTES]
                self._request("rest", {
                    "kind": "upload.chunk", "uploadId": upload_id, "sequence": sequence,
                    "data": base64.b64encode(chunk).decode("ascii"),
                })
            return self._rest_body(self._request("rest", {"kind": "upload.finish", "uploadId": upload_id}))
        except Exception:
            try:
                self._request("rest", {"kind": "upload.abort", "uploadId": upload_id})
            except Exception:  # noqa: BLE001
                pass
            raise

    def stream_sse(self, path: str) -> Iterator[bytes]:
        started = self._request("rest", {"kind": "sse.start", "method": "GET", "path": path})
        stream_id = started.get("streamId") if isinstance(started, dict) else None
        if not isinstance(stream_id, str):
            raise TransportError("connector_invalid_response", "Index Connector did not start the stream.")
        try:
            while True:
                polled = self._request("rest", {
                    "kind": "sse.poll", "streamId": stream_id, "maxEvents": 50,
                })
                if not isinstance(polled, dict):
                    raise TransportError("connector_invalid_response", "Index Connector returned an invalid stream poll.")
                events = polled.get("events")
                if not isinstance(events, list):
                    raise TransportError("connector_invalid_response", "Index Connector returned invalid stream events.")
                for event in events:
                    line = event.get("line") if isinstance(event, dict) else None
                    if not isinstance(line, str):
                        raise TransportError("connector_invalid_response", "Index Connector returned an invalid stream line.")
                    yield (line + "\n").encode("utf-8")
                if not events and not polled.get("closed"):
                    time.sleep(0.1)
                if polled.get("closed"):
                    if polled.get("error"):
                        payload = json.dumps({"type": "error", "error": str(polled["error"])})
                        yield f"data: {payload}\n\n".encode("utf-8")
                    return
        finally:
            try:
                self._request("rest", {"kind": "sse.close", "streamId": stream_id})
            except Exception:  # noqa: BLE001
                pass
