"""Index events wake the negotiator. Hermes sessions are created on speak."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from typing import Any

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, SendResult

from .speaker import PLATFORM
from .tools import selected_agent
from .transport import get_transport

logger = logging.getLogger(__name__)

WAKE_TYPES = frozenset({"negotiation.opened", "negotiation.changed", "intent.lifecycle"})
ACTIVATION_TYPES = frozenset({"intent.created", "intent.broadcast"})
INPUT_TYPE = "principal.input"
SETTLE_SECONDS = 2.0
RECONNECT_SECONDS = 5.0


def check_requirements() -> bool:
    return True


def is_connected(config: PlatformConfig | None = None) -> bool:
    del config
    return bool(os.environ.get("INDEX_SESSION_TOKEN", "").strip())


class IndexAdapter(BasePlatformAdapter):
    """Follow the owner's event stream and start the sidecar when this machine is selected."""

    def __init__(self, config: PlatformConfig, sidecar):
        super().__init__(config, Platform(PLATFORM))
        self._sidecar = sidecar
        self._owner = ""
        self._executor = ""
        self._pending: set[str] = set()
        self._inputs: list[dict] = []
        self._closing = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._signal: asyncio.Event | None = None
        self._dispatcher: asyncio.Task | None = None

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        """Start the negotiator with this platform, then follow Index events."""
        del is_reconnect
        self._closing = False
        self._loop = asyncio.get_running_loop()
        self._signal = asyncio.Event()
        self._sidecar.bridge.adapter = self
        self._dispatcher = self._loop.create_task(self._dispatch())
        threading.Thread(target=self._read, name="index-events", daemon=True).start()
        return True

    async def disconnect(self) -> None:
        self._closing = True
        self._sidecar.bridge.adapter = None
        if self._dispatcher is not None:
            self._dispatcher.cancel()
            self._dispatcher = None
        await asyncio.to_thread(self._sidecar.stop)

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        return {"name": f"Index {chat_id}", "type": "dm", "id": chat_id}

    async def send(self, chat_id: str, content: str, reply_to: str | None = None, metadata: dict | None = None) -> SendResult:
        del chat_id, content, reply_to, metadata
        return SendResult(success=False, error="Index sessions are not a delivery target.")

    def _apply(self) -> bool:
        """Run the negotiator only while this machine is the selected executor.

        @returns Whether Index currently names this Hermes agent for negotiations.
        """
        agent = selected_agent()
        executor_id = os.environ.get("INDEX_EXECUTOR_ID", "").strip()
        if not executor_id or agent.get("id") != executor_id or agent.get("type") != "external" or not agent.get("handleNegotiations"):
            self._sidecar.stop()
            return False
        self._owner = agent["ownerId"]
        self._executor = agent["id"]
        self._sidecar.start(self._owner, self._executor)
        return True

    def _read(self) -> None:
        """Follow Index events; start/stop already follow the selected executor."""
        while not self._closing:
            try:
                if self._apply():
                    self._reconcile()
                    for line in get_transport().stream_sse(f"/events?consumer={self._executor}"):
                        if self._closing:
                            return
                        self._observe(line)
            except Exception as error:  # noqa: BLE001
                logger.warning("Index event stream ended: %s", error)
            time.sleep(RECONNECT_SECONDS)

    def _reconcile(self) -> None:
        result = get_transport().request_rest("GET", "/negotiations")
        for item in result.get("negotiations") or []:
            if not item.get("settledAt") and item.get("awaitingUserId") == self._owner:
                self._queue(item["intentId"])

    def _observe(self, line: bytes) -> None:
        if not line.startswith(b"data:"):
            return
        try:
            frame = json.loads(line[len(b"data:"):])
        except ValueError:
            return
        data = frame.get("data") or {}
        intent = data.get("intentId")
        if frame.get("type") == "agent.configuration":
            self._apply()
            return
        if frame.get("type") == INPUT_TYPE and intent and isinstance(frame.get("id"), str):
            self._loop.call_soon_threadsafe(self._collect_input, {"intentId": intent, "inputId": frame["id"]})
            return
        if intent and frame.get("type") in ACTIVATION_TYPES and isinstance(frame.get("id"), str):
            activation = {"id": frame["id"], "type": frame["type"]}
            if frame["type"] == "intent.broadcast":
                if not isinstance(data.get("networkId"), str):
                    return
                activation["networkId"] = data["networkId"]
            self._loop.call_soon_threadsafe(self._collect_input, {"intentId": intent, "activation": activation})
            return
        if intent and frame.get("type") in WAKE_TYPES:
            self._queue(intent)

    def _queue(self, intent: str) -> None:
        self._loop.call_soon_threadsafe(self._collect, intent)

    def _collect(self, intent: str) -> None:
        self._pending.add(intent)
        self._signal.set()

    def _collect_input(self, data: dict) -> None:
        self._inputs.append(data)
        self._signal.set()

    def _deliver(self, data: dict) -> None:
        intent = data["intentId"]
        try:
            if "activation" in data:
                self._sidecar.call("/wake", data)
            else:
                self._sidecar.call("/input", data)
        except Exception as error:  # noqa: BLE001
            logger.warning("Index negotiator did not accept owner input for %s: %s", intent, error)

    async def _dispatch(self) -> None:
        while True:
            await self._signal.wait()
            self._signal.clear()
            await asyncio.sleep(SETTLE_SECONDS)
            while self._inputs:
                await asyncio.to_thread(self._deliver, self._inputs.pop(0))
            while self._pending:
                intent = self._pending.pop()
                await asyncio.to_thread(self._sidecar.wake, intent)


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
        platform_hint="One think session per signal and one speaker session per match.",
    )
