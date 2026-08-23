"""Index Network Hermes plugin.

This plugin follows the official Hermes plugin guide: plugin.yaml declares the
capabilities, schemas.py defines what the LLM sees, tools.py implements handlers
that always return JSON strings, and register(ctx) wires everything into Hermes.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from . import schemas, tools, transport
from ._mode import resolve_plugin_mode

try:
    from . import negotiation_wake as negotiation_wake
except Exception:  # noqa: BLE001 - optional at import time for incomplete installs
    negotiation_wake = None  # type: ignore[assignment]

_INDEX_HINT = (
    'For Index Network signals/intents/opportunities/discovery requests, load '
    'skill_view("index-network:index-orchestrator") before answering or using Index tools.'
)
_INDEX_TERMS = (
    "index network",
    "index.network",
    "signal",
    "signals",
    "intent",
    "intents",
    "opportunity",
    "opportunities",
    "discovery",
    "discover",
)


def _register_skills(ctx, allowed_names: set[str] | None = None):
    """Register bundled plugin skills when skills are added.

    Plugin skills are namespaced and read-only in Hermes; they are not copied
    into ~/.hermes/skills. Add SKILL.md files under skills/<skill-name>/ and
    they will load as index-network:<skill-name>.
    """
    skills_dir = Path(__file__).parent / "skills"
    if not skills_dir.exists():
        return

    for child in sorted(skills_dir.iterdir()):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.exists() and (allowed_names is None or child.name in allowed_names):
            ctx.register_skill(child.name, skill_md)


def _extract_user_message(*args: Any, **kwargs: Any) -> str:
    for key in ("user_message", "message", "prompt", "input"):
        value = kwargs.get(key)
        if isinstance(value, str):
            return value
    for arg in args:
        if isinstance(arg, str):
            return arg
        if isinstance(arg, dict):
            for key in ("user_message", "message", "prompt", "input"):
                value = arg.get(key)
                if isinstance(value, str):
                    return value
    return ""


def _index_context_hint(*args: Any, **kwargs: Any) -> str | None:
    """Inject a defensive skill-loading hint for clear Index-related prompts."""
    try:
        user_message = _extract_user_message(*args, **kwargs).lower()
        if not user_message:
            return None
        if any(term in user_message for term in _INDEX_TERMS):
            return _INDEX_HINT
    except Exception:  # noqa: BLE001 - hooks should never break a Hermes turn.
        return None
    return None


def _index_command(*args: Any, **kwargs: Any) -> str:
    del args, kwargs
    return _INDEX_HINT


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


def _remove_desktop_plugin():
    """Remove a stale Index dashboard copy when the runtime is negotiation-only."""
    dest = Path.home() / ".hermes" / "desktop-plugins" / "index-network"
    try:
        if dest.is_symlink():
            dest.unlink()
        else:
            shutil.rmtree(dest, ignore_errors=True)
    except Exception:  # noqa: BLE001 - dashboard cleanup must not break startup.
        pass


def _plugin_mode() -> str:
    """Resolve the shared runtime authorization mode."""
    return resolve_plugin_mode()


def _register_negotiation_tools(ctx):
    for name, schema, handler in (
        ("index_agent_me", schemas.INDEX_AGENT_ME, tools.index_agent_me),
        ("index_respond_negotiation", schemas.INDEX_RESPOND_NEGOTIATION, tools.index_respond_negotiation),
    ):
        ctx.register_tool(name=name, toolset="index-network", schema=schema, handler=handler)


def register(ctx):
    """Register the mode-authorized Index Network capabilities with Hermes."""
    if _plugin_mode() == "negotiator":
        _remove_desktop_plugin()
        _register_negotiation_tools(ctx)
        _register_skills(ctx, {"index-negotiator"})
        return

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
        ("index_respond_negotiation", schemas.INDEX_RESPOND_NEGOTIATION, tools.index_respond_negotiation),
    ):
        ctx.register_tool(name=name, toolset="index-network", schema=schema, handler=handler)
    if hasattr(ctx, "register_hook"):
        ctx.register_hook("pre_llm_call", _index_context_hint)
    if hasattr(ctx, "register_command"):
        ctx.register_command(
            "index",
            _index_command,
            description="Load Index Network orchestrator guidance",
        )
    _register_skills(ctx)
    # Ordinary agent keys: keep lastNegotiationPickupAt fresh via conversation
    # SSE keepalive (~15s) so Index parks turns for Hermes instead of taking
    # them inline. Pickup is a seat heartbeat only — no auto consult/respond.
    if negotiation_wake is not None:
        try:
            negotiation_wake.bind_plugin_context(ctx)
            negotiation_wake.start_listener()
        except Exception:  # noqa: BLE001
            pass
