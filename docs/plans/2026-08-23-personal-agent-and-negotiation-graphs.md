# One PersonalAgent, two graphs

**Status:** implemented 2026-08-23/24. Step 1 (NegotiationGraph rewrite) shipped in
#1494, the one-persona collapse in #1495, step 2 (AgentGraph + IS-A) in #1496.
Follow-ups still open: external agents rebuilt on the new auth model, the
open-path atomic guard, step 3 host cleanup, and the questioner-substrate
deletion (owner call). Decisions taken without the owner are in
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
- **Brief** — the per-negotiation context IS-A writes at every kickoff. Not
  memory. The only thing from the DM that reaches a negotiation thread.
- **Strategy** — IS-A's plan for a round of negotiations, written in the DM
  before kickoff, visible to and correctable by the principal.
- **Round** — one kickoff and the negotiations it started, ending when all of
  them are paused. A counter on the intent.

## The cycle

```
discovery persists matches for intent I          (all of them — no cap)
        │  event: matches_ready
        ▼
IS-A ── (may ask first) ── strategy in DM ── brief × N in parallel ── kickoff ALL
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
   parallel. Run-1 briefs are minimal but never absent: `open` and `resume`
   take the same input.
4. IS-A kicks off **all** matches. No selection at kickoff; the negotiator
   filters by negotiating, IS-A judges at reflect where it has turns to judge
   on.

### Negotiator turns

A negotiator turn reads the negotiation thread and its brief and emits exactly
one of:

| Verb | Effect |
|---|---|
| `outreach` / `counter` / `question` | message to the counterparty; negotiation stays active |
| `pause(counterparty_silent, payload)` | the other side has not answered within the window |
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
if no active negotiation remains for `(intentId, round)` → enqueue
`reflect(intentId, round)` with job id `reflect:${intentId}:${round}`. Ten
pauses produce one reflect; a late pause from an earlier round cannot
re-trigger the current one. No cron, no Redis flag.

### Reflect

**Phase 1 — ASK.** Input: every paused negotiation of the round (reason +
payload), the DM. IS-A composes the questions the principal must answer
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
| `{ userId, intentId, negotiationId }` | negotiator | one turn: read thread + brief → one verb or one pause |

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
| `{ opportunityId, brief, intentId, round }` | open: create the negotiation and take the first turn. `intentId` resolves the source seat (its owner) and, with `round`, keys the all-paused trigger; `round` is the caller's batch counter, bumped once per kickoff batch |
| `{ negotiationId, brief }` | resume after reflect with new context |
| `{ negotiationId, turn, byUserId }` | apply a submitted turn — from AgentGraph or an external agent, same verbs, same validation → continue or pause. `byUserId` is the submitting seat; `apply` rejects a turn whose `byUserId` is not the speaker it computed |
| `{ negotiationId, pause: counterparty_silent }` | a timeout fired |
| `{ negotiationId, verdict: pending \| reject, reasoning }` | resolve — the only terminal write on the negotiation, from IS-A ACT. It also closes the negotiation behind an owner verdict on the opportunity, and never writes over an already-terminal opportunity status (D23) |
| `{ negotiationId }` | read |

`reasoning` is recorded on the outcome artifact and travels with the opportunity status — it is what the Radar card / closed card render. It is private to the resolving side: never persisted as a message into the A2A thread. A reject reason may contain principal-private material; the counterparty only ever sees that the negotiation closed.

Inside: `init` loads the opportunity, actors, profiles, intents and the brief
through the database port (callers pass ids, not pre-built user contexts);
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
D15+ below are the AgentGraph step's.

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

### D29. An interrupted kickoff RESUMES its round; it does not start another
Chose: kickoff first reads the intent's round stamp. An unstamped round that
already has tasks is the unmistakable signature of a kickoff that died after
opening (only kickoff bumps a round, and a bump clears the stamp), so the turn
finishes THAT round — ledger, stamp, all-paused check — and returns. The
ledger append is non-throwing and comes before the stamp, so the stamp is the
last durable write and a failure there leaves exactly the resumable signature.
Alternatives rejected: (a) making the whole turn transactional — the effects
span a model call, a chat message and N negotiation graphs; (b) swallowing a
stamp failure — the round would then never reflect, which is the failure D2
exists to prevent.

### D30. One impossible act drops; only an empty result is re-decided
Chose: the validator drops the offending act and keeps the rest, exactly as
`normalizeMessageOptions` drops a malformed chip, and returns `null` only when
a non-empty act list has nothing valid left in it.
Alternative rejected: refusing the whole round trip (the shipped behaviour
until review) — the retry sees an identical prompt with no feedback, usually
repeats the mistake, and the client's actual request, a verdict they asked for
in words, silently never happens while they get the failure copy.

### D31. `matches_ready` coalesces in two slots, never in one
Chose: a batch coalesces onto the primary job id while that job is still
queued, and onto a single follow-up id while it is running; if both are
running, it is enqueued unkeyed.
Alternative rejected: one id with `removeOnComplete` (the shipped behaviour) —
BullMQ silently returns the existing job for a duplicate id, so a batch landing
during a kickoff turn, which takes minutes, vanished into a turn that had
already read its match list.

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

