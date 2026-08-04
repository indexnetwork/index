# Surface discovery-ab in eval-ops — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `discovery-ab` becomes a fifth harness on the eval-ops site: pick it, set env configuration per side, launch, and read the comparison — the thing the four scorecard harnesses cannot do because they read none of these flags.

**Architecture:** The engine already exists and has run live (IND-627, IND-626). This plan wires it to the site: a registry entry whose script lives in `services/api`, a `RunSpec` that carries per-side env configuration, an executor step with its own cwd and server-held credentials, a launch form that swaps model editors for env editors, and a run view that renders the pair from the artifact.

**Tech Stack:** Bun, TypeScript, zod, React 19 + Vite (no compiler — manual `useCallback`/`useMemo`), bun:test (protocol/ops) and vitest (app).

**Evidence this is built against:** a real artifact from the first live run, `services/api/eval/discovery-ab/runs/2026-08-04T18-17-55-461Z.json`:
- `artifactType: index-eval/run-report`, `harness: discovery-ab`, `harnessVersion: 1`
- `payload.rules` = `[{rule:"a",caseCount:1,passRate:1},{rule:"b",caseCount:1,passRate:1}]`
- every `payload.cases[]` row carries `caseId` (`<case>/<side>/r<n>`), `rule` (the side), `runs`, `passes`, `passRate`, `flaky`, **`configDeltas`**, plus `assertions`, `candidates`, `rawCandidates`, `evaluatorTraces`, `evidenceTypes`, `judge`, `targetRank`, `repetition`, `rowId`
- **no** top-level `configs`/`configDiff` — deliberate; the governed schemas are `.strict()`

## Global Constraints

- **Nine offerable flags only**, from `services/api/src/cli/discovery-ab.flags.ts` (`AB_FLAGS`). Never the seven the graph cannot reach.
- **Both sides must declare the same key set**, ordered `['a','b']`, with at least one differing value — mirror `buildAbPlan`'s rules client-side; the server refuses regardless.
- **Credentials never leave the server.** `NEON_API_KEY` and `DISCOVERY_AB_TARGETS` come from the ops server's environment. A browser must never send or receive them.
- **One discovery-ab run at a time** — `eval-ab-a`/`eval-ab-b` are a shared resource; a second concurrent run would corrupt both.
- **No baseline** for this harness: never compare, never write one.
- Site tests are **vitest**: `cd apps/eval-ops && bun run test`. Ops tests are **bun:test**: `cd packages/protocol && bun test eval/ops/tests/`.
- Copy must be grounded in code, not invented.

---

## File Structure

| File | Responsibility |
|---|---|
| `services/api/src/cli/discovery-ab.main.ts` *(modify)* | accept `--report <path>` so the artifact can land in the site's run directory |
| `packages/protocol/eval/ops/ops.registry.ts` *(modify)* | add the `discovery-ab` entry: script, cwd, caseCount, flags |
| `packages/protocol/eval/ops/ops.types.ts` *(modify)* | `OpsHarness` gains `"discovery-ab"` |
| `packages/protocol/eval/ops/ops.argv.ts` *(modify)* | `RunSpec.sides` (required iff discovery-ab, forbidden otherwise) → argv |
| `packages/protocol/eval/ops/ops.executor.ts` *(modify)* | per-step cwd for the run step |
| `packages/protocol/eval/ops/ops.queue.ts` *(modify)* | serialize discovery-ab runs |
| `packages/protocol/eval/ops/ops.server.ts` *(modify)* | inject server-held credentials into the run's env |
| `apps/eval-ops/src/components/SideEnvEditor.tsx` | per-side env configuration editor |
| `apps/eval-ops/src/routes/Launch.tsx` *(modify)* | branch on discovery-ab |
| `apps/eval-ops/src/routes/Run.tsx` *(modify)* | render the pair |

---

### Task 1: `--report <path>` on the engine

The site stores every launched run at `<evalDir>/.ops-runs/<id>/report.json` (`ops.store.ts:167`). The engine writes to `services/api/eval/discovery-ab/runs/<timestamp>.json`, which the site cannot see.

**Files:** `services/api/src/cli/discovery-ab.main.ts`, test `services/api/src/cli/tests/discovery-ab.parent.spec.ts`

**Interfaces:**
- Consumes: existing `parseAbRunArgs`.
- Produces: `--report <path>` parsed into the run args; when absent, today's timestamped path is unchanged.

- [ ] **Step 1: Write the failing test** — `parseAbRunArgs(['--report','/tmp/x.json'])` yields that path; absent, it yields undefined; `--report` without a value is refused naming the flag; a relative path is accepted and resolved against cwd.
- [ ] **Step 2: Run it, watch it fail.** `cd services/api && bun test src/cli/tests/discovery-ab.parent.spec.ts`
- [ ] **Step 3: Implement.** Thread the parsed path into the existing `assertEvalWritePlan` + `writeRunReport` call so the write plan still guards overwrites (`--force` keeps its meaning).
- [ ] **Step 4: Tests green**, plus `bunx tsc --noEmit`.
- [ ] **Step 5: Update `--help`** — the contract text must list `--report`, since it now exists. Keep the exit-code table intact.
- [ ] **Step 6: Commit** — `feat(eval): let a discovery A/B run name its artifact path`

---

### Task 2: Registry entry and harness type

**Files:** `packages/protocol/eval/ops/ops.types.ts`, `ops.registry.ts`, tests `registry.spec.ts`, `registry-corpus.spec.ts`

**Interfaces:**
- Produces: `OPS_HARNESSES` includes `"discovery-ab"`; `HARNESS_REGISTRY["discovery-ab"]` with `script: "eval:discovery-ab"`, **`cwd: "services/api"`**, `caseCount` from the real corpus, `defaultRuns: 3`, flags `[runs, case]` only, and `question`/`detail` grounded in the engine's own `--help` text.
- The registry's other entries gain no `cwd` (they default to the protocol package) — add the field as optional.

- [ ] **Step 1: Extend `registry-corpus.spec.ts`** to pin discovery-ab's `caseCount` by importing `HISTORICAL_MATRIX_CASES` from `packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.js`, exactly as the four scorecard harnesses pin theirs. This is the spend-confirmation number; it must not be hand-typed.
- [ ] **Step 2: Run it, watch it fail** (5 expected vs missing entry).
- [ ] **Step 3: Implement** the type and registry entry. Flags are only `runs` and `case`: the engine accepts `--case`, `--runs`, `--a`, `--b`, `--force` and nothing else, so offering `tier`/`rule`/`noJudge`/`alpha`/`strictEvidence` here would be fiction.
- [ ] **Step 4: Run the whole ops suite** — `cd packages/protocol && bun test eval/ops/tests/` — and fix whatever the new harness breaks. Expect `ops.artifacts.ts` to scan a `discovery-ab` directory that does not exist under `packages/protocol/eval`; make that absence non-fatal rather than inventing a directory.
- [ ] **Step 5: Commit** — `feat(eval-ops): register discovery-ab as a harness whose script lives in services/api`

---

### Task 3: RunSpec carries per-side configuration

**Files:** `packages/protocol/eval/ops/ops.argv.ts`, tests `packages/protocol/eval/ops/tests/argv.spec.ts`

**Interfaces:**
- Produces: `RunSpec.sides?: { a: Record<string,string>; b: Record<string,string> }`, and `buildArgv` emitting `--a KEY=VALUE` / `--b KEY=VALUE` pairs plus `--case`/`--runs`.

- [ ] **Step 1: Write the failing tests.** A discovery-ab spec without `sides` is refused; a non-discovery-ab spec *with* `sides` is refused; a key outside `AB_FLAGS` is refused naming it; asymmetric key sets are refused naming the key and side; identical configurations are refused; a valid pair produces argv in a stable order with `--a`/`--b` pairs and the shared `--case`/`--runs`.
- [ ] **Step 2: Run them, watch them fail.**
- [ ] **Step 3: Implement.** Import `AB_FLAGS` — do not retype the nine. Mirror `buildAbPlan`'s symmetry and distinctness rules so the refusal happens before a run is queued rather than 20 seconds into a child process.
- [ ] **Step 4: Tests green** + `bunx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(eval-ops): carry two env configurations in a run spec`

---

### Task 4: Execution — per-step cwd, server-held credentials, one at a time

**Files:** `ops.executor.ts`, `ops.queue.ts`, `ops.server.ts`, tests `executor.spec.ts`, `queue.spec.ts`, `server.spec.ts`

**Interfaces:**
- Produces: the run step carries `cwd` from the registry entry; the ops server injects `NEON_API_KEY`, `DISCOVERY_AB_TARGETS`, `DISCOVERY_AB_CONFIRM=1`, `TEST_DATABASE_SAFE=1` from its own environment; the queue admits at most one in-flight discovery-ab run.

- [ ] **Step 1: Write the failing tests.**
  - executor: a step's `cwd` is honoured (not the constructor's).
  - server: a launched discovery-ab run receives the four env values from the server environment, and **none of them ever appear in a response body, a run record, or a log line** — assert on an actual serialized record, not on intent.
  - server: when `NEON_API_KEY` or `DISCOVERY_AB_TARGETS` is absent from the server environment, launching discovery-ab is refused with a message naming what the operator must configure — rather than spawning a child that dies at the gate.
  - queue: a second discovery-ab launch while one is in flight is refused (or queued, if that is what you implement — pick one and test it), while a scorecard run alongside it is unaffected.
- [ ] **Step 2: Run them, watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Whole ops suite green.**
- [ ] **Step 5: Commit** — `feat(eval-ops): run discovery-ab with its own cwd, server-held credentials and a single slot`

---

### Task 5: Launch form — env configuration per side

**Files:** `apps/eval-ops/src/components/SideEnvEditor.tsx`, `apps/eval-ops/src/routes/Launch.tsx`, `apps/eval-ops/src/api/client.ts`, tests `apps/eval-ops/tests/launch.test.tsx`

**Interfaces:**
- Consumes: `configMetadata()` already serves `ENV_FLAG_METADATA` (label, description, kind, values, defaultDescription) — reuse it; the nine come from the registry's flag list plus `AB_FLAGS` exposed through the metadata endpoint.
- Produces: `SideEnvEditor` (add/remove a flag row, value control typed by the flag's kind), and a Launch page that branches on `harness === 'discovery-ab'`.

- [ ] **Step 1: Write the failing tests.**
  - selecting discovery-ab replaces the per-agent model editors with env editors on both sides, and the A/B toggle is on and cannot be turned off (it is not optional for this harness)
  - the scoring flags that do not exist for this harness (judge, alpha, strict evidence, tier, rule) are absent
  - adding a flag to one side adds the same key to the other, because asymmetric configurations are refused — the form must not let you build one
  - identical configurations disable the launch button with a reason
  - the workload line reads `5 cases × 3 runs × 2 sides = 30`
  - launching posts `sides: {a:{…}, b:{…}}` and no `overrides`
  - switching back to a scorecard harness restores the model editors and drops `sides`
- [ ] **Step 2: Run them, watch them fail.**
- [ ] **Step 3: Implement.** No new keyboard handlers; mouse-first. Failure text uses `text-term-red`; running/links use cyan. Manual `useCallback`/`useMemo` — there is no React compiler here.
- [ ] **Step 4: `cd apps/eval-ops && bun run test`** green, `bunx tsc --noEmit`, `bun run build`.
- [ ] **Step 5: Prove a test bites** — remove the symmetric-key enforcement and watch the corresponding test fail; restore.
- [ ] **Step 6: Commit** — `feat(eval-ops): configure both discovery strategies from the launch form`

---

### Task 6: Run view — render the pair

**Files:** `apps/eval-ops/src/routes/Run.tsx` (and a small presenter if it grows), tests `apps/eval-ops/tests/run.test.tsx`

**Interfaces:**
- Consumes: the artifact shape pinned above. Build fixtures **from the real artifact**, not from imagination — copy a trimmed real payload into the test.

- [ ] **Step 1: Write the failing tests.**
  - both rules render with their pass rates, labelled A/reference and B/candidate
  - the configuration difference is shown, derived from the two sides' `configDeltas` (the artifact has no top-level rollup — deriving it is the point)
  - a case that differs between sides is visually distinguishable from one that agrees
  - `completeness.complete === false` renders "no verdict" rather than a comparison
  - a flaky case is marked
- [ ] **Step 2: Run them, watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: App tests green**, `tsc`, `build`.
- [ ] **Step 5: Commit** — `feat(eval-ops): read a discovery A/B comparison`

---

### Task 7: Deploy and prove it end to end

**Files:** versions, `bun.lock`, docs.

- [ ] **Step 1: Bump** `packages/protocol`, `services/api` and `apps/eval-ops` per SemVer; sync `bun.lock` by hand (2-line edits); `bun install --frozen-lockfile` clean.
- [ ] **Step 2: Full gates** — ops suite, app suite, `eval:verify`, `tsc`, lint, both packages.
- [ ] **Step 3: Document** the harness in `docs/guides/development-reference.md` beside the CLI entry: that the site can launch it, what the server must have configured, and that runs are serialized.
- [ ] **Step 4: Set the Railway variables** on the eval-ops service (`NEON_API_KEY`, `DISCOVERY_AB_TARGETS`, `DISCOVERY_AB_CONFIRM=1`, `TEST_DATABASE_SAFE=1`) so the deployed Launch button works rather than refusing.
- [ ] **Step 5: PR, checks green, merge, deploy, and confirm on the live site** that discovery-ab appears, the env editors render, and a 1-case × 1-run launch completes and displays.

## Self-Review

**Spec coverage.** Fifth harness in the dropdown → Tasks 2, 5. Env config per side → Tasks 3, 5. Shared selection → Task 3 (`--case`/`--runs`), Task 5 (workload line). Results → Tasks 1, 6. Credentials and serialization → Task 4. Live proof → Task 7.

**Placeholder scan.** Task 4 leaves refuse-vs-queue to the implementer *and requires the choice to be tested* — deliberate, since both are defensible. Everything else names exact files, flags and assertions.

**Type consistency.** `sides` is the single name for per-side configuration across Tasks 3, 4 and 5. `AB_FLAGS` is imported everywhere, never retyped. `cwd` is the registry field consumed by the executor in Task 4.
