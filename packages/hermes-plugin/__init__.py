"""Index Network Hermes plugin.

This plugin follows the official Hermes plugin guide: plugin.yaml declares the
capabilities, schemas.py defines what the LLM sees, tools.py implements handlers
that always return JSON strings, and register(ctx) wires everything into Hermes.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from . import schemas, tools, transport


def _install_desktop_plugin():
    """Copy the shipped Hermes Desktop bundle into ~/.hermes/desktop-plugins.

    The desktop app loads plugins from its own folder, separate from the
    gateway's ~/.hermes/plugins, so `hermes plugins install` alone would not
    surface the desktop tab. Self-installing here keeps it a one-step install
    and refreshes the copy on upgrades (content comparison). Best-effort: the
    desktop app is optional and this must never break gateway startup.
    """
    src = Path(__file__).parent / "desktop" / "dist"
    dest = Path.home() / ".hermes" / "desktop-plugins" / "index-network"
    try:
        if not (src / "plugin.js").exists():
            return
        if dest.exists() and (dest / "plugin.js").read_bytes() == (src / "plugin.js").read_bytes():
            return
        shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(src, dest)
    except Exception:  # noqa: BLE001
        pass


def register(ctx):
    """Register the Index Network capabilities with Hermes."""
    _install_desktop_plugin()
    ctx.register_tool(
        name="index_read_intents",
        toolset="index-network",
        schema=schemas.INDEX_READ_INTENTS,
        handler=tools.index_read_intents,
    )
    for tool_name in schemas.FORWARDED_MCP_TOOLS:
        ctx.register_tool(
            name=f"index_{tool_name}",
            toolset="index-network",
            schema=schemas.forwarded_mcp_schema(tool_name),
            handler=tools.make_mcp_tool_handler(tool_name),
        )
    for name, schema, handler in (
        ("index_agent_me", schemas.INDEX_AGENT_ME, tools.index_agent_me),
        ("index_open_app", schemas.INDEX_OPEN_APP, tools.index_open_app),
    ):
        ctx.register_tool(name=name, toolset="index-network", schema=schema, handler=handler)
