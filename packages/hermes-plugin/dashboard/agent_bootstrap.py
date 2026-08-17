"""Promote a CLI owner key to a Hermes agent-bound API key.

Browser `/cli-auth` mints an unbound CLI key. Pickup and `GET /agents/me`
need an agent-bound secret. This helper reuses (or registers) the Hermes
agent, mints a token, and returns that secret for persistence.
"""

from __future__ import annotations

import json
from typing import Any, Callable

_HERMES_NAME = "hermes"
_REGISTER_NAME = "Hermes"
_TOKEN_NAME = "Hermes API Key"
_PERMISSIONS = ["manage:negotiations", "manage:intents", "manage:opportunities"]


class BootstrapError(RuntimeError):
    """Hermes agent/token bootstrap could not complete."""


def select_hermes_agent(agents: list[Any]) -> dict[str, Any] | None:
    """Pick the reusable Hermes external agent, preferring the negotiator."""
    matches: list[dict[str, Any]] = []
    for agent in agents:
        if not isinstance(agent, dict):
            continue
        name = str(agent.get("name") or "").strip().casefold()
        kind = str(agent.get("type") or "").strip().casefold()
        status = str(agent.get("status") or "").strip().casefold()
        if name == _HERMES_NAME and kind == "external" and status == "active":
            matches.append(agent)
    if not matches:
        return None
    negotiating = [agent for agent in matches if agent.get("handleNegotiations") is True]
    return (negotiating or matches)[0]


def _error_text(payload: dict[str, Any], fallback: str) -> str:
    details = payload.get("details")
    if isinstance(details, dict):
        for key in ("error", "message"):
            value = details.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    for key in ("error", "message"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def _decode_mcp(result: dict[str, Any]) -> dict[str, Any]:
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        payload = dict(structured)
        if "success" not in payload:
            payload["success"] = not bool(result.get("isError"))
        return payload
    content = result.get("content")
    if isinstance(content, list):
        texts = [item.get("text") for item in content if isinstance(item, dict) and item.get("type") == "text"]
        text = "\n".join(str(item) for item in texts if item is not None).strip()
        if text:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict):
                if "success" not in parsed:
                    parsed["success"] = not bool(result.get("isError"))
                return parsed
            return {"success": not bool(result.get("isError")), "text": text}
    return {"success": not bool(result.get("isError")), "data": result}


def _agent_from_register(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    agent = data.get("agent") if isinstance(data, dict) else None
    if not isinstance(agent, dict):
        agent = payload.get("agent")
    if not isinstance(agent, dict) or not str(agent.get("id") or "").strip():
        raise BootstrapError("Hermes agent registration returned no agent.")
    return agent


def _token_from_rest(payload: dict[str, Any]) -> tuple[str, str | None]:
    token = payload.get("token")
    data = payload.get("data")
    if not isinstance(token, dict) and isinstance(data, dict):
        token = data.get("token")
    if not isinstance(token, dict):
        raise BootstrapError("Agent token response did not include a key.")
    key = str(token.get("key") or "").strip()
    if not key:
        raise BootstrapError("Agent token response did not include a key.")
    token_id = str(token.get("id") or "").strip() or None
    return key, token_id


def promote(
    transport: Any,
    persist_api_key: Callable[[str, str | None], None],
    cli_key: str,
    cli_key_id: str | None,
) -> dict[str, Any]:
    """Replace the CLI owner key with a Hermes agent token.

    Uses `transport` while it still authenticates as the CLI key. On failure
    the CLI key stays persisted so Discover can still sign in.
    """
    try:
        listed = transport.request_rest("GET", "/agents")
        if not isinstance(listed, dict) or listed.get("success") is False:
            raise BootstrapError(_error_text(listed if isinstance(listed, dict) else {}, "Could not list agents."))
        agents = listed.get("agents")
        if not isinstance(agents, list) and isinstance(listed.get("data"), dict):
            agents = listed["data"].get("agents")
        if not isinstance(agents, list):
            agents = []
        agent = select_hermes_agent(agents)
        if agent is None:
            mcp_result = transport.call_mcp("register_agent", {
                "name": _REGISTER_NAME,
                "description": "Hermes on this host",
                "permissions": list(_PERMISSIONS),
            })
            if not isinstance(mcp_result, dict):
                raise BootstrapError("Hermes agent registration returned no agent.")
            registered = _decode_mcp(mcp_result)
            if registered.get("success") is False:
                raise BootstrapError(_error_text(registered, "Could not register Hermes."))
            agent = _agent_from_register(registered)
        agent_id = str(agent.get("id") or "").strip()
        if not agent_id:
            raise BootstrapError("Hermes agent registration returned no agent.")
        minted = transport.request_rest("POST", f"/agents/{agent_id}/tokens", {"name": _TOKEN_NAME})
        if not isinstance(minted, dict) or minted.get("success") is False:
            raise BootstrapError(_error_text(minted if isinstance(minted, dict) else {}, "Could not mint a Hermes agent key."))
        secret, token_id = _token_from_rest(minted)
    except BootstrapError as exc:
        return {"negotiatorReady": False, "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - login must not fail closed on bootstrap.
        return {"negotiatorReady": False, "error": str(exc)}

    if cli_key and cli_key_id:
        try:
            transport.request_rest(
                "POST",
                "/auth/cli-credential/revoke",
                {"keyId": cli_key_id, "targetKey": cli_key},
            )
        except Exception:  # noqa: BLE001 - revoke is best-effort.
            pass
    persist_api_key(secret, token_id)
    return {"negotiatorReady": True}
