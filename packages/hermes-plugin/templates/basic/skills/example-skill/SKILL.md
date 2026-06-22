---
name: example-skill
description: Use when you want to demonstrate a bundled Hermes plugin skill.
---

# Example Plugin Skill

This skill is bundled inside the generated plugin and registered with `ctx.register_skill()`.
Load it from Hermes with the namespaced skill name:

```text
skill_view("__PLUGIN_NAME__:example-skill")
```

Replace this file with your plugin-specific workflow instructions.
