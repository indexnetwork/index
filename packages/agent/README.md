# @indexnetwork/agent

A personal agent that a host runs on someone's behalf.

`Agent` provides the model/tool loop. `NegotiationAgent` is the long-lived
runtime for a principal and intent: it owns one human/agent conversation and
schedules concurrent agent/agent negotiations for that intent's matches.

It works the way Claude Code, Hermes or OpenClaw do — a system prompt, a set
of tools, and a loop that runs until the work is done. Two things make it
different:

- **It doesn't own its instructions.** A centralized host imports this
  package, constructs an `Agent` with a `systemPrompt`, injects the
  operations it may perform, and calls `run()`. One package serves every
  user.
- **It can stop to ask.** When the agent needs something only the party it
  represents can tell it, `run()` hands the question back rather than
  guessing or blocking.

## Terms in this library

| Term | Plain-language meaning |
| --- | --- |
| **Principal** | The person the agent represents. Their instructions establish what the agent may do on their behalf. |
| **Intent** | The goal being pursued, such as finding a research collaborator. A goal is not blanket permission to make commitments. |
| **Host** | The application running the library. It supplies the model, tools, storage and access controls. |
| **H2A** (human-to-agent) | The private conversation and review with the principal. H2A interprets their instructions, asks questions and writes briefs. |
| **A2A** (agent-to-agent) | Negotiation with a **counterparty**: the other person, represented by their agent. A2A works within its saved brief, not the full private human conversation. |
| **Brief / delegation** | Private instructions H2A saves for A2A: the objective, facts, permissions, conditions and next focus. A **standing brief** covers unseen counterparties; a **specific delegation** is a complete replacement for one negotiation. Neither creates permission the principal never gave. |
| **Authority** | The principal's permission to discuss, agree to or perform something. These are separate permissions: being allowed to negotiate a data-sharing arrangement does not authorize sending the data. Tool availability and another agent's approval do not grant authority. |
| **Scope and conditions** | Who and what a permission covers, and its limits. “Discuss aggregates with Leo only if our product is named” does not authorize raw data, another recipient or dropping the naming condition. A short “yes” inherits the exact question's scope. |
| **Revocation** | An explicit withdrawal of permission. “Cancel Priya” applies to Priya, not every negotiation. A broader preference that conflicts with an earlier specific approval may need clarification rather than automatic cancellation. |
| **Agreement** | Recorded agreement on negotiated terms. In Index, A2A `accept` settles the negotiation as `agreed` and moves the opportunity to `pending` user approval, never `accepted`. It is not owner approval or proof anything was carried out. |
| **Execution** | An action actually succeeding. A successful `submit_turn` proves a negotiation turn was recorded, not that an introduction, booking, payment or data transfer happened. |
| **Activation / review** | A permitted trigger and the H2A work it starts. Accepted human input or explicit intent creation/broadcast can activate H2A; A2A activity cannot. |
| **Local pause** | A2A stops its current work because it lacks facts or permission. This does not ask a question, wake H2A or block other negotiations. |

### Authority, agreement and execution: an example

You say: **“Find a time for a call with Priya, but ask me before booking.”**

1. H2A saves a brief allowing discussion of times with Priya, but not a booking.
2. The agents agree on a suitable time. They have negotiated terms; the call is
   **not booked**.
3. At the next permitted review, if the opportunity is still `pending`, H2A reports
   that the negotiation passed and is ready for review in the application UI. It does not ask
   you to approve or reject the opportunity in chat.
4. You accept or reject the opportunity through the application's controls.
   Neither agent agreement nor opportunity acceptance proves the call was booked;
   only a successful booking operation does.

H2A can ask for facts, preferences and negotiation authority, but it can never
accept or reject an opportunity. If you say “accept” or “reject” in chat — even
in answer to an older approval question — H2A directs you to the application UI
without claiming that the status changed. It does not reopen a settled negotiation
to implement that decision. Chat permissions and saved briefs cannot replace the
application's opportunity approval gate.

Booking is illustrative; `NegotiationAgent` does not include a calendar tool.
H2A is instructed to report completed actions only from evidence such as a
confirmed operation result or the principal explicitly confirming they did it
themselves.

These are model-guided decision rules in `NegotiationAgent`, **not a deterministic
permission engine**. Hosts must still enforce access, ownership, current-context
checks and action-specific approval gates. The generic `Agent` loop does not
validate arbitrary tool operations against natural-language permissions.

## Negotiation sessions

`pairKey` is the conversation thread; `id` and `opportunityId` identify one numbered
session. H2A sees both negotiation outcomes and the current `opportunityStatus`:
agent agreement does not overwrite a later user acceptance, rejection or expiry.

`open_negotiation` selects a completed search candidate or a visible `negotiationId`.
Unsettled, paused and turn-limited work is returned unchanged; explicit re-delegation
remains the way to resume eligible work. A fresh selection of the latest terminal
session may create a new session and opportunity with a complete new private brief.
Previous turns are separate `previousSessions`, not current offers, authority or
turn-limit usage. Inbound work uses its own standing brief, not an old specific one.
No new H2A wake source or opportunity approval tool is added.

Hosts must atomically commit the new session and brief, fence the observed latest
ID/outcome/opportunity status, and reconcile exact created-request replays to their
original session. `NegotiationOpeningRequest` now carries `target`, discriminated
`source` and these fences instead of a mandatory retrieved `candidate`. Negotiation
reads must supply session identity/history and opportunity status; effect writes
must fence status changes as well as turns and outcomes. These are breaking host
contract changes in agent 0.10.0; the protocol package's public API is unchanged.

## Prompts

Start at [prompts/agent.prompt.ts](src/prompts/agent.prompt.ts). It contains the
agent's prompt text and the functions that compose it for both the API and TUI.

| Model message | Composition | Context included |
| --- | --- | --- |
| System, H2A | `buildNegotiationSystemPrompt` → `buildAgentSystemPrompt` | Current confirmed principal context and intent, protocol guidance, identity and date. |
| System, A2A | `NegotiationAgent.createAgent` → `buildAgentSystemPrompt` | Protocol guidance, identity and date; authority comes from the private brief. |
| User, for an A2A turn | `buildNegotiationTurnPrompt` | `MATCH_INSTRUCTIONS`, current negotiation, separately labelled shared session history and exact saved brief. |
| User, for H2A communication | `buildPrincipalInboxPrompt` | `PRINCIPAL_INBOX_INSTRUCTIONS`, canonical history, accepted input batch, pending questions, standing brief, specific delegations, live negotiations and agreements. |

[Protocol guidance](../protocol/src/protocol/protocol.prompt.ts) stays owned by
`packages/protocol`. The [API host](../../services/api/src/lib/agent/negotiation.host.ts)
injects it with confirmed profile context; the scenario TUI injects the same
guidance with the scenario's private `instructions` as context.

Tool definitions are passed separately to the model. Their schemas and handlers
live in [negotiation.agent.ts](src/negotiation/negotiation.agent.ts) for A2A and
[principal.inbox.ts](src/negotiation/principal.inbox.ts) for H2A. The
[model loop](src/core/loop.ts) sends the composed system message, working history,
and user input, then appends assistant messages and tool results as the run proceeds.

## Purpose

One agent per party, with one identity. `for()` scopes it to an intent —
that narrows what it's working on, never who it is.

```ts
const agent = new Agent({ identity, systemPrompt, tools, model });  // one per party
const raising = agent.for("Raise a 400k pre-seed round");     // same identity
```

The loop decides *what to do* — which tools to call, when to ask the user,
when the work is finished. Everything it can do to the outside world is a
tool the host handed it. Negotiating with another party's agent is one of
those tools: the host injects it, the loop calls it, and nothing here knows
how a turn travels.

## Requirements

- **Runtime**: Node ≥ 20, or Bun — anything with global `fetch`. ESM only,
  no CommonJS.
- **An [OpenRouter](https://openrouter.ai) API key**, and a model that
  supports tool calling.

## Installation

```bash
bun add @indexnetwork/agent
```

## Usage

```ts
import { Agent, ModelClient, askUserTool, type Tool } from "@indexnetwork/agent";

const agent = new Agent({
  model: new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY }),
  identity: { name: "Tomas", id: "did:example:tomas" },
  systemPrompt:
    "You act for Tomas. Ask him directly about anything you have not been told — " +
    "a price ceiling, dates, collection. Do not invent his preferences.",
  tools: [
    ...indexOperations(session),  // yours; see Tools
    askUserTool(),
  ],
});

const scoped = agent.for({ id: "int_cfo", statement: "Bring in a fractional CFO" });
const result = await scoped.run("Take a turn in every negotiation waiting on you.");
```

### Identity and intent

```ts
interface AgentIdentity {
  name: string;         // the principal's display name
  id: string;           // stable id for the party — a DID, profile URL, account id
  description?: string;
}
```

`for(intent)` returns an agent sharing the *same identity object* — not a
copy. So identity transfer is structural: nothing has to remember to pass it
along. What changes is the system message the model runs under.
`instructions()` shows you exactly what the model is told.

### Running, and stopping to ask

`run()` asks the model, runs the tools it calls, feeds the results back, and
repeats. It ends three ways:

| `end` | Meaning |
| --- | --- |
| `"done"` | The model answered with text instead of another tool call. |
| `"needs-input"` | The agent asked the user something. See `pending`. |
| `"max-steps"` | The step cap was spent while it was still working. |

A tool that *throws* ends nothing — the error goes back to the model as that
tool's result, so it can retry or explain, the same way a failed command
doesn't end a session. Unknown tool names and malformed arguments come back
the same way.

When the agent asks a question, **nothing is held open**. `run()` returns,
and the host resumes whenever the answer arrives — seconds later or days
later, in this process or another:

```ts
let r = await scoped.run("Take a turn in every negotiation waiting on you.");

while (r.end === "needs-input") {
  const answer = await ask(user, r.pending!.question);   // your channel
  r = await scoped.run(answer, { messages: r.messages });
}
```

That loop *is* the live-chat case; there's no separate callback API. For an
unattended run, persist `messages` and resume from storage — or give the
agent a `history` store and omit it; `run()` reads and writes the store
itself. On resume, the answer is recorded as the pending tool's result —
not as a new user message — so the model sees a question it asked and an
answer to it.

### Tools

```ts
interface Tool<I> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;   // JSON Schema, handed to the model verbatim
  run?: (input: I, context: ToolContext) => unknown | Promise<unknown>;
  suspends?: boolean;                    // hand back to the host instead of running
}
```

`ToolContext` carries the `agent` and the run's `AbortSignal`.

**Index Network operations are injected by the host.** This package
deliberately knows nothing about how Index is reached — the host already
holds the session, auth and client, so it passes those operations in as
tools. What ships here is `defaultTools()`: `askUserTool()`. Passing your
own `tools` array replaces the defaults entirely, so spread `defaultTools()`
if you want to keep them.

A tool with `suspends` never runs. The loop stops when the model calls it and
hands the arguments to the host, which supplies the result by resuming. That
is all `askUserTool()` is — anything else needing a human or another system
can work the same way.

### Models and quota recovery

The host constructs a model implementation and injects it into `Agent` or
`NegotiationAgent`. The supplied `ModelClient` implements OpenRouter access:

```ts
import { Agent, ModelClient, NegotiationAgent } from "@indexnetwork/agent";

const models = ["google/gemini-3.8-flash", "anthropic/claude-haiku-4.5"];
const model = new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY, models });
const agent = new Agent({ identity, systemPrompt, model });
const negotiator = new NegotiationAgent(participant, host, { model, records });
```

OpenRouter accepts one to three models; an injected list replaces the defaults
completely. Use `models: [modelId]` for a single model. Omitting the list uses
`DEFAULT_MODELS` in [core/model.ts](src/core/model.ts), which also owns all retry
and cooldown policy. The TUI and REST host use that same implementation.

`Agent` and `NegotiationAgent` require a `model` object; model IDs, credentials,
timeouts, and retry attempts belong to `ModelClient`, not the agent constructors.
The agent loop depends only on the exported `Model.complete(messages, tools,
options)` contract. Its per-call options contain `signal` and `onRetry`. A host
may share one model client across principals: each call retains its own
cancellation and retry observer, while conversations stay on their agents.
The loop does not read model credentials or construct an OpenRouter client.

OpenRouter handles provider selection and ordered model fallback. If it still
returns a rate limit, agents using the same key and list in this process share
a cooldown based on `Retry-After` or `X-RateLimit-Reset`, including headers in
error metadata. Without a hint, waits grow from 30 seconds to 5 minutes, with
jitter to spread retries. Quota failures wait until recovery or cancellation;
they do not exhaust the normal three-attempt budget for transient failures.
The agent's `onRetry` callback (or `NegotiationHost.retry`) reports waits, and shutdown
interrupts them immediately. Authentication,
credit, and invalid-request errors fail promptly. Individual provider quotas
are left to OpenRouter; there are no local per-model request counters.

### Always-on negotiations

- Initialize one `NegotiationAgent` per principal/intent. The host owns records, execution ownership and protocol operations; each activation creates fresh model context.
- Accepted `message()` / `answer()` input, explicit `wake()`, or `activate({ id, type: 'intent.created' })` / `activate({ id, type: 'intent.broadcast', networkId })` calls activate H2A. The API host emits these after creation/initial linking or a new network assignment. Startup, scans, updates/resume, A2A activity and opening the app remain observational.
- `wake()` records a private `h2a.wake` receipt and reviews current context without adding a chat message or invalidating existing A2A briefs. It creates no new authority; H2A decides whether a reply, question or selected brief update is useful.
- Lifecycle and manual-wake activations are private, deduplicated records, not chat messages, answers or consent. They use the same context and delegation guards as user-triggered reviews. Delivery is best-effort; restoration never replays accepted events.
- `NegotiationHost.event` optionally observes typed activation, completed searches, explicit candidate selections/openings, standing/specific brief writes, questions, completed or stale-discarded reviews, and A2A inbound/turn/pause/settlement transitions. Events contain stable IDs and outcomes, not private briefs, answers, or counterparty messages. The API writes them to structured `agent-events` logs; observation is never a wake source. `authority.requested` and `action.executed` are intentionally absent until the product has dedicated authority-request and verified execution transitions; question issuance and negotiation turns are not relabelled as either.

```ts
import { NegotiationAgent } from "@indexnetwork/agent";

const agent = new NegotiationAgent(
  {
    owner: { id: user.id, name: user.name },
    intentId: intent.id,
    guidance,
    client,
  },
  host,
  { model, records },
);
await agent.start();
void agent.receive({ kind: "opportunity.matched", opportunityId });
void agent.receive({ kind: "negotiation.updated", opportunityId });

// Explicit review without a message or new principal evidence:
await agent.wake();

// Read conversation, pending, toolCalls, reviewing, reviewNotice and
// isNegotiating(id) when host.conversation() fires.
const questions = agent.pending;
// Collect drafts locally; submit once every question has a complete answer.
if (questions.length) await agent.answer(questions.map((question) => ({ questionId: question.id, text: drafts[question.id] })));
else await agent.message(humanInput);

await agent.stop();
```

| Contract | Responsibility |
| --- | --- |
| `PrincipalRecords.start()` / `close()` | Acquire and release host execution ownership. |
| `read()` | Read current intent/profile, canonical messages, question retirements, standing brief and specific delegations with H2A source and brief-relevant A2A execution versions. No checkpoint write. |
| `accept(messages)` | Atomically accept one user message/event or the complete current answer batch; return all committed entries or `null` with no writes. Validate exact question IDs under host concurrency control, preserve historical answer evidence and clear standing readiness on principal input. |
| `writeStandingBrief(brief, expectedVersion)` | Commit the complete intent-wide mandate from the current H2A activation. This enables new matches but resumes no existing work. |
| `write(effects, expectedVersion)` | Commit H2A messages, `retiredQuestionIds` and complete specific delegations together; reject stale records, negotiation observations and duplicate identities before publishing notifications. |
| `NegotiationClient.listNegotiations()` / `readNegotiation()` | Read current protocol records, including passive work and agreements. |
| `submitTurn()` | Enforce current ownership, source context and `expectedTurnCount`; at most one POST attempt per run. |
| `NegotiationHost` | Observe conversation, status, turns, retries, steps, completion and errors. A null opportunity ID identifies an H2A failure. |
| `NegotiationSpeaker` | Optional native execution boundary used by Hermes. Receives fresh prompts, exact domain tools, `ToolContext`, cancellation and `onStep`; propagates completion exceptions without offering another tool attempt. The ordinary agent loop remains the default. |

- H2A must establish a standing brief before discovery or review completion. One review may combine a useful principal-facing message, 1–3 independent questions, exact retirements and selected delegations. It answers direct requests and reports material results, obstacles or previously unreported outcomes, but does not add acknowledgments or routine progress narration. An empty decision stays silent, skips the final `PrincipalRecords.write()`, ends the model call, and leaves A2A free to continue. Persist outputs before starting dependent A2A work.
- Questions retain their batch membership, ID, wording and 2–4 suggestions until answered or explicitly retired. `pending` is an array derived from records; `answer(answers)` accepts exactly one nonempty answer per current question, atomically. Missing, extra, duplicate, empty, stale or retired answers save nothing and activate nothing. A complete batch activates H2A once with all answers.
- Direct messages remain `user` input even during a batch; they do not implicitly answer or retire questions. H2A can select `review_principal_inbox.retireQuestionIds` when explicit later principal corrections make those questions obsolete. The host commits private retirement records atomically with the other review outputs and emits `question.retired` only after success. Unrelated questions and drafts retain their identities; new questions are allowed only when no old questions remain. Drafts have no server effects.
- Retirement requires principal input after issuance; lifecycle events cannot retire questions. A manual Wake may reassess an already saved correction, but supplies no correction evidence itself. Interpretation remains model-guided. Hosts implementing `PrincipalRecords.write()` must support the required `PrincipalEffects.retiredQuestionIds` array (empty when none), validating and committing it under the same context and ownership fences.
- New questions have no negotiation references. Historical messages retain their scope and match references so old approvals do not acquire broader authority.
- A2A receives only one effective private brief and the current protocol record: the latest complete specific delegation when present, otherwise the standing brief. New principal messages/answers supersede older specific briefs; manual wakes and lifecycle activations alone do not.
- `pause_negotiation()` ends local work without a turn, question, answer promise or H2A activation. Unchanged duplicate notifications remain idle; only a committed specific update from a later H2A activation or a meaningful protocol change can resume eligible work.
- An A2A submission result ends its local run immediately, without another model response or tool attempt. Eligible subsequent turns continue independently; agreement/rejection remain terminal.
- Each run discards its model transcript. Concurrent matches share only ephemeral scheduling and serialized outgoing writes; no task map, request queue or processed-input marker is persisted.
- Restart reads committed history and exact question status without rerunning interrupted work. Exact opening outputs are reconciled by their immutable request ID; otherwise the next permitted activation reassesses committed evidence. An uncertain POST is never retried automatically.
- `reviewing` and `isNegotiating(opportunityId)` expose live H2A/A2A work through read-only observations. `reviewNotice` explains when a stale negotiation change discarded the latest accepted review and fresh input is needed; it clears on the next accepted activation and never schedules one. `host.conversation()` fires when work starts and ends as well as when history changes. Activity is ephemeral, excludes stopped/cancelled work, and never activates H2A.
- `toolCalls` exposes ephemeral H2A tool names and running/completed/error/cancelled status, grouped by `reviewId` and anchored to the preceding visible message. The same observation callback repaints hosts; these entries are not persisted, included in model context or sent to counterparties. Completion describes the tool call, not later effect persistence.
- An H2A failure stops the runtime and preserves the original error for subsequent `message()`, `answer()`, `wake()` and `activate()` calls. Hosts can explain the failure rather than reporting a generic rejection; no failed input or model request is silently retried.
- `stop(opportunityId)` cancels one local task without changing questions; `stop()` cancels all model work and releases execution ownership. Committed history survives both.
- The [scenario TUI](../agent-tui/README.md) uses `MemoryPrincipalRecords`. The [API host](../../services/api/README.md) uses intent-tagged `messages` for visible history and private standing/specific brief and retirement records; `intents.standing_brief_id` names the match-readiness record. Private records are excluded from chat history, previews and unread counts.
- The API stores no agent runtime row. Redis grants one expiring hosted owner per principal/intent, PostgreSQL owner advisory locks serialize executor handover and effect transactions, and record/turn fences reject stale or duplicate writes. Migration `0003_add_principal_records_and_negotiation_sessions` converts checkpoint-era durable evidence before dropping the obsolete table on dev's unprefixed baseline.
- Breaking change: `PrincipalState`, `PrincipalStore` and `MemoryPrincipalStore` are removed; hosts must implement `PrincipalRecords`, current negotiation listing and context-fenced turn writes.

### Knowing the time

The agent is told today's date, so a new "next Tuesday" can be resolved rather
than repeated. Historical relative dates use the original message's timestamp
and context, not today's clock; missing historical evidence stays uncertain.
Time is read as UTC; a host whose party lives elsewhere passes an instant shifted
into that timezone, and a test passes a fixed one:

```ts
new Agent({ identity, systemPrompt, model, now: () => new Date("2026-08-31T09:00:00Z") });
```
