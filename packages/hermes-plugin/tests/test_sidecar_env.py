"""The negotiator child receives an allowlist, not the gateway environment."""

from __future__ import annotations

import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from sidecar import _bun, negotiator_child_env


class NegotiatorChildEnvTest(unittest.TestCase):
    def test_parent_secret_is_absent(self) -> None:
        with mock.patch.dict(os.environ, {
            "INDEX_SESSION_TOKEN": "device-secret",
            "OPENAI_API_KEY": "sk-secret",
            "PATH": "/usr/bin",
            "HOME": "/tmp/home",
            "BUN_OPTIONS": "--env-file=.env",
            "INDEX_NEGOTIATOR_ENV_PASSTHROUGH": "SSL_CERT_FILE,INDEX_SESSION_TOKEN",
            "SSL_CERT_FILE": "/tmp/ca.pem",
        }, clear=True):
            env = negotiator_child_env()
        self.assertNotIn("INDEX_SESSION_TOKEN", env)
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertEqual(env["PATH"], "/usr/bin")
        self.assertEqual(env["HOME"], "/tmp/home")
        self.assertEqual(env["SSL_CERT_FILE"], "/tmp/ca.pem")
        self.assertEqual(env["BUN_OPTIONS"], "--no-env-file")

    def test_index_bun_overrides_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            override = root / "override-bun"
            decoy_dir = root / "decoy"
            decoy_dir.mkdir()
            decoy = decoy_dir / "bun"
            override.write_text("#!/bin/sh\n")
            decoy.write_text("#!/bin/sh\n")
            override.chmod(override.stat().st_mode | stat.S_IEXEC)
            decoy.chmod(decoy.stat().st_mode | stat.S_IEXEC)
            with mock.patch.dict(os.environ, {"INDEX_BUN": str(override), "PATH": str(decoy_dir)}):
                self.assertEqual(_bun(), str(override))


if __name__ == "__main__":
    unittest.main()
