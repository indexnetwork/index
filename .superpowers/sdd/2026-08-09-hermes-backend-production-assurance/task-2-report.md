# Task 2 Report: Hermes real-database lifecycle and fault coverage

## Scope delivered

- Added `tests/hermes-runtime-lifecycle.database.isolated.ts` using the production authorization, authentication, runtime, connected-agent, and mutation-authority APIs against PostgreSQL.
- Added state/advisory-lock evidence for same-owner rotation versus disconnect and different-owner non-interference.
- Added dedicated `idxh_` coverage for pending denial, rotation denial, exact-row mismatch, PostgreSQL-boundary expiry, disconnect revocation, single selected/live generation, and active/stale/expired Index-covering views.
- Strengthened every `HERMES_RESPONSE_ATOMIC_STEPS` fault case with a real continuation and explicit rollback assertions for capability, task, message/session, artifact, opportunity, continuation, receipt, and outbox effects.
- Added same-capability retry/replay assertions for a single committed receipt/outbox and an unchanged first absolute continuation deadline.
- Added a fresh-Bun-process assurance wrapper, registered both exact database targets in `.test-isolated`, and updated the package contract without injecting `API_TEST_DATABASE_READY` or replacing inherited `API_TEST_REQUIRE_DATABASE` semantics.
- No production adapters changed; static analysis and provider-free validation did not demonstrate a production behavior gap.

## TDD evidence

The initial focused contract run failed for the intended missing behavior:

```text
bun test src/lib/drizzle/tests/test-database-readiness.spec.ts src/lib/testing/tests/isolated-test-suite.spec.ts
2 tests failed, 38 passed
- expected package script to use the missing fresh-process wrapper
- lifecycle suite file was absent
```

After adding the runner, inventory entry, and lifecycle suite, the same contract tests passed (`40 pass, 0 fail`).

## Provider-free validation

Run from `services/api` unless noted:

| Command | Result |
| --- | --- |
| `bun test src/lib/drizzle/tests/test-database-readiness.spec.ts src/lib/testing/tests/isolated-test-suite.spec.ts src/controllers/tests/hermes-authorization.controller.spec.ts src/controllers/tests/agent-runtime.controller.spec.ts src/controllers/tests/connected-agents.controller.spec.ts src/services/tests/connected-agents.service.spec.ts src/services/tests/negotiation-polling.fixture-contract.spec.ts` | PASS — 89 tests, 330 assertions, 0 failures |
| `bunx eslint tests/hermes-runtime-lifecycle.database.isolated.ts tests/negotiation-runtime-authority.database.isolated.ts` | PASS — no findings |
| `bash -n scripts/test-hermes-production-assurance.sh` | PASS |
| `bun x tsc --noEmit` | PASS |
| `bun run typecheck:cli-specs` | PASS |
| `bun run build` | PASS |
| `bun run lint` | PASS — 0 errors; 46 existing warnings outside this Task 2 diff |
| `git diff --check` (repository root) | PASS |

No provider credentials were configured or used.

## Pending real-PostgreSQL CI gate

Local Docker/PostgreSQL was unavailable. The two database suites were therefore **not** claimed as locally passed. CI must run migrations and the exact wrapper against the dedicated disposable database:

```bash
cd services/api
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance \
TEST_DATABASE_SAFE=1 bun run db:migrate:test
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance \
TEST_DATABASE_SAFE=1 API_TEST_REQUIRE_DATABASE=1 \
bun run test:hermes-production-assurance
```

The wrapper starts one fresh Bun process per exact target and lets each child execute guarded readiness. It never sets `API_TEST_DATABASE_READY` directly.

## Residual risk

- The new PostgreSQL concurrency, expiry-boundary, generation, and atomic-fault assertions are compile-checked and source-contract checked locally but await execution by the dedicated PostgreSQL CI service.
- No merge, push, deployment, migration execution, or production mutation was performed.

## CI parser follow-up (run 31486652274)

The first CI attempt stopped before database readiness because Bun rejected `await` in two async default-parameter initializers in the lifecycle fixture. TypeScript compilation had accepted the source, so the provider-free checks did not exercise Bun's runtime parser.

The follow-up:

- changed both authorization request parameters to optional values and resolved defaults inside their async function bodies;
- added a provider-free `Bun.Transpiler({ loader: 'ts' })` contract over both exact Hermes assurance targets without importing database code;
- reproduced RED with the new contract (`1 failed, 12 passed`, `AggregateError: Parse error`);
- verified GREEN with `13 passed, 0 failed` for the isolated inventory suite;
- verified the combined readiness/inventory contracts with `41 passed, 0 failed, 132 assertions`;
- verified a direct Bun parser invocation (`Bun parser: pass`), targeted ESLint, `tsc --noEmit`, the API build, and repository `git diff --check`.

The real PostgreSQL behavior gate remains pending CI; this follow-up changes test syntax and provider-free parser coverage only.

## Deep-review fix wave

All four Important findings and the Minor finding from the Task 2 deep review were addressed in one bounded wave:

1. **Same-owner ordering:** both prepare-first and disconnect-first cases now hold the owner advisory lock externally, observe the first backend waiter in `pg_locks`, observe a distinct second waiter on the same key, release the holder, assert operation-kind ordering, and verify one selected/live generation without elapsed-time inference.
2. **Dedicated authority:** the negotiation authority fixture now creates, exchanges, activates, resolves, and selects a real `idxh_` credential through `HermesAuthorizationService`. Pickup, every response fault boundary, and retry/replay use the full `hermes-agent` principal and default real `NegotiationPollingAuthorization`. The fixture asserts exact canonical actions, hash-only dedicated storage, and zero matching `apikeys` rows.
3. **Absolute deadline:** the queue seam captures every enqueue argument. A failed delivery leaves a pending outbox, the fixture clock advances by 60 seconds without sleeping, pickup repairs delivery with `max(0, deadlineAt - controlledNow)`, and the persisted deadline remains unchanged. Repeated pickup uses an explicitly persisted park origin. Existing provider-free clock injection tests cover remaining and elapsed deadlines.
4. **Credential-free evidence:** dedicated denials now log only a stable reason. The runner uses a parent-owned test-only quiet marker, captures child output, emits only stable success lines, sanitizes failure diagnostics, and preserves the child exit status. Sanitizer tests cover `idxh_` values, UUID identities, labeled/unlabeled hashes, stack locations, and failure summaries.
5. **Cleanup:** both database suites aggregate cleanup failures, explicitly remove tracked authorization requests, tag fixture users/networks per process, verify zero tagged/tracked rows remain, and throw `AggregateError` instead of silently accepting deletion failures.

TDD RED evidence:

- the first source/output contract run failed with three unmet contracts plus the missing sanitizer module;
- the test-environment contract failed until the quiet marker became parent-owned and reserved.

Provider-free GREEN evidence:

- focused auth, environment, readiness, inventory, and output contracts: `79 passed, 0 failed, 364 assertions`;
- isolated polling clock/deadline contract under quiet mode: `10 passed, 0 failed, 29 assertions`;
- both database target sources parse through `Bun.Transpiler`;
- targeted ESLint, shell syntax, API build, `tsc --noEmit`, CLI-spec typecheck, and `git diff --check` pass;
- package lint reports zero errors and the same 46 pre-existing warnings outside this diff.

A typecheck launched concurrently with the protocol build briefly observed the protocol `dist` directory while it was being replaced and reported missing exports. The required sequential rerun after the build completed passed. Real PostgreSQL execution remains the pending CI gate; no local database pass is claimed.

## PostgreSQL waiter-query follow-up (run 31488979512)

The next dedicated CI run reached PostgreSQL and proved that the lifecycle fixture's waiter query was invalid: it selected `DISTINCT waiter.pid` while ordering by `waiter.waitstart, waiter.pid`, producing PostgreSQL `42P10` in all three lock-order tests. The two non-lock lifecycle tests passed before the wrapper stopped.

The bounded fix adds `waiter.waitstart AS waitstart` to the distinct select list while retaining deterministic `waitstart` then PID ordering and the existing returned PID evidence. A provider-free raw-SQL source contract now freezes the valid select/order shape and rejects the exact invalid select form from the CI log.

TDD and focused validation:

- RED: isolated inventory contract `13 passed, 1 failed`; it exposed the missing `waitstart` projection.
- GREEN: isolated inventory contract `14 passed, 0 failed, 51 assertions`.
- Targeted ESLint, Bun parsing of the lifecycle target, `tsc --noEmit`, and `git diff --check` pass.

No production code, readiness guard, credential behavior, or runner semantics changed. The three real PostgreSQL lock-order tests require a dedicated CI rerun; no local database pass is claimed.

## Legacy-table schema follow-up (run 31489362277)

The subsequent CI run passed the complete lifecycle suite and reached all 49 authority tests. Each authority fixture failed during its dedicated-hash isolation assertion because the raw query referenced nonexistent relation `apikeys`; the Drizzle schema maps `schema.apikeys` to physical table `apikey`. PostgreSQL reported `42P01` before any authority behavior assertion ran.

The bounded fix replaces that raw count with a schema-aware Drizzle select from `schema.apikeys`, filtered by `schema.apikeys.key`, and asserts the result has zero rows. This preserves the intended proof that a dedicated credential hash never appears in the legacy credential store while removing the duplicated physical table name. A provider-free schema contract verifies `getTableName(apikeys) === 'apikey'`, requires the fixture to use `.from(schema.apikeys)`, and rejects the CI's raw `FROM apikeys` form.

TDD and focused validation:

- RED: isolated inventory contract `13 passed, 1 failed`; the schema-aware fixture query was absent.
- GREEN: isolated inventory contract `14 passed, 0 failed, 54 assertions`.
- Targeted ESLint, Bun parsing of both assurance targets, `tsc --noEmit`, and `git diff --check` pass.

No production code, schema, migration, readiness guard, credential behavior, or runner semantics changed. The real authority suite requires a dedicated CI rerun; no local database pass is claimed.

## Deadline parameter and cleanup-order follow-up (run 31489779852)

The next CI run passed the lifecycle suite and 48 of 49 authority behavior tests. The repeated-deadline fixture failed with PostgreSQL `42P18` because its ISO timestamp parameter was untyped inside `jsonb_build_object`. The fail-visible `afterAll` then correctly exposed FK-unsafe cleanup: tracked networks and users were deleted while tracked `network_members`, `intent_networks`, and intents still referenced them, and the final zero-leak check also failed.

The bounded fixture correction:

- applies the repository's explicit text-parameter SQL pattern, `${value}::text`, to the controlled park-origin JSONB value;
- adds a provider-free rendered SQL assertion proving the fragment becomes `$1::text`;
- tracks the exact inserted intent IDs;
- deletes tracked `intent_networks`, `network_members`, and intents before networks and users;
- retains per-operation error capture, final `AggregateError`, and the tagged parent-row check while extending zero-leak verification to every tracked dependent table.

TDD and focused validation:

- RED: isolated inventory contract `13 passed, 1 failed`; the explicit text cast was absent, before the same contract could reach the missing cleanup-order assertions.
- GREEN: isolated inventory contract `14 passed, 0 failed, 65 assertions`.
- Targeted ESLint, rendered PostgreSQL SQL-shape coverage, Bun parsing of both assurance targets, `tsc --noEmit`, and `git diff --check` pass.

No production code, schema, migration, readiness guard, credential behavior, or runner semantics changed. The real authority suite and fail-visible cleanup require a dedicated CI rerun; no local database pass is claimed.

## Deterministic pickup row-lock follow-up (run 31503086936)

The continuation pickup race is now forced with the exact task row locked in a dedicated transaction. The test starts the non-speaker poll, proves its active lock wait through `pg_blocking_pids` and `pg_stat_activity`, then starts and proves the distinct eligible waiter before releasing the holder. It asserts the non-speaker remains null with a stale heartbeat, the counterparty claims, and only the counterparty heartbeat advances. A second multiple-task contention case locks the deterministically older eligible row, commits a competing claim, and proves PostgreSQL re-evaluation continues to and claims the newer eligible task rather than stranding it.

The eligible selection now uses ordinary `FOR UPDATE`; the non-speaker fallback remains blocking. This removes the `SKIP LOCKED` path that let the eligible poll skip into the fallback behind a non-speaker and return a second conflict. No sleep is used as synchronization; short polling is cadence only and PostgreSQL's blocking graph is the barrier evidence.

The database tests were not run locally because no dedicated disposable `DATABASE_URL` was proven, and `TEST_DATABASE_SAFE` was not set. Provider-free targeted ESLint and the API build passed. A standalone compilation of the database target reached only the suite's documented pre-existing type errors and reported no new error in the added helpers/tests. Dedicated PostgreSQL CI must execute both new cases.
