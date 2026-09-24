"""Supervise the Bun process that runs the Index negotiator.

The negotiator is `@indexnetwork/agent` on `@indexnetwork/client`, bundled
into `runtime/dist/negotiator.js`. This module starts it while this machine is
the owner's selected negotiator, keeps that child alive for the gateway
process, and stops it when the platform disconnects or the selection moves
elsewhere. It holds no negotiation state.
"""

from __future__ import annotations

import atexit
import json
import logging
import os
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

BUNDLE = Path(__file__).parent / "runtime" / "dist" / "negotiator.js"
READY_SECONDS = 30.0
CALL_SECONDS = 300.0
RESTART_SECONDS = 1.0


def _bun() -> str:
    """@returns The Bun executable. @throws When Bun is not installed."""
    found = shutil.which("bun") or str(Path.home() / ".bun" / "bin" / "bun")
    if not Path(found).exists():
        raise RuntimeError("Bun is required to run the Index negotiator. Install it from https://bun.sh.")
    return found


class Sidecar:
    """Own one negotiator process and the loopback calls into it."""

    def __init__(self, bridge, home: Path):
        self.bridge = bridge
        del home
        self._lock = threading.Lock()
        self._process: subprocess.Popen | None = None
        self._wanted: tuple[str, str] | None = None
        self._paused = False
        self._agent_id = ""
        self._url = ""
        atexit.register(self.stop)

    def start(self, account: str, agent_id: str) -> None:
        """Ensure a negotiator is running for this owner and selected agent.

        Idempotent for the same selection; a different agent replaces the
        process, because a negotiator's turns are fenced to one agent id.
        While wanted, an unexpected child exit restarts it.

        @param account - The Index account this machine negotiates for.
        @param agent_id - The selected external agent's ID.
        """
        with self._lock:
            self._paused = False
            self._wanted = (account, agent_id)
            if self._process is not None and self._process.poll() is None:
                if self._agent_id == agent_id:
                    return
                self._terminate()
            if not BUNDLE.exists():
                raise RuntimeError(f"The Index negotiator bundle is missing at {BUNDLE}.")
            api_key = os.environ.get("INDEX_API_KEY", "").strip()
            if not api_key:
                raise RuntimeError("INDEX_API_KEY is required to run the Index negotiator.")
            self.bridge.start()
            from .env_transport import api_origin

            # Same process group as the gateway: a group signal reaches Bun too.
            process = subprocess.Popen(
                [_bun(), str(BUNDLE)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                env={**os.environ,
                     "INDEX_BRIDGE_URL": self.bridge.url,
                     "INDEX_BRIDGE_TOKEN": self.bridge.token,
                     "INDEX_API_URL": api_origin(),
                     "INDEX_API_KEY": api_key,
                     "INDEX_AGENT_ID": agent_id,
                     "INDEX_SUPERVISOR_PID": str(os.getpid())},
            )
            threading.Thread(target=self._relay, args=(process,), name="index-negotiator-log", daemon=True).start()
            try:
                port = self._ready(process)
            except Exception:
                process.kill()
                raise
            self._process, self._agent_id = process, agent_id
            self._url = f"http://127.0.0.1:{port}"
            threading.Thread(
                target=self._reap, args=(process, account, agent_id),
                name="index-negotiator-watch", daemon=True,
            ).start()
            logger.info("Index negotiator running for %s on %s", account, self._url)

    def stop(self, *, paused: bool = False) -> None:
        """Ask the negotiator to exit, then release the process.

        @param paused - Keep it stopped while this agent stays selected. The
        header's Stop sets this; losing the selection does not.
        """
        with self._lock:
            self._paused = paused
            self._wanted = None
            if self._process is None:
                return
            if self._process.poll() is None:
                try:
                    self._post("/shutdown", {})
                    self._process.wait(timeout=15)
                except Exception:  # noqa: BLE001 - a stuck process is killed below
                    pass
            self._terminate()

    @property
    def running(self) -> bool:
        """@returns Whether a negotiator process is alive and reachable."""
        return self._process is not None and self._process.poll() is None

    @property
    def paused(self) -> bool:
        """@returns Whether Stop is holding the negotiator off while it stays selected."""
        return self._paused

    def _post(self, path: str, payload: dict) -> dict:
        request = urllib.request.Request(
            self._url + path, data=json.dumps(payload).encode(), method="POST",
            headers={"Authorization": f"Bearer {self.bridge.token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=CALL_SECONDS) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            detail = json.loads(exc.read() or b"{}").get("error") or f"status {exc.code}"
            raise RuntimeError(detail) from exc

    def _ready(self, process: subprocess.Popen) -> int:
        """Read the startup handshake naming the negotiator's control port."""
        handshake: dict = {}

        def read() -> None:
            handshake["line"] = process.stdout.readline()

        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        reader.join(READY_SECONDS)
        line = handshake.get("line")
        if not line:
            raise RuntimeError("The Index negotiator did not report a control port.")
        return int(json.loads(line)["port"])

    def _reap(self, process: subprocess.Popen, account: str, agent_id: str) -> None:
        """Restart the child if it exits while this selection is still wanted."""
        process.wait()
        with self._lock:
            if self._process is process:
                self._process, self._url = None, ""
            restart = self._wanted == (account, agent_id)
        if not restart:
            return
        time.sleep(RESTART_SECONDS)
        if self._wanted != (account, agent_id):
            return
        logger.warning("Index negotiator exited; restarting for %s", account)
        try:
            self.start(account, agent_id)
        except Exception as error:  # noqa: BLE001
            logger.warning("Index negotiator did not restart: %s", error)

    def _relay(self, process: subprocess.Popen) -> None:
        """Fold the negotiator's structured log lines into this plugin's log."""
        for line in process.stderr:
            try:
                frame = json.loads(line)
            except ValueError:
                logger.info("negotiator: %s", line.rstrip())
                continue
            logger.log(
                logging.WARNING if frame.get("level") == "warn" else logging.INFO,
                "negotiator %s %s", frame.pop("event", "log"),
                {key: value for key, value in frame.items() if key != "level"},
            )

    def _terminate(self) -> None:
        process, self._process = self._process, None
        self._agent_id, self._url = "", ""
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
