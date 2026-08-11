# Task 7 — final CI gates, runbooks, and release evidence

## Result

Implemented the final Hermes backend production-assurance release gate and operator documentation at the reviewed Task 6 head.

The workflow now:

- builds the API/protocol, runs API typecheck, CLI-spec typecheck, API lint, static isolated inventory/release contracts, and a named provider-free stale/expired `indexCovering: true` smoke;
- explicitly migrates only the disposable PostgreSQL 16 `hermes_assurance` service and scopes the fail-closed marker/readiness request to database operations;
- executes migration-preflight (including the 100,000-row migration fixture), real aggregate expiry telemetry, lifecycle, negotiation authority/fault, and emergency concurrency/rollback suites in separate fresh Bun processes;
- requires release-approved lock/total preflight inputs for protected dispatch, while labeling PR values as non-production fixture thresholds;
- runs emergency control in dry-run mode only, validates its fixed count-only plan in a temporary file, and never invokes `--confirm`;
- preserves the real approved rollback-base denial on PRs and the immutable release-ops digest gate in the GitHub `production` environment without a skip/continue-on-error path; and
- uploads one aggregate credential-free assurance artifact containing fixed gate names, thresholds, and the sanitized preflight report. Existing fixed-schema previous-API diagnostic/success reports remain the only other uploaded evidence; no raw logs or broad artifact globs were added.

Added a guarded real-PostgreSQL telemetry aggregate fixture that seeds active near-expiry, active expired, active outside-window, pending, and revoked rows and proves the production adapter counts only the two authoritative active classes. It requires both `TEST_DATABASE_SAFE=1` and the exact `hermes_assurance` database and performs FK-safe, independently attempted, leak-verified cleanup.

Created the rollout and emergency rollback runbooks. Rollout is server before client and covers operator-supplied thresholds/digest, separate migration/mutation authorization, the exact prepare → select → pickup → respond → consult → Index → reselect → disconnect smoke, dashboards/alerts, seven-day expiry, expired fallback, pending outbox, and credential-free evidence. Rollback is forward-fix-first and strictly pause → bulk revoke → verify zero active/live dedicated credentials and zero selected Hermes → restore the approved older immutable binary. It includes dry-run/confirm commands, opaque plan-ID handling, canonical decimal count validation, idempotency, `hermes_assurance` test safety, and explicit language that the document does not authorize production execution.

API metadata moved exactly from 0.79.0 to 0.80.0 in `services/api/package.json` and root `bun.lock`; no other package version changed. The API changelog and development reference record the assurance contract.

## TDD evidence

Initial provider-free RED:

```text
bun test src/cli/tests/hermes-production-assurance-release.spec.ts
0 pass, 6 fail
```

Failures covered the missing full suite list/approved thresholds, workflow gates/dry-run/artifact, rollout runbook, rollback runbook, and 0.80.0 metadata. After implementation, the focused contract/readiness/inventory/smoke loop passed:

```text
51 pass, 0 fail, 252 expectations
```

The final provider-free PR2 focused matrix passed:

```text
113 pass, 0 fail, 624 expectations
```

It includes migration-preflight, previous-image compatibility, emergency control, final release contracts, telemetry, database readiness/workflow contracts, static isolated inventory, and stale/expired fallback smoke.

## Changed files

- `.github/workflows/hermes-backend-production-assurance.yml`
- `bun.lock`
- `docs/guides/development-reference.md`
- `docs/rollout/hermes-backend-production-assurance.md`
- `docs/runbooks/hermes-emergency-rollback.md`
- `services/api/.test-isolated`
- `services/api/CHANGELOG.md`
- `services/api/package.json`
- `services/api/scripts/test-hermes-production-assurance.sh`
- `services/api/src/cli/tests/hermes-previous-api-compatibility.spec.ts`
- `services/api/src/cli/tests/hermes-production-assurance-release.spec.ts`
- `services/api/src/lib/drizzle/tests/hermes-runtime-telemetry.database.isolated.ts`
- `services/api/src/lib/drizzle/tests/test-database-readiness.spec.ts`
- `services/api/src/lib/testing/tests/isolated-test-suite.spec.ts`
- `services/api/src/services/tests/connected-agents.service.spec.ts`
- `.superpowers/sdd/2026-08-09-hermes-backend-production-assurance/task-7-report.md`

## Provider-free validation

All commands ran with database safety/readiness and provider variables unset where applicable. `TEST_DATABASE_SAFE` was never set locally.

- Final focused PR2 matrix: PASS — 113 tests, 624 expectations.
- Exact workflow static-inventory/release command from repository root: PASS — 20 tests, 131 expectations.
- Exact stale/expired workflow smoke command from repository root: PASS — 1 test, 7 expectations.
- API/protocol build: PASS.
- API `typecheck` (`tsc --noEmit`): PASS.
- CLI-spec typecheck: PASS.
- Full API lint: PASS — zero errors and 46 pre-existing warnings outside Task 7.
- Focused ESLint for changed TypeScript: PASS, no findings.
- New guarded database target Bun bundle/parse: PASS.
- Workflow YAML parse: PASS.
- Assurance wrapper Bash syntax: PASS.
- Frozen root install: PASS — 878 installs checked across 988 packages, no changes.
- `git diff --check`: PASS.

## Database execution boundary

Per task instruction, no local database suite or migration was run, no `DATABASE_URL` was used for a database operation, and `TEST_DATABASE_SAFE` was never set. The five guarded real-PostgreSQL suites and explicit migrations remain owned by the workflow's dedicated disposable `postgres:16`/`hermes_assurance` service.

## Residual risk and review gate

- Native PostgreSQL behavior, 100,000-row timing under the operator-approved thresholds, Docker previous-image probes, and the emergency concurrency/rollback fixture require the service-backed CI run.
- Production rollout/mutation remains unauthorized by these changes; the protected environment and separate operator approvals are mandatory.
- Independent database correctness, rollback/operational safety, privacy/telemetry, and workflow security review remains required before acceptance/merge.
- No push, deployment, production mutation, or database operation was performed.
