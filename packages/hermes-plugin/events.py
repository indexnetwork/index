"""The owner's Index event stream, as a gateway platform.

Index publishes a frame whenever one of the owner's signals owes a turn, so
native work is woken by those frames instead of by a schedule. Each signal
becomes its own chat on this platform, which keeps background match work in a
session of its own, separate from the owner's private conversation.
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
from gateway.platforms.base import BasePlatformAdapter, MessageEvent, MessageType, SendResult

from .native_agent import PLATFORM
from .transport import get_transport


logger = logging.getLogger(__name__)

# `negotiation.*` names a signal that owes a turn; `intent.lifecycle` changes
# whether the signal should be worked at all. Every frame is a pointer: the run
# reads authoritative state over REST before deciding anything.
WAKE_TYPES = frozenset({
    "negotiation.opened", "negotiation.turn", "negotiation.settled", "intent.lifecycle",
})
# Matches on one signal move together, so let sibling frames land in one run.
SETTLE_SECONDS = 2.0
RECONNECT_SECONDS = 5.0
WAKE_PROMPT = (
    "Do one bounded Index personal-agent run for intent {intent}. Load "
    "index-network:personal-agent, call index_list_negotiations, process each "
    "returned match once, then review that intent's inbox. Never wait inside this "
    "run for a human. Only index_review_principal_inbox selects human delivery. "
    "Finish with [SILENT]; the plugin renders selected inbox entries."
)


def check_requirements() -> bool:
    """The reader needs no SDK, so the platform is always installable."""
    return True


def is_connected(config: PlatformConfig | None = None) -> bool:
    """Configured exactly when this device holds an Index session token."""
    del config
    return bool(os.environ.get("INDEX_SESSION_TOKEN", "").strip())


class IndexAdapter(BasePlatformAdapter):
    """Follow the owner's event stream and wake one native run per signal."""

    def __init__(self, config: PlatformConfig, native):
        super().__init__(config, Platform(PLATFORM))
        self._native = native
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
        self._native.wake = self._queue
        threading.Thread(target=self._read, name="index-events", daemon=True).start()
        return True

    async def disconnect(self) -> None:
        self._closing = True
        self._native.wake = None
        if self._dispatcher is not None:
            self._dispatcher.cancel()
            self._dispatcher = None

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        return {"name": f"Index signal {chat_id}", "type": "dm", "id": chat_id}

    async def send(
        self, chat_id: str, content: str,
        reply_to: str | None = None, metadata: dict[str, Any] | None = None,
    ) -> SendResult:
        """Deliver what the run selected to the owner's bound conversation.

        The signal's own chat exists to isolate the work, not to be read: the
        owner sees Index only in the private conversation they enabled.

        @param chat_id - The signal that was worked; not a delivery target.
        @param content - Rendered inbox entries.
        @returns Whether Hermes accepted the message for the owner's platform.
        """
        del chat_id, reply_to, metadata
        with self._native.store.transaction() as db:
            binding = self._native.store.binding(db)
        if not binding:
            return SendResult(success=False, error="No Index owner conversation is configured.")
        platform, chat, _user, thread = json.loads(binding["source"])
        target = ":".join([platform, chat, thread] if thread else [platform, chat])
        result = json.loads(await asyncio.to_thread(
            self._native.ctx.dispatch_tool, "send_message",
            {"target": target, "message": content},
        ))
        return SendResult(success=not result.get("error"), error=result.get("error"))

    def _read(self) -> None:
        """Own the blocking stream: reconcile, then follow frames until it ends."""
        while not self._closing:
            with self._native.store.transaction() as db:
                binding = self._native.store.binding(db)
            if binding:
                self._owner = binding["account"]
                try:
                    self._reconcile()
                    for line in get_transport().stream_sse("/events"):
                        if self._closing:
                            return
                        self._observe(line)
                except Exception as error:  # noqa: BLE001
                    logger.warning("Index event stream ended: %s", error)
            time.sleep(RECONNECT_SECONDS)

    def _reconcile(self) -> None:
        """Recover the signals that moved while this reader was disconnected.

        A frame is a wake-up hint, not a record. Reading the rows on every
        connection is what makes a missed frame cost nothing.
        """
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
        """One run per queued signal, once sibling frames have had time to land."""
        while True:
            await self._signal.wait()
            self._signal.clear()
            await asyncio.sleep(SETTLE_SECONDS)
            while self._pending:
                intent = self._pending.pop()
                await self.handle_message(MessageEvent(
                    text=WAKE_PROMPT.format(intent=intent),
                    message_type=MessageType.TEXT,
                    user_id=self._owner,
                    user_name="Index",
                    source=self.build_source(
                        chat_id=intent, chat_name=f"Index signal {intent}",
                        chat_type="dm", user_id=self._owner, user_name="Index",
                    ),
                    # The frames come from the owner's own authenticated stream,
                    # so the work needs no allow-list and must never be read as
                    # owner input or as a gateway command.
                    internal=True,
                    allow_gateway_control=False,
                ))


def register_platform(ctx, native) -> None:
    """Expose the event stream as the `index` gateway platform."""
    ctx.register_platform(
        name=PLATFORM,
        label="Index",
        adapter_factory=lambda config: IndexAdapter(config, native),
        check_fn=check_requirements,
        validate_config=is_connected,
        is_connected=is_connected,
        required_env=["INDEX_SESSION_TOKEN"],
        emoji="\U0001f9ed",
        pii_safe=True,
        platform_hint=(
            "This session is Index personal-agent background work for one signal. "
            "It is not a conversation with the owner."
        ),
    )
