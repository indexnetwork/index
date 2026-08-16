---
name: clean-codebase
description: "Audit and clean a package for dead code, unused exports, scope creep, complexity, coupling, and architectural drift — asking 'should this exist?' before 'how do I improve this?'. Classifies findings T1 (safe deletes) through T4 (architectural) and verifies each batch. Use when cleaning an api/web/protocol/cli package or doing a pre-refactor audit; not for greenfield code or single bug fixes."

---

# clean-codebase

Systematic cleanup that asks **"should this exist?"** before **"how do I improve this?"**
The core failure mode is refactoring code that should be deleted, or adding new
abstractions to an already over-abstracted mess.

**Core principle:** Removal over refactoring. Simplification over restructuring. Verify
the baseline and each coherent batch. Cleanup means *less* code, not different code.

**Measure, don't eyeball.** Every finding is backed by a deterministic signal — a tool
output, a grep count, or a metric threshold — never a vibe. Probabilistic models are good
at *applying* known patterns but bad at *deciding* what is dead; let deterministic tools
(linters, dead-code scans, type checker, complexity meters) make that call.

## Repo guardrails (read first)

- **Branch guard:** the canonical root checkout must stay on `dev`
  and is read-only for the assistant. Do all mutating work in a worktree. Create one with
  `bun run worktree:new <type>/<description>`.
- **Layer architecture is enforced** by `eslint-plugin-boundaries`. `packages/protocol`
  never imports api/web; respect the dependency flow when deleting/moving code.
- **Schema is canonical** at `services/api/src/schemas/database.schema.ts`. Removing a column
  or table is a destructive migration (T4) — never a casual delete.

## When to use

- A feature/package that grew organically and accumulated cruft
- Suspected dead code, half-finished features, unused exports, or scope creep
- Code that drifted from the architecture guidance, or grew tangled coupling
- Pre-refactor audit to decide what is worth keeping

**When NOT to use:** greenfield code, a single targeted bug fix, or performance work.

## Process

### 1. Understand intent
Read in order: the root `AGENTS.md` plus any nested `AGENTS.md` covering the directory
tree, the Development Reference, recent
`git log` for the package, and the package's `package.json` (actual scope/deps). You are
hunting the gap between stated intent and actual code. Code that exists but isn't
mentioned anywhere is a removal candidate.

### 2. Establish a clean baseline
Run the package's checks and **record numbers** before touching anything:
- Lint: `bun run lint` (root, `eslint .`) or `cd <pkg> && eslint src/`
- Test: `cd services/api && bun test [path]` · `packages/protocol` and `apps/web` have their own suites
- Build: `bun run build:<pkg>` (e.g. `build:api`) or `cd <pkg> && bun run build`

If a check is already broken, **that is your first finding** — fix the baseline before
adding cleanup on top.

### 3. Survey by dimension (fan out, count, don't eyeball)
Don't do one vague "look at the code" pass. Audit each dimension below as its own focused
sweep, producing concrete counts ("14 unused exports, 3 orphaned files, 2 god-files >500
lines"). For large packages, dispatch independent dimensions to parallel `Explore` agents
— each is read-only and returns findings, not edits. Full monorepo-specific commands live
in `references/audit-signals.md`.

| # | Dimension | Hunting for |
|---|---|---|
| **D1** | Dead code & reachability | Orphan files, unused exports, commented blocks, unreachable branches, abandoned `*_v2`/`_old` |
| **D2** | Duplication & over-abstraction | Copy-pasted blocks >6 lines, parallel implementations, one-use abstractions, premature generics (KISS/DRY/YAGNI) |
| **D3** | Complexity & god-files | Functions over the thresholds below, files >500 lines, deep nesting (4+), long if/elif chains |
| **D4** | Type & error hygiene | `any`/`as any`, non-null `!` abuse, `@ts-ignore`, empty `catch {}`, swallowed errors, `console.log` |
| **D5** | Coupling & dependency topology | Layer-boundary violations, import cycles, high fan-in/fan-out modules, cross-feature reach-ins |
| **D6** | Scope creep | Modules outside the package's stated purpose, deps pulled for one non-core feature, separable sub-packages |
| **D7** | Schema & data lifecycle | Columns/tables with no read or write path, parallel schema defs, hand-edited generated artifacts |

### Metric thresholds (refactor candidates)
Treat a breach as a *finding to triage*, not an automatic edit. Adjust only with owner buy-in.

| Metric | Threshold | Tool / how |
|---|---|---|
| Cyclomatic complexity | ≥ 11 → split | eslint `complexity` rule, or `bunx` a complexity reporter |
| Cognitive complexity | > 15 → split | `eslint-plugin-sonarjs` `cognitive-complexity` |
| Maintainability | low → refactor | trend via churn × complexity (hotspots) |
| File length | > 500 lines → split | `awk 'END{print NR}' <file>` |
| Function length | > ~50 lines → extract | scan + judgement |
| Nesting depth | ≥ 4 → guard clauses | grep indentation / `max-depth` rule |
| Duplicate block | > 6 lines repeated | `jscpd`, or `eslint-plugin-sonarjs` `no-duplicate-string` |

### 4. Question existence (before improving)
For every major module/feature ask: does it align with stated purpose? Is it reachable
from an entry point? Could it be a separate package? Was it fully finished? Apply
**KISS/DRY/YAGNI**: is an abstraction earning its keep (≥2 real call sites, real
variation), or is it speculative generality? **Never default to "refactor to be better" —
first ask "should this exist at all?"** A delete beats the cleanest refactor.

### 5. Classify into tiers (never mix)

| Tier | What it is | Examples | Effort |
|---|---|---|---|
| **T1** Safe deletes | Dead code, unused files/exports, abandoned experiments | Orphaned `*_v2.ts`, unused export, commented-out blocks | Minutes |
| **T2** Quick fixes | Isolated, no architectural impact | Add missing error handling, remove stale TODO, fix lint warning, drop `console.log`, kill an `as any` | Hours |
| **T3** Focused refactors | Targeted module improvements via named patterns | Split a god service, consolidate duplicated logic, guard-clause a deep nest, lookup-table an if/elif chain | Days |
| **T4** Architectural / schema | Structural or destructive | Break an import cycle, change a layer boundary, drop a column/table (needs backfill + migration) | Weeks |

For T3 work, apply the named catalog in `references/refactoring-patterns.md` (Extract
Function, Guard Clauses, Lookup Table, Extract Magic Number, Collapse Duplication, etc.)
rather than ad-hoc restructuring — named patterns are reviewable and reversible.

### 6. Negotiate scope with the owner
Present findings before changing anything: "N things I can safely delete now — proceed?",
"These features look outside the package's purpose — keep which?", "These T3/T4 items need
your call on direction." **Never assume what the owner values.**

### 7. Execute safe→dangerous, in a worktree
T1 → T2 → T3 → T4. Group related low-risk changes for one package into a coherent batch,
then rerun the touched package's relevant lint/test/build checks. Check at every tier
boundary, before any destructive step, and immediately after a failure—not mechanically
after each one-line deletion. Commit each verified batch; do not create a commit for every
individual edit. T4/destructive-migration work belongs on its own branch and must follow
`verify-production-release` (a stale root `bun.lock` or an unrun backfill will break/lose prod
data).

## Red flags — you're doing it wrong
- You're writing more code than you're deleting
- You're creating new files or adding an abstraction during a *cleanup*
- You flagged something as dead/complex/duplicated **without a tool output or grep count** behind it
- You're refactoring a module you haven't first asked "should this exist?"
- Your plan has 5+ phases spanning weeks (start with T1, reassess)
- You haven't verified the build passes, or haven't asked the owner what to keep

## See also
- `bun run worktree:new` — mandatory for any mutating work (see `CLAUDE.md`)
- `verify-production-release` skill — before any destructive migration reaches main
- `references/audit-signals.md` — full per-dimension scan/grep/metric catalogue for this monorepo
- `references/refactoring-patterns.md` — named T3 refactoring patterns with before/after
