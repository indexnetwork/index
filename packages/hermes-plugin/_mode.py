"""Shared fail-closed runtime mode parsing for all Hermes plugin surfaces."""

from __future__ import annotations

import os


def resolve_plugin_mode() -> str:
    """Authorize full mode only for absent, empty, or the exact literal ``full``."""
    configured = os.environ.get("INDEX_PLUGIN_MODE", "")
    return "full" if configured in {"", "full"} else "negotiator"
