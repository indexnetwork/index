"""Start the negotiator while this machine is the selected executor.

Selection changes arrive on the Index event stream (`agent.configuration`).
Start and Stop arrive as writes to the shared pause file. Neither waits on a timer.
"""

from __future__ import annotations

import json
import logging
import os
import select
import sys
import threading
import time
from pathlib import Path

from .sidecar import read_state
from .tools import selected_agent, this_install_selected

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_apply_lock = threading.Lock()
_started = False
_waiting = False
_current = None


def _runner():
    """The Hermes gateway in this process, or None in the dashboard, CLI, and doctor."""
    run = sys.modules.get("gateway.run")
    ref = getattr(run, "_gateway_runner_ref", None) if run is not None else None
    return ref() if ref is not None else None


def watch(sidecar) -> None:
    """Follow the selection while this process is the Hermes gateway.

    Plugin registration also runs in the dashboard and the CLI, and the gateway
    itself discovers plugins before its runner exists. Those calls must not start
    a negotiator. The gateway call waits until the runner is up, then starts.
    """
    global _current, _waiting
    _current = sidecar
    if _runner() is not None:
        _start_watch()
        return
    with _lock:
        if _waiting:
            return
        _waiting = True
    threading.Thread(target=_wait_for_runner, name="index-events-wait", daemon=True).start()


def _wait_for_runner() -> None:
    """Plugin discovery often runs before GatewayRunner sets its ref."""
    global _waiting
    try:
        for _ in range(120):
            if _runner() is not None:
                _start_watch()
                return
            time.sleep(0.5)
    finally:
        with _lock:
            _waiting = False


def _start_watch() -> None:
    global _started
    with _lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_watch, name="index-events", daemon=True).start()


def _apply(sidecar) -> None:
    """Run the negotiator only while this install's agent is the selected executor.

    A failed read leaves the process alone. Stopping it here is what left the
    header on pending: the stream had already dropped, so nothing started it again.
    """
    try:
        agent = selected_agent()
    except Exception as error:
        logger.warning("Index negotiator selection check failed: %s", error)
        return
    if not this_install_selected(agent):
        sidecar.stop()
        return
    if sidecar.paused:
        sidecar.stop()
        return
    sidecar.start(agent["ownerId"], agent["id"])


def _apply_current() -> None:
    sidecar = _current
    if sidecar is None:
        return
    with _apply_lock:
        sidecar = _current
        if sidecar is None:
            return
        try:
            _apply(sidecar)
        except Exception as error:  # noqa: BLE001
            logger.warning("Index negotiator selection check failed: %s", error)


def _watch() -> None:
    """Apply the current selection, then wait for the stream or the pause file."""
    global _started
    done = threading.Event()
    try:
        threading.Thread(target=_pause_loop, args=(done,), name="index-pause", daemon=True).start()
        _apply_current()
        delay = 1.0
        while _runner() is not None and not done.is_set():
            try:
                heard = _follow_events(done)
            except Exception as error:  # noqa: BLE001
                logger.warning("Index event stream failed: %s", error)
                heard = False
                if _recover(error):
                    delay = 1.0
                    _apply_current()
                    continue
            if _runner() is None or done.is_set():
                break
            if heard:
                delay = 1.0
            if done.wait(delay):
                break
            delay = min(delay * 2, 30.0)
        # The gateway process exiting is the only reason to stop from here.
        # A dropped stream or a plugin reload must not kill the negotiator.
        if _runner() is None and _current is not None:
            _current.stop()
    finally:
        done.set()
        with _lock:
            _started = False


def _unauthorized(error: BaseException) -> bool:
    if getattr(error, "code", None) == 401:
        return True
    text = str(error)
    return "status 401" in text or "HTTP Error 401" in text


def _recover(error: BaseException) -> bool:
    """Rebuild the client from the env file, and on 401 follow the accepting host."""
    from .env_transport import refresh_transport

    try:
        return refresh_transport(unauthorized=_unauthorized(error))
    except Exception:  # noqa: BLE001 - a failed recovery leaves the existing retry backoff.
        logger.warning("Index session recovery failed")
        return False


def _follow_events(done: threading.Event) -> bool:
    """Block on `GET /events`. @returns Whether a frame arrived before the stream ended."""
    from .transport import get_transport

    heard = False
    data: list[str] = []
    for raw in get_transport().stream_sse("/events"):
        if done.is_set() or _runner() is None:
            return heard
        line = raw.decode("utf-8", "replace").rstrip("\r\n")
        if line != "":
            if line.startswith("data:"):
                data.append(line[5:].lstrip())
            continue
        payload = "\n".join(data)
        data = []
        if not payload:
            continue
        heard = True
        try:
            frame = json.loads(payload)
        except ValueError:
            continue
        if isinstance(frame, dict) and frame.get("type") in ("connected", "agent.configuration"):
            _apply_current()
    return heard


def _pid_alive(pid: object) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _pause_loop(done: threading.Event) -> None:
    """Apply Start/Stop when the dashboard writes the pause file.

    Also start again when a recorded pid dies. start()'s own writes are ignored
    while that pid is still empty, so this does not restart a launch in progress.
    """
    sidecar = _current
    if sidecar is None:
        return
    path = Path(sidecar.state_path)
    seen = read_state(path)["paused"]
    alive = _pid_alive(read_state(path)["pid"])
    while not done.is_set() and _runner() is not None:
        if not _wait_state(path, done):
            continue
        state = read_state(path)
        paused = state["paused"]
        now_alive = _pid_alive(state["pid"])
        died = alive and not now_alive and not paused
        alive = now_alive
        if paused == seen and not died:
            continue
        seen = paused
        _apply_current()


def _wait_state(path: Path, done: threading.Event) -> bool:
    """@returns True when `path` may have changed. False when the wait was interrupted."""
    if hasattr(select, "kqueue"):
        return _wait_kqueue(path, done)
    if sys.platform == "linux":
        return _wait_inotify(path, done)
    deadline = done.wait(0.25)
    return not deadline and path.exists()


def _wait_kqueue(path: Path, done: threading.Event) -> bool:
    kq = select.kqueue()
    try:
        while not done.is_set() and _runner() is not None:
            if not path.exists():
                if done.wait(0.25):
                    return False
                continue
            fd = os.open(path, os.O_RDONLY)
            try:
                notes = (
                    select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND | select.KQ_NOTE_ATTRIB
                    | select.KQ_NOTE_RENAME | select.KQ_NOTE_DELETE
                )
                event = select.kevent(
                    fd, filter=select.KQ_FILTER_VNODE,
                    flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR | select.KQ_EV_ONESHOT,
                    fflags=notes,
                )
                got = kq.control([event], 1, 1)
            finally:
                os.close(fd)
            if got:
                return True
        return False
    finally:
        kq.close()


def _wait_inotify(path: Path, done: threading.Event) -> bool:
    import ctypes
    import struct

    libc = ctypes.CDLL(None, use_errno=True)
    fd = libc.inotify_init1(0x80000)  # IN_CLOEXEC
    if fd < 0:
        return not done.wait(0.25)
    try:
        mask = 0x00000002 | 0x00000004 | 0x00000008 | 0x00000080 | 0x00000100 | 0x00000200
        watch = libc.inotify_add_watch(fd, os.fsencode(path.parent), mask)
        if watch < 0:
            return not done.wait(0.25)
        header = struct.Struct("iIII")
        while not done.is_set() and _runner() is not None:
            ready, _, _ = select.select([fd], [], [], 1)
            if not ready:
                continue
            blob = os.read(fd, 4096)
            offset = 0
            while offset + header.size <= len(blob):
                _, _, _, name_len = header.unpack_from(blob, offset)
                offset += header.size
                name = blob[offset:offset + name_len].split(b"\x00", 1)[0]
                offset += name_len
                if name == path.name.encode():
                    return True
        return False
    finally:
        os.close(fd)
