# @indexnetwork/negotiator

An LLM-enhanced negotiator library, powered by [OpenRouter](https://openrouter.ai).

`Negotiator` plays one side of a negotiation: given a party's objective and
the conversation so far, it returns that party's next message. It doesn't
run or own the other side of the conversation — the caller owns the
transcript and calls `respond()` once per turn.

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
bun run build    # bundle src/index.ts + emit .d.ts into dist/
```

`dist/` is what gets published (see `files`/`exports` in `package.json`); it's
git-ignored and rebuilt via `prepublishOnly`, not committed.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## License

[MIT](./LICENSE)
