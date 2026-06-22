"""__PLUGIN_TITLE__ Hermes plugin — registration."""

from pathlib import Path

from . import schemas, tools


def _register_skills(ctx):
    """Register bundled plugin skills as namespaced plugin skills."""
    skills_dir = Path(__file__).parent / "skills"
    if not skills_dir.exists():
        return
    for child in sorted(skills_dir.iterdir()):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.exists():
            ctx.register_skill(child.name, skill_md)


def register(ctx):
    """Wire schemas to handlers and register bundled skills."""
    ctx.register_tool(
        name="hello_world",
        toolset="__PLUGIN_NAME__",
        schema=schemas.HELLO_WORLD,
        handler=tools.hello_world,
        description="Return a friendly greeting for a provided name.",
    )
    _register_skills(ctx)
