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

All Important findings from the four Task 7 independent reviews are resolved. The 100,000-row fixture now requires and strictly parses the selected lock/total environment thresholds and uses them for timed preflight and migration DDL, with no fixture defaults. Emergency dry-run validation and rollback extraction require the exact `dry-run` reason and fixed plan schema. Rollout Prepare is only PKCE `/hermes-authorizations`; selection uses the activated connector tuple and expects `never-seen`/Index coverage until the first successful pickup establishes `active`/no Index coverage. The pause example omits a request body entirely.

The provider-free release gate now runs telemetry privacy, assurance-log sanitization, and a registered fresh-process mocked production Sentry sink. Documentation, the Task 7 plan, and this report are exact PR path-filter inputs. Workflow security is explicit: `contents: read`, no persisted checkout credentials, reviewed full-SHA action pins, and one independently registry-resolved PostgreSQL 16 multi-architecture digest used and asserted by all three services. The operator-supplied prior production image remains operator-supplied and is constrained only to its required immutable digest form.

Added a guarded real-PostgreSQL telemetry aggregate fixture that seeds active near-expiry, active expired, active outside-window, pending, and revoked rows and proves the production adapter counts only the two authoritative active classes. It requires both `TEST_DATABASE_SAFE=1` and the exact `hermes_assurance` database and performs FK-safe, independently attempted, leak-verified cleanup.

Created the rollout and emergency rollback runbooks. Rollout is server before client and covers operator-supplied thresholds/digest, separate migration/mutation authorization, the exact prepare → select → pickup → respond → consult → Index → reselect → disconnect smoke, dashboards/alerts, seven-day expiry, expired fallback, pending outbox, and credential-free evidence. Rollback is forward-fix-first and strictly pause → bulk revoke → verify zero active/live dedicated credentials and zero selected Hermes → restore the approved older immutable binary. It includes dry-run/confirm commands, opaque plan-ID handling, canonical decimal count validation, idempotency, `hermes_assurance` test safety, and explicit language that the document does not authorize production execution.

API metadata moved exactly from 0.79.0 to 0.80.0 in `services/api/package.json` and root `bun.lock`; no other package version changed. The API changelog and development reference record the assurance contract.

## TDD evidence

Initial provider-free RED:

```text
bun test src/cli/tests/hermes-production-assurance-release.spec.ts
0 pass, 6 fail
```

Failures covered the missing full suite list/approved thresholds, workflow gates/dry-run/artifact, rollout runbook, rollback runbook, and 0.80.0 metadata. The independent-review follow-up RED also failed on the missing strict threshold parser/module, threshold consumption/export, exact dry-run reason/schema, PKCE-only rollout ordering, bodyless pause example, privacy gate, path filters, permissions, immutable action/image pins, and runtime digest assertions. After implementation, the focused contract/readiness/inventory/smoke loop passed:

```text
51 pass, 0 fail, 252 expectations
```

The final provider-free Task 7 focused matrix passed:

```text
120 pass, 0 fail, 716 expectations
1 pass, 0 fail, 3 expectations (separate fresh-process mocked Sentry sink)
```

It includes migration-preflight, previous-image compatibility, emergency control, final release/source/runbook contracts, strict threshold parsing, telemetry privacy, log sanitization, database readiness/workflow contracts, static isolated inventory, stale/expired fallback smoke, and the separate registered Sentry sink process.

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
- `services/api/src/lib/agent/tests/hermes-runtime-telemetry-sentry.isolated.ts`
- `services/api/src/lib/drizzle/tests/hermes-migration-preflight.database.isolated.ts`
- `services/api/src/lib/drizzle/tests/hermes-runtime-telemetry.database.isolated.ts`
- `services/api/src/lib/drizzle/tests/test-database-readiness.spec.ts`
- `services/api/src/lib/testing/hermes-assurance-thresholds.ts`
- `services/api/src/lib/testing/tests/hermes-assurance-thresholds.spec.ts`
- `services/api/src/lib/testing/tests/isolated-test-suite.spec.ts`
- `services/api/src/services/tests/connected-agents.service.spec.ts`
- `.superpowers/sdd/2026-08-09-hermes-backend-production-assurance/task-7-report.md`

## Provider-free validation

All commands ran with database safety/readiness and provider variables unset where applicable. `TEST_DATABASE_SAFE` was never set locally.

- Final focused Task 7 matrix: PASS — 120 tests, 716 expectations; separate fresh-process Sentry sink: PASS — 1 test, 3 expectations.
- Exact workflow static-inventory/release/threshold contracts and privacy commands: included in the matrix and separately exercised where process isolation is required.
- Exact stale/expired workflow smoke command from repository root: PASS — 1 test, 7 expectations.
- API/protocol build: PASS.
- API `typecheck` (`tsc --noEmit`): PASS.
- CLI-spec typecheck: PASS.
- Full API lint: PASS — zero errors and 46 pre-existing warnings outside Task 7.
- Focused ESLint for changed TypeScript: PASS, no findings.
- New guarded database target Bun bundle/parse: PASS.
- Workflow YAML parse, top-level read-only permission assertion, and rollback `jq` plan-schema expression: PASS.
- Assurance wrapper Bash syntax: PASS.
- Docker Hub Registry API independently returned OCI multi-architecture index digest `sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b`; GitHub refs independently resolved the pinned action release SHAs.
- Frozen root install: PASS — 878 installs checked across 988 packages, no changes.
- `git diff --check`: PASS.

## Database execution boundary

Per task instruction, no local database suite or migration was run, no `DATABASE_URL` was used for a database operation, and `TEST_DATABASE_SAFE` was never set. The five guarded real-PostgreSQL suites and explicit migrations remain owned by the workflow's dedicated disposable `postgres:16`/`hermes_assurance` service.

## Residual risk and review gate

- Native PostgreSQL behavior, 100,000-row timing under the operator-approved thresholds, pinned Docker service startup, previous-image probes, and the emergency concurrency/rollback fixture require the service-backed CI run.
- Production rollout/mutation remains unauthorized by these changes; the protected environment and separate operator approvals are mandatory.
- The four requested independent reviews completed; every Important finding in artifacts `c23160c2`, `12b4b047`, `11d45c09`, and `6f6018b3` is addressed by code/docs plus release contracts.
- No push, deployment, production mutation, database operation, `DATABASE_URL`, or local `TEST_DATABASE_SAFE=1` use occurred.
