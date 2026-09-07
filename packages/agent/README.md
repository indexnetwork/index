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

## Purpose

One agent per party, with one identity. `for()` scopes it to an intent —
that narrows what it's working on, never who it is.

```ts
const agent = new Agent({ identity, systemPrompt, tools });  // one per party
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
import { Agent, askUserTool, type Tool } from "@indexnetwork/agent";

const agent = new Agent({
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

Pass an ordered `models` list when initializing an `Agent`, or in the third
argument to `NegotiationAgent`:

```ts
const models = ["google/gemini-3.8-flash", "anthropic/claude-haiku-4.5"];
const agent = new Agent({ identity, systemPrompt, models });
const negotiator = new NegotiationAgent(participant, host, { models });
```

OpenRouter accepts one to three models; an injected list replaces the defaults
completely. This replaces the former
`model` option; use `models: [modelId]` for a single model. Omitting the list uses
`DEFAULT_MODELS` in [core/model.ts](src/core/model.ts), which also owns all retry
and cooldown policy. Both negotiation scripts inherit that policy.

OpenRouter handles provider selection and ordered model fallback. If it still
returns a rate limit, agents using the same key and list in this process share
a cooldown based on `Retry-After` or `X-RateLimit-Reset`, including headers in
error metadata. Without a hint, waits grow from 30 seconds to 5 minutes, with
jitter to spread retries. Quota failures wait until recovery or cancellation;
they do not exhaust the normal three-attempt budget for transient failures.
`onRetry` reports waits, and shutdown interrupts them immediately. Authentication,
credit, and invalid-request errors fail promptly. Individual provider quotas
are left to OpenRouter; there are no local per-model request counters.

### Always-on negotiations

Initialize one `NegotiationAgent` per principal/intent. The host supplies the
principal's private instructions, authenticated transport, and one observer for
their conversation and match activity. These are infrastructure ports; the
library owns prompts, tools, turn-order checks, questions, and scheduling.

```ts
import { NegotiationAgent } from "@indexnetwork/agent";

const agent = new NegotiationAgent(
  {
    owner: { id: user.id, name: user.name },
    intent: { id: intent.id, payload: intent.statement },
    instructions,
    client,
  },
  host,
);

// Register a separate A2A match under this personal agent and intent.
void agent.receive({
  kind: "opportunity.matched",
  opportunityId,
});

// Relay persisted turn changes, including settlement, to the participants.
void agent.receive({ kind: "negotiation.updated", opportunityId });

// Show agent.conversation and agent.pending when host.conversation() fires.
// Reply to the displayed question ID, regardless of the selected A2A match.
const question = agent.pending;
if (question) agent.answer(question.id, humanAnswer);

// When the host shuts down:
await agent.stop();
```

`NegotiationClient` supplies `readNegotiation()` and `submitTurn()`; it holds
credentials outside model context. `NegotiationHost` observes status, turns,
retries, tool steps, completion, and errors. Its `conversation()` notification
tells the host to read `agent.conversation`, `agent.pending`, and
`agent.queuedQuestions`. Conversation entries and questions identify the
originating match and counterparty. Transport and UI code relay events and
answers; they never choose whose agent runs next.

All matches share one `Agent` instance, H2A history, and accepted commitments.
Each A2A match keeps its own task, record, and temporary model/tool transcript.
Duplicate events are coalesced; only one run acts for a principal on a given
match at a time. Model calls for different matches run concurrently, while
outgoing submissions are serialized per principal. A changed human answer or
accepted commitment invalidates decisions made against older context before
they can submit.

The principal sees one active question, with other matches' questions queued.
An answer is recorded once in H2A. The originating task and queued questions
reconsider the latest shared context before continuing. The prompt tells the
model to reuse personal facts and explicit intent-wide instructions, while
keeping approvals and brief yes/no answers scoped to the originating match.
This interpretation is model behavior; the runtime does not infer permission
from answer text. Other principals never receive this private history.

With one intent for each of 12 users and all pairs matched, this produces
**12 H2A conversations and 66 A2A conversations**. Settlement or failure ends
the affected match while the personal agent remains available for other work.
`stop(opportunityId)` cancels one match and releases its questions; `stop()`
cancels all model calls and answer waits for this principal/intent.

There is at most one submission attempt per turn, with no automatic write
retry, and a 12-turn limit per negotiation. The runtime's session state is
currently in memory. A server can initialize this runtime and deliver the same
events; server startup, event subscriptions, and restart recovery are outside
this package's current host wiring. The local lab and REST runner in
`scripts/agent-negotiation*` both use this runtime.

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
new Agent({ identity, systemPrompt, now: () => new Date("2026-08-31T09:00:00Z") });
```
