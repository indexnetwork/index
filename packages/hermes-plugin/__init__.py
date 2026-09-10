"""Index Network Hermes plugin.

This plugin follows the official Hermes plugin guide: plugin.yaml declares the
capabilities, schemas.py defines what the LLM sees, tools.py implements handlers
that always return JSON strings, and register(ctx) wires everything into Hermes.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from . import schemas, tools, transport
from .native_agent import NativeAgent, SKILL_PATH


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
    native = NativeAgent(ctx)
    # Imported here because it reaches into the gateway packages, which the
    # dashboard and desktop surfaces import this package without.
    from . import events

    events.register_platform(ctx, native)
    ctx.register_skill(name="personal-agent", path=SKILL_PATH,
                       description="Native Index personal-agent negotiation and private inbox review.")
    for hook in ("pre_gateway_dispatch", "pre_llm_call", "pre_tool_call", "transform_llm_output", "post_llm_call"):
        ctx.register_hook(hook, getattr(native, hook))
    for name, schema in schemas.NATIVE_AGENT_SCHEMAS.items():
        target = native if name in ("configure_personal_agent", "focus_intent") else native.operations
        ctx.register_tool(name=f"index_{name}", toolset="index-network", schema=schema, handler=target.handler(name))
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
