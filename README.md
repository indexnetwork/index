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

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
