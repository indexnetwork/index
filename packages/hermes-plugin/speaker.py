"""One Hermes gateway completion for the Index negotiator.

The negotiator loop and its tools live in `@indexnetwork/agent`. This module
asks the model Hermes is already configured to use for a single assistant
message, including any tool calls, and does not run those tools.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

PLATFORM = "index"
# How many transcript rows of the current run are already in this Hermes session.
_written: dict[str, tuple[str, int]] = {}


def _message(message) -> dict:
    """@param message - One provider message. @returns The assistant message the agent stores."""
    content = getattr(message, "content", None)
    if not isinstance(content, str):
        content = None
    tool_calls = []
    for call in getattr(message, "tool_calls", None) or []:
        function = getattr(call, "function", None)
        name = getattr(function, "name", None)
        if not isinstance(name, str) or not name:
            continue
        arguments = getattr(function, "arguments", None)
        tool_calls.append({
            "id": getattr(call, "id", None) or name,
            "type": "function",
            "function": {"name": name, "arguments": arguments if isinstance(arguments, str) else "{}"},
        })
    result = {"role": "assistant", "content": content}
    if tool_calls:
        result["tool_calls"] = tool_calls
    return result


def _text(message: dict) -> str:
    content = message.get("content")
    return content if isinstance(content, str) else ""


def _chat(messages: list) -> tuple[str, str] | None:
    """@returns The Hermes chat id and title for this run, or None when it names no signal."""
    system = next((_text(message) for message in messages if message.get("role") == "system"), "")
    user = next((_text(message) for message in messages if message.get("role") == "user"), "")
    intent_id = ""
    statement = ""
    for line in system.splitlines():
        if line.startswith("Current intent:"):
            statement = line.removeprefix("Current intent:").strip()
        elif line.startswith("Intent id:"):
            intent_id = line.removeprefix("Intent id:").strip()
    marker = "This negotiation:\n"
    if marker in user:
        try:
            opportunity = json.loads(user.split(marker, 1)[1])
        except ValueError:
            opportunity = None
        if isinstance(opportunity, dict) and isinstance(opportunity.get("id"), str):
            name = opportunity.get("counterpart") if isinstance(opportunity.get("counterpart"), str) else "Match"
            return opportunity["id"], f"{name} · {statement or 'Index'}"
    if intent_id:
        return f"{intent_id}:think", f"{statement or 'Index'} · think"
    return None


def _record(adapter, messages: list, assistant: dict) -> None:
    """Append this step onto the Index session so it shows in the Hermes session list."""
    if adapter is None:
        return
    located = _chat(messages)
    if located is None:
        return
    chat_id, title = located
    store = getattr(adapter, "_session_store", None)
    if store is None:
        return
    from gateway.session import SessionSource

    from .env_transport import NEGOTIATOR_PROFILE

    source = SessionSource(
        platform=adapter.platform, chat_id=chat_id, chat_type="dm", chat_name=title,
        user_id=getattr(adapter, "_owner", None) or "index", user_name="Index",
        profile=NEGOTIATOR_PROFILE,
    )
    entry = store.get_or_create_session(source)
    session_db = store._db_for_key(entry.session_key) if hasattr(store, "_db_for_key") else None
    session_db = getattr(session_db, "_db", session_db) or getattr(store, "_db", None)
    if session_db is None:
        return
    if not session_db.get_session_title(entry.session_id):
        short = chat_id.split(":", 1)[0][:8]
        for candidate in (title, f"{title} · {short}"):
            try:
                session_db.set_session_title(entry.session_id, candidate[:100])
                break
            except ValueError:
                continue
    user = next((_text(message) for message in messages if message.get("role") == "user"), "")
    previous, count = _written.get(chat_id, ("", 0))
    if previous != user:
        count = 0
    pending = [message for message in messages[count:] if message.get("role") != "system"]
    pending.append(assistant)
    for message in pending:
        content = _text(message)
        tool_calls = message.get("tool_calls")
        session_db.append_message(
            entry.session_id,
            role=str(message.get("role") or "assistant"),
            content=content or None,
            tool_calls=tool_calls if isinstance(tool_calls, list) else None,
            tool_call_id=message.get("tool_call_id") if isinstance(message.get("tool_call_id"), str) else None,
        )
    _written[chat_id] = (user, len(messages) + 1)


def complete(payload: dict, adapter=None) -> dict:
    """@param payload - `messages` and `tools` for one step.
    @returns The assistant message. @throws When Hermes has no model or the call fails.
    """
    from agent.auxiliary_client import call_llm
    from agent.secret_scope import build_profile_secret_scope, reset_secret_scope, set_secret_scope
    from gateway.run import _resolve_gateway_model, _resolve_runtime_agent_kwargs
    from hermes_cli.profiles import get_profile_dir
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    from .env_transport import NEGOTIATOR_PROFILE
    from .tools import ensure_negotiator_profile

    ensure_negotiator_profile()
    home = get_profile_dir(NEGOTIATOR_PROFILE)
    home_token = set_hermes_home_override(home)
    secret_token = set_secret_scope(build_profile_secret_scope(home), profile_home=str(home))
    try:
        runtime = _resolve_runtime_agent_kwargs()
        model = _resolve_gateway_model()
        if not model:
            raise RuntimeError("Hermes has no gateway model configured.")
        tools = payload.get("tools") or None
        response = call_llm(
            messages=payload.get("messages") or [],
            tools=tools,
            model=model,
            provider=runtime.get("provider") or None,
            base_url=runtime.get("base_url") or None,
            api_key=runtime.get("api_key") or None,
            api_mode=runtime.get("api_mode") or None,
        )
        choices = getattr(response, "choices", None) or []
        if not choices:
            raise RuntimeError("Hermes returned no completion.")
        assistant = _message(choices[0].message)
        try:
            _record(adapter, payload.get("messages") or [], assistant)
        except Exception as error:  # noqa: BLE001 - a session-list write must not drop the turn
            logger.warning("Index session was not recorded: %s", error)
        return assistant
    finally:
        reset_secret_scope(secret_token)
        reset_hermes_home_override(home_token)
