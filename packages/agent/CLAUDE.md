# @indexnetwork/agent

A host-run personal agent: one identity, scopeable to an intent, that can
stop to ask the party it represents a question. The host owns everything —
instructions, operations, state. See README.md for the API.

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

- **The agent holds no state.** Everything lives with the host and travels:
  `messages`, `history`. Adding instance state breaks resuming in another
  process, which is the whole suspend design.
- **One clock.** `now` feeds the loop's system message, read as UTC. It's a
  function, not a `Date`, so a long-lived server doesn't freeze on the day
  it booted.
- **Retries live in `ModelClient` only.**
- **Index Network operations are host-injected as tools.** This package
  must not learn Index transport, auth, or vocabulary.
  `examples/01-ask-user.ts` injects a fixed `find_matches` as a stand-in
  for the match layer; that seam — a `Tool` in `tools` — is where the host
  plugs in, not into `Agent`.
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
