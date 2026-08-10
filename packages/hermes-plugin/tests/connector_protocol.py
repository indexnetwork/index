"""Provider-free contracts for the Hermes Index transport seam."""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from connector_transport import (  # noqa: E402
    ConnectorTransport,
    DOWNLOAD_URL,
    EXPECTED_BUNDLE_ID,
    EXPECTED_DESIGNATED_REQUIREMENT,
    EXPECTED_TEAM_ID,
    PINNED_CONNECTOR_RELEASE_CMS_SHA256,
    TransportError,
)
from transport import build_transport  # noqa: E402


class _PipeReader:
    def __init__(self, descriptor):
        self.descriptor = descriptor

    def fileno(self):
        return self.descriptor

    def readline(self, limit=-1):
        output = bytearray()
        while limit < 0 or len(output) < limit:
            chunk = os.read(self.descriptor, 1)
            if not chunk:
                break
            output.extend(chunk)
            if chunk == b"\n":
                break
        return output.decode("utf-8")

    def close(self):
        try:
            os.close(self.descriptor)
        except OSError:
            pass


class FakeProcess:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.stdin = self
        self._read_fd, self._write_fd = os.pipe()
        self.stdout = _PipeReader(self._read_fd)
        self.writes = []
        self.returncode = None

    def write(self, value):
        raw = value.decode("utf-8") if isinstance(value, bytes) else value
        request = json.loads(raw)
        self.writes.append(request)
        response = next(self.responses)
        if response == "<eof>":
            os.close(self._write_fd)
            self._write_fd = -1
        elif response is not None:
            if isinstance(response, dict):
                response = {
                    "protocolVersion": 1,
                    "id": request["id"],
                    "result": None,
                    "error": None,
                    **response,
                }
                response = json.dumps(response) + "\n"
            encoded = response.encode("utf-8") if isinstance(response, str) else response
            if len(encoded) > 65_536:
                threading.Thread(target=os.write, args=(self._write_fd, encoded), daemon=True).start()
            else:
                os.write(self._write_fd, encoded)
        return len(value)

    def flush(self):
        pass

    def poll(self):
        return self.returncode

    def terminate(self):
        self.returncode = -15

    def kill(self):
        self.returncode = -9

    def wait(self, timeout=None):
        del timeout
        if self.returncode is None:
            self.returncode = 0
        return self.returncode


class RawProcess(FakeProcess):
    pass


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
        with tempfile.TemporaryDirectory(dir=pathlib.Path.home()) as directory:
            root = pathlib.Path(directory)
            executable = root / "IndexConnector"
            executable.write_bytes(b"signed connector fixture")
            executable.chmod(0o700)
            digest = hashlib.sha256(executable.read_bytes()).hexdigest()
            metadata = {
                "schemaVersion": 1,
                "teamId": EXPECTED_TEAM_ID,
                "bundleId": EXPECTED_BUNDLE_ID,
                "designatedRequirement": EXPECTED_DESIGNATED_REQUIREMENT,
                "connectorProtocolVersion": 1,
                "sha256": digest,
                "downloadUrl": DOWNLOAD_URL,
            }
            cms = root / "connector-release.cms"
            cms.write_bytes(b"fixture cms der")
            cms_digest = hashlib.sha256(cms.read_bytes()).hexdigest()
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
                            f"Identifier={EXPECTED_BUNDLE_ID}\n"
                            f"TeamIdentifier={EXPECTED_TEAM_ID}\n"
                            f"designated => {EXPECTED_DESIGNATED_REQUIREMENT}\n"
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
                expected_cms_sha256=cms_digest,
            )
            status = transport.status()
            self.assertTrue(status["reconnectSoon"])
            self.assertFalse(status["reconnectRequired"])
            self.assertEqual([entry["operation"] for entry in process.writes], ["hello", "status"])
            self.assertNotIn("INDEX_API_KEY", json.dumps(process.writes))

    def test_release_metadata_cannot_replace_local_team_requirement_or_cms_pin(self):
        self.assertEqual(EXPECTED_TEAM_ID, "LMQ3XNXLAD")
        self.assertEqual(EXPECTED_BUNDLE_ID, "network.index.connector")
        self.assertEqual(
            EXPECTED_DESIGNATED_REQUIREMENT,
            'anchor apple generic and certificate leaf[subject.OU] = "LMQ3XNXLAD" and identifier "network.index.connector"',
        )
        production_cms = ROOT / "connector-release.cms"
        if PINNED_CONNECTOR_RELEASE_CMS_SHA256 is None:
            self.assertFalse(production_cms.exists(), "an unpinned CMS artifact must not ship")
        else:
            self.assertRegex(PINNED_CONNECTOR_RELEASE_CMS_SHA256, r"^[0-9a-f]{64}$")
            self.assertEqual(
                hashlib.sha256(production_cms.read_bytes()).hexdigest(),
                PINNED_CONNECTOR_RELEASE_CMS_SHA256,
            )
        self.assertNotIn("os.environ", "\n".join(
            line for line in (ROOT / "connector_transport.py").read_text().splitlines()
            if "PINNED_CONNECTOR_RELEASE_CMS_SHA256" in line
        ))
        with tempfile.TemporaryDirectory(dir=pathlib.Path.home()) as directory:
            root = pathlib.Path(directory)
            executable = root / "IndexConnector"
            executable.write_bytes(b"signed connector fixture")
            executable.chmod(0o700)
            cms = root / "connector-release.cms"
            cms.write_bytes(b"fixture cms der")
            cms_digest = hashlib.sha256(cms.read_bytes()).hexdigest()
            executable_digest = hashlib.sha256(executable.read_bytes()).hexdigest()

            def attempt(*, team=EXPECTED_TEAM_ID, requirement=EXPECTED_DESIGNATED_REQUIREMENT, pinned=cms_digest):
                metadata = {
                    "schemaVersion": 1, "teamId": team, "bundleId": EXPECTED_BUNDLE_ID,
                    "designatedRequirement": requirement, "connectorProtocolVersion": 1,
                    "sha256": executable_digest, "downloadUrl": DOWNLOAD_URL,
                }

                def run(command, **_kwargs):
                    if command[:4] == ["/usr/bin/security", "cms", "-D", "-i"]:
                        return mock.Mock(returncode=0, stdout=json.dumps(metadata), stderr="")
                    if command[:3] == ["/usr/bin/codesign", "--verify", "--strict"]:
                        return mock.Mock(returncode=0, stdout="", stderr="")
                    if command[:3] == ["/usr/bin/codesign", "-d", "-r-"]:
                        return mock.Mock(
                            returncode=0, stdout="",
                            stderr=(
                                f"Identifier={EXPECTED_BUNDLE_ID}\nTeamIdentifier={team}\n"
                                f"designated => {requirement}\n"
                            ),
                        )
                    raise AssertionError(command)

                transport = ConnectorTransport(
                    plugin_root=root, platform="darwin", candidate_paths=[executable],
                    command_runner=run, expected_cms_sha256=pinned,
                )
                with self.assertRaises(TransportError) as denied:
                    transport.status()
                self.assertEqual(denied.exception.code, "connector_unverified")
                self.assertEqual(denied.exception.download_url, DOWNLOAD_URL)

            attempt(team="EVILTEAM01")
            attempt(requirement='identifier "network.index.connector" and anchor apple generic')
            attempt(pinned="f" * 64)

    def test_descriptor_bound_launch_retains_verified_vnode_after_path_replacement(self):
        with tempfile.TemporaryDirectory(dir=pathlib.Path.home()) as directory:
            root = pathlib.Path(directory)
            executable = root / "IndexConnector"
            response_status = {
                "connected": False, "accountLabel": None, "installationId": "installation-1",
                "agentId": None, "setupAttemptId": None, "actions": [], "expiresAt": None,
                "health": "disconnected", "revocationPending": False,
            }
            verified_script = (
                "#!/usr/bin/python3\nimport json,sys\n"
                "for line in sys.stdin:\n"
                " r=json.loads(line); op=r['operation']\n"
                f" result={{'protocolVersion':1,'buildMode':'production','apiEnvironment':'production'}} if op=='hello' else {response_status!r}\n"
                " print(json.dumps({'protocolVersion':1,'id':r['id'],'success':True,'result':result,'error':None}),flush=True)\n"
            ).encode()
            executable.write_bytes(verified_script)
            executable.chmod(0o700)
            cms = root / "connector-release.cms"
            cms.write_bytes(b"fixture cms der")
            metadata = {
                "schemaVersion": 1, "teamId": EXPECTED_TEAM_ID, "bundleId": EXPECTED_BUNDLE_ID,
                "designatedRequirement": EXPECTED_DESIGNATED_REQUIREMENT, "connectorProtocolVersion": 1,
                "sha256": hashlib.sha256(verified_script).hexdigest(), "downloadUrl": DOWNLOAD_URL,
            }

            def run(command, **_kwargs):
                if command[:4] == ["/usr/bin/security", "cms", "-D", "-i"]:
                    return mock.Mock(returncode=0, stdout=json.dumps(metadata), stderr="")
                if command[:3] == ["/usr/bin/codesign", "--verify", "--strict"]:
                    return mock.Mock(returncode=0, stdout="", stderr="")
                if command[:3] == ["/usr/bin/codesign", "-d", "-r-"]:
                    return mock.Mock(
                        returncode=0, stdout="",
                        stderr=(f"Identifier={EXPECTED_BUNDLE_ID}\nTeamIdentifier={EXPECTED_TEAM_ID}\n"
                                f"designated => {EXPECTED_DESIGNATED_REQUIREMENT}\n"),
                    )
                raise AssertionError(command)

            def spawn(command, **kwargs):
                self.assertRegex(command[0], r"^/dev/fd/[0-9]+$")
                descriptor = int(command[0].rsplit("/", 1)[1])
                self.assertIn(descriptor, kwargs["pass_fds"])
                self.assertNotIn("shell", kwargs)
                replacement = root / "replacement"
                replacement.write_text("#!/bin/sh\nexit 91\n")
                replacement.chmod(0o700)
                os.replace(replacement, executable)
                return subprocess.Popen(command, **kwargs)

            transport = ConnectorTransport(
                plugin_root=root, platform="darwin", candidate_paths=[executable],
                command_runner=run, process_factory=spawn,
                expected_cms_sha256=hashlib.sha256(cms.read_bytes()).hexdigest(),
            )
            status = transport.status()
            self.assertEqual(status["health"], "disconnected")
            transport._stop_process()

    def test_bounded_response_timeout_partial_oversize_and_clean_restart(self):
        hello = {"success": True, "result": {"protocolVersion": 1, "buildMode": "production", "apiEnvironment": "production"}}
        status = {"success": True, "result": {
            "connected": False, "accountLabel": None, "installationId": "installation-1",
            "agentId": None, "setupAttemptId": None, "actions": [], "expiresAt": None,
            "health": "disconnected", "revocationPending": False,
        }}
        for bad_response in (None, "{\"partial\"", "<eof>", "x" * 1_048_577):
            first = FakeProcess([bad_response])
            second = FakeProcess([hello, status])
            processes = iter([second])
            transport = ConnectorTransport(
                platform="darwin", candidate_paths=[], process_factory=lambda *_a, **_k: next(processes),
                response_deadline_seconds=0.05,
            )
            transport._fixture_verified = True
            transport._process = first
            with self.assertRaises(TransportError) as failed:
                transport.status()
            self.assertEqual(failed.exception.code, "connector_invalid_response")
            self.assertIsNotNone(first.returncode)
            self.assertEqual(transport.status()["health"], "disconnected")

        mutation = FakeProcess([None])
        transport = ConnectorTransport(platform="darwin", candidate_paths=[], response_deadline_seconds=0.05)
        transport._fixture_verified = True
        transport._process = mutation
        with self.assertRaises(TransportError) as ambiguous:
            transport.request_rest("POST", "/agents/agent/negotiations/pickup")
        self.assertEqual(ambiguous.exception.code, "upstream_ambiguous_response")

        hung = FakeProcess([None])
        restarted = FakeProcess([
            hello,
            {"success": True, "result": {"status": "disconnected"}},
        ])
        transport = ConnectorTransport(
            platform="darwin", candidate_paths=[], process_factory=lambda *_a, **_k: restarted,
            response_deadline_seconds=0.05,
        )
        transport._fixture_verified = True
        transport._process = hung
        with self.assertRaises(TransportError):
            transport.status()
        self.assertEqual(transport.disconnect(), {"status": "disconnected"})
        self.assertEqual([entry["operation"] for entry in restarted.writes], ["hello", "disconnect"])

    def test_abandoned_upload_and_sse_state_is_not_replayed_into_restarted_process(self):
        hello = {"success": True, "result": {"protocolVersion": 1, "buildMode": "production", "apiEnvironment": "production"}}
        status = {"success": True, "result": {
            "connected": False, "accountLabel": None, "installationId": "installation-1",
            "agentId": None, "setupAttemptId": None, "actions": [], "expiresAt": None,
            "health": "disconnected", "revocationPending": False,
        }}
        for initial, invoke in (
            (FakeProcess([{"success": True, "result": {"uploadId": "upload-1"}}, None]),
             lambda transport: transport.upload("/storage", "file", "a.txt", b"content", "text/plain")),
            (FakeProcess([{"success": True, "result": {"streamId": "stream-1"}}, None]),
             lambda transport: list(transport.stream_sse("/events"))),
        ):
            clean = FakeProcess([hello, status])
            transport = ConnectorTransport(
                platform="darwin", candidate_paths=[], process_factory=lambda *_a, **_k: clean,
                response_deadline_seconds=0.05,
            )
            transport._fixture_verified = True
            transport._process = initial
            with self.assertRaises(TransportError):
                invoke(transport)
            self.assertEqual(transport.status()["health"], "disconnected")
            self.assertEqual([entry["operation"] for entry in clean.writes], ["hello", "status"])

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
