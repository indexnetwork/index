"""Hermes tool handlers for the Index Network plugin.

Handlers follow the official Hermes plugin contract:
- signature: handler(args: dict, **kwargs) -> str
- always return a JSON string
- catch errors and return JSON error payloads instead of raising
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

_DEFAULT_INDEX_MCP_URL = "https://protocol.index.network/mcp"
_MAX_ERROR_BODY_CHARS = 2_000


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"))


def _error(message: str, **extra: Any) -> str:
    payload: dict[str, Any] = {"success": False, "error": message}
    payload.update(extra)
    return _json(payload)


def _clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _positive_int(value: Any, name: str, *, maximum: int | None = None) -> tuple[int | None, str | None]:
    if value is None:
        return None, None
    if isinstance(value, bool):
        return None, f"{name} must be an integer."
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None, f"{name} must be an integer."
    if parsed < 1:
        return None, f"{name} must be at least 1."
    if maximum is not None and parsed > maximum:
        return None, f"{name} must be at most {maximum}."
    return parsed, None


def _timeout_seconds() -> float:
    raw = os.environ.get("INDEX_MCP_TIMEOUT_SECONDS", "30").strip()
    try:
        parsed = float(raw)
    except ValueError:
        return 30.0
    return parsed if parsed > 0 else 30.0


def _mcp_url() -> str:
    return os.environ.get("INDEX_MCP_URL", _DEFAULT_INDEX_MCP_URL).strip() or _DEFAULT_INDEX_MCP_URL


def _headers(api_key: str) -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "x-index-surface": "hermes-plugin",
    }
    telegram_handle = os.environ.get("INDEX_TELEGRAM_USERNAME", "").strip()
    if telegram_handle:
        headers["x-index-telegram-username"] = telegram_handle
    return headers


def _parse_json(data: str) -> Any:
    return json.loads(data)


def _parse_sse(data: str) -> Any:
    """Return the last JSON data payload from an SSE response."""
    last_payload: Any = None
    data_lines: list[str] = []

    def flush() -> None:
        nonlocal last_payload, data_lines
        if not data_lines:
            return
        raw = "\n".join(data_lines).strip()
        data_lines = []
        if not raw or raw == "[DONE]":
            return
        last_payload = _parse_json(raw)

    for line in data.splitlines():
        if not line.strip():
            flush()
            continue
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    flush()

    if last_payload is None:
        raise ValueError("SSE response did not include a JSON data payload")
    return last_payload


def _parse_mcp_response(body: bytes, content_type: str) -> Any:
    text = body.decode("utf-8", errors="replace")
    if "text/event-stream" in content_type.lower():
        return _parse_sse(text)
    return _parse_json(text)


def _decode_tool_result(message: dict[str, Any]) -> dict[str, Any]:
    if "error" in message:
        err = message.get("error") or {}
        if isinstance(err, dict):
            return {
                "success": False,
                "error": str(err.get("message") or "Index MCP request failed."),
                "code": err.get("code"),
            }
        return {"success": False, "error": str(err)}

    result = message.get("result")
    if not isinstance(result, dict):
        return {"success": True, "data": result}

    content = result.get("content")
    if isinstance(content, list):
        texts = [item.get("text") for item in content if isinstance(item, dict) and item.get("type") == "text"]
        text = "\n".join(str(item) for item in texts if item is not None).strip()
        if text:
            try:
                parsed_text = _parse_json(text)
            except json.JSONDecodeError:
                parsed_text = None
            if isinstance(parsed_text, dict):
                return parsed_text
            return {"success": not bool(result.get("isError")), "text": text}

    return {"success": not bool(result.get("isError")), "data": result}


def _call_index_mcp(tool_name: str, arguments: dict[str, Any]) -> str:
    api_key = os.environ.get("INDEX_API_KEY", "").strip()
    if not api_key:
        return _error(
            "INDEX_API_KEY is required. Install the plugin with Hermes or set INDEX_API_KEY in the Hermes environment."
        )

    request_body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": int(time.time() * 1000),
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        _mcp_url(),
        data=request_body,
        headers=_headers(api_key),
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=_timeout_seconds()) as response:
            body = response.read()
            parsed = _parse_mcp_response(body, response.headers.get("Content-Type", ""))
            if not isinstance(parsed, dict):
                return _json({"success": True, "data": parsed})
            return _json(_decode_tool_result(parsed))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:_MAX_ERROR_BODY_CHARS]
        return _error(
            f"Index MCP HTTP request failed with status {exc.code}.",
            status=exc.code,
            body=body,
        )
    except urllib.error.URLError as exc:
        return _error(f"Index MCP request failed: {exc.reason}")
    except Exception as exc:  # noqa: BLE001 - Hermes handlers must not raise.
        return _error(f"Index MCP response could not be processed: {exc}")


def index_read_intents(args: dict, **kwargs) -> str:
    """Read Index Network intents through the canonical MCP read_intents tool."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")

    arguments: dict[str, Any] = {}

    network_id = _clean_string(args.get("networkId"))
    if network_id:
        arguments["networkId"] = network_id

    user_id = _clean_string(args.get("userId"))
    if user_id:
        arguments["userId"] = user_id

    limit, limit_error = _positive_int(args.get("limit"), "limit", maximum=100)
    if limit_error:
        return _error(limit_error)
    if limit is not None:
        arguments["limit"] = limit

    page, page_error = _positive_int(args.get("page"), "page")
    if page_error:
        return _error(page_error)
    if page is not None:
        arguments["page"] = page

    return _call_index_mcp("read_intents", arguments)
