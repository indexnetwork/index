# Eval ops website

An internal, **local-only** console for the protocol's eval harnesses: browse committed
baselines and run reports, launch a run and watch its log stream live, compare two
artifacts, and reset the test-database fixture.

It is a thin client. Every decision that matters — what may run, under which
configuration, against which database — is made server-side in
[`packages/protocol/eval/ops/`](../../packages/protocol/eval/ops/README.md). Read that
README for the security model; this one covers running the app.

## Running it

Two processes:

```bash
# terminal 1 — the ops API (127.0.0.1:4321)
cd packages/protocol && bun run eval:web

# terminal 2 — the Vite dev server (http://127.0.0.1:5174)
bun run dev:eval-ops
```

Open <http://127.0.0.1:5174>. Vite proxies `/api` to `127.0.0.1:4321` with
`changeOrigin: false`, so the browser's own loopback `Origin` header reaches the API
unchanged — which the API requires (see below).

`eval:web` loads `../../.env.test`, so `OPENROUTER_API_KEY` comes from the repo-root
`.env.test` and the fixture target is the test database. There is no combined launcher: two
terminals is the whole story.

First load shows a sign-in screen: the site requires a verified `@index.network` Index
account (see [Authentication](#authentication) below). In this two-process setup the API
answers the sign-in callback on `:4321` but serves no UI, so a completed sign-in redirects
to `EVAL_OPS_UI_URL`, which defaults to `http://127.0.0.1:5174` — the Vite dev server above.

For a built single-process variant, `bun run build:eval-ops` (typecheck + `vite build`) and
`bun run start:eval-ops` serve the SPA and the API from one Bun server on the same port.
That entrypoint has exactly the same loopback binding and the same identity gate; because
both are on one origin, sign-in redirects to `/` there. `site.ts` owns which requests go to
the API: everything under `/api` **and** `/callback`, which is not under `/api` and cannot
be — the bridge's own validator accepts that pathname and no other. Serving `/callback`
from the SPA instead would leave a freshly minted API key sitting in the browser's URL bar
and history for a sign-in that could never complete.

Unlike `eval:web`, `start:eval-ops` does **not** load `.env.test`, so `WEB_APP_URL` and
`API_URL` come from the ambient environment or from their local defaults
(`http://localhost:3000` and `http://localhost:3001`).

## Pages

| Route | What it does |
| :---- | :----------- |
| `/` | Overview: harness health (baseline pass rates), recent runs, fixture status, artifact index issues. |
| `/h/:harness` | One harness: its artifacts (baselines and run reports), and any index issues under it. |
| `/launch` | Launch form, built from `HARNESS_REGISTRY`, with a workload (`cases × runs`) confirmation. |
| `/r/:runId` | One run: status, exact argv, live log, cancel, and a baseline diff when applicable. |
| `/profiles` | The committed configuration profiles and what each one overrides. |
| `/compare` | Pick two artifacts; refusal with stated reasons when they are not comparable. |
| `/fixture` | Test-database target, live counts, and the guarded reset. |

The UI is mouse-first: every route is a real link with a real `href`, not a keyboard
shortcut. The theme is a dark terminal palette where colour is bound to eval meaning, not
decoration — green `passed` (exit 0), red `regression` (1), magenta `execution-error` (2),
yellow `insufficient-evidence` (3), dim `queued`/`cancelled`.

Run logs are rendered by a small ANSI parser (`src/lib/ansi.ts`) into spans. `LogView` is
stateless and re-parses the full accumulated log on every render, so the SSE consumer
accumulates chunks into one string rather than parsing per chunk — an escape sequence split
across a chunk boundary would otherwise be corrupted. The API replays the log from byte 0
on every SSE connect, so a refresh mid-run shows the whole log from the beginning, and the
consumer resets its accumulator on reconnect instead of rendering the log twice.

## Constraints you need to know

- **It binds loopback.** `127.0.0.1` unless `EVAL_OPS_BIND` is set (`EVAL_OPS_PORT` changes
  the port).
- **Every route needs an Index session** except the two that make signing in possible. See
  [Authentication](#authentication) below.
- **Do not change `EVAL_OPS_BIND`.** Authentication is defence in depth, not permission to
  expose this: the loopback bind, the `Host` check and the `Origin` allowlist are what keep
  the site local, and it has never been reviewed for exposure beyond loopback. Setting it
  alone would not work anyway — the API refuses requests addressed to a foreign `Host` and
  state-changing requests whose `Origin` is not loopback (fail-closed).
- **Client POSTs must send `Content-Type: application/json`** or the API answers 415.
  `src/api/client.ts` does this; anything else talking to the API must too.
- **`src/api/client.ts` types are hand-maintained mirrors** of the server's types. They are
  not generated, so they can drift; three had already diverged and were corrected during
  development. Check the server types when changing either side.

## Authentication

Only a verified `@index.network` Index account may use this site. The domain check runs
server-side; the browser is never trusted for identity. `packages/protocol/eval/ops/README.md`
is the security model of record — this section is what an operator needs to run it.

- **Signing in** posts `/api/auth/login` and navigates to the returned bridge URL
  (`<WEB_APP_URL>/cli-auth?…`), which mints a revocable API key against your existing
  browser session and redirects it to this server's `/callback`. The server exchanges the
  key for an identity, applies the domain policy and discards the key. It never reaches
  this app.
- **`WEB_APP_URL` and `API_URL` are one pair.** The first mints the key, the second
  verifies it, so a key minted by one deployment cannot be verified by another. The server
  refuses to start if only one is set, or if one is local and the other is not.
- **401 and 403 are different screens.** 401 offers sign-in; 403 (`permitted: false`) says
  the account is not permitted and deliberately offers no sign-in button, which would loop.
  The discriminator is the body's `permitted: false`, not the status code — the same server
  answers 403 for a cross-origin write and for a refused fixture target.
- **Sessions are in memory.** Restarting the ops server signs you out.
- **The session cookie is visible to every port on `127.0.0.1`.** Cookies are not
  port-scoped, so another local HTTP service you visit in the same browser receives it.
  `HttpOnly` keeps it out of JavaScript and the `Host` guard stops it being replayed
  against this server from a foreign host, so exposure is low — but it is worth knowing.

## Not part of the production deployment

By design:

- excluded from the root `bun run build` (which builds skills, protocol, API, web —
  `build:eval-ops` exists but is not in that chain);
- absent from `railway.toml`'s `watchPatterns`, so it is never built or deployed there;
- gated in CI by its own **`eval-ops`** job in `.github/workflows/lint.yml` — typecheck,
  test, lint — deliberately not folded into the root `build` job.

That job exists because the app was otherwise entirely ungated: `vite build` alone strips
types without checking them, and eight type errors accumulated behind a passing test suite.

## Development

```bash
cd apps/eval-ops
bun run typecheck   # tsc --noEmit
bun run test        # vitest (happy-dom + Testing Library)
bun run lint        # eslint src/
```

`bun run build` runs typecheck before `vite build`, so a type error fails the build rather
than shipping.
