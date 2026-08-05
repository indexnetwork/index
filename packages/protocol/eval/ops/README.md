# Eval ops core

The provider-free core behind the **eval ops website** ([`apps/eval-ops`](../../../../apps/eval-ops)):
it indexes eval artifacts, launches harness runs as child processes, compares two
artifacts, and drives a guarded test-database fixture reset.

This directory is the whole server. The browser app is a thin client over the JSON + SSE
API in [`ops.server.ts`](./ops.server.ts); every decision that matters — what may run,
under which configuration, against which database — is made here, including **who is
allowed to ask**: every route but two requires a session belonging to a verified
`@index.network` Index account. That is defence in depth on top of the `Host` and
`Origin` guards, not a replacement for them — the site is loopback-only unless
`EVAL_OPS_PUBLIC_ORIGIN` names exactly one deployed origin, and even then it is nothing to
expose further (see [§ Who may use this server](#who-may-use-this-server) below).

Everything in this directory is provider-free and covered by `bun run eval:verify`
(`suite: ops`).

## Scope: four scorecard harnesses and one comparison harness

`OPS_HARNESSES` ([`ops.registry.ts`](./ops.registry.ts)) is `matching`, `profile`,
`premise`, `opportunity`, `discovery` — and nothing else.

The **four scorecard harnesses** emit the shared scorecard artifact envelope
(`index-eval/baseline` / `index-eval/run-report`), which is what artifact indexing,
baseline diffing and comparison all read.

**`discovery` is the fifth, and it is a different shape.** It scores no single
configuration against a baseline: it carries two (`sides`), has no baseline and never will,
runs in `services/api` rather than here, and resets two Neon branches on entry. It is
therefore launchable, and its site-launched runs are indexed from `.ops-runs` like any
other run — but it is never diffed or compared against a baseline, and the launch form
refuses the configuration surface that would make its two sides differ in anything but the
pair (see [the `discovery` sections below](#one-discovery-run-at-a-time)).

`hyde`, `clarification`, `discovery-retrieval`, `discovery-env-matrix`, `stance` and the
canary are **not** launchable, indexable or comparable here; they use different evidence
models and remain CLI-only. Adding one is a deliberate code change, not a configuration
change.

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
| [`ops.queue.ts`](./ops.queue.ts) | FIFO queue, concurrency 1 by default; the single `discovery` slot. |
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
matching:     40 cases, + --tier
profile:       8 cases
premise:      10 cases
opportunity:   8 cases
discovery:     5 cases, only --runs (max 10) and --case; runs in services/api
// common flags: --runs --case --rule --no-judge --alpha --attempt-timeout-ms --strict-evidence
```

The launch form, the workload estimate and `renderRun`'s argv rendering all read this one
table, so the UI cannot offer a flag the CLI does not accept, and the form's numeric
bounds are the same bounds `RunSpecSchema` enforces server-side. Workload is `cases ×
runs` for the scorecard harnesses, and for `discovery` it depends on the shape of the
run: a comparison evaluates every case under both configurations and doubles, while a
single configuration passes over the corpus once. `renderRun` and the launch form both
multiply by the same `sidesPerRun(spec)` ([`ops.sides.ts`](./ops.sides.ts)) — a function
of the spec, not a per-harness constant — so the number an operator confirms before
spending and the number recorded on the run cannot drift apart.

**`discovery` also carries two configurations.** Its spec has a `sides: { a, b }`
object of environment values, rendered as `--a KEY=VALUE` / `--b KEY=VALUE` with keys
sorted. It is *optional* for that harness — omitting it measures one configuration,
rendered as `--env KEY=VALUE` — and refused for every other (a scorecard harness scores
one configuration against a baseline, so a second has nothing to mean). Keys are
confined to `DISCOVERY_ENV_KEYS` ([`ops.allowlist.ts`](./ops.allowlist.ts)) — the 26
flags the discovery graph actually reads, generated from its own import closure and
pinned in `tests/argv.spec.ts` — and `abSideIssues` in [`ops.sides.ts`](./ops.sides.ts) mirrors the
engine's `buildAbPlan` rules: same key set on both sides, at least one differing value, no
empty values. The engine *ignores* argv it does not recognise and only reaches those rules
after loading its eval modules, so mirroring them here is what turns a late, paid failure
into a 400.

`ops.sides.ts` is a module of its own, and dependency-free like `ops.allowlist.ts`, because
the launch form imports these same rules and renders each refusal beside the control that
produced it. Leaving them in `ops.argv.ts` would have made that import pull zod and
`RunSpecSchema`'s module-level schema construction into the browser bundle (measured: +67 kB,
against +13 kB for the rules and their metadata). `ops.argv.ts` re-exports them, so the
server still reads them from where it validates.

Values are checked too, and this is stricter than the engine on purpose. `assertAbEnvConfig`
only refuses a blank value, and every read site in the discovery graph *falls back* rather
than failing on a value it does not recognise — `DISCOVERY_PROFILE_SOURCE=user-context`
(hyphen) warns once and runs `premise`. Both sides would then run the same configuration
while the artifact reported a `configDiff` that never existed at runtime, after two Neon
branch resets and a full corpus of live calls. So each value is checked against its flag's
real read site through `envFlagValueIssue` ([`ops.metadata.ts`](./ops.metadata.ts)) — the
same function that validates saved configs, ad-hoc launches and the browser app's guided
editor — plus a length cap, a refusal of line breaks (the engine's `AB_ENV_ASSIGNMENT`
pattern, pinned in `tests/argv.spec.ts`, would reject that argv) and an explicit refusal of
`__proto__`, which zod's record would otherwise drop in silence.

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
  the child through `EVAL_MODEL_OVERRIDES`. Validation happens at run time: a profile
  naming an unknown agent loads and lists fine, but throws when the harness child reads
  the override.
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

### Where a run is spawned, and with what environment

By default a run is spawned in `packages/protocol` with the record's own environment.
A run that needs more is enqueued with a one-step **plan** (`ExecutionStep`), which the
queue holds in memory and writes nowhere:

- **its own working directory**, from the registry's repository-relative `cwd` resolved
  against the repository root. `discovery` declares `services/api`, because its package
  script and CLI live there and `bun run eval:discovery` resolves nowhere else. The
  `--report` path is absolute (`store.reportPath`), so the working directory does not move
  the artifact; `store.artifactPathFor` — the eval-relative form — is what the record
  stores, after the fact.
- **credentials the run record must not carry.** `HARNESS_CREDENTIALS` in
  [`ops.server.ts`](./ops.server.ts) states, per harness, what must come from this server's
  own environment. The four scorecard harnesses have nothing pre-checked, and say so.
  `discovery` names four keys in two groups. `keys` is what its own gate
  (`assertAbConfirmation`, services/api/src/cli/discovery.gate.ts) refuses to run
  without: `NEON_API_KEY` and `DISCOVERY_TARGETS`. `runtimeKeys` is what no gate
  mentions and the child cannot finish without: `OPENROUTER_API_KEY` (every model and
  embedding the discovery graph runs on) and `REDIS_URL` (the HyDE cache the graph writes
  through, uncaught on the write path). The server adds `DISCOVERY_CONFIRM=1` and
  `TEST_DATABASE_SAFE=1`, which are attestations rather than secrets. Any of the four
  absent or blank is refused with **503** naming it — and the second group matters most
  for the same reason it is easiest to miss: it arrives only by inheritance from
  `--env-file=../../.env.test`, a gitignored file whose absence Bun does not report, and it
  is read *after* the parent has already reset both Neon branches. Without the pre-check,
  the destructive step happens and the run then fails. The same entry `unset`s
  `DATABASE_URL`, which is *removed*
  from what the child inherits: the parent A/B process composes no database, both children
  set their own from the attested manifest, and this server's own value — the eval fixture
  database — must not be what a child tree it is asserting `TEST_DATABASE_SAFE=1` over can
  reach. `eval:discovery` runs under `--env-file=../../.env.test`, and a parent
  environment beats `--env-file` in Bun, so without this the server's value silently won a
  question the script had already answered.
  `server.spec.ts` pins the table against `assertAbConfirmation`'s own source, so a fifth
  variable added to the gate fails here instead of resurfacing as a child that dies at it.

### One `discovery` run at a time

`EXCLUSIVE_HARNESSES` ([`ops.queue.ts`](./ops.queue.ts)) names the harnesses whose runs may
never overlap, and why. `discovery` resets and uses the same two designated Neon
evaluation branches on every run, so two at once would reset each other's databases
mid-run. A second launch is refused with **409** naming the run that holds the slot.

The slot outlives the process holding it. `queue.exclusiveConflict()` asks this process's
queue **and** the store: a `running` record whose pid is still alive holds the slot even
though the queue that started it is gone, which is the case a server restart under a
double-digit-minute run creates (the child keeps running; the queue does not). A record
whose process *is* gone holds nothing — the other restart, where the container took the
child with it, must not make the harness unlaunchable. That is the same liveness question
`reconcile()` asks, answered by the same probe (`isProcessAlive`).

The rule is enforced by the queue rather than only by the route: a run whose slot is taken
is left pending regardless of `EVAL_OPS_MAX_CONCURRENT_RUNS`, and is passed over rather
than allowed to block the scorecard runs behind it, which share nothing with it.

Most refusals precede the record: the first check runs before anything is written, so
nothing is left behind. The re-check immediately before the enqueue cannot — the record
exists by then, and a launch that loses that race is marked `interrupted`. So run history
**can** show an `interrupted` record for a run that never started; a double-clicked launch
button produces one.

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

A run this process never spawned has no live entry to signal — `cancel()` returns the
stored record and the route still answers accepted — so cancelling an orphan left by an
earlier server moves nothing. That is why the exclusive-slot refusal above ties the slot to
the holder's process exiting rather than to a button: an orphan releases it by exiting, and
the 409 says exactly that.

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
2. **Redirect-capable query parameters** → a fixed denylist is refused outright:
   `database`, `db`, `dbname`, `user`, `username`, `options`, `search_path`. (Other
   connection parameters — `sslmode`, `role`, `session_authorization` — are **not**
   refused.) The denied parameters are copied into the driver's startup packet and can
   send the session to a *different database, role or schema* than the one named in the
   URL path — so the guard's verdict would describe a different target than the one that
   actually gets truncated. They are refused rather than interpreted, because honouring
   them would mean re-implementing the driver's precedence rules inside a safety check.
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

Every route below requires a session except the three marked **public**; `GET /callback` is
handled ahead of the gate because it is the request that establishes one.

| Method | Route | Purpose |
| :----- | :---- | :------ |
| `GET` | `/api/auth/status` | **public.** `{ authenticated: false }` or `{ authenticated: true, email, name }`. |
| `POST` | `/api/auth/login` | **public.** Which sign-in this server runs: `{ kind: "bridge", url }` locally, or `{ kind: "token", apiUrl, webAppUrl }` when deployed. |
| `POST` | `/api/auth/session` | **public.** Deployed only. `{ token }` → resolved server-side, domain policy applied, session cookie set. 403 in the local posture. |
| `GET` | `/callback` | **public, pre-gate.** The bridge lands here: validates the state, resolves the identity, applies the domain policy, then redirects to the UI or renders a refusal page. 403 in the deployed posture, which mints no states. |
| `POST` | `/api/auth/logout` | Clears the session and expires the cookie. |
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
  argv, never a database URL. `RunSpecSchema` is `.strict()`, so a
  request carrying `env`, `argv` or any other unknown key **fails with 400** rather than
  being silently ignored.
- The one environment a client may name is `sides` (or a single configuration) on a
  `discovery` spec: values for the 26 `DISCOVERY_ENV_KEYS` flags, which are protocol
  feature flags and nothing else. Any other key **fails with 400** — as does any value
  the flag's own read site would not honour, or one longer than 200 characters, or one
  carrying a line break.
  - A **pair** reaches the child only as `--a`/`--b` argv. The two sides are argv by
    construction: one process cannot hold two values for one variable.
  - A **single configuration** reaches it as `--env` argv *and* in the child's injected
    environment, because that shape's configuration is `resolved.env` — the same object
    `renderRun` copies into the record's `env` and the executor spawns with
    (`ops.argv.ts:306`; `server.spec.ts` asserts the injected value). The 400s above are
    what makes that safe: the value was validated before it was injected.
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
  `scrubCredentials`, and the credentials a harness's own gate demands are read from this
  server's environment into the child's — never into a run record, a response or a log.
  A browser can neither send nor receive them.
- Artifact ids are decoded and rejected if they normalise outside `eval/`.

### Who may use this server

Four independent guards stand in front of every request, and they **compose** rather than
substitute for one another: the loopback bind, the `Host` check, the `Origin` allowlist,
and identity. Removing any one of them is not offset by the others.

**Identity.** Every route except `GET /api/auth/status`, `POST /api/auth/login` and
`POST /api/auth/session` (`PUBLIC_ROUTES` in `ops.server.ts`) requires a session — the
exemptions are the routes that *obtain* a session, which cannot require one — and a
session exists only for an
Index account whose email is **verified** and whose domain is exactly `index.network`.
The gate sits ahead of dispatch, so a route added later is gated by default and an unknown
path is refused with 401 rather than a 404 that would confirm what exists. The policy is
re-evaluated on **every** request, so narrowing it refuses live sessions too; 401 ("nobody
is signed in") and 403 ("signed in, not permitted") are deliberately distinguishable.

There is no cookie to forward in either posture — a Better Auth session cookie is
host-scoped — so there are two exchanges, chosen by `resolveSignInMode(env)`:
`EVAL_OPS_PUBLIC_ORIGIN` unset means **bridge**, set means **token**. That is the same
variable that extends the allowlists, and it is exactly the circumstance in which the
bridge cannot complete. Both exchanges end with *this server* resolving a credential
against the API; nothing is ever client-asserted.

**Bridge (local).** `POST /api/auth/login` mints a one-time state and returns
`<WEB_APP_URL>/cli-auth?callback=http://127.0.0.1:<port>/callback&version=2&state=…`, the
bridge mints a revocable API key against the operator's existing browser session, and
`GET /callback` consumes the state, exchanges the key for an identity, applies the domain
policy and **discards the key**.

**Token (deployed).** The bridge is unusable off loopback: `validateCliCallbackUrl` in
`apps/web/src/lib/cli-auth.ts` accepts only `http:` on `127.0.0.1`/`[::1]`, deliberately,
so that broad API credentials are never redirected to a caller-controlled origin — and
that rule is shared with the released CLI, so it is not changed. Instead the browser
fetches a Better Auth JWT from `${API_URL}/api/auth/token` with `credentials: "include"`
(cross-site works because the API's cookie is `SameSite=None; Secure`) and posts it to
`POST /api/auth/session`. `JwtIdentityResolver` presents it to `${API_URL}/api/auth/me` as
`Authorization: Bearer …`, where the API verifies the signature against its own JWKS. The
`/api/auth/me` hop is **required, not an optimisation**: the `jwt` plugin's `definePayload`
returns `{ id, email, name }` and no `emailVerified`, and the policy demands verification,
so it can never be inferred from possession of a token.

In both cases the credential is exchanged once and dropped. It is never stored in a
session, never logged, never returned to the browser and never rendered.

`WEB_APP_URL` and `API_URL` are one pair: the first is where the operator's session lives,
the second is what verifies the credential minted from it. A credential minted by one
deployment is meaningless to another, so the server **refuses to start** on a
half-configured or mismatched pair rather than failing every sign-in later with an
unhelpful "No Index account could be resolved".

**What keeps this site local is the guards, not the authentication.** Both entrypoints bind
`127.0.0.1` unless `EVAL_OPS_BIND` is set, and setting it alone changes nothing reachable:
the `Host` and `Origin` allowlists still fail closed, so a browser on another host has
every write refused and every read refused with it.

Those allowlists are extended — by exactly one entry — only when `EVAL_OPS_PUBLIC_ORIGIN`
names the deployed origin, e.g. `https://eval.index.network`. Unset means loopback only,
which is the local posture and the default. The value is validated at startup as one
absolute `https:` origin with no path, query, fragment or credentials, and the server
**refuses to start** on anything else rather than falling back to something permissive.
There is no wildcard and no flag that switches a guard off: a subdomain of the configured
origin, the same name over `http:`, and every other host are all still refused. Exposing
the site therefore takes three deliberate acts (bind, public origin, a route to the port),
and leaves the `@index.network` identity gate as the only thing in front of a tool that
spends tokens and can flush a database.

**The session cookie is visible to every port on `127.0.0.1`.** Cookies are not
port-scoped, so any *other* local HTTP service the operator's browser visits on loopback
receives `eval_ops_session` too. `HttpOnly` keeps it out of JavaScript's reach and the
`Host` guard means a foreign host cannot replay it against this server, so the practical
exposure is low — but it is a real property of running several services on loopback, and
it is one more reason the ops session is worth no more than the local trust boundary it
sits inside.

## Running it

```bash
cd packages/protocol && bun run eval:web    # API on 127.0.0.1:4321
bun run dev:eval-ops                        # UI on 127.0.0.1:5174 (from the repo root)
```

`eval:web` runs with `--env-file=../../.env.test`, so the fixture target is the test
database. `EVAL_OPS_PORT` changes the port. That file also sets `PORT=3001` for the API
service, which is why `ops.serve.ts` ignores `PORT` — honouring it would move the ops API
onto the API's port. The deployed single-process entrypoint
(`apps/eval-ops/server.ts`) is the one a platform starts, and it *does* honour the `PORT`
that platform injects; both resolve it through `resolveBindPort`, which is also what the
sign-in bridge's callback URL is built from. See
[`apps/eval-ops/README.md`](../../../../apps/eval-ops/README.md) for the browser app.

## Tests

```bash
cd packages/protocol && bun run eval:verify   # includes `suite: ops` (typecheck + tests)
cd packages/protocol && bun test eval/ops/tests
```

## Deploying this service

The ops server has its own Railway config at `apps/eval-ops/railway.toml`, and the
service must be pointed at that path.

This is not optional tidiness. A Railway service with no config of its own inherits
the repository-root `railway.toml`, which is the **API's** configuration — including:

```toml
preDeployCommand = "cd services/api && bun run db:migrate"
healthcheckPath  = "/health"
```

Inheriting that made the eval ops service run `drizzle-kit migrate` on every deploy.
It failed only because the service had no `DATABASE_URL`; had one been configured it
would have migrated that database from this service. The dev environment's
`DATABASE_URL` names `protocol_prod`.

The config also deliberately sets **no** `healthcheckPath`. Every route here sits
behind the `Host` allowlist, so a probe arriving with an internal hostname is refused
with 403 and would fail an otherwise healthy container.
