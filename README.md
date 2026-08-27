# @indexnetwork/negotiator

An LLM-enhanced negotiator library, powered by [OpenRouter](https://openrouter.ai).

`Negotiator` plays one side of a negotiation: given a party's objective and
the conversation so far, it returns that party's next message or decision.
It doesn't run or own the other side of the conversation — the caller owns
the transcript and calls `respond()`/`decide()` once per turn.

## Purpose

This package is the decision-making core for a personal agent's side of a
negotiation, plus an [Agent2Agent (A2A)](https://a2a-protocol.org) client
and server built on top of it (`@indexnetwork/negotiator/a2a`) so that core
can actually send and receive negotiation turns over the wire. A personal
agent — whether it's built with this package, or is an OpenClaw, Hermes, or
Claude Agent implementation that just speaks A2A — can use the `./a2a`
entry point to initiate or respond to a negotiation task with any other A2A
agent, without needing to reimplement the protocol itself.

## How to use this package

There are two layers, and most projects only need to reach for one:

- **Just need to draft a message or pick an action?** Use `Negotiator` directly
  (`respond()` for a plain message, `decide()` for a structured action) — see
  [Usage](#usage). This is the right level if you already have your own way
  of sending/receiving negotiation turns (your own transport, or another A2A
  implementation) and only need the "what do I say next" part.
- **Need to actually talk to another agent over the network?** Use
  `@indexnetwork/negotiator/a2a` — see [A2A](#a2a-sending-and-receiving-negotiations-over-the-wire).
  It wraps a `Negotiator` with a real A2A client and server, so you can
  `initiate()`/`continue()` a negotiation with another agent's endpoint, or
  mount `createA2AHandler()` in your own server to receive one.

Either way, install the package first:

## Requirements

- **Runtime**: Node ≥ 20, or Bun — anything with global `fetch` and
  `crypto.randomUUID()`. The package ships as ESM only (`"type": "module"`),
  no CommonJS build.
- **TypeScript ≥ 5** if you're consuming it from a TS project (listed as a
  peer dependency; not required at runtime — `dist/` ships plain JS + `.d.ts`).
- **An [OpenRouter](https://openrouter.ai) API key** — required by `Negotiator`
  (and therefore by `@indexnetwork/negotiator/a2a`, which wraps it). See
  [Configuration](#configuration).
- **A network-reachable HTTP endpoint** if you're using `@indexnetwork/negotiator/a2a`'s
  server side (`createA2AHandler()`) to actually receive negotiations from
  other agents — the library gives you the handler, you still need to host it.

## Installation

```bash
bun add @indexnetwork/negotiator
```

or with npm/yarn/pnpm:

```bash
npm install @indexnetwork/negotiator
```

## Configuration

`Negotiator` needs an OpenRouter API key, either passed explicitly or read
from the `OPENROUTER_API_KEY` environment variable:

```bash
export OPENROUTER_API_KEY=sk-or-...
```

| Option    | Type     | Required | Description                                                                 |
| --------- | -------- | -------- | ---------------------------------------------------------------------------- |
| `apiKey`  | `string` | No       | OpenRouter API key. Falls back to `OPENROUTER_API_KEY` if omitted.            |
| `model`   | `string` | No       | OpenRouter model id. Defaults to `openai/gpt-4o-mini`.                        |
| `referer` | `string` | No       | Sent as `HTTP-Referer`, per [OpenRouter's app attribution](https://openrouter.ai/docs). |
| `title`   | `string` | No       | Sent as `X-Title`, per OpenRouter's app attribution.                         |

```ts
const negotiator = new Negotiator({
  apiKey: "sk-or-...",
  model: "openai/gpt-4o",
  referer: "https://example.com",
  title: "My App",
});
```

Constructing a `Negotiator` throws immediately if no API key is available
from either source.

## Usage

```ts
import { Negotiator } from "@indexnetwork/negotiator";

const negotiator = new Negotiator({ model: "openai/gpt-4o-mini" });

const reply = await negotiator.respond({
  party: { name: "Seller", objective: "Sell the item for as much as possible" },
  history: [
    { role: "incoming", content: "I'll offer $300." },
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
record, such as `accept`/`reject`/`counter` — use `decide()` instead. It
takes the same `NegotiationState`, plus the set of actions allowed for this
turn, and returns one of them along with the message:

```ts
const decision = await negotiator.decide(
  {
    party: { name: "Seller", objective: "Sell the item for as much as possible" },
    history: [{ role: "incoming", content: "I'll offer $300." }],
  },
  {
    allowedActions: [
      "counter",
      "accept",
      { action: "reject", description: "Refuse the offer outright" },
    ],
  },
);

console.log(decision); // { action: "counter", message: "..." }
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

`@indexnetwork/negotiator/a2a` implements a minimal subset of the
[Agent2Agent protocol](https://a2a-protocol.org): agent discovery via an
AgentCard, and negotiation turns as JSON-RPC `message/send` calls carrying
this package's `NegotiationDecision` as a data part. Streaming (SSE) and
push-notification webhooks aren't implemented yet — every turn is a
synchronous HTTP request/response.

### Server: responding to negotiations

`createA2AHandler()` builds a framework-agnostic `(Request) => Promise<Response>`
you can mount in any HTTP server. It serves this agent's AgentCard at
`/.well-known/agent-card.json`, and on `message/send` runs `negotiator.decide()`
and replies with the updated Task:

```ts
import { Negotiator } from "@indexnetwork/negotiator";
import { createA2AHandler } from "@indexnetwork/negotiator/a2a";

const handler = createA2AHandler({
  negotiator: new Negotiator({ model: "openai/gpt-4o-mini" }),
  party: { name: "Seller", objective: "Sell the item for as much as possible" },
  allowedActions: ["propose", "counter", "accept", "reject"],
  agentCard: {
    name: "Seller Agent",
    url: "https://seller.example.com/a2a",
    version: "1.0.0",
    capabilities: {},
    skills: [{ id: "negotiate", name: "Negotiate a sale" }],
  },
});

Bun.serve({ port: 3000, fetch: handler });
```

A negotiation ends (`task.status.state` becomes `completed`/`rejected`/`canceled`)
once `decide()` picks a terminal action — `accept`, `reject`, or `withdraw` by
default. Pass `isTerminal(action)` to `createA2AHandler()` to override which
actions end the negotiation.

### Client: initiating and continuing negotiations

`A2ANegotiationClient` is the other side: it calls `negotiator.decide()` for
this side's move, then sends it to another agent's A2A endpoint. `initiate()`
starts a new negotiation; `continue()` keeps responding to one that's still
`input-required`:

```ts
import { Negotiator } from "@indexnetwork/negotiator";
import { A2ANegotiationClient } from "@indexnetwork/negotiator/a2a";

const client = new A2ANegotiationClient({
  negotiator: new Negotiator({ model: "openai/gpt-4o-mini" }),
  party: { name: "Buyer", objective: "Buy the item for as little as possible" },
  allowedActions: ["propose", "counter", "accept", "reject"],
});

let { task, decision } = await client.initiate("https://seller.example.com/a2a");
console.log(decision); // { action: "propose", message: "..." }

while (task.status.state === "input-required") {
  ({ task, decision } = await client.continue("https://seller.example.com/a2a", task));
  console.log(decision);
}

console.log(task.status.state); // "completed" | "rejected" | "canceled"
```

The Task returned by the server is authoritative — `continue()` reads the
full turn history from it, so the client doesn't need to track state itself
beyond holding onto the last `task` it received.

See `dev/a2a-demo.ts` for a runnable example of the fully symmetric
shape — two agents, each running its own server *and* initiating its own
negotiation against the other's endpoint (`bun run dev/a2a-demo.ts`, needs
`OPENROUTER_API_KEY`; makes real, non-deterministic API calls, so it isn't
part of `bun test`).

### Local simulation (dev/test only)

`dev/simulate.ts` is a harness for local iteration inside this repo — it
runs both sides of a negotiation in-process with `runNegotiation`. It isn't
published (see `files` in `package.json`) and isn't how a real negotiation
works (both parties are usually separate processes); it's only reachable via
a relative import from within this repo, e.g. from a script or test:

```ts
import { Negotiator } from "../src/index.ts";
import { runNegotiation } from "./simulate.ts";

const seller = {
  party: { name: "Seller", objective: "Sell for as much as possible, ideally above $450" },
  negotiator: new Negotiator({ model: "openai/gpt-4o-mini" }),
};

const buyer = {
  party: { name: "Buyer", objective: "Buy for as little as possible, ideally under $400" },
  negotiator: new Negotiator({ model: "openai/gpt-4o-mini" }),
};

const transcript = await runNegotiation([seller, buyer], {
  maxTurns: 10,
  stopWhen: (entry) => /deal|agreed/i.test(entry.content),
});

for (const entry of transcript) {
  console.log(`[${entry.speaker === 0 ? seller.party.name : buyer.party.name}] ${entry.content}`);
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
  index.ts        # public entry point — re-exports core/ only
  core/            # the decision engine: Negotiator.respond()/decide()
  a2a/             # the A2A protocol layer, built on core/
    index.ts       # public entry point for @indexnetwork/negotiator/a2a
    wire/          # shared protocol types and NegotiationDecision <-> A2A message encoding
    server/        # createA2AHandler() + Task storage
    client/        # A2ANegotiationClient + the raw message/send transport call
dev/
  simulate.ts      # local two-sided harness (see "Local simulation" above), not published
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## License

[MIT](./LICENSE)
