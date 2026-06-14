---
name: learn-skill
description: Capture a reusable learning from the current session and persist it as a new skill, or fold it into an existing one. Use at the end of a session, or whenever a non-obvious workflow, fix, command sequence, or gotcha was discovered that would save time if it were reusable. Writes only to the project-local target (.pi/skills by default); protected locations such as the home folder are never modified in place — a relevant protected skill is migrated (copied) locally first, then updated.
---

# learn-skill

Turn a learning from this session into a durable skill. The defining rule of this
skill is **location safety**: skills in protected locations (the home folder) are
treated as read-only. All create / migrate / update operations land in the
project-local target so a machine-wide skill is never silently mutated.

## Configuration

`config.json` (next to this file) controls behavior. The helper script reads it; never hard-code paths.

| Key | Default | Meaning |
|---|---|---|
| `target` | `.pi/skills` | Where new/migrated/updated skills are written, resolved relative to the current project (cwd). |
| `protectedLocations` | `~/.pi/agent/skills`, `~/.agents/skills` | Never modified in place. |
| `allowProtectedWrites` | `false` | Escape hatch — when `true`, allows editing a protected skill in place instead of migrating. Leave `false` unless explicitly intended. |
| `features.crossLink` | `true` | Generated skills get see-also / next-step links to related skills. |
| `features.dedup` | `true` | Before creating, scan for an overlapping skill and prefer updating it. |
| `features.modularize` | `true` | Keep skills modular: split oversized bodies, extract shared partials, split multi-concern skills. |
| `modularize.maxBodyLines` | `120` | Body line count above which detail should move into `references/`. |
| `modularize.sharedDir` | `_shared` | Directory (under `target`) holding partials linked by multiple skills. |
| `modularize.minDuplicateBlockLines` | `4` | Min lines for a duplicated block to count as a shared-partial candidate. |
| `integrations.useTodo` | `true` | Track multi-step captures with the `todo` tool (rpiv-todo). |
| `integrations.useAskUserQuestion` | `true` | Ask structured clarifying questions when scope/name is ambiguous (rpiv-ask-user-question). |
| `integrations.useArgs` | `true` | Author generated skills to accept `$1` / `$@` arguments (rpiv-args). |
| `integrations.useAdvisor` | `false` | Run the drafted skill past a stronger reviewer model before writing (rpiv-advisor). |

**Integrations are doubly gated:** an integration is used only if its flag is `true` AND the package is installed. Run `detect` to see effective state; if a helper isn't installed, skip it silently — never fail because of it.

```bash
bun .pi/skills/learn-skill/scripts/skillctl.ts detect
```

## Workflow

Run all commands from the project root (so `cwd` is the project whose `.pi/skills` should receive the skill). Use `bun` — it is the repo runtime.

### 1. Decide what is worth capturing

Only capture a learning that is **reusable and non-obvious**: a multi-step workflow,
a fix for a recurring failure, an exact command sequence, an environment gotcha, or a
convention. Skip one-off facts and anything already covered by an existing skill.
Name it as `lowercase-hyphenated` (≤64 chars).

If `integrations.useTodo` is active and the capture spans multiple skills or steps,
track the work with the `todo` tool. If `integrations.useAskUserQuestion` is active and
the skill's name, scope, or trigger conditions are ambiguous, ask the user before writing
rather than guessing.

### 1b. Dedup check (when `features.dedup`)

Before creating anything new, look for an existing skill that already covers this:

```bash
bun .pi/skills/learn-skill/scripts/skillctl.ts similar <keywords...>
```

If a strong overlap exists, prefer **updating** that skill (step 3b) over creating a
near-duplicate. Use `plan` for a full dry-run that combines the resolved action, dedup
hints, and active integrations without writing anything:

```bash
bun .pi/skills/learn-skill/scripts/skillctl.ts plan <skill-name> <keywords...>
```

### 2. Resolve the write action

```bash
bun .pi/skills/learn-skill/scripts/skillctl.ts resolve <skill-name>
```

This prints one of:
- `create` — no skill by that name exists → create it under `target`.
- `update` — a **local** skill exists → edit it in place.
- `migrate` — only a **protected** (home) skill exists → copy it local, then edit the copy.
- `update-protected` — only appears when `allowProtectedWrites: true`.

Use `list` / `locate` to inspect first if unsure:

```bash
bun .pi/skills/learn-skill/scripts/skillctl.ts list
bun .pi/skills/learn-skill/scripts/skillctl.ts locate <skill-name>
```

### 3a. CREATE

Write `<target>/<skill-name>/SKILL.md` with valid frontmatter (`name`, `description`)
and a concise body. The `description` must state **what it does and when to use it** —
this is what triggers loading later. Add `scripts/` or `references/` only if needed.

- If `integrations.useArgs` is active and the skill takes input (a target, an env, a
  name), author it with `$1` / `$ARGUMENTS` / `$@` placeholders so it works as
  `/skill:<name> <args>`.
- If `features.crossLink` is active, add a short "See also" / "Next step" line pointing
  to related skills surfaced by the dedup/`similar` check.

### 3b. UPDATE (local)

`read` the existing local `SKILL.md` and fold the new learning in surgically — extend
the relevant section, tighten the description if the trigger conditions widened. Do not
rewrite wholesale.

### 3c. MIGRATE (protected → local), then update

```bash
bun .pi/skills/learn-skill/scripts/skillctl.ts migrate <skill-name>
```

This copies the protected skill directory into `target` and leaves the original
untouched. Then apply step 3b to the **local copy**. Never edit the protected source.

### 3d. Modularize (when `features.modularize`)

Keep skills small and composable. Run the audit on the skill you just wrote/updated:

```bash
bun .pi/skills/learn-skill/scripts/skillctl.ts audit <skill-name>
```

Act on what it reports, across three axes:

1. **Progressive-disclosure split** — if the body exceeds `maxBodyLines`, move detail
   (long examples, reference tables, edge-case notes) into `references/*.md` and leave the
   `SKILL.md` body lean (what + when + entry steps, linking the references). Only the
   description is always in context, so a lean body is cheaper and triggers better.
2. **Shared partials** — if the audit lists duplicate-block candidates, extract the shared
   content into `<target>/<sharedDir>/<topic>.md` (a plain markdown module, **not** a skill —
   no frontmatter, so it is never discovered as one) and link it from each skill instead of
   copying. One source of truth for cross-cutting policy (e.g. location safety, frontmatter rules).
3. **Composable sub-skills** — if a skill covers 2+ distinct concerns, split it into smaller
   skills that each do one thing and cross-link (step 3a's crossLink rule). If they form a
   pipeline and `rpiv-workflow` is installed, they can later be chained as `/skill:<name>` stages.

Location safety still applies: write partials under the local `target` and edit only local
copies — never touch protected/home skills.

### 4. Validate (and optionally review)

```bash
bun .pi/skills/learn-skill/scripts/skillctl.ts validate <target>/<skill-name>
```

Fix any reported errors (name rules, description present + ≤1024 chars). A skill with a
missing description will not load.

If `integrations.useAdvisor` is active, hand the drafted skill to the `advisor` tool for
a second opinion before finalizing, and fold in any correction.

### 5. Report

Tell the user the action taken, the final path, and a one-line summary of what was
captured. A newly written skill is discovered on the next session scan; within this
session you can `read` it directly.

## Guardrails

- Never write to or edit a path under `protectedLocations` unless `allowProtectedWrites`
  is explicitly `true`. When in doubt, migrate.
- Prefer updating an existing skill over creating a near-duplicate.
- Keep skills focused — one capability per skill. Split rather than bloat.
- If nothing in the session meets the "reusable and non-obvious" bar, capture nothing
  and say so.
- Integrations are optional: if a configured helper isn't installed, skip it silently — a missing extension must never block a capture.
