"""Index Network Hermes plugin."""

from __future__ import annotations

import shutil
from pathlib import Path

from . import schemas, tools
from .bridge import HermesBridge
from .sidecar import Sidecar
from .speaker import register_tools


def _install_desktop_plugin():
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


_sidecar: Sidecar | None = None


def register(ctx):
    global _sidecar
    _install_desktop_plugin()
    from hermes_constants import get_hermes_home
    from . import events

    home = get_hermes_home()
    bridge = HermesBridge()
    sidecar = Sidecar(bridge, home)
    _sidecar = sidecar
    bridge.sidecar = sidecar
    events.register_platform(ctx, sidecar)
    register_tools(ctx, sidecar)
    for name, schema, handler in (
        ("index_read_intents", schemas.INDEX_READ_INTENTS, tools.index_read_intents),
        ("index_create_intent", schemas.INDEX_CREATE_INTENT, tools.index_create_intent),
        ("index_update_intent", schemas.INDEX_UPDATE_INTENT, tools.index_update_intent),
        ("index_list_intent_networks", schemas.INDEX_LIST_INTENT_NETWORKS, tools.index_list_intent_networks),
        ("index_add_intent_to_network", schemas.INDEX_ADD_INTENT_TO_NETWORK, tools.index_add_intent_to_network),
        ("index_read_networks", schemas.INDEX_READ_NETWORKS, tools.index_read_networks),
        ("index_read_network_memberships", schemas.INDEX_READ_NETWORK_MEMBERSHIPS, tools.index_read_network_memberships),
        ("index_create_network", schemas.INDEX_CREATE_NETWORK, tools.index_create_network),
        ("index_update_network", schemas.INDEX_UPDATE_NETWORK, tools.index_update_network),
        ("index_join_network", schemas.INDEX_JOIN_NETWORK, tools.index_join_network),
        ("index_list_opportunities", schemas.INDEX_LIST_OPPORTUNITIES, tools.index_list_opportunities),
        ("index_update_opportunity", schemas.INDEX_UPDATE_OPPORTUNITY, tools.index_update_opportunity),
        ("index_research_profile", schemas.INDEX_RESEARCH_PROFILE, tools.index_research_profile),
        ("index_read_docs", schemas.INDEX_READ_DOCS, tools.index_read_docs),
        ("index_agent_me", schemas.INDEX_AGENT_ME, tools.index_agent_me),
        ("index_open_app", schemas.INDEX_OPEN_APP, tools.index_open_app),
    ):
        ctx.register_tool(name=name, toolset="index-network", schema=schema, handler=handler)
    from .mcp import sync_index_mcp

    sync_index_mcp()
