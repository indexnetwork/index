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
| System, H2A | `buildNegotiationSystemPrompt` → `buildAgentSystemPrompt` | Current confirmed principal context and intent, protocol guidance, identity and date. |
| System, A2A | `NegotiationAgent.createAgent` → `buildAgentSystemPrompt` | Protocol guidance, identity and date; authority comes from the private brief. |
| User, for an A2A turn | `buildNegotiationTurnPrompt` | `MATCH_INSTRUCTIONS`, current negotiation and exact saved brief. |
| User, for H2A communication | `buildPrincipalInboxPrompt` | `PRINCIPAL_INBOX_INSTRUCTIONS`, canonical history, accepted input, pending question, delegations, live negotiations and agreements. |

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
- Only accepted `message()` or `answer()` input activates H2A. Startup, scans, A2A activity and opening the app remain observational.

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

// Read agent.conversation and agent.pending when host.conversation() fires.
const question = agent.pending;
if (question) await agent.answer(question.id, humanInput);
else await agent.message(humanInput);

await agent.stop();
```

| Contract | Responsibility |
| --- | --- |
| `PrincipalRecords.start()` / `close()` | Acquire and release host execution ownership. |
| `read()` | Read current intent/profile, canonical messages, question retirements and private delegations with a source version. No checkpoint write. |
| `accept(message)` | Atomically accept a user message or answer to the exact pending question; return the committed entry or `null`. Preserve historical answer scope and references. |
| `write(effects, expectedVersion)` | Commit H2A messages and delegations together; reject stale records, negotiation observations and duplicate identities before publishing notifications. |
| `NegotiationClient.listNegotiations()` / `readNegotiation()` | Read current protocol records, including passive work and agreements. |
| `submitTurn()` | Enforce current ownership, source context and `expectedTurnCount`; at most one POST attempt per run. |
| `NegotiationHost` | Observe conversation, status, turns, retries, steps, completion and errors. A null opportunity ID identifies an H2A failure. |

- H2A may reply, author one independent question, delegate selected negotiations or wait silently. Persist outputs before starting dependent A2A work.
- Questions retain their ID, wording and options until answered. Empty input, stale answers and direct messages during a pending question are rejected. Question batches and corrections remain deferred.
- New questions have no negotiation references. Historical messages retain their scope and match references so old approvals do not acquire broader authority.
- A2A receives only its saved private brief and current protocol record. A new accepted principal input invalidates earlier delegations until H2A explicitly delegates again.
- `pause_negotiation()` ends local work without a turn, question, answer promise or H2A activation. Unchanged duplicate notifications remain idle; new delegation or meaningful protocol changes can resume eligible work.
- Each run discards its model transcript. Concurrent matches share only ephemeral scheduling and serialized outgoing writes; no task map, request queue or processed-input marker is persisted.
- Restart reads committed history and exact question status without rerunning interrupted work. The next accepted input lets H2A reassess unfinished work. An uncertain POST is never retried automatically.
- `stop(opportunityId)` cancels one local task without changing questions; `stop()` cancels all model work and releases execution ownership. Committed history survives both.
- The [scenario TUI](../agent-tui/README.md) uses `MemoryPrincipalRecords`. The [API host](../../services/api/README.md) uses existing intent-tagged `messages` for visible history and private delegation/retirement records; private records are excluded from chat history, previews and unread counts.
- The API retains the existing `agent_sessions` execution lease in this slice. Its `state` and `revision` columns are removed; lease replacement and table removal remain a separate storage slice.
- Breaking change: `PrincipalState`, `PrincipalStore` and `MemoryPrincipalStore` are removed; hosts must implement `PrincipalRecords`, current negotiation listing and context-fenced turn writes.

### Knowing the time

The agent is told today's date, so "next Tuesday" can be resolved rather
than repeated. It's read as UTC; a host whose party lives elsewhere passes
an instant shifted into that timezone, and a test passes a fixed one:

```ts
new Agent({ identity, systemPrompt, model, now: () => new Date("2026-08-31T09:00:00Z") });
```
