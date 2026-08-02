# Configurable dynamic signal-intake questions — design

Date: 2026-08-02
Branch: `feat/configurable-intake-questions`
Status: Approved design (pending spec review)

## Summary

The guided New Signal intake at `/i/new` (and flag-on onboarding, which shares
the component) currently runs a hardcoded three-round interview: the Signal
Agent asks exactly three fixed-theme questions (`who` → `contribution` →
`where`) via blocking `ask_user_question` rounds, then synthesizes a proposal.

This change makes the question budget configurable via a single global env var
`SIGNAL_INTAKE_MAX_QUESTIONS` (default **3**, clamped to **0–10**) and replaces
the fixed round themes with **fully dynamic, context-driven generation**: the
agent decides which questions to ask (up to `n`), grounded in prior answers and
the preloaded identity/profile/membership context, and may stop early when it
has enough to write a specific signal.

## Goals

- One global knob (`SIGNAL_INTAKE_MAX_QUESTIONS=n`) caps the number of
  generated intake questions; unset = current behavior (3).
- Question topics are chosen by the agent from context, not hardcoded.
- The agent can finish in fewer than `n` questions when context suffices
  (maximum, not a quota).
- `n=0` skips the interview entirely: straight to synthesis from preloaded
  context.
- No regression for in-flight sessions, the shared onboarding flow, or the
  proposal confirmation card.

## Non-goals

- Per-user or per-session configuration (env flag is global; revisit if asked).
- Changes to the flag-gated `FastSignalIntake` one-shot funnel.
- Changes to `create_intent` verification, persistence, or matching behavior.
- Railway/local flip of the variable to a non-default value (code ships with
  default 3; flipping is a separate, explicitly approved ops step).

## Current architecture (what changes)

**Backend — `packages/protocol/src/chat/signal.prompt.ts`:**

- `getSignalIntakeStage(iterCtx)` counts `ask_user_question` tool calls in the
  current turn and maps 0/1/2/≥3 to fixed stages `who` / `contribution` /
  `where` / `proposal`; `create_intent` seen or a
  `new-signal-preview-feedback:` message yields `complete`.
- `buildSignalIntakeGuidance(stage)` emits hardcoded "Round X of 3" prompts
  per stage; reused verbatim by `onboarding.prompt.ts`.
- `SIGNAL_PERSONA` is a static `ChatPersonaConfig` export whose
  `buildSystemContent` calls `buildSignalSystemContent(ctx, iterCtx)`.
  `packages/protocol/src/chat` deliberately never reads `process.env`.

**Frontend — `apps/web/src/components/signals/GuidedSignalIntake.tsx`:**

- Progress bar assumes 4 steps (`Math.max(4, answered + current)`).
- Proposal card derives `LOOKING FOR` from `answered[0]`, `YOU BRING` from
  `answered[1]`, and network matching from `answered[2]` labels — all
  positional assumptions tied to the fixed 3 rounds.
- The `intent_proposal` block type and parser already support optional
  `lookingFor`, `youBring`, and `networkId` fields, but `create_intent` never
  populates the first two.

## Design

### 1. Configuration surface (services/api)

- New env var `SIGNAL_INTAKE_MAX_QUESTIONS`: integer, default `3`, clamped to
  `[0, 10]`. Non-numeric/garbage values fall back to `3`.
- Centralized accessor `getSignalIntakeMaxQuestions(): number` in
  `services/api/src/lib/` (alongside `signal-feature.ts`, per house style —
  no bare `process.env` at call sites).
- Registered in `services/api/src/startup.env.ts` as an optional string field
  (lenient; the accessor owns parsing/clamping so a bad value can never crash
  startup).
- Documented commented-out in `.env.example` next to the other signal-intake
  flags, noting default 3 and the 0–10 range. Default = current behavior, so
  the code ships "dark" in the flag-skill sense.
- Surfaced to the web app on `GET /auth/me` as
  `features.signalIntakeMaxQuestions: number` (added to `UserFeatures` in
  `apps/web/src/contexts/AuthContext.tsx`).
- `.env.development`/Railway dev are **not** changed in this PR (default 3 is
  the active value everywhere); flipping is a separate approved step.

### 2. Config plumbing: signal persona factory (packages/protocol)

Mirror the existing `createNegotiatorPersona` precedent:

```ts
// packages/protocol/src/chat/signal.persona.ts
export function createSignalPersona(opts?: {
  maxIntakeQuestions?: number; // default 3, clamped 0..10
}): ChatPersonaConfig
```

- The factory closes over the normalized value and passes it into
  `buildSignalSystemContent(ctx, iterCtx, { maxIntakeQuestions })`.
- Keep the static `SIGNAL_PERSONA` export as `createSignalPersona()` (default
  3) so existing imports/tests keep working; `services/api` chat wiring
  switches to `createSignalPersona({ maxIntakeQuestions:
  getSignalIntakeMaxQuestions() })`.
- The protocol package stays `process.env`-free; api injects the value.

### 3. Dynamic stage machine (`signal.prompt.ts`)

`SignalIntakeStage` collapses from `who | contribution | where | proposal |
complete` to `question | proposal | complete`:

- `complete`: unchanged detection (`create_intent` in `recentTools`, or the
  preview-feedback marker). This is also the early-exit mechanism: whenever
  the agent calls `create_intent`, subsequent iterations land in `complete`.
- `question`: kickoff message and `ask_user_question` round count `< n`.
- `proposal`: round count `>= n` (or `n = 0`): synthesize immediately, no more
  questions.

New `question`-stage guidance (replacing the three fixed round prompts):

- One blocking `ask_user_question` round at a time; exactly one concise
  question with 3–4 personalized options plus free text when appropriate.
- State the budget: "round k of at most n".
- Across the interview, ensure coverage of three dimensions — **who** they
  want to meet, **what** they bring / which gap the other side fills, and
  **where** to look (existing memberships by exact title, plus "Everywhere";
  never invent communities) — but the agent chooses order, phrasing, and
  which dimensions still need asking.
- Skip any dimension already answered or unambiguous from the preloaded
  identity/profile context.
- If the agent judges the context sufficient before round `n`, it must call
  `create_intent` immediately instead of asking again (early completion).

The `proposal`-stage guidance additionally instructs `create_intent` to pass
`lookingFor` / `youBring` (and `networkId` only for an explicitly selected
existing membership) so the confirmation card renders structured summaries.
The `complete` stage is unchanged.

`onboarding.prompt.ts` reuses `buildSignalIntakeGuidance` /
`getSignalIntakeStage`, so it inherits the configurable dynamic behavior with
no onboarding-specific code.

### 4. `create_intent` proposal block (packages/protocol)

Extend the tool's input schema with optional presentation fields:

- `lookingFor?: string` — one-line summary of who/what the user seeks.
- `youBring?: string` — one-line summary of the user's contribution.

Both are pass-through presentation metadata: when provided, they are included
in the emitted ` ```intent_proposal ` block JSON only. The durable proposal
record is unchanged — the confirmation card always re-parses the block from
persisted chat history (including after refresh/resume), so block-only storage
is sufficient. They do not affect verification, normalization, or persistence
of the intent itself. Tool description gains one sentence documenting the fields.
Backward compatible: existing callers never pass them, blocks without them
parse exactly as today.

### 5. Frontend decoupling from positional answers (`GuidedSignalIntake.tsx`)

- **Progress bar**: total segments = `n + 1` (questions + confirm) read from
  `features.signalIntakeMaxQuestions` (fallback 3 when absent); filled
  segments = answered count (+ current question). Because the agent may stop
  early, the bar represents a maximum, matching existing
  `Math.max(...)`-style growth semantics.
- **Proposal card summaries**: `LOOKING FOR` / `YOU BRING` come from
  `proposal.lookingFor` / `proposal.youBring` first; fallback for legacy
  sessions (blocks emitted before this change) keeps the positional
  `answered[0]` / `answered[1]` derivation only when exactly three rounds
  were answered (the pre-change flow always asked exactly three), else the
  card omits the summary line rather than guessing wrong.
- **Network matching**: prefer `proposal.networkId` → membership lookup
  (existing); generic fallback matches **any** answer label (any round)
  against membership titles instead of only `answered[2]`.
- No changes to answer submission, confirm/reject endpoints, resume flow, or
  `FastSignalIntake`.

### 6. Error handling and edge cases

- Garbage env value (`"abc"`, `"2.5"`, negative, `>10`): accessor falls back
  to 3 or clamps; never crashes startup or the prompt builder.
- `n = 0`: first iteration lands in `proposal`; the UI shows only the
  confirm segment while the agent synthesizes from preloaded context.
- Early stop: agent calls `create_intent` at round k < n — stage flips to
  `complete`; client renders the proposal card whenever a proposal block
  arrives regardless of answered count (already true today).
- Agent disobeys and asks a round `n+1` question: the stage machine stops
  injecting question guidance at count `n`, so the model sees only synthesis
  guidance; if it still calls `ask_user_question`, the client simply renders
  it (live-question rendering is count-agnostic). No hard failure mode.
- In-flight sessions across deploy: stage derivation depends only on
  tool-call counts in the conversation, so a mid-intake session continues
  under the new guidance with its existing answers; positional fallbacks
  cover legacy proposal blocks.

## Testing

Targeted validation per the Development Reference (affected tests + typecheck
+ lint; no database-backed tests required — all changes are prompt/config/UI):

- **protocol** (`signal.prompt` / persona specs): stage machine for
  n = 0 / 1 / 3 / 10 and clamping (e.g. 99 → 10); `question` → `proposal`
  boundary at exactly n rounds; early `complete` on `create_intent`;
  feedback-marker `complete`; factory default parity with `SIGNAL_PERSONA`;
  guidance text states the budget and coverage dimensions.
- **protocol** (`intent.tools` spec): `lookingFor` / `youBring` pass through
  into the emitted proposal block; absent fields unchanged.
- **api**: accessor parsing/clamping/default unit tests; `/auth/me` features
  payload includes `signalIntakeMaxQuestions`.
- **web** (`GuidedSignalIntake` tests): progress bar segment count follows the
  feature value; proposal card prefers block fields with legacy positional
  fallback; network fallback matches labels from any round.
- Typecheck + lint per package; build the web app once to catch `UserFeatures`
  consumers.

## Rollout

1. Merge with default 3 (behavior-identical) — ship dark.
2. Separately, with explicit approval: set `SIGNAL_INTAKE_MAX_QUESTIONS` on
   Railway dev (`protocol` service), mirror in root `.env.development`, wait
   for redeploy SUCCESS, sanity-check `/i/new`.
