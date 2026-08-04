# Eval Ops Configuration Management — Design

Date: 2026-08-01
Status: approved (design review with maintainer)
Branch: `feat/eval-ops-deploy` (the branch the live `eval.dev.index.network` service deploys)

## Problem

Eval configuration today is a git round-trip. Config profiles are JSON files
in `packages/protocol/eval/ops/profiles/`, baked into the container image at
build time. Comparing "what if the evaluator were claude-sonnet-4 instead of
gemini-2.5-flash" means: hand-write JSON, commit, push, wait for a Railway
rebuild, launch, compare. That friction suppresses exactly the behaviour the
site exists for — running harnesses under different configurations and
comparing outcomes.

## Decisions (maintainer, 2026-08-01)

| Question | Decision |
| --- | --- |
| Core loop | Both ad-hoc overrides at launch **and** named saved configs; ad-hoc is primary |
| Storage for UI-created configs | Neon DB table; repo profiles stay as shipped read-only defaults |
| Model freedom | Curated server-side allowlist only (live spend on a shared URL; no actor attribution yet) |
| Knobs beyond models | Env toggles from the existing `PROFILE_ENV_ALLOWLIST` only. Judge model and runs/seed stay per-run launch fields, not config fields |
| Payoff loop | A/B launch: two runs under different configurations, comparison shown automatically when both end (addendum below) |

## Design

### One concept, two sources

A "config" is exactly the existing profile shape — `{name, description,
models: {agent → modelId}, env: {VAR → value}}` — validated by the existing
`ConfigProfileSchema`, resolved by the existing `resolveProfile`, fingerprinted
by the existing sha256-of-sorted-overrides, and forced `--no-save` when
experimental. UI configs differ from repo profiles in storage only: a
database row instead of a JSON file.

At launch, repo profiles and DB configs merge into one list keyed by name.
`RunSpec` already carries `profile` and `profileFingerprint`, so every run
record and artifact shows which config produced it, and the existing compare
view works across configs unchanged.

Non-goal: editing or deleting repo profiles from the UI. They are shipped,
code-reviewed defaults and remain read-only.

### Storage

One table in the Neon branch the eval-ops service already uses:

```sql
CREATE TABLE IF NOT EXISTS eval_ops_configs (
  name        text PRIMARY KEY,
  description text NOT NULL,
  models      jsonb NOT NULL DEFAULT '{}',
  env         jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

- Created by idempotent DDL at eval-ops server boot (the ops server is plain
  Bun with no drizzle setup; a migration framework for one table is
  unjustified weight). Boot DDL runs before the first request is served.
- The fixture reset's truncate list **excludes** `eval_ops_configs`; a test
  asserts configs survive a reset. The table is eval-ops app state, not
  fixture corpus.
- Name uniqueness spans both sources: creating a DB config whose name
  collides with a repo profile is rejected (409).

### Validation and spend safety

All client-originated configuration — config save/edit and ad-hoc launch
overrides — flows through one validation path in `ops.profiles.ts`:

1. `ConfigProfileSchema` (zod strict): kebab-case name, non-empty description,
   record shapes.
2. `PROFILE_ENV_ALLOWLIST` for every env key (existing).
3. **New** `ALLOWED_CONFIG_MODELS`: a curated list of OpenRouter model ids
   (initial: `google/gemini-2.5-flash`, `google/gemini-2.5-flash-lite`,
   `anthropic/claude-sonnet-4`, `anthropic/claude-haiku-4.5`,
   `openai/gpt-4.1-mini`, `google/gemini-3-pro-preview`). Every value in
   `models` must be on this list. Enforced on client-originated input only;
   repo profiles are trusted because they are code-reviewed.
4. Model keys (agents) must be known agent ids — the same check
   `readModelOverrides` performs; the error names the valid agents.

Any run whose effective configuration differs from `default` is experimental:
`--no-save` is forced, exactly as for experimental repo profiles today, so
baselines cannot be polluted through the UI.

### Ad-hoc overrides at launch

`RunSpec` gains an optional field:

```ts
overrides?: { models: Record<string, string>; env: Record<string, string> }
```

- `profile: "default"` **xor** `overrides` present: an anonymous one-off
  config. The executor builds child env through the same
  `resolveProfile`-shaped path and computes the fingerprint over the same
  `{models, env}` payload, so an ad-hoc run and a named config with identical
  overrides fingerprint identically — comparable in the diff view.
- `profile: <named>` with `overrides` absent: current behaviour, where
  `<named>` may now be a DB config as well as a repo profile.
- Both present is rejected (400) — "config, tweaked once" is expressed by
  launching the named config from the Configs page and editing the prefilled
  overrides section before submitting, which submits ad-hoc overrides.

### UI surfaces

**Launch page** (primary): a collapsed "overrides (this run only)" section.

- Per-agent model dropdowns, filtered to the agents the selected harness
  exercises (matching → `opportunityEvaluator`; opportunity →
  `opportunityPresenter`; profile → `profileGenerator`; premise →
  `premiseDecomposer`, `premiseAnalyzer`). Each dropdown offers the curated
  model list plus "default (gemini-2.5-flash)". The harness→agents map lives
  in the registry next to the new descriptions.
- Env-toggle rows: dropdown of allowlisted keys + value input + remove
  button; "add override" appends a row.
- "save as config…" button: prompts for name + description, POSTs the
  current overrides, and on success switches the form to that named config.

**Configs page** (new route, header link next to Fixtures): a table listing
repo profiles (dimmed, labelled "shipped", read-only) and DB configs
(edit/delete with confirm, "launch →" linking to a prefilled launch form).
Editor reuses the same override widgets as the launch page.

**Run page**: the header gains a resolved-overrides summary line (e.g.
`opportunityEvaluator → anthropic/claude-sonnet-4, RUN_OPPORTUNITY_EVAL_IN_PARALLEL=true`)
so two runs' difference is visible without opening the compare view.

### Server routes

Under the existing auth gate:

- `GET    /api/configs` → `{ repo: ConfigProfile[], saved: ConfigProfile[] }`
- `POST   /api/configs` → create; 400 invalid, 409 name collision
- `PATCH  /api/configs/:name` → edit description/models/env
- `DELETE /api/configs/:name` → delete
- `GET    /api/configs/models` → `{ models: string[] }` (the curated list, for dropdowns)

The existing `GET /api/profiles` keeps working unchanged; the launch path
(`POST /api/runs`) merges both sources when resolving `spec.profile`.

### Harness/agents registry addition

`HarnessDescriptor` gains `agents: string[]` — the model-overridable agents
each harness exercises — next to the `question`/`detail` added in the run-view
work. This drives the launch form's filtered dropdowns and keeps the mapping
in one reviewed place.

## A/B runs with automatic comparison (addendum)

The payoff loop the whole feature exists for: launch two runs under different
configurations, watch both, and see the diff the moment the second one ends.

Enabler (verified in source): the executor passes `--report <runDir>/report.json`
to every harness child, and `--no-save` suppresses only the rolling-baseline
write. **Every run — saved or experimental — captures a full report at
`.ops-runs/<id>/report.json`.** Two experimental runs can therefore be diffed
directly; baselines and saved artifacts are never touched.

**Server — compare runs, not just artifacts.** `GET /api/compare` gains
`referenceRun`/`subjectRun` parameters alongside the existing artifact-id
ones. Both runs' `report.json` files are read through the run store and fed
to the same `compareArtifacts`/`diffBaseline` path — same one-sided
beta-binomial statistics, same incompatibility reporting (different harness,
corpus-fingerprint mismatch). A run that died before writing a report yields
422 naming which side. An incomplete run (exit 2/3) still has a report and
still compares; the response carries the evidence-completeness state so the
UI shows the caveat rather than hiding it.

**Launch — A/B mode.** A toggle on the launch page, "A/B — compare two
configurations", splits the config section into **reference** and
**candidate** columns. Harness and run flags (runs, seed) stay shared; each
side independently picks default / a named config / ad-hoc overrides. Submit
fires two launches back-to-back — they serialize through the existing run
queue, which is also the fair way to compare on one machine — and navigates
to the pair page.

**Pair page — progress now, diff when done.** The existing `/compare` route,
extended: with run ids it shows both runs' progress views (the RunProgress
component) stacked, each headed by its side's resolved-config summary. When
both runs reach a terminal state it automatically fetches the run-vs-run
comparison and renders the existing diff view (regressions/improvements per
case) with the incomplete-evidence caveat when applicable. No new entity or
table: **the URL is the pair** — shareable, back/forward-safe.

Reference vs candidate semantics follow the existing compare view:
regressions are cases where the candidate is worse than the reference,
improvements the reverse.

## Error handling

- Invalid config payloads: 400 with the zod issue list, rendered verbatim in
  the UI (consistent with existing launch errors).
- Unknown model id or agent key: 400 naming the valid values.
- Name collision with a repo profile or existing DB config: 409.
- Boot DDL failure: server refuses to start (fail closed — the site is
  useless without its config store, and a silent fallback to repo-only would
  look like lost configs).
- DB unreachable on config routes: 503 with an explicit message; launches of
  repo profiles continue to work.

## Testing

Ops package (`bun test`):
- Config CRUD: create/validate/persist/edit/delete; name-collision 409s;
  model-allowlist and agent-key rejections; env-allowlist rejections.
- Launch: ad-hoc overrides fingerprint identically to a named config with the
  same payload; overrides force `--no-save`; `profile`+`overrides` both
  present is rejected; DB config resolves identically to a repo profile.
- Boot DDL idempotency (boot twice, no error).
- Fixture reset preserves `eval_ops_configs`.
- Run-vs-run compare: diffs two run reports; 422 when either side lacks a
  report; incompatibility (harness/fingerprint) reported; incomplete-evidence
  state present in the response.

App (`vitest`):
- Configs page: lists both sources, edit/delete flows, launch prefill.
- Launch page: overrides section validates client-side, save-as-config flow,
  named-config prefill and tweak.
- A/B launch: toggle reveals reference/candidate columns, submit fires two
  launches and navigates to the pair URL.
- Pair page: shows both progress views while active; flips to the diff view
  when both runs are terminal; incomplete-evidence caveat renders.

Targeted validation policy per the development reference: affected suites
plus typecheck; no full-suite run. Database-backed tests only under the
existing `TEST_DATABASE_SAFE=1` guard.

## Explicitly out of scope

- Judge model and runs/seed in configs (remain per-run launch fields).
- Free-text OpenRouter slugs (requires actor attribution + rate limiting first).
- Editing shipped repo profiles from the UI.
- Per-user config ownership (any signed-in user sees and edits all configs —
  matches the current shared-URL posture; revisit with actor attribution).
