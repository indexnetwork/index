"""Hermes sessions that speak and think for the Index negotiator.

One think session per intent (`{intentId}:think`) and one speaker session per
match (`{opportunityId}`). The agent package still owns tools, fences, and the
inbox; these sessions are the mouth.
"""

from __future__ import annotations

import contextvars
import json
import logging

from gateway.session import SessionSource
from tools.registry import no_cache_check_fn

logger = logging.getLogger(__name__)

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
    for name, toolset, description, parameters, required in SPEAK_TOOLS:
        ctx.register_tool(
            name=name, toolset=toolset,
            schema={"name": name, "description": description, "parameters": {**parameters, "required": required}},
            handler=_handler(name),
            check_fn=_active("inbox" if toolset == "index_think" else "turn"),
        )
    ctx.register_hook("pre_gateway_dispatch", lambda **kwargs: on_session_input(sidecar, **kwargs))


def on_session_input(sidecar, *, event, **kwargs):
    """Owner text in a think session is package input. Speaker sessions ignore it."""
    del kwargs
    source = event.source
    platform = getattr(source.platform, "value", source.platform)
    if platform != PLATFORM or event.internal or getattr(source, "is_bot", False):
        return None
    if not isinstance(event.text, str) or not event.text.strip():
        return None
    chat = source.chat_id or ""
    if not chat.endswith(":think"):
        return _CONSUMED if chat else None
    intent_id = chat[:-len(":think")]
    try:
        pending = sidecar.call("/pending", {"intentId": intent_id}).get("pending")
        question_id = (pending or {}).get("id")
        route = "/answer" if question_id else "/message"
        payload = {"intentId": intent_id, "text": event.text}
        if question_id:
            payload["questionId"] = question_id
        accepted = sidecar.call(route, payload).get("accepted")
    except Exception as error:  # noqa: BLE001
        logger.warning("Index think session did not record owner input: %s", error)
        return None
    return _CONSUMED if accepted else None


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
    token = _call.set({"id": payload["callId"], "kind": kind, "sidecar": sidecar})
    try:
        from gateway.run import _resolve_gateway_model, _resolve_runtime_agent_kwargs
        from run_agent import AIAgent

        agent = AIAgent(
            session_id=entry.session_id,
            model=_resolve_gateway_model(),
            **_resolve_runtime_agent_kwargs(),
            platform=PLATFORM,
            quiet_mode=False,
            skip_context_files=True,
            skip_memory=True,
            enabled_toolsets=[toolset],
            max_iterations=iterations,
        )
        result = agent.run_conversation(payload["prompt"])
        return {"end": "done", "output": (result or {}).get("final_response") or ""}
    finally:
        _call.reset(token)


def write_think(adapter, intent_id: str, title: str, entries: list) -> None:
    """Show inbox questions and replies on the think session."""
    store = getattr(adapter, "_session_store", None)
    if store is None or not entries:
        return
    source = SessionSource(
        platform=adapter.platform, chat_id=f"{intent_id}:think", chat_type="dm",
        chat_name=f"{title} · think", user_id=getattr(adapter, "_owner", None) or "index",
        user_name="Index",
    )
    session = store.get_or_create_session(source)
    for entry in entries:
        store.append_to_transcript(session.session_id, {
            "role": "user" if entry.get("kind") in ("user", "answer") else "assistant",
            "content": entry.get("text") or "",
        })
