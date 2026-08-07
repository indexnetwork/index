"""Hermes tool handlers for the Index Network plugin.

Handlers follow the official Hermes plugin contract:
- signature: handler(args: dict, **kwargs) -> str
- always return a JSON string
- catch errors and return JSON error payloads instead of raising
"""

from __future__ import annotations

import copy
import json
import os
import platform
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

_DEFAULT_INDEX_MCP_URL = "https://protocol.index.network/mcp"
_DEFAULT_INDEX_API_URL = "https://protocol.index.network/api"
# Universal-link host for Index deep links. The macOS app claims /c/*, /o/* and
# /u/* through its apple-app-site-association file, so the same https URL opens
# the app when it is installed and the web landing page when it is not. The
# plugin never detects app installation: it runs on the agent's host, which is
# usually not the user's Mac, so the OS decides at click time.
INDEX_APP_BASE_URL = "https://index.network"
_MAX_ERROR_BODY_CHARS = 2_000
_MAX_APP_URL_WALK_DEPTH = 16
_OPEN_URL_TIMEOUT_SECONDS = 15
_NEGOTIATION_ACTIONS = {"propose", "accept", "reject", "counter", "question"}
_NEGOTIATION_ROLES = {"agent", "patient", "peer"}
_FORWARDED_MCP_TOOLS = frozenset(
    {
        "register_agent",
        "list_agents",
        "update_agent",
        "delete_agent",
        "grant_agent_permission",
        "revoke_agent_permission",
        "list_conversations",
        "get_conversation",
        "read_user_contexts",
        "preview_user_context",
        "confirm_user_context",
        "create_user_context",
        "update_user_context",
        "get_enrichment_run",
        "cancel_enrichment_run",
        "complete_onboarding",
        "create_intent",
        "update_intent",
        "delete_intent",
        "create_intent_index",
        "read_intent_indexes",
        "delete_intent_index",
        "search_intents",
        "list_negotiations",
        "get_negotiation",
        "respond_to_negotiation",
        "read_networks",
        "read_network_memberships",
        "update_network",
        "create_network",
        "delete_network",
        "create_network_membership",
        "delete_network_membership",
        "list_opportunities",
        "update_opportunity",
        "confirm_opportunity_delivery",
        "create_premise",
        "read_premises",
        "update_premise",
        "retract_premise",
        "read_pending_questions",
        "read_activity_summary",
        "read_docs",
    }
)


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"))


def _error(message: str, **extra: Any) -> str:
    payload: dict[str, Any] = {"success": False, "error": message}
    payload.update(extra)
    return _json(payload)


def _error_payload(message: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"success": False, "error": message}
    payload.update(extra)
    return payload


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


def _api_url() -> str:
    return os.environ.get("INDEX_API_URL", _DEFAULT_INDEX_API_URL).strip() or _DEFAULT_INDEX_API_URL


def _app_base_url() -> str:
    """Return the universal-link origin used for Index deep links.

    Only a well-formed `https://<host>` origin is honored. A malformed or
    schemeless override (for example `index.network`) falls back to the constant:
    a base that parses to an empty scheme/netloc would make every relative path
    compare equal to it in `index_open_app` and turn that tool into a generic
    local-file opener.
    """
    raw = os.environ.get("INDEX_APP_BASE_URL", "").strip().rstrip("/")
    if not raw:
        return INDEX_APP_BASE_URL
    try:
        parts = urllib.parse.urlsplit(raw)
    except ValueError:
        return INDEX_APP_BASE_URL
    if parts.scheme != "https" or not parts.netloc:
        return INDEX_APP_BASE_URL
    return raw


def _attach_app_urls(value: Any, base_url: str, depth: int = 0) -> None:
    """Attach `appUrl` to every opportunity-shaped object in a decoded payload.

    An object counts as an opportunity when it carries a non-empty
    `opportunityId`. Existing `appUrl` values are never overwritten.
    """
    if depth > _MAX_APP_URL_WALK_DEPTH:
        return
    if isinstance(value, dict):
        opportunity_id = _clean_string(value.get("opportunityId"))
        if opportunity_id and not _clean_string(value.get("appUrl")):
            value["appUrl"] = f"{base_url}/o/{opportunity_id}"
        for item in value.values():
            _attach_app_urls(item, base_url, depth + 1)
        return
    if isinstance(value, list):
        for item in value:
            _attach_app_urls(item, base_url, depth + 1)


def _with_app_urls(payload: Any) -> Any:
    """Return the payload with deep links attached, or untouched on any surprise."""
    try:
        enriched = copy.deepcopy(payload)
        _attach_app_urls(enriched, _app_base_url())
        return enriched
    except Exception:  # noqa: BLE001 - deep links are additive; never fail a response.
        return payload


def _headers(api_key: str) -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "x-api-key": api_key,
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


def _parse_api_response(body: bytes) -> Any:
    text = body.decode("utf-8", errors="replace").strip()
    if not text:
        return {"success": True, "no_content": True}
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
                # An MCP capability denial / tool error comes back as a JSON dict
                # (e.g. {"error": ..., "code": "MCP_CAPABILITY_DENIED"}) with no
                # "success" key while result.isError is true. Without this, callers
                # that check `payload.get("success") is False` would read the
                # denial as success. Derive success from isError when absent.
                if "success" not in parsed_text:
                    parsed_text["success"] = not bool(result.get("isError"))
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
                return _json(_with_app_urls({"success": True, "data": parsed}))
            return _json(_with_app_urls(_decode_tool_result(parsed)))
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


def _api_request(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    *,
    no_content_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    api_key = os.environ.get("INDEX_API_KEY", "").strip()
    if not api_key:
        return _error_payload(
            "INDEX_API_KEY is required. Install the plugin with Hermes or set INDEX_API_KEY in the Hermes environment."
        )

    base_url = _api_url().rstrip("/")
    request_path = path if path.startswith("/") else f"/{path}"
    request_body = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}{request_path}",
        data=request_body,
        headers=_headers(api_key),
        method=method.upper(),
    )

    try:
        with urllib.request.urlopen(request, timeout=_timeout_seconds()) as response:
            status = getattr(response, "status", getattr(response, "code", None))
            if status == 204:
                return no_content_payload or {"success": True, "no_content": True}
            parsed = _parse_api_response(response.read())
            if isinstance(parsed, dict):
                return parsed
            return {"success": True, "data": parsed}
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")[:_MAX_ERROR_BODY_CHARS]
        error_payload: dict[str, Any] = {
            "success": False,
            "error": f"Index API HTTP request failed with status {exc.code}.",
            "status": exc.code,
        }
        if body_text:
            error_payload["body"] = body_text
            try:
                parsed_body = _parse_json(body_text)
            except json.JSONDecodeError:
                parsed_body = None
            if isinstance(parsed_body, dict):
                error_payload["details"] = parsed_body
        return error_payload
    except urllib.error.URLError as exc:
        return _error_payload(f"Index API request failed: {exc.reason}")
    except Exception as exc:  # noqa: BLE001 - Hermes handlers must not raise.
        return _error_payload(f"Index API response could not be processed: {exc}")


def _agent_id_from_payload(payload: dict[str, Any]) -> str | None:
    agent_id = _clean_string(payload.get("id"))
    if agent_id:
        return agent_id
    agent = payload.get("agent")
    if isinstance(agent, dict):
        return _clean_string(agent.get("id"))
    return None


def _resolve_agent_id(args: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    agent_id = _clean_string(args.get("agentId"))
    if agent_id:
        return agent_id, None
    payload = _api_request("GET", "/agents/me")
    if payload.get("success") is False:
        return None, payload
    resolved = _agent_id_from_payload(payload)
    if not resolved:
        return None, _error_payload("Could not resolve agent ID from /agents/me response.", response=payload)
    return resolved, None


def _validate_suggested_roles(value: Any) -> tuple[dict[str, str] | None, str | None]:
    if not isinstance(value, dict):
        return None, "suggestedRoles must be an object."
    own_user = _clean_string(value.get("ownUser"))
    other_user = _clean_string(value.get("otherUser"))
    if own_user not in _NEGOTIATION_ROLES:
        return None, "suggestedRoles.ownUser must be one of: agent, patient, peer."
    if other_user not in _NEGOTIATION_ROLES:
        return None, "suggestedRoles.otherUser must be one of: agent, patient, peer."
    return {"ownUser": own_user, "otherUser": other_user}, None


def index_forwarded_mcp_tool(tool_name: str, args: dict, **kwargs) -> str:
    """Forward a Hermes tool call to an allowlisted Index MCP tool."""
    del kwargs
    if tool_name not in _FORWARDED_MCP_TOOLS:
        return _error(f"Unsupported Index MCP tool: {tool_name}")
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    return _call_index_mcp(tool_name, args)


def make_mcp_tool_handler(tool_name: str):
    """Create a Hermes handler for an allowlisted pass-through Index MCP tool."""
    if tool_name not in _FORWARDED_MCP_TOOLS:
        raise ValueError(f"Unsupported Index MCP tool: {tool_name}")

    def handler(args: dict, **kwargs) -> str:
        return index_forwarded_mcp_tool(tool_name, args, **kwargs)

    handler.__name__ = f"index_{tool_name}"
    handler.__doc__ = f"Forward to the Index MCP {tool_name} tool."
    return handler


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


def _url_opener_command(url: str, system: str | None = None) -> list[str] | None:
    """Return the platform command that hands a URL to the OS, if there is one."""
    resolved = (system or platform.system() or "").strip().lower()
    if resolved == "darwin":
        return ["open", url]
    if resolved == "windows":
        # Never route through `cmd /c start`: subprocess quotes an argument only
        # when it contains whitespace, so cmd.exe metacharacters (& | ^ < > %)
        # inside an otherwise valid https://index.network URL would survive
        # unquoted and execute as separate commands. rundll32 is handed the URL
        # as a single argv entry and no shell ever re-parses it.
        return ["rundll32", "url.dll,FileProtocolHandler", url]
    if shutil.which("xdg-open"):
        return ["xdg-open", url]
    return None


def _open_url(command: list[str]) -> str | None:
    """Run a URL-opener command. Returns None on success, an error string otherwise."""
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=_OPEN_URL_TIMEOUT_SECONDS,
            check=False,
        )
    except Exception as exc:  # noqa: BLE001 - Hermes handlers must not raise.
        return str(exc)
    if result.returncode != 0:
        return (result.stderr or "").strip() or f"exit code {result.returncode}"
    return None


def index_open_app(args: dict, **kwargs) -> str:
    """Open an Index universal link with the operating system's default handler."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")

    base_url = _app_base_url()
    target = _clean_string(args.get("target")) or base_url

    try:
        base_parts = urllib.parse.urlsplit(base_url)
        target_parts = urllib.parse.urlsplit(target)
    except ValueError:
        return _error(f"target must be an {base_url} URL.")
    # An absolute https origin is required in its own right, not just an origin
    # that matches the base: a relative target ('/etc/passwd') has an empty
    # scheme and netloc and must never be handed to the OS opener.
    if target_parts.scheme != "https" or not target_parts.netloc:
        return _error(f"target must be an {base_url} URL.")
    if target_parts.scheme != base_parts.scheme or target_parts.netloc != base_parts.netloc:
        return _error(f"target must be an {base_url} URL.")

    command = _url_opener_command(target)
    if command is None:
        return _error(
            f"No URL opener is available on this host. Open {target} manually to continue in the Index app.",
            url=target,
        )

    failure = _open_url(command)
    if failure is not None:
        return _error(f"Could not open {target}: {failure}", url=target)
    return _json({"success": True, "url": target})


def index_agent_me(args: dict, **kwargs) -> str:
    """Return the authenticated Index personal agent for the configured API key."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    payload = _api_request("GET", "/agents/me")
    if payload.get("success") is False:
        return _json(payload)
    merged = {"success": True}
    merged.update(payload)
    merged["success"] = True
    return _json(merged)


def index_pickup_negotiation(args: dict, **kwargs) -> str:
    """Poll and claim one pending Index negotiation turn for this personal agent."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")

    agent_id, agent_error = _resolve_agent_id(args)
    if agent_error is not None:
        return _json(agent_error)
    if not agent_id:
        return _error("agentId is required.")

    payload = _api_request(
        "POST",
        f"/agents/{agent_id}/negotiations/pickup",
        no_content_payload={"success": True, "pending": False},
    )
    if payload.get("success") is False:
        return _json(payload)
    if payload == {"success": True, "pending": False}:
        return _json(payload)
    merged = {"success": True, "pending": True}
    merged.update(payload)
    merged["success"] = True
    merged["pending"] = True
    return _json(merged)


def index_respond_negotiation(args: dict, **kwargs) -> str:
    """Submit a response for a claimed Index negotiation turn."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")

    negotiation_id = _clean_string(args.get("negotiationId"))
    if not negotiation_id:
        return _error("negotiationId is required.")

    action = _clean_string(args.get("action"))
    if action not in _NEGOTIATION_ACTIONS:
        return _error("action must be one of: propose, accept, reject, counter, question.")

    message = _clean_string(args.get("message"))
    if action in {"counter", "question"} and not message:
        return _error("message is required for counter and question actions.")

    reasoning = _clean_string(args.get("reasoning"))
    if not reasoning:
        return _error("reasoning is required.")

    suggested_roles, roles_error = _validate_suggested_roles(args.get("suggestedRoles"))
    if roles_error:
        return _error(roles_error)

    agent_id, agent_error = _resolve_agent_id(args)
    if agent_error is not None:
        return _json(agent_error)
    if not agent_id:
        return _error("agentId is required.")

    request_body = {
        "action": action,
        "message": message,
        "assessment": {
            "reasoning": reasoning,
            "suggestedRoles": suggested_roles,
        },
    }
    return _json(_api_request("POST", f"/agents/{agent_id}/negotiations/{negotiation_id}/respond", request_body))
