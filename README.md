# @indexnetwork/a2a

Agent2Agent (A2A) negotiation for personal agents: a client and server that
let an agent negotiate on a person's behalf with another person's agent over
the wire — a collaboration, a job, a first meeting — with an LLM negotiator
behind them, powered by [OpenRouter](https://openrouter.ai).

## Purpose

This package is how a personal agent negotiates with another one. In an
LLM-enhanced social discovery protocol, people don't browse each other; their
agents find a match and then work out the specifics — whether two builders
pair on a prototype and for how many hours a week, whether a candidate and a
hiring manager can agree on a start date, whether two people who matched
settle on a first meeting. The negotiation is where a match becomes something
concrete, and it needs to be checkable afterwards by both sides.

It implements a minimal subset of the [Agent2Agent (A2A)](https://a2a-protocol.org)
protocol — agent discovery and negotiation turns over `message/send` — plus
the decision-making core that decides what to say on each of those turns. A
personal agent, whether it's built with this package or is an OpenClaw,
Hermes, or Claude Agent implementation that just speaks A2A, can initiate or
respond to a negotiation task with any other A2A agent — one hosted by Index
Network, say, or by a different product entirely — without reimplementing
the protocol itself.

The negotiation semantics are the point here, not incidental: turns carry a
structured `NegotiationDecision`, acceptance binds to the offer it names,
and the outcome lands in a Task artifact you can verify. This is not a
general-purpose A2A transport, and the default path needs an OpenRouter key.

## How to use this package

Want to see what it does before writing any code? Skip to the
[CLI](#cli-trying-it-out) — `index-a2a sim` runs both sides of a
negotiation in your terminal.

There are two layers, and most projects only need to reach for one:

- **Need to talk to another agent over the network?** Use `@indexnetwork/a2a`
  — see [A2A](#a2a-sending-and-receiving-negotiations-over-the-wire). It
  wraps a `Negotiator` with a real A2A client and server, so you can
  `initiate()`/`continue()` a negotiation with another agent's endpoint, or
  mount `createA2AHandler()` in your own server to receive one.
- **Just need to draft a message or pick an action?** Use `Negotiator` from
  `@indexnetwork/a2a/negotiator` directly (`respond()` for a plain message,
  `decide()` for a structured action) — see [Usage](#usage). This is the
  right level if you already have your own way of sending and receiving
  negotiation turns (your own transport, or another A2A implementation) and
  only need the "what do I say next" part.

`Negotiator` plays one side of a negotiation: given a party's objective and
the conversation so far, it returns that party's next message or decision.
It doesn't run or own the other side — the caller owns the transcript and
calls `respond()`/`decide()` once per turn.

Either way, install the package first:

## Requirements

- **Runtime**: Node ≥ 20, or Bun — anything with global `fetch` and
  `crypto.randomUUID()`. The package ships as ESM only (`"type": "module"`),
  no CommonJS build.
- **TypeScript ≥ 5** if you're consuming it from a TS project (listed as a
  peer dependency; not required at runtime — `dist/` ships plain JS + `.d.ts`).
- **An [OpenRouter](https://openrouter.ai) API key** — required by `Negotiator`,
  and therefore by the A2A layer's default decision path, which wraps one.
  See [Configuration](#configuration).
- **A network-reachable HTTP endpoint** if you're using `@indexnetwork/a2a`'s
  server side (`createA2AHandler()`) to actually receive negotiations from
  other agents — the library gives you the handler, you still need to host it.

## Installation

```bash
bun add @indexnetwork/a2a
```

or with npm/yarn/pnpm:

```bash
npm install @indexnetwork/a2a
```

Coming from `@indexnetwork/negotiator`? The two entry points swapped places
in the rename — see [MIGRATION.md](./MIGRATION.md).

## Configuration

`Negotiator` needs an OpenRouter API key, either passed explicitly or read
from the `OPENROUTER_API_KEY` environment variable:

```bash
export OPENROUTER_API_KEY=sk-or-...
```

| Option    | Type     | Required | Description                                                                 |
| --------- | -------- | -------- | ---------------------------------------------------------------------------- |
| `apiKey`  | `string` | No       | OpenRouter API key. Falls back to `OPENROUTER_API_KEY` if omitted.            |
| `model`   | `string` | No       | OpenRouter model id. Defaults to `google/gemini-3.7-flash`.                        |
| `fallbackModels` | `string[]` | No | Models to route to, in order, when `model` fails. Defaults to `["openai/gpt-5.4-mini"]`; `[]` disables. See [Model fallback](#model-fallback). |
| `onFallback` | `(model: string) => void` | No | Called when a turn was answered by a fallback model rather than `model`. |
| `referer` | `string` | No       | Sent as `HTTP-Referer`, per [OpenRouter's app attribution](https://openrouter.ai/docs). |
| `title`   | `string` | No       | Sent as `X-Title`, per OpenRouter's app attribution.                         |
| `maxTokens` | `number` | No     | Output token cap per call. Defaults to 2048; raise it if decisions carrying large structured terms hit truncation. |
| `timeoutMs` | `number` | No     | How long one model call may take before it's abandoned. Defaults to 120000 (120s); `0` disables it. See [Deadlines and cancellation](#deadlines-and-cancellation). |
| `now` | `() => Date` | No | Supplies the date told to the model each turn, rendered in UTC. Defaults to `() => new Date()`. Also the timezone control, and the way to keep one clock across a host that has its own — see [Dates in terms](#knowing-what-actually-happened). |

```ts
const negotiator = new Negotiator({
  apiKey: "sk-or-...",
  model: "google/gemini-3.5-flash",
  referer: "https://example.com",
  title: "My App",
});
```

Constructing a `Negotiator` throws immediately if no API key is available
from either source.

### Model fallback

A model can be rate-limited upstream, down, or refuse a request, and a
negotiation turn that fails for any of those reasons is a turn the other
party never sees. So every model call carries a fallback list, sent as
OpenRouter's `models` routing parameter: OpenRouter tries `model` first and
moves down the list when a call errors, and bills the request at whichever
model answered.

The default fallback is `openai/gpt-5.4-mini` — fast, reliable at
structured JSON, in the same price tier as the default Gemini Flash, and on
a different upstream, so one provider's bad hour doesn't stall every
negotiation. Override the list to taste, or pass `[]` to insist on one
model:

```ts
const negotiator = new Negotiator({
  model: "google/gemini-3.7-flash",
  fallbackModels: ["openai/gpt-5.4-mini", "z-ai/glm-5.3-flash"],
  onFallback: (model) => console.warn(`turn answered by ${model}`),
});
```

Two failures OpenRouter doesn't count as errors are covered on this side:
a `200` with no content in it, and a `decide()` body that isn't JSON (a
model that stopped mid-string). Either one gets a single further call that
skips `model` and goes straight to the fallback chain.

`onFallback` fires when a response came from anything other than `model`,
so a transcript never changes model silently. Fallback covers a failed
call; it is not a retry of a slow one — see
[Deadlines and cancellation](#deadlines-and-cancellation) for that side.

## CLI: trying it out

The package ships an `index-a2a` command for exercising the library from a
terminal — useful for feeling out how an objective shapes an agent's
behavior before wiring anything up. It needs `OPENROUTER_API_KEY` in the
environment (a `.env` file in the working directory works too), and Bun to
run (the `serve` command uses `Bun.serve`).

Inside this repo, run it with `bun run src/cli/index.ts <command>`; once
the package is installed, just `index-a2a <command>`.

| Command | What it does |
| --- | --- |
| `sim` | Runs both sides locally — two agents negotiate with each other, no network involved. |
| `play` | You type your side, an agent plays the other. |
| `serve` | Runs one agent as an A2A server answering incoming negotiations. |
| `connect <url>` | Negotiates against another agent's A2A endpoint over HTTP. |

Watch two personal agents work out a collaboration:

```bash
index-a2a sim \
  --a Mara  --a-objective "Get a designer to pair on your local-events prototype, about 6 hours a week for 4 weeks, starting as soon as possible; you can offer a co-creator credit but no pay" \
  --b Deniz --b-objective "Help on a side project you find interesting, at most 4 hours a week, not before you're back from a trip next Tuesday; you want a co-creator credit"
```

```
Mara (propose) Hi Deniz — I'm building a small local-events app and would love a designer to pair with. Could you do about 6 hours a week for 4 weeks, starting Monday? I can't pay, but you'd be credited as co-creator.
Deniz (refine) That sounds like something I'd enjoy. Six hours a week is more than I can give right now, and I'm away until next Tuesday — could we do 4 hours a week over 6 weeks instead, starting the 8th?
Mara (refine) 4 hours works if we can do 5 weeks — I'd like something to show by mid-October. Starting the 8th is fine.
...
ended after 5 turns — Deniz chose "accept"
```

Negotiate against one yourself:

```bash
index-a2a play --agent Deniz --objective "Help on a side project, at most 4 hours a week, not before next Tuesday" --me Mara
```

Or run the real A2A path across two processes, with bearer auth on the wire
(see [Authenticating `message/send` calls](#authenticating-messagesend-calls)):

```bash
# terminal 1
index-a2a serve --name Deniz --objective "Help on a side project you find interesting, at most 4 hours a week, not before next Tuesday; co-creator credit required" \
                --port 3000 --token s3cret

# terminal 2
index-a2a connect http://localhost:3000 --name Mara \
                  --objective "Get a designer to pair on your prototype, about 6 hours a week for 4 weeks; nothing longer than 8 weeks" \
                  --token s3cret --expect Deniz
```

`connect` fetches the counterparty's AgentCard first and warns if it
declares a security requirement you haven't supplied a `--token` for;
`--expect <name>` refuses to negotiate unless the card identifies as that
agent.

Shared options across commands: `--model <id>` to pick an OpenRouter model,
`--fallback <list>` for the models to route to when it fails (default
`openai/gpt-5.4-mini`; `none` disables — see [Model fallback](#model-fallback)),
`--actions <list>` for a custom action vocabulary (default
`propose,refine,accept,decline`), `--terminal <list>` for which of those end
the negotiation (default `accept,reject,decline,withdraw`), and `--turns <n>`
as a safety cap. Run `index-a2a help` for the full list.

`--terms <fields>` (on `sim`, `serve`, and `connect`) turns on structured
terms, so you can watch acceptance bind to a specific offer instead of
living in prose — see [Knowing what actually happened](#knowing-what-actually-happened):

```bash
index-a2a sim \
  --a Mara  --a-objective "Get a designer to pair on your prototype, about 6 hours a week for 4 weeks, starting as soon as possible; co-creator credit, no pay. Settle a start date too." \
  --b Deniz --b-objective "Help on a side project, at most 4 hours a week, not before you're back next Tuesday; co-creator credit required." \
  --terms "hoursPerWeek (number), weeks (number), startDate (YYYY-MM-DD)"
```

```
Mara (propose) Hi Deniz — I'm building a small local-events app and would love a designer to pair with. Could you do about 6 hours a week for 4 weeks, starting Monday? I can't pay, but you'd be credited as co-creator.
    terms {"hoursPerWeek":6,"weeks":4,"startDate":"2026-09-07"}
Deniz (refine) That sounds like something I'd enjoy. Six hours a week is more than I can give right now, and I'm away until next Tuesday. Could we do 4 hours a week over 6 weeks instead, starting the 8th? Same total time, and co-creator credit works for me.
    terms {"hoursPerWeek":4,"weeks":6,"startDate":"2026-09-08"}
Mara (accept) That works — 4 hours a week for 6 weeks from 8 September, co-creator credit. I'll have the repo ready before then.
    terms {"hoursPerWeek":4,"weeks":6,"startDate":"2026-09-08"} accepts:3f2a9c1e

ended after 3 turns — Mara chose "accept"
agreed {"hoursPerWeek":4,"weeks":6,"startDate":"2026-09-08"}
```

Over HTTP, pass the same `--terms` to both `serve` and `connect`. If only one
side emits terms, there is no counterparty `offerId` for an acceptance to
bind to, so `connect`'s closing verdict can at best be `basis: "terms"`,
never `"reference"`.

## Usage

```ts
import { Negotiator } from "@indexnetwork/a2a/negotiator";

const negotiator = new Negotiator({ model: "google/gemini-3.7-flash" });

const reply = await negotiator.respond({
  party: { name: "Deniz", objective: "Help on a side project, at most 4 hours a week, not before next Tuesday" },
  history: [
    { role: "incoming", content: "Could you pair with me on my prototype, about 6 hours a week for 4 weeks, starting Monday?" },
  ],
});

console.log(reply);
```

`respond()` takes a `NegotiationState`:

| Field           | Type                                                   | Description                                                          |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `party.name`      | `string`                                                | Name of the party this `Negotiator` speaks for.                     |
| `party.objective` | `string`                                                | That party's goal, given to the model as context.                   |
| `history`         | `{ role: "incoming" \| "outgoing", content: string }[]` | Messages so far, oldest first, relative to this party (`"outgoing"` = this party's own past messages, `"incoming"` = the other side's). |

It resolves to a `string`: the next message to send. It throws if the
OpenRouter request fails or returns no content.

### Deciding a structured turn

When the caller needs more than a message — e.g. an explicit action to
record, such as `accept`/`decline`/`refine` — use `decide()` instead. It
takes the same `NegotiationState`, plus the set of actions allowed for this
turn, and returns one of them along with the message:

```ts
const decision = await negotiator.decide(
  {
    party: { name: "Deniz", objective: "Help on a side project, at most 4 hours a week, not before next Tuesday" },
    history: [{ role: "incoming", content: "Could you pair with me on my prototype, about 6 hours a week for 4 weeks, starting Monday?" }],
  },
  {
    allowedActions: [
      "refine",
      "accept",
      { action: "decline", description: "End the conversation without an arrangement" },
    ],
  },
);

console.log(decision); // { action: "refine", message: "..." }
```

`allowedActions` entries can be a bare string, or `{ action, description }`
when the action's name alone isn't self-explanatory — the description is
given to the model as context for what choosing that action means.

`decide()` never includes reasoning in its output: the `message` is the only
thing the other party sees, and internal reasoning for why an action was
chosen is out of scope for this library (surfacing that to a human reviewer,
if needed, is the caller's responsibility). It throws if the model returns
invalid JSON, or chooses an action outside `allowedActions`.

## A2A: sending and receiving negotiations over the wire

The package root, `@indexnetwork/a2a`, implements a minimal subset of the
[Agent2Agent protocol](https://a2a-protocol.org): agent discovery via an
AgentCard, and negotiation turns as JSON-RPC `message/send` calls carrying
this package's `NegotiationDecision` as a data part. Streaming (SSE) and
push-notification webhooks aren't implemented yet — every turn is a
synchronous HTTP request/response.

### Server: responding to negotiations

`createA2AHandler()` builds a framework-agnostic `(Request) => Promise<Response>`
you can mount in any HTTP server. It serves this agent's AgentCard at
`/.well-known/agent-card.json`, and on `message/send` decides a turn (by
default via `negotiator.decide()` — see [Customizing how a turn is decided](#customizing-how-a-turn-is-decided-and-extracting-value-from-it)
below) and replies with the updated Task:

```ts
import { Negotiator } from "@indexnetwork/a2a/negotiator";
import { createA2AHandler } from "@indexnetwork/a2a";

const handler = createA2AHandler({
  negotiator: new Negotiator({ model: "google/gemini-3.7-flash" }),
  party: { name: "Deniz", objective: "Help on a side project, at most 4 hours a week, not before next Tuesday" },
  allowedActions: ["propose", "refine", "accept", "decline"],
  agentCard: {
    name: "Deniz's Agent",
    url: "https://deniz.example.com/a2a",
    version: "1.0.0",
    capabilities: {},
    skills: [{ id: "negotiate", name: "Negotiate a collaboration" }],
  },
});

Bun.serve({ port: 3000, fetch: handler });
```

A negotiation ends (`task.status.state` becomes `completed`/`rejected`/`canceled`)
once `decide()` picks a terminal action. By default those are `accept`
(→ `completed`), `withdraw` (→ `canceled`), and `reject` or `decline`
(→ `rejected`). Pass `isTerminal(action)` to `createA2AHandler()` to override
which actions end the negotiation, and `terminalState(action)` to override
which final state a terminal action maps to (the default mapping only makes
sense for that default vocabulary — a custom one, e.g. `commit`/`pass`/`defer`,
needs its own).

### Customizing how a turn is decided, and extracting value from it

Two optional hooks, available on both `createA2AHandler()` and
`A2ANegotiationClient`:

- **`strategy(negotiator, state, allowedActions, options?)`** — replaces the
  default `negotiator.decide(state, { allowedActions })` call. Use this to
  customize behavior per negotiation domain or personal agent type — gather
  extra context first, consult a different model, whatever your case needs.
  The A2A wire format doesn't change either way; this only affects what
  happens before a decision is produced. `options` carries the turn's
  deadline — forward it, or your strategy is the one step in the chain that
  can't be interrupted (see
  [Deadlines and cancellation](#deadlines-and-cancellation)). It's optional,
  so three-argument strategies still fit.
- **`evaluate(task, decision)`** — runs after a turn is decided. Return an
  Artifact (`{ artifactId, name?, parts }`) to attach structured findings —
  a score, extracted terms, anything useful — to the Task, separate from the
  negotiation message itself. On the server, artifacts accumulate on
  `task.artifacts` (visible to anyone who can read that Task). On the
  client, `evaluate()` runs locally and its result comes back on
  `A2ATurnResult.artifact` instead — the client doesn't own the server's
  Task, so its own evaluation never gets attached to it.

```ts
const handler = createA2AHandler({
  // ...negotiator, party, allowedActions, agentCard,
  strategy: async (negotiator, state, allowedActions, options) => {
    // e.g. domain-specific context injection, multiple negotiators, etc.
    return negotiator.decide(state, { allowedActions, ...options });
  },
  evaluate: (task, decision) => ({
    artifactId: crypto.randomUUID(),
    name: "turn-evaluation",
    parts: [{ kind: "data", data: { action: decision.action, turn: task.history.length } }],
  }),
});
```

### Client: initiating and continuing negotiations

`A2ANegotiationClient` is the other side: it calls `negotiator.decide()` for
this side's move, then sends it to another agent's A2A endpoint. `initiate()`
starts a new negotiation; `continue()` keeps responding to one that's still
`input-required`:

```ts
import { Negotiator } from "@indexnetwork/a2a/negotiator";
import { A2ANegotiationClient } from "@indexnetwork/a2a";

const client = new A2ANegotiationClient({
  negotiator: new Negotiator({ model: "google/gemini-3.7-flash" }),
  party: { name: "Mara", objective: "Get a designer to pair on your prototype, about 6 hours a week for 4 weeks; co-creator credit, no pay" },
  allowedActions: ["propose", "refine", "accept", "decline"],
});

let { task, decision, outcome } = await client.initiate("https://deniz.example.com/a2a");
console.log(decision); // { action: "propose", message: "..." } — this side's own move
console.log(outcome); // "input-required" — what the negotiation actually is now

while (outcome === "input-required") {
  ({ task, decision, outcome } = await client.continue("https://deniz.example.com/a2a", task));
}

console.log(outcome); // "completed" | "rejected" | "canceled"
```

The Task returned by the server is authoritative — `continue()` reads the
full turn history from it, so the client doesn't need to track state itself
beyond holding onto the last `task` it received.

### Knowing what actually happened

Two things are easy to conflate, and getting them backwards is how two
agents end up reporting different results for the same negotiation:

- **`decision.action`** is *this side's own move* — an input to the outcome,
  never a verdict on it. Your agent can pick `accept` in the very round trip
  where the counterparty picks `decline`.
- **`outcome`** (`=== task.status.state`) is *what the negotiation is*. The
  A2A spec makes the server the single authority on task state, so this is
  the answer to "did we close?". Read this, not your own action.

That covers *whether* a deal closed. **What** was agreed is a separate
question, and prose can't answer it: two agents can both say `accept` while
one means six hours a week for four weeks and the other means four hours a
week for six, and nothing in the message text makes that detectable. A
`NegotiationDecision` can therefore carry structured terms:

| Field | Meaning |
| --- | --- |
| `terms` | The concrete offer this decision puts on the table, as data — `{ hoursPerWeek: 4, weeks: 6, startDate: "2026-09-08" }`. |
| `offerId` | Identifies this decision's own offer. Assigned automatically whenever a decision carries `terms`. |
| `acceptsOfferId` | For an accepting move: which `offerId` it binds to. Without it, "accept" names no particular offer. |

Pass `DecideOptions.terms` (or `strategyWithTerms()` on the A2A layer) to
describe the fields a decision should emit, and the model is asked to fill
them in and to name the offer it accepts:

```ts
import { strategyWithTerms, verifyAgreement } from "@indexnetwork/a2a";

const client = new A2ANegotiationClient({
  // ...negotiator, party, allowedActions,
  strategy: strategyWithTerms("hoursPerWeek (number), weeks (number), startDate (YYYY-MM-DD)"),
});
```

**Dates in terms are made absolute.** The negotiator is told today's date
and weekday on every turn, and asked to write dates in `terms` as
`YYYY-MM-DD` rather than "next Tuesday" or "end of the month". This matters
more than it looks: a relative date is unresolvable to the *other* party the
moment it's sent, because their "next Tuesday" is anchored to when they read
it, and it's unresolvable to anyone a week later — while `terms` exists
precisely to be read back after the fact.

Without a clock the model can't comply even when asked, so it invents a
date, and a confident wrong date is worse than a visibly vague one. With
one, a collaborator who is "away until next Tuesday" writes
`{"startDate": "2026-09-08"}`, a counterpart who needs to start by 4
September can see the conflict, and a deal that should never have closed
doesn't. If you write your own `terms` description, you don't need to
restate the date rule — it's already in the prompt.

Two things about that clock are worth knowing, because neither is visible
from the outside:

- **The date is rendered in UTC**, so it can be a day off from your party's
  wall clock. `now` is the control, and it works because it returns an
  *instant* rather than a date — shift the instant to put the model on your
  party's day: `now: () => new Date(Date.now() - 8 * 60 * 60 * 1000)`.
- **If your own code also tells a model the date** — a surrounding agent
  loop with its own system message, say — give it the same `now`. Two
  clocks that both default to `new Date()` agree almost always and disagree
  across midnight, or as soon as a host pins one and not the other. An agent
  telling its counterparty "today is the 31st" while negotiating as though
  it were the 1st is a bug that hides for months.

Then `verifyAgreement(task)` reports what the task settled on, computed from
the Task itself — so both sides run it over the same record and reach the
same verdict:

```ts
const result = verifyAgreement(task);
// { status: "agreed", basis: "reference", terms: { hoursPerWeek: 4, weeks: 6, startDate: "2026-09-08" } }
```

| `status` | Meaning |
| --- | --- |
| `agreed` | The closing move bound to a specific offer. `result.terms` holds it. |
| `declined` | The task ended without a deal. |
| `open` | Not terminal yet. |
| `conflict` | Completed, but the two closing moves bound to different terms. **Don't act on this as a deal.** |
| `unconfirmed` | Completed, but no decision carried structured terms — there's nothing to verify. Enable `terms` to fix. |

`basis` says what evidence the verdict rests on, so a caller can accept
weaker evidence for a low-stakes deal and demand stronger evidence when
something irreversible depends on it. `status` means the same thing either
way:

| `basis` | Meaning |
| --- | --- |
| `reference` | The closing move named the `offerId` it accepted — provenance. |
| `terms` | The closing moves' terms were compared directly, with no reference between them — content equality, not provenance. |
| `state` | From the server-stamped task state alone, no terms involved. |
| `prose` | Never produced here; reserved so a caller layering its own text-level fallback can label it in the same vocabulary. |

To require provenance rather than mere agreement, check
`status === "agreed" && basis === "reference"`. Expect this union to grow —
a signed or content-addressed acceptance would arrive as a new `basis`, not
as a change to what `status` means.

#### When you don't know the domain ahead of time

`DecideOptions.terms` is a free-text prompt fragment, not a schema, so a
host negotiating over arbitrary subjects can pass a generic description
instead of enumerating fields:

```ts
strategyWithTerms("whatever terms are material to this deal, as flat key/value pairs")
```

That works — the model picks domain-appropriate keys, and both sides
converge on the same ones because each sees the other's terms in the
history. One caveat: key naming isn't stable *across* negotiations (one run
produces `hours_per_week`/`start`, another `hoursPerWeek`/`startDate`), and
`basis: "terms"` comparison is exact-match. `basis: "reference"` is immune,
since it compares offer ids rather than shapes.

#### The outcome artifact

On a terminal action the server records the verdict on the Task as an
artifact, which is where the spec wants results to live rather than in
message prose. It has a stable id, exported as `OUTCOME_ARTIFACT_ID`
(`"negotiator:negotiation-outcome"`), so consumers can look it up directly
instead of filtering on the display `name`, and so a task that closes twice
replaces the entry rather than appending a contradictory second one.

> **Note for existing callers:** this appends to `task.artifacts` on
> terminal turns only. Code that asserts an exact artifact list, or indexes
> `artifacts[0]`, will see a change on the first negotiation that closes —
> which passes in dev and surprises in production. Match on
> `artifactId === OUTCOME_ARTIFACT_ID` to find it, and prefer `toContain`
> over exact-list assertions for your own `evaluate()` artifacts.

#### A settled task stays settled

Once a task reaches a terminal state (`completed`, `rejected`, `canceled`,
`failed`), `createA2AHandler()` refuses further `message/send` calls on it
with a JSON-RPC error and HTTP 409, naming the state:

```
Task "…" is completed and cannot accept further messages. Start a new task
to negotiate again.
```

This is a correctness guarantee, not a policy choice. Answering a message on
a finished task would append a turn and re-stamp the state from the new
decision — so the agreement the task had already certified disappears from
the record, `verifyAgreement()` reverts to `open`, and the outcome artifact
is left contradicting the task's own state. Both agents then see an open
negotiation and, quite correctly given what they can see, reopen terms
that were already settled. That looks like a prompting problem
and isn't one: the model reads the state accurately, the state is wrong.

The check lives on the server because that's where the task is owned. A
careful client can't provide this guarantee — the risk is a *counterparty*
sending on your finished task, and only the side holding the record can
refuse. `A2ANegotiationClient.continue()` also throws on a terminal task,
but that's a convenience so you don't spend a model call on an
undeliverable turn, not the protection itself.

To negotiate the same subject again, call `initiate()` for a new task.
`isTerminalTaskState(state)` is exported if you want to check before
sending.

### Using the AgentCard as a trust check

`createA2AHandler()` serves an AgentCard, but nothing negotiates *for* you
whether to trust the agent at a given URL — this library doesn't fetch or
verify a counterparty's card before sending it a message. If your caller
already vets which agents can talk to which (e.g. a matching/orchestration
layer that only hands out endpoints for agents it already knows), that's
often enough and you can skip this. If you want a defense-in-depth check
before negotiating with a URL you don't otherwise trust, use `fetchAgentCard()`
and verify it identifies as who you expect:

```ts
import { fetchAgentCard } from "@indexnetwork/a2a";

const card = await fetchAgentCard("https://deniz.example.com/a2a");
if (card.name !== "Deniz's Agent") {
  throw new Error(`Unexpected agent at this URL: ${card.name}`);
}
// proceed to client.initiate(...) / client.continue(...)
```

There's no card signature scheme — `card.name` is only as trustworthy as
whatever's serving it — but `message/send` calls can be gated with real
authentication; see the next section.

### Authenticating `message/send` calls

`createA2AHandler()` takes an `authenticate` hook and `A2ANegotiationClient`/
`sendA2AMessage()` take a matching `credentials` hook. Neither one hardcodes
a scheme — the library only enforces whatever verdict `authenticate` returns,
so it works the same whether you're calling a personal agent inside Index
Network, or one built on Hermes, OpenClaw, Claude, or anything else that
speaks A2A. The public AgentCard GET is left unauthenticated, matching the
spec's public-card model; only `message/send` is gated.

For a single trust boundary you control (e.g. two of your own agents talking
over an internal network), a static bearer token is enough — use the
built-in helpers:

```ts
import { bearerCredentials } from "@indexnetwork/a2a"; // client side
import { bearerTokenAuth } from "@indexnetwork/a2a"; // server side

const handler = createA2AHandler({
  // ...negotiator, party, allowedActions, agentCard,
  authenticate: bearerTokenAuth(process.env.A2A_SHARED_SECRET!),
});

const client = new A2ANegotiationClient({
  // ...negotiator, party, allowedActions,
  credentials: bearerCredentials(process.env.A2A_SHARED_SECRET!),
});
```

Across separate deployments that don't share a secret (e.g. an Index
Network personal agent negotiating with an agent hosted by a different
product), verify a token issued by *its own* identity provider instead of
comparing against a shared value — write a custom `authenticate` that
checks a bearer JWT against the issuer's JWKS (e.g. with a library like
`jose`), and declare the requirement on your `AgentCard` so callers can
discover it before they connect:

```ts
const handler = createA2AHandler({
  // ...
  agentCard: {
    // ...name, url, version, skills,
    capabilities: {},
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "JWT signed by your agent's issuer" },
    },
    security: [{ bearerAuth: [] }],
  },
  authenticate: async (request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token) return null;
    const { payload } = await jwtVerify(token, jwks); // e.g. from `jose`
    return { subject: payload.sub!, claims: payload };
  },
});
```

`authenticate`/`credentials` return/accept plain objects, so any scheme —
mTLS terminated by a reverse proxy that forwards a verified client identity
header, an OAuth2 access token, a signed request — plugs in the same way.

### Deadlines and cancellation

Every call in this library that goes to the network talks to something that
can accept a connection and then never answer: a model endpoint, or a
counterparty agent. Two mechanisms bound that, and they stack.

**A built-in deadline**, so nothing hangs forever by default:

| Call | Default | Override |
| ---- | ------- | -------- |
| `Negotiator.respond()` / `.decide()` | 120s | `new Negotiator({ timeoutMs })`, or per call |
| `sendA2AMessage()` / `A2ANegotiationClient` turns | 180s | `new A2ANegotiationClient({ timeoutMs })`, or per turn |
| `fetchAgentCard()` | 30s | per call |

The model default is deliberately generous — a real reasoning turn can run
close to a minute, and a deadline that fires on a slow-but-working model is
worse than none. The `message/send` default is longer still, because the
counterparty runs a full model turn of its own inside it. These bound the
failure that never resolves; they don't police slowness. Pass `0` to
disable one.

**Your own `signal`**, so a host can impose its own policy or forward an
interrupt. Every one of these calls takes `{ signal, timeoutMs }` as a
trailing options argument:

```ts
const controller = new AbortController();
process.once("SIGINT", () => controller.abort(new Error("interrupted")));

const card = await fetchAgentCard(url, credentials, { signal: controller.signal });

let { task, outcome } = await client.initiate(url, { signal: controller.signal });
while (outcome === "input-required") {
  ({ task, outcome } = await client.continue(url, task, { signal: controller.signal }));
}
```

A turn's `signal` covers the whole turn — this side's model call *and* the
wait on the counterparty — so an interrupt reaches the request in flight,
not just the loop around it.

The two are told apart on failure. The built-in deadline throws an error
naming how long it waited (`A2A message/send to ... timed out after
180000ms`); **your abort is rethrown as-is**, with the `reason` you supplied
preserved, so a cancellation is never reported as a fault of the library's:

```ts
try {
  await client.initiate(url, { signal: controller.signal });
} catch (error) {
  if (controller.signal.aborted) return; // ours — the user interrupted
  throw error;                           // theirs — a timeout or a real failure
}
```

The server side needs nothing: `createA2AHandler()` passes the incoming
request's signal to its strategy, so a caller that hangs up mid-turn stops
the handler's own model call rather than leaving it to finish a reply with
nowhere to go.

**Custom strategies** receive the turn's deadline as a fourth argument.
Forward it, or your strategy is the one thing in the chain that can't be
interrupted:

```ts
const strategy: DecisionStrategy<"accept" | "reject"> = async (
  negotiator,
  state,
  allowedActions,
  options, // { signal?, timeoutMs? } — optional, so 3-arg strategies still fit
) => negotiator.decide(state, { allowedActions, ...options });
```

Retries are deliberately *not* built in: what's worth retrying, how often,
and with what backoff is host policy, and a library that guessed would
double up with a caller that already retries. The `signal` is what a host
needs to build its own.

### Examples

`examples/` has runnable, self-contained scripts covering the A2A surface —
each uses real `Negotiator` instances making live OpenRouter calls (needs
`OPENROUTER_API_KEY`), so outcomes are genuinely non-deterministic rather
than scripted:

| Script | Shows |
| --- | --- |
| `01-basic-negotiation.ts` | A collaboration: one server (Deniz), one client (Mara) — the minimal shape, on the scenario this README follows, with structured terms and `verifyAgreement()`. |
| `02-symmetric-peers.ts` | Ideas and introductions: both sides run their own server *and* initiate their own negotiation — real peer-to-peer. |
| `03-agent-card-trust-check.ts` | Hiring: `fetchAgentCard()` as an identity check before sending anything about a candidate. |
| `04-custom-strategy.ts` | Finding a job: a `strategy` hook that skips the LLM entirely and decides from the counterparty's structured terms — and still closes a verifiable deal. |
| `05-evaluate-artifacts.ts` | Dating: an `evaluate` hook scoring each turn from its terms, both server- and client-side. |
| `06-custom-action-vocabulary.ts` | Mentorship: a vocabulary shaped like the domain (`ask`/`offer`/`commit`/`pass`/`defer`), with a `terminalState` that uses all three final states. |

Run any of them directly: `OPENROUTER_API_KEY=... bun run examples/01-basic-negotiation.ts`
(Bun loads `.env` automatically, so a project-root `.env` with the key works too).

For a similar real, non-deterministic demo, see `dev/a2a-demo.ts` —
`bun run dev/a2a-demo.ts`.

### Local simulation (dev/test only)

`dev/simulate.ts` is a harness for local iteration inside this repo — it
runs both sides of a negotiation in-process with `runNegotiation`. It isn't
published (see `files` in `package.json`) and isn't how a real negotiation
works (both parties are usually separate processes); it's only reachable via
a relative import from within this repo, e.g. from a script or test:

```ts
import { Negotiator } from "../src/index.ts";
import { runNegotiation } from "./simulate.ts";

const mara = {
  party: { name: "Mara", objective: "Get a designer to pair on your prototype, about 6 hours a week for 4 weeks; co-creator credit, no pay" },
  negotiator: new Negotiator({ model: "google/gemini-3.7-flash" }),
};

const deniz = {
  party: { name: "Deniz", objective: "Help on a side project, at most 4 hours a week, not before next Tuesday" },
  negotiator: new Negotiator({ model: "google/gemini-3.7-flash" }),
};

const transcript = await runNegotiation([mara, deniz], {
  maxTurns: 10,
  stopWhen: (entry) => /works for me|agreed|deal/i.test(entry.content),
});

for (const entry of transcript) {
  console.log(`[${entry.speaker === 0 ? mara.party.name : deniz.party.name}] ${entry.content}`);
}
```

## Development

```bash
bun install      # install dependencies
bun test         # run tests
bun run typecheck  # tsc --noEmit
bun run build    # bundle both entry points + emit .d.ts into dist/
```

`dist/` is what gets published (see `files`/`exports` in `package.json`); it's
git-ignored and rebuilt via `prepublishOnly`, not committed.

### Project layout

```
src/
  index.ts         # entry point for @indexnetwork/a2a/negotiator —
                   #   re-exports core/ only. Note the inversion: this is
                   #   the subpath, and a2a/index.ts is the package root.
  core/            # the decision engine: Negotiator.respond()/decide(),
                   #   plus the shared deadline/cancellation helper
  a2a/             # the A2A protocol layer, built on core/
    index.ts       # entry point for @indexnetwork/a2a (the package root)
    wire/          # shared protocol types and NegotiationDecision <-> A2A message encoding
    server/        # createA2AHandler() + Task storage + the authenticate hook helper
    client/        # A2ANegotiationClient + the raw message/send transport call
  cli/             # the `index-a2a` command (see "CLI" above), built to dist/cli
dev/
  simulate.ts      # local two-sided harness (see "Local simulation" above), not published
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## License

[MIT](./LICENSE)
