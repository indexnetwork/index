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

`__init__.py` registers each skill directory with `ctx.register_skill()`, so Hermes can load them as namespaced, read-only plugin skills:

- `index-network:index-orchestrator` — interactive signal/intent review and discovery preparation.
- `index-network:index-negotiator` — scheduled autonomous personal-agent negotiation using `index_pickup_negotiation` and `index_respond_negotiation`.

The plugin also registers a `pre_llm_call` hint hook and `/index` command that nudge Hermes to load `index-network:index-orchestrator` for clear Index Network prompts.
