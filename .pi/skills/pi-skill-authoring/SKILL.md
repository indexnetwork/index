---
name: pi-skill-authoring
description: Author a correct, well-triggered Pi skill (SKILL.md) — frontmatter rules, name constraints, progressive-disclosure description writing, structure, and validation. Use when creating a new skill by hand or reviewing an existing SKILL.md for spec compliance. For deciding WHETHER a session learning is worth capturing, use learn-skill instead; this skill covers HOW to write the file correctly.
---

# pi-skill-authoring

A reference for writing a SKILL.md that pi will load and trigger reliably. Pi follows
the [Agent Skills standard](https://agentskills.io/specification) (lenient — most
violations warn but still load; a **missing description does not load**).

## Frontmatter

```markdown
---
name: my-skill
description: What it does AND when to use it. Be specific.
---
```

- `name` (required): 1–64 chars, lowercase `a-z` / `0-9` / hyphens only. No
  leading/trailing hyphen, no consecutive hyphens. Pi does not require it to match the
  directory name.
- `description` (required): ≤1024 chars. This is the **only** text always in context, so
  it alone decides when the skill loads. State the capability *and* the trigger
  conditions. Bad: "Helps with PDFs." Good: "Extracts text/tables from PDFs and fills
  forms. Use when working with PDF documents."
- Optional: `license`, `compatibility`, `metadata`, `allowed-tools`,
  `disable-model-invocation` (`true` hides it from the prompt; only `/skill:name` runs it).

## Structure

A skill is a directory with `SKILL.md`; everything else is freeform.

```
my-skill/
├── SKILL.md          # required
├── scripts/          # helper scripts the body invokes
└── references/       # detail docs loaded on demand
```

Reference assets with **relative paths** from the skill dir. Keep the body concise —
this is progressive disclosure: only the description is always loaded, the body loads
on match.

## Location

- Project: `.pi/skills/` (auto-discovered when trusted). Root `.md` files also count.
- Global: `~/.pi/agent/skills/`, `~/.agents/skills/`.
- Treat global/home skills as read-only unless you own them — edit a project-local copy.

## Argument placeholders (if rpiv-args is installed)

Author skills that take input with `$1`, `$2`, `$@`, `$ARGUMENTS`, `${@:N}` so they run
as `/skill:my-skill arg1 arg2`. Skills without placeholders are untouched.

## Validate before finishing

Check name rules and that a non-empty description ≤1024 chars is present. If the
`learn-skill` helper is available you can reuse its validator:

```bash
bun .pi/skills/learn-skill/scripts/skillctl.ts validate .pi/skills/my-skill
```

Otherwise eyeball against the rules above.

## Checklist

- [ ] name matches `^[a-z0-9-]+$`, 1–64 chars, no edge/double hyphens
- [ ] description states what + when, ≤1024 chars, non-empty
- [ ] body is concise; details pushed to `references/`
- [ ] scripts/assets referenced via relative paths
- [ ] written to the right (project-local, non-protected) location

## See also

- **learn-skill** — decides *whether/when* to capture a session learning into a skill,
  and enforces location safety (migrate protected → local). Use it as the entry point;
  use this skill for the authoring mechanics. Next step after authoring: validate, then
  let learn-skill handle placement/cross-linking.
