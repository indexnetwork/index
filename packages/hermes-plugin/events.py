"""The owner's Index event stream, as a gateway platform.

Index publishes a frame whenever one of the owner's signals owes a turn, so the
negotiator is woken by those frames instead of by a schedule. Every frame is a
pointer: the negotiator re-reads authoritative state over REST before deciding
anything, which is what makes a missed or duplicated frame cost nothing.

The work itself happens in the negotiator sidecar, not in a Hermes session, so
this platform opens no chats and delivers no messages. It exists for its
connection lifecycle: while this machine is the selected negotiator, it keeps the
stream and the sidecar running together.
"""

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

from .native_agent import PLATFORM
from .transport import get_transport


logger = logging.getLogger(__name__)

# Negotiation changes refresh the affected seat; intent.lifecycle describes
# whether this owner's own signal should be worked at all.
WAKE_TYPES = frozenset({
    "negotiation.opened", "negotiation.changed", "intent.lifecycle",
})
# Matches on one signal move together, so let sibling frames land in one wake.
SETTLE_SECONDS = 2.0
RECONNECT_SECONDS = 5.0


def check_requirements() -> bool:
    """The reader needs no SDK, so the platform is always installable."""
    return True


def is_connected(config: PlatformConfig | None = None) -> bool:
    """Configured exactly when this device holds an Index session token."""
    del config
    return bool(os.environ.get("INDEX_SESSION_TOKEN", "").strip())


class IndexAdapter(BasePlatformAdapter):
    """Follow the owner's event stream and wake the negotiator per signal."""

    def __init__(self, config: PlatformConfig, sidecar):
        super().__init__(config, Platform(PLATFORM))
        self._sidecar = sidecar
        self._owner = ""
        self._pending: set[str] = set()
        self._closing = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._signal: asyncio.Event | None = None
        self._dispatcher: asyncio.Task | None = None

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        """Start the dispatcher on the gateway loop and the reader beside it."""
        del is_reconnect
        self._closing = False
        self._loop = asyncio.get_running_loop()
        self._signal = asyncio.Event()
        self._dispatcher = self._loop.create_task(self._dispatch())
        threading.Thread(target=self._read, name="index-events", daemon=True).start()
        return True

    async def disconnect(self) -> None:
        self._closing = True
        if self._dispatcher is not None:
            self._dispatcher.cancel()
            self._dispatcher = None
        await asyncio.to_thread(self._sidecar.stop)

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        return {"name": f"Index signal {chat_id}", "type": "dm", "id": chat_id}

    async def send(
        self, chat_id: str, content: str,
        reply_to: str | None = None, metadata: dict[str, Any] | None = None,
    ) -> SendResult:
        """Refuse: the negotiator delivers through the owner's own platform.

        @returns Always a failure; nothing should route owner messages here.
        """
        del chat_id, content, reply_to, metadata
        return SendResult(success=False, error="Index delivery goes to the owner's bound conversation, not this platform.")

    def _read(self) -> None:
        """Own the blocking stream: run the negotiator, reconcile, follow frames."""
        while not self._closing:
            with self._sidecar.store.transaction() as db:
                binding = self._sidecar.store.binding(db)
            if binding:
                self._owner = binding["account"]
                try:
                    self._sidecar.start(binding["account"], binding["agentId"])
                    self._reconcile()
                    for line in get_transport().stream_sse("/events"):
                        if self._closing:
                            return
                        self._observe(line)
                except Exception as error:  # noqa: BLE001
                    logger.warning("Index event stream ended: %s", error)
            else:
                # The selection moved to another runtime or the hosted negotiator.
                self._sidecar.stop()
            time.sleep(RECONNECT_SECONDS)

    def _reconcile(self) -> None:
        """Recover the signals that moved while this reader was disconnected."""
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
        intent = (frame.get("data") or {}).get("intentId")
        if intent and frame.get("type") in WAKE_TYPES:
            self._queue(intent)

    def _queue(self, intent: str) -> None:
        """Hand one signal from the reader thread to the gateway loop."""
        self._loop.call_soon_threadsafe(self._collect, intent)

    def _collect(self, intent: str) -> None:
        self._pending.add(intent)
        self._signal.set()

    async def _dispatch(self) -> None:
        """One wake per queued signal, once sibling frames have had time to land."""
        while True:
            await self._signal.wait()
            self._signal.clear()
            await asyncio.sleep(SETTLE_SECONDS)
            while self._pending:
                intent = self._pending.pop()
                await asyncio.to_thread(self._sidecar.wake, intent)


def register_platform(ctx, sidecar) -> None:
    """Expose the event stream as the `index` gateway platform."""
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
        platform_hint=(
            "This platform only carries Index events to the negotiator process. "
            "It is not a conversation with the owner."
        ),
    )
