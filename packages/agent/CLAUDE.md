# @indexnetwork/agent

A host-run personal H2A agent for one principal and intent, with internal
A2A negotiation subagents. The host owns instructions, operations and durable
records. See README.md for the API.

## Working here

```bash
bun test                     # no network
bun run typecheck
```

`examples/` hit OpenRouter. Tests don't: they mock the OpenRouter endpoint
and replay scripted assistant messages.

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

- **Durable state belongs to the host.** `Agent` restores principal records
  and holds only ephemeral review and A2A scheduling state. Restoration must
  not replay model work. The internal `ModelLoop` uses `messages` / `history`
  for its working transcript, not canonical principal records.
- **`Agent` is H2A, with two commands.** `receiveInput()` accepts a message or
  complete answer batch and automatically wakes after an accepted write,
  without an extra manual-wake receipt. `wake(activation?)` explicitly reviews;
  no argument means a manual wake. Construction is synchronous; readonly
  `ready` restores records and ownership without calling a model. The host's
  required `AbortSignal` cancels work; readonly `closed` resolves after cleanup.
  A2A notifications arrive only through `AgentHost.subscribe()`, installed at
  construction with delivery gated on `ready`. `negotiating` is a readonly ID
  list, not a command. `ModelLoop` and `NegotiationSubagents` are internal, not
  public package exports.
- **One clock.** `now` feeds the loop's system message, read as UTC. It's a
  function, not a `Date`, so a long-lived server doesn't freeze on the day
  it booted.
- **Retries live in `ModelClient` only.**
- **Index transport and auth stay host-owned.** Public `Agent` receives host
  records, a negotiation client and optional discovery capabilities; domain
  tools stay inside H2A/A2A execution. `examples/01-ask-user.ts` demonstrates
  only the internal `ModelLoop`, injecting a fixed `find_matches` tool.
  `ToolContext.loop` names that machinery, not the public `Agent`.
- **`files` is `dist`.** `examples/` is never published.

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
