# Audit signals — index monorepo

Scan catalogue for step 3 of `cleaning-up-codebases`. Run these from a worktree (or
read-only against the root). Always **grep for all usages before flagging anything as
dead**, and produce concrete counts.

## Dead code

```bash
# Files nothing imports (orphans). Adjust <pkg>/src as needed.
comm -23 \
  <(git ls-files '<pkg>/src/**/*.ts' '<pkg>/src/**/*.tsx' | sort) \
  <(grep -rhoE "from ['\"][^'\"]+['\"]" <pkg>/src | sed -E "s/.*from ['\"]//; s/['\"].*//" | sort -u)

# Alternate / abandoned implementations
git ls-files | grep -iE '(_v[0-9]|_old|_new|_copy|\.bak|deprecated|legacy)'

# Commented-out code blocks (TS/TSX)
grep -rnE '^\s*//\s*(import|export|const|function|class|return|await|if|for)\b' <pkg>/src

# Coming-soon / placeholder stubs
grep -rniE 'coming soon|not implemented|placeholder|stub|wip' <pkg>/src
```

**Unused exports** (no knip in this repo yet). Either:
- Add `knip` ad-hoc: `bunx knip --workspace <pkg>` (don't commit config unless asked), or
- Manual: for each `export`, grep the symbol across `backend frontend packages` — a symbol
  exported but referenced only at its definition is dead. The eslint config
  (`no-unused-vars`) already flags unused *locals*, not unused exports.

## Code quality

```bash
grep -rnE 'TODO|FIXME|HACK|XXX' <pkg>/src              # count, triage stale ones (T2)
grep -rn 'console\.log' <pkg>/src                       # leftover debug (T2)
grep -rnE 'catch\s*\([^)]*\)\s*\{\s*\}' <pkg>/src       # empty catch — swallowed errors (T2)
grep -rn ': any\b\|as any\b' <pkg>/src                  # eslint bans no-explicit-any; these are escapes
grep -rn '@ts-ignore\|@ts-expect-error\|eslint-disable' <pkg>/src  # suppressed checks — why?
awk 'END{print NR}' <file>                              # files >500 lines = god-file smell
```

Run the toolchain and record numbers:
- `bun run lint` (root `eslint .`) or `cd <pkg> && eslint src/`
- `cd backend && bun test [path]` (targeted; full suite is slow)
- `bun run build:<pkg>`

A baseline that doesn't lint/test/build clean is **finding #1** — fix it before cleanup.

## Architecture drift (this repo enforces layers)

`eslint-plugin-boundaries` already enforces Controllers → Services → Adapters and the
self-contained `packages/protocol`. When auditing, confirm by grep and treat violations
as real findings:

```bash
# Controllers importing adapters (forbidden)
grep -rn "adapters/" backend/src/controllers
# Services importing other services (forbidden — use events/queues)
grep -rn "services/" backend/src/services
# protocol importing app code (forbidden — must be injected)
grep -rnE "from ['\"].*(backend|frontend)" packages/protocol/src
```

Macro checks: does the directory layout still match
`.rpiv/guidance/**/architecture.md`? Are there overlapping-responsibility modules? Stale
config (CI steps `allow_failure`, disabled lint rules, dead tools in `package.json`)?

## Stack-specific smells

- **TypeScript:** `any`/`as any`, non-null `!` abuse, manual types where Drizzle inference
  exists, imports from `lib/schema` instead of `src/schemas/database.schema.ts`.
- **React (frontend):** unused props, `useEffect` with missing deps (eslint
  `react-hooks`), dead lazy-loaded routes in `src/app/`, components nothing renders.
- **Drizzle / schema:** columns/tables with no read or write path. **Removing one is T4** —
  it needs a generated+renamed migration, `_journal.json` tag update, and per
  `release-prod-safety` an operational backfill before any `DROP` reaches prod. Prefer
  soft delete (`deletedAt`) per repo convention; never hard-delete casually.
- **Generated artifacts:** never hand-edit `packages/claude-plugin/skills/**/SKILL.md` —
  edit the protocol templates and run `bun run build:skills`. Flag hand-edits as drift.

## Scope creep

```bash
git log --oneline -30 -- <pkg>            # what's actually active vs. abandoned
cat <pkg>/package.json                    # deps pulled in for a single non-core feature?
```

Ask per module: aligned with the package's stated purpose? Reachable from an entry point
(`backend/src/main.ts`, frontend routes, CLI `main.ts`)? Could it be its own package?
Fully finished, or a half-built feature to remove unless the owner wants it completed?
