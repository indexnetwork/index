# Bundled Hermes skills

Add future plugin skills as:

```text
skills/<skill-name>/SKILL.md
```

`__init__.py` registers each skill directory with `ctx.register_skill()`, so Hermes can load them as `index-network:<skill-name>`.
