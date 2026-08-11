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
