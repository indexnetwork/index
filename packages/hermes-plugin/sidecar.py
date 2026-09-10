"""Supervise the Bun process that runs the Index negotiator.

The negotiator is `@indexnetwork/agent`, the same package the hosted Index
runtime executes, bundled into `runtime/dist/negotiator.js`. This module starts
it while this machine is the owner's selected negotiator, relays wakes and owner
input to it over loopback, and stops it when the selection moves elsewhere. It
holds no negotiation state: scheduling, questions, turns, and checkpoints all
live inside the agent package.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import urllib.error
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

BUNDLE = Path(__file__).parent / "runtime" / "dist" / "negotiator.js"
READY_SECONDS = 30.0
CALL_SECONDS = 300.0


def _bun() -> str:
    """@returns The Bun executable. @throws When Bun is not installed."""
    found = shutil.which("bun") or str(Path.home() / ".bun" / "bin" / "bun")
    if not Path(found).exists():
        raise RuntimeError("Bun is required to run the Index negotiator. Install it from https://bun.sh.")
    return found


class Sidecar:
    """Own one negotiator process and the loopback calls into it."""

    def __init__(self, bridge, store, home: Path):
        self.bridge = bridge
        self.store = store
        self._state = home / "index-network" / "negotiator"
        self._lock = threading.Lock()
        self._process: subprocess.Popen | None = None
        self._executor = ""
        self._url = ""

    def start(self, account: str, executor_id: str) -> None:
        """Ensure a negotiator is running for this owner and selected agent.

        Idempotent for the same selection; a different agent replaces the
        process, because a negotiator's turns are fenced to one executor ID.

        @param account - The Index account this machine negotiates for.
        @param executor_id - The selected external agent's ID.
        """
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                if self._executor == executor_id:
                    return
                self._terminate()
            if not BUNDLE.exists():
                raise RuntimeError(f"The Index negotiator bundle is missing at {BUNDLE}.")
            self.bridge.start()
            self._state.mkdir(parents=True, exist_ok=True, mode=0o700)
            from .env_transport import api_origin

            process = subprocess.Popen(
                [_bun(), str(BUNDLE)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                env={**os.environ,
                     "INDEX_BRIDGE_URL": self.bridge.url,
                     "INDEX_BRIDGE_TOKEN": self.bridge.token,
                     "INDEX_API_ORIGIN": api_origin(),
                     "INDEX_EXECUTOR_ID": executor_id,
                     "INDEX_STATE_DIR": str(self._state)},
            )
            threading.Thread(target=self._relay, args=(process,), name="index-negotiator-log", daemon=True).start()
            try:
                port = self._ready(process)
            except Exception:
                process.kill()
                raise
            self._process, self._executor = process, executor_id
            self._url = f"http://127.0.0.1:{port}"
            logger.info("Index negotiator running for %s on %s", account, self._url)

    def stop(self) -> None:
        """Ask the negotiator to checkpoint and exit, then release the process."""
        with self._lock:
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

    def wake(self, intent_id: str) -> None:
        """Reconsider one signal's matches. A failure is logged, not raised: the
        next Index event wakes the same signal again.

        @param intent_id - The signal an Index event moved.
        """
        try:
            self.call("/wake", {"intentId": intent_id})
        except Exception as error:  # noqa: BLE001
            logger.warning("Index negotiator could not work signal %s: %s", intent_id, error)

    def call(self, path: str, payload: dict) -> dict:
        """@param path - A negotiator control route. @param payload - Its arguments.
        @returns The negotiator's reply. @throws When it is not running or refuses.
        """
        if not self.running:
            raise RuntimeError("The Index negotiator is not running on this machine.")
        return self._post(path, payload)

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
        self._executor, self._url = "", ""
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
