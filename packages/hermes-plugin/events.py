"""Start the negotiator while this machine is the selected executor."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Any

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, SendResult

from .speaker import PLATFORM
from .tools import selected_agent, this_install_selected

logger = logging.getLogger(__name__)

RECONNECT_SECONDS = 5.0


def check_requirements() -> bool:
    return True


def is_connected(config: PlatformConfig | None = None) -> bool:
    del config
    return bool(os.environ.get("INDEX_SESSION_TOKEN", "").strip())


class IndexAdapter(BasePlatformAdapter):
    """Follow the selected negotiator and start the sidecar while it is this machine."""

    def __init__(self, config: PlatformConfig, sidecar):
        super().__init__(config, Platform(PLATFORM))
        self._sidecar = sidecar
        self._closing = False

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        """Start watching the selection. The negotiator reads Index events itself."""
        del is_reconnect
        self._closing = False
        self._sidecar.bridge.adapter = self
        threading.Thread(target=self._watch, name="index-events", daemon=True).start()
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

    def _apply(self) -> None:
        """Run the negotiator only while this install's agent is the selected executor."""
        try:
            agent = selected_agent()
        except Exception:
            self._sidecar.stop()
            return
        if not this_install_selected(agent):
            self._sidecar.stop()
            return
        if self._sidecar.paused:
            return
        self._sidecar.start(agent["ownerId"], agent["id"])

    def _watch(self) -> None:
        """Re-read the selection until the platform disconnects."""
        while not self._closing:
            try:
                self._apply()
            except Exception as error:  # noqa: BLE001
                logger.warning("Index negotiator selection check failed: %s", error)
            time.sleep(RECONNECT_SECONDS)


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
        platform_hint="The negotiator runs while this Hermes agent is selected.",
    )
