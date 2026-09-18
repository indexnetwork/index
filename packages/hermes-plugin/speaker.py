"""Native Hermes think/speaker sessions with the current Index tools and fences.

Working sessions remain visible in Hermes. Canonical owner input lives on Index;
private briefs, retirement records and delivery receipts belong to the sidecar's
record store, never to a resumed model transcript.
"""

from __future__ import annotations

import contextvars
import json

from gateway.session import SessionSource
from tools.registry import no_cache_check_fn

PLATFORM = "index"
_call: contextvars.ContextVar[dict | None] = contextvars.ContextVar("index_call", default=None)
_CONSUMED = {"action": "skip", "reason": "Index session input."}

SPEAK_TOOLS = {
    "index_speak": ("read_negotiation", "submit_turn", "pause_negotiation"),
    "index_think": ("save_standing_brief", "review_principal_inbox", "discover_counterparties", "open_negotiation"),
}


def _active(name: str):
    @no_cache_check_fn
    def check(**kwargs):
        del kwargs
        call = _call.get()
        return bool(call and name in call["tools"])
    return check


def _handler(name: str):
    def handle(params, **kwargs):
        del kwargs
        call = _call.get()
        if not call or name not in call["tools"]:
            return json.dumps({"error": "This tool is not offered in the current Index run."})
        try:
            reply = call["sidecar"].call("/tool", {"callId": call["id"], "name": name, "args": params or {}})
            if reply.get("stop"):
                call["agent"].interrupt("Index ended this run; do not retry or continue.", hard_cancel=True)
            result = reply.get("result", reply)
            return result if isinstance(result, str) else json.dumps(result)
        except Exception as error:  # noqa: BLE001
            # An uncertain tool response is not permission for another attempt.
            call["agent"].interrupt("The Index tool response was lost; inspect its canonical records.", hard_cancel=True)
            return json.dumps({"error": str(error)})
    return handle


def register_tools(ctx, sidecar) -> None:
    """Register dispatchers; each native run receives its exact schema from Index."""
    del sidecar
    for toolset, names in SPEAK_TOOLS.items():
        for name in names:
            ctx.register_tool(
                name=name, toolset=toolset,
                schema={"name": name, "description": "Supplied by the active Index run.",
                        "parameters": {"type": "object", "properties": {}}},
                handler=_handler(name), check_fn=_active(name),
            )
    ctx.register_hook("pre_gateway_dispatch", lambda **kwargs: on_session_input(**kwargs))


def on_session_input(*, event, **kwargs):
    """Owner text on Index working sessions is not H2A; answers happen on Index."""
    del kwargs
    source = event.source
    platform = getattr(source.platform, "value", source.platform)
    if platform != PLATFORM or event.internal or getattr(source, "is_bot", False):
        return None
    if not isinstance(event.text, str) or not event.text.strip():
        return None
    return _CONSUMED if source.chat_id else None


def run_session(adapter, sidecar, payload: dict, lifecycle: dict) -> dict:
    """Create or reuse Seref's native think/speaker session with current domain tools."""
    store = getattr(adapter, "_session_store", None)
    if store is None:
        raise RuntimeError("The Index platform has no session store.")
    kind = payload["kind"]
    title = payload.get("title") or "Index"
    if kind == "inbox":
        chat_id, chat_name, toolset = f"{payload['intentId']}:think", f"{title} · think", "index_think"
    else:
        chat_id = payload["opportunityId"]
        chat_name, toolset = f"{payload.get('counterparty') or 'Match'} · {title}", "index_speak"
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
    tools = payload["tools"]
    call = {"id": payload["callId"], "sidecar": sidecar, "tools": {tool["function"]["name"] for tool in tools}}
    token = _call.set(call)
    try:
        from gateway.run import _resolve_gateway_model, _resolve_runtime_agent_kwargs
        from run_agent import AIAgent

        agent = AIAgent(
            session_id=entry.session_id, model=_resolve_gateway_model(), **_resolve_runtime_agent_kwargs(),
            ephemeral_system_prompt=payload["systemPrompt"], platform=PLATFORM,
            user_id=source.user_id, user_name=source.user_name, chat_id=chat_id, chat_name=chat_name,
            chat_type="dm", gateway_session_key=entry.session_key, session_db=session_db,
            quiet_mode=False, skip_context_files=True, skip_memory=True,
            enabled_toolsets=[toolset], max_iterations=10,
        )
        call["agent"] = lifecycle["agent"] = agent
        if lifecycle["cancelled"].is_set():
            raise RuntimeError("Index cancelled this native run before it started.")
        # Do not duplicate dynamic legal actions or H2A schemas in Python.
        agent.tools = tools
        agent.valid_tool_names = call["tools"]
        agent._end_session_on_close = False
        result = agent.run_conversation(payload["prompt"])
        return {"end": "done", "output": (result or {}).get("final_response") or ""}
    finally:
        _call.reset(token)
