---
name: create-skill
description: Author a correct, well-triggered Agent Skill — SKILL.md frontmatter, agents/openai.yaml metadata, name constraints, progressive-disclosure structure, and validation. Use when creating a new project-local skill by hand or reviewing one for spec compliance. For deciding WHETHER a session learning is worth capturing, use learn-skill instead; this skill covers HOW to write the files correctly.
---

# create-skill

A reference for writing an Agent Skill that compatible coding agents can load and
trigger reliably. The repository follows the
[Agent Skills standard](https://agentskills.io/specification); a **missing description
does not load**, and project validation applies stricter repository conventions.

## Frontmatter

```markdown
---
name: my-skill
description: What it does AND when to use it. Be specific.
---
```

- `name` (required): 1–64 chars, lowercase `a-z` / `0-9` / hyphens only. No
  leading/trailing hyphen or consecutive hyphens. Project policy additionally requires
  an imperative action-object with at least two segments, an approved first verb from
  `learn-skill/config.json`, and an exact match with the parent directory name.
- `description` (required): ≤1024 chars. This is the **only** text always in context, so
  it alone decides when the skill loads. State the capability *and* the trigger
  conditions. Bad: "Helps with PDFs." Good: "Extracts text/tables from PDFs and fills
  forms. Use when working with PDF documents."
- Optional: `license`, `compatibility`, `metadata`, `allowed-tools`,
  `disable-model-invocation` (`true` hides it from the prompt; only `/skill:name` runs it).

**YAML safety — quote any value containing a colon.** A plain (unquoted) scalar that
contains a `: ` (colon followed by space) makes the YAML loader read it as a nested
mapping and the skill fails to load with `Nested mappings are not allowed in compact
mappings`. This bites long `description` values that enumerate (`...lose data: (1) ...,
and (2) ...`) or use `e.g.`-style asides. Wrap the whole value in double quotes and
switch any inner double quotes to single quotes:

```yaml
# breaks: colon-space parsed as a nested map
description: Checks two things: (1) the lockfile, and (2) the migration.
# works
description: "Checks two things: (1) the lockfile, and (2) the migration."
```

The same rule applies to any colon-bearing value (`metadata`, etc.), not just
`description`.

## Structure

A skill is a directory with `SKILL.md` plus repository-required agent metadata.

```
my-skill/
├── SKILL.md          # required workflow and frontmatter
├── agents/
│   └── openai.yaml   # required discovery metadata
├── scripts/          # optional helper scripts the body invokes
└── references/       # optional detail docs loaded on demand
```

Use this metadata shape, with nonempty trimmed strings and a default prompt that
references the skill by `$<name>`:

```yaml
interface:
  display_name: "My Skill"
  short_description: "Run the repository-specific My Skill workflow"
  default_prompt: "Use $my-skill to follow the repository-specific My Skill workflow."
```

Reference assets with **relative paths** from the skill dir. Keep the body concise —
this is progressive disclosure: only the description is always loaded, the body loads
on match.

## Location

- Project: `.agents/skills/<name>/` (auto-discovered when trusted; direct root `.md` skills are not allowed).
- Global/home discovery: `~/.pi/agent/skills/`, `~/.agents/skills/`.
- Treat global/home skills as read-only unless you own them — edit a project-local copy.

## Argument placeholders (if rpiv-args is installed)

Author skills that take input with `$1`, `$2`, `$@`, `$ARGUMENTS`, `${@:N}` so they run
as `/skill:my-skill arg1 arg2`. Skills without placeholders are untouched.

## Validate before finishing

Run both focused and repository-wide validation. The all-skills pass enforces unique
names, the shared action-object policy, valid `agents/openai.yaml` metadata, and local
Markdown references in addition to YAML and frontmatter rules:

```bash
bun .agents/skills/learn-skill/scripts/skillctl.ts validate .agents/skills/my-skill
bun run skills:validate
```

Fix every failure before finishing. Use `validate all --json` for the stable
machine-readable report.

## Checklist

- [ ] name is an allowed imperative action-object, matches its directory, and satisfies `^[a-z0-9-]+$`, 1–64 chars, no edge/double hyphens
- [ ] description states what + when, ≤1024 chars, non-empty
- [ ] body is concise; details pushed to `references/`
- [ ] `agents/openai.yaml` has all three interface strings and `$<name>` in `default_prompt`
- [ ] scripts/assets and Markdown references resolve relative to the skill directory
- [ ] written to the right (project-local, non-protected) location

## See also

- **learn-skill** — decides *whether/when* to capture a session learning into a skill,
  and enforces location safety (migrate protected → local). Use it as the entry point;
  use this skill for the authoring mechanics. Next step after authoring: validate, then
  let learn-skill handle placement/cross-linking.
