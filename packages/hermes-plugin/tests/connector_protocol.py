"""Provider-free contracts for the Hermes Index transport seam."""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import stat
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from connector_transport import ConnectorTransport, DOWNLOAD_URL, TransportError  # noqa: E402
from transport import build_transport  # noqa: E402


class FakeProcess:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.stdin = self
        self.stdout = self
        self.writes = []
        self.returncode = None

    def write(self, value):
        self.writes.append(json.loads(value))
        return len(value)

    def flush(self):
        pass

    def readline(self, _limit=-1):
        response = next(self.responses)
        request = self.writes[-1]
        response = {"protocolVersion": 1, "id": request["id"], "result": None, "error": None, **response}
        return json.dumps(response) + "\n"

    def poll(self):
        return self.returncode

    def terminate(self):
        self.returncode = 0


class RawProcess(FakeProcess):
    def readline(self, _limit=-1):
        return next(self.responses)


class ConnectorProtocolTests(unittest.TestCase):
    def test_production_never_reads_environment_key(self):
        with mock.patch.dict(os.environ, {"INDEX_API_KEY": "must-not-be-read"}, clear=False):
            os.environ.pop("INDEX_PLUGIN_DEVELOPMENT_TRANSPORT", None)
            resolved = build_transport(platform="darwin", plugin_root=ROOT)
        self.assertEqual(resolved.__class__.__name__, "ConnectorTransport")

    def test_development_transport_requires_flag_and_unshipped_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            with mock.patch.dict(os.environ, {
                "INDEX_PLUGIN_DEVELOPMENT_TRANSPORT": "1",
                "INDEX_API_KEY": "dev-key",
            }, clear=False):
                with self.assertRaises(Exception) as rejected:
                    build_transport(platform="darwin", plugin_root=root)
                self.assertEqual(rejected.exception.code, "development_transport_denied")
                (root / ".index-plugin-development").write_text("source-checkout-only\n")
                resolved = build_transport(platform="darwin", plugin_root=root)
                self.assertEqual(resolved.__class__.__name__, "EnvironmentCredentialTransport")

    def test_missing_or_unverified_connector_returns_only_fixed_download_url(self):
        transport = ConnectorTransport(plugin_root=ROOT, platform="darwin", candidate_paths=[])
        with self.assertRaises(TransportError) as missing:
            transport.status()
        self.assertEqual(missing.exception.code, "connector_unverified")
        self.assertEqual(missing.exception.download_url, DOWNLOAD_URL)
        self.assertNotIn("install", missing.exception.as_payload())

    def test_verified_connector_handshake_and_status_expiry_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            executable = root / "IndexConnector"
            executable.write_bytes(b"signed connector fixture")
            executable.chmod(0o700)
            digest = hashlib.sha256(executable.read_bytes()).hexdigest()
            metadata = {
                "schemaVersion": 1,
                "teamId": "TEAM123",
                "bundleId": "network.index.connector",
                "designatedRequirement": 'identifier "network.index.connector" and anchor apple generic',
                "connectorProtocolVersion": 1,
                "sha256": digest,
                "downloadUrl": DOWNLOAD_URL,
            }
            cms = root / "connector-release.cms"
            cms.write_text("fixture")
            now = datetime(2026, 8, 9, tzinfo=timezone.utc)
            expires = now + timedelta(days=7)
            process = FakeProcess([
                {"success": True, "result": {"protocolVersion": 1, "buildMode": "production", "apiEnvironment": "production"}},
                {"success": True, "result": {
                    "connected": True,
                    "accountLabel": "owner@example.test",
                    "installationId": "installation-1",
                    "agentId": "agent-1",
                    "setupAttemptId": "setup-1",
                    "actions": [],
                    "expiresAt": expires.isoformat().replace("+00:00", "Z"),
                    "health": "active",
                    "revocationPending": False,
                }},
            ])

            def run(command, **_kwargs):
                if command[:4] == ["/usr/bin/security", "cms", "-D", "-i"]:
                    return mock.Mock(returncode=0, stdout=json.dumps(metadata), stderr="")
                if command[:3] == ["/usr/bin/codesign", "--verify", "--strict"]:
                    return mock.Mock(returncode=0, stdout="", stderr="")
                if command[:3] == ["/usr/bin/codesign", "-d", "-r-"]:
                    return mock.Mock(
                        returncode=0,
                        stdout="",
                        stderr=(
                            "Identifier=network.index.connector\n"
                            "TeamIdentifier=TEAM123\n"
                            'designated => identifier "network.index.connector" and anchor apple generic\n'
                        ),
                    )
                raise AssertionError(command)

            transport = ConnectorTransport(
                plugin_root=root,
                platform="darwin",
                candidate_paths=[executable],
                command_runner=run,
                process_factory=lambda *_args, **_kwargs: process,
                now=lambda: now,
            )
            status = transport.status()
            self.assertTrue(status["reconnectSoon"])
            self.assertFalse(status["reconnectRequired"])
            self.assertEqual([entry["operation"] for entry in process.writes], ["hello", "status"])
            self.assertNotIn("INDEX_API_KEY", json.dumps(process.writes))

    def test_production_surfaces_have_no_direct_key_or_http_credential_path(self):
        for relative in ("tools.py", "dashboard/plugin_api.py", "dashboard/auth_login.py"):
            source = (ROOT / relative).read_text(encoding="utf-8")
            self.assertNotIn('os.environ.get("INDEX_API_KEY"', source, relative)
            self.assertNotIn("urllib.request.Request", source, relative)
        package = json.loads((ROOT / "package.json").read_text())
        self.assertNotIn(".index-plugin-development", package["files"])
        self.assertIn("connector-release.cms", package["files"])
        self.assertIn(".index-plugin-development", (ROOT / ".npmignore").read_text())

    def test_hidden_negotiation_authority_uses_closed_structured_shape(self):
        process = FakeProcess([
            {"success": True, "result": {"protocolVersion": 1, "buildMode": "production", "apiEnvironment": "production"}},
            {"success": True, "result": {"status": 204, "body": None}},
        ])
        transport = ConnectorTransport.for_verified_fixture(process)
        transport.request_rest(
            "POST", "/agents/agent-1/negotiations/pickup",
            hermes_run={"runId": "opaque-run"},
        )
        self.assertEqual(process.writes[-1]["payload"], {
            "kind": "json",
            "method": "POST",
            "path": "/agents/agent-1/negotiations/pickup",
            "hermesRun": {"runId": "opaque-run"},
        })
        self.assertNotIn("headers", process.writes[-1]["payload"])

    def test_malformed_mutation_response_is_upstream_ambiguous_but_read_is_not(self):
        mutation_process = RawProcess([
            json.dumps({
                "protocolVersion": 1, "id": "placeholder", "success": True,
                "result": {}, "error": None,
            }) + "\n",
        ])
        mutation = ConnectorTransport(platform="darwin", candidate_paths=[])
        mutation._process = mutation_process
        mutation._fixture_verified = True
        with self.assertRaises(TransportError) as ambiguous:
            mutation.request_rest(
                "POST", "/agents/agent/negotiations/pickup",
                hermes_run={"runId": "opaque"},
            )
        self.assertEqual(ambiguous.exception.code, "upstream_ambiguous_response")

        read_process = RawProcess(["not-json\n"])
        read = ConnectorTransport(platform="darwin", candidate_paths=[])
        read._process = read_process
        read._fixture_verified = True
        with self.assertRaises(TransportError) as invalid:
            read.request_rest("GET", "/agents/me")
        self.assertEqual(invalid.exception.code, "connector_invalid_response")

    def test_expired_connector_denies_immediately_without_renewal(self):
        process = FakeProcess([
            {"success": True, "result": {"protocolVersion": 1, "buildMode": "production", "apiEnvironment": "production"}},
            {"success": False, "error": {"code": "reconnect_required", "message": "Reconnect to Index."}},
        ])
        transport = ConnectorTransport.for_verified_fixture(process)
        with self.assertRaises(TransportError) as denied:
            transport.call_mcp("read_intents", {})
        self.assertEqual(denied.exception.code, "reconnect_required")
        self.assertEqual([item["operation"] for item in process.writes], ["hello", "mcp"])
        self.assertNotIn("authorize.start", json.dumps(process.writes))

    def test_connector_response_is_correlated_and_mcp_is_forwarded_unchanged(self):
        process = FakeProcess([
            {"success": True, "result": {"protocolVersion": 1, "buildMode": "production", "apiEnvironment": "production"}},
            {"success": True, "result": {"content": [{"type": "text", "text": "ok"}]}},
        ])
        transport = ConnectorTransport.for_verified_fixture(process)
        result = transport.call_mcp("read_intents", {"limit": 1})
        self.assertEqual(result, {"content": [{"type": "text", "text": "ok"}]})
        self.assertEqual(process.writes[-1]["payload"], {"toolName": "read_intents", "arguments": {"limit": 1}})


if __name__ == "__main__":
    unittest.main()
