# IND-638B Guarded Quality Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Use superpowers:test-driven-development for every code task, with one fresh implementer and an independent review gate per task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver PR B’s guarded historical-quality protected-base lifecycle, strict v2 Neon attestation, serial restore-per-slot runtime, production-shaped dual-trigger execution, sanitized evidence aggregation, and operator-only rollout without changing legacy discovery A/B or matrix behavior.

**Architecture:** Keep the provider-free authority delivered by merged PR A immutable and consume `buildHistoricalQualityPilotPlan`, the admitted shared-pool seed projection, pure trigger builders, metric builders, and strict V2 artifact schema. Add a distinct quality base lifecycle with a writable refresh target and an attested read-replica verification target. The quality parent verifies the base in a fresh read-only process before any reset, then serially restores the selected existing A/B child and launches one fresh child process per slot. Each child re-attests and verifies the restored branch before constructing provider, Redis, graph, or evaluator dependencies, runs exactly one trigger attempt, and emits one sanitized strict slot result. The parent accepts only the planned one-row outputs, suppresses all quality aggregation when evidence is incomplete, and preserves existing operational failure accounting.

**Tech Stack:** Bun, strict TypeScript, Zod strict schemas, Drizzle ORM, PostgreSQL/pgvector, generated SQL migrations, Neon v2 control-plane APIs, Redis/ioredis, LangGraph opportunity discovery, PR A historical-quality contracts, Bun test, canonical SHA-256 JSON fingerprints, IEEE-754 vector fingerprints, and conventional Git commits.

## Global Constraints

- PR B starts only after PR A is merged into `dev`, all merge-commit workflows pass, and a merged-tree audit has no Critical or Important findings.
- Rebase the PR B worktree from then-current `origin/dev`; do not implement against the unmerged PR A branch or copy PR A code into PR B.
- Revalidate PR A’s exported contracts, admitted plan/document fingerprints, package versions, and queue-builder parity before adding runtime code.
- Consume `buildHistoricalQualityPilotPlan` as the sole quality planning authority. Never call, modify, or repurpose `buildHistoricalExperimentPlan`.
- Preserve legacy discovery single configuration, A/B, matrix, protected-base, reset, artifact, exit-code, and v1-manifest behavior.
- Legacy/unversioned `DISCOVERY_TARGETS` remains accepted only for legacy A/B. Historical quality requires strict `version: 2`.
- Preserve `DISCOVERY_ENV_MATRIX_CHILDREN` version 1 for legacy matrix and legacy protected-base commands only.
- Quality refresh uses a strict separately parsed and control-plane-attested writable protected-base target whose endpoint type is `read_write`. Quality verification uses only the v2 base read replica whose endpoint type is `read_only`; both A/B child endpoints are `read_write`.
- The quality `--verify` process must report `transaction_read_only=on` and must never receive a writable base URL, `NEON_API_KEY`, provider credentials, Redis configuration, or provider constructors.
- Before any quality reset: control-plane attestation → fresh read-only verifier process → verifier closes successfully.
- On base verification failure, do not reset a child, spawn a slot process, construct provider dependencies, or spend a graph/evaluator call.
- For each slot, serially: restore selected child A → await every Neon operation → spawn one process → re-attest/bind → verify restored quality state → construct dependencies → invoke once → validate one output → close resources.
- Historical quality always selects existing side `a`; side `b` remains untouched.
- Child argv contains only opaque run/slot/configuration identifiers and the output path.
- `DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON` contains only strict PR A allowlisted discovery configuration. The child reparses it, canonicalizes it, and recomputes/matches `configurationFingerprint`; it contains no corpus prose, URL, secret, credential key/value, prompt, profile, citation, answer key, provider secret, or Redis value.
- A separate minimal runtime environment is built from an explicit allowlist rather than by spreading/copying parent `process.env`. Its only keys are `DISCOVERY_TARGETS`, `NEON_API_KEY`, `DISCOVERY_CONFIRM`, `TEST_DATABASE_SAFE`, `NODE_ENV`; `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_REQUEST_TIMEOUT_MS`, `OPENROUTER_MAX_RETRIES`, `OPENROUTER_FALLBACK_MODEL`, `OPENROUTER_RUNNABLE_MAX_ATTEMPTS`, `CHAT_MODEL`, `CHAT_REASONING_EFFORT`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `SMARTEST_VERIFIER_MODEL`, `SMARTEST_GENERATOR_MODEL`, `EVAL_MODEL_OVERRIDES`; and either `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`.
- The parent never forwards `DATABASE_URL`. The child derives the selected child URL only after manifest re-attestation, using the current discovery bootstrap binding, and only then exposes it to DB construction. Secrets in the minimal runtime environment remain redacted from argv, config JSON, logs, errors, and artifacts.
- Every slot uses `maxAttempts: 1`, `retryDelayMs: 0`, and one process. Every terminal row has exactly one attempt with `retryable: false`, `backoffMs: 0`, and `recovered: false`. Never automatically rerun a failed, missing, timed-out, or incomplete slot.
- Use PR A’s pure intent/enrichment trigger builders after exact fixture ownership and assignment verification. Do not enqueue BullMQ jobs or run queue callbacks.
- Read reviewed premises, contexts, intents, and retrieval documents from restored storage. Do not regenerate reviewed text during a measured slot.
- Redis isolation uses a per-slot `HydeCache` decorator. Do not flush Redis or perform broad `protocol:*` deletion.
- Project only sanitized retrieval, evaluator-state, and thresholded final-order fields into PR A metrics. Do not infer final rank from persistence or duplicate/conflict suppression.
- Child output uses PR A's exported canonical `HistoricalQualityTransportRowSchema`, `HistoricalQualityExecutionRunSchema`, and inferred types; PR B never copies or redefines either wire schema. Parent rejects missing, duplicate, malformed, unplanned, or wrong-slot output.
- Incomplete execution writes a diagnostic run report, sets `qualityVerdictAvailable: false`, prints `no quality verdict`, averages no successful subset, and exits `3`.
- A child attempt timeout that produces a valid sanitized failed row continues scheduling and ends with diagnostic artifact/exit `3`. Supervisor/process timeout without a valid row, reset, restore, process-launch, missing-artifact, and malformed-child failures retain operational exit `4` and do not masquerade as insufficient evidence.
- Operational restore/spawn/supervisor-timeout/missing/malformed failures best-effort write a sanitized unavailable-verdict run report whenever the report path/writer survives; an artifact-write failure is separately reported without hiding the primary operational failure.
- Provider-free tests run first. Database-backed tests run only after proving `DATABASE_URL` is the attested dedicated disposable Neon child on `/protocol_eval` and setting `TEST_DATABASE_SAFE=1`. Because PR B changes database behavior, successful proof and the full guarded DB suite are hard pre-merge gates: the PR may open while separately authorized target access is pending, but must not be called merge-ready or merged and rollout must not start until actual passing evidence is recorded.
- Never bypass or weaken `checkTestDatabaseReadiness`, `validateTestDatabaseUrl`, or the fail-closed migration guard.
- Quality launch remains operator-CLI-only. Do not add an Eval Ops quality launch control.
- Read-replica provisioning, secret migration, base refresh, intent smoke, enrichment smoke, and ten-slot pilot each require a separate explicit operational confirmation. Never chain or auto-rerun them.
- Both smokes use only `historical/builder-and-operator`.
- Bump `@indexnetwork/api` exactly `0.78.0 → 0.79.0`.
- Keep `@indexnetwork/protocol` at `10.1.0`; no protocol source change is planned. If implementation proves a protocol source change unavoidable, stop, document why the graph cannot expose the reviewed state, expand validation, and bump exactly `10.1.0 → 10.2.0`.
- Keep `@indexnetwork/eval-ops` unchanged. Regenerate and commit root `bun.lock`.
- Do not merge or assume merge authorization. Operational rollout begins only after PR B is merged, merged-tree checks pass, and a separate rollout authorization is recorded.

## File and Responsibility Map

### New Files

- `services/api/src/cli/discovery-quality-attestation.ts`
  - Canonical quality attestation type, strict parser, vector encoding/fingerprints, and root-digest verification.
- `services/api/src/cli/discovery-quality-base.ts`
  - Dependency-free quality base bootstrap and refresh/verify target selection.
- `services/api/src/cli/discovery-quality-refresh-target.ts`
  - Strict writable-refresh target parser, environment binding, branded control-plane attestation, and provider/DB/reset-free attest-only entrypoint.
- `services/api/src/cli/discovery-quality-read-replica.ts`
  - Confirmation-gated safe base read-replica creation plus strict attest-only command; prints endpoint ID/type only, never URL credentials.
- `services/api/src/cli/discovery-quality-base.runtime.ts`
  - Fresh-process entrypoint that imports quality base runtime only after target binding.
- `services/api/src/cli/discovery-quality-base.main.ts`
  - Quality seed, refresh, metadata publication, read-only verification, and resource cleanup.
- `services/api/src/cli/discovery-quality.environment.ts`
  - Exact child runtime-env key constants/types plus the from-scratch allowlist builder that keeps sanitized discovery config JSON separate, rejects parent `DATABASE_URL`, and enforces one Redis form.
- `services/api/src/cli/discovery-quality.cache.ts`
  - Bounded, unique `HydeCache` namespace decorator.
- `services/api/src/cli/discovery-quality.runtime.ts`
  - Quality plan dispatch, base verifier supervision, serial restore scheduler, child execution, projection, aggregation, and artifact writing.
- `services/api/src/cli/discovery-quality.child.ts`
  - Strict child dispatch/output schemas and one-slot child composition.
- `services/api/src/cli/discovery-quality-db-test.guard.ts`
  - Attested disposable-child proof used before guarded DB tests.
- `services/api/src/cli/tests/discovery-quality.contract-audit.spec.ts`
  - Post-PR-A contract, fingerprint, version, and boundary audit.
- `services/api/src/cli/tests/discovery-quality-attestation.spec.ts`
  - JSON attestation parsing, canonical digest, vector fingerprint, and migration compatibility tests.
- `services/api/src/cli/tests/discovery-quality-base.spec.ts`
  - Provider-free seed/refresh/verify lifecycle, unpublished/published metadata transaction, rollback, and read-only separation tests.
- `services/api/src/cli/tests/discovery-quality-refresh-target.spec.ts`
  - Strict parser, environment binding, endpoint-type/crossing, branding, and attest-only zero-provider/DB/reset tests.
- `services/api/src/cli/tests/discovery-quality-read-replica.spec.ts`
  - Explicit confirmation, base binding, `read_only` creation, sanitized output, and post-create attestation tests.
- `services/api/src/cli/tests/discovery-quality.runtime.spec.ts`
  - Parent ordering, serial restore, one-process/one-attempt scheduling, exact child environment allowlisting/redaction, and failure-path tests.
- `services/api/src/cli/tests/discovery-quality.child.spec.ts`
  - Child binding, verification-before-dependencies, cache namespace, trigger, projection, and cleanup tests.
- `services/api/src/cli/tests/discovery-quality.artifact.spec.ts`
  - Strict child aggregation, diagnostic artifact, no-verdict, and exit-code tests.
- `services/api/src/cli/tests/discovery-quality-base.integration.spec.ts`
  - Guarded disposable-database seed/verify/staleness/ownership/vector tests.
- `services/api/drizzle/0119_add_eval_matrix_quality_attestation.sql`
  - Generated and conventionally renamed nullable JSONB migration.
- `services/api/drizzle/meta/0119_snapshot.json`
  - Drizzle-generated schema snapshot; never hand-edit.
- `docs/research/2026-08-07-ind-638b-validation-receipt.md`
  - Actual pre-merge deterministic, guarded-DB, review, and PR evidence.
- `docs/guides/ind-638-historical-quality-pilot.md`
  - CLI-only base lifecycle, v2 manifest migration, confirmations, smoke, pilot, and no-rerun runbook.

### Modified Files

- `services/api/src/schemas/database.schema.ts`
  - Add nullable typed `qualityAttestation` JSONB to `evalMatrixMetadata`.
- `services/api/drizzle/meta/_journal.json`
  - Record tag `0119_add_eval_matrix_quality_attestation`.
- `services/api/src/adapters/embedder.adapter.ts`
  - Expose the resolved embedding provider/model/dimensions identity used by the same adapter instance.
- `services/api/src/cli/discovery.neon.ts`
  - Add strict v2 manifest parsing/attestation while preserving legacy projection and reset behavior.
- `services/api/src/cli/discovery-env-matrix.neon.ts`
  - Decode endpoint read/write type for quality attestation without changing matrix v1 rules.
- `services/api/src/cli/discovery.ts`
  - Dispatch PR A quality argv into PR B runtime after gate/attestation; preserve help-first and legacy dispatch.
- `services/api/src/cli/discovery.contract.ts`
  - Document v2 quality requirements and quality-specific exit/restore behavior without changing legacy meanings.
- `services/api/src/cli/discovery.main.ts`
  - Route quality parent/child execution to the additive runtime; leave `buildAbPlan` and A/B paths unchanged.
- `services/api/src/cli/tests/discovery.neon.spec.ts`
  - Pin legacy compatibility plus strict v2 base-replica/child attestation.
- `services/api/src/cli/tests/discovery.contract.spec.ts`
  - Pin help-first quality wording, v2 shape, and legacy wording.
- `services/api/src/cli/tests/discovery.parent.spec.ts`
  - Preserve legacy A/B and add quality-dispatch boundary tests.
- `services/api/src/cli/tests/discovery.child.spec.ts`
  - Preserve legacy child behavior and prove quality child arguments remain opaque.
- `services/api/src/cli/tests/discovery-env-matrix.neon.spec.ts`
  - Pin unchanged v1 matrix behavior after endpoint-type decoding.
- `services/api/src/cli/tests/discovery.quality.spec.ts`
  - Replace PR A runtime-unavailable expectation with guarded PR B dispatch.
- `services/api/src/adapters/tests/cache.adapter.isolated.ts`
  - Verify namespaced decorator interoperability without global deletion.
- `services/api/package.json`
  - Add quality base/verify/DB-proof scripts and bump API to `0.79.0`.
- `.env.example`
  - Document v2 `DISCOVERY_TARGETS`, separate writable refresh target, and CLI-only confirmations.
- `docs/guides/development-reference.md`
  - Replace the PR A runtime boundary with the guarded runtime and link the operator runbook.
- `packages/protocol/eval/ops/README.md`
  - Document atomic v2 secret migration and continued absence of quality launch controls.
- `packages/protocol/eval/ops/tests/server.spec.ts`
  - Update the server-held manifest fixture to v2 and prove legacy A/B launches still receive a compatible projection.
- `bun.lock`
  - Regenerate the API workspace version.

### Files Explicitly Left Unchanged

- `packages/protocol/eval/discovery-env-matrix/historical-quality.experiment.ts`
- `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts`
- PR A’s `buildHistoricalQualityPilotPlan` implementation
- PR A shared-pool fixture, approval record, and reviewed retrieval text
- PR A metric and strict artifact contracts
- PR A pure trigger builders
- Existing matrix planner/runtime semantics
- Existing legacy A/B planner semantics
- Eval Ops launch registry and UI launch form
- `apps/eval-ops/package.json`

## Tasks

### 1. Rebase onto audited PR A and lock failing PR B acceptance seams

**Files**

- Create: `services/api/src/cli/tests/discovery-quality.contract-audit.spec.ts`
- Create: `services/api/src/cli/tests/discovery-quality.runtime.spec.ts`
- Modify: `services/api/src/cli/tests/discovery.quality.spec.ts`

**Interfaces**

- Consumes:
  - Merged PR A exports and fixtures
  - `buildHistoricalQualityPilotPlan`
  - Admitted `HISTORICAL_SHARED_POOL_PLAN`, named immutable `HISTORICAL_SHARED_POOL_SEED_PROJECTION`, and `historicalSharedPoolSeedFingerprint`
  - Pure intent/enrichment builders
  - PR A metrics plus exported `HistoricalQualityTransportRowSchema`, `HistoricalQualityExecutionRunSchema`, and their inferred types
- Produces:
  - A post-rebase audit gate
  - Failing runtime-order acceptance tests
  - No implementation fallback to `buildHistoricalExperimentPlan`

**Audit sketch**

```ts
const plan = buildHistoricalQualityPilotPlan({
  caseIds: HISTORICAL_SHARED_POOL_PLAN.cases.map((row) => row.caseId),
  triggers: ["intent", "enrichment"],
  repetitions: 1,
  configuration: { id: "a", config: resolvedConfig },
});

expect(plan.slots).toHaveLength(10);
expect(plan.maxAttempts).toBe(1);
expect(plan.slots.every((slot) => slot.selectedSide === "a")).toBe(true);
expect(admitHistoricalSharedPool(HISTORICAL_SHARED_POOL_FIXTURE))
  .toEqual(HISTORICAL_SHARED_POOL_PLAN);
expect(recomputedPlanFingerprint).toBe(approved.planFingerprint);
expect(recomputedSeedProjectionFingerprint)
  .toBe(approved.seedProjectionFingerprint);
expect(recomputedDocumentFingerprint)
  .toBe(approved.retrievalDocumentFingerprint);
expect(HistoricalQualityTransportRowSchema.parse(validTransportRow))
  .toEqual(validTransportRow);
expect(HistoricalQualityExecutionRunSchema.parse(validExecutionRun))
  .toEqual(validExecutionRun);
```

The source audit must read both planner modules and fail if the quality runtime imports or calls `buildHistoricalExperimentPlan`.

**Checklist**

- [ ] Confirm the worktree is clean and PR A is actually merged into `origin/dev`.
- [ ] Fetch `origin/dev`, rebase the PR B branch, and record the new base/head revisions.
- [ ] Run PR A’s complete provider-free validation before changing code.
- [ ] Assert protocol is `10.1.0`, API is `0.78.0`, and Eval Ops remains unchanged.
- [ ] Recompute and compare admitted plan/seed-projection/document fingerprints to the approved receipt and assert all three remain pairwise distinct.
- [ ] Import PR A's named seed projection/fingerprint and canonical transport/execution schemas through their public exports; prohibit local schema declarations with those names.
- [ ] Assert the approved review revision remains an ancestor of the merged fixture content.
- [ ] Add failing tests for `attest → verifier → close → restore → spawn → validate`.
- [ ] Add failing tests proving no reset/spawn/dependency construction after verifier failure.
- [ ] Add a source-boundary test prohibiting comparison planner imports from quality runtime.
- [ ] Preserve legacy discovery parent/child test expectations unchanged.
- [ ] Obtain independent review of the PR A/PR B ownership boundary.

**RED**

```bash
git fetch origin dev
git rebase origin/dev

cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts eval/discovery-env-matrix/tests/historical-quality.pilot.spec.ts eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts eval/shared/tests/artifact.spec.ts

cd ../../services/api
bun test src/cli/tests/discovery-quality.contract-audit.spec.ts src/cli/tests/discovery-quality.runtime.spec.ts src/cli/tests/discovery.quality.spec.ts
```

Expected: PR A tests pass; new PR B tests fail because runtime ordering, verifier, and quality dispatch do not exist and PR A still returns its runtime-unavailable refusal.

**GREEN**

```bash
cd services/api
bun test src/cli/tests/discovery-quality.contract-audit.spec.ts
```

Expected: merged PR A versions, approvals, fingerprints, planners, builders, metrics, and schemas audit cleanly; runtime acceptance tests intentionally remain red for later tasks.

**Commit**

```bash
git add services/api/src/cli/tests/discovery-quality.contract-audit.spec.ts services/api/src/cli/tests/discovery-quality.runtime.spec.ts services/api/src/cli/tests/discovery.quality.spec.ts
git commit -m "test(api): lock historical quality runtime boundaries"
```

### 2. Add nullable canonical quality attestation through generated Drizzle migration

**Files**

- Create: `services/api/src/cli/discovery-quality-attestation.ts`
- Create: `services/api/src/cli/tests/discovery-quality-attestation.spec.ts`
- Create: `services/api/drizzle/0119_add_eval_matrix_quality_attestation.sql`
- Create: `services/api/drizzle/meta/0119_snapshot.json`
- Modify: `services/api/src/schemas/database.schema.ts`
- Modify: `services/api/drizzle/meta/_journal.json`

**Interfaces**

```ts
export interface HistoricalQualityBaseAttestation {
  version: 1;
  corpusVersion: string;
  planFingerprint: string;
  seedProjectionFingerprint: string;
  documentSetFingerprint: string;
  embedding: {
    provider: string;
    model: string;
    dimensions: number;
    configurationFingerprint: string;
  };
  vectors: Array<{
    documentId: string;
    textFingerprint: string;
    vectorFingerprint: string;
  }>;
}

export const HISTORICAL_QUALITY_METADATA_KEY =
  "historical-quality-base-v1";

export function parseHistoricalQualityBaseAttestation(
  value: unknown,
): HistoricalQualityBaseAttestation;

export function fingerprintHistoricalQualityVector(
  vector: readonly number[],
): string;

export function historicalQualityAttestationRoot(
  value: HistoricalQualityBaseAttestation,
): string;
```

**Schema and SQL sketch**

```ts
qualityAttestation: jsonb("quality_attestation")
  .$type<HistoricalQualityBaseAttestation>(),
```

```sql
ALTER TABLE "eval_matrix_metadata"
ADD COLUMN "quality_attestation" jsonb;
```

The column is deliberately nullable: the legacy scalar row remains valid with `NULL`; the quality row requires a parsed canonical v1 object whose root digest equals `fixture_fingerprint`. The three authority fields map explicitly: PR A plan → `planFingerprint`, named seed projection → `seedProjectionFingerprint`, reviewed documents → `documentSetFingerprint`.

Vector fingerprints use only exact values read back from PostgreSQL/pgvector, processed in stable `documentId` order. For each component: reject non-finite values, canonicalize with `Math.fround`, normalize `-0` to `0`, write IEEE-754 float32 big-endian with `Buffer.writeFloatBE`, then SHA-256 the concatenated bytes. Never call `fingerprintHistoricalQualityVector` on provider-returned binary64 arrays. The integration test must embed a seam vector containing `0.1`, persist it, select it back, prove the selected component equals its float32 canonical value, and prove only that readback yields the stored attestation digest.

**Test sketch**

```ts
expect(legacyRow.qualityAttestation).toBeNull();

const canonical = parseHistoricalQualityBaseAttestation({
  version: 1,
  corpusVersion: "historical-quality-v1",
  planFingerprint: "a".repeat(64),
  seedProjectionFingerprint: "b".repeat(64),
  documentSetFingerprint: "c".repeat(64),
  embedding: {
    provider: "openrouter",
    model: "resolved-model",
    dimensions: 2000,
    configurationFingerprint: "d".repeat(64),
  },
  vectors: [
    {
      documentId: "doc-a",
      textFingerprint: "e".repeat(64),
      vectorFingerprint: fingerprintHistoricalQualityVector([Math.fround(0.1), 1, -2]),
    },
  ],
});

expect(historicalQualityAttestationRoot(canonical))
  .toMatch(/^[a-f0-9]{64}$/);
expect(() => fingerprintHistoricalQualityVector([Number.NaN]))
  .toThrow(/finite/);
```

**Exact generation, rename, journal, and no-drift workflow**

```bash
cd services/api
bun run db:generate

generated="$(find drizzle -maxdepth 1 -type f -name '0119_*.sql' ! -name '0119_add_eval_matrix_quality_attestation.sql')"
test -n "$generated"
test "$(printf '%s\n' "$generated" | wc -l | tr -d ' ')" = "1"
mv "$generated" drizzle/0119_add_eval_matrix_quality_attestation.sql

bun -e '
const path="drizzle/meta/_journal.json";
const journal=await Bun.file(path).json();
const entry=journal.entries.find((row)=>row.idx===119);
if(!entry) throw new Error("missing generated journal entry 119");
entry.tag="0119_add_eval_matrix_quality_attestation";
await Bun.write(path, JSON.stringify(journal, null, 2)+"\n");
'

cat drizzle/0119_add_eval_matrix_quality_attestation.sql
bun run db:generate
git status --short drizzle src/schemas/database.schema.ts
```

Expected: the migration contains only the nullable JSONB column addition; `_journal.json` tag is exact; snapshot remains generated; the second generation reports `No schema changes`.

**Checklist**

- [ ] Write parser, canonical document-order, root-digest, legacy-null, float32 (`0.1`, `-0`, non-finite), and provider-array-refusal tests first.
- [ ] Add the nullable typed JSONB column.
- [ ] Generate with Drizzle; never hand-author the snapshot.
- [ ] Rename only the SQL file to `0119_add_eval_matrix_quality_attestation.sql`.
- [ ] Update only the generated journal entry’s tag; never rename the snapshot.
- [ ] Inspect SQL for exactly one nullable column addition and no default/backfill.
- [ ] Prove a legacy row with null remains readable and valid.
- [ ] Require quality vectors to be sorted by `documentId` and unique; construct their fingerprints only from DB readback rows, never provider arrays.
- [ ] Reject unknown keys, wrong version, malformed digests, duplicate documents, invalid dimensions, and non-finite vectors.
- [ ] Run the second generation and require no drift.
- [ ] Independently review the SQL, journal, snapshot, and canonical encoding.

**RED**

```bash
cd services/api
bun test src/cli/tests/discovery-quality-attestation.spec.ts
```

Expected: failure because the typed column, parser, and fingerprint functions do not exist.

**GREEN**

```bash
cd services/api
bun test src/cli/tests/discovery-quality-attestation.spec.ts
bun run db:generate
```

Expected: all attestation/migration compatibility tests pass and Drizzle reports `No schema changes`.

**Commit**

```bash
git add services/api/src/schemas/database.schema.ts services/api/src/cli/discovery-quality-attestation.ts services/api/src/cli/tests/discovery-quality-attestation.spec.ts services/api/drizzle/0119_add_eval_matrix_quality_attestation.sql services/api/drizzle/meta/0119_snapshot.json services/api/drizzle/meta/_journal.json
git commit -m "feat(api): attest historical quality base state"
```

### 3. Implement unpublished seed state, atomic metadata publication, writable refresh attestation, and provider-free read-only verification

**Files**

- Create: `services/api/src/cli/discovery-quality-base.ts`
- Create: `services/api/src/cli/discovery-quality-base.runtime.ts`
- Create: `services/api/src/cli/discovery-quality-base.main.ts`
- Create: `services/api/src/cli/discovery-quality-refresh-target.ts`
- Create: `services/api/src/cli/tests/discovery-quality-base.spec.ts`
- Create: `services/api/src/cli/tests/discovery-quality-refresh-target.spec.ts`
- Modify: `services/api/src/adapters/embedder.adapter.ts`
- Modify: `services/api/package.json`

**Interfaces**

```ts
export interface HistoricalQualityEmbeddingIdentity {
  provider: string;
  model: string;
  dimensions: 2000;
  configurationFingerprint: string;
}

export interface QualityBaseRefreshTargetV2 {
  version: 2;
  projectId: string;
  branchId: string;
  endpointId: string;
  databaseName: "protocol_eval";
  databaseUrl: string;
}

declare const writableRefreshTargetBrand: unique symbol;
export type AttestedWritableQualityBaseTarget = QualityBaseRefreshTargetV2 & {
  endpointType: "read_write";
  branchName: "eval-discovery-base";
  primary: false;
  readonly [writableRefreshTargetBrand]: true;
};

export function parseQualityBaseRefreshTarget(
  raw: string | undefined,
): QualityBaseRefreshTargetV2;

export async function attestWritableQualityBaseTarget(input: {
  target: QualityBaseRefreshTargetV2;
  controlPlane: NeonControlPlane;
}): Promise<AttestedWritableQualityBaseTarget>;

export async function verifyHistoricalQualitySeedState(
  db: DrizzleDB,
  projection: HistoricalSharedPoolSeedProjection,
): Promise<void>; // exact seed state; requires quality metadata absent

export async function verifyHistoricalQualityPublishedState(
  db: DrizzleDB,
  projection: HistoricalSharedPoolSeedProjection,
): Promise<void>; // requires exact metadata/root and all round-tripped vectors

export async function refreshHistoricalQualityBase(
  db: DrizzleDB,
  projection: HistoricalSharedPoolSeedProjection,
  embedder: HistoricalQualityEmbedder,
): Promise<HistoricalQualityBaseAttestation>;

export async function assertReadOnlySession(
  query: (sql: string) => Promise<unknown>,
): Promise<"on">;
```

The embedder adapter exposes identity from the same resolved provider/model/dimensions used by its embedding calls. Do not duplicate environment resolution in the base command.

**Refresh and publication transaction sketch**

```ts
// Phase 1 commits an explicitly unpublished exact seed state.
await db.transaction(async (tx) => {
  await deleteQualityMetadata(tx);
  await assertNoUnexpectedQualityDependents(tx, projection);
  await replaceOnlyFixtureOwnedNonDocumentRows(tx, projection);
  await deleteFixtureOwnedCandidateDocumentsAndVectors(tx, projection);
  await verifyHistoricalQualitySeedState(tx, projection); // docs/vectors/metadata absent
});

// Provider work is outside all transactions and begins only after metadata is absent.
const providerVectors = await embedApprovedDocuments(
  projection.documents,
  embedder,
);

// Phase 2 publishes documents, DB-round-tripped vectors, and metadata atomically.
const attestation = await db.transaction(async (tx) => {
  await writeCandidateDocumentsAndVectors(tx, projection.documents, providerVectors);
  const roundTripped = await readVectorsByStableDocumentId(tx);
  const candidate = buildHistoricalQualityBaseAttestation({
    planFingerprint: historicalSharedPoolPlanFingerprint,
    seedProjectionFingerprint: historicalSharedPoolSeedFingerprint,
    documentSetFingerprint: historicalRetrievalDocumentFingerprint,
    embedding: embedder.identity,
    vectors: roundTripped.map(fingerprintRoundTrippedFloat32Vector),
  });
  await insertQualityMetadata(tx, candidate);
  await verifyHistoricalQualityPublishedState(tx, projection);
  return candidate;
});
```

`verifyHistoricalQualitySeedState` verifies exact users, one network, 25 memberships, 25 intents, 25 intent-network assignments, all premises/contexts and ownership links, opportunity absence, and candidate-document/vector/metadata absence. It does not accept published state. `verifyHistoricalQualityPublishedState` requires the metadata object/root and additionally verifies candidate documents, dimensions, finite DB-read vectors, stable document order, text/vector fingerprints, and explicit plan/seed/document/config mappings. The read-only verifier always calls the published-state verifier and fails when metadata is absent.

If final document/vector write, pgvector readback, candidate construction, metadata insertion, or full verification fails, the final transaction rolls back as one unit; external observers continue to see the already committed seed state with metadata absent, never candidate metadata or a partial vector set. Provider binary64 arrays are write inputs only and are never fingerprinted.

**Read-only verification sketch**

```ts
const [{ transactionReadOnly }] = await db.execute(sql`
  select current_setting('transaction_read_only') as "transactionReadOnly"
`);
if (transactionReadOnly !== "on") {
  throw new Error("Historical quality base verification session is not read-only");
}
console.log("Historical quality base verifier session read-only: on");
await verifyHistoricalQualityPublishedState(
  db,
  HISTORICAL_SHARED_POOL_SEED_PROJECTION,
);
```

The read-only verifier consumes the named projection rather than only a plan. It checks exact users, one network, 25 memberships, 25 intent-network assignments, premise/context rows, status/lifecycle fields, reviewed text fingerprints, document source links, 2000 finite dimensions, round-tripped float32 vector fingerprints, metadata object/root digest, and no fixture-actor opportunities. It constructs no embedder, Redis cache, graph, generator, evaluator, or judge.

**Checklist**

- [ ] Write provider-free lifecycle tests with injected DB, embedder, transaction visibility observer, and dependency factories.
- [ ] Add exact named seed-projection cardinality, stable order/link, scalar equality, and fingerprint-mapping assertions.
- [ ] Preserve only fixture-owned IDs; refuse unexpected dependents before deletion.
- [ ] Commit the metadata-absent seed state before provider-backed work and prove an observer cannot see published metadata during provider execution.
- [ ] Generate embeddings only for approved committed document text outside a transaction.
- [ ] Read provider/model/dimensions from the actual adapter identity.
- [ ] In one final transaction write candidate documents/vectors, read vectors back from pgvector, build the attestation from those float32 rows, insert metadata, run full published-state verification, and only then commit.
- [ ] Add visibility and mutation tests proving success publishes vectors/documents/metadata atomically and every final-phase throw rolls back candidate state while leaving metadata absent.
- [ ] Prove legacy metadata remains present and has null attestation.
- [ ] Require `--verify` to use a read-only session, require published metadata/root, and never fall back to seed-state verification or refresh.
- [ ] Strictly parse `DISCOVERY_QUALITY_BASE_REFRESH_TARGET`, attest exact project/base branch/endpoint/host/database and `type: "read_write"`, return a branded target, and bind the refresh runtime only from that brand.
- [ ] Add `bun run eval:discovery-quality-base-refresh-target:attest`; prove it uses only env parsing plus Neon control plane and makes zero provider, DB, reset, migration, or seed calls.
- [ ] Spawn refresh/verify runtime in a fresh process after target binding.
- [ ] Strip provider/Redis/control-plane variables from the verifier environment.
- [ ] Close DB resources on current, refreshed, stale, and failure paths.
- [ ] Independently review fixture ownership and deletion predicates.

**RED**

```bash
cd services/api
bun test src/cli/tests/discovery-quality-base.spec.ts
```

Expected: missing base lifecycle modules and embedder identity.

**GREEN**

```bash
cd services/api
bun test src/cli/tests/discovery-quality-base.spec.ts src/cli/tests/discovery-env-matrix-base.spec.ts
```

Expected: quality refresh/verify tests pass, verifier construction is provider-free, and legacy protected-base tests remain unchanged.

**Commit**

```bash
git add services/api/src/cli/discovery-quality-base.ts services/api/src/cli/discovery-quality-base.runtime.ts services/api/src/cli/discovery-quality-base.main.ts services/api/src/cli/discovery-quality-refresh-target.ts services/api/src/cli/tests/discovery-quality-base.spec.ts services/api/src/cli/tests/discovery-quality-refresh-target.spec.ts services/api/src/adapters/embedder.adapter.ts services/api/package.json
git commit -m "feat(api): seed and verify historical quality base"
```

### 4. Add strict v2 discovery manifests and base read-replica attestation

**Files**

- Modify: `services/api/src/cli/discovery.neon.ts`
- Modify: `services/api/src/cli/discovery-env-matrix.neon.ts`
- Modify: `services/api/src/cli/discovery.ts`
- Create: `services/api/src/cli/discovery-quality-read-replica.ts`
- Create: `services/api/src/cli/tests/discovery-quality-read-replica.spec.ts`
- Modify: `services/api/src/cli/tests/discovery.neon.spec.ts`
- Modify: `services/api/src/cli/tests/discovery-env-matrix.neon.spec.ts`
- Modify: `services/api/src/cli/tests/discovery.contract.spec.ts`

**Interfaces**

```ts
export type NeonEndpointType = "read_only" | "read_write";

export interface DiscoveryManifestV2 {
  version: 2;
  projectId: string;
  baseBranchId: string;
  baseReadReplica: {
    endpointId: string;
    databaseUrl: string;
  };
  targets: readonly [AbTarget, AbTarget];
}

export type DiscoveryManifest = LegacyAbManifest | DiscoveryManifestV2;

export function parseLegacyAbManifest(raw: string | undefined): LegacyAbManifest;
export function parseHistoricalQualityManifest(
  raw: string | undefined,
): DiscoveryManifestV2;

export async function attestHistoricalQualityTargets(input: {
  manifest: DiscoveryManifestV2;
  controlPlane: NeonControlPlane;
}): Promise<AttestedHistoricalQualityManifest>;
```

**Manifest sketch**

```json
{
  "version": 2,
  "projectId": "project-id",
  "baseBranchId": "base-branch-id",
  "baseReadReplica": {
    "endpointId": "base-read-replica-endpoint-id",
    "databaseUrl": "postgresql://credential@base-read-replica.neon.tech/protocol_eval"
  },
  "targets": [
    {
      "sideId": "a",
      "branchId": "child-a-branch-id",
      "endpointId": "child-a-endpoint-id",
      "databaseUrl": "postgresql://credential@child-a.neon.tech/protocol_eval"
    },
    {
      "sideId": "b",
      "branchId": "child-b-branch-id",
      "endpointId": "child-b-endpoint-id",
      "databaseUrl": "postgresql://credential@child-b.neon.tech/protocol_eval"
    }
  ]
}
```

The example values above are descriptive schema values, not deployable secrets.

Extend endpoint decoding with a strict `NeonEndpointType` union; reject missing/unknown values in quality attestation. Quality requires the base endpoint to be `read_only`, the separately attested writable refresh endpoint to be `read_write`, and both A/B child endpoints to be `read_write`. Each endpoint must belong to its exact branch and no endpoint/URL role may cross. Legacy A/B and matrix code may decode the field but must ignore it and retain existing acceptance rules.

**Attestation sketch**

```ts
if (base.name !== "eval-discovery-base" || base.primary) refuse();
if (replica.branchId !== base.id || replica.type !== "read_only") refuse();
if (!isEndpointHost(baseUrl.hostname, replica.host)) refuse();

for (const target of manifest.targets) {
  if (target.branchId === base.id || target.endpointId === replica.id) refuse();
  if (branch.parentId !== base.id || branch.primary) refuse();
  if (branch.name !== AB_BRANCH_NAMES[target.sideId]) refuse();
  if (endpoint.branchId !== branch.id || endpoint.type !== "read_write") refuse();
}
```

**Checklist**

- [ ] Add strict v2 parser tests before implementation.
- [ ] Reject v1/unversioned manifests in quality mode.
- [ ] Continue accepting legacy/unversioned manifests in legacy A/B mode.
- [ ] Accept v2 in legacy A/B by projecting the same two child targets.
- [ ] Require exact `/protocol_eval`, default/5432 port, Neon host, and unique IDs.
- [ ] Decode endpoint type as only `read_only | read_write`; require the base replica to be `read_only`, refresh endpoint and both children to be `read_write`.
- [ ] Reject writable base replica, read-only refresh/child, child endpoint as replica, replica or refresh endpoint as child, child endpoint as refresh, crossed A/B endpoints, crossed hosts, wrong project/branch, primary base, missing/unknown type, and malformed URL.
- [ ] Keep all password/API/control-plane response content out of errors.
- [ ] Keep the bootstrap’s static import closure free of DB/protocol dependencies.
- [ ] Implement `eval:discovery-quality-read-replica:provision` as a confirmation-gated control-plane-only command: exact base name/ID attestation first, create exactly one `read_only` endpoint and no branch, re-attest returned endpoint ownership/type, write the endpoint ID/host to the requested mode-0600 secure record, and make zero DB/provider/Redis/reset calls.
- [ ] Implement `eval:discovery-quality-read-replica:attest` as create-free control-plane attestation of the secure record/proposed v2 manifest; sanitized stdout contains only project/branch/endpoint IDs, endpoint type, and database name.
- [ ] Test missing/wrong confirmation, primary/wrong base, existing/crossed endpoint, API failure, unknown type, sanitized output, and zero DB/provider/reset construction.
- [ ] Re-run matrix v1 tests unchanged.
- [ ] Independently review parser strictness and endpoint crossing attacks.

**RED**

```bash
cd services/api
bun test src/cli/tests/discovery.neon.spec.ts src/cli/tests/discovery-env-matrix.neon.spec.ts src/cli/tests/discovery.contract.spec.ts
```

Expected: v2 quality parsing and read-replica assertions fail because only legacy A/B manifests exist.

**GREEN**

```bash
cd services/api
bun test src/cli/tests/discovery.neon.spec.ts src/cli/tests/discovery-env-matrix.neon.spec.ts src/cli/tests/discovery.contract.spec.ts src/cli/tests/discovery.gate.spec.ts
```

Expected: strict v2 quality tests pass while all legacy A/B and matrix v1 tests remain green.

**Commit**

```bash
git add services/api/src/cli/discovery.neon.ts services/api/src/cli/discovery-env-matrix.neon.ts services/api/src/cli/discovery.ts services/api/src/cli/discovery-quality-read-replica.ts services/api/src/cli/tests/discovery-quality-read-replica.spec.ts services/api/src/cli/tests/discovery.neon.spec.ts services/api/src/cli/tests/discovery-env-matrix.neon.spec.ts services/api/src/cli/tests/discovery.contract.spec.ts services/api/package.json
git commit -m "feat(api): attest discovery base read replica"
```

### 5. Implement pre-reset verification and the serial one-branch slot scheduler

**Files**

- Create: `services/api/src/cli/discovery-quality.runtime.ts`
- Create: `services/api/src/cli/discovery-quality.environment.ts`
- Modify: `services/api/src/cli/discovery.ts`
- Modify: `services/api/src/cli/discovery.main.ts`
- Modify: `services/api/src/cli/tests/discovery-quality.runtime.spec.ts`
- Modify: `services/api/src/cli/tests/discovery.parent.spec.ts`

**Interfaces**

```ts
export interface HistoricalQualityRuntimeDeps {
  attest(): Promise<AttestedHistoricalQualityManifest>;
  verifyBase(manifest: AttestedHistoricalQualityManifest): Promise<void>;
  restoreSelectedChild(
    manifest: AttestedHistoricalQualityManifest,
  ): Promise<void>;
  spawnSlot(input: {
    dispatch: HistoricalQualitySlotDispatch;
    environment: HistoricalQualityChildEnvironment;
  }): Promise<unknown>;
  validateSlotOutput(
    slot: HistoricalQualityPilotSlot,
    output: unknown,
  ): HistoricalQualityChildOutput;
}

export const HISTORICAL_QUALITY_RUNTIME_CORE_KEYS = [
  "DISCOVERY_TARGETS", "NEON_API_KEY", "DISCOVERY_CONFIRM",
  "TEST_DATABASE_SAFE", "NODE_ENV", "OPENROUTER_API_KEY",
] as const;

export const HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS = [
  "OPENROUTER_BASE_URL", "OPENROUTER_REQUEST_TIMEOUT_MS",
  "OPENROUTER_MAX_RETRIES", "OPENROUTER_FALLBACK_MODEL",
  "OPENROUTER_RUNNABLE_MAX_ATTEMPTS", "CHAT_MODEL",
  "CHAT_REASONING_EFFORT", "EMBEDDING_MODEL", "EMBEDDING_DIMENSIONS",
  "SMARTEST_VERIFIER_MODEL", "SMARTEST_GENERATOR_MODEL",
  "EVAL_MODEL_OVERRIDES",
] as const;

export const HISTORICAL_QUALITY_RUNTIME_REDIS_KEYS = [
  "REDIS_URL", "REDIS_HOST", "REDIS_PORT", "REDIS_PASSWORD", "REDIS_DB",
] as const;

export type HistoricalQualityRuntimeEnvironment = Readonly<
  Record<(typeof HISTORICAL_QUALITY_RUNTIME_CORE_KEYS)[number], string>
  & Partial<Record<(typeof HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS)[number], string>>
  & (
    | { REDIS_URL: string; REDIS_HOST?: never; REDIS_PORT?: never; REDIS_PASSWORD?: never; REDIS_DB?: never }
    | { REDIS_URL?: never; REDIS_HOST: string; REDIS_PORT: string; REDIS_PASSWORD: string; REDIS_DB: string }
  )
>;

export type HistoricalQualityChildEnvironment =
  HistoricalQualityRuntimeEnvironment & {
    readonly DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON: string;
  };

export function buildHistoricalQualityChildEnvironment(input: {
  parentEnvironment: Readonly<Record<string, string | undefined>>;
  sanitizedConfiguration: Readonly<Record<DiscoveryEnvKey, string>>;
  configurationFingerprint: string;
}): HistoricalQualityChildEnvironment;

export function parseHistoricalQualityRuntimeEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): HistoricalQualityRuntimeEnvironment;

export async function runHistoricalQualityParent(
  request: HistoricalQualityRequest,
  deps: HistoricalQualityRuntimeDeps,
): Promise<HistoricalQualityParentResult>;
```

**Ordering sketch**

```ts
const plan = buildHistoricalQualityPilotPlan(request.planInput);
const manifest = await deps.attest();

await deps.verifyBase(manifest); // fresh process; awaits close

for (const slot of plan.slots) {
  await deps.restoreSelectedChild(manifest); // side a only
  const output = await deps.spawnSlot({
    dispatch: toOpaqueDispatch(runId, slot),
    environment: buildHistoricalQualityChildEnvironment({
      parentEnvironment: process.env,
      sanitizedConfiguration: request.resolvedAllowedConfiguration,
      configurationFingerprint: slot.configurationFingerprint,
    }),
  });
  accepted.push(deps.validateSlotOutput(slot, output));
}
```

`verifyBase` spawns `discovery-quality-base.runtime.ts --verify` with a minimal environment containing only the base read-replica URL and non-secret process necessities. It waits for exit `0` and closed stdout/stderr before the first restore.

For slot children, `buildHistoricalQualityChildEnvironment` creates a new object from the constants above; it never spreads or returns parent `process.env`. It validates required core keys (`DISCOVERY_CONFIRM=1`, `TEST_DATABASE_SAFE=1`, manifest, Neon key, node mode, and OpenRouter key), copies only defined exact model keys, and requires exactly one Redis form (`REDIS_URL`, or the complete `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_DB` set). It rejects `DATABASE_URL` as an input/output key. Separately, it strictly validates/canonicalizes the PR A discovery allowlist into `DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON` and verifies the supplied fingerprint. Config JSON is environment-only and never appended to argv; runtime secrets are never copied into it.

The scheduler never calls `runBoundedChildTasks`; concurrency is exactly one. Each restore reuses the branded v2 manifest and waits for all reported Neon operations.

**Checklist**

- [ ] Replace PR A’s runtime-unavailable quality refusal with additive PR B dispatch.
- [ ] Keep `--help` above confirmation, manifest, network, DB, and runtime imports.
- [ ] Build the plan only with `buildHistoricalQualityPilotPlan`.
- [ ] Fix selected target to side `a`; prove side `b` reset is never requested.
- [ ] Spawn and await the verifier before entering the slot loop.
- [ ] Prove verifier failure leaves restore/spawn call counts at zero.
- [ ] Restore exactly once per planned slot.
- [ ] Spawn exactly one child after each completed restore.
- [ ] Await and validate each child before the next restore.
- [ ] Pass only opaque run/slot/config IDs and output path in argv; no configuration value or runtime secret may enter argv.
- [ ] Implement the exact runtime key constants, `HistoricalQualityRuntimeEnvironment`, `HistoricalQualityChildEnvironment`, and from-scratch `buildHistoricalQualityChildEnvironment`; do not spread/copy parent `process.env`.
- [ ] Keep `DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON` limited to strict PR A allowlisted discovery config and recompute its fingerprint; keep manifest, gates, Neon/OpenRouter secrets, model runtime config, and Redis values in the separate minimal runtime portion only.
- [ ] Add parent tests proving all required core keys arrive, every defined exact model key arrives, both permitted Redis forms work, missing/ambiguous Redis forms fail, and arbitrary parent keys (`DATABASE_URL`, `PATH`, `HOME`, `AWS_SECRET_ACCESS_KEY`, `SENTRY_DSN`, and invented keys) do not arrive.
- [ ] Seed each secret with a unique sentinel and prove none appears in argv, config JSON, logs, sanitized errors, child output, or artifacts; preserve existing redaction for manifest URLs, Neon/OpenRouter credentials, and Redis URL/password.
- [ ] Preserve parent spend-stage reporting for restore and spawn failures.
- [ ] Independently review the destructive call site, not only helper tests.

**RED**

```bash
cd services/api
bun test src/cli/tests/discovery-quality.runtime.spec.ts src/cli/tests/discovery.parent.spec.ts src/cli/tests/discovery.quality.spec.ts
```

Expected: ordering and dispatch tests fail because quality still has no parent runtime.

**GREEN**

```bash
cd services/api
bun test src/cli/tests/discovery-quality.runtime.spec.ts src/cli/tests/discovery.parent.spec.ts src/cli/tests/discovery.quality.spec.ts
```

Expected: ten-slot plans produce `verify, restore, spawn, validate` in strict serial order; base failure performs no destructive work; legacy parent tests remain green.

**Commit**

```bash
git add services/api/src/cli/discovery-quality.runtime.ts services/api/src/cli/discovery-quality.environment.ts services/api/src/cli/discovery.ts services/api/src/cli/discovery.main.ts services/api/src/cli/tests/discovery-quality.runtime.spec.ts services/api/src/cli/tests/discovery.parent.spec.ts services/api/src/cli/tests/discovery.quality.spec.ts
git commit -m "feat(api): schedule serial historical quality slots"
```

### 6. Verify restored children before dependencies and isolate HyDE cache state

**Files**

- Create: `services/api/src/cli/discovery-quality.child.ts`
- Create: `services/api/src/cli/discovery-quality.cache.ts`
- Create: `services/api/src/cli/tests/discovery-quality.child.spec.ts`
- Modify: `services/api/src/cli/discovery.ts`
- Modify: `services/api/src/cli/tests/discovery.child.spec.ts`
- Modify: `services/api/src/adapters/tests/cache.adapter.isolated.ts`

**Interfaces**

```ts
export const HistoricalQualitySlotDispatchSchema = z.object({
  runId: z.string().regex(/^hq-run-[a-f0-9]{32}$/),
  slotId: z.string().regex(/^hq-slot-[a-f0-9]{64}$/),
  configurationId: z.literal("a"),
  configurationFingerprint: sha256Schema,
}).strict();

export const HistoricalQualityChildConfigurationSchema = z
  .record(z.string(), z.string())
  .superRefine((value, ctx) => {
    rejectUnknownKeys(value, DISCOVERY_ENV_KEYS, ctx);
    rejectCredentialKeysAndValues(value, ctx);
  });

// HistoricalQualityChildEnvironment and its separate runtime/config portions
// are imported from discovery-quality.environment.ts; do not redeclare them.
export function parseHistoricalQualityChildConfiguration(input: {
  raw: string | undefined;
  expectedFingerprint: string;
}): Readonly<Record<DiscoveryEnvKey, string>>;

export class NamespacedHydeCache implements HydeCache {
  constructor(inner: HydeCache, namespaceSeed: {
    runId: string;
    slotId: string;
    configurationId: "a";
  });
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: CacheOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}

export async function runHistoricalQualityChild(
  dispatch: HistoricalQualitySlotDispatch,
  deps: HistoricalQualityChildDeps,
): Promise<HistoricalQualityChildOutput>;
```

**Namespace sketch**

```ts
const digest = createHash("sha256")
  .update(fingerprintCanonicalJson(seed))
  .digest("hex");

this.prefix = `historical-quality:v1:${digest}:`;

private key(key: string): string {
  if (key.includes("\n") || key.length > 1024) {
    throw new Error("Historical quality cache key is invalid");
  }
  return `${this.prefix}${key}`;
}
```

Every operation delegates through the prefix; no raw inner cache is exposed. Namespace uniqueness is tested across run, slot, and configuration IDs.

**Child ordering sketch**

```ts
const configuration = parseHistoricalQualityChildConfiguration({
  raw: process.env.DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON,
  expectedFingerprint: dispatch.configurationFingerprint,
});
const runtimeEnvironment = parseHistoricalQualityRuntimeEnvironment(process.env);
const attested = await reattestExactSelectedChild({
  manifest: runtimeEnvironment.DISCOVERY_TARGETS,
  neonApiKey: runtimeEnvironment.NEON_API_KEY,
  dispatch,
});
// DATABASE_URL is neither inherited nor accepted by the runtime-env parser.
const databaseUrl = deriveAttestedChildDatabaseUrl(attested, dispatch.configurationId);
const verifierDb = await openHistoricalQualityVerifierDb(databaseUrl);
await verifyHistoricalQualityPublishedState(
  verifierDb,
  HISTORICAL_SHARED_POOL_SEED_PROJECTION,
);
await verifierDb.close();

const deps = await createHistoricalQualityDependencies({
  configuration,
  runtimeEnvironment,
  databaseUrl,
  cache: new NamespacedHydeCache(new RedisCacheAdapter(), dispatch),
});

return executeExactlyOneHistoricalQualitySlot(dispatch, deps);
```

The verifier DB connection closes before constructing the embedder, Redis adapter, HyDE graph, opportunity graph, or evaluator. A namespaced Redis miss must fall back to the approved restored DB document; a test injects a generator that throws and proves it is never called.

**Checklist**

- [ ] Add strict dispatch parsing and unknown-key rejection.
- [ ] Parse only `DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON`, reject malformed/non-string/unknown/credential keys and credential-like values, canonicalize key order, recompute the fingerprint, and reject a mismatch before attestation or dependencies.
- [ ] Add tests proving no configuration appears in argv, allowed JSON round-trips, ordering does not change the digest, runtime secrets cannot enter child config JSON, and arbitrary/non-allowlisted parent variables cannot enter the runtime environment.
- [ ] Strictly parse the separately allowlisted runtime environment; prove required gates/manifest/Neon/OpenRouter/Redis keys arrive and unknown keys plus parent `DATABASE_URL` are absent.
- [ ] Re-attest the selected branch and exact URL/endpoint binding, then derive `DATABASE_URL` only from the attested selected target; reject any parent-supplied `DATABASE_URL` and prove it is never consulted.
- [ ] Verify quality metadata and fixture state before dependency construction.
- [ ] Close verifier DB before provider dependency construction.
- [ ] Prove stale metadata, wrong URL, wrong slot, and wrong branch construct no dependency.
- [ ] Prefix get/set/delete/exists and prohibit prefix escape.
- [ ] Prove namespaces differ for every run/slot/config change.
- [ ] Prove an empty namespace cache reads approved DB documents without generator calls.
- [ ] Never flush Redis or call `deleteByPattern`.
- [ ] Close DB and Redis after success, graph failure, artifact failure, and partial construction.
- [ ] Preserve legacy child behavior and opaque argv assertions.
- [ ] Independently review construction order and Redis key bounds.

**RED**

```bash
cd services/api
bun test src/cli/tests/discovery-quality.child.spec.ts src/cli/tests/discovery.child.spec.ts src/adapters/tests/cache.adapter.isolated.ts
```

Expected: missing child runtime/cache decorator and verification-order failures.

**GREEN**

```bash
cd services/api
bun test src/cli/tests/discovery-quality.child.spec.ts src/cli/tests/discovery.child.spec.ts src/adapters/tests/cache.adapter.isolated.ts
```

Expected: configuration fingerprint verification and manifest re-attestation precede child `DATABASE_URL` derivation, verification precedes expensive dependency construction, cache operations are fully namespaced, DB fallback avoids generation, and resources close on every terminal path.

**Commit**

```bash
git add services/api/src/cli/discovery-quality.child.ts services/api/src/cli/discovery-quality.cache.ts services/api/src/cli/tests/discovery-quality.child.spec.ts services/api/src/cli/discovery.ts services/api/src/cli/tests/discovery.child.spec.ts services/api/src/adapters/tests/cache.adapter.isolated.ts
git commit -m "feat(api): isolate historical quality child runtime"
```

### 7. Execute both production-shaped triggers and project sanitized quality metrics

**Files**

- Modify: `services/api/src/cli/discovery-quality.child.ts`
- Modify: `services/api/src/cli/tests/discovery-quality.child.spec.ts`

**Interfaces**

- Consumes:
  - PR A `buildIntentDiscoveryTrigger`
  - PR A `buildEnrichmentDiscoveryTrigger`
  - PR A `dedupeHistoricalRetrieval`
  - PR A `buildHistoricalParticipantMetrics`
  - Exact shared-pool stable-ID mapping
  - Restored graph result state
- Produces:
  - One terminal quality row parsed by PR A `HistoricalQualityTransportRowSchema`
  - One execution run parsed by PR A `HistoricalQualityExecutionRunSchema`
  - Exactly 24 participant metrics
  - No raw model/provider content

**Execution sketch**

```ts
const triggerInput = slot.trigger === "intent"
  ? buildIntentDiscoveryTrigger({
      userId: source.userId,
      searchQuery: persistedIntent.payload,
      networkIds: [plan.network.id],
      triggerIntentId: source.intentId,
    })
  : buildEnrichmentDiscoveryTrigger({
      userId: source.userId,
      networkId: plan.network.id,
    });

// `configuration` is the child-local value returned by strict JSON parsing
// and fingerprint verification in Task 6. Pilot slots carry only its fingerprint.
const result = await withDiscoveryEnvironment(
  configuration,
  () => opportunityGraph.invoke(triggerInput, { signal }),
);
```

Before either builder, verify source ownership, active intent lifecycle, exact shared-network membership, exact intent-network assignment, premise/context IDs, and the reviewed base fingerprints.

**Sanitized projection sketch**

```ts
const retrievalRows: HistoricalRetrievalEvidenceRow[] =
  result.candidates.flatMap((candidate) => [
    candidate.candidateIntentId && {
      participantId: participantIdByUserId(candidate.candidateUserId),
      score: candidate.similarity,
      evidenceType: "intent",
      evidenceId: candidate.candidateIntentId,
    },
    candidate.candidatePremiseId && {
      participantId: participantIdByUserId(candidate.candidateUserId),
      score: candidate.similarity,
      evidenceType: "premise",
      evidenceId: candidate.candidatePremiseId,
    },
    candidate.candidateContextId && {
      participantId: participantIdByUserId(candidate.candidateUserId),
      score: candidate.similarity,
      evidenceType: "user_context",
      evidenceId: candidate.candidateContextId,
    },
  ].filter(isEvidenceRow));

const retrieved = dedupeHistoricalRetrieval(retrievalRows);
const finalOrder = projectThresholdedEvaluatorOrder(
  result.evaluatedOpportunities,
  source.userId,
);
```

Evaluator state rules:

- `eligible`: candidate remains after membership/cooldown eligibility.
- `submitted`: candidate appears in candidate evaluation trace or candidate-specific failure trace.
- `returned`: candidate trace contains a finite evaluator score.
- `finalRank`: one-based position in thresholded `evaluatedOpportunities` only.

Reject unknown users, source-as-candidate, duplicate final counterparts, unplanned evidence IDs, non-finite similarity/score, or final entries absent from retrieval.

**One-attempt sketch**

```ts
const batch = await executeRuns(invokeSlot, 1, {
  caseId: transportCaseId,
  policy: "strict",
  maxAttempts: 1,
  retryDelayMs: 0,
  attemptTimeoutMs: HISTORICAL_QUALITY_ATTEMPT_TIMEOUT_MS,
  label: "historical-quality",
});
const execution = HistoricalQualityExecutionRunSchema.parse({
  ...projectExecutionRun(batch),
  recovered: false,
  attempts: [{ ...projectOnlyAttempt(batch), retryable: false, backoffMs: 0 }],
});
```

**Checklist**

- [ ] Test exact intent builder parity and persisted audited search query.
- [ ] Test exact enrichment builder parity and absence of query/trigger intent.
- [ ] Assert neither queue module is imported or invoked.
- [ ] Assert no queue callbacks, negotiation jobs, mining, or narration run.
- [ ] Execute under the parsed, canonicalized, fingerprint-verified local `configuration` returned in Task 6; never read nonexistent `slot.configuration` or reconstruct config from the slot.
- [ ] Add an exact-binding test with distinguishable parent, planned-fingerprint, and parsed-child values: assert `withDiscoveryEnvironment` receives the parsed child `configuration` byte-for-byte, the fingerprint matches the slot, and neither parent env nor a slot field can substitute another value.
- [ ] Extract only stable IDs, finite scalars, evidence kinds, and safe error classes.
- [ ] Use PR A retrieval dedupe and participant metric builders.
- [ ] Distinguish eligible, submitted, returned, and final inclusion.
- [ ] Derive final rank only from thresholded evaluator order.
- [ ] Produce exactly 24 metrics in canonical participant-ID order.
- [ ] Run exactly one attempt with no retry/backoff and parse the result through PR A's canonical schemas; completed means one success attempt, terminal failure means one failed/timeout attempt, always `recovered: false`, `retryable: false`, `backoffMs: 0`.
- [ ] Add mutation tests for a second execution call/attempt, recovered true, retryable true, nonzero backoff, completed-with-failed-attempt, and failed-with-success-attempt.
- [ ] Search serialized output for fixture text, prompts, citations, URLs, reasons, review data, provider errors, headers, and credentials.
- [ ] Independently review projection against actual graph state fields.

**RED**

```bash
cd services/api
bun test src/cli/tests/discovery-quality.child.spec.ts
```

Expected: trigger/projection tests fail because the child verifies but does not yet invoke or project the production graph.

**GREEN**

```bash
cd services/api
bun test src/cli/tests/discovery-quality.child.spec.ts src/queues/tests/discovery-trigger.builders.spec.ts src/queues/tests/from-intent.queue.isolated.ts src/queues/tests/from-enrichment.queue.isolated.ts
```

Expected: both triggers are builder-identical to production, the child attempts exactly once, metrics match PR A contracts, and queue behavior remains unchanged.

**Commit**

```bash
git add services/api/src/cli/discovery-quality.child.ts services/api/src/cli/tests/discovery-quality.child.spec.ts
git commit -m "feat(api): execute dual-trigger quality slots"
```

### 8. Enforce strict child aggregation, diagnostic artifacts, no-verdict, and cleanup

**Files**

- Create: `services/api/src/cli/tests/discovery-quality.artifact.spec.ts`
- Modify: `services/api/src/cli/discovery-quality.child.ts`
- Modify: `services/api/src/cli/discovery-quality.runtime.ts`
- Modify: `services/api/src/cli/discovery.contract.ts`
- Modify: `services/api/src/cli/tests/discovery.contract.spec.ts`

**Interfaces**

`HistoricalQualityTransportRowSchema`, `HistoricalQualityExecutionRunSchema`, and both inferred types are imported from PR A's protocol package. PR B defines only the one-file wrapper below and must not redeclare either row/run schema.

```ts
export const HistoricalQualityChildOutputSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  slotId: z.string(),
  configurationId: z.literal("a"),
  rows: z.tuple([HistoricalQualityTransportRowSchema]),
  execution: z.tuple([HistoricalQualityExecutionRunSchema]),
}).strict();

export function aggregateHistoricalQualityChildren(input: {
  plan: HistoricalQualityPilotPlan;
  outputs: readonly HistoricalQualityChildOutput[];
  diagnostics: readonly HistoricalQualityParentDiagnostic[];
}): HistoricalQualityRunArtifact;

export async function writeOperationalDiagnosticBestEffort(input: {
  plan: HistoricalQualityPilotPlan;
  acceptedOutputs: readonly HistoricalQualityChildOutput[];
  primaryFailure: SanitizedOperationalFailure;
  reportPath: string;
  writer: HistoricalQualityArtifactWriter;
}): Promise<{ written: boolean; artifactWriteFailure?: SanitizedOperationalFailure }>;
```

**Validation sketch**

```ts
const expected = new Map(plan.slots.map((slot) => [slot.slotId, slot]));
const seen = new Set<string>();

for (const output of outputs) {
  const parsed = HistoricalQualityChildOutputSchema.parse(output);
  const row = parsed.rows[0];
  const slot = expected.get(parsed.slotId);
  if (!slot) throw new Error("unplanned historical quality slot output");
  if (seen.has(parsed.slotId)) throw new Error("duplicate historical quality slot output");
  assertRowMatchesSlotExactly(row, slot);
  seen.add(parsed.slotId);
}

const missing = [...expected.keys()].filter((id) => !seen.has(id));
```

A child catches graph/evaluator failure or its own attempt timeout, sanitizes it, emits one failed execution row with 24 `failureStage: "execution"` participant metrics and exactly one failed/timeout attempt, and exits successfully after writing. Parent validates that row, continues later planned slots, and ultimately emits diagnostic artifact/exit `3`. This is distinct from the parent supervisor/process timeout: if the child is killed or exceeds supervisor timeout without a valid artifact, it is operational exit `4` and scheduling stops.

For restore, spawn, supervisor-timeout, missing, or malformed failures, call `writeOperationalDiagnosticBestEffort` before exit `4` whenever the report path and writer remain available. The report is sanitized, includes accepted rows plus an opaque safe failure class, sets `qualityVerdictAvailable: false`, has no partial quality summary, and never claims a missing child file exists. If artifact writing itself fails, report a separate sanitized `artifact-write-failure` after the primary operational failure; never replace or downgrade the primary exit `4`.

For a completed scheduling pass with any terminal failed slot:

```ts
measurement.qualityVerdictAvailable = false;
qualitySummary = null;
console.log("no quality verdict");
process.exitCode = 3;
```

Never average the completed subset.

**Checklist**

- [ ] Require exactly one row and one execution run per child file.
- [ ] Reject missing, duplicate, unplanned, wrong-case, wrong-trigger, wrong-repetition, wrong-config, and wrong transport IDs.
- [ ] Require requested plan cardinality to match artifact measurement counts.
- [ ] Persist every terminal graph failure and child-owned attempt timeout as one sanitized failed row, continue scheduling, suppress quality summary, and exit `3` only after a valid diagnostic artifact is written.
- [ ] Test supervisor/process timeout without a valid artifact separately: stop scheduling, best-effort diagnostic report, and exit `4`.
- [ ] Suppress the entire quality summary if any slot is incomplete.
- [ ] Print the exact phrase `no quality verdict`.
- [ ] Exit `3` only after a valid diagnostic run artifact is written.
- [ ] Preserve exit `4` spend reporting for reset/restore/spawn/supervisor-timeout/missing/malformed failures.
- [ ] For every operational class, test best-effort sanitized unavailable-verdict report writing when possible, plus writer-unavailable and writer-throws paths; report artifact-write failure separately without masking the primary class.
- [ ] Retain useful child diagnostics on operational failure without claiming absent files exist.
- [ ] Remove temporary child files only after a fully handled result.
- [ ] Close resources without masking the primary failure.
- [ ] Validate the final artifact through PR A’s real V2 schema before writing.
- [ ] Independently review complete, failed-slot, missing-child, and cleanup paths.

**RED**

```bash
cd services/api
bun test src/cli/tests/discovery-quality.artifact.spec.ts src/cli/tests/discovery.contract.spec.ts
```

Expected: missing strict aggregation and incomplete-run artifact behavior.

**GREEN**

```bash
cd services/api
bun test src/cli/tests/discovery-quality.artifact.spec.ts src/cli/tests/discovery-quality.runtime.spec.ts src/cli/tests/discovery-quality.child.spec.ts src/cli/tests/discovery.contract.spec.ts src/cli/tests/discovery.artifact.spec.ts
```

Expected: complete runs validate; graph failures and child attempt timeouts with valid rows continue then write diagnostics/exit `3`; supervisor timeout and malformed/missing child output best-effort write diagnostics and retain exit `4`; artifact-writer failure is separately reported; legacy artifacts remain valid.

**Commit**

```bash
git add services/api/src/cli/discovery-quality.runtime.ts services/api/src/cli/discovery-quality.child.ts services/api/src/cli/discovery.contract.ts services/api/src/cli/tests/discovery-quality.artifact.spec.ts services/api/src/cli/tests/discovery.contract.spec.ts
git commit -m "feat(api): aggregate guarded quality evidence"
```

### 9. Add guarded DB evidence and atomically document manifest/secret operations

**Files**

- Create: `services/api/src/cli/discovery-quality-db-test.guard.ts`
- Create: `services/api/src/cli/tests/discovery-quality-base.integration.spec.ts`
- Create: `docs/guides/ind-638-historical-quality-pilot.md`
- Modify: `services/api/package.json`
- Modify: `.env.example`
- Modify: `docs/guides/development-reference.md`
- Modify: `packages/protocol/eval/ops/README.md`
- Modify: `packages/protocol/eval/ops/tests/server.spec.ts`

**Interfaces**

```ts
export async function proveDisposableQualityTestTarget(input: {
  manifest: DiscoveryManifestV2;
  selectedSide: "a";
  databaseUrl: string;
  controlPlane: NeonControlPlane;
}): Promise<{
  projectId: string;
  branchId: string;
  endpointId: string;
  databaseName: "protocol_eval";
  primary: false;
  parentBranchId: string;
}>;
```

The proof verifies exact manifest binding, selected child A, non-primary status, parent `eval-discovery-base`, exact endpoint host, and `/protocol_eval`. It prints identifiers only, never a URL or credential.

**Guarded integration coverage**

- Exact named seed-projection rows, scalar values, order, and ownership/membership/assignment/document links.
- Legacy metadata row remains valid/null.
- Metadata is absent during provider work; final vectors/documents/metadata become visible atomically.
- Every injected final-transaction failure rolls back candidate documents/vectors/metadata and leaves quality metadata absent.
- Quality metadata object/root with explicit plan/seed-projection/document fingerprints.
- Stale corpus, plan, seed projection, document, configuration, text, and vector detection.
- Missing/extra/malformed vector detection and pgvector round-trip float32 digest proof using `0.1`.
- Fixture-owned refresh replacement.
- Unexpected dependent/opportunity refusal.
- Read-only verifier performs zero writes.
- Restored-child state equals verified base state.
- Provider seams mocked; no model/provider call.

**Proof and DB command**

```bash
cd services/api
test "${TEST_DATABASE_SAFE:-}" = "1"
test -n "${DATABASE_URL:-}"
test -n "${NEON_API_KEY:-}"
test -n "${DISCOVERY_TARGETS:-}"

bun run eval:discovery-quality-db-target:prove -- --side a
TEST_DATABASE_SAFE=1 bun test src/cli/tests/discovery-quality-base.integration.spec.ts
```

Expected proof output names project, non-primary child branch, `read_write` endpoint ID/type, parent base branch, and `databaseName=protocol_eval` without printing the URL. If proof fails, do not run the integration spec. Since PR B implements DB behavior, this proof and suite are not optional merge evidence: authorization may delay them and the PR may remain open, but no merge-ready declaration, merge, or rollout is allowed until both commands actually pass and their revisions/output are recorded.

**Documentation requirements**

The v2 secret migration is atomic:

1. Provision and attest the read replica.
2. Construct and validate v2 `DISCOVERY_TARGETS` locally.
3. Update the Eval Ops `DISCOVERY_TARGETS` secret in one operation.
4. Run legacy A/B provider-free parsing and one separately confirmed legacy smoke if authorized.
5. Do not delete the previous secret value from the operator’s secure rollback record until validation passes.

Quality remains absent from Ops launch registry. The server continues to launch legacy A/B using the v2 manifest’s child projection.

**Checklist**

- [ ] Write the guarded integration spec with `describe.skipIf(TEST_DATABASE_SAFE !== "1")`.
- [ ] Keep the internal proof guard active even when the describe gate is set.
- [ ] Refuse any URL not exactly the attested selected child.
- [ ] Mock embedder/provider seams in DB tests.
- [ ] Run provider-free tests before considering DB authorization.
- [ ] Treat target proof plus the full guarded integration spec as a hard pre-merge gate; record actual command, target identifiers, revision, exit, and test count in the PR B receipt. `not run` blocks merge readiness.
- [ ] Add exact read-replica create/attest, writable-refresh attest, quality refresh, verify, smoke, and pilot commands to the runbook.
- [ ] Document separate writable refresh target and read-replica verify target.
- [ ] Document every explicit confirmation and no-auto-rerun stop.
- [ ] Update `.env.example` without real IDs, URLs, or credentials.
- [ ] Update Ops server fixture to v2 while proving legacy launch compatibility.
- [ ] Confirm no quality launch control or Eval Ops package bump appears.
- [ ] Independently review operational safety and secret rollback steps.

**RED**

```bash
cd services/api
bun test src/cli/tests/discovery-quality-base.integration.spec.ts
cd ../../packages/protocol
bun test eval/ops/tests/server.spec.ts
```

Expected: the integration spec is safely skipped without authorization; Ops v2 secret-shape tests fail until fixtures/documented projection are updated.

**GREEN — provider-free**

```bash
cd services/api
bun test src/cli/tests/discovery-quality-base.spec.ts src/cli/tests/discovery-quality-attestation.spec.ts
cd ../../packages/protocol
bun test eval/ops/tests/server.spec.ts
```

Expected: deterministic tests pass and DB-backed tests remain untouched.

**GREEN — only when authorized proof succeeds**

```bash
cd services/api
bun run eval:discovery-quality-db-target:prove -- --side a
TEST_DATABASE_SAFE=1 bun test src/cli/tests/discovery-quality-base.integration.spec.ts
```

Expected: proof confirms the dedicated disposable `/protocol_eval` child; all seed, stale, ownership, vector, opportunity, and restore-state tests pass with providers mocked.

**Commit**

```bash
git add services/api/src/cli/discovery-quality-db-test.guard.ts services/api/src/cli/tests/discovery-quality-base.integration.spec.ts services/api/package.json .env.example docs/guides/ind-638-historical-quality-pilot.md docs/guides/development-reference.md packages/protocol/eval/ops/README.md packages/protocol/eval/ops/tests/server.spec.ts
git commit -m "docs(api): govern historical quality operations"
```

### 10. Version, validate, independently review, and hand off PR B without merging

**Files**

- Modify: `services/api/package.json`
- Modify: `bun.lock`
- Create: `docs/research/2026-08-07-ind-638b-validation-receipt.md`
- Modify only when validation finds a concrete defect:
  - Affected Task 1–9 source/test files

**Interfaces**

- Consumes:
  - Final committed PR B head
  - Actual deterministic and authorized DB evidence
  - Actual independent review
  - Actual PR/check snapshot
- Produces:
  - API `0.79.0`
  - Protocol `10.1.0`
  - Unchanged Eval Ops version
  - Current root lockfile
  - Actual validation receipt and PR handoff

**Version assertions**

```bash
bun -e '
const api=await Bun.file("services/api/package.json").json();
const protocol=await Bun.file("packages/protocol/package.json").json();
const ops=await Bun.file("apps/eval-ops/package.json").json();
if(api.version!=="0.79.0") throw new Error("API must be 0.79.0");
if(protocol.version!=="10.1.0") throw new Error("Protocol must remain 10.1.0");
if(ops.version!=="0.6.0") throw new Error("Eval Ops version changed");
'
```

If merged PR A’s Eval Ops version differs from `0.6.0`, preserve that merged value and change the assertion to compare against `git show origin/dev:apps/eval-ops/package.json`; do not bump it in PR B.

**Checklist**

- [ ] Change API version only from `0.78.0` to `0.79.0`.
- [ ] Confirm no protocol source changed and protocol remains `10.1.0`.
- [ ] Confirm Eval Ops version is unchanged from rebased `origin/dev`.
- [ ] Run `bun install` and commit root `bun.lock`.
- [ ] Run every provider-free targeted test and static/build check below.
- [ ] Run migration no-drift and inspect generated files.
- [ ] Obtain separate authorization, prove the exact disposable target, and run the full guarded DB suite. Record actual revision/target identifiers/commands/exits/test count. If either is not run or fails, keep PR B explicitly not merge-ready; do not merge or begin rollout.
- [ ] Search for unfinished markers, forbidden raw fields, comparison planner usage, retries, and quality launch controls.
- [ ] Inspect complete diff, `git diff --check`, and staged state.
- [ ] Request independent review of the exact final head.
- [ ] Resolve every blocking finding and rerun affected checks.
- [ ] Create the validation receipt only with actual revisions/results.
- [ ] Push, fetch, reconcile upstream, and snapshot the PR.
- [ ] Stop for explicit merge authorization through `manage-pr`.

**Provider-free final validation**

```bash
bun install
bun install --frozen-lockfile
bun run check:subtree-parity

cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts eval/discovery-env-matrix/tests/historical-quality.pilot.spec.ts eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts
bun test eval/shared/tests/artifact.spec.ts eval/ops/tests/server.spec.ts eval/ops/tests/artifacts.spec.ts eval/ops/tests/compare.spec.ts
bun run eval:verify
bun run build
bun run architecture:exports
bun run architecture:consumer
bun run architecture:host-isolation
bun run architecture:capabilities
bun run architecture:cycles
bun run architecture:artifacts

cd ../../services/api
bun test src/cli/tests/discovery-quality.contract-audit.spec.ts src/cli/tests/discovery-quality-attestation.spec.ts src/cli/tests/discovery-quality-base.spec.ts src/cli/tests/discovery-quality-refresh-target.spec.ts src/cli/tests/discovery-quality-read-replica.spec.ts src/cli/tests/discovery-quality.runtime.spec.ts src/cli/tests/discovery-quality.child.spec.ts src/cli/tests/discovery-quality.artifact.spec.ts
bun test src/cli/tests/discovery.quality.spec.ts src/cli/tests/discovery.contract.spec.ts src/cli/tests/discovery.gate.spec.ts src/cli/tests/discovery.neon.spec.ts src/cli/tests/discovery.parent.spec.ts src/cli/tests/discovery.child.spec.ts src/cli/tests/discovery.artifact.spec.ts
bun test src/cli/tests/discovery-env-matrix-base.spec.ts src/cli/tests/discovery-env-matrix.neon.spec.ts src/cli/tests/discovery-env-matrix.spec.ts
bun test src/queues/tests/discovery-trigger.builders.spec.ts src/queues/tests/from-intent.queue.isolated.ts src/queues/tests/from-enrichment.queue.isolated.ts
bun run db:generate
bun run typecheck:cli-specs
bun run build
bun run lint

cd ../..
bun run skills:validate
git diff --check
git status --short
git diff --stat
if git grep -n 'buildHistoricalExperimentPlan' -- 'services/api/src/cli/discovery-quality*' docs/guides/ind-638-historical-quality-pilot.md; then exit 1; fi
if git grep -nE 'maxAttempts:[[:space:]]*[2-9]|retryDelayMs:[[:space:]]*[1-9]|backoffMs:[[:space:]]*[1-9]|retryable:[[:space:]]*true|recovered:[[:space:]]*true' -- 'services/api/src/cli/discovery-quality*'; then exit 1; fi
unfinishedMarker='place''holder'
if git grep -nE "TBD|FIXME|TODO|<${unfinishedMarker}>" -- 'services/api/src/cli/discovery-quality*' docs/guides/ind-638-historical-quality-pilot.md docs/research/2026-08-07-ind-638b-validation-receipt.md; then exit 1; fi
if git grep -nE 'const HistoricalQuality(TransportRow|ExecutionRun)Schema[[:space:]]*=' -- services/api; then exit 1; fi
```

**Mandatory guarded DB pre-merge gate (separately authorized target)**

```bash
cd services/api
bun run eval:discovery-quality-db-target:prove -- --side a
TEST_DATABASE_SAFE=1 bun test src/cli/tests/discovery-quality-base.integration.spec.ts
```

Expected: provider-free commands pass; Drizzle reports `No schema changes`; every explicit no-match `if git grep ...; then exit 1; fi` succeeds; target proof and the full guarded suite pass. A missing authorization, skipped/not-run suite, or failure is recorded but blocks merge readiness and the receipt/PR must say so.

**Receipt and PR handoff**

```bash
git add services/api/package.json bun.lock docs/research/2026-08-07-ind-638b-validation-receipt.md
git commit -m "chore: version IND-638B quality runtime"

git status --short --branch
git push
git fetch origin "$(git branch --show-current)"
git status --short --branch
bun run pr:snapshot -- "$(gh pr view --json number --jq .number)"
```

Expected: clean branch, no upstream drift, actual PR head/base revisions recorded, required checks/reviews visible, and no merge command run.

## Post-Merge Operational Rollout

### 11. After merged-tree audit, run separately authorized infrastructure, base, smoke, and ten-slot stages

This task is not part of PR B implementation or PR acceptance. Begin only after the forge confirms PR B merged into `dev`, merge-commit workflows pass, deployment status is terminal and healthy where applicable, and an independent merged-tree audit has no Critical or Important findings.

**Files**

- No repository source changes.
- Record actual commands, confirmations, revisions, artifact paths, exit codes, completeness, and residual risks in the IND-638 Linear evidence.

**Stage 0 — merged-tree audit**

```bash
git fetch origin dev
git worktree add --detach .worktrees/audit-ind-638b origin/dev
cd .worktrees/audit-ind-638b
bun install --frozen-lockfile
bun run --cwd packages/protocol build
bun run --cwd services/api typecheck:cli-specs
bun run --cwd services/api build
git status --short
```

Expected: merged tree builds and remains clean. Stop on any failure.

**Stage 1 — provision the base read replica**

Required confirmation text:

```text
provision IND-638 base read replica
```

- [ ] Obtain the exact confirmation separately from every later stage.
- [ ] From a secure operator shell, run the exact control-plane-only command contract:

```bash
cd services/api
umask 077
export DISCOVERY_QUALITY_READ_REPLICA_CONFIRM='provision IND-638 base read replica'
test -n "${NEON_API_KEY:-}"
test -n "${DISCOVERY_TARGETS:-}"
bun run eval:discovery-quality-read-replica:provision -- \
  --base-branch-name eval-discovery-base \
  --endpoint-type read_only \
  --database-name protocol_eval \
  --secure-record "$HOME/.config/index/ind-638-base-read-replica.json"
bun run eval:discovery-quality-read-replica:attest -- \
  --secure-record "$HOME/.config/index/ind-638-base-read-replica.json"
```

Expected: the provision script first attests the exact non-primary protected base, creates one endpoint and no branch, requires returned control-plane type `read_only`, re-attests ownership, and writes a mode-0600 record. The attest script creates nothing and prints only project/branch/endpoint IDs, `type=read_only`, and `databaseName=protocol_eval`; neither command connects to DB, constructs providers/Redis, resets, or prints a URL/credential.

- [ ] Record the endpoint ID in the secure operator record; do not modify `DISCOVERY_TARGETS` yet.
- [ ] Construct the proposed v2 manifest in the secure record and run strict local parser/attestation.
- [ ] Require exact base binding and `/protocol_eval` and stop. Do not migrate secrets automatically.

**Stage 2 — atomically migrate the manifest secret**

Required confirmation text:

```text
migrate IND-638 DISCOVERY_TARGETS v2 secret
```

- [ ] Preserve the prior secret value in the approved secure rollback system.
- [ ] Set `DISCOVERY_TARGETS` to the locally validated v2 document in the Eval Ops service and operator environment as one coordinated change.
- [ ] Do not change `NEON_API_KEY`, provider credentials, Redis, or confirmation variables.
- [ ] Run provider-free v2 parsing and legacy A/B projection tests.
- [ ] Confirm Eval Ops still has no historical-quality launch control.
- [ ] Stop. Do not refresh the base automatically.

**Stage 3 — refresh the writable protected base**

Required confirmation text:

```text
refresh IND-638 historical quality protected base
```

```bash
cd services/api
test "${DISCOVERY_ENV_MATRIX_BASE_CONFIRM:-}" = "1"
test "${TEST_DATABASE_SAFE:-}" = "1"
test -n "${NEON_API_KEY:-}"

bun run eval:discovery-quality-base-refresh-target:attest
bun run eval:discovery-quality-base
```

Expected: the attest-only command strictly parses `DISCOVERY_QUALITY_BASE_REFRESH_TARGET`, control-plane attests exact project/non-primary `eval-discovery-base` branch/endpoint/host/`protocol_eval` plus `type=read_write`, prints only safe IDs/type, and performs zero DB/provider/reset work. The refresh command repeats that full attestation and accepts only the branded result before opening DB/provider dependencies; old quality metadata is committed absent before provider work; approved documents embed once outside transactions; the final vector/document/metadata transaction verifies from DB-round-tripped float32 values and commits atomically. Stop on failure and do not retry automatically.

Then verify through only the read replica:

```bash
unset DATABASE_URL
unset OPENROUTER_API_KEY
unset REDIS_URL
bun run eval:discovery-quality-base:verify
```

Expected: output includes `Historical quality base verifier session read-only: on`; no provider or writable URL is used. Stop after success.

**Stage 4 — intent smoke**

Required confirmation text:

```text
run IND-638 intent smoke
```

```bash
cd services/api
DISCOVERY_CONFIRM=1 TEST_DATABASE_SAFE=1 \
bun run eval:discovery -- \
  --historical-quality \
  --case historical/builder-and-operator \
  --trigger intent \
  --runs 1 \
  --env DISCOVERY_ALLOWED_TYPES=intent,profile
```

Expected: one pre-reset read-only verification, one restore of child A, one process, one attempt, one valid child row, one run artifact, and exit `0` only when complete. On exit `3`, missing evidence, or operational failure, record evidence and stop. Never rerun automatically.

**Stage 5 — enrichment smoke**

Required confirmation text:

```text
run IND-638 enrichment smoke
```

Run only after the intent smoke is complete and independently accepted:

```bash
cd services/api
DISCOVERY_CONFIRM=1 TEST_DATABASE_SAFE=1 \
bun run eval:discovery -- \
  --historical-quality \
  --case historical/builder-and-operator \
  --trigger enrichment \
  --runs 1 \
  --env DISCOVERY_ALLOWED_TYPES=intent,profile
```

Expected: the same isolation guarantees and one complete enrichment row. On any incomplete or failed result, record and stop. Never rerun automatically.

**Stage 6 — ten-slot pilot**

Required confirmation text:

```text
run IND-638 ten-slot historical quality pilot
```

Run only after both smoke artifacts are independently reviewed as complete:

```bash
cd services/api
DISCOVERY_CONFIRM=1 TEST_DATABASE_SAFE=1 \
bun run eval:discovery -- \
  --historical-quality \
  --trigger intent \
  --trigger enrichment \
  --runs 1 \
  --env DISCOVERY_ALLOWED_TYPES=intent,profile
```

Acceptance requires:

- [ ] Exactly five approved logical cases.
- [ ] Exactly two triggers.
- [ ] Exactly ten planned slots.
- [ ] Exactly ten serial child-A restores.
- [ ] Exactly ten fresh child processes.
- [ ] Exactly one attempt per slot.
- [ ] Exactly ten unique valid quality rows.
- [ ] No missing, duplicate, malformed, or unplanned row.
- [ ] `requestedSlots === 10`.
- [ ] `completedSlots === 10`.
- [ ] `qualityVerdictAvailable === true`.
- [ ] A readable case/trigger stage funnel.
- [ ] No baseline, comparison, winner, or target threshold.
- [ ] No automatic rerun.

Any exit `3`, incomplete row, missing row, or operational failure means no quality verdict and stops closeout pending a new explicit decision. A low retrieval or final-inclusion result is valid completion evidence and must not trigger a rerun.

**Stage 7 — closeout**

- [ ] Record merged revision and merged-tree audit revision.
- [ ] Record each separate confirmation and operator identity.
- [ ] Record read-replica endpoint ID without URL/credentials.
- [ ] Record base attestation root and corpus/document/config fingerprints.
- [ ] Record smoke and pilot commands, exit codes, artifact paths, and completeness.
- [ ] Record ten-slot funnel results without imposing a quality threshold.
- [ ] Record residual risks, including medium recognizability, provider-dependent vectors, TOCTOU between replica verification and restore, and one-observation statistical limits.
- [ ] Verify required workflows and deployments remain healthy.
- [ ] Close IND-638 only after ten complete slots and evidence review.
- [ ] Clean the implementation worktree/branch only after preservation and issue closeout checks.

## Dependencies

1. Task 1 is a hard gate for every later task and cannot begin until PR A is merged and audited.
2. Task 2 supplies the durable attestation column and parser required by Tasks 3, 6, and 9.
3. Task 3 depends on Task 2 and PR A’s admitted seed projection.
4. Task 4 supplies the v2 attested read replica and child bindings required by Tasks 5, 6, 9, and 11.
5. Task 5 depends on Tasks 1 and 4 and establishes the destructive ordering used by all runtime work.
6. Task 6 depends on Tasks 2–5 and establishes child safety before provider construction.
7. Task 7 depends on Task 6 plus PR A trigger and metric contracts.
8. Task 8 depends on Tasks 5–7 and PR A’s strict V2 quality artifact schema.
9. Task 9 depends on Tasks 2–8 and is the only task allowed to gather guarded DB evidence; its authorized target proof and complete guarded integration suite must actually pass before merge readiness.
10. Task 10 depends on every PR task and blocks merge handoff whenever DB proof/suite evidence is missing, skipped, not run, or failed.
11. Task 11 depends on a confirmed merge, merged-tree audit, separate rollout authorization, and successful completion of each preceding operational stage.

## Risks

- **Post-rebase contract drift:** PR A paths or signatures may differ from its plan. Task 1 must adapt PR B callers to the merged exports without copying or mutating PR A authority.
- **Migration sequence collision:** `0119` is correct for the audited tree ending at `0118`; if then-current `dev` adds another migration before execution, stop and regenerate using the next Drizzle index rather than creating duplicate journal indices.
- **Vector portability:** fingerprints bind exact provider/model/configuration output and are intentionally invalidated by an authorized refresh.
- **Read-replica lag:** a fresh verifier may observe lag after refresh. Treat mismatch as stale/incomplete and stop; never refresh or rerun automatically from the verifier.
- **TOCTOU window:** base verification and child restore are separate control-plane events. Mandatory restored-child verification is the compensating control.
- **Graph state interpretation:** eligible/submitted/returned/final states must come from reviewed explicit result/trace fields. If current graph output cannot distinguish them, stop and assess a protocol API change and required `10.2.0` bump rather than guessing.
- **Legacy regression:** `DISCOVERY_TARGETS`, bootstrap, and reset code are shared. Legacy A/B and matrix tests are mandatory after every manifest change.
- **Secret migration:** v2 rollout must be atomic with a secure rollback copy; mixed old/new service environments can cause preflight refusal.
- **Redis leakage:** an incomplete decorator or raw cache escape can contaminate slots. All four `HydeCache` operations must prefix, and no broad deletion is allowed.
- **Operational cost:** smokes and pilot are paid and destructive. Each stage has a separate stop/confirmation gate and no automatic rerun.
- **Incomplete artifact confusion:** exit `3` means a real paid diagnostic artifact with no verdict; exit `4` means operational failure. Messages and evidence must preserve that distinction.
- **Database safety:** `/protocol_eval` alone does not prove disposability. Control-plane child identity, endpoint binding, non-primary parentage, `TEST_DATABASE_SAFE=1`, and the existing readiness guard are all required.
- **Version boundary:** no protocol source change is planned. Any necessary protocol change expands scope and requires explicit explanation, `10.2.0`, subtree checks, and additional review.
- **Merge and rollout governance:** PR readiness is neither merge authorization nor infrastructure authorization; Task 11 remains separately controlled.