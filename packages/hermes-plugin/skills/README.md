# Bundled Hermes skills

Generated Hermes plugin skills live under:

```text
skills/<skill-name>/SKILL.md
```

Source templates live in the monorepo at:

```text
packages/protocol/skills/hermes-plugin/<skill-name>.template.md
```

Run `bun run build:skills` from the monorepo root to regenerate these files. Do not edit generated `SKILL.md` files directly.

`__init__.py` registers each skill directory with `ctx.register_skill()`, so Hermes can load them as `index-network:<skill-name>`.
