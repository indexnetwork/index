# @indexnetwork/agent

A personal agent that a host runs on someone's behalf.

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

### Knowing the time

The agent is told today's date, so "next Tuesday" can be resolved rather
than repeated. It's read as UTC; a host whose party lives elsewhere passes
an instant shifted into that timezone, and a test passes a fixed one:

```ts
new Agent({ identity, systemPrompt, now: () => new Date("2026-08-31T09:00:00Z") });
```
