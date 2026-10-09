"""Supervise the Bun process that runs the Index negotiator.

The negotiator is `@indexnetwork/agent` on `@indexnetwork/client`, bundled
into `runtime/dist/negotiator.js`. This module starts it while this machine is
the owner's selected negotiator, keeps that child alive for the Hermes server
process (the gateway or Desktop's backend), and stops it when that process
exits or the selection moves elsewhere. It holds no negotiation state.
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
STATE_FILE = "index-negotiator.json"
LOCK_FILE = "index-negotiator.lock"


def read_state(path: Path) -> dict:
    """@param path - The state file. @returns `{pid, paused, url, token, morning}` as last written."""
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    return {
        "pid": state.get("pid"),
        "paused": state.get("paused") is True,
        "url": state.get("url") or "",
        "token": state.get("token") or "",
        "morning": state.get("morning") or 0,
    }


def write_state(path: Path, **changes) -> None:
    """Merge `changes` into the state file shared by the gateway and the dashboard.

    @param path - The state file.
    """
    state = read_state(path)
    state.update(changes)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(state))
    os.chmod(temp, 0o600)
    temp.replace(path)


_CHILD_ENV_KEEP = {"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ"}


def negotiator_child_env() -> dict[str, str]:
    """Env for the Bun negotiator: a short allowlist, never the gateway's secrets."""
    keep = set(_CHILD_ENV_KEEP)
    extra = os.environ.get("INDEX_NEGOTIATOR_ENV_PASSTHROUGH", "")
    keep |= {name.strip() for name in extra.split(",") if name.strip()}
    keep.discard("INDEX_SESSION_TOKEN")
    child = {key: value for key, value in os.environ.items() if key in keep}
    child["BUN_OPTIONS"] = "--no-env-file"
    return child


def _bun() -> str:
    """@returns The Bun executable. @throws When Bun is not installed."""
    override = os.environ.get("INDEX_BUN", "").strip()
    found = override or shutil.which("bun") or str(Path.home() / ".bun" / "bin" / "bun")
    if not Path(found).exists():
        raise RuntimeError("Bun is required to run the Index negotiator. Install it from https://bun.sh.")
    return found


class Sidecar:
    """Own one negotiator process and the loopback calls into it.

    Its pid and the header's pause live in a state file, because the dashboard
    runs in a different process from the gateway that owns this child.
    """

    def __init__(self, bridge, home: Path):
        self.bridge = bridge
        self.state_path = Path(home) / STATE_FILE
        self._lock = threading.Lock()
        self._process: subprocess.Popen | None = None
        self._wanted: tuple[str, str] | None = None
        self._agent_id = ""
        self._url = ""
        self._slot: int | None = None
        atexit.register(self.stop)

    def _claim(self) -> bool:
        """Hold the one negotiator slot for this Hermes home.

        The gateway and Desktop's backend may run at once; the lock keeps the
        negotiator to one of them, and the OS frees it when that process exits.
        """
        if self._slot is not None:
            return True
        try:
            import fcntl
        except ImportError:
            return True
        fd = os.open(self.state_path.with_name(LOCK_FILE), os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(fd)
            return False
        self._slot = fd
        return True

    def _release(self) -> None:
        fd, self._slot = self._slot, None
        if fd is not None:
            os.close(fd)

    def start(self, account: str, agent_id: str) -> None:
        """Ensure a negotiator is running for this owner and selected agent.

        Idempotent for the same selection; a different agent replaces the
        process, because a negotiator's turns are fenced to one agent id.
        While wanted, an unexpected child exit restarts it.

        @param account - The Index account this machine negotiates for.
        @param agent_id - The selected external agent's ID.
        """
        with self._lock:
            if not self._claim():
                return
            write_state(self.state_path, paused=False)
            self._wanted = (account, agent_id)
            if self._process is not None and self._process.poll() is None:
                if self._agent_id == agent_id:
                    return
                self._terminate()
            if not BUNDLE.exists():
                raise RuntimeError(f"The Index negotiator bundle is missing at {BUNDLE}.")
            from .env_transport import api_origin, ensure_negotiator_api_key

            api_key = ensure_negotiator_api_key()
            from .mcp import sync_index_mcp

            sync_index_mcp()
            self.bridge.start()

            # Same process group as the gateway: a group signal reaches Bun too.
            # The child authenticates with the API key. It does not read the
            # device session, so that token stays in the gateway process.
            child_env = negotiator_child_env()
            child_env.update({
                "INDEX_BRIDGE_URL": self.bridge.url,
                "INDEX_BRIDGE_TOKEN": self.bridge.token,
                "INDEX_API_URL": api_origin(),
                "INDEX_API_KEY": api_key,
                "INDEX_AGENT_ID": agent_id,
                "INDEX_SUPERVISOR_PID": str(os.getpid()),
                "INDEX_NEGOTIATOR_MODULE": str(self.state_path.parent / "index" / "negotiator.ts"),
            })
            process = subprocess.Popen(
                [_bun(), str(BUNDLE)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                env=child_env,
            )
            threading.Thread(target=self._relay, args=(process,), name="index-negotiator-log", daemon=True).start()
            try:
                port = self._ready(process)
            except Exception:
                process.kill()
                raise
            self._process, self._agent_id = process, agent_id
            self._url = f"http://127.0.0.1:{port}"
            write_state(self.state_path, pid=process.pid, url=self._url, token=self.bridge.token)
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
            if paused:
                write_state(self.state_path, paused=True)
            self._wanted = None
            if self._process is not None and self._process.poll() is None:
                try:
                    self._post("/shutdown", {})
                    self._process.wait(timeout=15)
                except Exception:  # noqa: BLE001 - a stuck process is killed below
                    pass
            self._terminate()
            self._release()

    @property
    def running(self) -> bool:
        """@returns Whether a negotiator process is alive and reachable."""
        return self._process is not None and self._process.poll() is None

    @property
    def paused(self) -> bool:
        """@returns Whether Stop is holding the negotiator off while it stays selected."""
        return read_state(self.state_path)["paused"]

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
                write_state(self.state_path, pid=None, url="", token="")
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
        if process is not None:
            write_state(self.state_path, pid=None, url="", token="")
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
