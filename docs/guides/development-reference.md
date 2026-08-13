# Development Reference

This is the canonical project reference for development commands, architecture, conventions, testing, Git workflow, and operational safety.

## Project Overview

Index Network is a private, intent-driven discovery protocol built on autonomous agents. Users define "intents" and competing Broker Agents work to fulfill them through relevant connections. The system leverages LangChain/LangGraph for agent orchestration, PostgreSQL with pgvector for semantic search, and a monorepo structure with user-facing apps (`apps/web`, `apps/mac`), deployable services (`services/api`), and shared packages.

## Development Commands

### API Service

```bash
cd services/api

# Development
bun run dev                                 # Start dev server with hot reload (Bun.serve, port 3001)
bun run start                               # Start production server

# Database (Drizzle ORM)
bun run db:generate                         # Generate migrations after schema changes
bun run db:migrate                          # Apply pending migrations
bun run db:studio                           # Open Drizzle Studio (interactive DB GUI)
bun run db:seed                             # Seed database with sample data
bun run db:flush                            # Flush all data from database

# Testing
bun test                                    # Run tests with bun test
bun test tests/e2e.spec.ts                  # Run specific test file
bun test --watch                            # Run tests in watch mode

# Code quality
bun run lint                                # Run ESLint
bun run typecheck                           # Type-check the API without emitting
bun run typecheck:cli-specs                 # Type-check the discovery CLI specs (see tsconfig.spec.json)

# Evals (gated, mutating, cost tokens — see ### Discovery Eval)
bun run eval:discovery -- --help            # Discovery: contract and exit codes, no credentials needed

# Maintenance/CLI tools
bun run maintenance:backfill-context-hyde   # Backfill: generate HyDE docs for user contexts
bun run maintenance:backfill-global-user-contexts # Backfill: generate the global user_context (networkId=null) for every user, synthesized from active premises
bun run maintenance:backfill-intent-questions # Backfill: enqueue intent-refinement question generation (most recent active intent per user)

# Background workers
bun run integration-worker                  # Start integration sync worker
bun run social-worker                       # Start social media sync worker
```

### Web App

```bash
cd apps/web
bun run dev                                 # Start Vite dev server (with API proxy to protocol)
bun run build                               # Build blog assets then run Vite production build
bun run start                               # Start Vite preview server
bun run lint                                # Run ESLint
```

### Mac App

```bash
cd apps/mac
./build.sh                                  # Assemble HTML and build the macOS WKWebView app
```

### CLI

```bash
cd packages/cli
bun src/main.ts conversation                # Run CLI directly with Bun (no build)
bun run build                               # Build native binaries for all platforms
bun test                                    # Run CLI tests
```

> **Subtree:** `packages/cli/` mirrors `indexnetwork/cli`. Edit via this monorepo; see `### Subtrees` for sync commands.

### @indexnetwork/protocol Package

```bash
cd packages/protocol

bun run build                               # Compile TypeScript to dist/
bun run dev                                 # Watch mode
npm publish --access public                 # Publish (requires NPM login + OTP, or use CI)

# Publishing via CI (preferred):
# push dev to publish an rc prerelease
git push <indexnetwork-remote> dev

# push main to publish the stable release if the version is new
git push <indexnetwork-remote> main
```

> **Subtree:** `packages/protocol/` mirrors `indexnetwork/protocol`. Edit via this monorepo; see `### Subtrees` for sync commands.

### Protocol Evals

The eval harnesses live in `packages/protocol/eval/`. Each suite is gated by the
`SUITES` manifest in `eval/verify.ts`; a new suite needs its own `tsconfig.json`
and `tests/` directory, and its tests must be provider-free because `eval:verify`
strips provider credentials from the child processes it spawns.

```bash
cd packages/protocol

bun run eval:verify                         # Typecheck + test every eval suite (provider-free)
bun run eval:matching -- --list-cases       # List a harness's corpus without calling a model
bun run eval:matching -- --runs 3           # Run a harness (costs tokens)
```

Harness exit codes: `0` pass, `1` regression, `2` execution error, `3`
insufficient evidence.

### Discovery Eval

Lives in `services/api` (not `packages/protocol`) because it drives the real
discovery graph against real Neon databases.

#### Historical shared-pool quality contract

Historical quality is an operator-only guarded runtime over the approved shared
pool. Its exact quality-mode syntax is:

```text
bun run eval:discovery -- --historical-quality --env KEY=VALUE [--case <approved-id>]... [--trigger intent|enrichment]... [--runs <n>] [--report <path>] [--force]
bun run eval:discovery -- --historical-quality --help
```

`--env` supplies exactly one configuration; this mode has no `--a`/`--b`
comparison semantics. `--case` and `--trigger` are repeatable. Omitting
`--case` selects all five approved cases, and omitting `--trigger` selects both
`intent` and `enrichment`. The default three repetitions therefore estimate
`5 cases × 2 triggers × 3 repetitions = 30` graph invocations and 30 evaluator
calls. Use `--runs 1` for the first pilot estimate of `5 × 2 × 1 = 10` graph
invocations and 10 evaluator calls. A request may not exceed 200 graph
invocations.

The execution contract is one attempt and one evaluator call per slot, with a
restore before every slot. Selected case or trigger subsets produce descriptive
evidence only: they do not produce a subset verdict, and quality artifacts do
not read, write, update, or compare against a baseline. Stage-funnel metrics are
descriptive, not a pass/fail comparison.

`--help` remains provider-free. A confirmed execution requires strict manifest
v2, a separately attested writable protected-base refresh target, the approved
read-only base replica, provider/Redis runtime configuration, and a parent-only
provider-account fingerprint. Before child preflight or any control-plane call,
the parent atomically acquires a fail-closed host-local filesystem lease keyed
by strict manifest-v2 project and side-`a` branch identity; crash-left leases are
never automatically removed, and operators must not launch from another host.
Before any reset, the parent jointly attests the roles and verifies published
base state in a fresh read-only process. It then runs slots serially: restore
existing side `a`, re-attest and verify, invoke one
trigger attempt, validate one identifier-only child result, and clean up. Side
`b` remains untouched. Failed terminal rows continue without retry and suppress
the whole quality verdict; restore/spawn/malformed/supervisor failures stop
scheduling. Nothing automatically reruns.

Quality remains absent from the Eval Ops launch registry. Eval Ops can render
historical-quality reports and execution completeness, while its existing
`discovery` launch continues to use only the v2 manifest's legacy child
projection. Protected-base provisioning, atomic secret migration, refresh,
read-only verify, guarded DB proof, smokes, and pilot are documented in the
[IND-638 operator runbook](./ind-638-historical-quality-pilot.md). The target
proof and full guarded DB suite are hard pre-merge gates; skipped or `not run`
evidence is not merge-ready.

```bash
cd services/api
bun run eval:discovery -- --help          # The whole contract, no credentials needed

# A default comparison (costs tokens and ~13 minutes). Every invocation but
# --help needs all four gate variables; see **The gate** below.
DISCOVERY_CONFIRM=1 TEST_DATABASE_SAFE=1 \
NEON_API_KEY=<key> DISCOVERY_TARGETS='<manifest>' \
  bun run eval:discovery -- \
    --a DISCOVERY_ALLOWED_TYPES=intent \
    --b DISCOVERY_ALLOWED_TYPES=intent,profile

# Measuring ONE configuration instead: --env, which resets one branch and emits
# an ordinary scorecard. --env and --a/--b are mutually exclusive. The same four
# gate variables are required.
bun run eval:discovery -- --env DISCOVERY_ALLOWED_TYPES=intent
```

**Two shapes.** `--a`/`--b` compares two operator-chosen environment
configurations over the same cases; `--env` measures a single one. Passing both
shapes is refused rather than resolved — they reset a different number of
branches and produce a different artifact (`discovery.main.ts`, `parseAbShape`).
Passing neither is refused too: a run needs a configuration.

**What a comparison compares.** Selection (`--case`, `--runs`) is shared;
configuration is not. Each side runs in its own child process —
`withDiscoveryEnvironment` mutates the real `process.env`, so two configurations
in one process would read each other's flags — and each child is composed
against its own Neon branch (`eval-ab-a`, `eval-ab-b`), which the parent resets
from the protected `eval-discovery-base` branch before it spawns anything. Every
reset the run needs must succeed first: a half-isolated comparison is not a
comparison. A single-configuration run uses side a alone, so it resets
`eval-ab-a` only. The command never creates or deletes Neon branches.

**The gate.** Every discovery process, parent included and in either shape,
refuses to start without all four of these, and refuses before it imports
anything that can compose a database:

| Variable | Why |
| --- | --- |
| `DISCOVERY_CONFIRM=1` | Explicit consent to a mutating, paid run. |
| `TEST_DATABASE_SAFE=1` | The disposable-database marker; the graph writes opportunities and negotiation tasks. |
| `NEON_API_KEY` | Required up front, because every process attests its targets against the control plane before it loads the graph. |
| `DISCOVERY_TARGETS` | The manifest below, attested against the Neon control plane on every invocation. |

```json
{
  "version": 2,
  "projectId": "<project-id>",
  "baseBranchId": "<base-branch-id>",
  "baseReadReplica": {
    "endpointId": "<read-only-endpoint-id>",
    "databaseUrl": "<secret-postgresql-protocol_eval-url>"
  },
  "targets": [
    { "sideId": "a", "branchId": "<side-a-branch-id>", "endpointId": "<side-a-read-write-endpoint-id>", "databaseUrl": "<secret-postgresql-protocol_eval-url>" },
    { "sideId": "b", "branchId": "<side-b-branch-id>", "endpointId": "<side-b-read-write-endpoint-id>", "databaseUrl": "<secret-postgresql-protocol_eval-url>" }
  ]
}
```

The manifest must name **exactly two** sides even for a single-configuration
run: both are attested up front, and the run then resets and uses only the
branches its shape needs (`abRunningTargets`). Legacy A/B continues accepting
its old unversioned shape, but manifest v2 is also accepted by projecting only
project/base and the two child targets. Historical quality accepts **only** v2.

Legacy attestation checks each child is exactly named, non-primary, parented on
`eval-discovery-base`, and host-bound. Historical quality additionally requires
one distinct `read_only` base replica and two distinct `read_write` children,
and jointly binds them to the separately declared `read_write` base refresh
endpoint. Every URL names exactly `/protocol_eval`. A failed attestation prints
one fixed message and never the control plane's own — control-plane responses
and database URLs carry credentials — so do not expect the specific mismatch to
be named.

**The 28 flags it can offer.** `DISCOVERY_ENV_KEYS` in
`services/api/src/cli/discovery.flags.ts`, **generated** from a scan of the
discovery graph's own transitive import closure rather than hand-maintained
(`packages/protocol/eval/ops/ops.envcatalog.build.ts`), and regenerated-and-diffed
by `eval/ops/tests/envcatalog.spec.ts` so the committed copy cannot drift:

```
CHAT_MODEL                           CHAT_REASONING_EFFORT
DISCOVERY_ALLOWED_TYPES              DISCOVERY_CONTEXT_TO_INTENT
DISCOVERY_EVALUATOR_MIN_SCORE        DISCOVERY_MIN_SIMILARITY
DISCOVERY_PROFILE_SOURCE             DISCOVERY_REJECTION_COOLDOWN_DAYS
DISCOVERY_SOURCE_PREMISE_LIMIT       EVAL_MODEL_OVERRIDES
HYDE_FRAME_CONSTRAINTS_ENABLED       NEGOTIATION_ASK_USER_ENABLED
NEGOTIATION_ASK_USER_WINDOW_MS       NEGOTIATION_CONSULTATION_POLICY_MODE
NEGOTIATION_DEADLOCK_SHIFT_ENABLED   NEGOTIATION_DEADLOCK_THRESHOLD
NEGOTIATION_INCLUDE_OTHER_INTENTS    NEGOTIATION_MAX_TURNS_AMBIENT
NEGOTIATION_MAX_TURNS_CHAT           NEGOTIATION_PROTOCOL_VERSION
NEGOTIATION_SCREEN_MODE              NEGOTIATOR_STANCE
NEGOTIATOR_TURN_TIMEOUT_MS           OPENROUTER_FALLBACK_MODEL
OPENROUTER_MAX_RETRIES               OPENROUTER_REQUEST_TIMEOUT_MS
OPENROUTER_RUNNABLE_MAX_ATTEMPTS     RUN_OPPORTUNITY_EVAL_IN_PARALLEL
```

An earlier version of this list had **nine** entries. That was the result of
scanning against the sixteen-key `PROFILE_ENV_ALLOWLIST`: the list was the limit,
not the code, so `NEGOTIATOR_STANCE` and eighteen others were refused with a
message asserting the graph could not read them — which was false.

**The scorecard harnesses offer 8 each** (`matching`, `profile`, `premise`,
`opportunity`), from the same generated catalogue:

```
CHAT_MODEL                        CHAT_REASONING_EFFORT
EVAL_MODEL_OVERRIDES              OPENROUTER_FALLBACK_MODEL
OPENROUTER_MAX_RETRIES            OPENROUTER_REQUEST_TIMEOUT_MS
OPENROUTER_RUNNABLE_MAX_ATTEMPTS  SMARTEST_VERIFIER_MODEL
```

**The seven no harness can offer.** `PROFILE_ENV_ALLOWLIST`
(`packages/protocol/eval/ops/ops.allowlist.ts`) has sixteen entries. Seven are
**not reachable from any harness's import closure**, so they are absent from
every catalogue rather than being offered as controls that do nothing (IND-630):

```
POOL_QUESTIONS_MODE       POOL_QUESTIONS_PUSH      POOL_QUESTIONS_RANKING
POOL_QUESTIONS_MINING     OUTCOME_QUESTIONS_MODE   INTRODUCER_DISCOVERY_ENABLED
NEGOTIATION_EVIDENCE_QUESTIONS_MODE
```

**Credentials are never offered**, by any harness: `isCredentialEnvKey`
(`ops.allowlist.ts`) drops them at generation and refuses them again at the
request boundary. `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL` are read by the
graph and absent from the catalogue for that reason, not because they are inert.

"Not reachable from the discovery graph" is the whole claim, and it is not the
same as "untestable". For most of them the behaviour lives in
`packages/protocol` and only the scheduling is in the API queues; they need a
different harness, not no harness. Deciding where that home is, is tracked as
**IND-630**. Do not assume the A/B editor covers all sixteen.

**Both sides must declare the same key set.** Explicit value versus explicit
value. `buildAbPlan` refuses an asymmetric pair, because an omitted key does not
mean "neutral" — it means the graph's own default, and that default can coincide
with the other side's explicit value. `{}` against
`{ DISCOVERY_ALLOWED_TYPES: 'intent,profile' }` is the worst case: the default
*is* `intent,profile`
(`packages/protocol/src/opportunity/discovery.env.ts`), so both sides behave
identically, the run measures nothing but noise, and the artifact attributes
that noise to the flag. Identical configurations are refused for the same
reason.

**A value-level trap the symmetry check cannot catch.**
`DISCOVERY_CONTEXT_TO_INTENT` only changes behaviour when
`DISCOVERY_PROFILE_SOURCE` is `user_context`
(`opportunity.graph.ts:388` and `:1202-1204`; the same lines also require
`profile` to be in `DISCOVERY_ALLOWED_TYPES`). Comparing it alone, under the
default `premise` profile source, measures noise on both sides. The harness will
accept that run — it is a legal, symmetric, differing pair — so this one is on
the operator.

**A/B does not enforce per-row evidence gating**, so a passing A/B slot is not
evidence that the configuration's evidence restriction held: every slot is
scored against all three evidence kinds (`AB_ALLOWED_EVIDENCE` in
`discovery.main.ts`). That is deliberate — which evidence a given arbitrary
configuration should be allowed to cite is the fixed matrix's question, not
this harness's. Every other deterministic assertion still applies, including
the non-empty evidence check.

**Cost.** The corpus is five cases (`HISTORICAL_MATRIX_CASES`), so a default run
is 5 cases × 3 repetitions × 2 sides = **30 graph invocations**: 15 slots per
side, run sequentially within a side, with the two sides running concurrently.
At the ~52s per invocation recorded in `discovery.contract.ts` that is
roughly **13 minutes** of wall clock, plus one judge call per scored slot.
`--runs` defaults to 3 (one observation cannot separate a difference from noise)
and is capped at 10, which is 100 invocations.

**Exit codes**, for the parent invocation an operator runs:

| Code | Conclude |
| --- | --- |
| `0` | Both sides completed and the artifact holds the comparison. Read it. |
| `2` | Refused before anything happened — gate, arguments, manifest or attestation. No branch was reset, no side spawned, nothing spent. Fix what the message names and re-run; you lost seconds. |
| `3` | The run happened and was paid for and the artifact on disk is real, but a side did not score every slot, so there is **no verdict**. Do not read one side's numbers as a comparison. |
| `4` | Failed after the branches began being reset and/or a side was spawned. The branches were mutated and a live run may already be spent; re-running costs that again. The message, not the code, says what was overwritten and whether an artifact or any child artifacts survived. |

The distinction that matters is `2` versus `4`: both are failures, but one costs
nothing and the other costs a live run.

**There is no baseline, and there will not be one.** Arbitrary operator-chosen
configurations have no committed baseline, so the pair *is* the result. The
harness reads, writes and compares no baseline and emits no regression verdict.

**`configs`/`configDiff` are deliberately not in the artifact.** The shared
envelope and scorecard payload schemas are both zod `.strict()`
(`packages/protocol/eval/shared/artifact.ts`), so a run-level configuration
rollup has no legal home in them, and widening a contract shared by every
harness and every committed baseline for a convenience copy is a bad trade.
Nothing is lost: every case row carries `configDeltas` naming that side's
specified overrides (the case schema is the sanctioned `.passthrough()`
extension point), `assertAbConfigProvenance` refuses to write an artifact where
that is missing or wrong, and the diff is printed to the console at the end of
every run. The run-level pair is a rollup of the rows, derivable by grouping
them by rule. Only the keys the operator passed on `--a`/`--b` are recorded:
any other flag value that comes from the env file the command loads (for
example `RUN_OPPORTUNITY_EVAL_IN_PARALLEL` in `.env.test`) is inherited
identically by both sides and is not recorded per case.

Artifacts land in `services/api/eval/discovery/runs/<timestamp>.json`
(gitignored). `payload.rules` are the two sides (`a`, `b`); case ids are
`<caseId>/<side>/r<repetition>`.

#### Operator runbook: first-time setup and smoke

Every step but the first needs `NEON_API_KEY` and Neon project access, so this
is an operator procedure, not something CI or a local checkout can do. Run the
steps in order.

1. **Build `packages/protocol` first.** The A/B parent statically imports
   `@indexnetwork/protocol`, which resolves to `packages/protocol/dist` — a
   gitignored build output that a fresh checkout does not have. The parent dies
   inside that import, and the failure message is deliberately generic, so a
   missing build is not named as the cause:

   ```bash
   cd services/api
   bun run --cwd ../../packages/protocol build
   ```

2. **Create and seed the protected base (IND-626).** `eval-discovery-base` must
   exist in the Neon project with an endpoint on database `protocol_eval`, and
   must carry the seeded historical fixture corpus. Seed and verify it with the
   existing protected-base command, whose own gate is
   `DISCOVERY_ENV_MATRIX_BASE_CONFIRM=1`, `TEST_DATABASE_SAFE=1`,
   `DISCOVERY_ENV_MATRIX_BASE_BRANCH=eval-discovery-base` and a `DATABASE_URL`
   matching the attested base target. That command attests its target the same
   way the matrix does, so it also needs `NEON_API_KEY` and a
   `DISCOVERY_ENV_MATRIX_CHILDREN` manifest (a different manifest from
   `DISCOVERY_TARGETS`); it refuses without them. That manifest must be
   base-only: the base command parses it with no expected child keys
   (`discovery-env-matrix-base.ts:74`), so `children` has to be `[]` — pasting
   the matrix's own five-child manifest is refused with `Manifest must contain
   exactly the expected children`:

   ```bash
   cd services/api
   export DISCOVERY_ENV_MATRIX_BASE_CONFIRM=1 TEST_DATABASE_SAFE=1
   export DISCOVERY_ENV_MATRIX_BASE_BRANCH=eval-discovery-base
   export NEON_API_KEY=<key>
   export DISCOVERY_ENV_MATRIX_CHILDREN='{"version":1,"base":{"projectId":"...","branchId":"br-...","endpointId":"ep-...","databaseName":"protocol_eval","databaseUrl":"postgres://...neon.tech/protocol_eval"},"children":[]}'
   export DATABASE_URL='<the attested base target databaseUrl>'
   bun run eval:discovery-env-matrix-base           # seed
   bun run eval:discovery-env-matrix-base:verify    # metadata + fixture-structure reads only
   ```

   Nothing below works until this branch exists and verifies: every A/B run
   attests that its base branch is named `eval-discovery-base`, and every A/B
   child re-verifies the base metadata and fixture integrity on its own branch
   before it spends anything.

3. **Branch `eval-ab-a` and `eval-ab-b` from it.** Both must be children of
   `eval-discovery-base`, non-primary, named exactly that, and each must have its
   own endpoint on database `protocol_eval`. Create them in the Neon console or
   via the API, then record the project id, the base branch id, and each side's
   branch id, endpoint id and `DATABASE_URL` in the manifest above. Attestation
   fails on any of those being wrong, and the failure is deliberately
   non-specific. All three branches already exist and their ids are listed under
   **Neon Database Topology** below; the endpoint ids and `DATABASE_URL`s are not
   written down anywhere in this repo, because the latter carry passwords.

4. **Smoke it: one case, one repetition.**

   ```bash
   cd services/api
   DISCOVERY_CONFIRM=1 TEST_DATABASE_SAFE=1 \
   NEON_API_KEY=<key> DISCOVERY_TARGETS='<manifest>' \
     bun run eval:discovery -- \
       --case historical/builder-and-operator --runs 1 \
       --a DISCOVERY_ALLOWED_TYPES=intent \
       --b DISCOVERY_ALLOWED_TYPES=intent,profile
   ```

   That is 2 graph invocations (1 case × 1 repetition × 2 sides) plus 2 judge
   calls — a couple of minutes, not forty. Expect exit `0`, a reset line per
   side, the printed configuration diff, and one artifact in
   `eval/discovery/runs/`. In the artifact, check:
   `harness === "discovery"`; `completeness.complete === true`;
   `payload.rules` is exactly the two sides `a` and `b`; and both case rows
   (`historical/builder-and-operator/a/r1` and `.../b/r1`) carry a `configDeltas`
   naming that side's configuration. If `completeness.complete` is `false` the
   exit code is `3` and the run supports no comparison, however good the numbers
   look.

#### Launching it from the eval-ops site

The eval-ops console lists `discovery` as a fifth harness and can launch it:
it is in `OPS_HARNESSES` (`packages/protocol/eval/ops/ops.registry.ts`) with its
own entry in `HARNESS_REGISTRY`. That entry is the only one carrying
`cwd: "services/api"`, because `bun run eval:discovery`
resolves nowhere else; the server turns that into a step plan
(`harnessSteps`, `ops.server.ts`). Everything below is the site's
behaviour, not the CLI's.

(Symbol names rather than line numbers throughout this section: the descriptor
has moved twice, and a citation that points at the wrong line is worse than none
— `ops.registry.ts:190` once landed inside a neighbouring harness's prose.)

**What the server must have configured.** Credentials never come from the
browser. `HARNESS_CREDENTIALS["discovery"]` (`ops.server.ts`) names
three different kinds of thing:

| Variable | Where it comes from |
| --- | --- |
| `NEON_API_KEY` | **The ops server's own environment** — `keys` in `HARNESS_CREDENTIALS`. |
| `DISCOVERY_TARGETS` | **The ops server's own environment** — the attested manifest, the same shape as above; `keys` in `HARNESS_CREDENTIALS`. |
| `OPENROUTER_API_KEY` | **The ops server's own environment** — `runtimeKeys`. No gate asks for it; the child cannot run a model or an embedding without it. |
| `REDIS_URL` | **The ops server's own environment** — `runtimeKeys`. No gate asks for it; the HyDE cache write is uncaught, so an unreachable Redis fails the graph. |
| `DISCOVERY_CONFIRM=1` | Asserted by the server onto the child it spawns, *not* read from the environment (`asserts`). |
| `TEST_DATABASE_SAFE=1` | Same: asserted, not required (`asserts`). |

So four variables have to be set and two do not — setting the two attestations in
the server's environment anyway changes nothing about this route, because the
server writes its own values over whatever the child would have inherited
(`resolveHarnessEnvironment`). The docblock on `HARNESS_CREDENTIALS`
records why the server is entitled to assert them.
`DATABASE_URL` is *deleted* from what the child inherits (`unset` in
`HARNESS_CREDENTIALS`), so the harness script's own `--env-file` decides it.

**Why the last two are pre-checked at all**, when the four scorecard harnesses
read `OPENROUTER_API_KEY` too and nothing checks it for them
(`NO_CREDENTIALS`, `ops.server.ts`, `NO_CREDENTIALS`): the order of this harness's run.
It resets the Neon branches its shape needs on entry — both for a comparison,
`eval-ab-a` alone for a single configuration — and only then spawns the children
that read these variables, so a server missing one used to pass every check on
this route, destroy those branches, and fail afterwards. They are also the easiest to miss,
because nothing names them: they reach the child by inheritance from
`bun --env-file=../../.env.test` (`services/api/package.json:39`), `.env.test` is
gitignored, and Bun exits 0 without a warning when an `--env-file` is absent — so
a container with neither the file nor the variable reads them as unset, silently.
What each is for: `createModel` throws `OPENROUTER_API_KEY is required`
(`instantiateModel`, `packages/protocol/src/shared/agent/model.config.ts`) and the embedder
passes the same key to its OpenAI client
(`services/api/src/adapters/embedder.adapter.ts`); and
`createChildDependencies` builds the HyDE graph over a `RedisCacheAdapter`
(`createChildDependencies`, `services/api/src/cli/discovery-env-matrix.main.ts`) whose client
falls back to `localhost:6379` when neither `REDIS_URL` nor `REDIS_HOST` is set
(`services/api/src/adapters/cache.adapter.ts`), while the graph's
`cache_results` node awaits `cache.set` with no catch
(`cache_results`, `packages/protocol/src/shared/hyde/hyde.graph.ts`) and the adapter's `set`
has none either (`RedisCacheAdapter.set`, `services/api/src/adapters/cache.adapter.ts`). The
check is on `REDIS_URL` alone, so a Redis configured as `REDIS_HOST`/`REDIS_PORT`
is refused here even though the adapter would have accepted it — a refusal an
operator can fix, rather than two reset branches and a failed run.

A local server reads all four from the repo-root `.env.test`, which `eval:web`
loads (`packages/protocol/package.json:46`); a deployed one reads its own process
environment (`serverEnv: process.env`, `ops.server.ts`).

Without any of the four the launch route answers **503**, naming exactly what is
missing: `Refusing to launch discovery: this server has no REDIS_URL
configured. …` (`resolveHarnessEnvironment`, `ops.server.ts`), returned
in `launchRun` (`ops.server.ts`). 503 and not a 4xx on purpose — the request is valid
and it is the server that is not configured to serve it. A blank value counts as
absent (`resolveHarnessEnvironment`, `ops.server.ts`). The message names variables, never values.

**One run in flight, ever — including after a restart.** The two Neon branches
are a shared resource, so `EXCLUSIVE_HARNESSES` (`ops.queue.ts`) gives
`discovery`, and only it, an exclusive slot. A second launch is refused with
**409** naming the run that holds it (`exclusiveRefusal`,
`ops.server.ts`), returned by `launchRun` before anything is resolved and
again by the executor for two launches that raced past the first check).
The refusal names the holder and ties the slot to that run's process exiting,
rather than promising that cancelling it works: a run left behind by an earlier
server has no live entry for `executor.cancel` (`executor.cancel`, `ops.executor.ts`) while
`cancelRun` still answers accepted (`cancelRun`, `ops.server.ts`), so an orphan is
released by exiting and not by the button.
`EVAL_OPS_MAX_CONCURRENT_RUNS` cannot open this: it is a separate rule
(`resolveConcurrency`, `ops.queue.ts`) and no value of it is consulted
here. The slot survives a
server restart because `exclusiveConflict` reads the run store as well as this
process's queue (`exclusiveConflict`, `ops.queue.ts`) — a child spawned by a server that then
died keeps running, and a queue rebuilt in the new process would otherwise admit
a second run that resets `eval-ab-a` and `eval-ab-b` underneath it. A stored
record holds the slot only while its pid is genuinely alive
(`storedRecordHoldsSlot`, `ops.queue.ts`), so the other restart — the
container is replaced and the child dies with it — unblocks the harness instead
of stranding it behind a file nobody can delete.

**The workload is cases × runs × the run's own number of sides.** Discovery has
two shapes, and they cost different amounts: a comparison passes over the corpus
twice in one invocation, a single configuration passes over it once. So the
multiplier is a function of the SPEC, not of the harness — `sidesPerRun`
(`ops.sides.ts`) returns `spec.sides === undefined ? 1 : 2`. It is the single
source for both the workload recorded on the run record (`renderRun`,
`renderRun`, `ops.argv.ts`) and the number the launch form prices and displays
(`passesPerLaunch`, `Launch.tsx`), so the two cannot disagree. A per-harness
constant pinned at 2 — which is what this was — quoted 30 invocations for a
single run that costs 15, and has been deleted rather than deprecated. The A/B
checkbox is an ordinary checkbox for this harness: ticking it compares two
configurations, leaving it off measures one.

The spend confirmation fires for **every** run of this harness, filtered or not,
because `--case` narrows what is measured, not what is destroyed: a filtered run
still resets the branches it will read. The confirmation names the destruction in
the descriptor's own words, and `resets` is keyed by the run's **shape** —
`sides: "both Neon evaluation branches"` for a comparison,
`single: "the Neon evaluation branch this configuration runs on"` for one
configuration (`ops.registry.ts`, selected in `Launch.tsx`). A single string here
told an operator launching one configuration that both branches would be reset,
which `discovery.main.ts` does not do: `abRunningTargets` filters the attested
targets to the sides actually being run.

**No baseline, and there never will be one, so the run view shows a pair rather
than a regression verdict.** The run page does not even fetch a baseline for a
sides harness (`Run.tsx`), and renders `AbComparison` in place of the
scorecard frame (`Run.tsx`) — the scorecard would report this run's
aggregate pass rate, which is the mean across two *different* configurations and
therefore a score of neither. `AbComparison` says so on the page
(`AbComparison.tsx`) and returns `no-verdict` rather than a
comparison whenever the artifact does not support one (`deriveAbView`,
`apps/eval-ops/src/lib/ab.ts`). The overview row shows neither a
baseline nor a latest cell for it, for the same two reasons
(`Overview.tsx`).

**A saved config cannot be selected for it.** The server refuses a named profile
alongside `sides` (`RunSpecSchema`, `ops.argv.ts`) and refuses ad-hoc `overrides`
alongside `sides` (`RunSpecSchema`, `ops.argv.ts`), both as 400s; `renderRun` throws on
the same pair a second time, because that is the layer that would otherwise spend
on it (`renderRun`, `ops.argv.ts`). The reason is that a config moves both sides
identically and so cannot change the difference being measured: its models apply
under both sides at once, and its `env` block would set a shared baseline for the
allowlisted keys nobody is comparing — unrecorded in the artifact, whose
configuration provenance is the per-case `configDeltas` naming only the per-side
keys. The form therefore renders no Config picker for the PAIRED shape of this
harness and states that on the page (`configEnvConflict`, `Launch.tsx`). A single
configuration run may carry one, provided it configures something this harness
reads — see **Configs are harness-agnostic** below.

**The keys a side may set are derived from the harness's own code, not
maintained by hand.** `DISCOVERY_ENV_KEYS` is `HARNESS_ENV_KEYS.discovery`
(`ops.allowlist.ts`), which the generator produces by walking the discovery
graph's transitive import closure and collecting its `process.env` reads
(`ops.envcatalog.build.ts`); `eval/ops/tests/envcatalog.spec.ts` regenerates it
and fails on any difference, so the committed file cannot drift from the code.
That is **28 keys**, not the nine an earlier hand-written list offered: the nine
were an artefact of scanning against the sixteen-key `PROFILE_ENV_ALLOWLIST`
rather than against the graph. The launch form's key picker offers exactly
`HARNESS_ENV_KEYS[harness]` and nothing else, and every offered key must also
carry `ENV_FLAG_METADATA` — a key nobody has explained is not offered
(`eval/ops/tests/metadata.spec.ts`).

Each of the four scorecard harnesses offers **8**: `CHAT_MODEL`,
`CHAT_REASONING_EFFORT`, `EVAL_MODEL_OVERRIDES`, `SMARTEST_VERIFIER_MODEL`,
`OPENROUTER_FALLBACK_MODEL`, `OPENROUTER_MAX_RETRIES`,
`OPENROUTER_REQUEST_TIMEOUT_MS` and `OPENROUTER_RUNNABLE_MAX_ATTEMPTS`. The two
credentials every harness also reads — `OPENROUTER_API_KEY` and
`OPENROUTER_BASE_URL` — are excluded by `isCredentialEnvKey` at generation and
refused again at the request boundary.

**Seven allowlisted flags are reachable from no harness at all, so nothing on
this site tests them.** `PROFILE_ENV_ALLOWLIST` (`ops.allowlist.ts`) has sixteen
entries; the seven below appear in no harness's catalogue. A request naming one
on discovery is refused by name — `<KEY> is not readable by the discovery graph;
this harness cannot test it` (`sideConfigIssues`, `ops.sides.ts`), which the form
and the server both run:

```
POOL_QUESTIONS_MODE       POOL_QUESTIONS_PUSH      POOL_QUESTIONS_RANKING
POOL_QUESTIONS_MINING     OUTCOME_QUESTIONS_MODE   INTRODUCER_DISCOVERY_ENABLED
NEGOTIATION_EVIDENCE_QUESTIONS_MODE
```

Finding these seven a harness is tracked as **IND-630**; until then, editing one
on the Configs page still moves nothing any harness reads. The Configs page
annotates every key with the harnesses that read it, so a key no harness reads is
visible as such rather than silently inert.

**Configs are harness-agnostic, and a config may legitimately carry a key the
chosen harness never reads** — it is shared with one that does. Such keys are
reported, named, as recorded-but-not-read rather than refused (`unreadEnvKeys`,
`ops.envreach.ts`). The exception is a single-configuration discovery run whose
config sets **nothing** this harness reads: that run would measure the committed
default while the record named the operator's config, so both the form and the
server refuse it (`readableEnv` + `singleConfigIssues`, called by `launchRun` and
by the launch form's `envEmpty`). An ad-hoc override naming an unreadable key is
a different case and is always a 400: it was typed for this run, against this
harness, so there is no reading under which it was meant to do nothing.

### Eval Ops Site

A local-first web console over the eval artifacts: browse baselines and runs,
launch the four scorecard harnesses (`matching`, `profile`, `premise`,
`opportunity`) and the `discovery` comparison harness (see **Launching it
from the eval-ops site** above) with live streaming output, compare runs A/B, and
control the seeded test database. The headless core is `packages/protocol/eval/ops/` (the
`ops` eval suite); the UI is the `apps/eval-ops/` workspace.

```bash
cd packages/protocol && bun run eval:web    # Ops API on 127.0.0.1:4321
bun run dev:eval-ops                        # UI on 127.0.0.1:5174 (from repo root)
bun run build:eval-ops                      # Build the UI
```

Both commands above bind loopback, and every route but the two that make signing
in possible requires a session belonging to a verified `@index.network` Index
account. That is defence in depth, not permission to expose it: state-changing
requests must be same-origin and carry a JSON content type, and every request
must be addressed to an allowlisted host, so another site the operator has open
cannot drive or read it — those guards, not the authentication, are what bound
who can reach the site. `WEB_APP_URL` and `API_URL` are one pair (mint and
verify); the ops server refuses to start on a mismatched or half-configured
pair.

**Local by default, and deployable to exactly one origin.** Two variables, both
read in `ops.server.ts`, are what widen it, and neither has a wildcard:
`EVAL_OPS_BIND` moves the bind off `127.0.0.1` (`resolveBindHostname`), and
`EVAL_OPS_PUBLIC_ORIGIN` adds **one** absolute `https` origin to the `Host` and
`Origin` allowlists (`resolvePublicOrigin`, which refuses to start on anything
else) and switches sign-in from the loopback CLI bridge to the JWT token
exchange (`resolveSignInMode`). Unset means loopback only, which is the local
posture and the default. So the site is local unless a deployment deliberately
says otherwise — it is *not* the bind alone that keeps it local, since the
allowlists still fail closed.

The app is excluded from the root `build` script (`build` runs skills, protocol,
API and web; `build:eval-ops` exists but is not in that chain) but it **is**
deployed on Railway, as its own service with its own
[`apps/eval-ops/railway.toml`](../../apps/eval-ops/railway.toml) — a separate
config precisely so it does not inherit the API's `preDeployCommand`, which
would run drizzle-kit against it. The root `railway.toml` remains the API
service's alone. CI gates the app through the `eval-ops` job in
`.github/workflows/lint.yml` (typecheck, test, lint) — the root `build` does not
cover it.

### Subtrees

The following paths are git subtrees tracked to external repos. **Syncing is automatic for Index-owned subtrees** — the `.github/workflows/sync-subtrees.yml` workflow runs on every push to `dev` or `main` of the canonical `indexnetwork/index` repo (including PR merges), splitting each prefix and force-pushing to the corresponding subtree repo with the `SUBTREE_SYNC_PAT` secret. Subtree branches stay aligned with the monorepo branch (`dev` -> `dev`, `main` -> `main`). AgentVillage is Edge-City-owned and is mounted as a git submodule at `packages/edge-city/agentvillage`; `Edge-City/agentvillage` is canonical. The local `scripts/hooks/pre-push` hook still regenerates SKILL.md files before push, but no longer runs subtree push.

**Mirrored packages must declare exact dependency versions.** A subtree repo receives only its own prefix, so it has no lockfile — the root `bun.lock` is not part of the split, and the mirrors' own `bun install --frozen-lockfile` has nothing to freeze. Any range therefore resolves to the newest match on npm, and the mirror builds and publishes versions this monorepo never built. That is how a floating `^2.0.0-alpha.2` let `@modelcontextprotocol/server` 2.0.0-beta.5/2.0.0 break every `indexnetwork/protocol` publish for nine runs while the monorepo stayed green. Pin `dependencies` and `devDependencies` of every mirrored package exactly (peer ranges are the consumer's resolution and stay ranged), and upgrade by changing the pin plus `bun.lock` together. `bun run check:subtree-parity` enforces this and runs in the `lint` workflow.

#### packages/protocol/ → indexnetwork/protocol

The `@indexnetwork/protocol` npm package (agent graphs, interfaces, tools). Two-way: edit here or in the external repo.

```bash
# Manual push if the hook failed (use dev or main)
git subtree push --prefix=packages/protocol https://github.com/indexnetwork/protocol.git <branch>

# Pull if external repo was edited directly
git subtree pull --squash --prefix=packages/protocol https://github.com/indexnetwork/protocol.git <branch>
```

#### packages/cli/ → indexnetwork/cli

The `@indexnetwork/cli` npm package (CLI binary). Two-way: edit here or in the external repo.

```bash
# Manual push if the hook failed (use dev or main)
git subtree push --prefix=packages/cli https://github.com/indexnetwork/cli.git <branch>

# Pull if external repo was edited directly
git subtree pull --squash --prefix=packages/cli https://github.com/indexnetwork/cli.git <branch>
```

#### packages/claude-plugin/ → indexnetwork/claude-plugin

The `@indexnetwork/claude-plugin` Claude Code plugin — ships two user-invocable skills (`index-orchestrator` and `index-negotiator`) and declares the Index Network MCP endpoint so `/plugin install indexnetwork/claude-plugin` auto-configures it. Skill SKILL.md files are generated by `scripts/build-skills.ts` from templates in `packages/protocol/skills/claude-plugin/` and a shared `core-guidance.partial.md`; the generated files are committed to this package and synced to the subtree on push.

```bash
# Manual push if the hook failed (use dev or main)
git subtree push --prefix=packages/claude-plugin https://github.com/indexnetwork/claude-plugin.git <branch>

# Pull if external repo was edited directly (avoid — always edit via this repo)
git subtree pull --squash --prefix=packages/claude-plugin https://github.com/indexnetwork/claude-plugin.git <branch>
```

#### packages/hermes-plugin/ → indexnetwork/hermes-plugin

The `@indexnetwork/hermes-plugin` Hermes-native plugin package — ships the Index Network Hermes plugin manifest, Python registration surface, MCP-backed tool handlers, generated bundled skills, and dashboard placeholder. Skill SKILL.md files are generated by `scripts/build-skills.ts` from templates in `packages/protocol/skills/hermes-plugin/` and the shared `core-guidance.partial.md`. Edit via this monorepo; the standalone `indexnetwork/hermes-plugin` repo is a public subtree mirror synced on `dev`/`main` pushes.

```bash
# Manual push if the workflow failed (use dev or main)
git subtree push --prefix=packages/hermes-plugin https://github.com/indexnetwork/hermes-plugin.git <branch>

# Pull if the external repo was edited directly (avoid — always edit via this repo)
git subtree pull --squash --prefix=packages/hermes-plugin https://github.com/indexnetwork/hermes-plugin.git <branch>
```

#### apps/mac/ → indexnetwork/mac-client

The native macOS client prototype (Swift WKWebView shell around a self-contained React/HTML bundle). The monorepo path is synced to the standalone `indexnetwork/mac-client` repo on `dev`/`main` pushes.

```bash
# Manual push if the workflow failed (use dev or main)
git subtree push --prefix=apps/mac https://github.com/indexnetwork/mac-client.git <branch>

# Pull if the external repo was edited directly
git subtree pull --squash --prefix=apps/mac https://github.com/indexnetwork/mac-client.git <branch>
```

#### packages/edge-city/agentvillage/ → Edge-City/agentvillage submodule

The `@edge-city/agentvillage` Agent Village workspace, skills, and installer. Includes skills for edge-esmeralda, index-network, edgeos, and geo-esmeralda. This package is Edge-City-owned; `Edge-City/agentvillage` is canonical and this monorepo records a submodule pointer for local context only. See `docs/guides/agentvillage-submodule.md` for the workflow and migration preservation note. Do not use subtree push/pull for AgentVillage anymore. Make AgentVillage changes inside the submodule, push a branch/fork to `Edge-City/agentvillage`, open the PR there, then update this monorepo's submodule pointer after the canonical PR merges. The nested `skills/` directory syncs from `Edge-City/agentvillage` to `Edge-City/agentvillage-skills` via that repo's workflow.

```bash
# First clone or after switching branches
git submodule update --init packages/edge-city/agentvillage

# Work on AgentVillage against the canonical repository
cd packages/edge-city/agentvillage
git checkout -b <branch>
# edit, commit, push to a fork/branch, then open a PR against Edge-City/agentvillage:main

# After the Edge-City PR merges, update this monorepo's pointer
cd ../../..
git -C packages/edge-city/agentvillage fetch origin main
git -C packages/edge-city/agentvillage checkout origin/main
git add packages/edge-city/agentvillage
```

### Root

```bash
bun install                                # Install dependencies for all workspaces
bun run dev                                # Interactive: select root or a worktree to run dev
bun run worktree:list                       # List worktrees and their setup status
bun run worktree:setup <name>               # Install node_modules & symlink .env files into a worktree
bun run worktree:dev <name>                 # Run all dev servers from a worktree (auto-setups if needed)
bun run worktree:build [name]               # Build at root, or in worktree <name> if given
bun run skills:validate                      # Validate every project-local Pi and Codex skill
bun run test:scripts                         # Run focused deterministic script tests
bun run dev:eval-ops                         # Eval ops UI on 127.0.0.1:5174 (see ### Eval Ops Site)
bun run build:eval-ops                       # Build the eval ops UI (excluded from root build)
bun run pr:snapshot -- <number|URL|branch>   # Emit factual PR/review/worktree JSON
```

### Deployment Config

- API service: root `railway.toml` watches `services/api/**` and `packages/protocol/**`, runs migrations from `services/api`, and starts `services/api`.
- Web app: `apps/web/railway.toml` watches `apps/web/**` and starts the Vite/Bun server from `apps/web`.
- If Railway service settings reference a config path or root directory, update them from the legacy `frontend` path to `apps/web`; the API service continues to use the root `railway.toml`.

## Architecture Overview

For full architecture details see `docs/design/architecture-overview.md` and `docs/design/protocol-deep-dive.md`.

### Monorepo Structure

```
index/
├── apps/
│   ├── web/             # Vite + React Router v7 SPA with React 19
│   ├── eval-ops/        # Local-first eval ops console (Vite + React 19) — not deployed
│   └── mac/             # Native Apple client subtree → indexnetwork/mac-client
├── services/
│   └── api/             # Backend API & Agent Engine (Bun, TypeScript)
├── packages/
│   ├── protocol/        # @indexnetwork/protocol NPM package — subtree → indexnetwork/protocol
│   ├── cli/             # @indexnetwork/cli — Bun, TypeScript — subtree → indexnetwork/cli
│   ├── claude-plugin/   # @indexnetwork/claude-plugin — index-orchestrator and index-negotiator skills, subtree → indexnetwork/claude-plugin
│   ├── hermes-plugin/   # @indexnetwork/hermes-plugin — Hermes-native plugin, subtree → indexnetwork/hermes-plugin
│   └── edge-city/       # Edge-City submodules: agentvillage, landing, controlplane
├── docs/                # Project documentation (design/, domain/, guides/, specs/)
└── scripts/             # Worktree helpers, hooks, dev launcher
```

### Documentation Directories

- `docs/design/` — Architecture and deep-dive docs. Describes how the system is built: layering, data flow, agent graphs, key subsystems. Update when architecture changes. See `docs/design/opportunity-status-lifecycle.md` for the opportunity status lifecycle (state machine, flows, transition table).
- `docs/domain/` — Domain concept docs. Explains the business model: what intents, indexes, opportunities, identity and context, contacts are and how they relate. Update when domain model changes.
- `docs/specs/` — API and CLI specs. Describes external interfaces: endpoints, CLI commands, input/output contracts. Update when public interfaces change.
- `docs/guides/` — Setup and usage guides for developers. Update when dev workflow or environment setup changes.
- `docs/research/` — Research reports and historical analysis that inform design but are not normative runtime documentation. Link to current design/spec docs when applying their conclusions.

### Protocol Key Directories

**Tech Stack**: Bun runtime (Bun.serve), Drizzle ORM, PostgreSQL with pgvector, BullMQ (Redis-backed queues), LangChain/LangGraph

- `src/controllers/` - API controllers with decorator-based routing (`@Controller`, `@Get`, `@Post`)
- `src/services/` - Business logic layer
- `src/adapters/` - Infrastructure implementations (database, embedder, cache, queue, scraper, storage)
- `src/gateways/` - Single-point delivery bridges to external chat/notification channels (e.g. Telegram bot for inbound+outbound)
- `src/schemas/` - Drizzle table definitions; primary schema is `schemas/database.schema.ts`
- `src/guards/` - Auth/validation guards
- `src/queues/` - BullMQ job queue definitions
- `src/events/` - Event emitters (intent events, network membership events, premise lifecycle events)
- `src/cli/` - CLI and maintenance scripts
- `packages/protocol/` - `@indexnetwork/protocol` NPM package — the agent graphs, interfaces, and tools layer. Published independently; `services/api/` imports it as a versioned NPM dependency.

**Entry point**: `services/api/src/main.ts` -- Bun native server on port 3001, controllers registered via `RouteRegistry`.

For full agent/graph/controller listings see `docs/design/protocol-deep-dive.md` and `docs/specs/api-reference.md`.

### Web App Architecture

**Framework**: Vite, React Router v7, React 19, Tailwind CSS 4, Radix UI

- `src/app/` - Page components (lazy loaded)
- `src/components/` - Reusable React components
- `src/contexts/` - React Context providers
- `src/services/` - Web API clients (typed fetch wrappers)

**API Proxy**: Vite proxies `/api/*` to protocol backend (port 3001) in dev. **Auth**: Better Auth (session-based).

## Protocol Layering Rules

Strict layering: **Controllers -> Services -> Adapters**. Dependencies always point inward.

1. **Controllers** import **services** (or protocol graph factories). Must not import adapters.
2. **Services** import **adapters** for data access. Must not import other services -- use events, queues, or shared lib for cross-service orchestration.
3. **Protocol layer** (`@indexnetwork/protocol`) is fully self-contained — zero imports from the app. Receives adapters via **constructor injection** through interfaces. The **composition root** (`src/controllers/mcp.controller.ts`) assembles `ProtocolDeps` inline and injects `ChatGraphFactory` into `ChatSessionService` at startup via `setFactory()`.
4. **Adapters** must not import from `@indexnetwork/protocol` interfaces — they define their own aligned types.

### Template Files

Consult before adding or changing code in each layer:

- `services/api/src/controllers/controller.template.md`
- `services/api/src/services/service.template.md`
- `services/api/src/queues/queue.template.md`


## Important Patterns

### Polymorphic Source Tracking

Intents track their origin via `sourceType` (`file|integration|link|discovery_form|enrichment`) and `sourceId` (uuid FK). Enables filtering by source and bulk re-processing.

### Confidence & Inference Tracking

Intents have `confidence` (0-1) and `inferenceType` (`explicit|implicit`).

### Personal Networks

Each user has a personal network (`isPersonal=true`) created on registration, tracked via the `personal_networks` mapping table. Ownership via `network_members` with `permissions: ['owner']`, not a denormalized column. Contacts are stored as `network_members` rows with `'contact'` permission on the owner's personal network -- no separate contacts table. `ContactService.addContact(email)` handles finding/creating users (including ghost users) and upserting membership. Personal networks cannot be deleted, renamed, or listed publicly.

### Network Prompts & Auto-Assignment

Networks and members have `prompt` fields used by LLM agents to evaluate intent membership. Members have `autoAssign: boolean` for auto-tagging new intents.

### Relevancy Scoring


### Queue-Based Processing

Intent creation is synchronous; complex processing (indexing, generation) is async via BullMQ queues. Default: 3 retries with exponential backoff, completed jobs removed after 24h. The `EnrichmentQueue` (formerly `ProfileQueue`) handles enrichment, premise decomposition, and user context generation as a unified enrichment pipeline (the protocol graph that runs it is the `EnrichmentGraphFactory` in `packages/protocol/src/enrichment/`, renamed from the profile graph in WS11/IND-368). The premise graph's create path runs a `dedupe` node before persist: a candidate whose embedding is a near-duplicate (cosine ≥ `PREMISE_DEDUP_SIMILARITY`, default 0.93) of an existing ACTIVE premise for the same user is skipped (`findSimilarActivePremise`), so re-running similar input does not accumulate near-identical premises. `PremiseDecomposer` emits a per-premise `validityDays`; contextual premises are persisted `volatile` with `validity.validUntil = now + validityDays` (assertive premises do not expire), and provenance `confidence` is derived from the analyzer's felicity scores when not explicitly supplied. Per-network user contexts are regenerated by the dedicated `UserContextQueue` (`usercontext.queue.ts`), enqueued both on enrichment completion and — chained from `PremiseQueue.handleProfileRegen` — on every premise change, so the representation discovery matches on refreshes promptly instead of only on the next full enrichment. The queue dedups per user (its jobId frees on settle via `removeOnComplete/Fail: true` so repeated edits re-run rather than dedup against a retained completed job), short-circuits per network via a `premiseHash`, and regenerates the context paragraph + embedding + HyDE docs (forcing HyDE regeneration, since the context row id is stable across upserts). On per-network failure it rolls the `premiseHash` back and fails the job so retries regenerate rather than short-circuit.

### Frame-Drift Monitoring

IND-430 adds disabled-by-default, measurement-only daily monitoring through `FrameDriftQueue` → `FrameDriftMonitoringService` → `FrameDriftDatabaseAdapter`. A unique `frame_drift_observation_runs` header claims the whole bucket before any measurement read; in the same repeatable-read transaction, its rows immutably record privacy-thresholded, user-balanced capture-time premise/intent/user-context centroids and a bounded **non-causal** intent-assignment-pair normalized opportunity-yield proxy. `minUsers` applies both to centroid contributors and to each yield-pair side. `[bucketStart,bucketEnd)` is the closed opportunity window; centroids and denominator are observed at `capturedAt`, not reconstructed as of bucket end, and historical qualifying aggregates are not recomputed after later user deletion. The source-vector model field is explicitly `configuredEmbeddingModel`/`configured_embedding_model`: it records capture configuration, not source provenance. It has no API/UI and must never mutate embeddings, prompts, vocabulary, assignments, opportunities, or networks. BullMQ's once-daily UTC scheduler is omitted from Bull Board; enabled startup reuses a materially matching scheduler without upsert (including overdue `next` values), upserts only missing/changed definitions, and retries lookup/upsert, while disabled removal retries and creates no worker. The separate `frame_drift_execution_attempts` ledger records one privacy-minimized started/terminal row per BullMQ attempt and has no observation-run FK or role in the atomic measurement transaction. Tracking is awaited before measurement and failures retry the job; absent rows remain unobserved/unknown rather than proof that BullMQ never enqueued. See `docs/design/frame-drift-monitoring.md` for privacy, attribution, stable cohort, scheduling, attempt semantics, logging, and limitations.

### Pool-Aware Intent Questions

Discovery completion in both the MCP `DiscoveryRunQueue` and web `FromIntentQueue` runs the shared pool-discriminator mining hook. With `POOL_QUESTIONS_MODE=on`, the top evidence-verified axis becomes an intent-scoped `pool_discovery` question (at most one pending per intent; “Both matter” is always available). The queued/chained final gate re-reads the exact recipient+intent pool and normalized payload+summary fingerprint: it accepts only unchanged fingerprints with pool Jaccard ≥`0.7`; otherwise no row, push, or dismissal is created. Completion system-voids pending drifted rows with `detection.voidedReason='pool_drift'`; voided rows never render, push, count, affect dismissal decay, or suppress novelty. Repeated MODE-on mining skips when the latest durable non-voided snapshot has the same fingerprint and Jaccard ≥`0.7`; independently gated shadow-only mining has no durable cadence anchor. Answer handling is deterministic: the same shared `0.7` threshold governs P3 retained-assignment admission, then chosen/other/live-unassigned candidates receive `1.0`/`0.6`/`0.9` metadata adjustments and matching `pool_discriminator` signals through row-locked adapter writes. Substantive answers also refine the canonical owned intent and fresh resolved axes are suppressed by a full normalized payload+summary fingerprint. No premise is created. With both `POOL_QUESTIONS_MODE=on` and default-off `POOL_QUESTIONS_STAMP_NEWBORN=on`, an evidence-verified fixed-axis classifier stamps the same factors and `questionId` provenance onto genuinely new intent-triggered opportunities immediately before insertion; lifecycle/fingerprint drift, unsafe callback output, and classifier failure fail open to the original insert. `POOL_QUESTIONS_RANKING=on` makes an intent-scoped RadarGraph order by confidence × cumulative adjustment (floor `0.3`) and stamps a template-only deprioritization reason onto cards; off preserves the prior order. Every new adjustment carries `recipientUserId + intentId` provenance, legacy unscoped entries are ignored, and ranking/reasons apply only when both the viewer and selected intent match. Tier-0 reads and row-locked writes require the opportunity's exact `detection.triggeredBy` intent (the broader actor-intent Radar fallback is never used), while canonical refinement deliberately remains keyed only by `questions.detection.sourceId`; newborn stamping uses the same scoped provenance. A preference answer also uses one BullMQ deduplication key per intent (`pool-rerun-<intentId>`) with a sliding 60-second replace/extend window and `keepLastIfActive`, so bursts coalesce while an answer received during an active run is retained as one trailing run; the worker reads the latest durable answers into its search query, re-runs from-intent discovery, awaits failure-isolated mining, and appends count-only Beat 2 narration to the stable intent negotiator session. The intent page uses bounded refresh checkpoints rather than permanent polling. With default-off `POOL_QUESTIONS_PUSH=on` (plus pool-question mode and negotiator availability), both initial and chained producers enqueue the dedicated `PoolQuestionPushQueue` after the shared persist choke point. A per-recipient advisory transaction lock enforces strict dismissal-decayed VoI, pool ≥8, active/owned lifecycle, explicit `intents.lastVisitedAt`, one claim per run/mined cycle, and two claims per UTC day. Delivery inserts/verifies the question ID as one deterministic message in the stable unscoped Personal Agent DM and stamps `detection.pushedAt` atomically; resolved-before-delivery rows are suppressed. Only successfully delivered pending pool rows join the Personal Agent badge. The global Questions page, unscoped injected questions, REST/MCP payloads, and intent-pinned sessions remain pool-push-free. Material payload/summary intent edits void pending stale questions, let an answered axis be asked once under the new fingerprint, and mark exact recipient+intent `poolAdjustments` as `stale:true`; stale adjustments remain for audit but do not rank or demote, while legacy unscoped/malformed entries are preserved. `POOL_QUESTIONS_MINING`, `POOL_QUESTIONS_MODE`, `POOL_QUESTIONS_PUSH`, `POOL_QUESTIONS_STAMP_NEWBORN`, and `POOL_QUESTIONS_RANKING` remain independent gates. The seven-day TTL is unchanged.

### Intent-Page Refinement Questions

Creation-time intent questions and the completion hooks in `FromIntentQueue` and exact-intent `DiscoveryRunQueue` all converge on `IntentRecoveryRefinementService`. This gives ordinary Questioner-generated intent refinements the same dependable intent-page surfacing opportunity as pool questions without requiring discovery to produce no actionable opportunity. The first producer for a material intent version may insert; later creation/completion retries hit the same recipient+intent+normalized payload+summary fingerprint cadence anchor across every status and expiry state. Generation receives payload/summary, stored global owner context, and at most a bounded aggregate count of rejected negotiations that pass bilateral participant, capture-time fingerprint, completed-task, task/actor network, and single no-opportunity-artifact validation; no IDs, identities, profiles, networks, turns/transcripts, reasons, presenter/evaluator text, or event context crosses the generation/persistence boundary. Rows remain public `mode='intent'` questions while private `purpose='recovery'` metadata is REST-stripped. Persistence, owned exact-trigger opportunity creation, and exact-trigger reactivation share the same recipient+intent advisory lock; reactivation also serializes with negotiation task creation on the opportunity's attempt lock, row-locks and re-reads the opportunity, and applies the canonical fresh/active task predicate immediately before mutation. Row locks and migration `0105` enforce one recipient+intent+material-fingerprint row and recheck lifecycle/fingerprint immediately before insert. Every generated visible field is screened for process/evidence narration after Unicode quote normalization. Material edits and stale answers system-void stale rows without reaction; answer admission uses advisory→intent-row→question-row ordering and carries the expected fingerprint plus owner through the answer-only graph to a final locked write that also rechecks active/non-archived lifecycle before canonical refinement/HyDE/rediscovery. Ordinary intent and pool questions have independent cadence/budgets and may coexist.

### Intent Pause/Resume

`PATCH /api/intents/:id/status` accepts only `ACTIVE` or `PAUSED`, is owner- and network-scope-guarded, and returns `409` for archived or terminal intents. Null legacy status is treated as `ACTIVE`. Pause preserves existing opportunities/Radar cards, pending questions, conversations, intent-network assignments, and HyDE while blocking admission of not-yet-started intent-driven discovery, candidate matching against the intent, new pool mining/questions, and answer-triggered Tier-1 reruns; already-admitted work may finish. Existing questions remain answerable and Tier-0 re-ranking can still apply. Resume sets `ACTIVE` and immediately enqueues a lifecycle-version-deduplicated from-intent discovery run; the HTTP response awaits enqueue acknowledgement. If a changed resume cannot enqueue, an owner/scope/version compare-and-set compensates it back to `PAUSED` without overwriting concurrent changes and the endpoint returns retryable `enqueue_failed` instead of success. The intent page keeps the existing workspace visible, toggles live/Pause to paused/Resume with mutation loading and error feedback, and after successful Resume uses bounded refresh checkpoints through 180 seconds for Radar, pending questions, and the negotiator rather than permanent polling.

### User Contexts & Discovery

Each user has network-scoped **user contexts** (`user_contexts` table) — synthetic paragraph representations generated from their premise graph by `UserContextGenerator` — plus one **global** context row (`networkId = null`, the profile-replacing identity paragraph) enforced unique per user by the partial `user_contexts_user_global_uniq` index. The global row is generated by `UserContextGenerator.generateGlobalColdStart` (a network-agnostic prompt variant) and is always (re)built from active premises even when the user belongs to no non-personal networks; per-network rows use the network-lensed prompt. Contexts are generated during enrichment and regenerated whenever the user's premises change: premise lifecycle events enqueue regeneration via `UserContextQueue` (premise-derived, `premiseHash`-gated, with embeddings + HyDE refreshed) for the global row and each per-network row. (The legacy profile-graph `aggregate` step that preceded this enqueue was removed in WS8/IND-365 along with the `user_profiles` table it wrote.) They are stored with their embeddings. **"Category A" prompt consumers read the global row instead of flattening discrete profile fields** (`identity`/`narrative`/`attributes`) into LLM text: intent HyDE context (`intent.queue.ts`), the QuestionerAgent intent/negotiation presets (`questioner.presets.ts`, fed by `intent.graph`/`negotiation.graph`), the network ranker (`network.recommender.ts`), and the intent vague-job role hint (`intent.graph.ts`). The backend `ensureGlobalUserContext(userId)` helper (`services/api/src/lib/usercontext/global-context.ts`) is the single read-or-generate entry point — it returns the stored global text or synthesizes it on demand from ACTIVE premises via `generateGlobalColdStart` and upserts it (no HyDE for the global row, since it is excluded from context-to-intent discovery), returning `''` only when the user has no premises. It is injected into chat tool deps as `getUserContextText` (onboarding network ranking) and called directly by the intent HyDE queue and the question-backfill CLIs; protocol graphs read the global row read-only via their injected `getUserContext`. The opportunity graph uses contexts for **context-to-intent discovery**: it loads a user's contexts, then searches for matching intents via `searchIntentsByContextEmbedding()` (or HyDE-enhanced context embeddings). Discovery runs on **context-to-intent + premise similarity**; results are merged via `mergeStrategyCandidates()`. Context discovery candidates carry `discoverySource: 'context-to-intent'`. **Profile-HyDE discovery was retired in WS10 (IND-367)** — the `searchProfiles`/`'profiles'`-corpus reader (the last runtime read of `user_profiles`) was already unreachable (the live `searchWithHydeEmbeddings` path remaps the `profiles` corpus hint to `premises`, and nothing passed `'profiles'` to `embedder.search()`), so it was removed along with the `backfill-profile-hyde` CLI; the `ensure_profile_hyde` enrichment gate now keys on **ACTIVE premises** instead of a `user_profiles` row. Legacy `hyde_documents` rows with `sourceType='profile'` were orphaned (never read) and are deleted in WS8's teardown migration (`0084_drop_user_profiles`).

**Profile reads are sourced from `users`, not `user_profiles`.** The adapter `getProfile`/`getProfileByUserId`/`getProfileRow` (`database.adapter.ts`) build the `UserIdentity` (WS11/IND-368, replacing the removed `ProfileDocument`/`ProfileRow` — shape `{ identity:{name,bio,location}, context }`) from the `users` table (`name`/`intro`→bio/`location`) via a single `buildProfileFromUser` helper; the typed `attributes.skills[]`/`interests[]` and `narrative.context` are dropped (returned empty) since they have no home on `users` and their content lives in premises + the global context. `getProfile` therefore returns a row for **every existing user** (null only when the user does not exist) — it is a presentation read, not an existence check. Code that needs "has the user been enriched?" must use a real signal instead: the enrichment graph's check node keys on **ACTIVE premises** (`getPremisesForUser`), and `findWithGraph`'s `hasProfile` (the `/me` auto-enrichment gate) keys on the presence of a **global `user_context`** row. The `user_profiles` table was **dropped in WS8 (IND-365)** (migration `0084_drop_user_profiles`); `saveProfile` now persists identity (name / bio→`intro` / location) to `users`, `deleteProfile` is a no-op, the legacy placeholder/backfill writers were removed, and the profile graph's dead `aggregate_profile`→`generate_profile`→`save_profile` tail was deleted (premise creation is now the terminal effect; `ProfileGenerator` survives only for the WS11-scoped onboarding draft tools).

The public `read_user_contexts` tool reflects the current model: single-user reads (self / `userId`) return thin identity (`name`, `bio`, `location`) plus a `context` paragraph (the global `user_context` text, injected in the tool layer via `getUserContextText`); list reads (name search / `networkId` roster) return thin identity only (no per-member context fan-out). The retired `skills`/`interests` arrays are no longer returned by any read path. The onboarding draft tools (`preview_user_context`, `confirm_user_context`, and `create_user_context`) emit a structured draft for user approval. **WS11 (IND-368) eliminated the internal "profile" concept**: the pipeline/files/service/controller/adapter/`profile_tool_runs` table were renamed to `enrichment` (`EnrichmentService`, `enrichment.controller` at `/enrichment/sync`, `EnrichmentDatabaseAdapter`, `enrichment-run.*`, `enrichment_tool_runs`), `ProfileDocument`→`UserIdentity`, the public read payload became a flat identity+context payload (no nested `profile` object), and the questioner `profile` mode became `enrichment`. The former MCP/REST/chat names (`read_user_profiles`, `*_user_profile`, and `*_profile_run`) were retained temporarily as compatibility labels but are now retired; callers must use the canonical `*_user_context` and `*_enrichment_run` names. The historical persisted enrichment-run operation values `preview_user_profile` and `update_user_profile` remain supported solely for old database rows. The user-facing `index profile` CLI command and questioner `sourceType:'profile'` metadata remain product-facing or persisted labels.

### Event-Driven Broker System

**Retracting integration premises and re-enriching are a pair.** `UserService.setSocials`
retracts every `source='integration'` premise for the user and then enqueues `enrich.user`
(`reason: 'socials_updated'`) to rebuild them. Retracting without re-enriching leaves the
user with no ACTIVE premises at all, which drops them out of discovery and — via
`PremiseEvents.onRetracted` → `premise_cascade` — expires their live opportunities. The
retraction runs only when the **stored** social set actually changed: the web and mac
settings screens submit the full socials array on every save, so `setSocials` compares
stored rows either side of the write (post-normalization, ignoring row ids) and returns
early when they match. Contact/ghost creation in `contact.service` is the other
`enrich.user` trigger.

Events in `src/events/`: `IntentEvents.onCreated/onPaused/onResumed/onArchived`; pause/resume handlers receive `intentId`, `userId`, and `lifecycleVersionMs`, and `onResumed` is async so callers can await enqueue acknowledgement. Network membership events in `network_membership.event.ts`. Premise lifecycle events in `premise.event.ts`: `PremiseEvents.onCreated/onUpdated/onRetracted/onExpired` — each enqueues cascade and profile regeneration jobs via `EnrichmentQueue`. Question lifecycle events in `question.event.ts`: `QuestionEvents.onCreated/onAnswered/onDismissed` — `onAnswered` dispatches to mode-specific handlers (`question.answer.handler.ts`): intent→description refinement + HyDE regen, negotiation-family→locked exact-provenance settlement (uptake stays private, ordinary uses established opportunity metadata, inflight claims only its stamped task before continuation), chat→resolves the in-memory wait bus (`lib/chat-question.events.ts`) so a chat turn blocked on the orchestrator's `ask_user_question` tool resumes with the answer; `onDismissed` resolves the same bus for chat-mode dismissals. The `ask_user_question` tool (chat-only, AskUserQuestion-style human-in-the-loop) generates questions synchronously via the QuestionerAgent's `chat` preset (hybrid: orchestrator-authored purpose/drafts + conversation excerpt + global user context), persists them with mode `chat` and `conversationId`, streams a `user_question` SSE event, and blocks the turn until answer/dismiss/timeout (`QUESTIONER_CHAT_WAIT_TIMEOUT_MS`, default 4 min; runtime `interactive` timeout class default 5 min); `POST /questions/:id/answer` returns `resumed` so the frontend knows whether to feed a late answer back as a new turn. Questions have an optional `conversationId` column linking them to the chat session that triggered them, and `detection.messageId` for anchoring to a specific assistant message. `tool.factory.ts` wraps `questionerEnqueue` in `sessionAwareEnqueue` to default `conversationId` from the active session context. The frontend renders conversation-linked questions inline via `InjectedQuestions`; sidebar badge uses `noConversation=true` to exclude them. The uptake guard (IND-424) reuses `mode='negotiation'` with internal `detection.purpose='uptake'`: committed `pending` opportunity writes emit `OpportunityEvents.onPending`, low-authority counterparty intents enqueue one network-scoped preparatory question, and accept paths return a non-mutating advisory until the current questions are resolved or explicitly acknowledged. Uptake answers remain private on the question row rather than entering shared `opportunities.metadata.userAnswers`; `QUESTIONER_UPTAKE_ENABLED` defaults off beneath the master Questioner flag. IND-507 gives ordinary, inflight, and uptake rows a server-only versioned `detection.negotiation` envelope with exact recipient+owned intent+opportunity+network, task (when applicable), canonical intent fingerprint, and lifecycle markers. Mode/purpose is runtime-discriminated; inflight uses only safety-validated structured `askUser` fields, uptake uses neutral fixed context, and visible output is rejected on private/internal/unsupported claims. API admission validates before generation and under advisory→full-cohort→provenance locks before insertion/settlement. Pending negotiation reads/counts validate provenance even unscoped, while exact answered history tolerates only its own settlement transition. Inflight settlement writes a deterministic `requested|completed` task-metadata outbox; answer/dismiss/timeout enqueue one exact-task run-existing job, and the still-armed timeout recovers zero rows, enqueue failure, and Bull/process redelivery without latest-task lookup. MCP/chat/direct answering reaches the same authoritative adapter with authenticated principal and network-scope clamps. Public projections strip the envelope and server-only metadata. Services emit events after DB transactions; other services/graphs react independently.

### Agent Registry

**Main-web Signal Agent.** `WEB_SIGNAL_AGENT_ENABLED` is a strict, default-off cutover for new session-authenticated home/ordinary web chats. Flag-on creation explicitly persists `conversations.persona='signal'`; follow-ups inherit that stored persona, while request mismatches and unknown stored personas fail closed. Legacy orchestrator web sessions remain readable but are server-side read-only and the UI starts a separate Signal chat rather than rewriting history. Authentication provenance, not a caller-controlled route/surface value, classifies session-authenticated compatibility stream/message/resolver calls as web; API-key callers keep compatibility orchestrator behavior. The sole session-only onboarding exception authoritatively requires an incomplete `users.onboarding` record and forces orchestrator, so completed users cannot use it as a bypass. Compatibility histories are orchestrator-only, while the session-only web history returns legacy orchestrator plus Signal sessions. The Signal persona reuses the persona-neutral `ChatGraphFactory` runtime with a positive allowlist limited to signals/intents, assignment to existing memberships, profile context/premises, read-only network/membership context, pasted-URL scraping, and chat clarification. Signal wrappers live-recheck membership and clamp focused reads; confirmed network assignment validates and locks current membership in the same transaction as intent/assignment creation. It has no opportunity/discovery-run, negotiation, contact/import, agent/network administration, or membership-mutation tools, and disables the discovery-coupled create-intent callback while retaining proposal hallucination recovery. Browser-based `index login` mints a 90-day CLI API credential and the CLI sends it with `x-api-key`, preserving the non-web orchestrator surface without making generic session JWTs a bypass. API-key, Telegram, MCP, CLI, direct-tool, and default orchestrator behavior is otherwise unchanged.

All agents are first-class database entities backed by `agents`, `agent_transports`, and `agent_permissions`. System agents (`Index Chat Orchestrator`, `Index Negotiator`) are seeded with well-known UUIDs and receive default permissions during onboarding. MCP auth resolves to `userId + agentId` pairs when API keys include `metadata.agentId`. API-key principal resolution is centralized in `src/lib/apikey/principal.ts` (`resolveApiKeyUserId`), shared by the MCP auth resolver (`mcp.controller.ts`) and `AuthGuard` so the same key cannot resolve to different users across codepaths: it prefers a verified session, then `userId`, then `referenceId`, and rejects (fails closed) any key whose two principal columns are both set but disagree. `AuthGuard` accepts JWT or API key everywhere except **session-only endpoints** (`SessionOnlyGuard` in `auth.guard.ts`): `DELETE /auth/account` and the `/agents` management writes (create/update/delete agent, tokens, permissions, transports) reject API keys with 403 (`SessionRequiredError`), so a leaked agent key cannot delete the account or mint successor credentials that survive rotation; the agent-poller endpoints (negotiations pickup/respond, test messages, opportunity pickup/delivery) intentionally stay API-key reachable. MCP requests that carry the Telegram identity headers additionally verify that the request's `x-index-telegram-username`/`-handle` matches the authenticated user's stored telegram handle and isn't owned by another user (`findTelegramHandleOwners` normalizes stored `@h` / `t.me` URL variants to the bare handle), rejecting on mismatch. Personal agents connect by polling `/agents/:id/negotiations/pickup` with an API key; each poll bumps `agents.last_seen_at`. The dispatcher consults that heartbeat: if no personal agent is fresh (seen within 90 s), the system negotiator runs inline; otherwise the turn is parked in `tasks.state='waiting_for_agent'` with a bounded park-window budget (`AMBIENT_PARK_WINDOW_MS`, 5 min by default) that carries over from the `waiting_for_agent` timer to the `claimed` timer rather than stacking.


### Trace Event Instrumentation

`requestContext` carries a `traceEmitter?` callback for real-time TRACE panel in chat UI. Tool files emit `graph_start/graph_end` around graph invocations; graph files emit `agent_start/agent_end` around agent calls. Use kebab-case agent names. See `docs/design/protocol-deep-dive.md` for full examples.

Negotiation-specific events (`negotiation_session_start/end`, `negotiation_turn`, `negotiation_outcome`) carry per-candidate turn and outcome data for orchestrator-inline negotiations. They are persisted into `debugMeta.orchestratorNegotiations.opportunityIds` for later hydration by the debug endpoint. `debugMeta` also now tracks `llm.{calls,totalDurationMs,resets,hallucinations}` accumulated from `llm_start/end`, `response_reset`, and `hallucination_detected` events.

### HyDE Generation Modes

IND-426 adds a default-off frame-v1 path behind `HYDE_FRAME_CONSTRAINTS_ENABLED=true` (strict literal). Legacy remains `infer → cache → generate → embed → persist`; frame-v1 extracts a source-only frame in a separate model call (profile context is lens-selection context only), uses fingerprinted Redis/context provenance plus stable versioned DB lens identities, validates generated documents before embedding, supports partial/all rejection, and treats validator failures as ephemeral failed-open output that is never cached or persisted. Bulk context discovery filters persisted HyDE rows to the active mode, current source-text hash, and newest generation marker. The paired `packages/protocol/eval/hyde` suite provides retrieval diagnostics; `eval/matching` invokes `OpportunityEvaluator` directly and is only a secondary regression check.

### OpenRouter Configuration

Model settings centralized in `packages/protocol/src/shared/agent/model.config.ts`. Key env vars: `OPENROUTER_API_KEY` (required), `CHAT_MODEL` (override), `CHAT_REASONING_EFFORT` (`minimal|low|medium|high|xhigh`), `RUN_OPPORTUNITY_EVAL_IN_PARALLEL` (experimental), `NEGOTIATION_MAX_TURNS_CHAT` (default 4, chat-path negotiations), `NEGOTIATION_MAX_TURNS_AMBIENT` (default 6, ambient/background negotiations), and strict `NEGOTIATION_INCLUDE_OTHER_INTENTS` (default `true`; `false` restricts autonomous opportunity negotiations to each participant's exact opportunity-bound intent before screen/prompt/dispatch/persistence). Use `ToolContext.modelConfig` to inject config per-request via `ChatAgent.create`; only `ChatAgent` reads `ModelConfig` from `ToolContext` — most other protocol agents rely on `OPENROUTER_API_KEY` in the environment (some accept an explicit `ModelConfig` as a direct parameter to `createModel()`).

### Rate Limiting

The protocol applies per-route-class limits via the `RateLimit(class)` guard from `src/guards/limiter.guard.ts`. Four classes:

- `read` — all `GET` routes (default 1200/min)
- `write` — all `POST/PUT/PATCH/DELETE` routes (default 600/min)
- `auth_write` — credential-mutation endpoints on `/api/auth/*` (default 100/min); enforced by Better Auth's own `rateLimit` block
- `intake_synthesis` — write routes that launch an LLM synthesis plus a full intent-graph run and persist a durable proposal per call (`POST /intents/intake/prepare`, `POST /intents/intake/revise`); default 20/min via `LIMITER_INTAKE_SYNTHESIS_PER_MIN`

Buckets are keyed per identifier: verified JWT user (signature-checked) or client IP for everything else. Unverified credentials (raw API keys, session cookies) deliberately do NOT get their own buckets — that would let a client rotate values per request to evade IP throttling. Apply via `@UseGuards(RateLimit('read'), AuthGuard)` — `RateLimit` must be FIRST so it short-circuits before any DB work. Agent-poller endpoints (`POST /agents/:id/negotiations/pickup`, `GET /agents/:id/opportunities/pending`, `GET /agents/:id/opportunities/accepted`) intentionally omit the guard. Storage is Redis (shared across Bun instances) when either `REDIS_URL` or `REDIS_HOST` is set; otherwise the limiter uses an in-memory fallback (single-process, dev only — not multi-instance safe). Set `LIMITER_DISABLE=1` to disable as an incident escape hatch.


See `docs/superpowers/specs/2026-05-21-protocol-rate-limiting-design.md` for the full design.

## Environment Setup

See `docs/guides/getting-started.md` for full setup guide.

### Neon Database Topology

Two Neon projects exist:

1. **Protocol-dev-europe** (`patient-pine-89907813`, `aws-eu-central-1`) — local development database. Developers connect here from their machines.
2. **Protocol** (`shiny-cloud-34341469`, `aws-us-east-1`) — has these branches:
   - **`production`** (`br-fragrant-brook-ahexgsek`) — production data. **Never touch.**
   - **`dev`** (`br-late-tooth-ahlsfgdb`) — used by the Railway `dev` environment. Database name: `protocol_prod`.
   - **`eval-discovery-base`** (`br-wispy-queen-ahmxwx1s`) — the **protected** seeded fixture base for the discovery evals. Database name: `protocol_eval`. Seeded and verified by `eval:discovery-env-matrix-base`; never used by a run directly.
   - **`eval-ab-a`** (`br-old-meadow-ahw6rnu1`) and **`eval-ab-b`** (`br-snowy-math-ahnnrwew`) — children of `eval-discovery-base`, one per A/B side, each with its own endpoint on `protocol_eval`. **A discovery run resets the branches its shape needs from the base before it spawns anything** — both for a comparison, `eval-ab-a` alone for a single configuration (`abRunningTargets`, `services/api/src/cli/discovery.main.ts`) — so they hold no data worth keeping and only one run may use them at a time. Their ids, endpoint ids and connection strings are what `DISCOVERY_TARGETS` attests; see **Discovery Eval** above.

Railway dev deployments run `db:migrate` against the `dev` branch of the Protocol project.

### Required Environment Variables

Runtime env files live at the **repo root** (`.env.development`, `.env.test`, … — gitignored); the root `.env.example` is the canonical reference. Validation happens at API boot in `services/api/src/startup.env.ts` (hard-fail on invalid, deployment warnings for commonly forgotten vars); `services/api/tests/env-example-drift.spec.ts` keeps example and schema in sync; `bun scripts/audit-railway-env.ts` diffs a Railway service against the schema.

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/protocol_db
OPENROUTER_API_KEY=your-openrouter-api-key
PORT=3001
NODE_ENV=development
```

### Optional (see the root `.env.example` for full list)

`REDIS_URL`, `RESEND_API_KEY`, `UNSTRUCTURED_API_URL`, `COMPOSIO_API_KEY`, `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`, `SENTRY_DSN`, `PARALLELS_API_KEY`, `APP_URL`

Web app: `VITE_`-prefixed vars, documented in the root `.env.example` (section 16). **Auth origin (`invalid_origin`)**: ensure app origin is in Better Auth `trustedOrigins` when developing locally.

## Testing

Always target specific test files rather than running the full suite. `bun test` in protocol is slow.

```bash
cd services/api
bun test path/to/test.ts                   # Run specific test (PREFERRED)
bun test --watch                            # Watch mode
bun test                                    # Run ALL tests (avoid unless necessary)
```

**Test locations**: `services/api/tests/` (integration/E2E), `services/api/src/lib/*/tests/` (unit tests).

**Standards**: Load env at top before imports. Import from `bun:test` (destructured). Use `describe` grouping. Set timeouts (agent: 30s, graph: 60s, LLM: 120s). Clean up in `afterAll`. Mock externals. Test success and error paths. Never commit without running affected tests.

## Database Workflow

**Schema location**: `services/api/src/schemas/database.schema.ts`. Drizzle client: `services/api/src/lib/drizzle/drizzle.ts`.

### Migration Naming

Drizzle generates random names. **Always rename** to: `{NNNN}_{action}_{target}[_{detail}].sql`

Examples: `0000_initial_schema.sql`, `0001_add_chat_session_share_token.sql`, `0003_drop_agent_wallet_columns.sql`

**After renaming**: Update `tag` in `drizzle/meta/_journal.json` to match (without `.sql`). Do not rename snapshot files.

### Schema Change Checklist

1. Edit `services/api/src/schemas/database.schema.ts`
2. `bun run db:generate`
3. Rename the `.sql` file and update `_journal.json` tag
4. `bun run db:migrate`
5. Verify: `bun run db:generate` should report "No schema changes"

### Migration Troubleshooting

Migrations break when: (1) `_journal.json` and `.sql` files diverge, (2) SQL applied outside Drizzle without updating `__drizzle_migrations`, (3) pgvector `CREATE EXTENSION vector` missing from first migration. Always use `bun run db:migrate`.

**Fix corrupted local migrations**: `bun run maintenance:fix-migrations`
**Reset remote DB**: `bun run maintenance:reset-remote-db -- --confirm && bun run db:migrate`

## Code Style & Practices

### TypeScript

- Strict mode. No `any` -- use `unknown` and narrow. ESLint enforces `@typescript-eslint/no-explicit-any`.
- Zod schemas for all agent I/O. Prefer Drizzle type inference over manual types.
- Canonical schema in `src/schemas/database.schema.ts` -- import from there, not `lib/schema`.
- Prefer soft deletes (`deletedAt`) over hard deletes.

### File Naming Convention

Pattern: `{domain}.{purpose}.ts` (e.g. `chat.graph.ts`, `intent.inferrer.ts`, `opportunity.evaluator.ts`)

Common purposes: `.graph`, `.state`, `.agent`, `.generator`, `.evaluator`, `.verifier`, `.inferrer`, `.reconciler`, `.controller`, `.service`, `.queue`, `.spec`

**Adapters**: Name by concept, not tech: `database.adapter.ts` (not `drizzle.adapter.ts`), `cache.adapter.ts` (not `redis.adapter.ts`).

**Exceptions**: `index.ts`, `schema.ts`, `main.ts`, root-level utility files (`constants.ts`, `types.ts`).

### Import Ordering

External packages -> Deep relative imports (`../../+`) -> Nearby relative (`./`, `../`). Separated by blank lines.

### TSDoc

TSDoc on all classes (summary) and public methods (`@param`, `@returns`, `@throws`).

### Layer-Specific Rules

- **Agents**: Use `createModel()` from `model.config.ts`. Keep pure -- no direct DB access.
- **Services**: Handle persistence, emit events. Must not import other services.
- **Controllers**: Delegate to services/graphs. Must not import adapters. Use guards for auth.

## Git Workflow

### Worktrees

**Always use worktrees** for features and fixes. Keep the canonical root on `dev` and
read-only for source mutations. Worktrees live in `.worktrees/` (gitignored). Branches
use semantic `<type>/<description>` names and the only valid folder is the dashed form
`<type>-<description>`; never accept a separate folder name.

Follow `create-worktree` and `run-worktree-session` to create or reuse one semantic
branch and run mandatory setup with `bun run worktree:setup <dashed-folder>`.

Keep one writer per worktree, reuse the same worktree for review and PR-closeout fixes,
and independently verify every completion claim. Never wait, poll, sleep, create
watcher processes, infer merge approval, or treat `idle`/`done` as success. Escalate
only genuine product/architecture ambiguity, destructive actions, external
infrastructure mutation, credentials/secrets, or merge approval.

### Git remote-state reconciliation

After every `git push`, fetch the pushed branch and verify the local branch has no
ahead/behind drift from its upstream (`git fetch origin <branch>` followed by
`git status --short --branch`). After `gh pr merge`, first verify the server-side
merge, then fetch the base branch; if its canonical checkout is clean, fast-forward it
with `git pull --ff-only origin <base>`. Do not continue from stale remote refs. If a
dirty checkout prevents the fast-forward, preserve its work and report the pending
reconciliation rather than merging or resetting over it.

Parallel implementation uses separate semantic branches and Git worktrees, with one
writer per worktree. Reuse the same worktree for review and PR-closeout fix loops.

### Conventional Commits

Format: `<type>[scope]: <description>`. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`. Breaking changes: `BREAKING CHANGE:` in footer or `!` after type.

### Conventional Branches

Format: `<type>/<short-description>`. No Linear issue IDs. Examples: `feat/user-authentication`, `fix/login-redirect-loop`.

### Pull Requests

Use `gh` CLI to create PRs into `origin/dev`. Description as changelog: New Features, Bug Fixes, Refactors, Documentation, Tests.

### Finishing a Branch

1. Update all relevant documentation (see **Documentation Directories** above for what belongs where):
   - `AGENTS.md` — if agent workflow or repository-wide agent guidance changes
   - this reference — if development workflow, architecture, or operational policy changes
   - `README.md` files — any affected package READMEs
   - `docs/design/` — if architecture or data flow changed
   - `docs/domain/` — if the domain model changed (entities, relationships, concepts)
   - `docs/specs/` — if public interfaces changed (API endpoints, CLI commands)
   - `docs/guides/` — if dev workflow or environment setup changed
2. Delete any related superpowers plans/specs from `docs/superpowers/plans/` and `docs/superpowers/specs/`.
3. **Bump package versions** for every package touched by the branch, following [Semantic Versioning 2.0.0](https://semver.org/), before merging or pushing. `feat` is a minor bump, `fix` is a patch bump, and breaking changes are a major bump (minor before 1.0). Apply this to each touched package: `packages/protocol/`, `packages/cli/`, `services/api/`, and `apps/web/`; regenerate and commit the root `bun.lock` when a package version changes.
4. Finish the PR through `manage-pr`:
   - Snapshot the actual PR with `bun run pr:snapshot -- <number|URL|branch>`, inspect related issues and matching worktree state, and verify base freshness against the actual base/head refs.
   - Resolve every blocking review thread, run targeted checks for changed surfaces, and require all required GitHub checks/reviews to be green. For environment changes, explain every variable and verify its committed schema/example, local development state, and applicable Railway service state before any mutation.
   - Obtain a separate, explicit merge authorization only after every gate passes. Merge server-side from a non-canonical coordinator checkout; never check out or merge `dev` in a feature worktree, and never mutate source from the canonical root.
   - Confirm the forge merge, wait for required post-merge checks and terminal Railway deployment success before claiming release health or closing related issues, then update issues and clean up the finished worktree only after preservation checks.
   - For a squash-merged `dev`→`main` release, after main-branch checks pass, follow [squash-release reconciliation](../../.agents/skills/_shared/squash-release-reconciliation.md): prove the `main` and `dev` trees match and the merge simulation is clean, then have the root coordinator create and push the sanctioned no-content merge from `main` back into `dev` and wait for its `dev` workflows. Stop rather than force it when either check fails.
5. If the canonical `dev` checkout is clean, synchronize it only with `git pull --ff-only origin dev`; otherwise preserve its work and report pending reconciliation.
6. If an npm-published subtree package was updated (`packages/cli/` or `packages/protocol/`): bump its base version before promoting to `main`. Subtree pushes to `dev` publish `-rc` prereleases under the `rc` npm tag, and subtree pushes to `main` publish the stable version when it is not already on npm.
7. Clean up only after merge and preservation checks. Remove the Git worktree and branch from another checkout.

## Superpowers Workflow

### Implementation in Git Worktrees

Execute implementation and fix plans in isolated Git worktrees, following
`create-worktree` and `run-worktree-session`.
Keep `dev` stable, never use hidden implementation subagents, and preserve one writer
per checkout.

### Receiving Code Review

**There is no automated reviewer on this project.** No bot reviews a PR on push, and
none is triggered by opening one. Unless a human is explicitly asked to look, a PR
arrives at merge time with nothing but its checks behind it.

That has one consequence worth stating outright, because it is easy to drift into: a
green PR is an *unreviewed* PR. Checks prove the suite passes, not that the change is
correct, well-scoped, or wanted. When handing work over, say which it is — "green, not
reviewed" — rather than letting green imply more than it does. `dev` is unprotected, so
nothing else will catch the difference.

When review comments *do* get opened, by a human or anything else:

1. **Fetch the threads**: `gh api` lists review comments on the PR; work through the
   unresolved ones.
2. **Evaluate each**: decide whether a code fix is actually needed.
   - **Fix needed**: implement it, push, then resolve the conversation. Pushing a commit
     does not resolve a thread on its own.
   - **No fix needed**: reply inline with the technical reasoning for why the current
     code is right (YAGNI, missing context, conflicts with an existing pattern), then
     resolve it.
3. **Resolve everything before merge**: an unresolved thread is an open question, and
   merging over it silently discards the question rather than answering it.

**Key commands:**
```bash
# List PR review comments (filter for unresolved)
gh api repos/{owner}/{repo}/pulls/{pr}/comments

# Reply to a specific review comment thread (USE THIS — not gh pr comment)
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies -f body="..."

# Ask a human for review
gh pr edit PR-NUMBER --add-reviewer USERNAME
```

## Session Learning Capture

When wrapping up a session that uncovered something **reusable and non-obvious** — a
workflow, a fix for a recurring failure, an exact command sequence, an environment
gotcha, or a convention — run the `learn-skill` skill to persist it before ending.

- `learn-skill` writes to the project-local `.agents/skills/` and **never edits
  protected/home skills in place** (it migrates them local first, then updates the copy).
- It is configurable via `.agents/skills/learn-skill/config.json` (target, protected
  locations, dedup/cross-link features, and rpiv integrations: todo,
  ask-user-question, args, advisor).
- Use `.agents/skills/create-skill` for the mechanics of writing a correct `SKILL.md`.
- Skip silently when nothing meets the "reusable and non-obvious" bar — never capture
  one-off facts.
