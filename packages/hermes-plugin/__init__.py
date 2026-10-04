"""Index Network Hermes plugin."""

from __future__ import annotations

import shutil
from pathlib import Path

from . import schemas, tools
from .bridge import HermesBridge
from .sidecar import Sidecar


def _remove_unmarked_desktop_copy(home: Path) -> None:
    """Drop a copy this plugin used to write itself.

    Hermes installs `desktop/plugin.js` and stamps `.hermes-package.json`. A
    folder without that marker was copied by an older register() and loads
    enabled. A marked folder belongs to Hermes.
    """
    dest = Path(home) / "desktop-plugins" / "index-network"
    if (dest / ".hermes-package.json").is_file() or not dest.exists():
        return
    shutil.rmtree(dest, ignore_errors=True)


_sidecar: Sidecar | None = None


def register(ctx):
    global _sidecar
    from hermes_constants import get_hermes_home
    from . import events
    from .morning import sync_morning_cron

    home = get_hermes_home()
    _remove_unmarked_desktop_copy(home)
    bridge = HermesBridge()
    sidecar = Sidecar(bridge, home)
    _sidecar = sidecar
    bridge.sidecar = sidecar
    events.watch(sidecar)
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
    ctx.on_unload(lambda: sync_morning_cron(home, False))
