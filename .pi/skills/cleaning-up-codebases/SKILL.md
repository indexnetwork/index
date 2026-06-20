---
name: cleaning-up-codebases
description: "Systematically audit and clean a package in the index monorepo for dead code, unused exports, scope creep, anti-patterns, and architectural drift. Asks 'should this exist?' before 'how do I improve this?', classifies findings into tiers (T1 safe deletes through T4 architectural), negotiates scope with the owner, and verifies lint/test/build before and after every change. Use when reviewing or cleaning a backend/frontend/protocol/cli package, removing cruft from a rapidly-developed feature, or doing a pre-refactor audit. Not for greenfield code or single targeted bug fixes."
---

# cleaning-up-codebases

Systematic cleanup that asks **"should this exist?"** before **"how do I improve this?"**
The core failure mode is refactoring code that should be deleted, or adding new
abstractions to an already over-abstracted mess.

**Core principle:** Removal over refactoring. Simplification over restructuring. Verify
before and after every change. Cleanup means *less* code, not different code.

## Repo guardrails (read first)

- **Branch guard:** the canonical root `/Users/yanek/Projects/index` must stay on `dev`
  and is read-only for the assistant. Do all mutating work in a worktree. Create one with
  `git worktree add` + `bun run worktree:setup` per `.pi/skills/git-worktree-workflow/SKILL.md`.
- **Layer architecture is enforced** by `eslint-plugin-boundaries`. `packages/protocol`
  never imports backend/frontend; respect the dependency flow when deleting/moving code.
- **Schema is canonical** at `backend/src/schemas/database.schema.ts`. Removing a column
  or table is a destructive migration (T4) — never a casual delete.

## When to use

- A feature/package that grew organically and accumulated cruft
- Suspected dead code, half-finished features, unused exports, or scope creep
- Code that drifted from the architecture guidance
- Pre-refactor audit to decide what is worth keeping

**When NOT to use:** greenfield code, a single targeted bug fix, or performance work.

## Process

### 1. Understand intent
Read in order: relevant `.rpiv/guidance/**/architecture.md` and `CLAUDE.md`, recent
`git log` for the package, and the package's `package.json` (actual scope/deps). You are
hunting the gap between stated intent and actual code. Code that exists but isn't
mentioned anywhere is a removal candidate.

### 2. Establish a clean baseline
Run the package's checks and **record numbers** before touching anything:
- Lint: `bun run lint` (root, `eslint .`) or `cd <pkg> && eslint src/`
- Test: `cd backend && bun test [path]` · `packages/protocol` and `frontend` have their own suites
- Build: `bun run build:<pkg>` (e.g. `build:backend`) or `cd <pkg> && bun run build`

If a check is already broken, **that is your first finding** — fix the baseline before
adding cleanup on top.

### 3. Survey with automated scans (count, don't eyeball)
See `references/audit-signals.md` for the full monorepo-specific signal list (dead code,
unused exports, TS/React/Drizzle/protocol-specific smells, scope creep). Produce concrete
counts ("14 unused exports, 3 orphaned files"), not vague impressions.

### 4. Question existence
For every major module/feature ask: does it align with stated purpose? Is it reachable
from an entry point? Could it be a separate package? Was it fully finished? **Never
default to "refactor to be better" — first ask "should this exist at all?"**

### 5. Classify into tiers (never mix)

| Tier | What it is | Examples | Effort |
|---|---|---|---|
| **T1** Safe deletes | Dead code, unused files/exports, abandoned experiments | Orphaned `*_v2.ts`, unused export, commented-out blocks | Minutes |
| **T2** Quick fixes | Isolated, no architectural impact | Add missing error handling, remove stale TODO, fix lint warning, drop `console.log` | Hours |
| **T3** Focused refactors | Targeted module improvements | Split a god service, consolidate duplicated logic | Days |
| **T4** Architectural / schema | Structural or destructive | Change a layer boundary, drop a column/table (needs backfill + migration) | Weeks |

### 6. Negotiate scope with the owner
Present findings before changing anything: "N things I can safely delete now — proceed?",
"These features look outside the package's purpose — keep which?", "These T3/T4 items need
your call on direction." **Never assume what the owner values.**

### 7. Execute safe→dangerous, in a worktree
T1 → T2 → T3 → T4. **After each change:** rerun lint/test/build for the touched package;
if broken, revert and investigate. Commit each working state. T4/destructive-migration
work belongs on its own branch and must follow `release-prod-safety` (a stale root
`bun.lock` or an unrun backfill will break/lose prod data).

## Red flags — you're doing it wrong
- You're writing more code than you're deleting
- You're creating new files or adding an abstraction during a *cleanup*
- Your plan has 5+ phases spanning weeks (start with T1, reassess)
- You flagged something dead without grepping for all usages first
- You haven't verified the build passes, or haven't asked the owner what to keep

## See also
- `.pi/skills/git-worktree-workflow/SKILL.md` — mandatory for any mutating work
- `.pi/skills/release-prod-safety/SKILL.md` — before any destructive migration reaches main
- `references/audit-signals.md` — full scan/grep signal catalogue for this monorepo
