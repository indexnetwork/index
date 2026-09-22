"""Forward persisted Index events to the selected external agent runner."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
import urllib.parse
from typing import Any

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, SendResult

from .speaker import PLATFORM
from .tools import selected_agent
from .transport import get_transport

logger = logging.getLogger(__name__)

INTENT_EVENT_TYPES = frozenset({
    "principal.input",
    "intent.created",
    "intent.updated",
    "intent.lifecycle",
    "agent.wake",
})
NEGOTIATION_EVENT_TYPE = "negotiation.turn"
RECONNECT_SECONDS = 5.0


def check_requirements() -> bool:
    return True


def is_connected(config: PlatformConfig | None = None) -> bool:
    del config
    return bool(os.environ.get("INDEX_SESSION_TOKEN", "").strip())


class IndexAdapter(BasePlatformAdapter):
    """Follow the owner's durable event stream while this machine is selected."""

    def __init__(self, config: PlatformConfig, sidecar):
        super().__init__(config, Platform(PLATFORM))
        self._sidecar = sidecar
        self._owner = ""
        self._closing = False

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        """Attach the bridge and begin following Index events."""
        del is_reconnect
        self._closing = False
        self._sidecar.bridge.adapter = self
        threading.Thread(target=self._read, name="index-events", daemon=True).start()
        return True

    async def disconnect(self) -> None:
        self._closing = True
        self._sidecar.bridge.adapter = None
        await asyncio.to_thread(self._sidecar.stop)

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        return {"name": f"Index {chat_id}", "type": "dm", "id": chat_id}

    async def send(self, chat_id: str, content: str, reply_to: str | None = None, metadata: dict | None = None) -> SendResult:
        del chat_id, content, reply_to, metadata
        return SendResult(success=False, error="Index sessions are not a delivery target.")

    def _apply(self) -> str | None:
        """Start the sidecar for the selected external executor and return its ID."""
        agent = selected_agent()
        if agent.get("type") != "external" or not agent.get("handleNegotiations"):
            self._sidecar.stop()
            return None
        self._owner = agent["ownerId"]
        self._sidecar.start(self._owner, agent["id"])
        return agent["id"]

    def _read(self) -> None:
        """Follow one executor-owned SSE cursor and preserve frame order."""
        while not self._closing:
            try:
                executor_id = self._apply()
                if executor_id:
                    consumer = urllib.parse.quote(executor_id, safe="")
                    for line in get_transport().stream_sse(f"/events?consumer={consumer}"):
                        if self._closing:
                            return
                        if self._observe(line):
                            break
            except Exception as error:  # noqa: BLE001
                logger.warning("Index event stream ended: %s", error)
            if not self._closing:
                time.sleep(RECONNECT_SECONDS)

    def _observe(self, line: bytes) -> bool:
        """Forward one SSE data frame. Return true when executor selection must reconnect."""
        if not line.startswith(b"data:"):
            return False
        try:
            frame = json.loads(line[len(b"data:"):])
        except ValueError:
            return False

        event_type = frame.get("type")
        if event_type == "connected":
            self._sidecar.reconcile()
            return False
        if event_type == "agent.configuration":
            self._apply()
            return True

        data = frame.get("data")
        if not isinstance(data, dict):
            return False
        intent_id = data.get("intentId")
        if not isinstance(intent_id, str):
            return False
        if event_type in INTENT_EVENT_TYPES:
            self._sidecar.event({"type": event_type, "intentId": intent_id})
            return False
        if event_type == NEGOTIATION_EVENT_TYPE and isinstance(data.get("opportunityId"), str):
            self._sidecar.event({
                "type": event_type,
                "intentId": intent_id,
                "opportunityId": data["opportunityId"],
            })
        return False


def register_platform(ctx, sidecar) -> None:
    ctx.register_platform(
        name=PLATFORM,
        label="Index",
        adapter_factory=lambda config: IndexAdapter(config, sidecar),
        check_fn=check_requirements,
        validate_config=is_connected,
        is_connected=is_connected,
        required_env=["INDEX_SESSION_TOKEN"],
        emoji="\U0001f9ed",
        pii_safe=True,
        platform_hint="One principal runner with a think session per signal and a session per match.",
    )
