# Task 6 — Hermes emergency pause and bulk revocation

## Result

Implemented the dry-run-first `maintenance:hermes-emergency-control` command and the requested `planEmergencyControl` / `executeEmergencyControl` APIs. The command accepts only the exact `hermes-agent` audience. Confirmed execution requires `--confirm`, an opaque exact `hecp_…` plan ID, and the exact expected installation count.

Plans are deterministic count-only projections over the exact actionable installation, live dedicated credential, and Hermes negotiation-permission snapshot. The SHA-256 plan digest is domain/version/audience bound and is returned only as an opaque plan ID; owner, agent, installation, generation, permission, credential, credential-hash, and database values never leave the digest boundary. Command output is reconstructed into a fixed schema containing only counts, stable reasons, durations, audience, and opaque plan/receipt IDs.

Confirmed execution is one transaction. It serializes the exact plan, obtains affected owners' existing `agent-runtime:<owner>` advisory locks in deterministic order, obtains fixed write-excluding table locks to close the new-owner insertion window, and re-reads/revalidates the complete snapshot under those locks before mutation. It then:

- makes every actionable dedicated Hermes installation inactive, deselected, and generation-fenced (`runtime_setup_attempt_id = NULL`), returning runtime authority to Index;
- revokes every pending/active exact-audience dedicated credential;
- removes only `manage:negotiations` from Hermes permission arrays and deletes only rows made empty by that removal;
- preserves unrelated permission actions, non-Hermes permissions, personal/other agents, and other application data; and
- inserts exactly one credential-free receipt in the same transaction.

A plan/count mismatch throws before mutation; locked snapshot drift rolls the transaction back. The receipt primary key is the plan ID. An exact second or concurrent rerun returns the stable receipt ID with zero mutation/audit counts and `already-executed`; it does not create another receipt.

## Audit schema

Added generated migration `0122_add_hermes_emergency_receipts` and Drizzle metadata. The minimal table contains only:

- opaque primary-key plan ID;
- exact checked audience and checked `executed` result reason;
- integer plan/mutation counts with non-negative/bounded checks; and
- `created_at`.

It has no owner, agent, installation, credential, hash, raw snapshot, database URL, or free-text error fields.

## TDD evidence

Initial provider-free RED:

```text
bun test src/cli/tests/hermes-emergency-control.spec.ts
0 pass, 1 fail, 1 module error
Cannot find module '../hermes-emergency-control.contract'
```

After implementation, focused GREEN:

```text
bun test src/cli/tests/hermes-emergency-control.spec.ts src/lib/testing/tests/isolated-test-suite.spec.ts
24 pass, 0 fail, 137 expectations
```

The pure suite covers deterministic order-independent plans, plan drift binding, count-only formatting, exact audience refusal (generic, legacy, negotiator, index-owner, unknown), dry-run default, confirmation triples, pre-database refusal, generated receipt schema/migration shape, package/inventory registration, and PostgreSQL-dialect rendering of scalar advisory-lock and permission-action bindings.

## Guarded PostgreSQL suite

Added `src/lib/drizzle/tests/hermes-emergency-control.database.isolated.ts`. It fails closed unless both `TEST_DATABASE_SAFE=1` and the parsed database name is exactly `hermes_assurance`. It covers:

- mismatch without mutation;
- exact revocation/disconnection/Index selection and generation fencing;
- unrelated permission/action and agent preservation;
- plan drift rollback;
- exact rerun idempotency and one stable receipt;
- concurrent execution serialization without double count/audit; and
- FK-safe, independently attempted, leak-verified cleanup with visible `AggregateError` failure.

The target was registered in `.test-isolated` and its real Bun source bundle/parse check passed. Per task instruction, the database suite was **not run locally**: no database command was invoked and `TEST_DATABASE_SAFE` was never set. Dedicated disposable PostgreSQL CI owns execution:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance \
TEST_DATABASE_SAFE=1 API_TEST_REQUIRE_DATABASE=1 \
API_TEST_ISOLATED_TARGET=src/lib/drizzle/tests/hermes-emergency-control.database.isolated.ts \
bun test src/lib/testing/isolated-test-import-harness.spec.ts
```

## Files changed

- `services/api/src/cli/hermes-emergency-control.contract.ts`
- `services/api/src/cli/hermes-emergency-control.main.ts`
- `services/api/src/cli/hermes-emergency-control.ts`
- `services/api/src/cli/tests/hermes-emergency-control.spec.ts`
- `services/api/src/lib/drizzle/tests/hermes-emergency-control.database.isolated.ts`
- `services/api/src/schemas/database.schema.ts`
- `services/api/drizzle/0122_add_hermes_emergency_receipts.sql`
- `services/api/drizzle/meta/0122_snapshot.json`
- `services/api/drizzle/meta/_journal.json`
- `services/api/package.json`
- `services/api/.test-isolated`
- `.superpowers/sdd/2026-08-09-hermes-backend-production-assurance/task-6-report.md`

## Provider-free validation

- Focused pure + isolated inventory tests: PASS — 24 tests, 137 expectations.
- Direct `tsc --noEmit`: PASS.
- Database target Bun bundle/parse: PASS.
- Focused ESLint including schema and database fixture: PASS, no findings.
- API/protocol build: PASS.
- CLI-spec typecheck: PASS.
- Full API lint: PASS with 0 errors and 46 pre-existing warnings outside Task 6.
- Drizzle generation drift check: PASS — `No schema changes, nothing to migrate`.
- Invalid generic-audience CLI with database/provider environment unset: PASS — exit 1, empty stdout, exact stable refusal, and no database initialization error.
- `git diff --check`: PASS.

## Residual risk

The generated migration and real transaction/concurrency/cleanup suite require the dedicated PostgreSQL 16 CI run. No local database result is claimed. No push, deployment, or production mutation was performed.
