# @indexnetwork/agent

A personal agent that a host runs on someone's behalf, built on
[`@indexnetwork/a2a`](../a2a).

It works the way Claude Code, Hermes or OpenClaw do — a system prompt, a set
of tools, and a loop that runs until the work is done. Two things make it
different:

- **It doesn't own its instructions.** A centralized host imports this
  package, constructs an `Agent` with a `systemPrompt`, injects the
  operations it may perform, and calls `run()`. One package serves every
  user.
- **It can stop to ask.** When the agent needs something only the party it
  represents can tell it, `run()` hands the question back rather than
  guessing or blocking. It can do this *mid-negotiation*.

## Purpose

One agent per party, with one identity. `for()` scopes it to an intent —
that narrows what it's working on, never who it is. The identity carries
into every scope and into every negotiation the agent opens.

```ts
const agent = new Agent({ identity, systemPrompt, tools });  // one per party
const raising = agent.for("Raise a 400k pre-seed round");     // same identity
```

Two loops, doing different jobs:

- **The agent loop** (`run()`) is this package. It decides *what to do* —
  which tools to call, when to ask the user, when the work is finished.
- **The negotiation** is `@indexnetwork/a2a`. Once a turn is being taken,
  it decides *what to say*, and moves it over A2A.

> Why a separate model client: the a2a package's `OpenRouterClient` sends no
> `tools` and reads only `choices[0].message.content`, so tool calls would be
> dropped. It stays responsible for negotiation turns; this package's
> `ModelClient` drives the agent loop.

## Requirements

- **Runtime**: Node ≥ 20, or Bun — anything with global `fetch`,
  `crypto.randomUUID()` and `Request`/`Response`. ESM only, no CommonJS.
- **`@indexnetwork/a2a`**, a real dependency rather than a peer one.
- **An [OpenRouter](https://openrouter.ai) API key**, and a model that
  supports tool calling.

## Installation

```bash
bun add @indexnetwork/agent
```

Neither package is published yet, so `agent` depends on its sibling by path
(`"@indexnetwork/a2a": "file:../a2a"`), resolved through its `exports` to
its `dist/`. Build it once first:

```bash
cd ../a2a && bun install && bun run build
cd ../agent && bun install
```

## Usage

```ts
import { Agent, askUserTool, negotiationTools, type Tool } from "@indexnetwork/agent";

const agent = new Agent({
  identity: { name: "Tomas's Agent", id: "did:example:tomas" },
  systemPrompt:
    "You act for Tomas. Ask him directly about anything you have not been told — " +
    "a price ceiling, dates, collection. Do not invent his preferences.",
  tools: [
    ...indexOperations(session),  // yours; see Tools
    askUserTool(),
    ...negotiationTools(),
  ],
});

const scoped = agent.for({ id: "int_cfo", statement: "Bring in a fractional CFO" });
const result = await scoped.run("Find a seller and get the best terms you can.");
```

### Identity and intent

```ts
interface AgentIdentity {
  name: string;         // AgentCard name; the party name the negotiator speaks under
  id: string;           // stable id for the party — a DID, profile URL, account id
  description?: string;
  url?: string;
  version?: string;
}
```

`for(intent)` returns an agent sharing the *same identity object* — not a
copy. So identity transfer is structural: nothing has to remember to pass it
along, and `buying.card()` is byte-identical to `agent.card()`. What changes
is the system message the model runs under, and what negotiations opened in
that scope are understood to serve. `instructions()` shows you exactly what
the model is told.

Identity is **self-asserted**: it's published on a public, unauthenticated
AgentCard, so a counterparty decides whether to believe it. Use
`credentials`/`authenticate` if it needs proving. The A2A AgentCard has no
field for who an agent acts *for*, so `id` is published as an extension.

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
let r = await scoped.run("Find a seller and get the best terms.");

while (r.end === "needs-input") {
  const answer = await ask(user, r.pending!.question);   // your channel
  r = await scoped.run(answer, {
    messages: r.messages,           // the conversation
    negotiations: r.negotiations,   // parked A2A tasks
  });
}
```

That loop *is* the live-chat case; there's no separate callback API. For an
unattended run, persist `messages` and `negotiations` and resume from
storage — or give the agent a `history` store and a `sessions` store and
omit both; `run()` reads and writes them itself. On resume, the answer is
recorded as the pending tool's result — not as a new user message — so the
model sees a question it asked and an answer to it.

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

`ToolContext` carries the `agent`, the `negotiations` open in this run, and
the run's `AbortSignal`.

**Index Network operations are injected by the host.** This package
deliberately knows nothing about how Index is reached — the host already
holds the session, auth and client, so it passes those operations in as
tools. What ships here is `defaultTools()`: `askUserTool()` plus
`negotiationTools()`. Passing your own `tools` array replaces the defaults
entirely, so spread `defaultTools()` if you want to keep them.

A tool with `suspends` never runs. The loop stops when the model calls it and
hands the arguments to the host, which supplies the result by resuming. That
is all `askUserTool()` is — anything else needing a human or another system
can work the same way.

### Negotiating

One counterparty at a time is a conversation. Ten is management: reading
every turn of every exchange would bury the agent in payloads it can't act
on, and cost a model call per turn. So the model gets two calls that work
the way a subagent does — run in their own context, report back once:

| Tool | Does |
| --- | --- |
| `negotiate` | Opens every target concurrently and runs each to an event — settled, waiting on the party, out of turns. Returns one digest. |
| `answer` | Folds the party's reply into negotiations and moves them on. |

Under `negotiate` the negotiator may take one action a plain turn may not:
`ask`. It is intercepted before the wire — the counterparty never sees it —
and the negotiation parks with its question. The digest groups what came
back:

```
Settled (2):
- 61b3061c with Alice's Agent (https://alice.example) — agreed: {"amount":460}
- 9f2a1c3d with Bob's Agent (https://bob.example) — declined
Waiting on you (1) — ask your party once with ask_user, then call answer with every id the answer applies to:
- 1a2b3c4d with Carol's Agent (https://carol.example) — asks: "Latest pickup day?" (their last move: "$480, Saturday" {"amount":480})
```

Every line names the URL it came from. Ids and party names are what the
counterparty chose; the URL is what *you* named the target as, and it is
the only thing a batch of results can be joined back on — an agent without
it eventually reports one seller's price under another's name.

Same-kind questions from several negotiations are the model's to coalesce:
it asks the party once and passes every applicable id to `answer`. The
guidance is standing — it holds for the rest of each negotiation. One rule
covers every case: guidance may be given to any negotiation that has not
ended. A negotiation this agent opened runs on with it; one the counterparty
opened just holds it, since they have the initiative, and it goes out with
this agent's reply to their next message.

The same methods are available directly — `runNegotiation()` and
`answer()`, both returning a `NegotiationEvent`, and `digest()` renders a
batch of them. For turn-level control there are `openNegotiation()` and
`continueNegotiation()`, which never offer `ask`, and `negotiate()`, which
runs an exchange to completion in one call for hosts that want a
negotiation without a loop around it.

#### What settles

A2A puts the Task on the server side, so whether a negotiation ended is read
off the Task the counterparty returns, not asserted from this agent's own
action. Each side decides its own turn, so this agent can accept in the very
round trip the counterparty rejects.

| Field | Says |
| --- | --- |
| `state` / `done` | What the record holds. The counterparty's server stamped it. |
| `endedBy` | What each side *did*. Both halves can be terminal at once. |
| `settlement` | Whether anything was actually agreed. |

Every turn that closes an exchange carries a `settlement`, whose verdict
comes from `verifyAgreement()` reading the shared Task — both parties
compute it from the same input and reach the same answer by construction:

| `outcome` | Means |
| --- | --- |
| `"agreed"` | Both sides closed on the same terms. `basis` says on what evidence. |
| `"declined"` | It ended without a deal. |
| `"conflict"` | The closing moves bound to different terms. No agreement, whatever this agent's own action was. |
| `"unconfirmed"` | It ended, but nothing structured says *what* was agreed. Verify out of band. |
| `"unanswered"` | This agent closed; the counterparty replied without closing. Still open — `answer` it with how to respond. |

Read it rather than `endedBy` before telling anyone a deal was struck.
`onSettled` fires with it on both the outbound and inbound side. `basis`
says what the verdict rests on, weakest to strongest — `prose`, `state`,
`terms`, `reference` — so check it when something irreversible depends on
the deal:

```ts
new Agent({
  identity, systemPrompt,
  onSettled: (settlement) => {
    if (settlement.outcome !== "agreed") return warn(settlement.reason);
    if (settlement.basis !== "reference") return review(settlement.terms);
    commit(settlement.terms);
  },
});
```

A settled negotiation stays settled: taking another turn in an ended
exchange would walk the Task back out of its terminal state and erase the
agreement from the record, so `answer` and `continueNegotiation()` refuse
an ended id and say to open a new one instead.

#### Terms are what make it checkable

Decisions carry structured `terms`, and an accepting move names the
`offerId` it binds to, so `settlement` can verify an agreement instead of
reading English. Terms are on by default, described generically, because
this agent is scoped to an intent at run time and a host usually can't
enumerate the fields in advance. Name them where you can:

```ts
new Agent({ identity, systemPrompt, terms: "amount (number, USD), pickupDay (day of week)" });
```

`terms: ""` turns them off; decisions are then prose-only and settle as
`unconfirmed`. For a counterparty that sends no terms, this package falls
back to comparing amounts named in the two closing statements and labels
that verdict `basis: "prose"`.

Sessions travel on `RunResult.negotiations`. Pass them back on resume or
the agent can still talk, but can't pick up an exchange it already started:
the counterparty keeps its own copy of the task, but the negotiator rebuilds
*this* side's view from the history, so the history has to travel.

#### One live negotiation per counterparty

Opening a second negotiation with a counterparty is refused while a first
one could still bind the party — `openNegotiation` throws, `negotiate`
skips that target and says why:

| The existing negotiation | A second one |
| --- | --- |
| still going, or waiting on your party | refused — answer it |
| closed as a deal (`agreed`, or `unconfirmed`) | refused — the deal stands; a second one adds to it rather than replacing it |
| closed with no deal (`declined`, `conflict`) | allowed — going back with a new offer is the point |
| for a different intent | allowed — buying a bike from someone is no reason not to negotiate a desk with them |

This never reopens or edits a closed negotiation; it only refuses to start
a rival to one. Parked negotiations live in the `NegotiationStore`, so a
fresh `Agent` over the same store can answer them.

### What the card advertises

`card()` derives an AgentCard from the identity. The negotiating skill is
described with the action vocabulary this agent actually uses, so a
counterparty reading the card knows what to expect back — including a
custom vocabulary:

```json
{ "id": "negotiate", "name": "Negotiate",
  "description": "Negotiates on its party's behalf over A2A message/send. Understands: resolve, escalate." }
```

Tools stay **off** the card unless you ask for them. The card is public and
unauthenticated, and the tools are whatever the host injected — for Index
Network that's a list of operations this party can perform, which isn't
obviously anyone else's business. `publishTools: true` adds them as skills
when being discoverable is the point; `ask_user` and the negotiation tools
are left out either way.

`skills` replaces the derived list entirely. Security schemes can't be
inferred from an opaque `authenticate` function, so declare them through
`card`, which merges last.

### Knowing the time

The agent is told today's date, so "next Tuesday" can be resolved rather
than repeated, and the same `now` goes to the negotiator so the loop and
the negotiation turns can't name different days. It's read as UTC; a host
whose party lives elsewhere passes an instant shifted into that timezone,
and a test passes a fixed one:

```ts
new Agent({ identity, systemPrompt, now: () => new Date("2026-08-31T09:00:00Z") });
```

### What the agent knows it negotiated

An agent takes part in negotiations two ways: it dials a counterparty, or a
counterparty dials it. Only the first passes through the agent loop —
inbound turns are answered by `Negotiator` directly, because a
counterparty's turn needs one reply, not a work session. That would leave
the agent unable to speak about half of what it did, so negotiations are
recorded, both directions, in a `NegotiationStore`:

```ts
new Agent({ identity, systemPrompt, sessions: myStore });
```

Same shape as `taskStore`, and the same reasoning — the agent holds no
state of its own, so this is the host's. It defaults to in-memory; swap it
and an agent knows what it negotiated after a restart, or from another
process. `for()` shares it, the way it shares the identity.

Each run's system message then carries the record:

```
Negotiations you are party to. This is the record of what happened, which is
not the same as what you remember saying — trust it over the conversation above:
- 61b3061c with Idris's Agent — you contacted them; agreed: {"day_rate":1000,"days_per_month":2}
- 9f2a1c3d — they contacted you; still open, 4 turns so far
```

Reading is uniform; acting is not. An inbound negotiation has no URL — a
`message/send` call carries no return address — so this agent cannot take
a turn in it. When one is waiting on the party, `answer` records the reply
for the counterparty's next call.

### Receiving negotiations

`handler()` serves the AgentCard at `/.well-known/agent-card.json` and
answers `message/send` calls:

```ts
Bun.serve({ port: 8080, fetch: agent.handler() });
```

Inbound turns are decided by `Negotiator` directly, **not** by the agent
loop. `inspect(url)` fetches another agent's card without saying anything
to it.

### One thing to know about the objective

`systemPrompt` is the loop's system message verbatim, and it's also the
negotiating `objective`. The second use is *wrapped*: the negotiator builds
its own prompt from a fixed template and interpolates the objective into it.

```
You are negotiating on behalf of "{identity.name}".
Objective: {systemPrompt + intent + per-negotiation objective + standing guidance}
Decide how to respond to the other party, and choose exactly one action from: ...
```

There's no override — `buildSystemPrompt` is private to that package. So
instructions that aren't negotiation-shaped still arrive, but read as a
negotiator's brief. Write the prompt so that framing is true.

### When the model doesn't answer

Each model request is bounded by `timeout` (120s by default) and transient
failures are retried up to `attempts` times (3): a timeout, a dropped
connection, a rate limit, a 5xx. Backoff is 1s, 2s, 4s, or whatever
`Retry-After` asked for.

Nothing else is retried. A 401 or a malformed request fails the same way
however many times it is sent, and an interrupted run is a decision rather
than a failure — a caller's `signal` aborts immediately and is never
retried.

A retry looks exactly like slowness from the outside, so `onRetry` fires
before each one. A headless host should at least log it. Negotiation turns
are bounded too: `run()`'s signal reaches the request in flight — this
side's model call *and* the wait on the counterparty — so an interrupted
run stops a turn rather than orphaning it.

### Options

| Option | Type | Description |
| --- | --- | --- |
| `identity` | `AgentIdentity` | Required. Who this agent acts for. |
| `systemPrompt` | `string` | Required. Standing instructions from the host. |
| `intent` | `Intent` | Usually set with `for()` rather than here. |
| `tools` | `Tool[]` | Defaults to `defaultTools()`. |
| `model`, `apiKey` | | OpenRouter configuration. |
| `maxSteps` | `number` | Step cap for `run()`. Default 10. |
| `timeout` | `number` | Per-request deadline in ms. Default 120000. |
| `attempts` | `number` | Model attempts per step. Default 3. |
| `onRetry` | function | Fires before a retry, with the attempt and the reason. |
| `now` | `() => Date` | The clock the agent reasons about dates with. Defaults to the host's. |
| `negotiator` | `Negotiator` | Defaults to one built from `model`/`apiKey`. |
| `allowedActions` | `ActionSpec[]` | Defaults to propose/counter/accept/reject. A non-terminal action is the usual addition; see `04-custom-actions.ts`. |
| `maxTurns` | `number` | Turn cap per negotiation. Default 10. |
| `skills`, `card` | | Published on the AgentCard; `card` merges last. |
| `publishTools` | `boolean` | Also publish tools as skills. Off by default — the card is public. |
| `onTurn` | function | Fires per negotiation turn, both sides, in order. |
| `onSettled` | function | Fires when a round trip closes an exchange, with the verdict. |
| `terms` | `string` | Describes the structured terms decisions carry. Defaults to a generic description; `""` for prose-only. |
| `isTerminal` / `terminalState` | function | Which actions end a negotiation, and how. |
| `evaluate` | `EvaluateHook` | Attaches an Artifact per negotiation turn. |
| `authenticate` | function | Gates inbound `message/send`. |
| `credentials` | `A2ACredentials` | Auth headers on outbound calls. |
| `taskStore` | `TaskStore` | Inbound Task storage. In-memory by default. |
| `sessions` | `NegotiationStore` | Where negotiations are recorded, both directions. In-memory by default. |
| `history` | `MessageStore` | Where the conversation is recorded; `run()` reads it when `messages` is omitted and saves to it every run. In-memory by default. |

### Examples

Runnable scripts making live OpenRouter calls, so outcomes are genuinely
non-deterministic rather than scripted:

| Script | Shows |
| --- | --- |
| `01-ask-user.ts` | A founder's agent, asked to agree a day rate it was never given. Suspend and resume, with a host-injected operation alongside. |
| `03-negotiating-agent.ts` | The whole thing: agreeing terms with a fractional CFO, stopping mid-negotiation to ask the founder about equity, continuing the same task. |
| `04-custom-actions.ts` | An introduction, negotiated. No price anywhere: the actions are `introduce`, `refer` and `decline`, and what's being agreed is access to a person. |
| `05-authenticated.ts` | `inspect()`, a declared security scheme, a call refused without credentials. |
| `06-persistence.ts` | Every store over one `bun:sqlite` file — `NegotiationStore`, `TaskStore`, `MessageStore` — and an agent that resumes a conversation after a restart with no `messages` passed. |

```bash
OPENROUTER_API_KEY=... bun run examples/03-negotiating-agent.ts
```

## Development

```bash
bun install        # install dependencies
bun test           # run tests
bun run typecheck  # tsc --noEmit
bun run build      # bundle + emit .d.ts into dist/
bun run check      # all three
bun run stress     # live scenarios — real model calls, real money
```

`dist/` is what gets published; it's git-ignored. `@indexnetwork/a2a` is
externalized rather than bundled, so consumers resolve one copy of it.

### Project layout

```
src/
  index.ts          # public entry point
  core/
    agent.ts        # Agent: for(), run(), handler(), the negotiation methods
    loop.ts         # the agent loop, and suspend/resume
    tools.ts        # Tool, askUserTool(), negotiationTools()
    digest.ts       # a batch of negotiation events, as one message to the loop
    sessions.ts     # the in-memory stores
    model.ts        # OpenRouter client with tool calling
    types.ts        # identity/intent, RunResult/Step, negotiation types
    test-helpers.ts # scripted negotiators and fixtures shared by the tests
dev/
  stress.ts         # live scenarios: settled terms, location, time, currency
examples/           # runnable scripts against real OpenRouter calls
```

## License

MIT
