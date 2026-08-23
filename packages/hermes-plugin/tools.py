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
import secrets
import shutil
import subprocess
import threading
import time
import urllib.parse
from collections import OrderedDict
from typing import Any

from .env_transport import TransportError
from .transport import get_transport, reset_transport, set_transport_for_tests

# Universal-link host for Index deep links. The macOS app claims /c/*, /o/* and
# /u/* through its apple-app-site-association file, so the same https URL opens
# the app when it is installed and the web landing page when it is not. The
# plugin never detects app installation: it runs on the agent's host, which is
# usually not the user's Mac, so the OS decides at click time.
INDEX_APP_BASE_URL = "https://index.network"
_MAX_APP_URL_WALK_DEPTH = 16
_OPEN_URL_TIMEOUT_SECONDS = 15
# Negotiation-graph rewrite (#1494): the closed action vocabulary Hermes may
# submit. Mirrors packages/protocol/src/internal/negotiations/negotiation.hermes-contract.ts
# `HermesNegotiationActionSchema` exactly. No accept/decline/withdraw/consult
# any more -- a negotiator that wants out submits `recommend_reject` and lets
# its own principal's agent act on it.
_NEGOTIATION_ACTIONS = {
    "outreach",
    "counter",
    "question",
    "ask_principal",
    "recommend_pending",
    "recommend_reject",
}
_NEGOTIATION_ACTIONS_MESSAGE = "outreach, counter, question, ask_principal, recommend_pending, recommend_reject"
_NEGOTIATION_RUN_LOCK = threading.RLock()
_NEGOTIATION_RUN_MAX_STATES = 256
_NEGOTIATION_RUN_STATE_TTL_SECONDS = 6 * 60 * 60


class _NegotiationRunState:
    """Hidden authority for one authoritative Hermes gateway task/session.

    There is no more pickup/claim step (a negotiation is never claimed into a
    distinct state -- it stays `working` until it pauses or resolves), so
    this only fences one negotiation-graph mutation per Hermes pass: the
    first `index_respond_negotiation` call consumes it, and a repeat call
    with the identical arguments replays the cached result instead of
    re-dispatching.
    """

    def __init__(self, run_id: str, touched_at: float) -> None:
        self.run_id = run_id
        self.touched_at = touched_at
        self.mutation_key: str | None = None
        self.mutation_inflight = False
        self.mutation_result: dict[str, Any] | None = None


_NEGOTIATION_RUN_STATES: OrderedDict[str, _NegotiationRunState] = OrderedDict()
_FORWARDED_MCP_TOOLS = frozenset(
    {
        "research_profile",
        "create_intent",
        "update_intent",
        "create_intent_index",
        "read_intent_indexes",
        "search_intents",
        "list_negotiations",
        "get_negotiation",
        "respond_to_negotiation",
        "read_networks",
        "read_network_memberships",
        "update_network",
        "create_network",
        "create_network_membership",
        "list_opportunities",
        "update_opportunity",
        "confirm_opportunity_delivery",
        "create_premise",
        "read_premises",
        "update_premise",
        "retract_premise",
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


def _unexpected_arguments(args: dict[str, Any], allowed: set[str]) -> str | None:
    unexpected = sorted(str(key) for key in args if key not in allowed)
    return f"Unexpected arguments: {', '.join(unexpected)}." if unexpected else None


def _valid_hermes_task_id(value: Any) -> str | None:
    task_id = _clean_string(value)
    if not task_id or len(task_id) > 512 or "\0" in task_id or "\r" in task_id or "\n" in task_id:
        return None
    return task_id


def _negotiation_run_state_expired(state: _NegotiationRunState, now: float) -> bool:
    """Treat backward/equal monotonic observations as live, never as elapsed TTL."""
    return (
        not state.mutation_inflight
        and now > state.touched_at
        and now - state.touched_at > _NEGOTIATION_RUN_STATE_TTL_SECONDS
    )


def _touch_negotiation_run_state(state: _NegotiationRunState, now: float | None = None) -> None:
    observed = time.monotonic() if now is None else now
    state.touched_at = max(state.touched_at, observed)


def _prune_negotiation_run_states(now: float) -> None:
    # Capacity is fail-closed: only lifecycle-expired entries are removable.
    # Every live entry is authoritative, including completed tombstones and
    # cached receipts; insertion must fail rather than evicting any of them.
    expired = [
        task_id
        for task_id, state in _NEGOTIATION_RUN_STATES.items()
        if _negotiation_run_state_expired(state, now)
    ]
    for task_id in expired:
        _NEGOTIATION_RUN_STATES.pop(task_id, None)


def _negotiation_run_state(kwargs: dict[str, Any]) -> tuple[_NegotiationRunState | None, str | None]:
    """Resolve only Hermes' hidden handler task_id; model arguments never participate."""
    hermes_task_id = _valid_hermes_task_id(kwargs.get("task_id"))
    if not hermes_task_id:
        return None, "Hermes did not supply a valid authoritative task_id for this negotiation pass."
    now = time.monotonic()
    with _NEGOTIATION_RUN_LOCK:
        state = _NEGOTIATION_RUN_STATES.get(hermes_task_id)
        if state is not None and _negotiation_run_state_expired(state, now):
            _NEGOTIATION_RUN_STATES.pop(hermes_task_id, None)
            state = None
        if state is None:
            _prune_negotiation_run_states(now)
            if len(_NEGOTIATION_RUN_STATES) >= _NEGOTIATION_RUN_MAX_STATES:
                return None, "Hermes negotiation pass state capacity is temporarily exhausted."
            state = _NegotiationRunState(secrets.token_urlsafe(32), now)
            _NEGOTIATION_RUN_STATES[hermes_task_id] = state
        else:
            _touch_negotiation_run_state(state, now)
            _NEGOTIATION_RUN_STATES.move_to_end(hermes_task_id)
        return state, None


def _negotiation_run_authority(state: _NegotiationRunState) -> dict[str, str]:
    """Project hidden run state into the transport's closed structured shape.

    KNOWN GAP (negotiation-graph rewrite, #1494): this used to carry a
    server-issued `capability` bound during pickup
    (`services/api/src/lib/agent/hermes-negotiation-run.ts`'s
    `issueHermesRunCapability`), and `agent.controller.ts`'s
    `respondNegotiation` route still hard-requires that capability header for
    the dedicated `hermes-negotiator` audience (throws `UnauthorizedError`,
    "requires its run-bound capability", when the header is absent). Pickup, the only
    place that ever issued one, is deleted. There is currently no
    replacement issuance path, so `index_respond_negotiation` calls from
    this plugin will be rejected with 401 end to end until services/api
    adds one -- not something this plugin can fix on its own. Only `runId`
    is sent below; there is nothing to bind a capability to any more.
    """
    with _NEGOTIATION_RUN_LOCK:
        return {"runId": state.run_id}


def _reset_negotiation_run_for_tests() -> None:
    """Clear process-local pass authority. Test-only; never registered as a tool."""
    with _NEGOTIATION_RUN_LOCK:
        _NEGOTIATION_RUN_STATES.clear()


def _begin_negotiation_mutation(
    state: _NegotiationRunState,
    kind: str,
    task_id: str,
    body: dict[str, Any],
) -> tuple[str | None, dict[str, Any] | None]:
    """Consume the pass atomically immediately before its mutation HTTP dispatch."""
    key = json.dumps([kind, task_id, body], sort_keys=True, separators=(",", ":"))
    with _NEGOTIATION_RUN_LOCK:
        if state.mutation_key == key and state.mutation_result is not None:
            return None, copy.deepcopy(state.mutation_result)
        if state.mutation_key is not None:
            return "This Hermes run has already used its one negotiation mutation.", None
        state.mutation_key = key
        state.mutation_inflight = True
        _touch_negotiation_run_state(state)
    return key, None


def _finish_negotiation_mutation(
    state: _NegotiationRunState,
    key: str,
    result: dict[str, Any],
) -> None:
    with _NEGOTIATION_RUN_LOCK:
        if state.mutation_key != key or not state.mutation_inflight:
            return
        # Dispatch itself consumes the attempt. Cache every result, including
        # transport/HTTP failure, so a later model tool call can never switch
        # operation or body and can never trigger another mutation request.
        state.mutation_inflight = False
        state.mutation_result = copy.deepcopy(result)
        _touch_negotiation_run_state(state)


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
    try:
        result = get_transport().call_mcp(tool_name, arguments)
        return _json(_with_app_urls(_decode_tool_result({"result": result})))
    except TransportError as exc:
        return _json(exc.as_payload())
    except Exception as exc:  # noqa: BLE001 - Hermes handlers must not raise.
        return _error(f"Index transport response could not be processed: {exc}")


def _api_request(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    *,
    no_content_payload: dict[str, Any] | None = None,
    hermes_run: dict[str, str] | None = None,
) -> dict[str, Any]:
    try:
        result = get_transport().request_rest(
            method, path, body, hermes_run=hermes_run
        )
        if result.get("no_content") is True and no_content_payload is not None:
            return no_content_payload
        return result
    except TransportError as exc:
        return exc.as_payload()
    except Exception as exc:  # noqa: BLE001 - Hermes handlers must not raise.
        return _error_payload(f"Index transport response could not be processed: {exc}")


_AMBIGUOUS_REPLAY_CODES = {
    "network_error",
    "timeout",
}


def _dispatch_negotiation_request(
    path: str,
    body: dict[str, Any] | None,
    authority: dict[str, str],
    *,
    no_content_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Dispatch once, with at most one byte-identical ambiguous replay."""
    result = _api_request(
        "POST", path, body, hermes_run=authority,
        no_content_payload=no_content_payload,
    )
    ambiguous = (
        result.get("success") is False
        and "status" not in result
        and result.get("code") in _AMBIGUOUS_REPLAY_CODES
    )
    if ambiguous:
        return _api_request(
            "POST", path, body, hermes_run=authority,
            no_content_payload=no_content_payload,
        )
    return result


def _dispatch_negotiation_mutation(
    path: str,
    body: dict[str, Any],
    authority: dict[str, str],
) -> dict[str, Any]:
    """Bounded exact mutation replay under the same hidden run authority."""
    return _dispatch_negotiation_request(path, body, authority)


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



def index_respond_negotiation(args: dict, **kwargs) -> str:
    """Submit one closed action for a specific negotiation.

    There is no more pickup/claim (a negotiation stays `working` until it
    pauses or resolves -- it is never claimed into a distinct state), so the
    caller must already know which negotiation to respond to and what to do
    -- typically from the SSE wake event that triggered this pass, or from
    the generic MCP `list_negotiations`/`get_negotiation` tools (already
    forwarded to Hermes -- see `_FORWARDED_MCP_TOOLS`), which this dedicated
    bridge intentionally does not duplicate. `action` is a closed directive,
    never model-authored prose: the server maps it to a fixed template
    message via `buildHermesNegotiationTurn`
    (packages/protocol/src/internal/negotiations/negotiation.hermes-contract.ts).
    There is no `accept`, `decline`, `withdraw`, or `consult` any more -- a
    negotiator that wants out submits `recommend_reject`.
    """
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    unexpected = _unexpected_arguments(args, {"agentId", "negotiationId", "action"})
    if unexpected:
        return _error(unexpected)

    negotiation_id = _clean_string(args.get("negotiationId"))
    if not negotiation_id:
        return _error("negotiationId is required.")
    action = _clean_string(args.get("action"))
    if action not in _NEGOTIATION_ACTIONS:
        return _error(f"action must be one of: {_NEGOTIATION_ACTIONS_MESSAGE}.")

    state, state_error = _negotiation_run_state(kwargs)
    if state_error or state is None:
        return _error(state_error or "Hermes negotiation pass identity is unavailable.")
    agent_id, agent_error = _resolve_agent_id(args)
    if agent_error is not None:
        return _json(agent_error)
    if not agent_id:
        return _error("agentId is required.")

    request_body = {"action": action}
    key, cached = _begin_negotiation_mutation(state, "respond", negotiation_id, request_body)
    if cached is not None:
        return _json(cached)
    if key is None or key.startswith("This Hermes run"):
        return _error(key or "Hermes run mutation could not be reserved.")

    result = _dispatch_negotiation_mutation(
        f"/agents/{agent_id}/negotiations/{negotiation_id}/respond",
        request_body,
        _negotiation_run_authority(state),
    )
    _finish_negotiation_mutation(state, key, result)
    return _json(result)
