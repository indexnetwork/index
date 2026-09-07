# @indexnetwork/agent

A personal agent that a host runs on someone's behalf.

`Agent` provides the model/tool loop. `NegotiationAgent` is the long-lived
per-user runtime for matches: the host initializes it once and delivers events,
and the library schedules that user's negotiation turns automatically.

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

### Always-on negotiations

Initialize one `NegotiationAgent` per user. The host supplies that user's private
instructions, authenticated transport, and a per-opportunity observer/reply
channel. These are infrastructure ports; the library owns prompts, tools,
turn-order checks, question resumption, and negotiation scheduling.

```ts
import { NegotiationAgent } from "@indexnetwork/agent";

const agent = new NegotiationAgent(
  { owner: { id: user.id, name: user.name }, instructions, client },
  (opportunityId) => observersFor(user.id, opportunityId),
);

// A match immediately creates an isolated conversation and checks whose turn it is.
void agent.receive({
  kind: "opportunity.matched",
  opportunityId,
  intent: { id: intent.id, payload: intent.statement },
});

// Relay persisted turn changes, including settlement, to the participants.
void agent.receive({ kind: "negotiation.updated", opportunityId });

// When the host shuts down:
await agent.stop();
```

`NegotiationClient` supplies `readNegotiation()` and `submitTurn()`; it holds
credentials outside model context. `NegotiationHost` observes status, turns,
retries, tool steps, output, completion, and errors. Its `ask()` promise supplies
the principal's private answer, or `null` to stop that negotiation unanswered.
Transport and UI code relay events and answers; they never choose whose agent
to run next.

Matches run concurrently, including multiple matches for the same user. Each
opportunity keeps a separate agent conversation and at most one active run for
that user. Duplicate match events reuse the existing session; updates arriving
during a run are coalesced and read again afterward. A pending question holds
only its own negotiation. Settlement or failure ends that session while the
personal runtime remains available for later matches. `stop()` cancels model
calls and pending answer waits across all of this user's sessions.

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
