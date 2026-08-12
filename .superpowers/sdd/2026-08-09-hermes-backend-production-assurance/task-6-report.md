# Task 6 — Hermes emergency pause and bulk revocation

## Result

Implemented the dry-run-first `maintenance:hermes-emergency-control` command and the requested `planEmergencyControl` / `executeEmergencyControl` APIs. The command accepts only the exact `hermes-agent` audience. Confirmed execution requires `--confirm`, an opaque exact `hecp_…` plan ID, and the exact expected installation count.

Plans are deterministic count-only projections over the exact actionable installation, live dedicated credential, and Hermes negotiation-permission snapshot. The SHA-256 plan digest is domain/version/audience bound and is returned only as an opaque plan ID. Its internal credential projection intentionally excludes `secret_hash`: it binds credential row identity plus the mutation-relevant owner, agent, installation, generation, activation state, and actions. No opaque output is secret- or credential-hash-derived. Owner, agent, installation, generation, permission, credential, database, and raw snapshot values are never emitted. Command output is reconstructed into a fixed schema containing only counts, stable reasons, durations, audience, and opaque plan/receipt IDs.

Confirmed execution is one transaction. It serializes the exact plan, obtains affected owners' existing `agent-runtime:<owner>` advisory locks in deterministic order, obtains fixed write-excluding table locks to close the new-owner insertion window, and re-reads/revalidates the complete snapshot under those locks before mutation. It then:

- makes every actionable dedicated Hermes installation inactive, deselected, and generation-fenced (`runtime_setup_attempt_id = NULL`), returning runtime authority to Index;
- revokes every pending/active exact-audience dedicated credential;
- removes only `manage:negotiations` from permission IDs captured by the locked snapshot, first deleting only targeted rows made empty by that exact removal and then updating the surviving targets;
- preserves unrelated permission actions, non-Hermes permissions, personal/other agents, and other application data; and
- inserts exactly one credential-free receipt in the same transaction.

A plan/count mismatch throws before mutation; locked snapshot drift rolls the transaction back. Returned agent, credential, and combined permission mutation counts are checked against the locked plan before the receipt can be inserted. The receipt primary key is the plan ID. An exact second or concurrent rerun returns the stable receipt ID with zero mutation/audit counts and `already-executed`; it does not create another receipt.

## Review remediation

All findings from `.pi-subagents/artifacts/e5b6b8fb_reviewer_0_output.md` are addressed:

- **Important permission over-delete:** removed the broad post-update empty-row delete. The locked permission IDs are scalar-bound in deterministic order; only those IDs can be deleted when the exact action removal makes them empty, and only surviving target IDs are updated. Pre-existing empty and unrelated rows are untouched.
- **Minor count parsing:** `--expected-installations` now requires `^(0|[1-9][0-9]*)$` before conversion and then `Number.isSafeInteger`; whitespace, signs, hex, exponent, decimal, leading-zero, `NaN`, and `Infinity` forms fail before the lazy database callback.
- **Minor report accuracy:** clarified above that credential hashes are intentionally absent and that credential identity plus mutation-relevant fields bind the plan.
- **Omitted adversarial DB cases:** added inactive/revoked, permission-shape, same-plan concurrency, plan-versus-execute, insertion/deletion drift, stale/current plan, and injected post-mutation rollback cases. Hooks are exposed only through explicitly test-named wrappers that refuse unless `NODE_ENV=test`; the production APIs and CLI retain their original signatures and accept no hook input.

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
26 pass, 0 fail, 190 expectations
```

The pure suite covers deterministic order-independent plans, credential identity/mutation-field binding without credential hashes, plan drift binding, count-only formatting, exact audience refusal (generic, legacy, negotiator, index-owner, unknown), dry-run default, strict canonical decimal confirmation counts before database initialization, confirmation triples, generated receipt schema/migration shape, package/inventory registration, test-hook non-exposure from the CLI, and PostgreSQL-dialect rendering of scalar advisory-lock and snapshot-ID-bound permission delete/update statements.

Review-remediation RED was observed before the snapshot-target mutation API existed:

```text
bun test src/cli/tests/hermes-emergency-control.spec.ts
0 pass, 1 fail, 1 module error
Export named 'emergencyEmptyTargetPermissionDeleteQuery' not found
```

The first rendered-SQL GREEN attempt then exposed deterministic target sorting (`permission-a`, `permission-b`) versus the deliberately reversed test input; updating the expectation to the sorted scalar-binding contract produced the final 12-test / 124-expectation pure GREEN. The guarded database cases were written and compile/parse checked but intentionally not executed locally.

## Guarded PostgreSQL suite

Added `src/lib/drizzle/tests/hermes-emergency-control.database.isolated.ts`. It fails closed unless both `TEST_DATABASE_SAFE=1` and the parsed database name is exactly `hermes_assurance`. It covers:

- mismatch without mutation;
- exact revocation/disconnection/Index selection and generation fencing;
- canonical, mixed, action-only, multiple, unrelated-only, and pre-existing empty permission rows, proving only locked-snapshot targets mutate and every mutation is counted;
- already inactive installations and already revoked credentials remaining unchanged and uncounted;
- exact rerun idempotency and one stable receipt;
- concurrent same-plan execution serialization without double count/audit;
- concurrent plan-versus-execute behavior with stable old receipt semantics and a distinct current no-op plan;
- permission insertion and deletion committed between preliminary planning and owner/table locking, both rejected as drift without partial emergency mutation;
- stale-plan refusal followed by current-plan acceptance;
- a test-only callback fault after all mutations but before receipt insertion, proving full transaction rollback;
- the fault/concurrency seam being callable only through direct test dependencies, with no CLI argument or production-environment input; and
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

- Focused pure + isolated inventory tests: PASS — 26 tests, 190 expectations.
- Direct `tsc --noEmit`: PASS.
- Standalone typecheck of the guarded database target: PASS.
- Database target Bun bundle/parse: PASS.
- Focused ESLint including schema and database fixture: PASS, no findings.
- API/protocol build: PASS.
- CLI-spec typecheck: PASS.
- Full API lint: PASS with 0 errors and 46 pre-existing warnings outside Task 6.
- Drizzle generation drift check: PASS — `No schema changes, nothing to migrate`.
- Invalid generic-audience CLI with database/provider environment unset: PASS — exit 1, empty stdout, exact stable refusal, and no database initialization error.
- Noncanonical `0x10` expected-installations CLI with database/provider environment unset: PASS — exit 1, empty stdout, fixed safe failure, and no database initialization error.
- `git diff --check`: PASS.

## Residual risk

The generated migration and real transaction/concurrency/cleanup suite require the dedicated PostgreSQL 16 CI run. No local database result is claimed. No push, deployment, or production mutation was performed.
