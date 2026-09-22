"""Run package-prepared reasoning through native Hermes sessions."""

from __future__ import annotations

import contextvars
import json
import threading

from gateway.session import SessionSource
from tools.registry import no_cache_check_fn

PLATFORM = "index"
TOOLSET = "index-agent"
TOOL_NAMES = (
    "reach_counterparties",
    "set_brief",
    "note_principal",
    "ask_principal",
    "expire_question",
    "submit_turn",
    "stall",
)
_call: contextvars.ContextVar[dict | None] = contextvars.ContextVar("index_call", default=None)
_active_agents: dict[str, object] = {}
_active_agents_lock = threading.Lock()
_CONSUMED = {"action": "skip", "reason": "Index session input."}


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
            return json.dumps({"error": f"{name} is not permitted in this Index run."})
        try:
            reply = call["sidecar"].call("/tool", {
                "callId": call["id"], "name": name, "args": params or {},
            })
        except Exception as error:  # noqa: BLE001
            return json.dumps({"error": str(error)})
        if reply.get("ok") is not True:
            return json.dumps({"error": reply.get("error") or f"{name} failed."})
        if reply.get("terminal") is True:
            call["terminal"] = True
            agent = call.get("agent")
            if agent is not None:
                agent.hard_interrupt(
                    "Index terminal tool completed.",
                    tool_reason="index terminal tool completed",
                )
        result = reply.get("result")
        return result if isinstance(result, str) else json.dumps(result)

    return handle


def register_tools(ctx, sidecar) -> None:
    """Register the finite package tool names; each run supplies exact schemas."""
    del sidecar
    for name in TOOL_NAMES:
        ctx.register_tool(
            name=name,
            toolset=TOOLSET,
            schema={
                "name": name,
                "description": "An action supplied by the Index agent package for this run.",
                "parameters": {"type": "object"},
            },
            handler=_handler(name),
            check_fn=_active(name),
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


def _agent_type():
    from run_agent import AIAgent

    class IndexAIAgent(AIAgent):
        """Hermes loop constrained to the package's sequential, bounded contract."""

        def _execute_tool_calls(self, assistant_message, messages, effective_task_id, api_call_count=0):
            self._executing_tools = True
            try:
                return self._execute_tool_calls_sequential(
                    assistant_message, messages, effective_task_id, api_call_count,
                )
            finally:
                self._executing_tools = False

        def _handle_max_iterations(self, messages, api_call_count):
            del messages, api_call_count
            return ""

    return IndexAIAgent


def cancel_session(call_id: str) -> bool:
    """Stop one active Hermes run after its package execution is cancelled."""
    with _active_agents_lock:
        agent = _active_agents.get(call_id)
    if agent is None:
        return False
    agent.hard_interrupt("Index execution cancelled.", tool_reason="index execution cancelled")
    return True


def run_session(adapter, sidecar, payload: dict) -> dict:
    """Create or reuse the matching Hermes session and execute one package run."""
    store = getattr(adapter, "_session_store", None)
    if store is None:
        raise RuntimeError("The Index platform has no session store.")

    operation = payload["operation"]
    if operation == "negotiate":
        chat_id = payload["opportunityId"]
        chat_name = "Index negotiation"
    else:
        chat_id = f"{payload['intentId']}:think"
        chat_name = "Index principal agent"
    source = SessionSource(
        platform=adapter.platform,
        chat_id=chat_id,
        chat_type="dm",
        chat_name=chat_name,
        user_id=payload["principalId"],
        user_name="Index",
    )
    entry = store.get_or_create_session(source)
    session_db = store._db_for_key(entry.session_key) if hasattr(store, "_db_for_key") else None
    session_db = getattr(session_db, "_db", session_db) or getattr(store, "_db", None)
    if session_db and not session_db.get_session_title(entry.session_id):
        try:
            session_db.set_session_title(entry.session_id, chat_name)
        except ValueError:
            pass

    supplied_tools = {tool["name"]: tool for tool in payload["tools"]}
    call = {
        "id": payload["callId"],
        "sidecar": sidecar,
        "tools": supplied_tools,
        "terminal": False,
    }
    token = _call.set(call)
    try:
        from gateway.run import _resolve_gateway_model, _resolve_runtime_agent_kwargs

        Agent = _agent_type()
        agent = Agent(
            session_id=entry.session_id,
            model=_resolve_gateway_model(),
            **_resolve_runtime_agent_kwargs(),
            ephemeral_system_prompt=payload["instructions"],
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
            skip_background_review=True,
            enabled_toolsets=[TOOLSET],
            max_iterations=payload["maxSteps"],
        )
        agent._end_session_on_close = False
        agent.tools = [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool["description"],
                    "parameters": tool["parameters"],
                },
            }
            for tool in payload["tools"]
        ]
        agent.valid_tool_names = set(supplied_tools)
        call["agent"] = agent
        with _active_agents_lock:
            _active_agents[payload["callId"]] = agent
        result = agent.run_conversation(payload["prompt"])
        if isinstance(result, dict) and result.get("error") and not call["terminal"]:
            raise RuntimeError(str(result["error"]))
        return {"ok": True}
    finally:
        with _active_agents_lock:
            _active_agents.pop(payload["callId"], None)
        _call.reset(token)
