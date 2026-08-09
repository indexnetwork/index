# Hermes Backend Production Assurance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Hermes credential, runtime, negotiation, migration, expiry, fallback, and emergency rollback behavior against real PostgreSQL and provide production-safe observability and operator controls.

**Architecture:** A dedicated GitHub Actions PostgreSQL service runs the existing guarded authority/fault fixture plus new migration and lifecycle suites under the repository's fail-closed database readiness guard. Typed preflight and emergency-control CLIs emit credential-free evidence, while a narrow telemetry adapter instruments lifecycle boundaries without adding secrets or high-cardinality identities.

**Tech Stack:** Bun/TypeScript, PostgreSQL/Drizzle, GitHub Actions service containers, Sentry structured telemetry, isolated fresh-process test harnesses, maintenance CLIs, Markdown runbooks.

## Global Constraints

- Stack this PR on the secure standalone connection PR, not directly on `dev`.
- Never set `TEST_DATABASE_SAFE=1` until `DATABASE_URL` is proven dedicated and disposable; never weaken `assertTestDatabaseReady()`.
- The CI database name is exactly `hermes_assurance`, never a `*_prod` or `*_production` name.
- Test synchronization uses barriers and database state, not sleeps.
- `idxh_` credentials live only in `hermes_agent_credentials`; legacy `apikey` rows are preflighted solely for migration safety.
- Production reports contain counts, durations, stable reasons, and opaque correlation IDs only—never keys, hashes, metadata payloads, owner IDs, agent IDs, consultation text, memory, or transcript prose.
- The previous production API compatibility gate runs the immutable image digest supplied by release operations; a source-level mock is not accepted as production evidence.
- Emergency control defaults to dry-run, requires an exact count confirmation, is idempotent, and revokes Hermes before any older server can be restored.
- Database migrations and production mutation commands require separate explicit deployment authorization.
- Bump API `0.79.0` to `0.80.0`; do not change protocol or Hermes plugin versions unless implementation changes their published surfaces.

---

### Task 1: Add a dedicated disposable-PostgreSQL assurance job

**Files:**
- Create: `.github/workflows/hermes-backend-production-assurance.yml`
- Modify: `services/api/package.json`
- Modify: `services/api/src/lib/drizzle/tests/test-database-readiness.spec.ts`
- Modify: `services/api/.test-isolated`

**Interfaces:**
- Produces script `test:hermes-production-assurance`.
- Produces CI service database `postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance`.
- Consumes existing `assertTestDatabaseReady()` without bypasses.

- [ ] **Step 1: Write failing readiness and workflow contract tests**

```typescript
expect(() => assertAllowedTestDatabaseUrl(
  'postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance',
)).not.toThrow();
expect(() => assertAllowedTestDatabaseUrl(
  'postgres://postgres:postgres@127.0.0.1:5432/hermes_prod',
)).toThrow('production-like database name');
```

Add a source contract asserting the new workflow scopes `TEST_DATABASE_SAFE: "1"` to the database test step rather than the whole workflow.

- [ ] **Step 2: Run and verify RED**

```bash
cd services/api
bun test src/lib/drizzle/tests/test-database-readiness.spec.ts
```

Expected: FAIL because the workflow/script contract is absent.

- [ ] **Step 3: Create the service-backed workflow**

Use `postgres:16`, health checks, frozen root install, API migrations, and the targeted script. Set no provider/API credentials. Add concurrency keyed by workflow/ref and cancel superseded PR runs.

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: hermes_assurance
    ports: ["5432:5432"]
    options: >-
      --health-cmd="pg_isready -U postgres -d hermes_assurance"
      --health-interval=5s --health-timeout=5s --health-retries=20
```

- [ ] **Step 4: Add the exact package script**

```json
{
  "test:hermes-production-assurance": "API_TEST_ISOLATED_TARGET=tests/negotiation-runtime-authority.database.isolated.ts bun test src/lib/testing/isolated-test-import-harness.spec.ts"
}
```

- [ ] **Step 5: Run against a local disposable Postgres and verify GREEN**

```bash
cd services/api
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance \
TEST_DATABASE_SAFE=1 bun run db:migrate:test
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance \
TEST_DATABASE_SAFE=1 bun run test:hermes-production-assurance
```

Expected: migrations and the guarded fixture pass; omitting the marker fails before schema mutation.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/hermes-backend-production-assurance.yml services/api
git commit -m "test(api): run Hermes assurance on PostgreSQL"
```

---

### Task 2: Complete real-database lifecycle and fault coverage

**Files:**
- Modify: `services/api/tests/negotiation-runtime-authority.database.isolated.ts`
- Create: `services/api/tests/hermes-runtime-lifecycle.database.isolated.ts`
- Modify: `services/api/.test-isolated`
- Modify: `services/api/src/adapters/conversation.database.adapter.ts`
- Modify: `services/api/src/adapters/agent.database.adapter.ts`
- Modify: `services/api/package.json`

**Interfaces:**
- Consumes: owner advisory lock, `HERMES_RESPONSE_ATOMIC_STEPS`, dedicated credential table, pending/active generations.
- Produces deterministic `createBarrier(parties)` synchronization and lifecycle/fault evidence.

- [ ] **Step 1: Add failing same-owner and different-owner race tests**

```typescript
const gate = createBarrier(2);
const results = await Promise.allSettled([
  prepareAndActivate(ownerA, installationA, gate),
  disconnectInstallation(ownerA, installationA, gate),
]);
expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
expect(await selectedHermesCount(ownerA)).toBeLessThanOrEqual(1);
expect(await validGenerationCount(ownerA, installationA)).toBeLessThanOrEqual(1);
```

A separate barrier runs owners A and B and proves neither waits on the other's advisory key.

- [ ] **Step 2: Add failing rotation/expiry/revocation cases**

Cover pending key denial, old generation denial after rotation, exact row mismatch, expiration at `expiresAt <= now`, disconnect revocation, and Index fallback view after stale/expired authority.

- [ ] **Step 3: Add every response/continuation fault boundary**

For each value in `HERMES_RESPONSE_ATOMIC_STEPS`, inject once, assert rollback of capability/task/message/artifact/opportunity/continuation/outbox effects, retry with the same capability, and assert one committed receipt and original absolute deadline.

- [ ] **Step 4: Run focused RED/GREEN loops**

```bash
cd services/api
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance \
TEST_DATABASE_SAFE=1 API_TEST_ISOLATED_TARGET=tests/hermes-runtime-lifecycle.database.isolated.ts \
bun test src/lib/testing/isolated-test-import-harness.spec.ts
```

Expected: all barrier, generation, expiry, replay, and deadline assertions pass without sleeps.

- [ ] **Step 5: Add both suites to the final assurance script and inventory**

Use a shell wrapper that invokes the isolated harness once per exact target so process state and fault hooks cannot leak between suites.

- [ ] **Step 6: Commit**

```bash
git add services/api/tests services/api/src/adapters services/api/.test-isolated services/api/package.json
git commit -m "test(api): prove Hermes lifecycle races"
```

---

### Task 3: Build a fail-closed migration preflight

**Files:**
- Create: `services/api/src/cli/hermes-migration-preflight.contract.ts`
- Create: `services/api/src/cli/hermes-migration-preflight.main.ts`
- Create: `services/api/src/cli/hermes-migration-preflight.ts`
- Create: `services/api/src/cli/tests/hermes-migration-preflight.spec.ts`
- Create: `services/api/src/lib/drizzle/tests/hermes-migration-preflight.database.isolated.ts`
- Modify: `services/api/package.json`
- Modify: `services/api/.test-isolated`

**Interfaces:**
- Produces `runHermesMigrationPreflight(input): Promise<HermesPreflightReport>`.
- Produces report `{ invalidLegacyMetadata, duplicateSelections, invalidDedicatedCredentials, expiryMismatches, missingIndexes, lockDurationMs, checkedAt }`.
- Produces command `bun run maintenance:hermes-preflight -- --json`.

- [ ] **Step 1: Write failing pure contract tests**

```typescript
expect(parseLegacyMetadata('{"audience":"hermes-negotiator"}').valid).toBe(true);
expect(parseLegacyMetadata('{broken').valid).toBe(false);
expect(formatPreflightReport(report)).not.toContain('idxh_');
expect(assertPreflightPass({ ...report, invalidLegacyMetadata: 1 })).toThrow(
  'invalid legacy API-key metadata',
);
```

- [ ] **Step 2: Run and verify RED**

```bash
cd services/api
bun test src/cli/tests/hermes-migration-preflight.spec.ts
```

Expected: FAIL because the preflight contract does not exist.

- [ ] **Step 3: Implement read-only SQL checks**

Use `CASE WHEN metadata IS NULL THEN false WHEN metadata IS JSON`-safe logic that never casts malformed text before classification. Check dedicated credential state/action/expiry consistency, duplicate selected executors, exact index validity, and expected constraint names. Return counts only.

- [ ] **Step 4: Add production-sized fixture and explicit thresholds**

The database test seeds 100,000 synthetic non-secret rows, runs the migration/preflight in a transaction on the disposable database, records lock duration, and fails only against command-line thresholds `--max-lock-ms` and `--max-total-ms`; do not invent hidden defaults.

- [ ] **Step 5: Run provider-free and database tests**

```bash
cd services/api
bun test src/cli/tests/hermes-migration-preflight.spec.ts
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance \
TEST_DATABASE_SAFE=1 \
API_TEST_ISOLATED_TARGET=src/lib/drizzle/tests/hermes-migration-preflight.database.isolated.ts \
bun test src/lib/testing/isolated-test-import-harness.spec.ts
```

Expected: clean fixtures pass; malformed metadata, expiry mismatch, duplicate selection, or missing index fails with credential-free counts.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/cli services/api/src/lib/drizzle/tests services/api/package.json services/api/.test-isolated
git commit -m "feat(api): preflight Hermes migrations"
```

---

### Task 4: Prove previous-production binaries reject dedicated credentials

**Files:**
- Create: `services/api/scripts/verify-hermes-previous-api-compatibility.sh`
- Create: `services/api/src/cli/tests/hermes-previous-api-compatibility.spec.ts`
- Create: `services/api/src/cli/tests/fixtures/previous-api.Dockerfile`
- Create: `services/api/src/cli/tests/fixtures/previous-api-server.ts`
- Modify: `.github/workflows/hermes-backend-production-assurance.yml`
- Modify: `services/api/package.json`

**Interfaces:**
- Consumes required `PREVIOUS_API_IMAGE` in the protected deployment gate.
- Consumes a disposable migrated database and a test `idxh_` credential from Task 2.
- Produces credential-free JSON `{ imageDigest, rejected: true, status: 401, checkedAt }`.

- [ ] **Step 1: Write a failing shell contract test**

```typescript
expect(script).toContain('test -n "$PREVIOUS_API_IMAGE"');
expect(script).toContain('docker inspect --format={{index .RepoDigests 0}}');
expect(script).toContain('EXPECTED_STATUS=401');
expect(script).not.toContain('set -x');
```

- [ ] **Step 2: Run and verify RED**

```bash
cd services/api
bun test src/cli/tests/hermes-previous-api-compatibility.spec.ts
```

Expected: FAIL because the compatibility runner is missing.

- [ ] **Step 3: Implement the immutable-image probe**

Require an image by digest, start it against the migrated disposable DB on a random loopback port, wait on its health endpoint, send an innocuous `/agents/me` request with the seeded `idxh_` value through stdin/environment without echoing it, and require HTTP 401. Always stop/remove the container with `trap`. Permit a mutable fixture tag only when both `NODE_ENV=test` and `ALLOW_MUTABLE_PREVIOUS_IMAGE=1`; production mode rejects it.

- [ ] **Step 4: Add PR and protected modes**

PR CI builds the base commit API image and proves denial. The production preflight requires the operator-supplied immutable currently deployed image digest and uploads only the digest/status report. Missing production input fails; it never skips.

- [ ] **Step 5: Run the contract and local image probe**

```bash
cd services/api
bun test src/cli/tests/hermes-previous-api-compatibility.spec.ts
docker build -t index-api-previous-fixture:local \
  -f src/cli/tests/fixtures/previous-api.Dockerfile src/cli/tests/fixtures
NODE_ENV=test ALLOW_MUTABLE_PREVIOUS_IMAGE=1 \
PREVIOUS_API_IMAGE=index-api-previous-fixture:local \
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance \
TEST_DATABASE_SAFE=1 ./scripts/verify-hermes-previous-api-compatibility.sh
```

Expected: the legacy-table-only fixture returns 401 and the report contains no credential. The protected production invocation replaces the fixture tag with the immutable deployed image digest.

- [ ] **Step 6: Commit**

```bash
git add services/api/scripts services/api/src/cli/tests services/api/package.json .github/workflows/hermes-backend-production-assurance.yml
git commit -m "test(api): verify Hermes rollback compatibility"
```

---

### Task 5: Add privacy-safe lifecycle telemetry

**Files:**
- Create: `services/api/src/lib/agent/hermes-runtime-telemetry.ts`
- Create: `services/api/src/lib/agent/tests/hermes-runtime-telemetry.spec.ts`
- Modify: `services/api/src/lib/log.ts`
- Modify: `services/api/src/lib/tests/log.spec.ts`
- Modify: `services/api/src/services/hermes-authorization.service.ts`
- Modify: `services/api/src/services/agent-runtime.service.ts`
- Modify: `services/api/src/adapters/agent.database.adapter.ts`
- Modify: `services/api/src/services/negotiation-polling.service.ts`

**Interfaces:**
- Produces `HermesRuntimeTelemetry.increment(event, attributes)`, `.gauge(name, value)`, and `.observe(name, milliseconds)`.
- Produces only enumerated `HermesTelemetryReason`; no free-text labels.

- [ ] **Step 1: Write failing event/redaction tests**

```typescript
telemetry.increment('credential_rejected', { reason: 'expired' });
expect(sink.events).toEqual([
  { name: 'hermes.credential_rejected', attributes: { reason: 'expired' } },
]);
expect(sanitizeForLog({ authorization: 'secret', code: 'abc', verifier: 'def' }))
  .toEqual({ authorization: '[REDACTED]', code: '[REDACTED]', verifier: '[REDACTED]' });
```

Reject owner, agent, installation, credential, negotiation, and arbitrary-message attributes at compile/runtime boundaries.

- [ ] **Step 2: Run and verify RED**

```bash
cd services/api
bun test src/lib/agent/tests/hermes-runtime-telemetry.spec.ts src/lib/tests/log.spec.ts
```

Expected: FAIL because telemetry and redaction are incomplete.

- [ ] **Step 3: Implement the narrow adapter and stable events**

Emit authorization start/complete/expiry/replay, near-expiry/expired gauges, rotation/revocation/pending revocation, stale runtime/Index fallback, stable auth denial, conflict/server error, advisory-lock wait, pending outbox, and replay attempts. Measure the advisory wait around `pg_advisory_xact_lock` without owner labels.

- [ ] **Step 4: Verify no sensitive dimensions or prose**

```bash
cd services/api
bun test src/lib/agent/tests/hermes-runtime-telemetry.spec.ts src/lib/tests/log.spec.ts tests/agent-runtime.service.spec.ts
```

Expected: PASS; snapshots contain stable enums and numeric values only.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/lib services/api/src/services services/api/src/adapters
git commit -m "feat(api): observe Hermes runtime safely"
```

---

### Task 6: Add emergency pause and bulk revocation

**Files:**
- Create: `services/api/src/cli/hermes-emergency-control.contract.ts`
- Create: `services/api/src/cli/hermes-emergency-control.main.ts`
- Create: `services/api/src/cli/hermes-emergency-control.ts`
- Create: `services/api/src/cli/tests/hermes-emergency-control.spec.ts`
- Create: `services/api/src/lib/drizzle/tests/hermes-emergency-control.database.isolated.ts`
- Modify: `services/api/package.json`
- Modify: `services/api/.test-isolated`

**Interfaces:**
- Produces `planEmergencyControl(db, { audience }): Promise<EmergencyPlan>`.
- Produces `executeEmergencyControl(db, { planId, expectedInstallations, confirm }): Promise<EmergencyReceipt>`.
- Produces command `bun run maintenance:hermes-emergency-control` with dry-run default.

- [ ] **Step 1: Write failing confirmation/idempotency tests**

```typescript
const plan = await planEmergencyControl(db, { audience: 'hermes-agent' });
await expect(executeEmergencyControl(db, {
  planId: plan.planId,
  expectedInstallations: plan.installations + 1,
  confirm: true,
})).rejects.toThrow('expected count mismatch');
expect(await executeEmergencyControl(db, {
  planId: plan.planId,
  expectedInstallations: plan.installations,
  confirm: true,
})).toMatchObject({ selectedPaused: plan.installations, credentialsRevoked: plan.credentials });
```

- [ ] **Step 2: Run and verify RED**

```bash
cd services/api
bun test src/cli/tests/hermes-emergency-control.spec.ts
```

Expected: FAIL because emergency control is missing.

- [ ] **Step 3: Implement deterministic locked mutation**

Default to dry-run. For confirmed execution, lock owners in deterministic order, select Index, disable/revoke dedicated credentials, remove negotiation permission, mark installations inactive, and write one audit receipt. Refuse generic/legacy audiences. Rerun returns zero mutations.

- [ ] **Step 4: Run pure and disposable database tests**

```bash
cd services/api
bun test src/cli/tests/hermes-emergency-control.spec.ts
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance \
TEST_DATABASE_SAFE=1 \
API_TEST_ISOLATED_TARGET=src/lib/drizzle/tests/hermes-emergency-control.database.isolated.ts \
bun test src/lib/testing/isolated-test-import-harness.spec.ts
```

Expected: count mismatch fails without mutation; exact confirmation revokes; second run is idempotent.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/cli services/api/src/lib/drizzle/tests services/api/package.json services/api/.test-isolated
git commit -m "feat(api): add Hermes emergency control"
```

---

### Task 7: Wire final CI gates, runbooks, and release evidence

**Files:**
- Modify: `.github/workflows/hermes-backend-production-assurance.yml`
- Create: `docs/rollout/hermes-backend-production-assurance.md`
- Create: `docs/runbooks/hermes-emergency-rollback.md`
- Modify: `docs/guides/development-reference.md`
- Modify: `services/api/CHANGELOG.md`
- Modify: `services/api/package.json`
- Modify: `bun.lock`

**Interfaces:**
- Consumes all evidence/report commands from Tasks 1-6.
- Produces one credential-free assurance artifact and operator runbooks.

- [ ] **Step 1: Add workflow assertions for every gate**

The workflow must run migrations, both DB suites, preflight with explicit thresholds, previous-image denial, emergency dry-run, build, typecheck, lint, and a stale/expired `indexCovering: true` smoke. Upload only sanitized JSON reports.

- [ ] **Step 2: Write exact rollout and rollback commands**

Document server-before-client deployment, preflight thresholds supplied by release approval, smoke prepare/select/pickup/respond/consult/Index/reselect/disconnect, dashboard/alert checks, and forward-fix-first rollback. Rollback order is pause → bulk revoke → verify zero active dedicated keys and zero selected Hermes → restore older binary.

- [ ] **Step 3: Bump API and validate package metadata**

Bump API `0.79.0` to `0.80.0`, update changelog and lockfile, and record the PostgreSQL, preflight, telemetry, and emergency-control additions.

- [ ] **Step 4: Run the PR 2 verification matrix**

```bash
cd services/api
bun run build
bun run typecheck
bun run lint
bun test src/cli/tests/hermes-migration-preflight.spec.ts \
  src/cli/tests/hermes-previous-api-compatibility.spec.ts \
  src/cli/tests/hermes-emergency-control.spec.ts \
  src/lib/agent/tests/hermes-runtime-telemetry.spec.ts \
  src/lib/drizzle/tests/test-database-readiness.spec.ts

DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance \
TEST_DATABASE_SAFE=1 bun run test:hermes-production-assurance

cd ../..
bun install --frozen-lockfile
git diff --check
git status --short
```

Expected: all provider-free and dedicated disposable-PostgreSQL gates pass; no unrelated DB suite runs.

- [ ] **Step 5: Run independent reviews**

Request database correctness review, rollback/operational safety review, privacy/telemetry review, and workflow security review. Resolve every blocker/high/medium finding.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/hermes-backend-production-assurance.yml docs services/api bun.lock
git commit -m "docs: finalize Hermes backend assurance"
```
