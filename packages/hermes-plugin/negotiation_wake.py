"""Wake negotiation pickup from conversation SSE (and desktop list ticks).

Gateway process: listen to GET /conversations/stream. Keepalive (~15s) and
non-own negotiation messages each run one cheap pickup. Empty pickup stamps
lastNegotiationPickupAt; pending pickup takes one conservative consult or
respond pass. One in-flight pass at a time.

Desktop: the inbox polls every 15s because the REST bridge buffers SSE — call
tick() from that path instead of inventing a second scheduler.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any, Callable

logger = logging.getLogger(__name__)

_WAKE_LOCK = threading.Lock()
_INFLIGHT = False
_LISTENER_STARTED = False
_STOP = threading.Event()

# Prefer owner consult; never auto-accept/decline. Fallback respond maps closed
# Hermes directives onto ordinary-key turn bodies.
_CONSULT_REASON = "insufficient_commitment_authority"
_MESSAGE_TEMPLATES = {
    "request_time": "I need more time before deciding.",
    "continue": "I am open to continuing within the current scope.",
}
_ACTION_CANDIDATES = {
    "request_time": ("counter", "outreach", "propose"),
    "continue": ("question", "outreach", "propose", "counter"),
}


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


def _protocol_action(preferred: str, allowed: list[str]) -> str | None:
    allowed_set = set(allowed)
    for candidate in _ACTION_CANDIDATES.get(preferred, ()):
        if candidate in allowed_set:
            return candidate
    for fallback in ("question", "outreach", "propose", "counter"):
        if fallback in allowed_set:
            return fallback
    return None


def _respond_body(allowed: list[str]) -> dict[str, Any] | None:
    for preferred in ("request_time", "continue"):
        action = _protocol_action(preferred, allowed)
        if action:
            return {
                "action": action,
                "message": _MESSAGE_TEMPLATES[preferred],
                "assessment": {
                    "reasoning": f"Hermes wake selected a conservative {preferred} turn.",
                    "suggestedRoles": {"ownUser": "peer", "otherUser": "peer"},
                },
            }
    return None


def _handle_pending(transport, agent_id: str, pickup: dict[str, Any]) -> None:
    negotiation_id = pickup.get("negotiationId")
    if not isinstance(negotiation_id, str) or not negotiation_id:
        return
    consult = transport.request_rest(
        "POST",
        f"/agents/{agent_id}/negotiations/{negotiation_id}/consult",
        {"reason": _CONSULT_REASON},
    )
    if isinstance(consult, dict) and consult.get("success") is not False and consult.get("status") == "input_required":
        return
    allowed = pickup.get("allowedActions")
    if not isinstance(allowed, list):
        allowed = []
    allowed_actions = [a for a in allowed if isinstance(a, str)]
    body = _respond_body(allowed_actions)
    if not body:
        return
    transport.request_rest(
        "POST",
        f"/agents/{agent_id}/negotiations/{negotiation_id}/respond",
        body,
    )


def run_pickup_pass(transport=None) -> dict[str, Any]:
    """One pickup; empty is silent success. Pending → consult then maybe respond."""
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
        _handle_pending(transport, agent_id, pickup)
        return {"ok": True, "pending": True, "negotiationId": pickup.get("negotiationId")}
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
    import os

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
    stop_listener_for_tests()
