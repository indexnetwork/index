# Eval ops core

The provider-free core behind the **eval ops website** ([`apps/eval-ops`](../../../../apps/eval-ops)):
it indexes eval artifacts, launches harness runs as child processes, compares two
artifacts, and drives a guarded test-database fixture reset.

This directory is the whole server. The browser app is a thin client over the JSON + SSE
API in [`ops.server.ts`](./ops.server.ts); every decision that matters — what may run,
under which configuration, against which database — is made here.

Everything in this directory is provider-free and covered by `bun run eval:verify`
(`suite: ops`).

## Scope: only the four scorecard harnesses

`OPS_HARNESSES` is `matching`, `profile`, `premise`, `opportunity` — and nothing else.

These are the four harnesses that emit the shared scorecard artifact envelope
(`index-eval/baseline` / `index-eval/run-report`), which is what artifact indexing,
baseline diffing and comparison all read. `hyde`, `clarification`,
`discovery-retrieval`, `discovery-env-matrix`, `stance` and the canary are **not**
launchable, indexable or comparable here; they use different evidence models and remain
CLI-only. Adding one is a deliberate code change, not a configuration change.

## Modules

| File | Role |
| :--- | :--- |
| [`ops.types.ts`](./ops.types.ts) | Every shared type: `OpsHarness`, `RunSpec`, `RunFlags`, `RunRecord`, `RunStatus`, `ArtifactRef`, `IndexResult`. |
| [`ops.registry.ts`](./ops.registry.ts) | `HARNESS_REGISTRY` — the single source of launchable capability. |
| [`ops.argv.ts`](./ops.argv.ts) | `RunSpecSchema` (the trust boundary) and `renderRun` (spec → argv + child env). |
| [`ops.profiles.ts`](./ops.profiles.ts) | Loads/validates [`profiles/`](./profiles), resolves a profile into injected env + fingerprint. |
| [`ops.artifacts.ts`](./ops.artifacts.ts) | `ArtifactSource` — filesystem index of baselines and run reports, addressable by id. |
| [`ops.compare.ts`](./ops.compare.ts) | `compareArtifacts` — refuses incomparable artifacts, no new statistics. |
| [`ops.store.ts`](./ops.store.ts) | `RunStore` — run records, logs, report paths, exit-code mapping, restart reconciliation. |
| [`ops.executor.ts`](./ops.executor.ts) | `RunExecutor` — the one `Bun.spawn` path, log streaming, cancel. |
| [`ops.queue.ts`](./ops.queue.ts) | FIFO queue, concurrency 1 by default. |
| [`ops.fixture.ts`](./ops.fixture.ts) | The fixture guard, credential redaction, read-only inspector, reset pipeline. |
| [`ops.server.ts`](./ops.server.ts) | The HTTP + SSE API and the default wiring. |
| [`ops.serve.ts`](./ops.serve.ts) | Standalone entrypoint (`bun run eval:web`). |

### The three seams

`ArtifactSource`, `RunStore` and `RunExecutor` are interfaces with exactly one MVP
implementation each — `FsArtifactSource`, `FsRunStore`, `LocalProcessRunExecutor` — all
filesystem/process based, no database, no daemon. `FixtureInspector` is a fourth,
injectable seam (`BunSqlFixtureInspector` by default) so the read-only database counts can
be replaced in tests without a live database. The interfaces exist so a future
persistent/remote implementation is a swap rather than a rewrite; nothing here anticipates
one.

## `HARNESS_REGISTRY`: the single source of launchable capability

```ts
matching:    40 cases, + --tier
profile:      8 cases
premise:     10 cases
opportunity:  8 cases
// common flags: --runs --case --rule --no-judge --alpha --attempt-timeout-ms --strict-evidence
```

The launch form, the workload estimate (`cases × runs`) and `renderRun`'s argv rendering
all read this one table, so the UI cannot offer a flag the CLI does not accept, and the
form's numeric bounds are the same bounds `RunSpecSchema` enforces server-side.

**Destructive flags are structurally unreachable.** `--update-baseline`, `--force` and
`--reason` are absent from the registry *and* from `RunFlags`/`RunSpecSchema`. There is no
flag to toggle and no allowlist to keep in sync: a `RunSpec` that could produce them does
not typecheck, does not parse, and has nothing to render from. Updating a committed
baseline stays a deliberate CLI act with a human-written reason. Selection-flag *values*
are additionally refused if they begin with `-`, so a value can never arrive at the
harness's parser looking like a flag.

`renderRun` builds an argv **array** passed straight to `Bun.spawn`. There is no shell
anywhere in this package, so nothing in a `RunSpec` can be interpreted as a command.

## Configuration profiles

A profile is a committed JSON file in [`profiles/`](./profiles) naming per-agent model
overrides and a small set of protocol feature flags:

```json
{
  "name": "claude-evaluator",
  "description": "Matching under a Claude evaluator instead of Gemini Flash",
  "models": { "opportunityEvaluator": "anthropic/claude-sonnet-4" },
  "env": {}
}
```

- The client sends a profile **name**. It can never send overrides, argv or environment.
- `models` keys are `ModelAgent` keys from `src/shared/agent/model.config.ts`, applied to
  the child through `EVAL_MODEL_OVERRIDES`.
- `env` keys must appear in `PROFILE_ENV_ALLOWLIST` ([`ops.profiles.ts`](./ops.profiles.ts)) —
  protocol feature flags only. Credentials, connection strings and `NODE_ENV` are
  deliberately absent, so a profile can never repoint a run at another database or
  provider account. Adding a key is a reviewed code change.
- The file name must match `name`, and `default` must declare no override at all.
- Each profile has a stable `fingerprint` (SHA-256 over models + env), recorded on every
  run record.

### `EVAL_MODEL_OVERRIDES`

A JSON object of agent → model id, read live by `getModelConfig` in
`src/shared/agent/model.config.ts`. Two guards sit on it:

1. **The protocol ignores it entirely when `NODE_ENV === "production"`** — a deployed
   process can never be repointed at another model by an environment variable.
2. **The API refuses to boot when it is set in a deployed environment.**
   `services/api/src/startup.env.ts` throws if `EVAL_MODEL_OVERRIDES` is present and
   `isDeployment` is true. Note that `isDeployment` is *broader* than
   `NODE_ENV=production`: it is also true when `RAILWAY_ENVIRONMENT` or
   `RAILWAY_ENVIRONMENT_NAME` is set. That breadth is deliberate — `railway.toml` runs the
   `start` script, which does not set `NODE_ENV`, so guard (1) would go inert exactly where
   it matters most. A value present in a deployed environment means someone believes it is
   doing something, so it fails loudly rather than being silently ignored.

A malformed value, an unknown agent key, or a non-string model id **throws**. A typo must
not silently produce a run that actually measured the default model.

### Fallback pinning

When a resolved profile declares any model override, `renderRun` pins
`OPENROUTER_FALLBACK_MODEL=none` in the child environment (unless the profile set that
variable itself). Without the pin, `createFallbackModel` can swap an agent onto
`DEFAULT_FALLBACK_MODEL` on a provider error mid-run, and the artifact would record
results produced by a *different model than the one under test* — silently corrupting the
exact comparison the experimental run exists to make.

## The experimental rule (`--no-save`)

**Any profile other than `default` makes the run experimental.** An experimental run is:

- forced to `--no-save`, appended by `renderRun` and visible in the recorded argv;
- banner-marked in the UI on both the launch form and the run page;
- **never diffed against the committed baseline** — the run page offers no comparison.

The reason is not tidiness. Harnesses write their run reports into `eval/<harness>/runs/`,
and `--rolling-baseline` computes a baseline from the recent compatible reports found
there. A full-corpus run under an alternative model would be *compatible* by every
structural check, so it would silently become rolling-baseline fuel — for everyone using
that harness, including CLI users who never touched the ops site and have no idea an
experiment happened. `--no-save` keeps the experiment out of `runs/` entirely. The run's
own report is still written, under `eval/.ops-runs/<id>/`, which is gitignored and is not a
rolling-baseline input.

Runs under `default` are ordinary runs: they save normally and are compared to the
committed baseline like any CLI invocation.

## Run lifecycle

`RunStore` mints an id and writes `meta.json`, `stdout.log` and `report.json` under
`eval/.ops-runs/<id>/` (gitignored), and
the executor spawns one child with combined stdout/stderr streamed to that log. Concurrency
defaults to 1 (`EVAL_OPS_MAX_CONCURRENT_RUNS` raises it): evals cost real tokens and share
provider rate limits, so concurrent runs make both logs and spend unattributable.

### Exit code → status

`statusFromExitCode` maps the documented harness exit-code contract:

| Exit code | Status |
| :-------- | :----- |
| `0` | `passed` |
| `1` | `regression` |
| `2` | `execution-error` |
| `3` | `insufficient-evidence` |
| anything else | `crashed` |

Three further statuses come from outside the child: `queued` before it starts, `cancelled`
when an operator sends SIGINT, and `interrupted` when `reconcile()` finds a `running`
record whose process is gone (the server died with runs in flight). `reconcile()` runs on
every server start and probes liveness, so a record never claims to be running forever —
and a genuinely live process is left alone.

`cancel()` awaits the child's exit, so the HTTP layer treats cancellation as
**202-accepted** rather than awaiting it: a harness that ignores SIGINT would otherwise
hang the request for as long as it likes. The outcome arrives over the run's own status
stream.

## Comparison

`compareArtifacts` runs no new statistics. It reuses `diffBaseline` from
[`eval/shared/`](../shared) — the same beta-binomial posterior-predictive test the CLI
uses — and adds only a refusal.

**Incomparable artifacts are refused, with the reason stated.** Any difference in
`harness`, `corpusFingerprint`, `configFingerprint` or `selection` (full-corpus flag +
filters) returns `{ comparable: false, findings }`, where each finding names the dimension
and both values. Two artifacts scored over different corpora or different judge
configurations are not a comparison, and the site says so rather than rendering a delta.

**Significance is one-sided, evaluated in both directions.** `diffBaseline` asks "is the
subject significantly worse than the reference?". Running it once gives `regressions`;
running it with the arguments reversed gives `improvements`. That is *not* the same as a
symmetric two-sided test and must not be presented as one — each direction is its own
one-sided test at the same `alpha` (default `0.05`).

## Fixture control

The fixture page can flush and reseed the **test** database. Every write delegates to the
existing audited CLIs in `services/api`; this package contains no new database write code.

### The guard (`assessFixtureTarget`)

The target always comes from the server's own `.env.test`. It is never in a request.
Refusals, in order:

1. **`DATABASE_URL` missing or not a `postgres://`/`postgresql://` URL** → refused. Name
   parsing decodes percent-escapes exactly as the driver does, so `protocol_%70rod` is
   recognised as `protocol_prod`.
2. **Redirect-capable query parameters** → refused outright. `database`, `db`, `dbname`,
   `user`, `username`, `options`, `search_path`. These are copied into the driver's startup
   packet and can send the session to a *different database, role or schema* than the one
   named in the URL path — so the guard's verdict would describe a different target than
   the one that actually gets truncated. They are refused rather than interpreted, because
   honouring them would mean re-implementing the driver's precedence rules inside a safety
   check.
3. **`*_prod` / `*_production` names** (`/^(.*_)?(prod|production)$/i`) → refused. **There
   is deliberately no override flag.** The database *name*, not the branch, is what
   distinguishes real data here: every Neon branch in this project exposes a
   `protocol_prod` database holding a copy of real user data.

This mirrors `REAL_DATA_DATABASE_NAMES` in
`services/api/src/lib/drizzle/test-database-readiness.ts`, copied rather than imported
(that module pulls in `postgres` and `node:child_process` at import time, which this
provider-free package may not depend on). `tests/fixture.spec.ts` pins the copy — pattern
source *and* flags — to the original so the two cannot drift.

Every message that leaves this layer passes through `scrubCredentials`, and the displayed
URL through `redactDatabaseUrl`, which drops userinfo *and the entire query string*
(`?password=` is a documented libpq parameter) and fails closed on anything it cannot parse
as a postgres URL.

### The reset pipeline

`buildResetPipeline` composes existing CLIs, in order, each with its own confirmation:

```
bun run db:flush   -- --confirm --silent      (cwd services/api)
bun run db:migrate:test                       (cwd services/api)
bun run db:seed    -- --confirm --personas=N  (cwd services/api)
```

- **Migrations are always applied. Drift is never probed.** There is no
  `migrationDrift` field anywhere; the status route reports `appliesMigrationsOnReset: true`,
  which is a statement about behaviour, not a diagnosis.
- The migrate step runs `drizzle-kit migrate`, whose `drizzle.config.ts` loads the
  repository-root `.env.test` **with `override: true`** and therefore ignores the
  `DATABASE_URL` injected into the child. Flush and seed use the injected URL. The two are
  the same database only while the server's `DATABASE_URL` still equals the one `.env.test`
  names, so `resolveResetTarget` re-reads that file and **fails the reset closed** on any
  divergence rather than migrating a database the operator never confirmed.
- `ResetStep` carries no environment; the HTTP layer — the one that validated the target —
  injects `DATABASE_URL`, `NODE_ENV=test` and `TEST_DATABASE_SAFE=1`. Without the safety
  marker the migrate step refuses to run at all.
- `buildResetPipeline` takes no target and can enforce nothing. It is only ever reached
  after `resolveResetTarget` has returned an allowed target.
- Persona count is bounded to `0..MAX_PERSONAS` (50).
- A cancel landing between steps stops the pipeline instead of flushing a database and then
  abandoning the seed that would have refilled it.

### Confirmation and serialisation

A reset requires a **two-step typed-name confirmation**: the operator arms the control, then
types the exact target database name, which the server re-checks
(`confirmDatabaseName !== target.databaseName` → 400). The reset record stores only the
database **name** — a connection string never enters a run record.

Resets and runs are mutually exclusive. A reset is refused with 409 while any run is queued
or running (`queue.depth > 0`), and a launch is refused with 409 while a reset is in flight,
because a flush under a live run corrupts that run. The claim is taken with no intervening
`await`, so two callers can never both believe the server was idle.

**Caveat worth surfacing:** `GET /api/fixture` reports the *guard* verdict only. It does not
perform the `.env.test` cross-check that `resolveResetTarget` does, so an operator can see
`allowed: true` and still be refused at reset time. The fixture page states this.

## The HTTP API

`createOpsHandler(context)` returns a plain `(Request) => Promise<Response>`.

| Method | Route | Purpose |
| :----- | :---- | :------ |
| `GET` | `/api/harnesses` | `HARNESS_REGISTRY` values. |
| `GET` | `/api/profiles` | Committed profiles. |
| `GET` | `/api/artifacts` | `{ refs, issues }` — the artifact index, with unreadable files surfaced rather than dropped. |
| `GET` | `/api/artifacts/:id` | One validated artifact envelope (`id` = base64url of the path relative to `eval/`). |
| `GET` | `/api/compare?reference=&subject=` | `CompareOutcome`. |
| `GET` | `/api/runs` | `{ runs, issues }`. |
| `GET` | `/api/runs/:id/stream` | SSE: `status` + `log` events, replay-then-follow, heartbeat every 15s. |
| `POST` | `/api/runs` | Launch. 202 with the record. |
| `POST` | `/api/runs/:id/cancel` | 202-accepted SIGINT. |
| `GET` | `/api/fixture` | Guard verdict, redacted target, live counts. |
| `POST` | `/api/fixture/reset` | Guarded reset. 202 with the record. |

### The trust boundary

`ops.server.ts` is the trust boundary, and it is narrow by construction:

- **The only thing a client may send is a typed `RunSpec` plus a profile NAME.** Never
  argv, never environment, never a database URL. `RunSpecSchema` is `.strict()`, so a
  request carrying `env`, `argv` or any other unknown key **fails with 400** rather than
  being silently ignored.
- The `fixture-reset` variant of `RunSpec` is deliberately not parseable by
  `RunSpecSchema`. A reset is not constructible through `/api/runs`; it exists only behind
  the guarded fixture route.
- State-changing requests must carry `Content-Type: application/json` (else **415**).
  `no-cors` is limited to three content types, none of them JSON, so this is an independent
  barrier against a drive-by POST.
- State-changing requests are refused (**403**) unless the `Origin` is a loopback host at
  any port, or absent (curl, proxy hops that drop it), or `Sec-Fetch-Site` says
  `same-origin`/`none`. The opaque `Origin: null` a sandboxed frame or `file://` page sends
  is refused. This closes a real drive-by: any page the operator has open could otherwise
  `fetch("http://127.0.0.1:4321/api/runs", { method: "POST", mode: "no-cors" })` and spend
  real money or flush a database, even though the browser hides the reply. No CORS response
  header is added anywhere, so a reply still cannot be *read* cross-origin — this is about
  the write.
- Nothing that leaves here contains a credential. Every error path runs through
  `scrubCredentials`.
- Artifact ids are decoded and rejected if they normalise outside `eval/`.

### There is no authentication

Any process on this machine can drive this server: launch runs that spend real money and
flush the test database. That is an explicit operator-trust decision about **local**
processes.

`ops.serve.ts` binds `127.0.0.1` unless `EVAL_OPS_BIND` is set. **`EVAL_OPS_BIND` is the
hook where authentication must land before any non-local deployment — it must not be
changed until that exists.** Note that setting it alone is no longer sufficient anyway:
the loopback `Origin` allowlist fails closed, so a browser on another host would have every
write refused.

## Running it

```bash
cd packages/protocol && bun run eval:web    # API on 127.0.0.1:4321
bun run dev:eval-ops                        # UI on 127.0.0.1:5174 (from the repo root)
```

`eval:web` runs with `--env-file=../../.env.test`, so the fixture target is the test
database. `EVAL_OPS_PORT` changes the port. See
[`apps/eval-ops/README.md`](../../../../apps/eval-ops/README.md) for the browser app.

## Tests

```bash
cd packages/protocol && bun run eval:verify   # includes `suite: ops` (typecheck + tests)
cd packages/protocol && bun test eval/ops/tests
```
