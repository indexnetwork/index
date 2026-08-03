# Eval-Ops Guided Configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the eval-ops site speak plain English: config-first Launch form with per-agent model dropdowns, guided env-flag editing with validated values, honesty notes about live-pipeline flags, and a plain-English Harness page summary.

**Architecture:** A new dependency-free metadata module in `packages/protocol/eval/ops/ops.metadata.ts` is the single source of truth (env-flag descriptions/kinds/values, per-harness agent roles, model blurbs), consumed by the server (validation + `GET /api/configs/metadata`) and the Vite client (guided editors). Server gains env-value validation at config save and ad-hoc launch. Client gains two shared components (`GuidedEnvEditor`, `ModelOverrideEditor`) used by Launch, A/B, and Configs.

**Tech Stack:** Bun, React 19 + vite-plugin-react (NO compiler — manual memoization), vitest (app tests — **always `bun run test` in apps/eval-ops, never `bun test`**), `bun test eval/ops/tests/` (ops), Zod, Wouter.

**Spec:** `docs/superpowers/specs/2026-08-02-eval-ops-guided-configuration-design.md` — read it first. The grounding finding (§Grounding) is the design's spine: never present env flags as harness-relevant.

---

## File structure

**Create:**
- `packages/protocol/eval/ops/ops.metadata.ts` — metadata module (dependency-free)
- `packages/protocol/eval/ops/tests/metadata.spec.ts` — metadata + drift-guard tests
- `apps/eval-ops/src/components/GuidedEnvEditor.tsx` — guided env-flag rows
- `apps/eval-ops/src/components/ModelOverrideEditor.tsx` — per-agent model dropdowns
- `apps/eval-ops/tests/guided-env-editor.test.tsx`, `model-override-editor.test.tsx`

**Modify:**
- `packages/protocol/eval/ops/ops.profiles.ts` — re-export metadata; `validateProfileEnv()`
- `packages/protocol/eval/ops/ops.server.ts` — apply env validation on create/update; metadata payload builder
- `packages/protocol/eval/ops/ops.routes.ts` — `GET /api/configs/metadata`; ad-hoc launch env validation (400)
- `packages/protocol/eval/ops/tests/configs.spec.ts` — endpoint + validation tests
- `packages/protocol/eval/ops/tests/routes.spec.ts` — launch-with-invalid-env 400 test
- `apps/eval-ops/src/api.ts` — `ConfigMetadata` types + `configMetadata()` fetch
- `apps/eval-ops/src/routes/Launch.tsx` — restructure per spec §5
- `apps/eval-ops/src/routes/Harness.tsx` — plain-English summary per spec §6
- `apps/eval-ops/src/routes/Configs.tsx` — guided editors per spec §7
- `apps/eval-ops/tests/launch.test.tsx`, `harness.test.tsx`, `configs.test.tsx` — update
- `apps/eval-ops/src/styles.css` — disclosure/field-help styles if needed
- version bumps: `packages/protocol/package.json` 8.6.1→8.7.0, `apps/eval-ops/package.json` 0.2.0→0.3.0, `bun.lock`

**Delete:**
- `apps/eval-ops/src/components/OverridesEditor.tsx` (replaced by the two guided components; check imports first)

---

## Task 1: Configuration metadata module

**Files:**
- Create: `packages/protocol/eval/ops/ops.metadata.ts`
- Test: `packages/protocol/eval/ops/tests/metadata.spec.ts`
- Modify: `packages/protocol/eval/ops/ops.profiles.ts` (add re-export line only)

- [ ] **Step 1: Write the failing test** (`metadata.spec.ts`):
  - every `PROFILE_ENV_ALLOWLIST` key has exactly one `ENV_FLAG_METADATA` entry and vice versa (drift guard)
  - every `MODEL_METADATA` id is in `ALLOWED_CONFIG_MODELS` and vice versa
  - `HARNESS_AGENT_METADATA` keys are exactly the four harness ids from `EVAL_OPS_HARNESSES`; every listed agent id appears in that harness's registry `agents` field; premise lists decomposer before analyzer
  - every enum-typed flag has non-empty `values`; every entry has non-empty label/description/blurb (copy-honesty floor)
  - import the module from a plain client-style import path (`../ops.metadata.js`) and assert it has no node built-in imports (static check: read the source file, assert no `node:` / `fs` / `crypto` import specifiers)
- [ ] **Step 2:** `cd packages/protocol && bun test eval/ops/tests/metadata.spec.ts` → FAIL (module missing)
- [ ] **Step 3: Write `ops.metadata.ts`.** Contract (from spec §1): `EnvFlagMeta`, `AgentMeta`, `ModelMeta` interfaces; `ENV_FLAG_METADATA` (16 entries, allowlist order), `HARNESS_AGENT_METADATA` (matching→opportunityEvaluator; opportunity→opportunityPresenter; profile→profileGenerator; premise→premiseDecomposer, premiseAnalyzer), `MODEL_METADATA` (the 6 allowed models). Kinds/values per the spec table (mirrors `services/api/src/startup.env.ts`; `DISCOVERY_REJECTION_COOLDOWN_DAYS` is kind `number`, days, default 7, read in `opportunity.graph.ts`).
  **Copy grounding (hard requirement — every description/role/blurb must be traceable to code):**
  - env flags: read the docblocks in `packages/protocol/src/opportunity/discovery.env.ts`, `opportunity/outcome/outcome.env.ts`, `opportunity/discriminator/discriminator.env.ts`, `opportunity/negotiation-evidence/negotiation-evidence.env.ts`, and the flag's use site in `opportunity/application/opportunity.graph.ts` / `negotiation/` — descriptions say what the flag changes in the live pipeline, one or two sentences, and end with the default (e.g. "Default: off").
  - agents: ground in the class docblocks — `OpportunityEvaluator` (src/opportunity/application/opportunity.evaluator.ts), `OpportunityPresenter`, `EnrichmentGenerator` (profileGenerator), `PremiseDecomposer`, `PremiseAnalyzer`. Roles like: Evaluator — "Decides accept or reject for each candidate pair; the case score is this model's judgment."
  - models: neutral factual blurbs only ("Current default for most agents — fast and inexpensive", "Cheapest option — good for smoke runs"). No benchmark claims.
  - boolean-kind flags: values `["true","false"]` rendered as a select client-side; `DISCOVERY_CONTEXT_TO_INTENT` is enum `["0","1"]`.
- [ ] **Step 4:** test → PASS
- [ ] **Step 5:** add to `ops.profiles.ts` near the allowlist re-export: `export { ENV_FLAG_METADATA, HARNESS_AGENT_METADATA, MODEL_METADATA } from "./ops.metadata.js"; export type { AgentMeta, EnvFlagMeta, ModelMeta } from "./ops.metadata.js";` — verify `bunx tsc --noEmit` clean
- [ ] **Step 6:** commit `feat(ops): configuration metadata module for guided editing`

## Task 2: Env value validation

**Files:**
- Modify: `packages/protocol/eval/ops/ops.profiles.ts` (add `validateProfileEnv`)
- Modify: `packages/protocol/eval/ops/ops.server.ts` (validate in create/update handlers)
- Modify: `packages/protocol/eval/ops/ops.routes.ts` (validate ad-hoc launch overrides)
- Test: `packages/protocol/eval/ops/tests/configs.spec.ts`, `tests/routes.spec.ts`

- [ ] **Step 1: Failing tests first:**
  - configs.spec: POST `/api/configs` with `env: {POOL_QUESTIONS_MODE: "banana"}` → 400, body names the key and valid values (`off`, `on`); with `{NEGOTIATION_MAX_TURNS_CHAT: "lots"}` → 400 (integer expected); valid values still save (201). PATCH same coverage.
  - routes.spec: POST `/api/harness/matching/runs` with ad-hoc override env `{POOL_QUESTIONS_MODE: "banana"}` → 400 naming key + values.
- [ ] **Step 2:** run → FAIL (currently accepted)
- [ ] **Step 3: Implement `validateProfileEnv(env: Record<string, string>): void`** in ops.profiles.ts: allowlist check (existing error type/message) then per-key kind check from `ENV_FLAG_METADATA` — enum: membership in `values`; boolean: `"true"|"false"`; integer: `/^-?\d+$/`; number: `Number.isFinite(Number(v)) && Number(v) > 0` where the flag is positive-only (REJECTION_COOLDOWN); string: any. Throws `ConfigValidationError` naming key, received value, and expected values/kind. Wire: server create/update call it after `validateProfileModels`; routes ad-hoc validation calls it on merged override env. Repo-shipped profiles: do NOT validate at boot (exemption preserved).
- [ ] **Step 4:** tests → PASS; `bun test eval/ops/tests/` fully green
- [ ] **Step 5:** commit `feat(ops): validate env override values against flag schemas`

## Task 3: Metadata endpoint

**Files:**
- Modify: `packages/protocol/eval/ops/ops.routes.ts` (+ `ops.server.ts` if a payload builder belongs there)
- Test: `packages/protocol/eval/ops/tests/configs.spec.ts`

- [ ] **Step 1: Failing test:** GET `/api/configs/metadata` → 200, `cache-control: no-store`, body `{env, models, harnessAgents}`; `env.length === PROFILE_ENV_ALLOWLIST.length`; `harnessAgents` keys ⊇ four harness ids.
- [ ] **Step 2:** run → 404 FAIL
- [ ] **Step 3:** implement — static payload from `ops.metadata.ts`, no DB, placed before the `/api/configs/:name` matcher so `metadata` isn't captured as a name.
- [ ] **Step 4:** tests → PASS
- [ ] **Step 5:** commit `feat(ops): GET /api/configs/metadata`

## Task 4: Guided editor components + API client

**Files:**
- Modify: `apps/eval-ops/src/api.ts`
- Create: `apps/eval-ops/src/components/GuidedEnvEditor.tsx`, `ModelOverrideEditor.tsx`
- Test: `apps/eval-ops/tests/guided-env-editor.test.tsx`, `model-override-editor.test.tsx`

- [ ] **Step 1:** `api.ts`: `EnvFlagMeta`/`AgentMeta`/`ModelMeta` type mirrors (type-only, matching server shapes), `ConfigMetadata` interface, `configMetadata(): Promise<ConfigMetadata>` via `fetchJson` on `/api/configs/metadata`.
- [ ] **Step 2: Failing component tests** (follow existing test style — see `apps/eval-ops/tests/run.test.tsx` for the render/flush pattern):
  - GuidedEnvEditor: renders a key `<select>` with all 16 labels; selecting a key shows its description; enum keys render a value `<select>` with exactly the valid values; integer keys render a number input; already-used keys are absent from other rows' dropdowns; removing a row calls back; value change calls back with `{key, value, reason}`.
  - ModelOverrideEditor: given agents `[{id, label, role}]` + available models + defaults, renders one row per agent with role text; default option reads "profile default (gemini-2.5-flash)"; changing a select calls back with the models map (`undefined` when default chosen).
- [ ] **Step 3:** `cd apps/eval-ops && bun run test` → FAIL
- [ ] **Step 4: Implement both components.** Props:
  - `GuidedEnvEditor({ flags: EnvFlagMeta[], rows: EnvOverrideRow[], onChange(rows) })` where `EnvOverrideRow = {key, value, reason}`; rows always at least one; "Add flag override" button; per-row remove; invalid value (client-side kind check) marks the row and surfaces `invalid` flag upward via onChange payload or a second callback — parent disables submit.
  - `ModelOverrideEditor({ agents: AgentMeta[], models: ModelMeta[], profileDefaults: Record<string,string>, value: Record<string, ModelOverride|undefined>, onChange })`.
  - React 19 rules from AGENTS.md: no compiler — explicit `useCallback`/`useMemo` for stable props; no new keyboard handlers; WCAG AA (reuse existing `.field`/`.field-help` palette; add `.field-help` color only if ≥4.5:1 on `--bg-panel`).
- [ ] **Step 5:** tests → PASS
- [ ] **Step 6:** commit `feat(app): guided env and model override editors`

## Task 5: Launch page restructure

**Files:**
- Modify: `apps/eval-ops/src/routes/Launch.tsx`
- Test: `apps/eval-ops/tests/launch.test.tsx`

- [ ] **Step 1: Update failing tests:** assert the new structure — "What controls this run" section present with per-agent model selects for the harness's agents only (matching page shows Evaluator, not Card writer); runs/seed/cases inside a collapsed `<details>` (not visible by default); env editor inside a second `<details>` containing the honesty note ("does not read them"); invalid env row disables launch; A/B mode renders per-side model editors and keeps shared runs/seed/baseline.
- [ ] **Step 2:** `bun run test` → FAIL
- [ ] **Step 3: Implement per spec §5.** Data: `configMetadata()` + `configs()` on mount (non-blocking catch like existing harnesses fetch). Baseline select labels: "Committed baseline", "No comparison", "A previous run…". Field copy from spec §4. Remember the lesson from PR #1318: **compute derived values before `setState`, never throw inside updaters**; all fetches non-blocking with `.catch(() => {})` fallback to metadata-free rendering (raw env text inputs are NOT a fallback — degrade by hiding the env section instead).
- [ ] **Step 4:** tests → PASS
- [ ] **Step 5:** commit `feat(app): config-first launch form with guided overrides`

## Task 6: Harness page plain-English summary

**Files:**
- Modify: `apps/eval-ops/src/routes/Harness.tsx`
- Test: `apps/eval-ops/tests/harness.test.tsx`

- [ ] **Step 1: Update tests:** summary sentence rendered from `harness.baseline` — e.g. `Compared against the committed baseline, under profile "dev-premise".` / `No comparison; runs cases only, under profile "default".`; the raw `bun run …` command exists but inside a collapsed `<details>`; "Baseline comparison" section header gone.
- [ ] **Step 2:** FAIL → **Step 3: implement** (derive the sentence from the same `harness.baseline.{reference,profile}` fields the command used; mapping: baseline→"the committed baseline", none→"no comparison", run:N→`saved run #N`) → **Step 4:** PASS
- [ ] **Step 5:** commit `feat(app): plain-English baseline summary on harness page`

## Task 7: Configs page guided editors + cleanup

**Files:**
- Modify: `apps/eval-ops/src/routes/Configs.tsx`
- Delete: `apps/eval-ops/src/components/OverridesEditor.tsx` (after all importers migrated)
- Test: `apps/eval-ops/tests/configs.test.tsx`

- [ ] **Step 1: Update tests:** create/edit panel renders guided env dropdowns and per-agent model rows; duplicate-key impossible via UI (key absent from dropdown once used); save blocked while a row is invalid.
- [ ] **Step 2:** FAIL → **Step 3: implement** — swap editors in, delete `OverridesEditor.tsx`, `rg OverridesEditor` returns nothing → **Step 4:** PASS
- [ ] **Step 5:** commit `feat(app): guided editors on configs page`

## Task 8: Versioning + final validation

- [ ] **Step 1:** bump `packages/protocol` 8.6.1→8.7.0 (new feature: metadata endpoint + validation), `apps/eval-ops` 0.2.0→0.3.0; run `bun install` at repo root; `git diff --exit-code bun.lock` after install must be clean post-commit
- [ ] **Step 2:** full gates: `cd apps/eval-ops && bun run test` · `cd packages/protocol && bun test eval/ops/tests/` · `bunx tsc --noEmit` in both · `bun run eval:verify` · `bunx eslint` on changed files
- [ ] **Step 3:** commit `chore: bump protocol 8.7.0, eval-ops 0.3.0`

## Self-review

- Coverage: spec §1→T1, §2→T3, §3→T2, §4→T4, §5→T5, §6→T6, §7→T7, acceptance #6→T8. ✔
- Type consistency: metadata types defined once server-side, mirrored type-only client-side (boundary rule preserved). ✔
- Honesty: no fake per-harness env relevance anywhere; env flags always under the live-pipeline note. ✔
- Placeholders: none — copy grounding is delegated with named source files per flag/agent. ✔
