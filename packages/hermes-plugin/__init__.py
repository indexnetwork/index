"""Index Network Hermes plugin.

This plugin follows the official Hermes plugin guide: plugin.yaml declares the
capabilities, schemas.py defines what the LLM sees, tools.py implements handlers
that always return JSON strings, and register(ctx) wires everything into Hermes.
"""

from pathlib import Path

from . import schemas, tools


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


def register(ctx):
    """Register Index Network plugin capabilities with Hermes."""
    ctx.register_tool(
        name="index_read_intents",
        toolset="index-network",
        schema=schemas.INDEX_READ_INTENTS,
        handler=tools.index_read_intents,
    )
    _register_skills(ctx)
