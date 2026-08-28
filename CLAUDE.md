# @indexnetwork/agent

A host-run personal agent: one identity, scopeable to an intent, that can
stop to ask the party it represents a question and negotiate with other
agents over A2A. The host owns everything — instructions, operations,
state. See README.md for the API.

## Working here

```bash
cd ../negotiator && bun run build   # required: `file:../negotiator` resolves to its dist/
bun test                            # 81 tests, no network
bun run typecheck
bun run console                     # drive several agents in one terminal
bun run dev/stress.ts               # live scenarios — real model calls, real money
```

`examples/` and `dev/stress.ts` hit OpenRouter. Tests don't: they script
`negotiator.decide` and serve counterparties on ephemeral ports.

## Testing

Before trusting a test, break the code and check the test notices. Every
defect found in this package's history was invisible to a passing suite —
an assertion reading a copy of the data the fix doesn't touch, a fixture
sitting where both the right and wrong implementation agree, a loop that
stopped at its first failure so later cases were never evaluated. Green
told us nothing in all three; removing the fix did. It costs a minute, and
the minute falls exactly when you are most confident you are finished.

Related: prefer one assertion over a collected array to several inside a
loop. It cannot short-circuit, and the failure shows every case at once.

## Invariants worth not breaking

These were each a bug at some point, and the code reads oddly without them.

- **The Task is the record.** A2A puts the task on the server side, so
  whether a negotiation ended is read from `task.status.state`, never
  asserted from this side's own action. `endedBy` is what each side *did*;
  `settlement` is whether anything was agreed. Two agents once walked away
  from one negotiation believing different things because this was
  reversed.
- **A settled negotiation stays settled.** Taking another turn in an ended
  exchange doesn't reopen the question, it erases the answer — the task
  falls out of its terminal state and the agreement vanishes from the
  record. If terms must change, that's a new negotiation.
- **The agent holds no state.** Everything lives with the host and travels:
  `messages`, `negotiations`, `sessions`, `taskStore`. Adding instance
  state breaks resuming in another process, which is the whole suspend
  design.
- **Reading negotiations is uniform; acting on them is not.** An inbound
  negotiation has no URL — the counterparty called us — so it can be known
  but not continued.
- **One clock.** `now` feeds both the loop's system message and the
  negotiator's, read as UTC, so an agent can't tell its party one date and
  its counterparty another. It's a function, not a `Date`, so a long-lived
  server doesn't freeze on the day it booted.
- **Retries live in `ModelClient` only.** The negotiator deliberately has
  none; two layers would multiply, and neither backoff would see the other.
- **Index Network operations are host-injected as tools.** This package
  must not learn Index transport, auth, or vocabulary. `cli/directory.ts`
  is a local stand-in for the match layer, not the real thing, and
  `cli/roster.ts` injects it as each party's `find_matches` and
  `create_intent` tools — which is where a future intent package would
  plug in, not into `Agent`.
- **`files` is `dist`.** `cli/`, `dev/` and `examples/` are never
  published; `@indexnetwork/negotiator` is externalized, not bundled.

## Bun


Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
