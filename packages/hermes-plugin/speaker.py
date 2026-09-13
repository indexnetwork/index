"""Hermes sessions that speak and think for the Index negotiator.

One think session per intent (`{intentId}:think`) and one speaker session per
match (`{opportunityId}`). Think is the inbox-review working transcript; H2A
lives on the Index agent DM. The agent package still owns tools, fences, and
the inbox.
"""

from __future__ import annotations

import contextvars
import json

from gateway.session import SessionSource
from tools.registry import no_cache_check_fn

PLATFORM = "index"
_call: contextvars.ContextVar[dict | None] = contextvars.ContextVar("index_call", default=None)
_CONSUMED = {"action": "skip", "reason": "Index session input."}

SPEAK_TOOLS = (
    ("read_negotiation", "index_speak", "Read this match and shared principal context.", {"type": "object", "properties": {}, "additionalProperties": False}, []),
    ("submit_turn", "index_speak", "Record this match decision. propose opens; counter revises; accept agrees; decline ends it.", {
        "type": "object", "additionalProperties": False,
        "properties": {"action": {"type": "string"}, "message": {"type": "string", "minLength": 1}},
        "required": ["action", "message"],
    }, ["action", "message"]),
    ("request_principal_input", "index_speak", "Request one missing principal fact or match approval. Never submit while waiting.", {
        "type": "object", "additionalProperties": False,
        "properties": {
            "question": {"type": "string", "minLength": 1},
            "options": {"type": "array", "minItems": 2, "maxItems": 4, "items": {"type": "string"}},
            "scope": {"type": "string", "enum": ["intent", "match"]},
        },
        "required": ["question", "options", "scope"],
    }, ["question", "options", "scope"]),
    ("review_principal_inbox", "index_think", "Choose one human communication action for this intent.", {
        "type": "object", "additionalProperties": False,
        "properties": {
            "action": {"type": "string", "enum": ["reply", "ask", "update", "wait", "reconsider"]},
            "requestId": {"type": "string"},
            "relatedRequestIds": {"type": "array", "items": {"type": "string"}},
            "opportunityIds": {"type": "array", "items": {"type": "string"}},
            "message": {"type": "string"},
        },
        "required": ["action"],
    }, ["action"]),
)


def _active(kind: str):
    @no_cache_check_fn
    def check(**kwargs):
        del kwargs
        call = _call.get()
        return bool(call and call["kind"] == kind)
    return check


def _handler(name: str):
    def handle(params, **kwargs):
        del kwargs
        call = _call.get()
        if not call:
            return json.dumps({"error": "Not in an Index speaker turn."})
        try:
            reply = call["sidecar"].call("/tool", {
                "callId": call["id"], "name": name, "args": params or {},
            })
            result = reply.get("result", reply)
            return result if isinstance(result, str) else json.dumps(result)
        except Exception as error:  # noqa: BLE001
            return json.dumps({"error": str(error)})
    return handle


def register_tools(ctx, sidecar) -> None:
    """Expose package tools only while a speaker or think turn is running."""
    del sidecar
    for name, toolset, description, parameters, required in SPEAK_TOOLS:
        ctx.register_tool(
            name=name, toolset=toolset,
            schema={"name": name, "description": description, "parameters": {**parameters, "required": required}},
            handler=_handler(name),
            check_fn=_active("inbox" if toolset == "index_think" else "turn"),
        )
    ctx.register_hook("pre_gateway_dispatch", lambda **kwargs: on_session_input(**kwargs))


def on_session_input(*, event, **kwargs):
    """Owner text on Index sessions is not H2A; answers happen on Index web."""
    del kwargs
    source = event.source
    platform = getattr(source.platform, "value", source.platform)
    if platform != PLATFORM or event.internal or getattr(source, "is_bot", False):
        return None
    if not isinstance(event.text, str) or not event.text.strip():
        return None
    return _CONSUMED if source.chat_id else None


def run_session(adapter, sidecar, payload: dict) -> dict:
    """Create or reuse the Hermes session and run one constrained agent loop."""
    store = getattr(adapter, "_session_store", None)
    if store is None:
        raise RuntimeError("The Index platform has no session store.")
    kind = payload["kind"]
    title = payload.get("title") or "Index"
    if kind == "inbox":
        chat_id = f"{payload['intentId']}:think"
        chat_name = f"{title} · think"
        toolset, iterations = "index_think", 2
    else:
        chat_id = payload["opportunityId"]
        chat_name = f"{payload.get('counterparty') or 'Match'} · {title}"
        toolset, iterations = "index_speak", 10
    source = SessionSource(
        platform=adapter.platform, chat_id=chat_id, chat_type="dm", chat_name=chat_name,
        user_id=getattr(adapter, "_owner", None) or "index", user_name="Index",
    )
    entry = store.get_or_create_session(source)
    session_db = store._db_for_key(entry.session_key) if hasattr(store, "_db_for_key") else None
    session_db = getattr(session_db, "_db", session_db) or getattr(store, "_db", None)
    if session_db and not session_db.get_session_title(entry.session_id):
        try:
            session_db.set_session_title(entry.session_id, chat_name[:100])
        except ValueError:
            pass
    token = _call.set({"id": payload["callId"], "kind": kind, "sidecar": sidecar})
    try:
        from gateway.run import _resolve_gateway_model, _resolve_runtime_agent_kwargs
        from run_agent import AIAgent

        agent = AIAgent(
            session_id=entry.session_id,
            model=_resolve_gateway_model(),
            **_resolve_runtime_agent_kwargs(),
            ephemeral_system_prompt=payload.get("systemPrompt") or None,
            platform=PLATFORM,
            user_id=source.user_id,
            user_name=source.user_name,
            chat_id=chat_id,
            chat_name=chat_name,
            chat_type="dm",
            gateway_session_key=entry.session_key,
            session_db=session_db,
            quiet_mode=False,
            skip_context_files=True,
            skip_memory=True,
            enabled_toolsets=[toolset],
            max_iterations=iterations,
        )
        agent._end_session_on_close = False
        result = agent.run_conversation(payload["prompt"])
        return {"end": "done", "output": (result or {}).get("final_response") or ""}
    finally:
        _call.reset(token)
