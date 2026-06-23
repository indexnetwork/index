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
_DEFAULT_INDEX_API_URL = "https://protocol.index.network/api"
_MAX_ERROR_BODY_CHARS = 2_000
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
        "import_contacts",
        "list_contacts",
        "add_contact",
        "remove_contact",
        "search_contacts",
        "read_user_contexts",
        "record_onboarding_privacy_consent",
        "preview_user_context",
        "confirm_user_context",
        "create_user_context",
        "update_user_context",
        "get_enrichment_run",
        "cancel_enrichment_run",
        "complete_onboarding",
        "import_gmail_contacts",
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
        "discover_opportunities",
        "get_discovery_run",
        "cancel_discovery_run",
        "list_opportunities",
        "update_opportunity",
        "confirm_opportunity_delivery",
        "create_premise",
        "read_premises",
        "update_premise",
        "retract_premise",
        "read_pending_questions",
        "scrape_url",
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
