"""Register the Index HTTP MCP server in Hermes while an API key is configured."""

from __future__ import annotations

import os

_SERVER = "index"
_KEY_ENV = "INDEX_API_KEY"
_HEADERS = {"x-api-key": "${INDEX_API_KEY}"}
_OURS = {"url", "headers", "enabled"}


def _desired() -> dict:
    from .env_transport import api_origin

    return {"url": api_origin() + "/mcp", "headers": dict(_HEADERS)}


def _raw_entry():
    """The raw `mcp_servers.index` entry, or None when Hermes has not saved one."""
    from hermes_cli.config import read_raw_config_readonly

    servers = (read_raw_config_readonly() or {}).get("mcp_servers")
    if not isinstance(servers, dict) or _SERVER not in servers:
        return None
    entry = servers[_SERVER]
    return entry if isinstance(entry, dict) else False


def _is_ours(entry: dict) -> bool:
    return (
        set(entry) <= _OURS
        and isinstance(entry.get("url"), str)
        and entry.get("headers") == _HEADERS
    )


def _negotiator_home():
    """The negotiator profile directory, once it exists."""
    from .env_transport import negotiator_env_path

    env = negotiator_env_path()
    return env.parent if env is not None else None


def sync_index_mcp() -> None:
    """Upsert `mcp_servers.index` on the gateway profile when `INDEX_API_KEY` is set.

    The negotiator profile is only the model home, so a completion that has
    overridden Hermes home does not receive the Index MCP server. A hand-edited
    entry, including one set `enabled: false`, is left in place. Import and
    config failures are ignored so plugin load still succeeds.
    """
    try:
        from hermes_constants import get_hermes_home

        negotiator = _negotiator_home()
        if negotiator is not None and get_hermes_home().resolve() == negotiator.resolve():
            return
        current = _raw_entry()
        from hermes_cli.mcp_config import _remove_mcp_server, _save_mcp_server

        if current is False:
            return
        api_key = os.environ.get(_KEY_ENV, "").strip()
        if not api_key:
            if isinstance(current, dict) and _is_ours(current) and current.get("enabled") is not False:
                _remove_mcp_server(_SERVER)
            return
        desired = _desired()
        if isinstance(current, dict) and (
            current.get("enabled") is False or not _is_ours(current) or (
                current.get("url") == desired["url"] and current.get("headers") == desired["headers"]
            )
        ):
            return
        _save_mcp_server(_SERVER, desired)
    except Exception:  # noqa: BLE001 — a Hermes config mismatch must not block the plugin
        return
