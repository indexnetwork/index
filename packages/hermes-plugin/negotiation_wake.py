"""Wake negotiation pickup from conversation SSE (and desktop list ticks).

Gateway process: listen to GET /conversations/stream. Keepalive (~15s) and
non-own negotiation messages each run one cheap pickup. Empty pickup stamps
lastNegotiationPickupAt. Pending pickup claims the turn, then asks Hermes
to run one model turn. No auto consult or respond from this thread.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
from typing import Any, Callable

logger = logging.getLogger(__name__)

_WAKE_LOCK = threading.Lock()
_INFLIGHT = False
_LISTENER_STARTED = False
_STOP = threading.Event()
_TURN_STARTER: Callable[[str], None] | None = None
_STARTED_IDS: set[str] = set()
_RUNTIME_KEY = "_index_network_negotiation_wake_runtime"

_TURN_PROMPT = (
    "Index negotiation {negotiation_id} is already claimed on this Hermes seat. "
    "Do not call index_pickup_negotiation. Read the claimed thread, then reply "
    "once with index_respond_to_negotiation using a protocol action and a real "
    "message written for this counterpart. Consult the owner only if the thread "
    "needs Seref. Do not stall with request_time."
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


def _message_action(message: dict[str, Any]) -> str | None:
    parts = message.get("parts")
    if not isinstance(parts, list):
        return None
    for part in parts:
        if not isinstance(part, dict):
            continue
        data = part.get("data")
        if isinstance(data, dict):
            action = data.get("action")
            if isinstance(action, str) and action.strip():
                return action.strip()
        action = part.get("action")
        if isinstance(action, str) and action.strip():
            return action.strip()
    return None


def should_wake_on_event(event: dict[str, Any], *, owner_user_id: str | None) -> bool:
    """True for a negotiation message that is not this owner's agent turn."""
    if event.get("type") != "message":
        return False
    message = event.get("message")
    if not isinstance(message, dict):
        return False
    if _message_action(message) is None:
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
    """Start one Hermes chat turn after a pending claim via inject_message."""

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


def run_pickup_pass(transport=None) -> dict[str, Any]:
    """One pickup. Empty stamps the seat. Pending claims, then one Hermes turn."""
    global _INFLIGHT
    with _WAKE_LOCK:
        if _INFLIGHT:
            return {"ok": True, "skipped": "inflight"}
        _INFLIGHT = True
    try:
        transport = transport or _transport()
        agent_id, _owner_id = _resolve_me(transport)
        if not agent_id:
            return {"ok": False, "error": "agent_unavailable"}
        pickup = transport.request_rest("POST", f"/agents/{agent_id}/negotiations/pickup")
        if not isinstance(pickup, dict):
            return {"ok": False, "error": "invalid_pickup"}
        if pickup.get("success") is False:
            return {"ok": False, "error": pickup.get("error") or "pickup_failed"}
        if pickup.get("no_content") is True or pickup.get("pending") is False:
            return {"ok": True, "pending": False}
        if pickup.get("pending") is not True and not pickup.get("negotiationId"):
            return {"ok": True, "pending": False}
        negotiation_id = pickup.get("negotiationId")
        if isinstance(negotiation_id, str) and negotiation_id.strip():
            _maybe_start_turn(negotiation_id.strip())
            return {"ok": True, "pending": True, "negotiationId": negotiation_id.strip()}
        return {"ok": True, "pending": True, "negotiationId": negotiation_id}
    except Exception as exc:  # noqa: BLE001 - wake must never break the host process
        logger.debug("negotiation wake pickup failed: %s", exc)
        return {"ok": False, "error": str(exc)}
    finally:
        with _WAKE_LOCK:
            _INFLIGHT = False


def tick() -> dict[str, Any]:
    """Desktop 15s path: same cheap pickup heartbeat, no second scheduler."""
    return run_pickup_pass()


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
                    run_pickup_pass(transport)
                    continue
                event = _parse_data_line(line)
                if event is None:
                    continue
                if should_wake_on_event(event, owner_user_id=owner_id):
                    run_pickup_pass(transport)
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
    global _LISTENER_STARTED, _INFLIGHT
    _STOP.set()
    with _WAKE_LOCK:
        _LISTENER_STARTED = False
        _INFLIGHT = False


def reset_for_tests() -> None:
    global _TURN_STARTER
    stop_listener_for_tests()
    with _WAKE_LOCK:
        _STARTED_IDS.clear()
        _TURN_STARTER = None


if _RUNTIME_KEY not in sys.modules:
    sys.modules[_RUNTIME_KEY] = sys.modules[__name__]
