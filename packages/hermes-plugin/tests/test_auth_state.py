"""The gateway tells the dashboard when Index rejects its session."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

_ROOT = Path(__file__).resolve().parent.parent
_PACKAGE = "index_network_auth_state_under_test"


def _load_events():
    """Load events.py as part of a package, with the Hermes-bound modules stubbed."""
    package = types.ModuleType(_PACKAGE)
    package.__path__ = [str(_ROOT)]
    sys.modules[_PACKAGE] = package
    stubs = {
        "morning": {"sync_morning_cron": lambda *args, **kwargs: None},
        "tools": {"selected_agent": lambda: {}, "this_install_selected": lambda agent: True},
    }
    for name, attrs in stubs.items():
        module = types.ModuleType(f"{_PACKAGE}.{name}")
        module.__dict__.update(attrs)
        sys.modules[module.__name__] = module
    for name in ("sidecar", "events"):
        spec = importlib.util.spec_from_file_location(f"{_PACKAGE}.{name}", _ROOT / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return sys.modules[f"{_PACKAGE}.events"], sys.modules[f"{_PACKAGE}.sidecar"]


class FakeSidecar:
    def __init__(self, state_path: Path) -> None:
        self.state_path = state_path
        self.paused = False
        self.started = 0

    def start(self, *_args) -> None:
        self.started += 1

    def stop(self) -> None:
        pass


class AuthStateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.events, self.sidecar_module = _load_events()
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = Path(self.dir.name) / "index-negotiator.json"
        self.sidecar = FakeSidecar(self.path)

    def auth(self) -> str:
        return self.sidecar_module.read_state(self.path)["auth"]

    def test_401_marks_signed_out_when_recovery_finds_nothing_new(self) -> None:
        error = RuntimeError("Index API HTTP request failed with status 401.")
        with mock.patch.object(self.events, "selected_agent", side_effect=error), \
                mock.patch.object(self.events, "_recover", return_value=False):
            self.events._apply(self.sidecar)
        self.assertEqual(self.auth(), "unauthorized")
        self.assertEqual(self.sidecar.started, 0)

    def test_recovery_after_login_clears_the_flag_and_starts_the_negotiator(self) -> None:
        self.sidecar_module.write_state(self.path, auth="unauthorized")
        error = RuntimeError("Index API HTTP request failed with status 401.")
        agent = {"ownerId": "owner", "id": "agent"}
        with mock.patch.object(self.events, "selected_agent", side_effect=[error, agent]), \
                mock.patch.object(self.events, "_recover", return_value=True):
            self.events._apply(self.sidecar)
        self.assertEqual(self.auth(), "ok")
        self.assertEqual(self.sidecar.started, 1)

    def test_an_outage_leaves_the_last_answer_alone(self) -> None:
        self.sidecar_module.write_state(self.path, auth="ok")
        with mock.patch.object(self.events, "selected_agent", side_effect=RuntimeError("timed out")):
            self.events._apply(self.sidecar)
        self.assertEqual(self.auth(), "ok")

    def test_recheck_counter_round_trips(self) -> None:
        self.sidecar_module.write_state(self.path, recheck=3)
        self.assertEqual(self.sidecar_module.read_state(self.path)["recheck"], 3)


if __name__ == "__main__":
    unittest.main()
