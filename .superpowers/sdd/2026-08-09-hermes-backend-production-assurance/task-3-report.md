# Task 3 report — fail-closed Hermes migration preflight

## Delivered

- Added the typed count/duration-only preflight contract, explicit CLI argument parser, read-only PostgreSQL implementation, and `maintenance:hermes-preflight` package script.
- Confirmed the legacy `apikey.metadata` storage is `text` in `database.schema.ts` and migration `0098_complete_apikey_schema.sql`; the SQL uses `pg_input_is_valid(metadata, 'jsonb')` before the sole guarded `metadata::jsonb` cast.
- Added state/action/binding and exact 30-day expiry checks, duplicate selected-executor detection, and exact named index/constraint catalog validation including validity/readiness.
- Added a guarded disposable-PostgreSQL suite with a set-based 100,000-row synthetic non-secret fixture, clean and malformed/state/action/expiry/duplicate/missing-index cases, explicit 5,000 ms lock and 30,000 ms total thresholds, and restoration in `finally`/cleanup paths.
- Registered the isolated suite and added it plus an explicit-threshold JSON CLI invocation to the fresh-process Hermes assurance wrapper.

## TDD and validation

- RED: `cd services/api && bun test src/cli/tests/hermes-migration-preflight.spec.ts` failed because the contract module did not exist.
- GREEN: focused pure/readiness/inventory run passed 54 tests and 195 expectations.
- `cd services/api && bun run build` passed.
- `cd services/api && bun run typecheck:cli-specs` passed.
- `cd services/api && bun run lint` passed with 46 existing warnings and zero errors.
- Bun parse-contract check passed for all five new TypeScript files.
- `git diff --check` passed.

The real database suite was not run locally because no proven disposable `DATABASE_URL` or `TEST_DATABASE_SAFE=1` marker is present. It remains intentionally pending the dedicated PostgreSQL CI job; no database or production mutation was attempted.

## Review

Focused self-review found no blockers after fixing two issues: dirty preflights now emit their sanitized count-only JSON before failing, and report formatting reconstructs the exact seven-field shape so extra runtime fields cannot escape. Residual risk is PostgreSQL catalog-expression/runtime verification in the real PostgreSQL 16 CI service.

## PostgreSQL CI fixture-array follow-up

CI run `31492184977` reached the disposable PostgreSQL 16 suite and exposed a fixture-only SQL rendering error: interpolating `HERMES_CANONICAL_ACTIONS` directly into a raw Drizzle SQL template rendered `($7, ... $12)`, a PostgreSQL record rather than `text[]`. All four `hermes_agent_credentials` fixture inserts now use `db.insert(schema.hermesAgentCredentials).values(...)`, so the schema-aware PostgreSQL driver binds both the full canonical action arrays and the sliced invalid-actions array as `text[]`.

A provider-free rendered-SQL regression uses `drizzle.mock()` to prove both full and sliced actions compile to one PostgreSQL array parameter, while a source regression asserts all four fixture sites use the typed Drizzle insert and rejects direct SQL-template interpolation. The test was observed RED against the CI-failing implementation, then passed with 14 tests and 39 expectations. Focused ESLint and Bun parse checks also passed. The real disposable-PostgreSQL rerun remains pending CI; no local database or production mutation was attempted.

## Deep-review remediation wave

All five Important and both Minor findings from the Task 3 deep review were addressed in one bounded wave:

- Explicit positive CLI thresholds now flow into the database runner. Its first transaction command establishes `REPEATABLE READ, READ ONLY`, followed by transaction-local `lock_timeout` and `statement_timeout`. A shrinking per-query statement deadline bounds the lock acquisition/full-check hold window, and `lockDurationMs` measures that full interval.
- Catalog and data counts share one snapshot. The disposable suite uses two dedicated PostgreSQL sessions and mutates expiry after the snapshot is established, proving the in-flight report remains internally consistent while the next report sees the committed change.
- Pending/active bindings require active agents. Permissions are checked as exact global owner/action authority: pending has none, active has exactly one canonical row and no extras, and revoked authority is rejected unless a current active peer explains it. The suite covers inactive agents, missing/wrong-owner/wrong-action active authority, pending/revoked leaks, and a correctly authorized expired active credential.
- TTL comparison is fixed at `2,592,000` epoch seconds. A dedicated `America/Los_Angeles` session verifies a 720-hour credential crossing the spring DST boundary.
- Index validation compares normalized complete `pg_get_indexdef()` output and complete constraint definitions. A same-name `issued_at DESC` replacement for the expiry index fails closed.
- The fixture now seeds 100,000 pre-runtime-binding agents, transactionally drops/replays the relevant 0119 de-duplication/index DDL under explicit timeouts, records its duration, and rolls it back. Outermost cleanup independently aggregates data/schema restoration failures, recreates every disturbed object exactly, and verifies definitions before returning or throwing.
- Legacy metadata classification now accepts every syntactically valid JSON value, including arrays, strings, numbers, and JSON null; malformed text alone is counted and no cast is needed.

TDD RED reproduced four pure contract failures before implementation. Final provider-free focused validation passed 58 tests / 214 expectations, API/protocol build, CLI-spec typecheck, parse checks, and lint with zero errors (46 existing warnings). Real PostgreSQL execution remains pending the guarded CI rerun; no local database or production mutation was attempted.
