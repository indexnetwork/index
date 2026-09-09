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

## Prompts

Start at [prompts/agent.prompt.ts](src/prompts/agent.prompt.ts). It contains the
agent's prompt text and the functions that compose it for both the API and TUI.

| Model message | Composition | Context included |
| --- | --- | --- |
| System, shared by A2A and H2A | `buildNegotiationSystemPrompt` → `buildAgentSystemPrompt` | Agent instructions, injected protocol guidance and principal context, then identity, current date, tool-use instructions, and intent. |
| User, for an A2A turn | `buildNegotiationTurnPrompt` | `MATCH_INSTRUCTIONS`, current negotiation, private H2A history, accepted commitments, and any internal review note. |
| User, for H2A communication | `buildPrincipalInboxPrompt` | `PRINCIPAL_INBOX_INSTRUCTIONS`, H2A history, incoming messages, the pending question, queued requests, outcomes, and commitments. Direct messages also receive match status snapshots. |

[Protocol guidance](../protocol/src/protocol/negotiation.rules.ts) stays owned by
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
  identity: { name: "Tomas's Agent", id: "did:example:tomas" },
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
  name: string;         // the party name the agent speaks under
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
const negotiator = new NegotiationAgent(participant, host, { model, store });
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

Initialize one `NegotiationAgent` per principal/intent. The host supplies the
principal's confirmed context, protocol guidance and observations, transport,
a session store, and an observer for conversation and match activity. The
library owns reasoning, questions, H2A communication, checkpoints, and scheduling.
The host's protocol owns eligibility, available actions, limits, and transitions.

```ts
import { NegotiationAgent } from "@indexnetwork/agent";

const agent = new NegotiationAgent(
  {
    owner: { id: user.id, name: user.name },
    intent: { id: intent.id, payload: intent.statement },
    principalContext,
    guidance, // Supplied by the protocol used by this host.
    client,
  },
  host,
  { model, store }, // PrincipalStore: load, atomic save, close.
);
await agent.start();

// Register a separate A2A match under this personal agent and intent.
void agent.receive({
  kind: "opportunity.matched",
  opportunityId,
});

// Relay persisted turn changes, including settlement, to the participants.
void agent.receive({ kind: "negotiation.updated", opportunityId });

// Show agent.conversation and agent.pending when host.conversation() fires.
// Answer the displayed question; otherwise send a message to the personal agent.
const question = agent.pending;
if (question) await agent.answer(question.id, humanInput);
else await agent.message(humanInput);

// When the host shuts down:
await agent.stop();
```

`NegotiationClient` supplies `readNegotiation()` and `submitTurn()`; it holds
credentials outside model context. `NegotiationHost` observes status, turns,
retries, tool steps, completion, and errors. Its `conversation()` notification
tells the host to read `agent.conversation`, `agent.pending`, and
`agent.queuedQuestions`. Conversation entries and questions carry a `matches`
array; questions and answers also declare `intent` or `match` scope. Transport
and UI code relay events and principal input; they never choose whose agent runs next.
Direct principal messages have kind `user`; the agent's replies have kind
`message`. Their `matches` arrays are empty because they belong to the H2A
conversation rather than a displayed match question.
An error with a null opportunity ID means the principal communication loop
failed, and the runtime shuts down that principal/intent.
Hosts deliver update events after successful writes. The optional `turn()`
observer reports a submission; event delivery does not depend on that callback.

All matches share one `Agent` instance, H2A history, and accepted commitments.
Each A2A match keeps its own task, record, and temporary model/tool transcript.
Duplicate events are coalesced; only one run acts for a principal on a given
match at a time. Model calls for different matches run concurrently, while
outgoing submissions are serialized per principal. A new human message, answer, or
accepted commitment invalidates decisions made against older context before
they can submit.

Only the principal communication inbox can publish H2A messages. Negotiation
tasks submit internal `request_principal_input` requests and authoritative
outcomes. Routine proposals, counters, and model completion summaries stay
internal. A bounded two-second window batches background requests and outcomes
without delaying negotiation turns or waiting for every match to finish.

When no question is displayed, `message(text)` records private input and requests
a reply immediately, ahead of background communication. The PA sees its latest
observed match records and full H2A history, so it can answer status questions and
follow-ups even when no negotiation is active. Additional messages cancel stale
reviews and remain queued until answered. New facts and instructions become
shared private context for negotiation decisions; a question is not treated as
new authority. Empty messages and messages sent while a question is displayed
are rejected; use that question's ID with `answer()` instead.

The same agent reviews each batch with the H2A history, instructions, and
accepted commitments. It can ask one existing focused question, send one
consolidated outcome update, or stay silent. It can also return a redundant
request to its negotiation with a pointer to existing principal evidence.
That internal advice never becomes a human answer or grants new authority.

While a question is displayed, new requests for the same intent-wide fact can
join it internally. Its ID, wording, options, scope, and displayed match
references stay unchanged. Other details and approvals remain queued;
match-scoped requests cannot be attached to another question. Background
outcome updates wait while the human is answering.

An answer is recorded once in H2A, cancels any stale communication review, and
immediately releases waiting negotiations to reconsider the latest context.
The model identifies related facts and interprets answers; the runtime enforces
one displayed question and separate match-scoped requests. Other principals
never receive this private history.

With one intent for each of 12 users and all pairs matched, this produces
**12 H2A conversations and 66 A2A conversations**. Settlement or failure ends
the affected match while the personal agent remains available for other work.
`stop(opportunityId)` cancels one match and releases its questions; `stop()`
cancels all model calls and answer waits for this principal/intent.

Each turn makes at most one submission attempt against an observed turn count.
The injected protocol advertises actions and limits, and the host validates its
transition against current state when committing. The agent never blindly
replays an uncertain submission.

`PrincipalStore.load()` returns the private checkpoint and chronological H2A
messages. `save(state, newMessages)` must persist both atomically under exclusive
session ownership. `close()` releases ownership. The agent owns the checkpoint
format, stable message/question IDs, pending requests, and restart reconciliation.
Human `message()` and `answer()` calls return the persisted input entry, or
`null` when rejected (for example, when the displayed question changed). They
resolve only after persistence; storage failure stops the runtime. `stop()` preserves outstanding work and the displayed
question. Match working transcripts are temporary and regenerated from fresh
protocol observations after restart.

The [scenario TUI](../agent-tui/README.md) injects `MemoryPrincipalStore`. The
[API server and TUI](../../services/api/README.md) inject a Postgres session store
with leases and revision fencing. The normal API server owns runtime lifecycle
independently of connected clients. Neither `agent` nor `protocol` imports the other;
the host composes their contracts.

### Batched inbox work

For a host that batches generic tool work through `Agent.run()`, an intent's
`Inbox` queues events until a tick; a run reads the whole
batch in one context, so the same question from three counterparties is
one question, and a settled match can end the rest.

```ts
import { Inbox } from "@indexnetwork/agent";

const inbox = new Inbox(agent.for(intent), {
  onResult: (r) => { if (r.end === "needs-input") postToParty(r.pending!) },  // your channel
  onError: (e) => log(e),
});
const stop = inbox.start();          // ticks every TICK_MS

inbox.push({ kind: "negotiation.turn", opportunityId, turnIndex });   // waits for the tick
inbox.push({ kind: "message.new", messageId, text: "aggregates are fine" });   // runs now
```

Two triggers, nothing else. A **tick** runs if the inbox is non-empty;
events that land during a run wait for the next one. **The party replied**
runs at once — a human is waiting — and whatever else is queued rides
along; if a run is in flight, the reply's run follows it. A run that
throws puts its events back, and they go out on the next tick.

The inbox holds only the queue. The question is on the negotiation record
and the message is in the DM, so a fresh inbox in a new process picks up
from the next event.

### Knowing the time

The agent is told today's date, so "next Tuesday" can be resolved rather
than repeated. It's read as UTC; a host whose party lives elsewhere passes
an instant shifted into that timezone, and a test passes a fixed one:

```ts
new Agent({ identity, systemPrompt, model, now: () => new Date("2026-08-31T09:00:00Z") });
```
