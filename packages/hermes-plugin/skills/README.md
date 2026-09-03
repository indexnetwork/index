# Bundled Hermes skills

Plugin skills live under:

```text
skills/<skill-name>/SKILL.md
```

Edit those files directly.

`__init__.py` registers each skill directory with `ctx.register_skill()`, so Hermes can load them as namespaced, read-only plugin skills:

- `index-network:index-orchestrator` — interactive signal/intent review and discovery preparation.

The plugin also registers a `pre_llm_call` hint hook and `/index` command that nudge Hermes to load `index-network:index-orchestrator` for clear Index Network prompts.
