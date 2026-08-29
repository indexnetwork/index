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
const raising = agent.for("Raise a 400k pre-seed round");     // same identity
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
negotiate_open({ url, objective: "ask what they charge and on what terms" })
ask_user({ question: "It's $520. What's your ceiling?" })
  -> run() returns "needs-input"; host asks Tomas; resumes
negotiate_turn({ id, guidance: "Offer 900 a day; Tomas can go to 1,100" })
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

### Negotiating with many at once

One counterparty at a time is a conversation. Ten is management: reading
every turn of every exchange would bury the agent in payloads it can't
act on, and cost a model call per turn. So `negotiationTools()` also
gives the model a pair that works the way a subagent does — run in its
own context, report back once:

| Tool | Does |
| --- | --- |
| `negotiate_many` | Opens every target concurrently and runs each to an event. Returns one digest. |
| `negotiate_resume` | Folds the party's answer into parked negotiations and runs them on. |

A negotiation under `negotiate_many` may take one action a one-vs-one
turn may not: `ask`. It is intercepted before the wire — the counterparty
never sees it — and the negotiation parks with its question. The digest
groups what came back:

```
Settled (2):
- 61b3061c with Alice's Agent (https://alice.example) — agreed: {"amount":460}
- 9f2a1c3d with Bob's Agent (https://bob.example) — declined
Waiting on you (1) — ask your party once with ask_user, then call negotiate_resume with every id the answer applies to:
- 1a2b3c4d with Carol's Agent (https://carol.example) — asks: "Latest pickup day?" (their last move: "$480, Saturday" {"amount":480})
```

Every line names the URL it came from. Ids and party names are what the
counterparty chose; the URL is what *you* named the target as, and it is
the only thing a batch of results can be joined back on — an agent
without it eventually reports one seller's price under another's name.

Same-kind questions from several negotiations are the model's to
coalesce: it asks the party once and passes every applicable id to
`negotiate_resume`. Guidance given that way is standing — it holds for
the rest of each negotiation — unlike `negotiate_turn`'s per-turn
`guidance`.

#### One live negotiation per counterparty

Opening a second negotiation with a counterparty is refused while a
first one could still bind the party — `negotiate_open` throws, and
`negotiate_many` skips that target and says why:

| The existing negotiation | A second one |
| --- | --- |
| still going, or waiting on your party | refused — continue it, or answer it |
| closed as a deal (`agreed`, or `unconfirmed`) | refused — the deal stands; a second one adds to it rather than replacing it |
| closed with no deal (`declined`, `conflict`) | allowed — going back with a new offer is the point |
| for a different intent | allowed — buying a bike from someone is no reason not to negotiate a desk with them |

It is a real failure, not a theoretical one: an agent that couldn't see
how to move a negotiation waiting on its party re-opened all four of its
counterparties instead, and agreed the same purchase twice. Every
Task-level invariant held throughout — the two Tasks were independent and
each was valid — and nothing had told it not to.

Note what this does *not* do: it never reopens or edits a closed
negotiation. A settled negotiation still stays settled. It only refuses
to start a rival to one.

Parked negotiations travel on `RunResult.negotiations` and live in the
`NegotiationStore`, so a fresh `Agent` over the same store can resume
them. The same methods are available directly as `runNegotiation()` and
`resumeNegotiation()`; both return a `NegotiationEvent`, and `digest()`
renders a batch of them.

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

The same clock goes to the negotiator, so the loop and the negotiation
turns can't name different days across midnight. It's read as UTC for the
same reason; a host whose party lives elsewhere passes an instant shifted
into that timezone, and a test passes a fixed one.

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
- 61b3061c with Idris's Agent — you contacted them; agreed: {"day_rate":1000,"days_per_month":2}
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
| `01-ask-user.ts` | A founder's agent, asked to agree a day rate it was never given. Suspend and resume, with a host-injected operation alongside. |
| `02-intent-scope.ts` | One identity across scopes — raising a round, hiring an engineer. Identical cards, different instructions. |
| `03-negotiating-agent.ts` | The whole thing: agreeing terms with a fractional CFO, stopping mid-negotiation to ask the founder about equity, continuing the same task. |
| `04-custom-actions.ts` | An introduction, negotiated. No price anywhere: the actions are `introduce`, `refer` and `decline`, and what's being agreed is access to a person. |
| `05-authenticated.ts` | `inspect()`, a declared security scheme, a call refused without credentials. |

```bash
OPENROUTER_API_KEY=... bun run examples/03-negotiating-agent.ts
```

### The console

`cli/console.ts` stands the whole arrangement up in one process: several
parties, each with its own agent and its own A2A endpoint, so an
arrangement meant to span machines can be exercised from one terminal.

```bash
bun run console
bun run console -- --with Tomas --with Idris
```

Each party gets a column: its conversation on top, and beneath it the A2A
traffic **as that party saw it** — what it said, what came back, and the
verdict it reached.

```
 agent console · 2 parties · .agents.json
 Tomas                                    │  Idris
 Bring in a fractional CFO                │ Offering fractional CFO work
──────────────────────────────────────────────────────────────────────────────────────
 › find my best match and agree terms     │ › what are they offering?
 ⚒ find_matches {}                        │ Two days a month at 1,200 a day.
   → [{"name":"Idris","url":"http://…"}]  │
─ wire · 3 ───────────────────────────────── wire · 3 ────────────────────────────────
 → me  Would 1,000 a day work, two days   │ ← them  Would 1,000 a day work, two days
   a month, starting 2026-09-07?          │   a month, starting 2026-09-07?
 ← them  That works. Two days a month.    │ → me  That works. Two days a month.
   ⚖ agreed (reference) {"day_rate":1000,…}│   ⚖ agreed (reference) {"day_rate":1000,…}
──────────────────────────────────────────────────────────────────────────────────────
 tab agent · pgup/pgdn scroll · ^W hide wire · /help · ^D exit
 Tomas ›
```

The traffic is per party rather than shared, for the same reason
`settlement` exists at all: two parties can end one negotiation believing
different things, and that is only visible if each keeps its own account.
A single merged log would show one exchange and quietly hide the
disagreement — and it would be a view no real host has, since Alice's host
sees Alice's traffic and nothing else. Here the two accounts sit next to
each other and you read across. `^W` collapses the band when the
conversations are what matter.

Typing talks to the party in focus; Tab moves focus. Runs are detached, so
you can tell one party something while another is still negotiating, and
each column shows its own spinner. ^C interrupts the focused party's run,
^D exits.

| | |
| --- | --- |
| `/add <name> [--intent "..."]` | stand up another party |
| `/rm <name>`, `/use <name>`, `/who` | manage and switch between them |
| `/intent <text>` | scope the party in focus (`none` to unscope) |
| `/intent add "<text>"`, `/intent rm <id>` | publish an intent with no agent behind it, or remove one |
| `/intents` | everything published, live or not |
| `/match` | who this party's intent pairs with |
| `/negotiate <party> [objective]` | run one exchange to completion |
| `/card`, `/instructions`, `/steps`, `/negotiations` | look inside the agent in focus |
| `/clear` | forget the conversation · `/wire` clears this party's traffic |

Parties here can also say **`hold`** — "I can't commit yet, I need to check
with the person I act for" — alongside propose/counter/accept/reject. The
default vocabulary has no word for it, so an agent that lacks an
instruction rather than the will has only `reject`, which is terminal: a
message reading *"I'll get back to you as soon as possible"* arrives as a
dead negotiation, and both sides then tell their parties a story about who
walked away. `hold` isn't in `DEFAULT_TERMINAL`, so it needs no other
change — it's an example of what `allowedActions` is for.

Discovery is host-injected here as it would be anywhere: each party gets
`find_matches` and `create_intent`, both backed by `cli/directory.ts`, the
file-backed stand-in for the intent/match layer described below.

`create_intent` is what makes a party findable from a conversation. Say
*"I'm raising a pre-seed round, about 400k"* and the agent proposes the
wording, asks before publishing, and only then puts it on the directory:

```
› I'm raising a pre-seed round, about 400k, for a developer tools company
? Would you like me to publish your intent as: "Raising a 400k pre-seed
  round for a developer tools company"?
› Yes, publish that
⚒ create_intent {"statement":"Raising a 400k pre-seed round for a developer tools company"}
```

It refuses when they already have one — an intent is published under their
name and is what everyone else is matching against, so withdrawing from
that is theirs to decide, not something to do on a passing remark.

The asking is deliberate and costs nothing extra — it's the same
suspend/resume the agent already uses for every other question. An intent
is published under the party's name and is what everyone else matches
against, so the agent confirms the words rather than inventing them.
Neither tool is part of `Agent`: a host has its own notion of what an
intent is and where it lives. `--seed` loads made-up intents
with nobody behind them, so a two-party test still reads like a directory;
matches carry `live` or `offline` so an agent doesn't negotiate with a
port that isn't there.

Under about 26 columns per party the console shows as many as fit, centred
on the one in focus. With stdout piped it reads lines from stdin and prints
each party's output prefixed with its name, so scripted runs still work.

### Local simulation (dev/test only)

`dev/local.ts` stands one agent up on an ephemeral port and points the other
at it, so both sides of a negotiation run in one process. Not published, and
not how real usage looks — the point of A2A is that the two agents belong to
different owners on different machines. It exists for local iteration.

## Development

```bash
bun install        # install dependencies
bun run console    # drive several agents in one terminal
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
  console.ts      # the console: parties, commands, the run loop
  roster.ts       # the parties being driven, and their injected discovery
  tui.ts          # columns, the shared wire, and the line editor
  directory.ts    # stand-in for the intent/match layer, file-backed
  format.ts       # colour, ANSI-aware measuring and wrapping
  fixtures/       # made-up intents to match against
dev/
  local.ts        # in-process two-agent negotiation harness, not published
  stress.ts       # live scenarios: settled terms, location, time, currency
examples/         # runnable scripts against real OpenRouter calls
```

## License

MIT
