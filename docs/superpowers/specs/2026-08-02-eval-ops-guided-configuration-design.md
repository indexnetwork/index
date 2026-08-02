# Eval-Ops Guided Configuration — Design Spec

**Date:** 2026-08-02
**Status:** Approved (design + env-flag placement confirmed by user)
**Scope:** `apps/eval-ops` (browser app), `packages/protocol/eval/ops` (server)
**Prerequisite:** none (builds on merged #1318 config-management feature)

## Problem

The Launch and Harness pages speak CLI, not English:

1. `--runs`, `--seed`, `--cases` flag-style fields occupy prime space on the Launch form, while the controls that actually change outcomes (per-agent model selection) are a dense key/value table.
2. Env overrides are free-text key/value rows — no indication of which keys exist, what they do, or what values are valid. Typos only surface as a failed run.
3. The Harness page leads with a raw command line (`bun run eval:matching -- --profile dev-premise --reference baseline`).
4. Nothing explains what any value *means*. A user must already know the system to operate the site.

## Grounding finding (drives the design)

Code-level audit of what the four scorecard harnesses (`matching`, `profile`, `premise`, `opportunity`) actually read at run time:

- Each harness invokes its protocol agents directly (`OpportunityEvaluator`, `OpportunityPresenter`, `EnrichmentGenerator`, `PremiseDecomposer`/`PremiseAnalyzer`). Their code paths read **no** allowlisted env flag.
- All 16 `PROFILE_ENV_ALLOWLIST` flags are consumed by the **live discovery/negotiation/outcome pipeline** (`opportunity.graph.ts`, `discovery.env.ts`, `negotiation-evidence.env.ts`, `outcome.env.ts`) — which the scorecard harnesses never invoke. Even `PREMISE_DEDUP_SIMILARITY` is read only by `premise.graph.ts`, which the premise harness bypasses.
- Therefore the honest per-harness answer to "what affects this run's outcome" is: **the model assigned to each agent the harness exercises**, plus the runner knobs (runs, seed, case selection).

Consequence: env flags must be presented as *live-pipeline flags* with an explicit not-this-harness note. Per-harness "relevance" must never be faked.

## Goals

1. **Config-first Launch form.** Per harness, a "What controls this run" section leads: profile select, then one validated model dropdown per agent the harness exercises, each with a plain-English role description. Runs/seed/cases collapse into an "Advanced options" disclosure with plain-English explanations.
2. **Guided env editing.** Env override keys become a dropdown of the 16 allowed flags, each with a plain-English description; the value control adapts to the flag's real schema (enum dropdown, boolean, validated number) derived from `services/api/src/startup.env.ts`. Same editor on Launch, A/B, and the Configs page. Env overrides sit under an "Advanced: live-pipeline flags" disclosure with the honesty note.
3. **Plain-English Harness page.** The raw command becomes a one-line summary ("Compared against the committed baseline under profile dev-premise") with the command behind a collapsed detail.
4. **Server-side value validation.** Enum/number env values are validated at config save and at ad-hoc launch, returning readable 400s instead of failing mid-run.

## Non-goals

- No changes to the four harnesses, the runner, or profile resolution semantics.
- No new harnesses; the four-harness surface stays.
- No attempt to make the 16 flags affect the scorecard harnesses (that would be a protocol change; out of scope).
- The Runs list, Run detail progress view, compare, and pair pages are unchanged except where they already render profile/override data.

## Design

### 1. Server: configuration metadata module

New dependency-free module `packages/protocol/eval/ops/ops.metadata.ts` (same constraint as `ops.allowlist.ts` — importable by the Vite bundle, no node built-ins). It is the single source of truth for display+validation metadata, consumed by both the server (validation, API payload) and the client (rendering controls).

```ts
export interface EnvFlagMeta {
  key: string;                 // PROFILE_ENV_ALLOWLIST member
  label: string;               // plain-English name, e.g. "Pool question mining"
  description: string;         // what it changes, in one or two sentences
  kind: "enum" | "boolean" | "integer" | "number" | "string";
  values?: readonly string[];  // enum members, e.g. ["off", "shadow", "on"]
  defaultDescription: string;  // e.g. "off" / "server default"
}

export const ENV_FLAG_METADATA: readonly EnvFlagMeta[];  // all 16, allowlist order

export interface AgentMeta {
  id: string;                  // model.config.ts agent id
  label: string;               // "Evaluator", "Card writer", ...
  role: string;                // plain-English: what this agent decides/produces
}

export const HARNESS_AGENT_METADATA: Readonly<Record<HarnessId, readonly AgentMeta[]>>;
// matching → [opportunityEvaluator], opportunity → [opportunityPresenter],
// profile → [profileGenerator], premise → [premiseDecomposer, premiseAnalyzer]

export interface ModelMeta { id: string; label: string; blurb: string; }
export const MODEL_METADATA: readonly ModelMeta[];  // the 6 ALLOWED_CONFIG_MODELS
```

**Grounding requirements for copy:** every `description`/`role`/`blurb` must be traceable to the code (schema comments, module docblocks, observed behavior) — no plausible-sounding marketing. Enum `values` mirror the zod schemas in `services/api/src/startup.env.ts`:

| Flag | Kind | Values |
|---|---|---|
| DISCOVERY_ALLOWED_TYPES | string | — |
| DISCOVERY_PROFILE_SOURCE | string | — |
| DISCOVERY_CONTEXT_TO_INTENT | enum | `0`, `1` |
| DISCOVERY_REJECTION_COOLDOWN_DAYS | number | — (days, default 7; read in `opportunity.graph.ts`, not part of the API startup schema) |
| DISCOVERY_SOURCE_PREMISE_LIMIT | integer | — |
| RUN_OPPORTUNITY_EVAL_IN_PARALLEL | boolean | — |
| INTRODUCER_DISCOVERY_ENABLED | boolean | — |
| NEGOTIATION_INCLUDE_OTHER_INTENTS | enum | `true`, `false` |
| NEGOTIATION_MAX_TURNS_CHAT | integer | — |
| NEGOTIATION_MAX_TURNS_AMBIENT | integer | — |
| NEGOTIATION_EVIDENCE_QUESTIONS_MODE | enum | `off`, `shadow`, `on` |
| OUTCOME_QUESTIONS_MODE | enum | `off`, `shadow`, `on` |
| POOL_QUESTIONS_MINING | enum | `off`, `shadow` |
| POOL_QUESTIONS_MODE | enum | `off`, `on` |
| POOL_QUESTIONS_PUSH | enum | `off`, `on` |
| POOL_QUESTIONS_RANKING | enum | `off`, `on` |

`ops.profiles.ts` re-exports the metadata module for server-side consumers; the client imports `ops.metadata` directly (never `ops.profiles`, which pulls in node:fs).

### 2. Server: metadata endpoint

`GET /api/configs/metadata` (behind the existing auth gate) → `{ env: ENV_FLAG_METADATA, models: MODEL_METADATA, harnessAgents: HARNESS_AGENT_METADATA }`. Static payload, no DB. Ops tests assert it round-trips and that every allowlisted key has exactly one metadata entry (drift guard, like the existing allowlist tests).

### 3. Server: env value validation

New `validateProfileEnv(env)` in `ops.profiles.ts` (or a small `ops.envmeta`-backed validator): keys must be allowlisted (existing rule) **and** values must match the flag's kind — enum membership, boolean string, integer string. Applied in:

- `ops.server.ts` config create/update handlers (400 with the offending key + expected values in the message).
- `ops.routes.ts` ad-hoc launch override validation (400, same message shape).

Repo-shipped profiles are exempt from *value* validation at boot (they are code-reviewed), same as they are exempt from model allowlisting.

### 4. Client: shared guided components (`apps/eval-ops/src/components/`)

- **`GuidedEnvEditor.tsx`** — replaces `OverridesEditor.tsx`'s env section. Rows: flag dropdown (16 keys with label + key), per-row description text, value control by kind (`<select>` for enums/booleans, validated number input, text for the two string flags), and the "why" reason input. Keys already chosen in other rows are excluded from the dropdown. Invalid/incomplete rows disable the submit button (client-side guard; server still validates).
- **`ModelOverrideEditor.tsx`** — replaces the models table: one row per relevant agent (agent label + role description, dropdown of the 6 models with blurbs, default option = "profile default (⟨model⟩)"). Used by Launch (harness's agents from `HARNESS_AGENT_METADATA`), A/B (same, per side), and Configs (all agents present in the profile's models map, plus add-more).
- Plain-English field copy everywhere: "Runs" → "Runs per case — how many times every case is executed; 3 lets flaky behavior show up", "Seed" → "Skip to case N — resume a long sweep without rerunning earlier cases", "Cases" → "Only run cases whose id contains one of these texts", "Baseline" → "What this run is compared against".

### 5. Launch page restructure (`Launch.tsx`)

1. **What controls this run** (top): profile select (existing, with description), then `ModelOverrideEditor` scoped to the harness's agents.
2. **Baseline** select (unchanged behavior, plain-English labels: "Committed baseline", "No comparison", "A previous run…").
3. **▸ Advanced options** (collapsed `<details>`): runs, seed, case filters — the current controls, with the new explanations.
4. **▸ Advanced: live-pipeline flags** (collapsed `<details>`): honesty note ("These flags tune the live discovery and negotiation services. This scorecard harness does not read them — they are recorded with the run for staging work.") + `GuidedEnvEditor`.
5. A/B mode: per-side sections keep profile select + that side's model editor; the shared fields (runs/seed/cases, baseline) stay shared; env flags stay per-side inside each side's advanced disclosure. A/B help copy updated to match.

### 6. Harness page (`Harness.tsx`) — SUPERSEDED (implemented as no-op)

> **Post-implementation note (2026-08-02):** this section cited a `command-line` block that the earlier UX pass (#1318 era) had already replaced with the plain-English `question`/`detail` descriptor line. No per-harness default reference/profile data exists server-side, so the sentence below has no data source. Task 6 was correctly ruled obsolete during execution; the harness page was already plain-English. Original text retained for the record:


Replace the `<div class="command-line">` with a plain-English sentence built from the same data: `Compared against the committed baseline, under profile "dev-premise".` / `No comparison; cases only, under profile "default".` etc. The raw command moves into a collapsed `<details>` (`▸ show command`) for copy-paste. Descriptions and stats rows are unchanged.

### 7. Configs page (`Configs.tsx`)

The create/edit panel swaps its env section to `GuidedEnvEditor` and its models section to `ModelOverrideEditor` (all agents, not harness-scoped). Saved-config cards gain the profile description display (already available) — no layout change otherwise.

## Acceptance criteria

1. Launch page leads with profile + per-agent model dropdowns; each control has a plain-English explanation; no raw flag names above the fold.
2. Every env override row is created via the guided editor: key from the 16-key dropdown with description, value validated by kind client-side; invalid rows block submit.
3. Saving a config or launching with an invalid env value returns 400 naming the key and valid values (server-side test).
4. Harness page shows the plain-English baseline/profile summary; the raw command is reachable behind a disclosure.
5. `GET /api/configs/metadata` returns metadata covering exactly the allowlist keys, the 6 models, and the four harnesses' agents (drift-guarded by tests).
6. `bun run test` (apps/eval-ops, vitest), `bun test eval/ops/tests/` (protocol), `bunx tsc --noEmit` (both), and `eval:verify` all green.
7. WCAG AA contrast preserved for any new text/dim colors; no keyboard shortcuts added (mouse-first site).

## Risks / notes

- **Copy honesty** is the main risk: descriptions must be grounded (requirement above) and reviewed in PR.
- `ops.metadata.ts` must stay dependency-free (client-importable) — enforced by convention + the existing Vite build (a node import would break the build immediately).
- The metadata endpoint is additive; older deployed clients ignore it. No migration concerns; the `eval_ops_configs` table is untouched.
- Server-side value validation is a behavior change for `POST/PATCH /api/configs` and ad-hoc launch: previously-accepted invalid values now 400. Acceptable — invalid values only produced broken runs.
