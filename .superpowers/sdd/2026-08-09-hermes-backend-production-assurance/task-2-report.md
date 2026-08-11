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
