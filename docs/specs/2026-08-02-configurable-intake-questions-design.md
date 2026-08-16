# Configurable fast-intake question count and per-turn mode — design

Date: 2026-08-02 (v2 — retargeted; supersedes the v1 agent-loop draft same day)
Branch: `feat/configurable-intake-questions`
Status: Approved design (pending spec review)

## Summary

The deterministic fast intake funnel at `/i/new` (and flag-on onboarding, which
shares `FastSignalIntake`) currently asks exactly two questions: one
**precomputed (cached) round-1 question** from the user's intake pack, then
**exactly one model-generated follow-up** grounded in the round-1 answer,
followed by a deterministic where-picker and the proposal card.

This change makes the question budget configurable and the per-turn delivery
mode selectable:

- `SIGNAL_INTAKE_MAX_QUESTIONS=n` — total question budget **including** the
  cached round 1. Default **2** (= current behavior, ship dark), clamped to
  1–10, garbage → 2.
- `SIGNAL_INTAKE_QUESTION_MODE=singular|plural` — per-turn delivery:
  `singular` (default, current cadence) serves one question per server turn;
  `plural` serves the whole planned batch (up to `n-1` follow-ups) in one
  turn.

After the cached round-1 answer, **one planning decision fixes the total k**
(1 ≤ k ≤ n): the model chooses how many follow-ups the context warrants, the
count is locked, and there is no mid-flow early-stop or extension. The UI
learns k from the first `/question` response ("detected after the first
answer") and sizes its progress display from it.

The v1 draft targeted the legacy agent-loop `GuidedSignalIntake`; that flow is
**unchanged** and remains the flag-off fallback with its existing 3-round
behavior.

## Goals

- One global knob for the total question budget `n` (cached round 1 included).
- One global knob for per-turn delivery: one-at-a-time vs batch-per-turn.
- The follow-up count k is planned once by the model after the round-1 answer,
  then locked; the agent never decides mid-flow to end or extend.
- The funnel server stays stateless: the client carries the locked
  `plannedTotal` back on subsequent calls.
- Default config is byte-identical to current behavior (n=2, singular).

## Non-goals

- Per-user or per-session configuration (env flags are global).
- Changes to the cached round-1 pack generation, the where-picker, or the
  clarification/rejection flow semantics (clarification does not count
  toward n).
- Changes to the legacy `GuidedSignalIntake` / Signal Agent prompt stage
  machine.
- Railway/local flip to non-default values (separate, explicitly approved ops
  step).

## Current architecture (what changes)

**Client — `apps/web/src/components/signals/FastSignalIntake.tsx`**
(stateless funnel; both answers travel with every call):

1. `POST /intents/intake/start` → cached round-1 question (intake pack).
2. Answer → `POST /intents/intake/question { whoAnswer }` → one structured
   model call (`SignalIntakeOrchestrator.nextQuestion`) → round-2 question.
3. Answer → `POST /intents/intake/prepare` → speculative synthesis run
   (returns `runId`); UI shows the client-side `WherePicker`.
4. Where chosen → `POST /intents/intake/proposal` → proposal, or 422 +
   clarification question (merged into the round-2 answer, retried).
5. `ProposalCard` → confirm / revise / skip. Progress bar hardcodes
   `Math.max(4, answered + 1)`.

**Server — `services/api/src/services/signal-intake.service.ts` +
`intent-intake.controller.ts`:** thin per-endpoint wrappers; no funnel state.

**Protocol — `packages/protocol/src/intents/application/intake.orchestrator.ts`:**
`nextQuestion({ brief, whoAnswer })` → one `IntakePackQuestion`;
`synthesize(...)` → `{ description, lookingFor, youBring }` from a fixed
two-answer prompt. Structured-output models with static fallbacks
(`FALLBACK_BRING_QUESTION`).

## Design

### 1. Configuration surface (services/api)

- `SIGNAL_INTAKE_MAX_QUESTIONS`: integer, total budget including round 1,
  default **2**, clamped to `[1, 10]`, non-numeric/garbage → 2.
- `SIGNAL_INTAKE_QUESTION_MODE`: `singular` (default) | `plural`; any other
  value → `singular`.
- Centralized accessors `getSignalIntakeMaxQuestions()` /
  `getSignalIntakeQuestionMode()` in `services/api/src/lib/` (house style; no
  bare `process.env` at call sites). Protocol stays env-free: both values are
  passed in as parameters.
- `startup.env.ts`: register both as optional lenient strings (accessors own
  parsing; a bad value never crashes startup).
- `.env.example`: commented-out entries next to `FAST_SIGNAL_INTAKE`,
  documenting defaults and ranges.
- **No `/auth/me` features change**: the client learns k from the `/question`
  response and is mode-agnostic (see below), so no bootstrap flag is needed.
- `.env.development` / Railway dev unchanged in this PR (defaults = current
  behavior).

### 2. Orchestrator: plan-and-deliver (packages/protocol)

One planning capability behind a single structured-output method:

```ts
generateFollowUps(input: {
  brief: string;
  rounds: Array<{ prompt: string; answer: IntakeAnswer }>; // round 1 (+ later rounds on re-calls)
  maxFollowUps: number;      // budget for THIS call
  plannedTotal?: number;     // locked total when continuing a singular flow
}): Promise<{ questions: IntakePackQuestion[]; plannedTotal: number }>
```

- The prompt renders the brief and every answered round so far, states the
  remaining budget, and instructs the model: choose how many further
  questions the context still needs (up to `maxFollowUps`, may be 0 only when
  `plannedTotal` says the interview is complete — otherwise at least 1 while
  budget remains), each with 3–4 personalized options + multi-select flag,
  never repeating an answered dimension. When `plannedTotal` is provided the
  model must not change it.
- `plannedTotal` in the response = 1 + (number of follow-ups the model
  wants in total), locked on the first call and echoed unchanged afterwards.
- Failure fallback: current static behavior — return
  `[FALLBACK_BRING_QUESTION]` with `plannedTotal = 2` (degrades to today's
  funnel exactly).
- `synthesize` generalizes from fixed `whoAnswer`/`bringAnswer` to the
  ordered round list: every round renders as `Q: prompt\nA: label` in the
  synthesis prompt; output schema (`description`, `lookingFor`, `youBring`)
  is unchanged. `nextQuestion`'s round-2-only prompt is absorbed into
  `generateFollowUps`.

### 3. Intake service & API (services/api)

`/intents/intake/question` becomes the single follow-up endpoint for both
modes; the server reads the two env accessors per request (no state):

- **Request**: `{ rounds: [{ prompt, answer }], plannedTotal? }` — `rounds`
  always contains round 1 first; `plannedTotal` echoes the locked count on
  continuation calls (server clamps it to `[1, configuredN]`; absent on the
  first call; `total = 1` only ever originates server-side, since a client
  that sees `total = 1` advances to `prepare` without further calls).
- **Singular mode**: server calls `generateFollowUps` with
  `maxFollowUps = 1` (first call: budget `n-1` so the model fixes k, but only
  the first question is returned) → responds `{ questions: [q], total: k }`.
- **Plural mode**: server calls with `maxFollowUps = n - rounds.length` →
  responds `{ questions: [...rest], total: k }` — the entire remaining batch
  in one turn.
- Response shape is identical for both modes; `total` is the locked k.
- **Unified client consequence** (section 4): the client never branches on
  mode.
- `prepare` / `proposal` / `revise`: replace the fixed
  `whoAnswer`/`bringAnswer`/`round2Prompt` payload with the ordered `rounds`
  list. The speculation run hash keys on all rounds; the stored run and the
  synthesis input carry the full list. Clarification handling is unchanged
  except the clarifying answer merges into the **last** round's answer
  (today: the round-2 answer).
- `start` (cached round 1), verification rejection (422 + clarification),
  confirm/reject: unchanged.

### 4. Client (`FastSignalIntake.tsx`)

- State: `rounds: Array<{ prompt, answer }>` replaces the positional
  `whoAnswer`/`bringAnswer`; `queue: QuestionPayload[]` holds the current
  batch; `total: number | null` is the locked k (`null` until detected).
- Flow after each answer:
  1. Append to `rounds`. If `queue` still has questions, shift and show the
     next one — **no server call** (plural batch, or singular mid-batch
     residue is impossible since singular batches are size 1).
  2. If `queue` is empty and `total === null || rounds.length < total`, call
     `/question` with `{ rounds, plannedTotal: total ?? undefined }`; set
     `total`, replace `queue`, show the next question.
  3. If `rounds.length === total`, advance to `prepare` + where-picker.
- `n = 1` edge: `total = 1` is detectable from the first `/question`
  response... except the client would never call `/question` when the
  configured budget is 1. Handled client-side: not knowing n, the client
  always calls `/question` after round 1; a plural-mode `n=1` server returns
  `{ questions: [], total: 1 }`, and the client advances straight to
  `prepare`. Singular-mode `n=1` behaves identically (empty batch, total 1).
- **Progress bar**: while `total === null` keep the current optimistic
  `Math.max(4, answered + 1)`; once detected, render exactly
  `total + 2` segments (k questions + where + confirm).
- **Proposal card**: `lookingFor`/`youBring` come from the server synthesis
  (`proposal.lookingFor` / `proposal.youBring`), already preferred over
  client fallbacks today; the positional client fallback now uses
  `rounds[0]` / `rounds[1]` when present and omits the line otherwise.
- Clarification UI: unchanged, merges into the last round.

### 5. Error handling and edge cases

- Garbage env values → accessors fall back (2 / `singular`); never crash.
- Model failure on planning → static fallback question, `plannedTotal = 2`
  (today's exact funnel).
- Client-sent `plannedTotal` outside `[2, n]` → clamped server-side; a forged
  large value can never exceed the configured n.
- `n = 1`: empty batch, straight to synthesis from round 1 + brief (the
  synthesis prompt simply has one round).
- In-flight clients across deploy: web and API ship atomically (same
  release train), so the controller accepts **only** the new `rounds` shape;
  an old client mid-funnel after deploy gets a validation error on its next
  call and the UI's existing error state offers a retry, which restarts the
  funnel. No legacy request compatibility shim.
- Onboarding (`/onboarding`) shares `FastSignalIntake` and inherits
  everything unchanged.

### 6. Testing

Targeted validation per the Development Reference (no database-backed tests;
all logic is orchestrator/service/client):

- **protocol** (`intake.orchestrator` specs): `generateFollowUps` budget
  capping (model returns more than `maxFollowUps` → truncated), zero/one/many
  follow-ups, `plannedTotal` lock-and-echo, fallback path returns
  `[FALLBACK_BRING_QUESTION]` + total 2, synthesis prompt renders a variable
  round list.
- **api** (`signal-intake.service` / controller isolated tests): env accessor
  parsing/clamping; singular returns 1 question + locked total; plural
  returns the full batch; legacy/invalid `plannedTotal` clamped; `n=1` empty
  batch; `prepare`/`proposal`/`revise` accept the rounds list and the
  speculation hash covers all rounds.
- **web** (`FastSignalIntake` tests): batch stepping without extra requests;
  refetch on queue exhaustion in singular mode; progress bar segment count
  before/after detection; clarification merges into the last round; proposal
  card fallbacks with 1..k rounds.

## Rollout

1. Merge with defaults (n=2, singular) — byte-identical behavior, ship dark.
2. Separately, with explicit approval: set `SIGNAL_INTAKE_MAX_QUESTIONS` /
   `SIGNAL_INTAKE_QUESTION_MODE` on Railway dev (`protocol` service), mirror
   in root `.env.development`, wait for redeploy SUCCESS, sanity-check
   `/i/new` in both modes.
