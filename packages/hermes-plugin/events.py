"""Start the negotiator while this machine is the selected executor."""

from __future__ import annotations

import logging
import sys
import threading
import time

from .tools import selected_agent, this_install_selected

logger = logging.getLogger(__name__)

RECONNECT_SECONDS = 5.0

_lock = threading.Lock()
_started = False
_current = None


def _runner():
    """The Hermes gateway in this process, or None in the dashboard, CLI, and doctor."""
    run = sys.modules.get("gateway.run")
    ref = getattr(run, "_gateway_runner_ref", None) if run is not None else None
    return ref() if ref is not None else None


def watch(sidecar) -> None:
    """Follow the selection while this process is the Hermes gateway.

    Plugin registration also runs in the dashboard and the CLI. Those processes
    have no gateway runner, so they must not start a second negotiator.
    """
    global _started, _current
    _current = sidecar
    if _runner() is None:
        return
    with _lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_watch, name="index-events", daemon=True).start()


def _apply(sidecar) -> None:
    """Run the negotiator only while this install's agent is the selected executor."""
    try:
        agent = selected_agent()
    except Exception:
        sidecar.stop()
        return
    if not this_install_selected(agent):
        sidecar.stop()
        return
    if sidecar.paused:
        sidecar.stop()
        return
    sidecar.start(agent["ownerId"], agent["id"])


def _watch() -> None:
    """Re-read the selection until this process is no longer the gateway."""
    global _started
    try:
        while _runner() is not None:
            sidecar = _current
            if sidecar is not None:
                try:
                    _apply(sidecar)
                except Exception as error:  # noqa: BLE001
                    logger.warning("Index negotiator selection check failed: %s", error)
            time.sleep(RECONNECT_SECONDS)
        if _current is not None:
            _current.stop()
    finally:
        with _lock:
            _started = False
