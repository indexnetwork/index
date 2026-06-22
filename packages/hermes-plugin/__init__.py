"""Index Network Hermes plugin starter.

This file is intentionally minimal. Fill it in as the Index Network Hermes
plugin grows: MCP-backed tools, dashboard support, hooks, commands, and bundled
skills should be registered from register(ctx).
"""

from pathlib import Path


def _register_skills(ctx):
    """Register bundled plugin skills when skills are added.

    TODO: Add SKILL.md files under skills/<skill-name>/, then keep this helper
    enabled so Hermes can load them as index-network:<skill-name>.
    """
    skills_dir = Path(__file__).parent / "skills"
    if not skills_dir.exists():
        return

    for child in sorted(skills_dir.iterdir()):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.exists():
            ctx.register_skill(child.name, skill_md)


def register(ctx):
    """Register Index Network plugin capabilities with Hermes.

    TODO: Register future MCP-backed tools here, for example:
        ctx.register_tool(
            name="read_index_context",
            toolset="index-network",
            schema=schemas.READ_INDEX_CONTEXT,
            handler=tools.read_index_context,
            description="Read Index Network context.",
        )

    TODO: Register hooks, slash commands, or CLI commands here if the plugin
    needs them later.
    """
    _register_skills(ctx)
