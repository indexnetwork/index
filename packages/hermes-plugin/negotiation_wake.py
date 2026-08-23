"""Wake a Hermes negotiation turn from conversation SSE.

Gateway process: listen to GET /conversations/stream. On a negotiation
message that is not this owner's own agent turn, start one Hermes chat turn
for that negotiation via inject_message.

Negotiation-graph rewrite (#1494): there is no more pickup/claim (a
negotiation stays `working` until it pauses or resolves -- it is never
claimed into a distinct state), so there is no server-side "poll for
anything pending" endpoint any more either. This listener can only react to
an SSE message event it actually observes; unlike the old pickup-backed
heartbeat, there is no periodic catch-up poll behind it any more, so a
missed SSE event (a dropped connection during reconnect backoff, for
example) is simply missed until the next message arrives. Accepted as a
known limitation of this rewrite; the actual response is a plain
`index_respond_negotiation` call, not something this module makes.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Callable

logger = logging.getLogger(__name__)

_WAKE_LOCK = threading.Lock()
_LISTENER_STARTED = False
_STOP = threading.Event()
_TURN_STARTER: Callable[[str], None] | None = None
_STARTED_IDS: set[str] = set()

_TURN_PROMPT = (
    "Index negotiation {negotiation_id} has a new message on this Hermes seat. "
    "Use get_negotiation to read its brief and turn history, then call "
    "index_respond_negotiation with negotiationId {negotiation_id} and exactly "
    "one closed action: outreach, counter, or question to continue; "
    "ask_principal to pause for the owner; recommend_pending or recommend_reject "
    "to pause with a verdict recommendation for the owner's own agent. There is "
    "no accept, decline, withdraw, or consult -- if you would want out, submit "
    "recommend_reject."
)


def _transport():
    from .transport import get_transport

    return get_transport()


def _is_keepalive(line: bytes) -> bool:
    text = line.decode("utf-8", errors="replace").strip()
    return text.startswith(":") and "keepalive" in text.lower()


def _parse_data_line(line: bytes) -> dict[str, Any] | None:
    if not line.endswith(b"\n"):
        return None
    content = line[:-1]
    if content.endswith(b"\r"):
        content = content[:-1]
    if not content.startswith(b"data:"):
        return None
    payload = content[len(b"data:") :]
    if payload.startswith(b" "):
        payload = payload[1:]
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _message_turn_verb(message: dict[str, Any]) -> str | None:
    """A negotiation turn's verb (outreach/counter/question/pause), if this message carries one."""
    parts = message.get("parts")
    if not isinstance(parts, list):
        return None
    for part in parts:
        if not isinstance(part, dict):
            continue
        data = part.get("data")
        if isinstance(data, dict):
            verb = data.get("verb")
            if isinstance(verb, str) and verb.strip():
                return verb.strip()
    return None


def _message_negotiation_id(message: dict[str, Any]) -> str | None:
    task_id = message.get("taskId")
    return task_id.strip() if isinstance(task_id, str) and task_id.strip() else None


def should_wake_on_event(event: dict[str, Any], *, owner_user_id: str | None) -> bool:
    """True for a negotiation message that is not this owner's agent turn."""
    if event.get("type") != "message":
        return False
    message = event.get("message")
    if not isinstance(message, dict):
        return False
    if _message_turn_verb(message) is None:
        return False
    if _message_negotiation_id(message) is None:
        return False
    sender = message.get("senderId")
    if not isinstance(sender, str) or not sender:
        return False
    if owner_user_id and sender == f"agent:{owner_user_id}":
        return False
    return True


def _resolve_me(transport) -> tuple[str | None, str | None]:
    payload = transport.request_rest("GET", "/agents/me")
    if not isinstance(payload, dict) or payload.get("success") is False:
        return None, None
    agent = payload.get("agent") if isinstance(payload.get("agent"), dict) else payload
    if not isinstance(agent, dict):
        return None, None
    agent_id = agent.get("id") if isinstance(agent.get("id"), str) else None
    owner_id = agent.get("ownerId") if isinstance(agent.get("ownerId"), str) else None
    if not owner_id:
        user = payload.get("user") if isinstance(payload.get("user"), dict) else None
        if isinstance(user, dict) and isinstance(user.get("id"), str):
            owner_id = user["id"]
    return agent_id, owner_id


def set_turn_starter(starter: Callable[[str], None] | None) -> None:
    """Tests and register() install the Hermes turn hook. Wake never POSTs respond."""
    global _TURN_STARTER
    _TURN_STARTER = starter


def bind_plugin_context(ctx) -> None:
    """Start one Hermes chat turn for a negotiation via inject_message."""

    def start(negotiation_id: str) -> None:
        if not hasattr(ctx, "inject_message"):
            return
        prompt = _TURN_PROMPT.format(negotiation_id=negotiation_id)
        session = os.environ.get("INDEX_HERMES_SESSION_KEY", "").strip() or None
        try:
            ok = (
                ctx.inject_message(prompt, session_key=session)
                if session
                else ctx.inject_message(prompt)
            )
            if ok is False:
                logger.warning("negotiation wake inject returned false for %s", negotiation_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("negotiation wake inject failed: %s", exc)

    set_turn_starter(start)


def _maybe_start_turn(negotiation_id: str) -> None:
    with _WAKE_LOCK:
        if negotiation_id in _STARTED_IDS:
            return
        _STARTED_IDS.add(negotiation_id)
        starter = _TURN_STARTER
    if starter is None:
        return
    try:
        starter(negotiation_id)
    except Exception as exc:  # noqa: BLE001
        logger.debug("negotiation wake turn start failed: %s", exc)


def _listen_loop(stream_factory: Callable[[], Any] | None = None) -> None:
    backoff = 1.0
    while not _STOP.is_set():
        try:
            transport = _transport()
            _agent_id, owner_id = _resolve_me(transport)
            iterator = stream_factory() if stream_factory else transport.stream_sse("/conversations/stream")
            backoff = 1.0
            for line in iterator:
                if _STOP.is_set():
                    return
                if _is_keepalive(line):
                    continue
                event = _parse_data_line(line)
                if event is None:
                    continue
                if should_wake_on_event(event, owner_user_id=owner_id):
                    negotiation_id = _message_negotiation_id(event["message"])
                    if negotiation_id:
                        _maybe_start_turn(negotiation_id)
        except Exception as exc:  # noqa: BLE001
            logger.debug("negotiation wake stream interrupted: %s", exc)
            if _STOP.wait(backoff):
                return
            backoff = min(backoff * 2, 60.0)


def start_listener(*, stream_factory: Callable[[], Any] | None = None) -> bool:
    """Start the background SSE listener once (gateway / full plugin mode)."""
    global _LISTENER_STARTED
    if stream_factory is None and not os.environ.get("INDEX_API_KEY", "").strip():
        return False
    with _WAKE_LOCK:
        if _LISTENER_STARTED:
            return False
        _LISTENER_STARTED = True
        _STOP.clear()
    thread = threading.Thread(
        target=_listen_loop,
        kwargs={"stream_factory": stream_factory},
        name="index-negotiation-wake",
        daemon=True,
    )
    thread.start()
    return True


def stop_listener_for_tests() -> None:
    """Test helper: stop the wake loop and clear the started flag."""
    global _LISTENER_STARTED
    _STOP.set()
    with _WAKE_LOCK:
        _LISTENER_STARTED = False


def reset_for_tests() -> None:
    global _TURN_STARTER
    stop_listener_for_tests()
    with _WAKE_LOCK:
        _STARTED_IDS.clear()
        _TURN_STARTER = None
