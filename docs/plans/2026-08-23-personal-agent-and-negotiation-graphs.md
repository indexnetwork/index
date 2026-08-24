# One PersonalAgent, two graphs

**Status:** implemented 2026-08-23/24. Step 1 (NegotiationGraph rewrite) shipped in
#1494, the one-persona collapse in #1495, step 2 (AgentGraph + IS-A) in #1496.
The listed follow-ups are implemented: external agents use the new auth and
turn contract, negotiation opening is atomic, step 3 host cleanup is complete,
and the retired questioner/park delivery surface is deleted. Decisions taken
without the owner are in
[2026-08-24-overnight-decisions](2026-08-24-overnight-decisions.md) and the
Decisions appendix below.
**Date:** 2026-08-23
**Builds on:** [2026-08-21-holistic-intent-agent](2026-08-21-holistic-intent-agent.md)
(the IntentAgent actor) and the IntentGraph single-write-path refactor (#1489),
whose shape — one graph, routed on the shape of its input, every write through
it — this plan applies to the agent and to negotiations.

## The direction (the owner's words)

> We will only have one persona called PersonalAgent. It will have three
> scopes of operation: Global (deferred), Intent (H2A, `/i/:id`), Negotiation
> (A2A). The negotiation scope is simply a chat surface for the intent-scoped
> personal agent.

> Negotiator agent no longer terminates anything. IS-A decides to kick off
> negotiations; they are not automatically kicked off. When it is time to
> reflect, it asks questions to the user and when all answered, it kicks off
> the negotiations again, but this time it provides the context.

> Changing the status of the opportunity to `pending` and `rejected` can be on
> the agent; `accept` stays a user action.

> We can completely rewrite this, throwing the old code and tests out. I want
> a single AgentGraph and a single NegotiationGraph that handle everything,
> just like we did in IntentGraph.

Standing law, unchanged: prompts carry judgment, code carries effects; the
agent never acts automatically where the user's word is required; A2A
acceptance is not owner approval.

## Vocabulary

- **PersonalAgent** — the one persona. Its identity comes from the user's
  `type='personal'` agent row.
- **IS-A** — the PersonalAgent in *intent scope*: the agent for one signal,
  talking to its principal in the signal's DM (`/i/:id`). H2A.
- **Negotiator** — the same PersonalAgent in *negotiation scope*: the agent
  for one signal, talking to another user's negotiator in a negotiation
  thread. A2A. Not a separate persona; a chat surface of IS-A.
- **Brief** — the per-negotiation, **per-seat** context an IS-A writes for its
  OWN seat. Not memory. The only thing from a DM that reaches a negotiation
  thread. The initiator's kickoff writes its own; the counterparty's agent
  writes its own at its first turn (D18/D51).
- **Strategy** — IS-A's plan for a round of negotiations, written in the DM
  before kickoff, visible to and correctable by the principal.
- **Round** — one kickoff and the negotiations it started, ending when all of
  them are paused. A counter on the intent.

## The cycle

```
discovery persists matches for intent I          (all of them — no cap)
        │  event: matches_ready
        ▼
IS-A ── (may ask first) ── strategy in DM ── brief × N in parallel ── kickoff
                                        (up to MAX_MATCHES; the rest next round)
        ▲                                                     │
        │                                                     │  negotiator turns flow A↔B
        │                                                     │  until every negotiation of
        │                                                     │  this round is PAUSED
        │                                                     ▼
        └────────────────── reflect ◄────── all paused ───────┘
                      │
              phase 1 · ASK    questions for the principal, merged across negotiations
                      │        k = 0 → ACT; else post in DM, wait until all answered
              phase 2 · ACT    reject / promote to pending / re-kick the rest with new briefs
```

The negotiator never ends a negotiation. IS-A is the only terminator, and it
terminates only by **reject** or by **promote to pending**. The principal's
**accept** of a pending opportunity is a user action on the opportunity
(Radar card, `accept_opportunity` in the DM) and is outside this loop; IS-A
learns of it on its next reflect turn, if one triggers.

### Kickoff

1. `matches_ready(I)` arrives. IS-A takes a DM turn. It may ask the principal
   before reaching out; if it asks, kickoff waits for the answers and the
   turn re-enters here.
2. IS-A writes the **strategy** into the DM.
3. IS-A derives one **brief** per match — intent, DM so far, strategy — in
   parallel, a few at a time. That brief is for IS-A's OWN seat; the
   counterparty's agent writes its own (D18/D51).
4. IS-A kicks off **every eligible match it was shown** — the same list the
   prompt rendered, capped at `MAX_MATCHES` (D19/D52). No per-match selection
   by the agent: the negotiator filters by negotiating, and IS-A judges at
   reflect where it has turns to judge on. Matches over the cap, ones awaiting
   introducer approval, ones already the principal's to decide (`pending`) and
   ones whose turn budget is spent are not opened; the first of those is
   picked up by the next round.

### Negotiator turns

A negotiator turn reads the negotiation thread and its brief and emits exactly
one of:

| Verb | Effect |
|---|---|
| `outreach` / `counter` / `question` | message to the counterparty; negotiation stays active |
| `pause(counterparty_silent)` | the other side has not answered within the window; system-emitted, no payload |
| `pause(turn_cap)` / `pause(open_failed)` | system-emitted: the ambient turn budget is spent, or the open itself failed |
| `pause(needs_principal, payload)` | cannot continue without something only the principal knows; payload carries the question |
| `pause(ready_for_verdict, payload)` | believes a decision is possible; payload carries `{ recommendation: 'pending' \| 'reject', reasoning }` |
| `pause(turn_cap)` | the ambient turn budget ran out mid self-play; no payload. System-emitted, never authored |

No `accept`, `decline`, `withdraw` on the turn surface. A counterparty that
wants out pauses `ready_for_verdict(reject)` and *its* IS-A rejects. External
agents (Hermes, MCP `respond_to_negotiation`) submit the same verbs under the
same rule; their contract changes accordingly.

The pause reason is the task state's reason; the payload is data for IS-A.
Turn caps and park windows become pauses, never outcomes.

### The all-paused trigger

Every pause is a DB transition. The NegotiationGraph's pause step ends with:
for **every seat bound to the negotiation** (D21/D55), if no active
negotiation remains for that seat's `(intentId, round)` → enqueue
`reflect(intentId, round)` with job id `reflect:${intentId}:${round}`. Ten
pauses produce one reflect; a late pause from an earlier round cannot
re-trigger the current one. No cron, no Redis flag.

The check is gated on the round's SIZE stamp (D2): kickoff opens a round's
negotiations in parallel and stamps the size only once they have all settled,
so an early first pause cannot dedupe away the round's real reflect.

### Reflect

**Phase 1 — ASK.** Input: every paused negotiation **of the signal** (not just
of the round — a negotiation a later kickoff left behind must stay decidable),
with its reason, plus the payload of the pauses OUR OWN seat made, plus the
DM. A counterparty's payload is theirs to hand to their own principal. IS-A composes the questions the principal must answer
before anything is decided — `needs_principal` payloads merged and deduped
across negotiations (one answer often serves several) plus its own gaps. If
there are none, go to ACT. Otherwise post them in the DM and wait.

Answers are ordinary DM messages. On each, IS-A judges "all answered?" and
keeps asking or clarifying until yes. The principal may say "go with what you
have"; IS-A may then act, and may re-kick a subset when the unanswered
questions concern only the others.

**Phase 2 — ACT.** Only with the answers in hand:

- `reject` — opportunity `rejected`, negotiation closed.
- `promote` — opportunity `pending`; the principal sees it on the Radar.
- `re-kick` — for every negotiation still open, write a new brief (intent +
  DM + this negotiation's thread + the answers), in parallel, then kick all
  off together. Round counter bumps.

Verdicts are never executed in phase 1: an answer to a knowledge question may
change them. "Questions first" is ordering in code, not a prompt rule.

## The two graphs

Both route on the shape of their input, as IntentGraph does. Every write to
their tables goes through them. No operation-mode flag.

### AgentGraph

One LangGraph, one persona, one agent loop (today's persona-neutral
`ChatGraph` runtime). Scope is inferred from what is present.

| Input | Scope | What runs |
|---|---|---|
| `{ userId }` | global | deferred — graph-level input error for now |
| `{ userId, intentId, event: user_message }` | IS-A | DM turn; includes "are my open questions answered? → ACT" |
| `{ userId, intentId, event: matches_ready }` | IS-A | kickoff turn (may ask → strategy → briefs → open all) |
| `{ userId, intentId, event: all_paused }` | IS-A | reflect phase 1 (→ phase 2 when nothing to ask) |
| `{ userId, negotiationId, intentId? }` | negotiator | one turn: read thread + its OWN brief → one verb or one pause. `intentId` is the speaking seat's signal when it has bound one (D21) |

Scope decides: which conversation is read and written (the signal DM vs the
negotiation thread), the prompt fragment, the verb set, and who the reply
goes to (principal vs counterparty). `matches_ready` and `all_paused` are the
same node — "look at the state, maybe ask, else act" — differing only in what
ACT does.

IS-A verbs: `message_user` (with optional canned-reply options), `ask`
(questions that block ACT), `kickoff`, `reject`, `promote`, `note_dossier` /
`retire_dossier`, `accept_opportunity` on the principal's explicit word
(unchanged from phase 2 of the IntentAgent plan). Verbs are tools; effects go
through the domain graphs: kickoff/reject/promote/turns → NegotiationGraph;
accept → the opportunity path.

IS-A moves into `packages/protocol` as part of this: today it is host code
(`services/api/src/lib/intent-agent/*`) calling protocol ports. Its inbox,
dossier and reply stream become ports the host implements.

### NegotiationGraph

| Input | Meaning |
|---|---|
| `{ opportunityId, brief, intentId, round }` | open: create the negotiation and take the first turn. `brief` and `round` are the KICKING seat's, resolved from `intentId`'s owner; `round` is the caller's batch counter, bumped once per kickoff batch, and with `intentId` keys the all-paused trigger |
| `{ negotiationId, brief, byUserId }` | resume with new context for ONE named seat |
| `{ negotiationId, turn, byUserId }` | apply a submitted turn — from AgentGraph or an external agent, same verbs, same validation → continue or pause. `byUserId` is the submitting seat; `apply` rejects a turn whose `byUserId` is not the speaker it computed |
| `{ negotiationId, pause: counterparty_silent \| open_failed }` | a timeout fired, or an open failed and left a live task |
| `{ negotiationId, verdict: pending \| reject, reasoning, byUserId }` | resolve — the only terminal write on the negotiation, from IS-A ACT. `byUserId` is the authenticated resolving seat, which scopes the private outcome reasoning. It also closes the negotiation behind an owner verdict on the opportunity, and never writes over an already-terminal opportunity status (D23) |
| `{ negotiationId }` | read |

`reasoning` is recorded on the outcome artifact and travels with the opportunity status — it is what the Radar card / closed card render. It is private to the resolving side: never persisted as a message into the A2A thread. A reject reason may contain principal-private material; the counterparty only ever sees that the negotiation closed.

Inside: `init` loads the opportunity, its actors and the kicking intent
through the database port (callers pass ids, not pre-built user contexts;
profiles are not loaded — the brief is the context);
`turn` asks AgentGraph (negotiation scope) for our seat or dispatches to the
external agent for theirs; `apply` validates the verb against the seat,
persists, decides continue/pause, and on pause runs the all-paused check;
`resolve` writes the opportunity status. One `apply` for every source of a
turn — internal agent, external agent, timeout.

The A2A conversation is **per negotiation**, not per pair: a negotiation *is*
its thread. Prior-pair dialogue is not seeded; the brief carries whatever IS-A
wants the negotiator to know.

### Host wiring

One `PersonalAgent` and one `Negotiations` instance, each with a named deps
object, constructed once in `services/api/src/main.ts` (the six ad-hoc
`NegotiationGraphFactory` constructions and the direct `ChatGraphFactory`
constructions go). Queues and controllers call `graph.invoke` and map the
typed outcome; services become thin wrappers as `IntentService` did in #1489.

## What is deleted

Whole-cloth, with their tests:

- `IndexNegotiator` and its terminal actions, the conclusion floor and
  checklist *as a gate*, the decline law, the copy-loop guard, turn cap and
  park window as outcomes, deadlock shift, stances.
- The five out-of-graph "persist turn → finalize" implementations:
  `respond_to_negotiation`'s handler body, `respondLegacy`, `respondHermes`,
  `timeout.shared`'s negotiator fallback (both timeout queues).
- `NegotiationPollingService.consult` and the second `ask_user` park; the two
  park-settlement paths in `questioner.adapter`; per-answer resume
  (`resumeParkedNegotiation`, `consumeQuestionBlockAnswers`, question
  settlement, continuation leases/fences/receipts); `run-existing` queue's
  `negotiate_existing` mode; `negotiateCandidates`; `compensateTaskless…`.
- The three hand-built `UserNegotiationContext` builders (`negotiateNode`,
  `negotiateExistingOpportunity`, `NegotiationService.buildUserContext`) and
  `POST /users/:id/negotiations`.
- `SIGNAL_PERSONA_ID` / `NEGOTIATOR_PERSONA_ID` / onboarding persona branches;
  `conversations.persona` collapses to one value on every agent-authored
  surface; `'orchestrator'` and `'telegram'` history rows are deliberately
  left as they are — they are read-only records, not live personas. `PersonalAgentChat`,
  `Negotiations`, the unused `InChatNegotiationQuestionDelivery` port.
- The pair-shared A2A thread, `priorAttribution`, the conversation lock.
- `services/api/src/lib/intent-agent/*` (moves, as IS-A, into the protocol).

Not deleted: owner accept (`PATCH /opportunities/:id/status`, Radar,
`accept_opportunity`), the `acceptedBy` / sibling-accept mechanics,
notifications, negotiator memory tables (unused by this loop for now — "later
we can use global agent context"), the watchdog and claim-timeout queues for
external agents (re-pointed at `{ negotiationId, pause }`).

## Known gaps after step 1

Real, recorded rather than fixed — each belongs to a later step, not to the
NegotiationGraph rewrite:

- `reasoning` written by `resolve` has no reader: `negotiation-context.loader`
  declares `getArtifactsForTask` but never calls it, and it loads through
  `getNegotiationTaskForOpportunity`, which excludes completed tasks — so a
  resolved card renders nothing. Belongs with step 2/3 presentation.
- The questioner/park/continuation spine (`questioner.adapter`'s settlement
  ladder, `negotiation-continuation.atomic`, `parked-negotiation.reader.adapter`,
  `negotiation-session-rollup.projection`) is still wired into live surfaces but
  keys off `input_required` / `stalled` / ask_user gaps — states the rewritten
  graph never writes — so it is inert, and a `needs_principal` pause currently
  reaches no principal surface. "What is deleted" lists it as deleted; the
  replacement surface is step 2.
- `createNegotiationTaskForAttemptInTransaction` and the pair lock
  (`conversation.database.adapter.ts`) have no live callers.
- `run-existing.queue` survives as a no-op stub that callers still enqueue into
  (discovery re-enqueue, watchdog, the MCP negotiate tool) — step 3.
- Three `NegotiationGraph` construction sites remain against this doc's one —
  step 3.

## Open items

- External-agent contract (Hermes / MCP): same verbs, cannot terminate —
  needs a CHANGELOG line and a hermes-plugin update in the same PR.
- Round and brief need columns: `intents.negotiationRound`, a `brief` on the
  negotiation task (or thread). Migration is part of the rewrite; no dual
  reads.
- Global scope stays an input error until there is a surface for it.

## Sequencing

One branch per problem, each a worktree and a PR into `dev`:

Steps 1 and 2 have shipped (#1494, this PR); step 3 remains.

1. **NegotiationGraph rewrite** (shipped, #1494) — the table above, `init` loads from ids,
   `apply` as the single turn sink, pause states, all-paused trigger, owner
   verdict split (`pending`/`reject` from the graph, `accept` untouched).
   Old negotiation code and tests out. Live E2E spec from the graph.
2. **AgentGraph** (shipped) — one persona, scope by input shape, IS-A moved
   into the protocol, kickoff / reflect / negotiator-turn as graph inputs,
   briefs and strategy. Discovery emits `matches_ready` instead of opening
   negotiations itself. See the Decisions appendix, D15-D28.
3. **Host collapse** — one construction site per graph, thin services, queues
   re-pointed, dead routes and personas removed.

Each step states its breaks in the PR and bumps the protocol major.

## Decisions

Every solo design call taken while building this plan, with the alternative
rejected. D1-D14 (the NegotiationGraph rewrite and the persona collapse) live
in [2026-08-24-overnight-decisions.md](2026-08-24-overnight-decisions.md);
D15+ below are the AgentGraph step's. D18-D20 in that log are three design
questions review rounds 2-5 raised and I first deferred; the owner's standing
rule is that a legitimate design question gets DECIDED with the alternatives
written down, not handed back, so they are decided there and implemented here
as D51-D53.

### D15. The negotiation scope AUTHORS a turn; it does not submit one
Chose: `NegotiationGraphDeps.author` is a `NegotiationTurnAuthor` port that
returns one authored turn, bound in the host to
`agentGraph.invoke({ userId, intentId, negotiationId })`. `apply` stays the
single sink and the graph keeps driving self-play.
Alternative rejected: the agent submitting its turn through
`{ negotiationId, turn, byUserId }` — that shape is the EXTERNAL caller's, and
using it internally makes the invoke re-entrant (apply → turn → agent → apply)
with unbounded nesting. The design doc's own AgentGraph section says `turn`
*asks* AgentGraph for our seat.

### D16. The author port takes ids only
Chose: `{ negotiationId, userId, intentId }`; the agent re-reads the brief and
the thread itself, costing one extra pair of reads per turn.
Alternative rejected: passing the already-loaded `{ brief, thread, isOpening }`
— cheaper, but it puts negotiation payload into the AgentGraph's documented
`{ userId, intentId, negotiationId }` input and gives the graph two ways to
know a thread.

### D17. `wait` is deleted; an empty act list is the answer
Chose: a turn that decides nothing returns no acts. The ledger already records
what woke the turn.
Alternative rejected: keeping `wait` as an explicit ledgered non-act — one
more verb for a state the empty list already expresses.

### D18. "Questions block ACT" is enforced in the validator, for every event
Chose: any `ask` in a decided act list drops the `kickoff`/`promote`/`reject`
acts beside it, on user_message turns as well as reflect turns.
Alternative rejected: leaving it to the prompt — the plan says ordering in
code, not a prompt rule, and the case it protects (an answer that changes the
verdict) is exactly the one a model is most likely to get wrong.

### D19. Kickoff runs last in a turn and re-reads the match list
Chose: every other act executes in the model's order, then kickoff.
Alternative rejected: strict model order — a promote or reject moves the
opportunity's status, and a kickoff reading the turn's stale list would
re-open the match it had just resolved.

### D20. A kickoff that opens nothing leaves the round unstamped
Chose: no stamp, no reflect enqueue, `opened: 0` on the ledgered act.
Alternative rejected: stamping zero — a stamped empty round is instantly
"all paused", so reflect fires, ACT kicks off again, and the loop never ends.

### D21. A capped negotiation is never re-kickable — read from its OWN state
**Restated after review; the first version of this decision was wrong.**

Chose: kickoff skips a match whose current negotiation task is `paused` with
reason `turn_cap`, read from the task itself
(`getNegotiationTaskForOpportunity`) regardless of which round it belongs to.
A spent table can only re-pause on the cap, and that pause re-triggers reflect,
which kicks off again.

The first version read the CURRENT ROUND's paused set, and that does not hold:
a negotiation that capped in round R and was therefore excluded from R's
kickoff keeps `metadata.round === R`, so it is absent from round R+1 entirely
and reads as eligible again. Two matches are enough — A caps, B stalls on a
question, the next kickoff carries only B into R+1, reflect(R+1) no longer sees
A, and A is re-opened into R+2 forever, each round costing a strategy call, a
brief and an author turn per match and posting another strategy message into
the principal's DM. Pinned by a regression test with exactly that shape.

Alternative rejected: no structural bound, trusting IS-A to reject a stalled
table — a model that keeps re-kicking spends real money forever. This is the
termination guarantee: every table eventually reaches the cap, kickoff then
opens nothing, and D20 ends the cycle.

**Amended in round 5.** Ineligible for re-kick is not the same as invisible,
and the first version conflated them: `context.paused` was round-scoped, so a
capped negotiation a later kickoff left behind vanished from every future
reflect and could never be promoted or rejected — its opportunity sat
`negotiating` for good and its principal never heard an outcome. The paused
list is now SIGNAL-scoped (`getPausedNegotiationTasksForIntent`), so a spent
table stays decidable while staying un-re-kickable. Two properties, two
mechanisms.

### D22. A pause payload stays scoped to the seat that paused
Chose: reflect sees the full payload of OUR seat's pauses (the
`needs_principal` questions ASK merges) and only the reason for the
counterparty's. The shared thread carries everything else.
Alternative rejected: exposing every payload of the round — the counterparty's
`needs_principal` question is for THEIR principal, and their
`ready_for_verdict` recommendation is their agent's private reasoning about
our client.

### D23. One match list, widened
Chose: `readActionableCounterparties` gains a `statuses` argument, and the
PersonalAgent reads it with `latent`/`draft` included — matches discovery has
only just persisted are exactly what kickoff reaches out to.
Alternative rejected: a second reader for the agent — two orderings of the
same list is the bug that reader exists to prevent.

### D24. Reflect enqueues into the PersonalAgent's own inbox
Chose: the round-reflect queue is deleted; the trigger adds an `all_paused`
job to the agent inbox, keyed `reflect:${intentId}:${round}` and deliberately
retained on completion.
Alternative rejected: a separate reflect queue (as #1494 shipped it) — two
workers means a reflect turn can interleave with the principal's own message
turn on the same signal, and the whole point of the inbox is that they cannot.

### D25. `matches_ready` is keyed on the signal, not the batch
Chose: coalesce a burst of discovery batches into one kickoff turn rather than
one turn per batch.
Alternative rejected: one event per persisted batch — N kickoffs, N rounds,
and reflect firing at the first pause of a round of one. (How the coalescing
is keyed, so that it can never LOSE a batch, is D31.)

### D26. The 0145 journal entry is restored
Chose: re-add the `_journal.json` entry that #1495's migration renumber
dropped, in this PR, because `drizzle-kit migrate` reads the journal and would
otherwise skip the persona-collapse migration entirely — and land 0146 on a
schema that never got it.
Alternative rejected: leaving it for a separate fix — the two migrations ship
to the same environment in the same window.

### D27. The `answer_pending_question` host is deleted
Chose: `lib/question/negotiator-answer.host.ts` and its spec go. Its executor
was the retired per-answer resume path, and #1495 removed its last caller with
the negotiator persona tools. Answers are ordinary DM messages now.
Alternative rejected: re-pointing it at the DM — a second way in for something
the DM already does.

### D28. One construction site per graph, enforced by need
Chose: `tool.service` and `mcp.controller` stop building their own negotiation
graphs; `ToolFactory` no longer falls back to a reflect-less instance. Without
the host's composition there is simply no negotiation graph in that context.
Alternative rejected: keeping the fallbacks — a graph with no turn author
throws on every turn, and one with no reflect enqueue loses the all-paused
moment for good.

### D29. An interrupted kickoff is REPAIRED, and claims nothing for it
**Restated twice; the first two versions were both wrong.**

Chose: the round bump — the one write that begins a kickoff — stamps
`intents.negotiation_kickoff_started_at` in the same statement. A round with
that marker and no size stamp is one a kickoff began and did not finish, so
the next kickoff REPAIRS it first: settles it so it is no longer stranded,
pushes NO act, and then does its own work. A principal who asks for a kickoff
during an interrupted round gets one.

Version 1 inferred the marker from `roundSize === null`, which matches every
intent alive when the migration lands — the first `matches_ready` per existing
signal would have settled a stale round and dropped the batch that woke it.
Version 2 fixed the marker but let the repair *stand in for* the kickoff: it
settled the old round, opened nothing, and still reported
"you opened N negotiations". A `user_message` turn where the principal said
"go ahead" rendered a confirmation for work nobody did.

The cost of the current shape is that a genuine retry of a crashed turn runs
the kickoff again: a second strategy message in the DM. The negotiations
themselves are RESUMED, not duplicated — an open finds the existing task,
re-briefs it and re-rounds it — so what repeats is one line of chat, and the
alternative is a lost action reported as done.

Alternatives rejected: (a) making the whole turn transactional — the effects
span a model call, a chat message and N negotiation graphs; (b) suppressing
the kickoff whenever a repair ran (version 2) — indistinguishable from the
case the principal actually asked for; (c) a sentinel value in
`negotiation_round_size` — one column meaning three things.

### D30. One impossible act drops; an emptied list is a real empty turn
**Amended after round-2 review.**

Chose: the validator drops the offending act and keeps the rest, exactly as
`normalizeMessageOptions` drops a malformed chip, and returns `null` — the
retry-then-throw path — only for output that did not parse at all.

The first version also returned `null` when everything dropped, which on a
client-message turn is the common case: a model that answers with nothing but
an acts-stage `message_user` had every act dropped, was retried against an
identical prompt with no feedback, produced the same output, and threw — so the
client got the failure copy instead of the reply the reply stage writes anyway.
An emptied list is a turn that decided nothing, and deciding nothing is a real
answer.

Alternative rejected: refusing the whole round trip on any impossible act (the
first shipped behaviour) — it discards the client's actual request, a verdict
they asked for in words, alongside the model's mistake.

### D31. Two coalescing slots, plus an authoritative end-of-kickoff re-check
**Amended after round-2 review.**

Chose: a batch coalesces onto the primary job id while that job is still
queued, and onto a single follow-up id while it is running; if both are
running, it is enqueued unkeyed. AND — because reading a job's state and then
adding is not atomic, so a job flipping waiting→active between the two calls
can still swallow an add — the end of a kickoff re-reads the match list and
wakes the signal again for any undecided match that has no negotiation at all
and was not one of this kickoff's own targets. That re-check, not the job id,
is what makes "no silent loss" true.

It cannot loop: a target whose open failed is compensated into a task (D34), so
it is never "unopened" on the next pass, and a kickoff that opened everything
leaves nothing for the re-check to find.

Alternatives rejected: one job id with `removeOnComplete` (the first shipped
behaviour) — BullMQ silently returns the existing job for a duplicate id, so a
batch landing during a minutes-long kickoff turn vanished into a turn that had
already read its match list. Closing the read-then-add race properly needs a
Lua/atomic add BullMQ does not expose, which is more infrastructure than this
PR should introduce.

### D32. The reflect job is retained on completion, forever
Chose: `removeOnComplete: false` on the `all_paused` job. One retained row per
(signal, round) is the price of exactly-once.
Alternative rejected: the queue default `{ age: 24h }` — after a day the id is
free again, and a late watchdog pause on a stale negotiation of that same
still-current round wakes the agent to re-decide a round it already closed out.
`removeOnFail` keeps its 7-day default on purpose: a reflect lost to a
transient outage should become reachable again.

### D33. The two round-scoped reads agree on what belongs to a round
Chose: `countActiveNegotiationsForRound` applies the same archive predicate as
`getNegotiationTasksForIntentRound`.
Alternative rejected: leaving the count unfiltered — an archived task stuck in
`working` holds it above zero forever, so the signal never reflects again,
while that task is invisible in the paused set the agent reasons over.

### D34. A failed open is compensated, with a pause reason of its own
Chose: an open that failed but left a live `working` task in the round is
paused through the graph's own sink with a new system reason, `open_failed`.
Unlike `turn_cap` it stays re-kickable — the failure was ours, not the table's.
The round's SIZE is then read back from the database rather than counted from
the settled opens, because a compensated task and a re-kicked task that `init`
had already moved into the round both belong to it.
Alternatives rejected: (a) leaving the task `working` — the round's active
count never reaches zero, so its reflect is a no-op until the 12-hour watchdog
sweep; (b) reusing `counterparty_silent` — nobody went silent, and IS-A reads
that reason at reflect and would act on a fiction.

### D35. `matchesReady` is wired at every composition root, not just the queue
Chose: thread the one host callback through `protocolDeps`, `McpToolDeps` and
the REST/CLI `ToolDeps`, so the OpportunityGraph `tool.factory` builds gets the
same hand-off the discovery queues use.
Alternative rejected: leaving it to the queue path — chat- and MCP-run
discovery build their own graph, and with the field unset the matches_ready
edge ends at END. Matches persist, the agent is never woken, and there is no
error to notice. Pinned statically at each root and behaviourally on the node.

### D36. The negotiator turn keeps a deadline of its own
Chose: 20s per turn at the author seam, the bound the deleted
`NegotiationAuthor` had.
Alternative rejected: relying on the model layer's own 60s x retry budget — a
kickoff self-plays several turns per match in parallel, so a single slow
provider call stacks far past the chat controller's 90s wait and the principal
sees a timeout for a turn that is still running.

### D37. The introducer-approval gate lives at the OPEN
Chose: `NegotiationGraph`'s open path refuses an opportunity whose introducers
have not all approved. Kickoff also filters those matches out, but only to
avoid spending a brief on something that would be refused — the gate that
binds is the one on the write.

Discovery's `matches_ready` node has the same check, and that is the bug: it
only decides whom to WAKE. A signal with one plain match and one unapproved
introduction wakes on the plain one, and the kickoff then re-reads the WHOLE
match list and opens both — flipping the gated opportunity to `negotiating`
and sending A2A outreach on an introducer's behalf without their approval.
Same class as the seat mis-binding in #1494: a check one layer away from the
write it guards.
Alternative rejected: filtering in the agent only — the next caller of the
open path would have to remember the rule again.

### D38. A compensating pause tells the truth about what happened
Chose: an open that failed with nothing said pauses `open_failed`; one that
failed after outreach was already applied pauses `counterparty_silent`, the
same reason the stale-negotiation watchdog gives that exact shape hours later.
Alternative rejected: `open_failed` for both — it would tell the principal
nothing had been said with the outreach sitting in the thread, and `apply`
stamps `pausedBy` as the seat that owed the next turn, so the principal would
read "paused by their agent" for our own failure.

### D39. A turn fails on the reads it is ABOUT — at the HOST binding
**Restated after round 4: the first version changed nothing in production.**

Chose: only the agent's display name degrades. A `matches_ready` that cannot
read its matches, an `all_paused` that cannot read its paused negotiations, a
DM read that errors, the turn-cap eligibility read — all throw, so the queue
retries. And the throw is real at the OUTERMOST implementation:
`readSignalMatches` propagates, and `readActionableCounterparties` is now a
thin swallowing wrapper kept for the tool surfaces that would rather offer
nothing than lose a turn.

Version 1 made the protocol seam throw and stopped there. The only host
binding behind it still caught everything and returned `[]`, so nothing
changed where it mattered: a transient database error on a reflect still
produced a turn that saw no negotiations, decided nothing, succeeded — and
consumed the round's one retained reflect job. The lesson generalises: when a
fix is "make this propagate", verify it at the outermost real implementation,
not at the seam you edited. Every other read the same change touched was
audited at its host binding; `readActionableCounterparties` was the only
swallow in any of those chains.

Alternative rejected: making the verdict tools' list throw as well — an
unreadable options list there honestly means "no verdicts to offer", and
losing a chat turn over it is worse.

### D40. The all-paused check runs on BOTH sides of the size stamp
**Amended in round 5.**

Chose: in kickoff's own settle step, check-and-enqueue, stamp, then check
again. Before the stamp so a failed enqueue leaves the round unstamped and
therefore still findable by the repair path — retryable rather than a settled
round nothing will ever reflect on. After the stamp because a negotiation that
pauses in the window between the count and the write gets nothing otherwise:
its own pause-side check bailed on the still-null stamp, and this side had
already counted. The enqueue is keyed by (signal, round), so running it twice
is one job either way.

Alternatives rejected: stamping first (the original) — a failed enqueue leaves
a settled round nothing reflects on; checking only before the stamp (round 4's
fix) — it opens the window above, reachable from the watchdog and
run-existing queues. The pause-driven check keeps its swallow, retries three
times and gives up at ERROR.

### D41. The pause-reason union is defined once per codebase, and pinned
Chose: one `NEGOTIATION_PAUSE_REASONS` in the protocol, one mirror in the API
adapters (which may not import the protocol), one in the web's API client —
and a spec that fails when the API mirror drifts from the protocol's.
Alternative rejected: restating the union at each use site (the shipped
shape) — losing a member is not a type error anywhere: the value still
arrives, and each consumer renders it as whatever its default branch says.
That is how `open_failed` reached the web as "the negotiator recommends a
decision", and how a `turn_cap` pause — added in #1494 — has been silently
dropped from A2A threads ever since.

### D42. Discovery fails when it cannot hand a batch off
Chose: `matchesReadyNode` throws when a wake fails, so the discovery job
retries. Persistence dedupes and the wake coalesces on the signal, so a retry
is idempotent.
Alternative rejected: logging and continuing — the batch persists and nobody
is ever woken, which is precisely the silent loss the whole hand-off exists to
prevent.

### D43. The interrupted-round repair defers that round's reflect
Chose: the repair settles and stamps the interrupted round — it must, because
the size stamp is guarded on the intent's current round and cannot be written
once the counter moves — but fires its reflect only when this turn is NOT
about to supersede it. Eligibility is computed first, so the common case (no
matches to open, so the repaired round stands) takes the enqueue-then-stamp
ordering of D40.
Alternative rejected: settling with the reflect unconditionally — the same
turn then bumps and carries those negotiations into the next round, so the
queued reflect runs against an empty round and wakes the agent with "every
negotiation of this round has paused" and nothing listed, inviting a kickoff
that strands the round holding the actual work.

### D44. The reply stage never throws — the whole stage, not just the model call
Chose: the delivery and the ledger append inside the reply stage are guarded
too, the way `recordKickoff` already guards its ledger.
Alternative rejected: guarding only the model call (the shipped shape) — the
acts are already executed and the reply may already be on the principal's
screen, so a database blip after delivery failed the job and the retry
re-decided and re-executed every verdict and kickoff on top of it.

### D45. A failed wake is kept, and its slot is not reused
Chose: `matches_ready` jobs keep failed records, and a slot only accepts a new
batch while its job is still waiting to start — a running job has already read
its match list, and a failed one will never read anything again.
Alternative rejected: `removeOnFail: true` (the shipped shape) — a terminally
failed wake deleted the only record that a persisted batch never reached its
agent, which is the silent loss D42 makes `matchesReadyNode` throw to prevent,
moved one hop downstream.

### D46. The owner-verdict id lane lists the statuses the agent numbered
Chose: `passVerdictOnOpportunity` re-lists with
`PERSONAL_AGENT_MATCH_STATUSES` on the agent's id lane.
Alternative rejected: the narrower verdict set (the shipped shape) — the
agent's context numbers `latent`/`draft` matches, so "accept the first one"
before kickoff always answered `unknown_counterparty` for a match
`opportunityService` accepts perfectly well.

### D47. The two verdict lanes list different status sets, on purpose
Chose: the POSITION lane (`passVerdict`, behind the persona/MCP verdict tools)
lists the narrow `ACTIONABLE_VERDICT_STATUSES`; the ID lane
(`passVerdictOnOpportunity`, the PersonalAgent's) lists the wide
`PERSONAL_AGENT_MATCH_STATUSES`.

The difference is the ref, not the taste. A position is an index into a list
the caller was shown, so widening the set renumbers every entry and the
verdict lands on a different person — the exact failure that module's header
exists to prevent. An opportunity id cannot be renumbered, so the id lane can
list everything the agent's context numbered, which it must: re-listing the
narrow set made "accept the first one" before kickoff always answer
`unknown_counterparty` for a `latent` match the service accepts.

Round 4 fixed this at the reported symptom and put the wide set on the WRONG
lane — the position one — turning a failed accept into a possible wrong-person
decline. There is now a test per lane, and one asserting the wide set is a
strict superset of the narrow one, so the pair cannot drift again.

### D48. A wake fails where a retry exists, and never at a waiting user's expense
Chose: two host callbacks over one protocol behaviour. `matchesReady` throws —
the discovery queues retry, and a batch that persisted with nobody woken is not
a successful discovery (D42). `matchesReadyBestEffort` retries, then RECORDS
the loss at error level with the ids needed to replay it, and lets the matches
through; it is wired to the chat and MCP tool graphs, where the caller is a
user waiting on `discover_opportunities` and nothing retries behind them.
Alternative rejected: one throwing callback everywhere (round 3's shape) — a
transport blip turned a discovery that genuinely persisted matches into a
failed tool call, losing the user's results.

### D49. A failed wake holds its slot only until the next batch
Chose: a terminally failed `matches_ready` job is kept as the record that a
batch never reached its agent, but a NEW batch for the same signal reclaims
the slot — a fresh wake for the same work supersedes the record, and the
replacement is logged.
Alternative rejected: holding the slot for the seven days BullMQ retains a
failure (round 4's shape) — both slots go dead, coalescing stops entirely, and
every subsequent batch becomes its own kickoff: N strategy messages and N
round bumps into the principal's conversation.

### D50. A ref the judgment seam supplies is checked, not asserted
Chose: a `promote`/`reject` naming a negotiation this turn cannot see is
skipped and ledgered with outcome `error`.
Alternative rejected: the non-null assertion — it is only sound because the
BUNDLED validator bounds the index, and `judgment` is a documented swap seam,
so a host or fixture implementation would throw mid-turn and abandon (then
retry) every act already executed above it.

### D51. One brief per SEAT, authored by that seat's own agent (log D18)
Chose: `brief` stops being one column read by whoever speaks. It is keyed by
the seat's userId, the initiator's kickoff writes only its own, and a seat that
arrives without one authors it at its first turn — `negotiationNode` already
receives `{ userId, intentId, negotiationId }`, so no new wake is needed.
A seat sees only its own brief, on the read tools too.

The counterparty's brief is written from what THAT side can honestly see: its
own signal only when it can be established beyond doubt (a premise-matched
actor's `intent` names the intent it matched AGAINST, so an actor carrying
this negotiation's own intent is treated as unknown rather than guessed at),
why the match was made, and the thread. The prompt's law is mostly about not
inventing the rest: "your seat will argue whatever you write here as if your
client had said it."

Alternatives rejected: (a) keep the shared brief and soften the prompt — the
counterparty still argues the initiator's constraints, just less confidently;
(b) give the counterparty no brief — worse than #1494's deterministic "opened
from a signal" line; (c) have the initiator author both — it does not know the
counterparty's principal, so it would invent them. Migration 0148 drops
`brief` for `briefs` with no backfill: a seat without one authors it, which is
the new mechanism recovering in-flight rows rather than a migration guessing.

### D52. Kickoff opens exactly the matches the agent decided from (log D19)
Chose: at most `MAX_MATCHES` (12) — the same cap `assembleContext` uses for
the prompt — with the opens running three at a time. The agent decided from
twelve, so it opens those twelve; the rest wait for the next round, which is
what rounds are for. The end-of-turn re-check deliberately does NOT wake for
them: it compares against everything this turn KNEW about, so only a match
that arrived mid-turn earns another wake.
Alternatives rejected: (a) unbounded — forty matches means forty concurrent
briefs and forty self-playing negotiations in one job, past the chat
controller's 90-second wait and into provider rate limits, whose failures then
land in `compensateFailedOpen`; (b) one job per match — loses the property
that a round settles together, which the entire reflect trigger depends on.

### D53. Interrupted-vs-in-flight is resolved by a staleness bound (log D20)
Chose: `kickoffStartedAt` marks a round as INTERRUPTED only once it is older
than ten minutes — comfortably longer than any real kickoff, far shorter than
a stuck one matters. Under the bound a concurrent turn leaves the in-flight
round alone rather than settling it out from under the turn still opening it.
Alternatives rejected: (a) a per-intent Redis lock — correct, but new infra
and a new failure mode (a lock held after a crash) for a race the bound
already closes; (b) relying on single-worker serialization — the queue's own
code contemplates several workers, so that assumption fails silently at the
first replica.

### D54. After the round bump, nothing throws (log D22)
Chose: one policy for the whole kickoff region. Before the bump a failure is
safe to retry, so it propagates. After it, the turn has done irreversible,
principal-visible work — a strategy message and a new round — so every failure
below is logged, ledgered and carried past: the compensation, the round read,
the size stamp (retried three times first) and the reflect enqueue. A round
left unsettled by one of them is recovered by the interrupted-round repair
(D53), which exists for exactly that.
Alternative rejected: letting the stamp or the compensation throw so a queue
retry finishes the round — that retry re-runs the whole turn, and the second
strategy message and second round bump are the outcome `recordKickoff` was
already swallowing its ledger error to avoid. Rounds 4-6 oscillated between
the two halves of that contradiction; this states one policy for the region.

### D55. A negotiation binds a signal PER SEAT (log D21)
Chose: `metadata.intentId` / `metadata.round` become `metadata.seats`, one
binding per seat keyed by intent id (`{ userId, round }`) — the shape D18
already established for briefs. A kickoff binds its own seat and touches no
other's, so a re-kick from either side can neither overwrite the other's brief
nor leave the task in neither round: both were guard-able bugs and are now
impossible by construction. The pause-side reflect check runs for every bound
seat.

Forced, not preferred: the doc's terminator rule is that a side which wants
out pauses `ready_for_verdict(reject)` and ITS OWN IS-A rejects, and an IS-A
can only decide a negotiation its own signal can see. With one owning intent
the counterparty's agent could speak here but never promote or reject, which
deletes half the loop's terminators.
Alternatives rejected: (a) the opening signal owns it and the counterparty
learns via the opportunity status — simpler, and what the discarded round-6
patch did, but it silently removes those terminators; (b) resolving the seat's
intent by lookup at each turn — no schema change, but it re-derives on every
read something the task should record, and the lookup is exactly the ambiguous
premise-matched case #1494 documented as unreliable. Migration 0149 backfills
the opener's binding losslessly.

### D56. The prose gate stays on strategy copy; the retry is what changes
Chose: `strategy()` is retried twice and falls back to fixed copy, and it
keeps `isSafeAgentMessageProse`.

The gate false-positives — ordinary scheduling language like "approach all
three at the same time" trips the shared-event claim family — and that is
worth the cost, because the strategy is DELIVERED to the principal and does
discuss their matches. The claim families it rejects (attendance, membership,
residence, co-presence) are exactly what must not be asserted about a
counterparty in a message the principal will read as fact. What made the false
positive harmful was the terminal throw, not the rejection: three attempts
against an identical prompt and the wake was lost. With a retry and a fallback
the cost of a false positive is one bland sentence.
Alternative rejected: narrowing the gate to the identifier check for strategy
prose only — it would let "Dana is a member of the co-op, so I'll..." through
to the principal as fact, which is the exact leak the gate exists for. If a
future change widens it, widen it for every delivered surface at once, not
here.

### D57. A background turn never ends in silence
Chose: an intent-scope turn on `matches_ready` or `all_paused` that produced
no acts at all delivers one fixed line saying so.
The doc's node is "look at the state, maybe ask, else act" — deciding NEITHER
is not a state that contract has, but a model can return an empty act list.
There is no reply stage behind a background event, so the turn would end
silently; on reflect it would also consume the round's one retained job, and
nothing would ever wake that signal again. The line keeps the loop reachable:
the principal's next message is an ordinary turn that can ask or act.
Alternative rejected: treating an empty list as a failure and retrying — the
retry runs an identical prompt (D30), so it fails the same way and loses the
wake instead of ending it honestly.
