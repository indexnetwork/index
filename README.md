# @indexnetwork/agent

A personal agent that a host runs on someone's behalf, built on
[`@indexnetwork/negotiator`](../negotiator).

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
const buying = agent.for("Find a used road bike under $450"); // same identity
```

Two loops, doing different jobs:

- **The agent loop** (`run()`) is this package. It decides *what to do* —
  which tools to call, when to ask the user, when the work is finished.
- **The negotiation** is `@indexnetwork/negotiator`. Once a turn is being
  taken, it decides *what to say*, and moves it over A2A.

> Why a separate model client: the negotiator's `OpenRouterClient` sends no
> `tools` and reads only `choices[0].message.content`, so tool calls would be
> dropped. It stays responsible for negotiation turns; this package's
> `ModelClient` drives the agent loop.

## Requirements

- **Runtime**: Node ≥ 20, or Bun — anything with global `fetch`,
  `crypto.randomUUID()` and `Request`/`Response`. ESM only, no CommonJS.
- **TypeScript ≥ 5** to consume it from a TS project (peer dependency; not
  needed at runtime — `dist/` ships plain JS + `.d.ts`).
- **`@indexnetwork/negotiator`**, a real dependency rather than a peer one.
- **An [OpenRouter](https://openrouter.ai) API key**, and a model that
  supports tool calling.

## Installation

```bash
bun add @indexnetwork/agent
```

Neither package is published yet, so `agent` depends on its sibling by path
(`"@indexnetwork/negotiator": "file:../negotiator"`), resolved through the
negotiator's `exports` to its `dist/`. Build it once first:

```bash
cd ../negotiator && bun install && bun run build
cd ../agent && bun install
```

## Usage

```ts
import { Agent, askUserTool, negotiationTools, type Tool } from "@indexnetwork/agent";

const agent = new Agent({
  identity: { name: "Bob's Agent", id: "did:example:bob" },
  systemPrompt:
    "You act for Bob. Ask him directly about anything you have not been told — " +
    "a price ceiling, dates, collection. Do not invent his preferences.",
  tools: [
    ...indexOperations(session),  // yours; see Tools
    askUserTool(),
    ...negotiationTools(),
  ],
});

const scoped = agent.for({ id: "int_bike", statement: "Buy a reliable used road bike" });
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

Identity is **self-asserted**. It's published on a public, unauthenticated
AgentCard, so a counterparty learns who this claims to be and decides whether
to believe it. Use `credentials`/`authenticate` if it needs proving.

> The A2A AgentCard has no field for who an agent acts *for* — only `name`
> and `url` — so `id` is published as an extension. Counterparties that don't
> know about it ignore it.

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
    negotiations: r.negotiations,   // open A2A tasks
  });
}
```

That loop *is* the live-chat case; there's no separate callback API. For an
unattended run, persist `messages` and `negotiations` and resume from
storage. On resume, the answer is recorded as the pending tool's result — not
as a new user message — so the model sees a question it asked and an answer
to it.

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

### Negotiating, one turn at a time

`negotiationTools()` gives the model two calls rather than one:

| Tool | Does |
| --- | --- |
| `negotiate_open` | Fetches the counterparty's card, takes the first turn, returns an id. |
| `negotiate_turn` | Takes one more turn in that exchange, optionally with `guidance`. |

The split is what lets the agent pause mid-negotiation. With a single
run-to-completion call there'd be no gap to stop in — it could only ask
before starting or after finishing. `guidance` is how an answer gets folded
back in, for that turn only:

```
negotiate_open({ url, objective: "ask about the bike and its terms" })
ask_user({ question: "It's $520. What's your ceiling?" })
  -> run() returns "needs-input"; host asks Bob; resumes
negotiate_turn({ id, guidance: "Offer $430; Bob's ceiling is $460" })
```

The same methods are available directly — `openNegotiation()`,
`continueNegotiation()` — plus `negotiate()`, which runs an exchange to
completion in one call for hosts that want a negotiation without a loop
around it.

#### The Task is the record

A2A puts the Task on the server side: ids are server-generated, and only
the server transitions its state. So whether a negotiation ended is read
off the Task the counterparty returns, not asserted from this agent's own
action — an `accept` they answered with a counter leaves the exchange
`input-required`, and `done` stays false.

| Field | Says |
| --- | --- |
| `state` / `done` | What the record holds. The counterparty's server stamped it. |
| `endedBy` | What each side *did*. Both halves can be terminal at once. |
| `settlement` | Whether anything was actually agreed. |

`negotiate()` stops on either the record or a verdict — an agent that has
accepted shouldn't carry on bargaining because the reply left the Task
open.

#### One side's accept is not an agreement

Each side decides its own turn, so a negotiation ending is two assertions
rather than one shared fact. This agent can accept in the very round trip
the counterparty rejects.

Every turn that closes an exchange therefore carries a `settlement`, whose
verdict comes from `verifyAgreement()` reading the shared Task — both
parties compute it from the same input and reach the same answer by
construction:

| `outcome` | Means |
| --- | --- |
| `"agreed"` | Both sides closed on the same terms. `basis` says on what evidence. |
| `"declined"` | It ended without a deal. |
| `"conflict"` | The closing moves bound to different terms. No agreement, whatever this agent's own action was. |
| `"unconfirmed"` | It ended, but nothing structured says *what* was agreed. Verify out of band. |
| `"unanswered"` | This agent closed; the counterparty replied without closing. Still open. |

Read it rather than `endedBy` before telling anyone a deal was struck.
`onSettled` fires with it on both the outbound and inbound side.

`basis` says what the verdict rests on, weakest to strongest — `prose`,
`state`, `terms`, `reference`. These aren't strictness levels: check it
when something irreversible depends on the deal.

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

#### A settled negotiation stays settled

Taking another turn in an exchange that has ended doesn't reopen the
question — it destroys the answer. The counterparty's handler replies, the
Task falls back out of its terminal state, and the agreement that was on
the record is no longer there, so `verifyAgreement()` reports `open` where
it just reported `agreed`.

`negotiate_turn` therefore refuses a negotiation whose Task has ended, and
says to open a new one if the terms need to change. This is also what makes
an agent look like it is haggling over a settled price: once the record is
walked backwards, both sides see an open negotiation, and continuing to
bargain is the *correct* reading of it.

> This guards a well-behaved agent, not a well-behaved counterparty.
> Nothing here stops someone else sending a message on a Task of theirs
> that has already completed.

#### Terms are what make it checkable

Decisions carry structured `terms`, and an accepting move names the
`offerId` it binds to — the Contract Net shape, where acceptance references
the proposal rather than restating it in prose. That is what lets
`settlement` verify an agreement instead of reading English, and it catches
what prose can't: two closes agreeing on price and differing on the
collection day.

Terms are on by default, described generically, because this agent is
scoped to an intent at run time and a host usually can't enumerate the
fields in advance. Name them where you can:

```ts
new Agent({ identity, systemPrompt, terms: "amount (number, USD), pickupDay (day of week)" });
```

`terms: ""` turns them off; decisions are then prose-only and settle as
`unconfirmed`, since nothing in the record says what was agreed. For a
counterparty that sends no terms, this package falls back to comparing
amounts named in the two closing statements and labels that verdict
`basis: "prose"` — weaker evidence, but better than "can't tell".

> The remaining gap is tamper-evidence: terms are referenced, not signed.
> A content-addressed or signed acceptance would arrive as a new `basis`
> rather than a change to what `outcome` means.

Sessions travel on `RunResult.negotiations`. Pass them back on resume or the
agent can still talk, but can't take another turn in an exchange it already
started: the counterparty keeps its own copy of the task, but the negotiator
rebuilds *this* side's view from the history, so the history has to travel.

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
when being discoverable is the point; `ask_user` and the negotiation pair
are left out either way, since one is how the agent reaches its own party
and the others are the negotiate skill.

`skills` replaces the derived list entirely. Security schemes can't be
inferred from an opaque `authenticate` function, so declare them through
`card`, which merges last.

### Knowing the time

The agent is told today's date, because otherwise it can only repeat what a
counterparty says rather than reason about it — "next Tuesday" has no
meaning without a clock, and a relative date recorded in the settled terms
stops meaning the same thing a week later.

It matters more than it sounds. In a scenario where a seller was away
"until next Tuesday" and a buyer needed the item "before the end of the
month", the agent without a clock agreed the deal and recorded
`{"collection": "from next Tuesday onwards"}`. With one, it resolves that
to 1 September, notices it falls outside the buyer's window, and declines.

`now` fixes the clock — for tests, or to run an agent in its party's
timezone rather than the server's.

```ts
new Agent({ identity, systemPrompt, now: () => new Date("2026-08-31T09:00:00Z") });
```

### What the agent knows it negotiated

An agent takes part in negotiations two ways: it dials a counterparty, or a
counterparty dials it. Only the first passes through the agent loop —
inbound turns are answered by `Negotiator` directly, because a
counterparty's turn needs one reply, not a work session.

That would leave the agent unable to speak about half of what it did. Ask
the answering side what it agreed and it would deny the deal, because the
conversation contains no trace of a negotiation that never passed through
it.

So negotiations are recorded, both directions, in a `NegotiationStore`:

```ts
new Agent({ identity, systemPrompt, sessions: myStore });
```

Same shape as `taskStore`, and the same reasoning — the agent holds no
state of its own, so this is the host's. It defaults to in-memory; swap it
and an agent knows what it negotiated after a restart, or from another
process. `for()` shares it, the way it shares the identity: an intent
scopes what the agent is working on, not what it remembers.

Each run's system message then carries the record:

```
Negotiations you are party to. This is the record of what happened, which is
not the same as what you remember saying — trust it over the conversation above:
- 61b3061c with Alice's Agent — you contacted them; agreed: {"price":460,"collection":"Wednesday evening"}
- 9f2a1c3d — they contacted you; still open, 4 turns so far
```

Reading is uniform; acting is not. An inbound negotiation has no URL — a
`message/send` call carries no return address — so `negotiate_turn` refuses
it and says why. The counterparty calls; this agent answers.

### Receiving negotiations

`handler()` serves the AgentCard at `/.well-known/agent-card.json` and
answers `message/send` calls:

```ts
Bun.serve({ port: 8080, fetch: agent.handler() });
```

Inbound turns are decided by `Negotiator` directly, **not** by the agent
loop — a counterparty's turn needs one reply, not a work session.
`inspect(url)` fetches another agent's card without saying anything to it.

### One thing to know about the objective

`systemPrompt` is the loop's system message verbatim, and it's also the
negotiating `objective`. The second use is *wrapped*: the negotiator builds
its own prompt from a fixed template and interpolates the objective into it.

```
You are negotiating on behalf of "{identity.name}".
Objective: {systemPrompt + intent + per-negotiation objective + per-turn guidance}
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
before each one. The terminal chat puts it in the spinner; a headless host
should at least log it.

Negotiation turns are bounded too, one layer down: `run()`'s signal reaches
the request in flight — this side's model call *and* the wait on the
counterparty — so an interrupted run stops a turn rather than orphaning it.
`turnTimeout` adjusts the transport deadline behind that (180s by default,
`0` to disable). Retries stay here rather than in both packages, since two
layers retrying would multiply: three attempts each is nine requests, with
neither backoff aware of the other.

### Options

| Option | Type | Description |
| --- | --- | --- |
| `identity` | `AgentIdentity` | Required. Who this agent acts for. |
| `systemPrompt` | `string` | Required. Standing instructions from the host. |
| `intent` | `Intent` | Usually set with `for()` rather than here. |
| `tools` | `Tool[]` | Defaults to `defaultTools()`. |
| `model`, `apiKey`, `referer`, `title` | | OpenRouter configuration. |
| `maxSteps` | `number` | Step cap for `run()`. Default 10. |
| `timeout` | `number` | Per-request deadline in ms. Default 120000. |
| `attempts` | `number` | Model attempts per step. Default 3. |
| `onRetry` | function | Fires before a retry, with the attempt and the reason. |
| `now` | `() => Date` | The clock the agent reasons about dates with. Defaults to the host's. |
| `negotiator` | `Negotiator` | Defaults to one built from `model`/`apiKey`. |
| `allowedActions` | `ActionSpec[]` | Defaults to `DEFAULT_ACTIONS`. |
| `maxTurns` | `number` | Turn cap for `negotiate()`. Default 10. |
| `turnTimeout` | `number` | Deadline for one negotiation turn, in ms. Default 180000. |
| `skills`, `card` | | Published on the AgentCard; `card` merges last. |
| `publishTools` | `boolean` | Also publish tools as skills. Off by default — the card is public. |
| `onTurn` | function | Fires per negotiation turn, both sides, in order. |
| `onSettled` | function | Fires when a round trip closes an exchange, with the verdict. |
| `terms` | `string` | Describes the structured terms decisions carry. Defaults to a generic description; `""` for prose-only. |
| `isTerminal` / `terminalState` | function | Which actions end a negotiation, and how. |
| `strategy` | `DecisionStrategy` | Replaces the per-turn `decide()` call. |
| `evaluate` | `EvaluateHook` | Attaches an Artifact per negotiation turn. |
| `authenticate` | function | Gates inbound `message/send`. |
| `credentials` | `A2ACredentials` | Auth headers on outbound calls. |
| `taskStore` | `TaskStore` | Inbound Task storage. In-memory by default. |
| `sessions` | `NegotiationStore` | Where negotiations are recorded, both directions. In-memory by default. |

### Examples

Runnable scripts making live OpenRouter calls, so outcomes are genuinely
non-deterministic rather than scripted:

| Script | Shows |
| --- | --- |
| `01-ask-user.ts` | Suspend and resume, with a host-injected operation alongside. |
| `02-intent-scope.ts` | One identity across scopes; identical cards, different instructions. |
| `03-negotiating-agent.ts` | The whole thing: opens a negotiation, asks the user mid-way, continues the same task. |
| `04-custom-actions.ts` | A support desk: custom actions and terminal states. |
| `05-authenticated.ts` | `inspect()`, a declared security scheme, a call refused without credentials. |

```bash
OPENROUTER_API_KEY=... bun run examples/03-negotiating-agent.ts
```

### Chatting with it from a terminal

`cli/chat.ts` is the smallest possible host: it builds an `Agent`, injects
the operations it may perform, calls `run()`, and carries `messages` and
`negotiations` from one call to the next. When a run comes back
`needs-input` the question becomes the prompt and your reply resumes it —
the live-chat loop from above, with a terminal on the other end.

The agent is doing two things at once, so the screen is split in two: the
conversation with the party it acts for on the left, the negotiation
traffic with other agents on the right. Interleaved in one log, they read
as noise.

```
 Bob's Agent · did:example:bob · Buy a reliable used road bike · serving :8081
 chat                                  │  negotiation
───────────────────────────────────────────────────────────────────────────────
 › Find my best match and negotiate    │ ▸ Bob's Agent (counter) I can offer
   with them for me.                   │   $430, and weekday evening pickup
 ⚒ find_matches {}                     │   works for me.
   → Alice's Agent 0.78 live           │ ◂ them (counter) $430 is lower than I
                                       │   can manage. The lowest is $460.
 ? Alice's lowest is $460 and your     │ ⚒ negotiate_turn {"guidance":"Offer
   budget is $450. Accept $460?        │   $430, within the $450 budget…
   Accept $460  ·  Walk away           │   → 5477fe2c · input-required
 ⠧ thinking 25s   ^C interrupt
 answer › _
```

Tab switches panes, PageUp/PageDown scroll the focused one (the other keeps
following its tail), ^C interrupts a run in flight — twice to exit — and ^D
exits. Under about 76 columns the panes stack instead of sitting side by
side. When stdout is a pipe there is nowhere to put a pane, so the two
streams interleave with markers and `bun run chat < script.txt` keeps
working.

```bash
bun run chat
bun run chat -- --intent "Buy a used road bike under $450" --serve 8081
```

`OPENROUTER_API_KEY` comes from `.env`. `--name`/`--id` set the identity,
`--system` (or `--system-file`) the standing instructions, `--intent` the
scope, `--serve <port>` answers inbound negotiations while you chat, and
`--resume <file>` picks a saved session back up.

Commands: `/matches` and `/intent` for discovery and scope,
`/negotiate <url>` to run one exchange outside the loop, `/inspect <url>`
for a counterparty's card, `/card` and `/instructions` for what this agent
publishes and what the model is told, `/negotiations` for open exchanges,
`/save` to write the session out, `/help` for the rest.

#### Intents and matches

Discovery is the host's job — Index Network is where parties publish
intents and get matched, and the package knows nothing about it. To make
that testable with two terminals, `cli/directory.ts` keeps the same shape
in a JSON file: an agent started with `--serve` publishes its intent and
A2A URL to `.agents.json`, and a `find_matches` tool pairs intents that
want opposite ends of the same thing.

```
› /matches
  ● Alice's Agent http://localhost:8080/ 0.78 · live
    Selling a Trek Domane 54cm road bike in good condition, asking $520
    both mention road, bike, condition; you are looking, they are offering
  ○ Frank's Agent http://localhost:8093 0.46 · offline
    Looking to buy a used road bike in good condition, budget 600 euros
    both mention buy, used, road, bike; you are both looking — nothing to trade
```

The matcher is a placeholder — word overlap, plus a bonus for wanting
opposite ends and a penalty for wanting the same one. It is there to be
replaced: swap `score()`, or replace the whole tool with a call into Index
Network, and nothing above it moves. `cli/fixtures/intents.json` seeds a
few made-up intents with nobody behind them, so a two-terminal test still
reads like a directory; `--no-seed` drops them, `--registry` moves the
file, and `--peer <url>` offers a counterparty without matching at all.

Matches carry a `status`, because an intent is not a running agent:
`live`, `offline` (a seeded intent), or `unreachable` (registered, but the
port is gone).

#### Two terminals

```bash
# Alice, selling
bun run chat -- --name "Alice's Agent" --id did:example:alice --serve 8080 \
  --intent "Selling a Trek Domane 54cm road bike in good condition, asking \$520" \
  --system "You act for Alice. She will go down to \$460 but no lower. Weekday evening collection."

# Bob, buying
bun run chat -- --name "Bob's Agent" --id did:example:bob --serve 8081 \
  --intent "Buy a reliable used road bike in good condition, under \$450"
› Find my best match and negotiate with them for me.
```

Bob's agent matches on intent, opens a negotiation with what it found, and
stops to ask Bob whatever it wasn't told — a ceiling, a collection day —
before carrying on in the same exchange. Both terminals print every turn as
it lands, each from its own side.

Like `dev/`, none of this is published — `files` is `dist` only. It exists
to drive the package by hand.

### Local simulation (dev/test only)

`dev/local.ts` stands one agent up on an ephemeral port and points the other
at it, so both sides of a negotiation run in one process. Not published, and
not how real usage looks — the point of A2A is that the two agents belong to
different owners on different machines. It exists for local iteration.

## Development

```bash
bun install        # install dependencies
bun run chat       # talk to an agent in the terminal
bun test           # run tests
bun run typecheck  # tsc --noEmit
bun run build      # bundle + emit .d.ts into dist/
```

`dist/` is what gets published; it's git-ignored and rebuilt via
`prepublishOnly`. `@indexnetwork/negotiator` is externalized rather than
bundled, so consumers resolve one copy of it.

### Project layout

```
src/
  index.ts        # public entry point
  core/
    agent.ts      # Agent: for(), run(), handler(), the negotiation methods
    loop.ts       # the agent loop, and suspend/resume
    sessions.ts   # the in-memory NegotiationStore
    model.ts      # OpenRouter client with tool calling
    tools.ts      # Tool, askUserTool(), negotiationTools()
    types.ts      # identity/intent, RunResult/Step, negotiation types
cli/
  chat.ts         # terminal chat: a minimal host around run(), not published
  directory.ts    # stand-in for the intent/match layer, file-backed
  surface.ts      # where output goes: panes on a terminal, lines in a pipe
  tui.ts          # the two-pane screen and its line editor
  line.ts         # the line-based fallback
  format.ts       # colour, ANSI-aware measuring and wrapping
  fixtures/       # made-up intents to match against
dev/
  local.ts        # in-process two-agent negotiation harness, not published
  stress.ts       # live scenarios: settled terms, location, time, currency
examples/         # runnable scripts against real OpenRouter calls
```

## License

MIT
