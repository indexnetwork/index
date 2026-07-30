# Fast Signal Intake

Design for making intent creation at `/i/new` dramatically faster by precomputing
the expensive personalization offline and running the live funnel as a
deterministic state machine on a small model.

- Date: 2026-07-30
- Surface: `apps/web/src/app/i/new`, `apps/web/src/app/onboarding`
- Flag: `FAST_SIGNAL_INTAKE`

## Problem

Creating one signal today costs roughly **four sequential `gemini-3-pro-preview`
turns plus about seven `gemini-2.5-flash` calls**, strictly serialized, before the
user sees a draft.

The current flow (`apps/web/src/app/i/new/page.tsx` →
`apps/web/src/components/signals/GuidedSignalIntake.tsx`) sends a hidden
`new-signal-kickoff` message, then walks three blocking question rounds and a
synthesis step. Each round is a full chat turn against the Signal Agent persona
(`packages/protocol/src/chat/signal.prompt.ts`) with:

- the `gemini-3-pro-preview` chat model, `maxTokens: 8192`, reasoning effort `low`
- roughly 24 bound tools with long descriptions
- the user's identity, profile, and memberships pretty-printed as raw JSON in the
  system prompt on every turn

Each `ask_user_question` call then runs a **nested QuestionerAgent flash call**
plus a conversation-excerpt read and a user-context read, purely to polish
question wording (`packages/protocol/src/questions/application/question.ask.tool.ts`).

Synthesis is a fourth pro turn that calls `create_intent`, which invokes the
**profile graph** and then the **intent graph** (inference → verification) before
a proposal card can render
(`packages/protocol/src/signals/application/intent.tools.ts`).

Two structural observations drive this design:

1. **Round 3 ("where to look") is deterministic.** It can only legitimately offer
   communities the user already belongs to plus "Everywhere", yet it costs a pro
   turn and a flash call to produce a known answer set.
2. **Flow state is inferred by counting tool calls.** `getSignalIntakeStage`
   derives the current stage from `iterCtx.recentTools` — a general agent loop is
   being coaxed through a fixed three-stage funnel by prompt instruction.

`POST /intents/confirm` is already cheap: it resolves the durable proposal and
persists the stored verifier analysis without re-running the graph
(`services/api/src/controllers/intent.controller.ts`). It is not part of the
problem and does not change.

## Approach

Precompute the expensive personalization in the background, then take the agent
loop out of the intake entirely and drive the funnel as a deterministic
server-side state machine that calls a small model exactly twice.

Live model work drops from four pro turns plus about seven flash calls to
**two structured `gemini-2.5-flash` calls plus inference and verification**, with
the second call and the graph overlapping user think-time.

### Stages

| Stage | Today | New |
| --- | --- | --- |
| Page load | kickoff → pro turn → questioner flash → SSE card | `POST /intents/intake/start` → pack lookup → card. 0 LLM calls when warm |
| R1 "who" | pro turn + flash | precomputed, read from the pack |
| R2 "what you bring" | pro turn + flash | 1 structured flash call, no tools, grounded by brief + R1 answer |
| R3 "where" | pro turn + flash | deterministic picker from `useNetworksState`. 0 LLM calls |
| Synthesis | pro turn → `create_intent` | 1 structured flash call, fired speculatively on the R2 answer |
| Propose graph | profile graph + inference + verification | inference + verification only; the brief is supplied as `userProfile` |
| Confirm | `POST /intents/confirm` | unchanged |

### Consequences of reordering

Speculative synthesis fires before the where-answer exists, so the generated
description cannot contain it. Two consequences:

1. **The picked community must be written back onto the speculative proposal.**
   Proposals are *not* network-agnostic at confirm time: `createFromProposal`
   (`services/api/src/services/intent.service.ts`) rejects any confirmation whose
   `networkId` differs from the stored `intent_proposals.network_id` with
   `proposal_payload_mismatch` (409). That anti-tamper check is deliberate and
   out of scope to change. Speculating without a network is still fine, but
   `POST /intents/intake/proposal` has to persist the pick before it returns:
   the serial paths create the proposal with the `networkId` already on it, and
   the speculative-hit path issues an owner-scoped, membership-checked
   `setProposalNetwork` against the existing row. `POST /intents/intake/revise`
   carries the pick too, since it writes a replacement proposal row.
   The client's `networkId` is never trusted: membership is verified
   server-side (and again in the SQL predicate of `setProposalNetwork`), and a
   non-member pick is a 403, not a silently network-less proposal.
2. **"Where" narrows in meaning.** Today the prompt invites location, online
   space, or event as answers, which survive only as prose inside the description
   and are never persisted as structured data. The picker offers the user's
   communities plus "Everywhere", plus a free-text box. Using free-text discards
   the speculative run and re-synthesizes serially — worst case equals today's
   latency, and only that minority pays it.

## Precomputed pack

### Artifact

New table `signal_intake_packs`, one row per user, mirroring the `user_contexts`
shape and its `premiseHash` short-circuit
(`services/api/src/schemas/database.schema.ts`):

```text
id            text pk
user_id       text unique -> users.id cascade
brief         text          -- distilled 4-8 sentence intake brief
question      jsonb         -- ready QuestionPayload for round 1
premise_hash  text          -- reuse computePremiseHash for staleness
generated_at  timestamptz
```

`question` stores exactly the existing `QuestionPayload` shape (`title`, `prompt`,
`options[{label, description}]`, `multiSelect`) from
`apps/web/src/services/questions.ts`, so `GuidedQuestion` renders it unchanged
with no new frontend types.

### Why a brief instead of raw JSON

`buildSignalSystemContent` dumps `ctx.user`, `ctx.userProfile`, and memberships as
pretty-printed JSON into every turn. A small model reasoning over raw JSON is
exactly where flash is weakest. The brief is prose written for the intake task
specifically: who this person is, what they plausibly need from a connection,
what they can offer, and which communities they belong to. The hard interpretation
happens offline, which is what makes flash sufficient at request time.

The brief also becomes the `userProfile` argument to the intent graph, replacing
the profile-graph invocation in the propose path.

### Generation and freshness

- **Generator:** `SignalIntakePackGenerator` alongside `UserContextGenerator`, on a
  new `signalIntakePack` model key (`google/gemini-2.5-flash`, temperature 0.3).
  One structured call producing `{ brief, question }` from the user's active
  premises, membership titles, and existing global `user_contexts` paragraph.
- **Background refresh:** extend the `regenerate_contexts` handler in
  `services/api/src/queues/usercontext.queue.ts`. It already recomputes
  `premiseHash` per user and already skips unchanged work, so the pack regenerates
  in the same job right after the global context row and short-circuits on an
  unchanged hash. No new queue and no new trigger points; every existing
  premise-change path covers it automatically. The refresh is gated on
  `FAST_SIGNAL_INTAKE`: each regeneration is a real LLM call and nothing reads
  the pack while the flag is off, so flag-off behavior stays byte-for-byte the
  pre-feature job and flipping the flag is what starts the spend.
- **Cold start:** if no row exists when `/intents/intake/start` is called,
  generate synchronously (one flash call, roughly 1–2s), persist, and return. The
  first visit pays once; every later visit is a table read.
- **Stale but present:** serve immediately and enqueue a regen. Never block on
  staleness — a slightly-old question beats a spinner.

### Placement

The generator lives in
`packages/protocol/src/signals/application/intake.pack.generator.ts` so protocol
owns synthesis with no host dependencies. The table and queue wiring live in
`services/api`, preserving the existing protocol/host boundary.

## Service boundaries and data flow

### Speculation without new infrastructure

Speculative results must survive across API replicas, so no in-process promise is
used. Instead, **speculation means creating the durable proposal early**.
`intent_proposals` is already user-scoped, durable, and expiring, and
`/intents/confirm` already resolves by `proposalId`, so a proposal produced eight
seconds before the user finishes is indistinguishable from one produced on demand.

One correlation table provides single-flight and failure reporting:

```text
signal_intake_runs
  id           text pk
  user_id      text -> users.id cascade
  answers_hash text          -- single-flight key
  status       text          -- pending | ready | failed
  proposal_id  text null     -- set on ready, replaced on revise
  error        text null
  created_at   timestamptz
  unique (user_id, answers_hash)
```

`answers_hash` is computed over the two answers that feed speculation (R1 and
R2). A `whereText` re-synthesis does **not** get its own row: like `revise`, it
reuses the run the client already holds and replaces that run's `proposal_id` in
place, which is what keeps `runId` a stable handle for the whole funnel.

A hash match is therefore not sufficient grounds for reuse. With 3-4 canned
options per round there are only a handful of distinct answer pairs, so a user
creating a second signal inside the 24h run TTL can legitimately match their own
earlier run. Replaying that run would hand back a proposal that was already
confirmed, so `prepare` re-reads the matched run's proposal and only reuses the
run while that proposal is still `pending` and unexpired; otherwise it reopens
the run and speculates again. `POST /intents/intake/proposal` applies the same
test before returning a speculative proposal.

The run also stores the `looking_for` / `you_bring` summaries the settling
synthesis produced. The speculative hit is the *expected* outcome, so it has to
return the synthesized copy; without persisting it, the majority path would fall
back to the raw option labels the user clicked and only the degraded paths would
show the good copy.

`revise` does not create a run. It synthesizes a replacement proposal and updates
the existing run's `proposal_id` in place, so the run remains the single handle
the client holds for the rest of the funnel. Its feedback travels in a dedicated
`feedback` field on the synthesis input with its own prompt line — it is a
correction to the whole draft ("make it about hardware, not software"), not a
place constraint, and must not be rendered into the `Where constraint:` slot.

### Sequence

1. `POST /intents/intake/start` → pack lookup, or synchronous generation on cold
   start → `{ question }`
2. R1 answered → `POST /intents/intake/question` `{ answers: [a1] }` →
   `{ question }`. One flash call.
3. R2 answered → `POST /intents/intake/prepare` `{ answers: [a1, a2] }` →
   `202 { runId }`. The where-picker renders immediately while synthesis,
   inference, and verification run.
4. Network picked → `POST /intents/intake/proposal`
   `{ runId, networkId?, whereText? }`
   - without `whereText`: read the run. Normally already `ready`, so the proposal
     card is instant; otherwise short poll. The picked community is written onto
     that proposal before it is returned.
   - with `whereText`: synthesize fresh (with the community already attached) and
     repoint the same run at the replacement proposal.
5. `POST /intents/confirm` `{ proposalId, description, networkId }` — unchanged.
   It succeeds only because step 4 persisted `networkId` on the proposal row.
6. Revise → `POST /intents/intake/revise` `{ runId, feedback, networkId? }` →
   replacement proposal. One flash call plus the propose graph.

### Modules

- `packages/protocol/src/signals/application/intake.pack.generator.ts` — brief and
  round-1 question, structured output, no tools.
- `packages/protocol/src/signals/application/intake.orchestrator.ts` — pure stage
  logic: next-question generation, synthesis, `whereText` invalidation. Takes
  ports for pack read, proposal creation, and the intent graph. Owns no I/O.
- `services/api/src/controllers/intent-intake.controller.ts` — the five endpoints,
  auth, rate limits, and run-row lifecycle. `prepare` and `revise` do not use the
  generic `write` class (600/min): each call launches a synthesis plus a full
  intent-graph run and writes a durable proposal, so they carry the dedicated
  `intake_synthesis` limiter class (default 20/min). Answers must carry at least
  one selected option or non-empty free text — an entirely empty answer would
  otherwise drive a synthesis and a durable write.
- `apps/web/src/components/signals/GuidedSignalIntake.tsx` — gains an
  intake-driven mode reusing `GuidedQuestion` and `ProposalCard` verbatim, plus a
  new `WherePicker`. The picker lists **non-personal** networks only (`!isPersonal`,
  matching `NetworksPanel` and the server-side brief's `getNonPersonalNetworkIds`):
  a personal network is the user's own space, not a community to look in. `/onboarding` switches over too, since it shares this
  component and its `prepareSession`/`sendKickoff` props are dead in the new mode.

### Questions subsystem

The intake no longer flows through the chat runtime, so intake questions are no
longer written to the `questions` table with strategies and underspecification
types. That subsystem has evals and analytics attached, so answered intake Q&A is
written into it **asynchronously after the fact**, fire-and-forget and off the
critical path, keeping analytics intact without adding latency.

## Failure modes

| Failure | Behavior |
| --- | --- |
| Cold-start pack generation fails | Fall back to a static round-1 question so the page is never dead. Static copy is the last resort, not the cold path. |
| R2 generation fails | Static "what would you bring, what gap should they fill" question of the same shape. |
| Verification rejects the synthesis (0 verified intents) | Reuse the existing typed-clarification result as a fourth `GuidedQuestion`, then re-synthesize. Preserves today's recovery behavior without an agent loop. |
| Speculation fails | Run row goes `failed`; the proposal call synthesizes fresh, serially. Degrades to today's latency, never to an error. |
| User abandons after prepare | One wasted flash call plus graph. Proposals expire on their existing TTL; run rows are swept by TTL. |
| `whereText` used | Run discarded, fresh synthesis. Accepted trade-off. |

## Instrumentation

A `signal_intake_stage` log event per stage, where `stage` is one of `start`,
`question`, `prepare`, `proposal`, `revise`, carrying
`{ stage, durationMs, packHit, speculationHit, fallbackUsed }`, plus three
headline rates:

- **pack hit rate** — how often the pack was warm
- **speculation hit rate** — how often the proposal was `ready` before the user
  finished picking
- **`whereText` re-synthesis rate** — how often the free-text escape hatch is used

Success criteria: time-to-first-question under roughly 300ms when warm, and
time-to-proposal-card dominated by user think-time rather than model time.

## Rollout

`FAST_SIGNAL_INTAKE` ships dark across the four env surfaces
(`.env.example`, root `.env.development`, Railway dev service variables, and
`startup.env.ts`) and is exposed to the web app in the features payload next to
`signalAgent`, so the frontend selects intake mode or today's chat mode.

Order of operations: flip on dev, read the stage timers, then default on. The
pro-model intake path — `getSignalIntakeStage`, `buildSignalIntakeGuidance`, and
the tool-call-counting heuristic — is deleted in a **follow-up** PR, not this one.
General Signal Agent chat keeps `create_intent` on the pro model; only the guided
funnel changes.

## Testing

- **Protocol unit:** pack generator against a stubbed model; orchestrator stage
  logic, `whereText` invalidation, single-flight, `premiseHash` short-circuit, and
  every fallback branch.
- **API:** controller isolated tests following
  `services/api/src/controllers/tests/intent.controller.isolated.ts`; queue handler
  test covering pack regen inside `regenerate_contexts` (flag on) and its absence
  (flag off).
- **Seam:** one test that drives the intake service and the REAL
  `IntentService.createFromProposal` against a single proposal store, with the
  exact payload the web client posts. Everything else on either side of
  `/intents/confirm` is mocked, so this is the only place the
  description/`networkId` equality check is actually exercised end to end
  (`services/api/src/services/tests/signal-intake.confirm-seam.isolated.ts`).
- **Web:** extend `apps/web/tests/guided-signal-flow.test.tsx` with intake mode and
  assert the where-picker renders before the proposal resolves.
- **Regression:** one flagged-off run proving the legacy path is untouched.
- **Evals:** adding the `signalIntakePack` model key may trip `eval:verify`
  inventory and coverage checks. The `run-protocol-evals` skill covers this, and it
  is an explicit plan step.

## Out of scope

- Changing general Signal Agent chat behavior or its model.
- Deleting the legacy intake path (follow-up PR).
- Changing `POST /intents/confirm`, the intent graph's create path, or indexing.
- Restructuring the questions subsystem itself.
