# Conversational questions

**Status:** proposed
**Date:** 2026-08-18
**Supersedes:** the delivery half (PRs 2–5) of
[2026-08-17-personal-agent-authored-questions](2026-08-17-personal-agent-authored-questions.md).
The authoring half (PR 1) survives unchanged and is the foundation here.

## Goal

Questions are conversation, not cards. The negotiator delivers what it needs
from its client as a message in the signal's A2H DM — the conversation keyed
`('negotiator-intent', intentId)` — with questions embedded in a structured
block the UI detects and renders as steps. Notification hangs off the message,
not the questions. There is no questions table, no question rows, no question
IDs, and no Questions page.

Two design decisions drive everything else:

1. **The parked negotiation is the only durable record of an information
   need.** A negotiation that cannot proceed without its client parks
   (`task.state = 'input_required'` mid-flight, or stalls at finalize with a
   known gap). Everything about "what is being asked" derives from the set of
   currently-parked negotiations; nothing about it is stored twice.
2. **The question-message is a view, not a record.** It is a rendering of the
   parked set for one intent scope at one moment. It is regenerated, never
   merged.

## The model

### One conversation per signal, no cross-intent anything

The DM's unique index on `(userId, scopeType, scopeId)` means exactly one
conversation per signal. Questions arising from a negotiation surface in the
conversation of that negotiation's `recipientIntentId` — the *owner's* signal.
A user with three active signals can receive three question-messages; that is
correct, not a bug to fix later. No cross-intent coalescing, grounding, or
dedup. Near-duplicate questions across two signals are accepted as the price
of the scoping line the prior plan drew.

Each negotiation involves two users and therefore two intents. A stall that
needs User A's input surfaces in A's DM via A's agent; a stall that needs
User B's input surfaces in B's DM via B's agent. The same negotiation can
appear in both, asking each side only what that side holds.

### Two triggers, one coalescence rule

**Own-intent exhaustion.** When a user creates an intent, discovery yields a
match set and negotiations run. Exhaustion is a state predicate, not a
counter: *no negotiation on this intent is ongoing*. Ongoing means an agent
turn is scheduled or running. Parked counts as not-ongoing — a negotiation
waiting on the counterparty's human must not hold this user's message
hostage. Terminal states (`accepted`, `rejected`, `expired` per
`OpportunityStatus`, `database.entities.ts:507`) are not-ongoing by
definition; `pending` awaits owner approval, which is a different gate, not a
question. Because it is a predicate over states rather than a count, it
survives discovery re-runs and manually created opportunities.

At exhaustion, the agent authors one message into the intent's DM covering
every parked negotiation on that intent whose missing information belongs to
*this* user. Seeing all stalls at once is what makes the grouping good: it
merges overlapping gaps, orders the steps, writes one coherent preamble.

**Counterparty arrival.** A question toward a user whose own intent has no
exhaustion event coming (the User B case: their signal matched someone else's
new intent) does not wait. It writes immediately into that signal's DM.

**Coalescence.** Both triggers funnel through the same rule: if the intent's
conversation has an *open* question-message, regenerate it; otherwise create
one. The open message is the accumulator — the first question goes out
instantly, and everything arriving while it sits unanswered piles into it.
Batching is self-pacing: a responsive user gets small fast batches, an absent
user returns to one well-grouped message instead of a stack of pings. No
timers, no debounce, no scheduled flush.

### Open message, defined

*The newest message in the conversation, when it is agent-authored and
references ≥1 still-parked negotiation.*

The edit rule follows: **regenerate in place only while the question-message
is still the newest message in the conversation; otherwise send a fresh
one.** This single rule replaces all edit-safety machinery:

- User replied (even partially) → their answer sits below the message;
  rewriting text above it would corrupt the thread, so remaining and new
  questions go into a fresh message.
- Nothing new to ask but something to say → plain new message, no update.
- No per-question answered flags, no versioning, no immutability rules.

"Answered" is derived, never stored: a question is live iff its negotiation
is still parked. A negotiation that unparks for any other reason —
counterparty withdrew, expiry fired — drops out of the next regeneration
silently. Stale questions cannot exist because the message is recomputed
from the parked set, not patched.

### Regeneration, serialized

Two negotiations parking at the same moment must not race to create or
rewrite the message. All message work for a conversation goes through one
queue job keyed per scope — the BullMQ `jobId` dedup pattern the other queues
already use (e.g. `enrichment.queue.ts:99`), keyed
`question-message.${userId}.${intentId}`. The job:

1. Reads the current parked set for the intent (this user's side only).
2. If empty → nothing to do (a regeneration triggered by the last unpark may
   find the message already closed).
3. Authors the message via the negotiator, grounded exactly as PR 1 built:
   transcripts of the parked negotiations plus the signal's DM excerpt.
4. Applies the edit rule: update in place or create.

While the job is queued or running, the conversation shows a loading state so
a user staring at the DM doesn't see a half-stale message and answer it.

The same serialization point orders the nastier race — an answer arriving
while a regeneration is in flight — because answer handling for the
conversation runs through the same key.

### The question block

The message body carries a structured block the web client parses into steps.
Per question it encodes: the prompt text, and the negotiation(s) it unblocks
(one primary, optionally more — one answer can unpark several negotiations
that stalled on the same gap). The negotiation reference is the only
"binding" in the system now; it points at durable rows that already exist.

The block format is a rendering contract with the UI, not a persistence
schema. Its content is authored fresh at each regeneration; nothing depends
on stability across rewrites.

### Answers

The user's reply is a plain chat message. The agent reads it, routes what it
learned to the referenced parked negotiations, and resumes them — the same
park → answer → resume loop as the mid-negotiation consult, entered from the
DM instead of a card. Resume idempotency is a property of the negotiation
(a parked task resumes exactly once; the existing exact task re-resolution
and admission gate cover this), not of any settlement record.

A resumed negotiation may park again. That is a round: exhaust → message →
answer → resume → possibly exhaust again. A per-negotiation ask cap (2–3)
stops two agents ping-ponging their humans; past the cap the negotiation
stalls terminally instead of parking.

Answers also land in the DM transcript, which is already a grounding source
(PR 1, issue 4) — so a fact given once on this signal conditions every later
question on it without any dedicated write-back.

### Notification

- Message created → notify.
- Message regenerated with new questions → notify.
- Message regenerated without new questions (pruning, re-grouping) → silent.
- Answer-driven changes → silent.

The message is the notification unit. This is the difference between batched
and spam-with-extra-steps.

## Revisions to the 2026-08-17 plan

PR 1 (authoring: payload, grounding seam, DM excerpt, safety guard) is the
foundation and survives whole. The prior plan's **Survives** list changes:

| Previously survived | Now |
| --- | --- |
| Structured `Question` shape, persistence, answer/dismiss tools | Retired. Questions are message content; the parked negotiation is the record. |
| Questions page | Retired. The DM is the surface. |
| Idempotent settlement records, sibling dismissal | Retired as machinery. Their properties are re-provided structurally: resume-once by task re-resolution; sibling dismissal by regeneration from the parked set. |
| Exact task re-resolution, `input_required` admission gate, expiry timers | Survive — they are negotiation-level, and they are what "derive everything from the parked negotiation" leans on. |
| `assessConsultationEligibility` as admission policy | Survives. |
| `isSafeNegotiationQuestionText` on agent-authored text | Survives, and becomes more load-bearing: authored text now renders as a chat message, preamble included, not a caged card. |

The prior plan's PR 2 ("persist the authored question through the existing
binding/settlement machinery") is replaced by the regeneration job. Its PR 3
(post-stall onto the park loop) and PR 4 (DM face) carry over as work items
here with the same intent. Its PR 5 retirements all still happen and grow:
the questions table itself, its adapter surface, the answer/dismiss tools,
and the Questions page join the list.

## New machinery

- **Chat message content update.** `conversation.database.adapter.ts` has
  `createChatMessage` (`:5212`) and metadata upsert (`:5397`) but no content
  update; the edit rule needs one, scoped to agent-authored messages.
- **The question block format** and its parser/renderer in the web client
  (steps UI), plus the loading state while the regeneration job is pending.
- **The regeneration queue job** with the per-scope singleton key.
- **An exhaustion evaluator** hooked on negotiation state transitions:
  on every transition to parked/terminal, check the predicate for the
  affected intent and enqueue the regeneration job for its owner; on any
  park, enqueue for the parked side's owner regardless (counterparty
  trigger).
- **The ask cap** per negotiation.

## Risks

**External agents author rendered prose.** Under the prior plan the guard
checked a question that rendered inside a fixed card. Now the whole message —
preamble, grouping, question text — is agent-authored and renders as
conversation. When the personal-agent seat is held by a registered
third-party agent, `isSafeNegotiationQuestionText` (or a widened successor)
must cover everything that reaches the client, not just the question line.

**Editing a delivered message is new UX ground.** Streaming, read receipts,
and notification logic all assume append-only conversations. The
newest-message-only rule bounds the blast radius, but the web client needs to
handle a message changing under it gracefully.

**Draining the questions table.** In-flight question rows at cutover must be
voided (`voidedReason: 'retired_mode'` exists) or kept answerable during a
transition window. Answering a row whose reaction handler is gone must not
error. The table drops only after nothing reads it.

**Answer routing is now interpretive.** A card answer was structurally bound
to its question; a chat reply is routed by the agent. A misroute resumes the
wrong negotiation with the wrong fact. The block's negotiation references
plus the serialized queue make this tractable, but the resume step should
require the reference, not a guess — free-text replies that match nothing
get a clarifying follow-up, not a speculative resume.

**Flag state is not the in-code default.** `QUESTIONER_ENABLED`,
`NEGOTIATION_CONSULTATION_POLICY_MODE`, and the ask-user flag decide what is
live. Check Railway before assuming any of this runs.
