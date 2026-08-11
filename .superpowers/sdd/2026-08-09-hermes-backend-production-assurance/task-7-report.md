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

## Important re-review follow-up

The three validated Important follow-up findings in reviewer artifacts `e144c5e0`, `b235d837`, and `7d9084bf` are now resolved.

- The rollout smoke no longer uses the legacy direct DELETE endpoint. Its exact Disconnect step is the approved client-owned saga: durable local pause/scrub, connector-owned authenticated `POST /api/hermes-authorizations/disconnect`, matching receipt plus old-credential 401 denial proof and connector Keychain deletion, exact-generation `POST /api/agent-runtime/reconcile-index` CAS, then exact local schedule/plugin/dashboard/environment cleanup. The runbook requires final server and signed-connector verification, forbids reproducing connector-owned credential requests manually, preserves credential-free evidence, and names the exact Mac/server release-contract sources and workflow path filters.
- The aggregate artifact now records stable `telemetry-privacy`, `assurance-output-sanitization`, and `sentry-sink` gates. The release contract parses and compares the complete ordered 17-gate array, rather than checking loose containment, and the rollout checklist names the same exact set.
- All three jobs retain the reviewed official `postgres:16@sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b` multi-architecture image. They share PGDG package version `0.8.6-1.pgdg13+1`, extension version `0.8.6`, SHA-256 `9aea9c1617bc99991d3730cfbf5878a0e9dc377e0d3d5ca2e41488a2309319bc`, and the historical archive object's S3 version ID `x3lsgKtr53BtiGMRJqIlPZr52kLw0jvS`. Each job downloads that exact versioned object on the runner, verifies its hardcoded SHA-256 before copying it, proves the base already has installed `postgresql-16` and `libc6` and lacks the incompatible optional JIT package, validates package metadata, installs only with `dpkg`, and asserts the installed package and live extension versions. No apt index or unversioned package resolution remains.

### Package provenance and availability

The pinned image's independently inspected Linux/amd64 child is `sha256:670391653713782e51974845b217c56fed4dd8729142299c43c919a8d3e15e00`; its OCI config identifies Debian trixie, PostgreSQL `16.14-1.pgdg13+1`, and image creation on 2026-08-05. The PGDG package is dated 2026-08-02 and was archived on 2026-08-03, so it predates that pinned image. The `trixie-pgdg-archive` InRelease signature verified with PostgreSQL Debian Repository fingerprint `B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8`; its signed `Packages.bz2` checksum verified, and that package record independently resolved the hardcoded SHA-256 above. A separate download of the version-ID URL reproduced the hash and exact package/version/architecture metadata.

Residual availability risk is now limited to the external PGDG archive/CDN being reachable from GitHub-hosted runners. The object version and SHA prevent silent byte drift, but this repository does not mirror the package, so an archive outage fails the release gate closed. Service-container installation and extension execution remain CI-owned; no local Docker or database operation was run.

### Follow-up validation

- Provider-free focused matrix: PASS — 122 tests, 794 expectations.
- Fresh-process mocked production Sentry sink: PASS — 1 test, 3 expectations.
- Release/readiness contracts after final package pin: PASS — 39 tests, 308 expectations, also included in the final matrix, with exact source, gate-set, package, dependency, and step-order assertions.
- Workflow YAML and all 22 shell run blocks: PASS.
- Version-pinned archive package download/hash/metadata: PASS.
- Frozen root install: PASS — 878 installs checked across 988 packages, no changes.
- API/protocol build: PASS; API typecheck and CLI-spec typecheck: PASS when run after the protocol build; API lint: PASS with the same 46 pre-existing warnings and zero errors.
- `git diff --check`: PASS.

No database suite, Docker command, production authorization, secret, `DATABASE_URL`, or `TEST_DATABASE_SAFE=1` was used locally. No push occurred.

## Validated final-review fixes

The validated findings in reviewer artifacts `cbfea091`, `2824ae3a`, and `3cf2f65f` are resolved at the Task 7 follow-up head:

- The emergency rollback now starts with a separately incident-authorized durable ingress/control-plane admission fence covering every authorization create/approve/exchange/activate route, legacy prepare, Hermes runtime selection, replicas, queue consumers, and equivalent paths. It requires draining in-flight requests, fixed denial probes before dry-run, holding the fence through both zero verification and older-binary restoration, and repeating zero/denial verification while held. The runbook explicitly states that transaction table/advisory locks end at commit.
- Emergency execution output validation now enforces the exact 14-key receipt, exact audience/reason, safe nonnegative count integers, plan/receipt binding, dry-plan count binding, `permissionsRemoved`, `auditReceipts`, and distinct `executed`/`already-executed` mutation invariants. Evidence wording permits the approved immutable public image digest only inside the sanitized compatibility report while continuing to prohibit credential- and identity-derived hashes.
- The rollout reselect smoke requires `pending:false`. An unexpected claimed turn must receive exactly one sanctioned respond/consult completion and settlement verification before the final reselect → empty pickup → disconnect sequence restarts.
- The negotiation pickup-race application log now accepts no authority inputs and emits only fixed `reason: runtime_conflict`. Direct console coverage and fresh-process production Sentry application-log coverage prove owner/agent keys, identifiers, and credential variants are absent while the stable reason remains. Authority and telemetry semantics are unchanged.
- Preflight evidence now carries validated sanitized `totalDurationMs` alongside `lockDurationMs`. The fixed report and aggregate schemas validate both measured durations, compare them to the selected maxima, and publish the measured pair without identifiers, secrets, or hashes.
- The production-assurance workflow now triggers on `apps/mac/**` and runs `bun test apps/mac/api/agent-runtime-saga.spec.mjs` provider-free on Ubuntu. The release contract asserts the broad trigger and exact command; the workflow and runbook explicitly avoid claiming a Swift/macOS build from Linux.

TDD RED for the new contracts: 22 passed / 10 failed / 1 import error before implementation. Focused GREEN: 32 passed / 0 failed / 279 expectations. The expanded provider-free Hermes matrix passed 127 tests / 0 failures / 838 expectations; the fresh-process Sentry target passed 2 tests / 6 expectations; and the Mac saga passed 26 tests / 222 expectations. Workflow YAML plus all 23 shell run blocks and the assurance wrapper parse successfully. Frozen install, API/protocol build, API typecheck, CLI-spec typecheck, API lint (zero errors; 46 pre-existing warnings), and `git diff --check` pass.

The service-backed CI finding remains explicitly residual rather than fabricated: no database, Docker, service-container, migration, 100,000-row timing, pgvector, emergency concurrency/rollback, or immutable previous-image execution was performed locally, and the exact unpushed head has no service-backed CI evidence. A pushed exact revision and successful dedicated workflow run remain required for final service-backed acceptance. No production/database action, `DATABASE_URL`, `TEST_DATABASE_SAFE`, Docker action, or push occurred in this follow-up.
