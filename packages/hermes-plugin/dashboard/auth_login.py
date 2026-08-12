"""Connector-owned browser authorization for the Hermes Index dashboard."""

from __future__ import annotations

import importlib.util
import pathlib
import sys
from typing import Any

_PLUGIN_ROOT = pathlib.Path(__file__).resolve().parent.parent


def _load_migration():
    package = __package__
    if package and "." in package:
        root_package = package.rsplit(".", 1)[0]
        return __import__(f"{root_package}.migration", fromlist=["migration"])
    name = "index_network_hermes_dashboard_migration"
    existing = sys.modules.get(name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(name, _PLUGIN_ROOT / "migration.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load secure migration")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def start_login(transport) -> dict[str, Any]:
    """Complete the fail-closed plaintext migration before authorization."""
    return _load_migration().migrate_before_authorization(transport)


def poll_status(transport) -> dict[str, Any]:
    return transport.poll_authorization()


def disconnect(transport) -> dict[str, Any]:
    return transport.disconnect()
