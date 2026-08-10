"""Provider-free secure relogin migration ordering contracts."""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
_spec = importlib.util.spec_from_file_location("index_network_secure_migration", ROOT / "migration.py")
if _spec is None or _spec.loader is None:
    raise AssertionError("Could not load migration module")
_migration = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _migration
_spec.loader.exec_module(_migration)
LEGACY_OWNED_ENV_KEYS = _migration.LEGACY_OWNED_ENV_KEYS
MigrationError = _migration.MigrationError
migrate_before_authorization = _migration.migrate_before_authorization


class FakeTransport:
    def __init__(self, events):
        self.events = events

    def start_authorization(self):
        self.events.append("authorize.start")
        return {"status": "pending"}


class MigrationTests(unittest.TestCase):
    def test_cleanup_and_verification_finish_before_authorize_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            env_path = root / ".env"
            jobs_path = root / "jobs.json"
            state_path = root / "migration.json"
            env_path.write_text(
                "KEEP=yes\n"
                "INDEX_API_KEY=old-secret\n"
                "INDEX_API_URL=https://old.invalid/api\n"
                "INDEX_MCP_URL=https://old.invalid/mcp\n"
                "INDEX_AGENT_ID=agent-old\n"
                "INDEX_INSTALLATION_ID=installation-old\n"
                "INDEX_PLUGIN_MODE=negotiator\n"
                "INDEX_API_KEY_ID=key-old\n"
            )
            jobs_path.write_text(json.dumps({"jobs": [{
                "id": "cron-1",
                "name": "Index Personal Agent Negotiator",
                "schedule_display": "every 1m",
                "prompt": "Run one scheduled autonomous Index negotiation pass.",
                "enabled_toolsets": ["index-network"],
                "skills": ["index-network:index-negotiator"],
                "index_app_installation_id": "installation-old",
                "state": "active",
                "enabled": True,
            }]}))
            events = []

            def observed(stage):
                events.append(stage)
                if stage == "env.verified":
                    text = env_path.read_text()
                    self.assertTrue(all(key + "=" not in text for key in LEGACY_OWNED_ENV_KEYS))
                    self.assertFalse(json.loads(jobs_path.read_text())["jobs"][0]["enabled"])

            with mock.patch.dict(os.environ, {
                "INDEX_API_KEY": "old-secret",
                "INDEX_INSTALLATION_ID": "installation-old",
                "INDEX_API_KEY_ID": "key-old",
            }, clear=False):
                result = migrate_before_authorization(
                    FakeTransport(events),
                    env_path=env_path,
                    jobs_path=jobs_path,
                    state_path=state_path,
                    observer=observed,
                )
                self.assertNotIn("INDEX_API_KEY", os.environ)
            self.assertEqual(result, {"status": "pending"})
            self.assertLess(events.index("schedule.verified"), events.index("env.verified"))
            self.assertLess(events.index("env.verified"), events.index("authorize.start"))
            self.assertEqual(json.loads(state_path.read_text()), {
                "installationId": "installation-old",
                "legacyKeyId": "key-old",
            })
            self.assertNotIn("old-secret", state_path.read_text())

    def test_cleanup_failure_leaves_owned_schedule_paused_and_never_authorizes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            env_path = root / ".env"
            jobs_path = root / "jobs.json"
            env_path.write_text("INDEX_API_KEY=old-secret\n")
            jobs_path.write_text(json.dumps({"jobs": [{
                "id": "cron-1",
                "name": "Index Personal Agent Negotiator",
                "schedule_display": "every 1m",
                "prompt": "Run one scheduled autonomous Index negotiation pass.",
                "enabled_toolsets": ["index-network"],
                "skills": ["index-network:index-negotiator"],
                "state": "active",
                "enabled": True,
            }]}))
            events = []
            with self.assertRaises(MigrationError):
                migrate_before_authorization(
                    FakeTransport(events),
                    env_path=env_path,
                    jobs_path=jobs_path,
                    state_path=root / "migration.json",
                    replace_env=lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("injected cleanup failure")),
                    observer=events.append,
                )
            self.assertNotIn("authorize.start", events)
            paused = json.loads(jobs_path.read_text())["jobs"][0]
            self.assertFalse(paused["enabled"])
            self.assertEqual(paused["state"], "paused")

    def test_installation_marker_pauses_tampered_owned_schedule(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            env_path = root / ".env"
            env_path.write_text("INDEX_INSTALLATION_ID=installation-old\n")
            jobs_path = root / "jobs.json"
            jobs_path.write_text(json.dumps({"jobs": [{
                "id": "cron-1", "name": "tampered", "prompt": "tampered",
                "index_app_installation_id": "installation-old",
                "enabled": True, "state": "active",
            }]}))
            migrate_before_authorization(
                FakeTransport([]), env_path=env_path, jobs_path=jobs_path,
                state_path=root / "migration.json",
            )
            job = json.loads(jobs_path.read_text())["jobs"][0]
            self.assertFalse(job["enabled"])
            self.assertEqual(job["state"], "paused")

    def test_any_partial_immutable_marker_is_attributable_even_when_tampered(self):
        for marker in (
            "index_app_installation_id", "index_app_owner_id", "index_app_setup_attempt_id"
        ):
            with self.subTest(marker=marker), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                env_path = root / ".env"
                env_path.write_text("KEEP=yes\n")
                jobs_path = root / "jobs.json"
                jobs_path.write_text(json.dumps({"jobs": [{
                    "id": "cron-1", marker: "opaque", "name": "tampered",
                    "schedule": {"kind": "every", "expr": "tampered"},
                    "enabled": True, "state": "active",
                }]}))
                migrate_before_authorization(
                    FakeTransport([]), env_path=env_path, jobs_path=jobs_path,
                    state_path=root / "migration.json",
                )
                job = json.loads(jobs_path.read_text())["jobs"][0]
                self.assertFalse(job["enabled"])
                self.assertEqual(job["state"], "paused")

    def test_object_schedule_is_supported_and_unmarked_adoption_is_exact_unique(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            env_path = root / ".env"
            env_path.write_text("KEEP=yes\n")
            jobs_path = root / "jobs.json"
            exact = {
                "name": "Index Personal Agent Negotiator",
                "schedule": {"kind": "every", "expr": " every 1m "},
                "prompt": "Run one scheduled autonomous Index negotiation pass.",
                "enabled_toolsets": ["index-network"],
                "skills": ["index-network:index-negotiator"],
                "enabled": True, "state": "active",
            }
            jobs_path.write_text(json.dumps({"jobs": [{"id": "cron-1", **exact}]}))
            migrate_before_authorization(
                FakeTransport([]), env_path=env_path, jobs_path=jobs_path,
                state_path=root / "migration.json",
            )
            self.assertFalse(json.loads(jobs_path.read_text())["jobs"][0]["enabled"])

            jobs_path.write_text(json.dumps({"jobs": [
                {"id": "cron-1", **exact}, {"id": "cron-2", **exact},
            ]}))
            events = []
            with self.assertRaises(MigrationError):
                migrate_before_authorization(
                    FakeTransport(events), env_path=env_path, jobs_path=jobs_path,
                    state_path=root / "migration.json",
                )
            self.assertNotIn("authorize.start", events)

    def test_concurrent_writer_snapshot_mismatch_refuses_authorization(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            env_path = root / ".env"
            env_path.write_text("KEEP=yes\n")
            jobs_path = root / "jobs.json"
            jobs_path.write_text(json.dumps({"jobs": [{
                "id": "cron-1", "index_app_owner_id": "owner-1",
                "enabled": True, "state": "active",
            }]}))
            events = []

            def racing_replace(path, content):
                _migration._atomic_replace(path, content)
                document = json.loads(path.read_text())
                document["jobs"].append({
                    "id": "cron-race", "index_app_setup_attempt_id": "attempt-race",
                    "enabled": True, "state": "active",
                })
                path.write_text(json.dumps(document))

            with self.assertRaises(MigrationError):
                migrate_before_authorization(
                    FakeTransport(events), env_path=env_path, jobs_path=jobs_path,
                    state_path=root / "migration.json", replace_jobs=racing_replace,
                )
            self.assertNotIn("authorize.start", events)

    def test_canonical_jobs_lock_wraps_pause_and_verification(self):
        if _migration.fcntl is None:
            self.skipTest("fcntl unavailable")
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            env_path = root / ".env"
            env_path.write_text("KEEP=yes\n")
            jobs_path = root / "cron" / "jobs.json"
            jobs_path.parent.mkdir()
            jobs_path.write_text(json.dumps({"jobs": [{
                "id": "cron-1", "index_app_owner_id": "owner-1",
                "enabled": True, "state": "active",
            }]}))
            locked_paths = []
            original_flock = _migration.fcntl.flock

            def observed_flock(descriptor, operation):
                try:
                    path = os.readlink(f"/proc/self/fd/{descriptor}")
                except OSError:
                    path = os.readlink(f"/dev/fd/{descriptor}")
                locked_paths.append((pathlib.Path(path).name, operation))
                return original_flock(descriptor, operation)

            with mock.patch.object(_migration.fcntl, "flock", side_effect=observed_flock):
                migrate_before_authorization(
                    FakeTransport([]), env_path=env_path, jobs_path=jobs_path,
                    state_path=root / "migration.json",
                )
            self.assertTrue(any(name == ".jobs.lock" for name, _operation in locked_paths))

    def test_symlink_env_is_rejected_after_schedule_pause(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "target"
            target.write_text("INDEX_API_KEY=secret\n")
            env_path = root / ".env"
            env_path.symlink_to(target)
            jobs_path = root / "jobs.json"
            jobs_path.write_text(json.dumps({"jobs": [{
                "id": "cron-1", "name": "Index Personal Agent Negotiator",
                "schedule_display": "every 1m",
                "prompt": "Run one scheduled autonomous Index negotiation pass.",
                "enabled_toolsets": ["index-network"],
                "skills": ["index-network:index-negotiator"],
                "enabled": True,
            }]}))
            with self.assertRaises(MigrationError):
                migrate_before_authorization(
                    FakeTransport([]), env_path=env_path, jobs_path=jobs_path,
                    state_path=root / "migration.json",
                )
            self.assertFalse(json.loads(jobs_path.read_text())["jobs"][0]["enabled"])
            self.assertIn("secret", target.read_text())


if __name__ == "__main__":
    unittest.main()
