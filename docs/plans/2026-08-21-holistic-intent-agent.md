# The holistic intent agent

**Status:** phase 1 in progress on `feat/intent-agent`. Phase 1 ships the
IntentAgent actor and collapses the DM ask→answer pipeline into it; the
phases after it are listed at the end.

**Date:** 2026-08-21
**Builds on:** [2026-08-18-conversational-questions](2026-08-18-conversational-questions.md)
(the parked-negotiation record, the settle/claim substrate) and the
answers-beat-staleness arc (#1474–#1476), which made that substrate honest.

## The direction (the owner's words)

> Think of the personal agent as an actual agent. They can contact the user
> when required, or they can simply have a conversation with the user. They
> can also conduct negotiations on behalf of the user. and based on the negs,
> they can decide to ask questions to the user. We are already scoping it to
> the intent to keep it simple.

> so many gates and code are just brittle.

Standing design law, carried over from the answers-beat-staleness arc: signal
updates are explicit and cascade nothing; answers are authoritative over
staleness; the agent proposes as a last resort, never acts automatically on
the user's behalf; code records and refuses only the impossible — judgment
lives in the prompt.

The division of labor after this change: **prompts carry judgment** (whether
a user message answers something, whether to ask, what to say); **code
carries effects** (durable acts, idempotent delivery, the disclosure
boundary, honest reads).

## What phase 1 collapses

The DM answer path today is a pipeline of judgment stages, each its own
model call or predicate, each a place to be wrong:

```
user message in the negotiator DM
  → answer-precedence gate (evaluator model call, before the persona runs)
  → enqueueQuestionAnswerReply
  → serialized consume_question_answers job
  → LLM router (second model call mapping reply → block refs)
  → resumeParkedNegotiation → settle → claim → resume queue
```

And the DM question surface is authored by a second pipeline: park →
`routeParkedQuestionEnqueue` → question-message regeneration job → authoring
model call → question block serialized into the DM → steps UI → edit rule →
notification set-difference → close-out.

Both pipelines exist to approximate one judgment a single agent can hold:
*given everything I know about this signal — the conversation, the facts my
client already gave me, the negotiations that are waiting — what should I do
with this event?* Phase 1 gives that judgment one holder.

**What is KEPT, untouched:** the effects substrate. The park itself (task
state, `askUserBinding` capture, expiry timeout), the parked-negotiation
reader (the durable record of every open information need), and the whole
settle → claim → resume spine (`settleInflightNegotiationAnswerFromDm`,
`claimNegotiationContinuationExecution`, the settlement-keyed run-existing
queue). Four PRs made that spine honest; the agent drives it, it does not
reimplement it.

## The IntentAgent

One logical agent per `(userId, intentId)`. It is not a persona and not a
graph: it is an actor with an inbox, a dossier, a ledger, and one model turn
per event.

### Serialization: the inbox queue

All events for one intent execute strictly one-at-a-time. The inbox is a
BullMQ queue in the house `QueueFactory` pattern
(`services/api/src/queues/intent-agent.queue.ts`) whose worker runs at the
factory default **concurrency 1** — the same property the question-message
queue relied on ("the worker processes one job at a time"). Global
serialization trivially implies per-intent serialization, and it is the
choice the existing infra supports with zero new machinery: no advisory
locks, no lock table, no group plugin. The cost is that two *different*
intents also serialize against each other; at current volume a turn is one
model call, and cross-intent parallelism (concurrency N plus a per-intent
advisory lock inside the processor) is a bounded phase-2 change that touches
only the worker options and the processor prologue. The actor property is
pinned by a harness-level test either way, so raising concurrency later
cannot silently break it.

Events are jobs, never coalesced away: `user_message` jobs are keyed by the
reply message id (redelivery dedup), `negotiation_needs_input` jobs by
`(opportunityId, taskId)` (the same park cannot wake the agent twice while
its job is queued; a later re-park has a new task and a new key).

### The loop

On event → assemble context → one model turn → execute the acts → ledger.

Context is assembled fresh per turn, all from honest reads:
- the signal's own text,
- the parked set (`readParkedNegotiations`) — the open/waiting state; the
  parked negotiation remains the only durable record of an information need,
- the active dossier entries,
- the recent DM transcript for this scope (chat session service),
- the agent's own recent ledger acts (what it already asked, when),
- the triggering event.

The model turn is one structured-output call in the house pattern
(`withStructuredOutput`, validate → retry once → fail): the model returns a
short list of acts, referring to parked negotiations and dossier entries
strictly **by index** — it never sees or emits an id, the same
anti-misroute rule the question router and the message author already
enforce. An act naming an index outside the lists rejects the round trip.
The model/config defaults to the negotiator persona chat's
(`getModelName('chat')`, currently `google/gemini-3-pro-preview`, honoring
`CHAT_MODEL`).

### The hands (tools), each one a ledger act

- `message_user(text)` — say something in the DM: an ordinary assistant
  message appended through the chat session service. Plain prose — **no
  question blocks**; the floor renders it as a normal chat message. The text
  passes the same identifier-leak gate authored question prose passed
  (`isSafeQuestionMessageProse`).
- `answer_negotiation(question, answer)` — the user's reply (or a dossier
  fact) resolves what a parked negotiation was waiting on. Execution is:
  write the answer as a dossier entry (source `'answer'`), then drive the
  existing spine — `resumeParkedNegotiation` over the production
  `negotiationAnswerConsumptionPorts` (settle → claim → resume, or
  record + retry for post-stall parks). A `recorded_unresumable` outcome
  appends the fixed honest copy and proposes re-discovery — offered, never
  performed.
- `note_dossier(text)` / `retire_dossier(entry)` — curate the intent
  dossier.
- `wait()` — explicit no-op: nothing to do. Still ledgered, so silence is
  auditable.

### The law (the prompt)

A versioned constant (`INTENT_AGENT_SYSTEM_PROMPT`, version suffix in the
name) in `services/api/src/lib/intent-agent/`. It carries: you are the
user's agent for this one signal; the conversation is your memory; ask only
what the dossier and the conversation cannot answer; never ask twice for
what you were already told — confirm instead; an explicit answer from your
client always beats staleness; you propose, the client disposes; everything
you may use at the negotiation table must be in the dossier; when a
negotiation cannot continue, say so honestly and propose re-discovery rather
than acting.

### The dossier (the disclosure boundary made legible)

New table `intent_dossier`: id, userId, intentId, text, source
(`'user_message' | 'answer' | 'agent_note'`), createdAt, retiredAt
(nullable). The agent curates it with its tools.

THE RULE — this is the room boundary: negotiation-facing material may come
only from dossier entries. When the agent answers a negotiation, the answer
text becomes a dossier entry first and the resume is fed from that entry —
enforced structurally in the one function that executes
`answer_negotiation` (the answer host takes the entry, not the transcript).
The raw DM transcript never feeds a negotiation turn; everywhere structure
is too expensive, the prompt carries the rule.

### The ledger

New table `intent_agent_acts`: id, userId, intentId, event (what woke the
agent), act (the tool called and its payload), createdAt. Append-only,
written by the loop, read only by the agent's own context assembly ("what
did I already ask"). It is the accountability substrate: every judgment
leaves a record answering *who decided this?* — the agent did, here, in
response to this.

## The two collapses

### Ask side

When a negotiation turn emits `ask_user`, the park + capture + settlement
arming are untouched. What changes is the trigger behind the park:
`routeParkedQuestionEnqueue` (the single seam every park producer funnels
through — the graph composition sites *and* the external-consultation pause
paths) stops enqueueing question-message regeneration and emits a
`negotiation_needs_input` event to the agent inbox instead. The
principal-unreachable fence stays exactly where it was.

The agent then decides. If the dossier or the recent conversation already
contains the fact, it calls `answer_negotiation` immediately —
**answer-from-knowledge**, the duplicate-question killer: the park still
happened (the graph's honest record of a gap), but the user is never asked
for what they already said. Otherwise it asks with `message_user`, in its
own prose, as a plain message; the pending ask is visible in its ledger and
re-derivable from the parked set.

### Answer side

In the chat controller, for the negotiator persona + intent scope: the
answer-precedence gate and the `enqueueQuestionAnswerReply` wiring are
replaced by a `user_message` event to the agent.

The seam chosen is the second of the two the direction offered: **the agent
owns asking and answering; the persona keeps the floor otherwise.** The
routing predicate is the same cheap read the old gate opened with — is
anything parked awaiting this user on this signal? While something is, the
turn is the agent's: the controller persists the user message, enqueues the
`user_message` event, awaits the serialized turn, and emits the agent's
`message_user` text as the turn's response (through the same
one-token-event/empty-orchestrator-stream shape the precedence gate's
`answered` path already used — the streaming pipeline is untouched). While
nothing is parked, the persona streams byte-identically to today, tools and
all. Replacing the persona wholesale (its toolset spans signal edits, the
verdict lane, memberships) is phase 2's full-chat-ownership question, not
this one; forcing it now would mean rebuilding the streaming path around the
inbox, which is exactly the rewrite this lane is told not to do.

Ordering is preserved by construction: the agent's turn runs where the gate
ran — before any persona tool can touch the message — so the 2026-08-20
class of incident (the signal edit rule consuming an answer) cannot recur.
If the awaited turn fails or times out, the controller answers with fixed
honest copy; the event stays on the inbox and retries in the background —
the answer is durably heard rather than fail-open lost.

## Deleted in phase 1 (not flagged off — no new flags, replaced behavior ships)

- `lib/question/answer-precedence.ts` — the gate. The agent turn is the
  precedence now, in the same controller position.
- `lib/question/question-answer.router.ts` — the reply→refs router model
  call. The agent's `answer_negotiation` act is the routing.
- `lib/question/question-message.author.ts` — question-block authoring. The
  agent writes its own prose questions.
- The question-message queue's answer-consumption job
  (`consume_question_answers`, `enqueueQuestionAnswerReply`,
  `QuestionAnswerJobData`) and its authoring/regeneration/notification
  path. What remains of the queue is close-out only: a transition that
  empties a parked set rewrites a **legacy** open question-message to the
  fixed closed prose, so blocks delivered before this change do not linger
  as open asks. The exhaustion evaluator keeps its transition hook and now
  enqueues only that close-out.
- The `questionRegenerationPending` machinery (SSE flip, queue-state read).
  The bootstrap field is served as constant `false` so existing web clients
  keep parsing; agent asks are ordinary messages with no pending state.
- The `answer_pending_question` host's queue path: the host (persona tool
  and MCP tool alike) now calls the agent's answer executor directly — same
  dossier-entry-first rule, same spine, ledgered with the tool as the waking
  event. No protocol edits were needed for this.

Tables are left alone; no migration drops data.

## Phase 2+

- **Verdicts through the agent** — the accept/reject lane (#1471) becomes
  agent judgment with the same proposal discipline.
- **Proactive contact** — the agent decides to open the conversation
  (new-match arrivals, expiring windows), with notification hanging off its
  `message_user` acts.
- **Full chat ownership** — the agent takes every turn of the intent DM and
  the persona graph retires from this scope; requires the inbox to carry
  streaming turns.
- **Cross-intent parallelism** — worker concurrency N with a per-intent
  advisory lock in the processor, if inbox latency ever warrants it.
- **Question-block UI retirement** — once no legacy open blocks remain, the
  steps renderer and block parser leave the floor.
- **MCP surface** — expose the dossier and the ledger to the user
  (`read`/curate), and route external-agent asks through the inbox.
- **Dossier UI** — the disclosure boundary as a visible, editable list.
