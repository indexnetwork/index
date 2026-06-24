"""Index Network Hermes plugin.

This plugin follows the official Hermes plugin guide: plugin.yaml declares the
capabilities, schemas.py defines what the LLM sees, tools.py implements handlers
that always return JSON strings, and register(ctx) wires everything into Hermes.
"""

from pathlib import Path
from typing import Any

from . import schemas, tools

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


def _register_skills(ctx):
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
        if child.is_dir() and skill_md.exists():
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


def register(ctx):
    """Register Index Network plugin capabilities with Hermes."""
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
    ctx.register_tool(
        name="index_agent_me",
        toolset="index-network",
        schema=schemas.INDEX_AGENT_ME,
        handler=tools.index_agent_me,
    )
    ctx.register_tool(
        name="index_pickup_negotiation",
        toolset="index-network",
        schema=schemas.INDEX_PICKUP_NEGOTIATION,
        handler=tools.index_pickup_negotiation,
    )
    ctx.register_tool(
        name="index_respond_negotiation",
        toolset="index-network",
        schema=schemas.INDEX_RESPOND_NEGOTIATION,
        handler=tools.index_respond_negotiation,
    )
    if hasattr(ctx, "register_hook"):
        ctx.register_hook("pre_llm_call", _index_context_hint)
    if hasattr(ctx, "register_command"):
        ctx.register_command(
            "index",
            _index_command,
            description="Load Index Network orchestrator guidance",
        )
    _register_skills(ctx)
