# nogotiator

An LLM-enhanced negotiator library, powered by [OpenRouter](https://openrouter.ai).

## Install

```bash
bun install
```

Set your OpenRouter API key (see `.env.example`):

```bash
cp .env.example .env
# then fill in OPENROUTER_API_KEY
```

## Usage

```ts
import { Negotiator } from "./index.ts";

const negotiator = new Negotiator({ model: "openai/gpt-4o-mini" });

const reply = await negotiator.respond({
  party: { name: "Seller", objective: "Sell the item for as much as possible" },
  history: [
    { role: "incoming", content: "I'll offer $300." },
  ],
});

console.log(reply);
```

`Negotiator` represents **one side** of a negotiation. The other party is a
separate personal agent this package doesn't run or own — the caller (e.g.
Index Network) owns the shared conversation and calls `respond()` once per
turn to get this side's next message.

### Local simulation (dev/test only)

For local iteration you can run both sides in-process with `runNegotiation`,
imported from the `./simulate` subpath. This isn't how a real negotiation
works (both parties are usually separate agents), it's just a harness:

```ts
import { Negotiator } from "@indexnetwork/negotiator";
import { runNegotiation } from "@indexnetwork/negotiator/simulate";

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

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
