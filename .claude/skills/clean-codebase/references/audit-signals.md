# Audit signals — index monorepo

Per-dimension scan catalogue for **step 3** of `clean-codebase`. Run from a worktree
(or read-only against the root). Always **grep for all usages before flagging anything as
dead**, and produce concrete counts. Dimensions map 1:1 to the D1–D7 table in `SKILL.md`;
for large packages, dispatch independent dimensions to parallel `Explore` agents.

---

## D1 — Dead code & reachability

```bash
# Reachability-aware orphan/unused-export scan (temporary; do not commit config unless asked).
# Review aliases, generated entry points, and dynamic imports before accepting a finding.
bunx knip --workspace <pkg>

# Alternate / abandoned implementations
git ls-files | grep -iE '(_v[0-9]|_old|_new|_copy|\.bak|deprecated|legacy)'

# Commented-out code blocks (TS/TSX)
grep -rnE '^\s*//\s*(import|export|const|function|class|return|await|if|for)\b' <pkg>/src

# Coming-soon / placeholder stubs
grep -rniE 'coming soon|not implemented|placeholder|stub|wip' <pkg>/src
```

**Unused exports:** Treat `knip` output as candidate evidence, not proof; resolve path
aliases, package exports, generated entry points, and dynamic imports. Confirm each candidate
by grepping the symbol across `services/api apps/web packages`. The eslint config
(`no-unused-vars`) already flags unused *locals*, not unused exports.

**Reachability:** trace from entry points (`services/api/src/main.ts`, web routes in
`src/app/`, CLI `main.ts`, protocol factory exports). A module reachable from none is a
removal candidate regardless of internal quality.

---

## D2 — Duplication & over-abstraction (DRY / KISS / YAGNI)

```bash
# Copy-paste detector — blocks >6 lines duplicated (no config committed unless asked)
bunx jscpd --min-lines 6 --reporters console <pkg>/src

# Repeated string literals used as keys/thresholds (heuristic; inspect before flagging)
grep -rhoE "'[^']{8,}'" <pkg>/src | sort | uniq -c | sort -rn | head -30
```

Manual over-abstraction smells (these are *additions* masquerading as quality):
- An abstraction (base class / generic / factory / wrapper) with **only one call site** —
  inline it (YAGNI).
- Indirection layers that only forward calls (`fooService.doX()` → `fooImpl.doX()`).
- Config/options objects where every caller passes the same values.
- Parallel near-identical implementations that should be one parameterised function.

**Rule:** an abstraction earns its place with ≥2 real call sites *and* real variation
between them. Otherwise it is speculative generality — flag for removal, not "improvement".

---

## D3 — Complexity & god-files

```bash
awk 'END{print NR}' <file>                              # files >500 lines = god-file smell
git ls-files '<pkg>/src/**/*.ts' | xargs wc -l | sort -rn | head -20   # biggest files
grep -rnE '^(\t| {8,})+\S' <pkg>/src | head             # deep indentation (4+ levels)
```

Measure rather than eyeballing. The repository does **not** currently configure ESLint's
`complexity` rule or `eslint-plugin-sonarjs`, so ordinary `bun run lint` does not produce
these metrics. Use temporary analysis tooling or a manual control-flow count and record the
method alongside any finding:
- cyclomatic complexity — flag ≥ 11;
- cognitive complexity — flag > 15 (readability proxy).
- Hotspots = high churn × high complexity. Find churn with
  `git log --format= --name-only -- <pkg>/src | sort | uniq -c | sort -rn | head`.

Thresholds (refactor candidates, triage — don't auto-edit): cyclomatic ≥11, cognitive >15,
file >500 lines, function >~50 lines, nesting ≥4. Fix with the patterns in
`references/refactoring-patterns.md`.

---

## D4 — Type & error hygiene

```bash
grep -rnE 'TODO|FIXME|HACK|XXX' <pkg>/src              # count, triage stale ones (T2)
grep -rn 'console\.log' <pkg>/src                       # leftover debug (T2)
grep -rnE 'catch\s*\([^)]*\)\s*\{\s*\}' <pkg>/src       # empty catch — swallowed errors (T2)
grep -rn ': any\b\|as any\b' <pkg>/src                  # eslint bans no-explicit-any; these are escapes
grep -rn '!\.' <pkg>/src                                # non-null assertion abuse
grep -rn '@ts-ignore\|@ts-expect-error\|eslint-disable' <pkg>/src  # suppressed checks — why?
```

Run the toolchain and record numbers:
- `bun run lint` (root `eslint .`) or `cd <pkg> && eslint src/`
- `cd services/api && bun test [path]` (targeted; full suite is slow)
- `bun run build:<pkg>`

A baseline that doesn't lint/test/build clean is **finding #1** — fix it before cleanup.

---

## D5 — Coupling & dependency topology (this repo enforces layers)

`eslint-plugin-boundaries` enforces Controllers → Services → Adapters and the
self-contained `packages/protocol`. Confirm by grep and treat violations as real findings:

```bash
# Controllers importing adapters (forbidden except the privileged MCP composition root)
rg -n "from ['\"].*adapters/" services/api/src/controllers -g '*.ts' -g '!mcp.controller.ts' -g '!**/tests/**'
# Services importing sibling services (forbidden — use events/queues); exclude tests
rg -n "from ['\"](?:\./|\.\./).*\.service(?:\.[jt]s)?['\"]" services/api/src/services -g '!**/tests/**'
# protocol importing app code (forbidden — must be injected)
rg -n "from ['\"].*(services/api|apps/web)" packages/protocol/src
```

Topology / coupling metrics (find the tangles, not just rule breaks):

```bash
# Fan-IN: which modules are imported the most (high Ca — risky to change)
grep -rhoE "from ['\"][^'\"]+['\"]" <pkg>/src | sed -E "s/.*from ['\"]//; s/['\"].*//" \
  | grep -E '^[./]' | sort | uniq -c | sort -rn | head -20

# Fan-OUT: which files import the most (high Ce — knows too much)
for f in $(git ls-files '<pkg>/src/**/*.ts'); do echo "$(grep -cE "^import|from ['\"]" "$f") $f"; done \
  | sort -rn | head -20

# Import cycles (madge is the cleanest read-only option)
bunx madge --circular --extensions ts,tsx <pkg>/src
```

Interpretation: a high-Ca + high-Ce module is **unstable and central** — the worst kind of
coupling; cycles are always a T4 finding. Cross-feature reach-ins (feature A importing deep
internals of feature B instead of its public surface) are coupling debt even when no lint
rule fires.

Macro checks: does the directory layout still match what `AGENTS.md` and the Development
Reference describe?
Overlapping-responsibility modules? Stale config (CI `allow_failure`, disabled lint rules,
dead tools in `package.json`)?

---

## D6 — Scope creep

```bash
git log --oneline -30 -- <pkg>            # what's actually active vs. abandoned
cat <pkg>/package.json                    # deps pulled in for a single non-core feature?
```

Ask per module: aligned with the package's stated purpose? Reachable from an entry point?
Could it be its own package? Fully finished, or a half-built feature to remove unless the
owner wants it completed?

---

## D7 — Schema & data lifecycle (stack-specific)

- **Drizzle / schema:** columns/tables with no read or write path. **Removing one is T4** —
  it needs a generated+renamed migration, `_journal.json` tag update, and per
  `verify-production-release` an operational backfill before any `DROP` reaches prod. Prefer
  soft delete (`deletedAt`) per repo convention; never hard-delete casually.
- **Canonical schema:** imports from `lib/schema` instead of
  `src/schemas/database.schema.ts`, or any parallel schema definition, are drift.
- **TypeScript:** manual types where Drizzle inference exists.
- **React (web app):** unused props, `useEffect` missing deps (eslint `react-hooks`), dead
  lazy-loaded routes in `src/app/`, components nothing renders.
- **Generated artifacts:** never hand-edit `packages/claude-plugin/skills/**/SKILL.md` —
  edit the protocol templates and run `bun run build:skills`. Flag hand-edits as drift.
