# IND-638A Shared-Pool Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use superpowers:test-driven-development for every code task, with one fresh implementer and an independent review gate per task.

**Goal:** Deliver PR A’s provider-free shared-pool authority, pilot planning, production-shaped trigger contracts, quality measurement schema, CLI refusal boundary, and truthful Eval Ops presentation without accessing providers, databases, Redis, Neon, the protected base, or live evals.

**Architecture:** Keep `HISTORICAL_QUALITY_CASES` as the sole factual authority and build an additive, deterministic shared-pool projection around it. Protocol modules own fixture construction, fingerprints, approval admission, pilot planning, metrics, and artifact validation. API modules own dependency-free CLI parsing and pure production-trigger builders. Existing queue workers consume those builders without changing admission, retry, or callback behavior. Eval Ops detects the strict measurement discriminator before generic comparison or scorecard rendering and presents only execution completeness and descriptive quality funnels.

Task 1 first exports the strict `HistoricalSharedPoolApprovalReceiptSchema` and `verifyHistoricalSharedPoolApprovalReceipt`, with provider-free parser/verifier mutation tests, before any pending pooled content exists. The pooled fixture is then committed with pending approval. The implementer stops and hands the worktree exclusively to a reviewer independent of its author. The reviewer audits that exact content commit, writes canonical `docs/research/2026-08-07-ind-638a-shared-pool-approval.json` from that revision's recomputed values, and commits only that immutable JSON receipt as the immediate child of the reviewed content commit. Only after the parent uses the already committed parser/verifier plus Git object, parent, path, and signer checks may the implementer resume, transcribe those real values, and restore strict admission. No reviewer metadata may be guessed, prefilled, synthesized, or committed by the content author.

**Tech Stack:** Bun, strict TypeScript, Zod strict schemas, Bun test, Vitest, React Testing Library, React 19, React Router 7, canonical SHA-256 JSON fingerprints, the existing `index-eval/run-report` V2 envelope, and conventional Git commits.

## Global Constraints

- PR A is entirely provider-, database-, Redis-, Neon-, protected-base-, and live-eval-free.
- Do not construct an embedder, model, graph runtime, database adapter, Redis client, or Neon control plane in any PR A quality path.
- Do not run database-backed tests or use `DATABASE_URL`.
- Preserve `buildHistoricalExperimentPlan` and its tests unchanged.
- Preserve legacy discovery single configuration, A/B, and environment-matrix parsing, planning, reset behavior, artifacts, and presentation.
- Preserve `FromIntentQueue` ownership/lifecycle/assignment admission, BullMQ three-attempt retry policy, success stamp, recovery, pool mining, and narration callbacks.
- Preserve `FromEnrichmentQueue` BullMQ admission, three-attempt retry policy, and production graph path.
- Quality mode must invoke neither queue and must not inherit queue retries or callbacks.
- Historical quality slots have `maxAttempts: 1`; no automatic retry may be represented.
- The shared pool contains exactly `h1-a` through `h5-e`: 25 unique participants.
- In case `hN`, source is `hN-a`, target is `hN-b`, semantic negatives are `hN-c`, `hN-d`, and `hN-e`, and all 20 participants from the other four cases are backgrounds.
- Preserve the five source enrichment rows from `historicalQuality.triggerInputs.enrichment` byte-for-byte.
- The other 20 enrichment rows may contain only exact approved fields plus the fixed mechanical labels defined in Task 2.
- Approval and audit data must never enter model-safe rows, seed projections, child arguments, or artifacts.
- Every content or fingerprint change returns approval to pending and requires a new independent review of the new exact revision.
- The canonical approval receipt is strict JSON, reviewer-authored, immutable, committed as the only changed path and immediate child of the exact pending content revision, and never edited during transcription.
- `verifyHistoricalSharedPoolApprovalReceipt` must require `receipt.authorId === current.authorId`; a matching reviewer/revision/fingerprint set with the wrong author is invalid.
- Quality artifacts use `runs: 1` per unique transport row; logical repetitions remain typed quality fields and are never encoded as envelope repetitions.
- Quality transport pass values describe execution completeness only and never quality.
- Incomplete quality evidence suppresses all run-level quality aggregation and reports `no quality verdict`.
- No baseline, regression, winner, composite score, target threshold, or generic comparison is permitted.
- Bump `@indexnetwork/protocol` exactly `10.0.3 → 10.1.0` and `@indexnetwork/api` exactly `0.77.3 → 0.78.0`.
- Do not bump `@indexnetwork/eval-ops` from `0.6.0`.
- Regenerate and commit root `bun.lock`.
- Do not merge, invoke a merge command, or assume merge authorization. Final readiness requires a separate explicit authorization handled through `manage-pr`.

## File and Responsibility Map

### New Files

- `packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.ts`
  - Shared-pool types, stable ID derivation, canonical ordering, seed projection, fingerprints, approval validation, and strict admission.
- `packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.ts`
  - Literal shared network, source-bound enrichment rows, reviewed retrieval documents, and pending/approved mechanical receipt.
- `packages/protocol/eval/discovery-env-matrix/historical-quality.pilot.ts`
  - Dedicated single-configuration pilot planner and opaque slot identities.
- `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts`
  - Pool cardinality, mapping, content, leakage, order invariance, fingerprint, and approval tests.
- `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.pilot.spec.ts`
  - Ten-slot, 30-slot, one-attempt, comparison-refusal, and cap tests.
- `services/api/src/cli/discovery-quality.contract.ts`
  - Dependency-free quality argv parser, help, cost calculation, and PR A runtime refusal.
- `services/api/src/cli/tests/discovery.quality.spec.ts`
  - Credential-free help, parser, cost, refusal, and legacy-dispatch tests.
- `services/api/src/queues/opportunity/discovery-trigger.builders.ts`
  - Pure intent and enrichment graph-invocation builders.
- `services/api/src/queues/tests/discovery-trigger.builders.spec.ts`
  - Exact builder output and queue byte-parity tests.
- `apps/eval-ops/src/components/HistoricalQualityReport.tsx`
  - Historical quality execution-completeness, funnel, and participant rendering.
- `apps/eval-ops/tests/historical-quality.fixture.ts`
  - Complete V2 quality artifacts validated by the protocol schema before UI use.
- `apps/eval-ops/tests/historical-quality-report.test.tsx`
  - Complete/incomplete quality rendering and forbidden-score-label tests.
- `docs/research/2026-08-07-ind-638a-shared-pool-approval.json`
  - Canonical strict reviewer-authored pooled-content receipt committed as the only changed path from the exact Task 2 content revision.
- `docs/research/2026-08-07-ind-638a-validation-receipt.md`
  - Durable validation and independent review receipt for the captured Tasks 1–9 implementation head, containing only actual local evidence and no self-referential final-head/PR/check claim.

### Modified Files

- `packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.ts`
  - Participant metrics, stage funnel, aggregation, and incomplete suppression.
- `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts`
  - Dedupe, evaluator states, rank, failure stages, funnel, and no-verdict tests.
- `packages/protocol/eval/shared/artifact.ts`
  - Refactor private attempt/run schemas into extendable base objects plus named shared refinements, then build behavior-identical legacy and strict historical-quality V2 schemas without extending `ZodEffects`.
- `packages/protocol/eval/shared/tests/artifact.spec.ts`
  - Quality transport validity and legacy artifact compatibility.
- `packages/protocol/eval/shared/tests/artifact.fixtures.ts`
  - Schema-valid shared quality artifact factory if common test construction is needed.
- `packages/protocol/eval/ops/ops.types.ts`
  - Quality measurement marker on artifact references and comparison finding type.
- `packages/protocol/eval/ops/ops.artifacts.ts`
  - Project measurement kind into indexed artifact references.
- `packages/protocol/eval/ops/ops.compare.ts`
  - Refuse historical-quality artifacts before score comparison.
- `packages/protocol/eval/ops/ops.server.ts`
  - Return a deterministic 422 exclusion for quality comparison requests.
- `packages/protocol/eval/ops/tests/artifacts.spec.ts`
  - Indexed measurement-kind tests.
- `packages/protocol/eval/ops/tests/compare.spec.ts`
  - Core comparison exclusion tests.
- `packages/protocol/eval/ops/tests/server.spec.ts`
  - Artifact and run comparison API exclusion tests.
- `services/api/src/cli/discovery.ts`
  - Intercept quality help and PR A refusal before legacy gates/runtime imports.
- `services/api/src/cli/discovery.contract.ts`
  - Publish the classified PR A historical-quality refusal and exit-2 contract while preserving legacy exit meanings.
- `services/api/src/queues/opportunity/from-intent.queue.ts`
  - Consume the pure intent trigger builder after existing admission.
- `services/api/src/queues/opportunity/from-enrichment.queue.ts`
  - Consume the pure enrichment trigger builder.
- `services/api/src/queues/tests/from-intent.queue.isolated.ts`
  - Pin existing admission, retry, callback behavior and builder parity.
- `services/api/src/queues/tests/from-enrichment.queue.isolated.ts`
  - Pin existing retry behavior and builder parity.
- `apps/eval-ops/src/api/client.ts`
  - Typed measurement and historical-quality artifact fields.
- `apps/eval-ops/src/routes/ArtifactView.tsx`
  - Route quality artifacts to the dedicated presentation.
- `apps/eval-ops/src/routes/Run.tsx`
  - Render quality run reports without scorecards or baseline comparison.
- `apps/eval-ops/src/routes/Compare.tsx`
  - Exclude quality artifacts from selectors and explain their exclusion.
- `apps/eval-ops/src/routes/Overview.tsx`
  - Replace quality pass-rate cells with execution-completeness labels.
- `apps/eval-ops/src/routes/Harness.tsx`
  - Avoid presenting quality artifacts as ordinary discovery scores.
- `apps/eval-ops/tests/artifact.test.tsx`
  - Artifact-detail routing tests.
- `apps/eval-ops/tests/run.test.tsx`
  - Quality run presentation and generic discovery regression tests.
- `apps/eval-ops/tests/compare.test.tsx`
  - Quality filtering and generic comparison regression tests.
- `apps/eval-ops/tests/overview.test.tsx`
  - Truthful quality summary-row tests.
- `apps/eval-ops/tests/harness.test.tsx`
  - Harness-history quality label tests.
- `apps/eval-ops/tests/client.test.ts`
  - Wire-shape tests for the measurement discriminator.
- `packages/protocol/package.json`
  - Version `10.1.0`.
- `packages/protocol/CHANGELOG.md`
  - `10.1.0` shared-pool contract entry.
- `services/api/package.json`
  - Version `0.78.0`.
- `docs/guides/development-reference.md`
  - Provider-free quality CLI contract and explicit PR A runtime boundary.
- `bun.lock`
  - Regenerated workspace versions.

### Files Explicitly Left Unchanged

- `packages/protocol/eval/discovery-env-matrix/historical-quality.experiment.ts`
- `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts`
- `services/api/src/cli/discovery.plan.ts`
- `services/api/src/cli/discovery.main.ts`
- `services/api/src/cli/discovery-env-matrix*.ts`
- Existing legacy artifact and baseline fixtures
- `apps/eval-ops/package.json`

## Tasks

### 1. Build the deterministic shared-pool contract

**Files**

- Create: `packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.ts`
- Create: `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts`

**Interfaces**

- Consumes:
  - `readonly HistoricalQualityCase[]`
  - Fixed quality namespace
  - Fixture enrichment/document definitions
  - Pending or approved review record
  - `fingerprintCanonicalJson`
- Produces:
  - `HistoricalCandidateRole`
  - `HistoricalSharedPoolPlan`
  - `HistoricalSharedPoolSeedProjection`
  - `HistoricalSharedPoolApproval`
  - exported strict `HistoricalSharedPoolApprovalReceiptSchema` and inferred `HistoricalSharedPoolApprovalReceipt`
  - exported `verifyHistoricalSharedPoolApprovalReceipt`
  - exported `stableQualityId`
  - `buildHistoricalSharedPoolPlan`
  - `historicalSharedPoolPlanFingerprint`
  - `historicalSharedPoolSeedFingerprint`
  - `historicalRetrievalDocumentFingerprint`
  - `assertHistoricalSharedPoolApproval`
  - `admitHistoricalSharedPool`

**TypeScript test sketch**

```ts
const plan = buildHistoricalSharedPoolPlan({
  cases: shuffledCases,
  fixture: SHARED_POOL_FIXTURE,
});

expect(plan.participants).toHaveLength(25);
expect(new Set(plan.participants.map((row) => row.participantId)).size).toBe(25);
expect(plan.cases).toHaveLength(5);

for (const row of plan.cases) {
  expect(row.candidates).toHaveLength(24);
  expect(row.candidates.filter((candidate) => candidate.role === "target")).toHaveLength(1);
  expect(row.candidates.filter((candidate) => candidate.role === "semantic-negative")).toHaveLength(3);
  expect(row.candidates.filter((candidate) => candidate.role === "background")).toHaveLength(20);
}

expect(buildHistoricalSharedPoolPlan({ cases: reversedCases, fixture }))
  .toEqual(buildHistoricalSharedPoolPlan({ cases, fixture }));
expect(historicalSharedPoolPlanFingerprint(reversedPlan))
  .toBe(historicalSharedPoolPlanFingerprint(plan));
```

**Implementation sketch**

```ts
export type HistoricalCandidateRole =
  | "target"
  | "semantic-negative"
  | "background";

export interface HistoricalSharedPoolPlan {
  corpusVersion: string;
  network: { id: string; title: string; prompt: string };
  participants: Array<{
    participantId: string;
    userId: string;
    intentId: string;
    premiseIds: string[];
    contextId: string;
    retrievalDocumentIds: string[];
  }>;
  cases: Array<{
    caseId: string;
    sourceParticipantId: string;
    targetParticipantId: string;
    candidates: Array<{
      participantId: string;
      role: HistoricalCandidateRole;
      semanticNegativeReasonId?: string;
    }>;
  }>;
}

export function stableQualityId(kind: string, sourceId: string): string {
  const suffix = createHash("sha256")
    .update(`index:historical-quality:v1:${kind}:${sourceId}`)
    .digest("hex")
    .slice(0, 24);
  return `eval-discovery-quality-${kind}-${suffix}`;
}

export const HistoricalSharedPoolApprovalReceiptSchema = z.object({
  status: z.literal("approved"),
  authorId: z.string().min(1),
  reviewerId: z.string().min(1),
  contentRevision: z.string().regex(/^[a-f0-9]{40,64}$/i),
  reviewedAt: z.string().datetime({ offset: true }),
  decision: z.literal("approved"),
  independenceAttested: z.literal(true),
  recognizability: z.enum(["low", "medium"]),
  rationale: z.string().trim().min(1),
  corpusVersion: z.string().min(1),
  planFingerprint: sha256Schema,
  seedProjectionFingerprint: sha256Schema,
  retrievalDocumentFingerprint: sha256Schema,
}).strict();

export type HistoricalSharedPoolApprovalReceipt =
  z.infer<typeof HistoricalSharedPoolApprovalReceiptSchema>;

export function verifyHistoricalSharedPoolApprovalReceipt(
  receipt: HistoricalSharedPoolApprovalReceipt,
  current: {
    authorId: string;
    contentRevision: string;
    corpusVersion: string;
    planFingerprint: string;
    seedProjectionFingerprint: string;
    retrievalDocumentFingerprint: string;
  },
): void {
  if (receipt.authorId !== current.authorId) throw new Error("approval author does not match content author");
  if (receipt.reviewerId === receipt.authorId) throw new Error("reviewer must be independent");
  if (receipt.contentRevision !== current.contentRevision) throw new Error("receipt does not bind the content revision");
  // Require exact current corpus/plan/seed/document fingerprints and all strict fields.
}
```

The receipt schema and verifier are implemented and mutation-tested in Task 1, before pending fixture content is authored. Canonicalize by case ID, participant ID, document ID, and source path before IDs or fingerprints are produced. Never use array position, display text, report name, or review metadata as identity input. Build each case’s target and semantic negatives from the validated case, then derive backgrounds as the sorted pool remainder excluding that case’s source, target, and three negatives.

**Checklist**

- [ ] Write failing tests for five-case admission, exact participant IDs, direct source/target mappings, and `1/3/20` roles.
- [ ] Define and export the strict canonical `HistoricalSharedPoolApprovalReceiptSchema`, inferred receipt type, and `verifyHistoricalSharedPoolApprovalReceipt` before Task 2 creates pending content.
- [ ] Add receipt schema/verifier mutation tests for unknown/missing fields, wrong author (`receipt.authorId !== current.authorId`), author=reviewer, false independence, invalid date/content revision, non-approved decision, high recognizability, blank rationale, and stale corpus/plan/seed/document fingerprints.
- [ ] Add failure tests for a sixth/missing case, duplicate participant, inconsistent duplicate participant, missing row, and invalid semantic-negative coverage.
- [ ] Add order-invariance tests that shuffle cases and each case’s entities/expectations, rebuild every `case:<caseId>/participant:<participantId>/...` provenance pointer from stable IDs in the shuffled copy, and prove the canonical plan, projection, links, and fingerprints equal the unshuffled result. Do not compare stale array-index pointers.
- [ ] Add model-safe seed projection tests excluding report identities, citations, cutoff records, reasons, and approval data.
- [ ] Export `stableQualityId`, implement deterministic `eval-discovery-quality-<kind>-<24 hex>` IDs from the fixed namespace and stable source IDs, and add a consumer-import test from the package export used by the fixture.
- [ ] Implement canonical sorting and three independent fingerprints: plan, seed projection, and retrieval-document set; assert all three digests are pairwise distinct.
- [ ] Confirm no import or function can construct provider or infrastructure dependencies.
- [ ] Independently review all stable-ID inputs and cardinality rules.

**RED**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
```

Expected: failure because `historical-quality.shared-pool.ts` and its exports do not exist.

**GREEN**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
```

Expected: all shared-pool structural, identity, fingerprint, order, leakage, and synthetic receipt parser/verifier mutation tests pass; no pending pooled content exists yet.

**Commit**

```bash
git add packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.ts packages/protocol/eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
git commit -m "feat(eval): define historical shared pool contract"
```

### 2. Author the literal pooled fixture in pending state

**Files**

- Create: `packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.ts`
- Modify: `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts`

**Interfaces**

- Consumes:
  - `HISTORICAL_QUALITY_CASES`
  - Approved model-safe profile and intent fields
  - Five exact `historicalQuality.triggerInputs.enrichment` rows
- Produces:
  - `HISTORICAL_SHARED_NETWORK`
  - `HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS`
  - `HISTORICAL_SHARED_POOL_RETRIEVAL_DOCUMENTS`
  - `HISTORICAL_SHARED_POOL_APPROVAL_RECORD` with `status: "pending"`
  - `HISTORICAL_SHARED_POOL_FIXTURE`
  - literal inputs used to construct the eventual immutable `HISTORICAL_SHARED_POOL_SEED_PROJECTION`

**Literal content**

```ts
export const HISTORICAL_SHARED_NETWORK = Object.freeze({
  id: stableQualityId("network", "shared-pool-v1"),
  title: "Interdisciplinary collaboration community",
  prompt:
    "A private community where people describe what they are working on, what they can contribute, and the kinds of collaboration they are open to.",
});
```

The five source rows are exactly:

- `h1-a` from case `historical/builder-and-operator`
- `h2-a` from case `historical/co-researchers-structure`
- `h3-a` from case `historical/songwriting-duo`
- `h4-a` from case `historical/first-check-investor`
- `h5-a` from case `historical/domain-expert-and-ml`

Each source row copies its `triggerInputs.enrichment.premises` and `userContext` without trimming, normalization, relabeling, or paraphrase.

The 20 derived rows are `h1-b` through `h1-e`, …, `h5-b` through `h5-e`. Each has:

- Premise: exact `intents[0].payload`.
- Premise source path:
  `case:<caseId>/participant:<participantId>/intent:0/payload`.
- Context source paths, in this exact order:
  `profile/bio`, `profile/location`, `profile/interests`, `profile/skills`, `intent:0/payload`.
- Context template:

```ts
[
  `Bio: ${bio}`,
  `Location: ${location}`,
  `Interests: ${interests.join(", ")}`,
  `Skills: ${skills.join(", ")}`,
  `Intent: ${intentPayload}`,
].join("\n");
```

Create exactly one retrieval document for every persisted premise and exactly one for every persisted context. Document text is byte-identical to its source premise/context text. Document IDs depend on participant ID, source type, and premise ordinal—not document text. Each document records participant ID, source row ID, source type, strategy, target corpus/frame, text, source paths, and content fingerprint.

The seed projection type is an exact database-shaped, model-safe contract rather than an alias of the plan:

```ts
export interface HistoricalSharedPoolSeedProjection {
  readonly users: readonly HistoricalQualitySeedUser[]; // exactly 25
  readonly networks: readonly [HistoricalQualitySeedNetwork];
  readonly memberships: readonly HistoricalQualitySeedMembership[]; // exactly 25
  readonly intents: readonly HistoricalQualitySeedIntent[]; // exactly 25
  readonly intentNetworkAssignments: readonly HistoricalQualitySeedIntentNetworkAssignment[]; // exactly 25
  readonly premises: readonly HistoricalQualitySeedPremise[]; // exact admitted premise total
  readonly contexts: readonly HistoricalQualitySeedContext[]; // exactly 25
  readonly documents: readonly HistoricalQualitySeedDocument[]; // premises.length + 25
}
```

Every collection is sorted by its stable primary ID; membership links are sorted by `(networkId,userId)`, assignments by `(networkId,intentId)`, and document links by `documentId`. Tests assert 25 unique users, one exact network, 25 unique user/network memberships, 25 intents each owned by the linked user, 25 unique intent/network assignments, every admitted premise/context ownership link, and every document's source-row/participant link. They also assert `documents.length === premises.length + contexts.length` and recompute all content fingerprints.

**Pending approval shape**

Use a discriminated pending record containing only facts available before review: `status`, the actual author identity, corpus version, plan fingerprint, seed-projection fingerprint, and retrieval-document fingerprint. Reviewer identity, review date, content revision, decision, independence attestation, and rationale exist only in a parsed approved receipt. This prevents fake reviewer metadata while preserving the approved mechanical contract required by strict admission. The Task 2 content commit necessarily includes Task 1's already passing strict JSON parser/verifier and mutation tests; it does not add or pre-populate the canonical receipt.

**TypeScript test sketch**

```ts
for (const sourceId of ["h1-a", "h2-a", "h3-a", "h4-a", "h5-a"]) {
  const expected = sourceCase(sourceId).historicalQuality.triggerInputs.enrichment;
  const actual = enrichmentRow(sourceId);
  expect(actual.premises).toEqual(expected.premises);
  expect(actual.userContext).toBe(expected.userContext);
}

expect(derivedRow("h1-b").premises[0]).toBe(entity("h1-b").intents![0]!.payload);
expect(derivedRow("h1-b").context).toBe([
  `Bio: ${entity("h1-b").profile.bio ?? ""}`,
  `Location: ${entity("h1-b").profile.location ?? ""}`,
  `Interests: ${(entity("h1-b").profile.interests ?? []).join(", ")}`,
  `Skills: ${(entity("h1-b").profile.skills ?? []).join(", ")}`,
  `Intent: ${entity("h1-b").intents![0]!.payload}`,
].join("\n"));

expect(() => admitHistoricalSharedPool(fixture)).toThrow(/pending approval/);
```

**Checklist**

- [ ] Add failing tests for the exact shared title and prompt.
- [ ] Add byte-equality tests for all five source enrichment rows.
- [ ] Add explicit source-path and template tests for every one of the 20 derived rows.
- [ ] Assert all 25 participants have an intent, at least one premise, one context, and retrieval documents.
- [ ] Assert retrieval document count equals total persisted premises plus 25 contexts.
- [ ] Assert the exact users/network/memberships/intents/25 assignments/premises/25 contexts/documents projection cardinalities, stable ordering, uniqueness, ownership, assignments, and document source links described above.
- [ ] Assert every content fingerprint recomputes exactly.
- [ ] Search model-safe projections for report names, citations, URLs, cutoff/audit fields, semantic-negative reasons, and reviewer fields.
- [ ] Record the fixture author’s real stable identity; do not add reviewer fields.
- [ ] Keep strict admission failing while status is pending.
- [ ] Confirm Task 1's exported strict receipt parser/verifier and mutation tests, including wrong-author rejection, remain in the pending content tree.
- [ ] Commit the pending fixture and preserve the exact resulting revision for Task 3.
- [ ] Independently review source paths and byte-preservation before requesting pooled approval.

**RED**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
```

Expected: fixture tests fail because the literal network, enrichment rows, retrieval documents, and pending record do not exist.

**GREEN**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
```

Expected: all fixture/content tests pass and the strict-admission test passes by rejecting the pending record.

**Commit**

```bash
git add packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.ts packages/protocol/eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
git commit -m "feat(eval): author pending historical shared pool fixture"
```

### 3. Complete the independent pooled approval checkpoint

**Files**

- Reviewer creates and commits: `docs/research/2026-08-07-ind-638a-shared-pool-approval.json`
- Modify after receipt verification: `packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.ts`
- Modify after receipt verification: `packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.ts`
- Modify after receipt verification: `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts`

**Interfaces**

- Consumes:
  - Exact pending-fixture commit from Task 2
  - Immutable receipt commit authored by the actual independent reviewer as the direct child of that content commit
  - Current corpus, plan, seed-projection, and retrieval-document fingerprints
- Produces:
  - Approved `HistoricalSharedPoolApproval`
  - Strictly admitted `HISTORICAL_SHARED_POOL_PLAN`
  - exported deeply frozen `HISTORICAL_SHARED_POOL_SEED_PROJECTION`
  - exported `historicalSharedPoolSeedFingerprint`
  - Immutable canonical reviewer-authored JSON receipt plus the transcribed mechanical TypeScript record

**Approval workflow — hard gate and exclusive handoff**

1. The implementer commits the pending Task 2 fixture, captures the full content commit, author identity, and three fingerprints, and makes no further commit:

   ```bash
   contentRevision="$(git rev-parse HEAD^{commit})"
   contentAuthor="$(git show -s --format='%ae' "$contentRevision")"
   git show --stat --oneline "$contentRevision"
   git cat-file -e "$contentRevision^{commit}"
   bun test packages/protocol/eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
   ```

2. The parent records `contentRevision`, then grants one independent reviewer exclusive ownership of the same worktree/branch. The implementer must not edit, commit, amend, rebase, or cherry-pick until the receipt commit is returned.
3. The reviewer checks out that exact revision, recomputes the plan, seed-projection, and document fingerprints with the Task 2 test, and audits prompt neutrality, shared-pool privilege/leakage, all 20 projection groundings, five byte-exact source rows, every document/source path, anonymization, and pooled recognizability.
4. Without modifying content or TypeScript, the reviewer writes canonical `docs/research/2026-08-07-ind-638a-shared-pool-approval.json`. It contains exactly the strict Task 1 fields: `status`, `authorId`, `reviewerId`, `contentRevision`, `reviewedAt`, `decision`, `independenceAttested`, `recognizability`, `rationale`, `corpusVersion`, `planFingerprint`, `seedProjectionFingerprint`, and `retrievalDocumentFingerprint`. Unknown or missing fields, comments, blank/example/substitution values, and an approval for any other revision are invalid. If changes are requested, the reviewer does not create an approval receipt; the parent returns ownership with review findings, keeps strict admission pending, commits revised content, and restarts the entire handoff against the new content commit.
5. The reviewer alone commits only that JSON file with `git add docs/research/2026-08-07-ind-638a-shared-pool-approval.json && git commit -m "docs: approve IND-638A shared pool content"`. The receipt commit has exactly one parent and that parent equals `contentRevision`; the reviewer makes no TypeScript, fixture, test, Markdown, or other path change.
6. Before ownership returns to the implementer, the parent runs the existing Task 1 `HistoricalSharedPoolApprovalReceiptSchema` parser and `verifyHistoricalSharedPoolApprovalReceipt` against the JSON and current author/revision/corpus/plan/seed/document values, then runs the Git gate:

   ```bash
   receiptPath="docs/research/2026-08-07-ind-638a-shared-pool-approval.json"
   receiptCommit="$(git rev-parse HEAD^{commit})"
   receiptParent="$(git rev-parse "$receiptCommit^")"
   reviewerCommitAuthor="$(git show -s --format='%ae' "$receiptCommit")"
   git cat-file -e "$receiptCommit^{commit}"
   git cat-file -e "$contentRevision^{commit}"
   test "$receiptParent" = "$contentRevision"
   test "$(git diff-tree --no-commit-id --name-only -r "$receiptCommit")" = "$receiptPath"
   test "$reviewerCommitAuthor" != "$contentAuthor"
   CONTENT_REVISION="$contentRevision" CONTENT_AUTHOR="$contentAuthor" \
     REVIEWER_COMMIT_AUTHOR="$reviewerCommitAuthor" \
     bun test packages/protocol/eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
   ```

   The handoff assertion parses the real JSON with the already committed strict schema, invokes the existing verifier, and requires `contentRevision` equality, `authorId === contentAuthor`, `reviewerId === reviewerCommitAuthor`, reviewer/author distinction, explicit independence, decision `approved`, low/medium recognizability, parseable actual time, nonblank rationale, and exact recomputed corpus/plan/seed/document fingerprints. `git cat-file -e` proves both named revisions are real commits; a syntactically plausible hash is insufficient.
7. Only after every parser, verifier, and Git command passes does the parent return exclusive ownership to the implementer. The implementer transcribes the real receipt values into the approved discriminated record, exports the admitted plan and immutable seed projection, and restores the strict-admission success assertion. The reviewer-authored JSON receipt is never amended or rewritten.
8. Never infer approval from silence, a general PR approval, an author self-review, a receipt committed by the implementer, a reviewer of another revision, or fabricated values.

**TypeScript validation sketch**

```ts
export function assertHistoricalSharedPoolApproval(
  approval: HistoricalSharedPoolApproval,
  current: {
    authorId: string;
    contentRevision: string;
    corpusVersion: string;
    planFingerprint: string;
    seedProjectionFingerprint: string;
    retrievalDocumentFingerprint: string;
  },
): asserts approval is HistoricalSharedPoolApprovalReceipt {
  if (approval.status !== "approved") throw new Error("shared pool approval is pending");
  const receipt = HistoricalSharedPoolApprovalReceiptSchema.parse(approval);
  // The shared verifier requires receipt.authorId === current.authorId;
  // reviewer distinction alone is insufficient.
  verifyHistoricalSharedPoolApprovalReceipt(receipt, current);
}
```

**Checklist**

- [ ] Change the strict-admission test to expect success; run RED while the record remains pending.
- [ ] Stop implementation and grant the independent reviewer exclusive worktree/branch ownership at the exact Task 2 content commit.
- [ ] Require that reviewer to author and commit the immutable receipt as the immediate child of the content commit and as the receipt commit's only changed file.
- [ ] Verify both Git commit objects, immediate parentage, receipt/content author distinction, receipt `reviewerId`/`authorId` correspondence, and explicit independence before returning ownership.
- [ ] Parse the actual canonical JSON with Task 1's existing strict schema and verifier before returning ownership; do not substitute an ad hoc Markdown/frontmatter parser.
- [ ] Recompute plan, seed-projection, and document fingerprints locally and require receipt `contentRevision` equality with the exact content commit.
- [ ] Record and transcribe only real author/reviewer/revision/date/decision/rationale values; never edit the JSON receipt during transcription.
- [ ] Retain Task 1 parser/verifier mutation coverage and add handoff provenance mutation tests for wrong receipt parent, extra receipt-commit path, missing Git object, wrong receipt author, author=reviewer, receipt signer mismatch, false independence, invalid date/revision, content-revision mismatch, stale corpus/plan/seed/document fingerprint, high recognizability, non-approved decision, and blank rationale.
- [ ] Export and deeply freeze `HISTORICAL_SHARED_POOL_SEED_PROJECTION`; test exact cardinalities, canonical order, ownership/assignment/document links, and pairwise-distinct plan/seed/document fingerprints.
- [ ] Deep-freeze the approved record and recursively exclude receipt/review data from seed/model/child/artifact projections.
- [ ] Restore strict admission only after every parent and test gate passes.
- [ ] Have a second independent reviewer verify that the transcribed TypeScript values exactly match the immutable canonical JSON receipt.

**RED**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
```

Expected: the updated strict-admission test fails with `shared pool approval is pending`.

**GREEN**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
```

Expected: strict admission passes with the real approval record; every stale or fabricated approval mutation is rejected.

**Commit**

```bash
git add packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.ts packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.ts packages/protocol/eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts
if git diff --cached --name-only | grep -Fx 'docs/research/2026-08-07-ind-638a-shared-pool-approval.json'; then exit 1; fi
git commit -m "feat(eval): bind shared pool independent approval"
```

### 4. Add the dedicated pilot planner and provider-free CLI contract

**Files**

- Create: `packages/protocol/eval/discovery-env-matrix/historical-quality.pilot.ts`
- Create: `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.pilot.spec.ts`
- Create: `services/api/src/cli/discovery-quality.contract.ts`
- Create: `services/api/src/cli/tests/discovery.quality.spec.ts`
- Modify: `services/api/src/cli/discovery.ts`
- Modify: `services/api/src/cli/discovery.contract.ts`

**Interfaces**

- Consumes:
  - One resolved side/configuration
  - Selected approved case IDs
  - Repeatable `intent | enrichment` triggers
  - Repetition count
  - Existing report/force conventions
- Produces:
  - `buildHistoricalQualityPilotPlan`
  - Opaque slot IDs
  - Configuration fingerprint
  - `parseHistoricalQualityArgs`
  - `historicalQualityUsage`
  - `historicalQualityCost`
  - `HISTORICAL_QUALITY_PR_A_REFUSAL` fixed safe message
  - `runHistoricalQualityPrARefusal` returning classified execution-error exit code `2`
  - Deterministic PR A runtime refusal before any gate or runtime import

**Planner sketch**

```ts
interface HistoricalQualityPilotSlot {
  slotId: string;
  caseId: string;
  trigger: HistoricalQualityTrigger;
  repetition: number;
  selectedSide: "a";
  configurationFingerprint: string;
  maxAttempts: 1;
}

const plan = buildHistoricalQualityPilotPlan({
  caseIds: approvedCaseIds,
  triggers: ["intent", "enrichment"],
  repetitions: 1,
  configuration: { id: "a", config: resolvedConfig },
});

expect(plan.slots).toHaveLength(10);
expect(plan.graphInvocations).toBe(10);
expect(plan.maxAttempts).toBe(1);
```

`slotId` is the SHA-256 fingerprint of canonical `{caseId, trigger, repetition, selectedSide, configurationFingerprint}`, prefixed `hq-slot-`; child-facing serialization includes this opaque ID and configuration identifier only.

**CLI sketch**

```ts
parseHistoricalQualityArgs([
  "--historical-quality",
  "--trigger", "intent",
  "--trigger", "enrichment",
  "--runs", "1",
  "--env", "DISCOVERY_ALLOWED_TYPES=intent,profile",
]);

// Reject:
["--historical-quality", "--a", "X=1", "--b", "X=2"];
["--historical-quality", "--env", "X=1", "--update-baseline"];
```

Without `--trigger`, select both triggers. Default repetitions remain three. The full corpus therefore reports:

- one repetition: 5 cases × 2 triggers = 10 graph and 10 evaluator calls;
- default: 5 × 2 × 3 = 30 graph and 30 evaluator calls.

The parser rejects a plan over 200 graph invocations.

In `discovery.ts`, handle quality requests before `assertAbConfirmation`, manifest parsing, attestation, or any dynamic runtime import. Use a classified fixed return rather than throwing through an unclassified bootstrap path:

```ts
export const HISTORICAL_QUALITY_PR_A_REFUSAL =
  "Historical quality runtime is not available in PR A; no provider or infrastructure operation was started.";

export function runHistoricalQualityPrARefusal(
  request: HistoricalQualityRequest,
  io: Pick<Console, "log" | "error">,
): 2 {
  io.log(formatHistoricalQualityCost(request));
  io.error(HISTORICAL_QUALITY_PR_A_REFUSAL);
  return 2;
}

if (isHistoricalQualityRequest(args)) {
  if (hasHelp(args)) return void console.log(historicalQualityUsage());
  process.exitCode = runHistoricalQualityPrARefusal(
    parseHistoricalQualityArgs(args),
    console,
  );
  return;
}
```

`discovery.contract.ts` names exit `2` as the safe pre-runtime execution refusal for PR A without changing legacy meanings. Legacy argv without `--historical-quality` follows the existing path byte-for-byte. Help explicitly says: `PR A performs no base verification; pre-reset read-only base verification is delivered by PR B.` It must not imply that PR A already verifies or resets a base.

**Checklist**

- [ ] Add planner tests for 10 slots at one repetition and 30 at default three.
- [ ] Assert deterministic case → trigger → repetition ordering.
- [ ] Assert unique opaque IDs, selected side `a`, one attempt, and stable configuration fingerprint.
- [ ] Reject zero/duplicate cases, duplicate/invalid triggers, comparison inputs, invalid repetitions, and 201 invocations.
- [ ] Leave `historical-quality.experiment.ts` and its tests untouched.
- [ ] Add credential-free help tests in an empty environment.
- [ ] Test repeatable triggers, omitted-trigger default, repeated cases, report, force, and single `--env`.
- [ ] Reject `--a`, `--b`, mixed shapes, missing `--env`, baseline flags, and unknown quality flags.
- [ ] Test the exact 10/30 cost stdout and restore-per-slot/one-attempt/no-subset-verdict language, including the explicit statement that pre-reset read-only base verification arrives in PR B.
- [ ] Spawn the CLI with a clean environment and assert non-help quality requests emit only the exact cost line(s) on stdout, the fixed safe refusal on stderr, and exit `2`.
- [ ] Instrument bootstrap seams and assert the refusal makes zero confirmation-gate, manifest, Neon, DB, provider, Redis, graph, and dynamic-runtime import calls.
- [ ] Re-run legacy discovery contract and parent parser tests unchanged.
- [ ] Independently review bootstrap import ordering.

**RED**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.pilot.spec.ts

cd ../../services/api
bun test src/cli/tests/discovery.quality.spec.ts
```

Expected: missing planner and quality-contract modules; quality argv falls into the legacy gate.

**GREEN**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.pilot.spec.ts eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts

cd ../../services/api
bun test src/cli/tests/discovery.quality.spec.ts src/cli/tests/discovery.contract.spec.ts src/cli/tests/discovery.parent.spec.ts src/cli/tests/discovery.plan.spec.ts
```

Expected: quality planner/CLI tests pass, old planner tests remain unchanged, and legacy discovery tests pass.

**Commit**

```bash
git add packages/protocol/eval/discovery-env-matrix/historical-quality.pilot.ts packages/protocol/eval/discovery-env-matrix/tests/historical-quality.pilot.spec.ts services/api/src/cli/discovery-quality.contract.ts services/api/src/cli/tests/discovery.quality.spec.ts services/api/src/cli/discovery.ts services/api/src/cli/discovery.contract.ts
git commit -m "feat(eval): add historical quality pilot contract"
```

### 5. Extract dependency-free production trigger builders with queue parity

**Files**

- Create: `services/api/src/queues/opportunity/discovery-trigger.builders.ts`
- Create: `services/api/src/queues/tests/discovery-trigger.builders.spec.ts`
- Modify: `services/api/src/queues/opportunity/from-intent.queue.ts`
- Modify: `services/api/src/queues/opportunity/from-enrichment.queue.ts`
- Modify: `services/api/src/queues/tests/from-intent.queue.isolated.ts`
- Modify: `services/api/src/queues/tests/from-enrichment.queue.isolated.ts`

**Interfaces**

- Consumes:
  - Already-authorized source user, intent/query, and scope values
  - Shared network for enrichment
- Produces:
  - `buildIntentDiscoveryTrigger`
  - `buildEnrichmentDiscoveryTrigger`
  - Existing queue graph input types re-exported from the builder module

**Implementation sketch**

```ts
export function buildIntentDiscoveryTrigger(input: {
  userId: string;
  searchQuery: string;
  networkIds: readonly string[];
  triggerIntentId: string;
}): IntentDiscoveryTrigger {
  if (input.networkIds.length === 0) throw new Error("intent trigger requires authorized scope");
  return {
    userId: input.userId,
    searchQuery: input.searchQuery,
    operationMode: "create",
    ...(input.networkIds.length === 1
      ? { networkId: input.networkIds[0]! }
      : { indexScope: [...input.networkIds] }),
    triggerIntentId: input.triggerIntentId,
    options: { initialStatus: "latent" },
  };
}

export function buildEnrichmentDiscoveryTrigger(input: {
  userId: string;
  networkId: string;
}): EnrichmentDiscoveryTrigger {
  return {
    userId: input.userId,
    networkId: input.networkId,
    operationMode: "create",
    options: { initialStatus: "latent" },
  };
}
```

The enrichment builder never adds `searchQuery` or `triggerIntentId`. Builders contain no queue, DB, Redis, graph, provider, or callback imports.

**Test sketch**

```ts
const expected = buildIntentDiscoveryTrigger({
  userId: "u1",
  searchQuery: "Build a SaaS",
  networkIds: ["idx1"],
  triggerIntentId: "i1",
});

await queue.processJob("discover_opportunities", admittedJob);
expect(JSON.stringify(invokeOpportunityGraph.mock.calls[0]![0]))
  .toBe(JSON.stringify(expected));
```

**Checklist**

- [ ] Write exact single-network, multi-network, empty-scope, and enrichment-shape tests.
- [ ] Assert intent and enrichment outputs differ only where specified.
- [ ] Replace queue-local object literals with builders after existing admission completes.
- [ ] Preserve scope sorting and narrowing in `FromIntentQueue`.
- [ ] Preserve BullMQ `attempts: 3` and exponential backoff in both queues.
- [ ] Preserve success stamping, recovery, mining, narration, logging, and callbacks.
- [ ] Assert quality consumers can call the builders without importing either queue.
- [ ] Assert enrichment output has no `searchQuery` or `triggerIntentId`.
- [ ] Independently review queue diffs for behavior outside object construction.

**RED**

```bash
cd services/api
bun test src/queues/tests/discovery-trigger.builders.spec.ts src/queues/tests/from-intent.queue.isolated.ts src/queues/tests/from-enrichment.queue.isolated.ts
```

Expected: missing builder module/parity assertions fail.

**GREEN**

```bash
cd services/api
bun test src/queues/tests/discovery-trigger.builders.spec.ts src/queues/tests/from-intent.queue.isolated.ts src/queues/tests/from-enrichment.queue.isolated.ts
```

Expected: builder output is byte-identical to both queue invocations and all existing queue behavior passes.

**Commit**

```bash
git add services/api/src/queues/opportunity/discovery-trigger.builders.ts services/api/src/queues/opportunity/from-intent.queue.ts services/api/src/queues/opportunity/from-enrichment.queue.ts services/api/src/queues/tests/discovery-trigger.builders.spec.ts services/api/src/queues/tests/from-intent.queue.isolated.ts services/api/src/queues/tests/from-enrichment.queue.isolated.ts
git commit -m "refactor(api): share production discovery trigger builders"
```

### 6. Implement participant metrics, stage funnels, and incomplete suppression

**Files**

- Modify: `packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.ts`
- Modify: `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts`

**Interfaces**

- Consumes:
  - 24 candidate roles
  - Retrieval evidence rows
  - Eligibility/submission/return traces
  - Thresholded `evaluatedOpportunities` order
  - Slot completion states
- Produces:
  - `HistoricalParticipantMetric`
  - `HistoricalQualitySlotSummary`
  - `HistoricalQualityRunSummary`
  - `buildHistoricalParticipantMetrics`
  - `summarizeHistoricalQualitySlot`
  - `summarizeHistoricalQualityRun`
  - Existing `dedupeHistoricalRetrieval`
  - Existing `classifyHistoricalFailureStage`
  - Existing `executionCompletenessFields`

**TypeScript sketch**

```ts
export interface HistoricalParticipantMetric {
  participantId: string;
  role: "target" | "semantic-negative" | "background";
  retrieval: null | {
    rank: number;
    bestScore: number;
    evidenceIds: string[];
    evidenceTypes: HistoricalEvidenceType[];
  };
  evaluator: {
    eligible: boolean;
    submitted: boolean;
    returned: boolean;
    score: number | null;
    errorClass?: string;
  };
  finalRank: number | null;
  failureStage: HistoricalFailureStage;
}
```

`finalRank` comes only from the thresholded evaluator output order. Persistence, duplicate suppression, and conflict suppression are not ranking stages.

**Test sketch**

```ts
expect(metric("eligible-unsubmitted")).toMatchObject({
  evaluator: { eligible: true, submitted: false, returned: false, score: null },
  failureStage: "evaluation_admission",
});

expect(metric("returned-not-final")).toMatchObject({
  evaluator: { eligible: true, submitted: true, returned: true, score: 71 },
  finalRank: null,
  failureStage: "finalization",
});

expect(summarizeHistoricalQualityRun([complete, incomplete])).toEqual({
  qualityVerdictAvailable: false,
  completedSlots: 1,
  requestedSlots: 2,
  summary: null,
  message: "no quality verdict",
});
```

**Checklist**

- [ ] Test retrieval dedupe best score, evidence union, descending rank, and participant-ID tie break.
- [ ] Test target, semantic-negative, and background metrics.
- [ ] Test eligible-but-unsubmitted separately from returned rejection.
- [ ] Test all failure stages: execution, retrieval, evaluation admission, evaluation rejection, finalization, none.
- [ ] Test final rank from thresholded order and exclusion of persistence order.
- [ ] Build complete slot funnels for target retrieval, evaluator return, final inclusion/rank, negative inclusion, background inclusion, and failure stages.
- [ ] Suppress slot funnel when its 24 metrics are absent, duplicated, malformed, or incomplete.
- [ ] Suppress the entire run summary when any requested slot is missing or incomplete.
- [ ] Ensure transport `passes` never enters quality aggregation.
- [ ] Add serialization checks excluding text, citations, reasons, reviewer data, provider errors, and credentials.
- [ ] Independently review every state transition against the approved design.

**RED**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts
```

Expected: participant/funnel exports are missing and incomplete-subset assertions fail.

**GREEN**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts
```

Expected: all participant, rank, funnel, and no-verdict tests pass.

**Commit**

```bash
git add packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.ts packages/protocol/eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts
git commit -m "feat(eval): define historical quality metrics"
```

### 7. Refactor strict V2 artifact bases, specialize quality schemas, and exclude quality from Ops comparisons

**Files**

- Modify: `packages/protocol/eval/shared/artifact.ts`
- Modify: `packages/protocol/eval/shared/tests/artifact.spec.ts`
- Modify: `packages/protocol/eval/shared/tests/artifact.fixtures.ts`
- Modify: `packages/protocol/eval/ops/ops.types.ts`
- Modify: `packages/protocol/eval/ops/ops.artifacts.ts`
- Modify: `packages/protocol/eval/ops/ops.compare.ts`
- Modify: `packages/protocol/eval/ops/ops.server.ts`
- Modify: `packages/protocol/eval/ops/tests/artifacts.spec.ts`
- Modify: `packages/protocol/eval/ops/tests/compare.spec.ts`
- Modify: `packages/protocol/eval/ops/tests/server.spec.ts`

**Interfaces**

- Consumes:
  - V2 execution evidence
  - Unique quality transport rows
  - Typed `historicalQuality` case data
- Produces:
  - exported canonical `HistoricalQualityMeasurementSchema`
  - exported canonical `HistoricalQualityTransportRowSchema` and inferred `HistoricalQualityTransportRow`
  - exported canonical `HistoricalQualityExecutionRunSchema` and inferred `HistoricalQualityExecutionRun`
  - Optional V2 `measurement`
  - `isHistoricalQualityArtifact`
  - Indexed `measurementKind`
  - Core/API comparison exclusion

**Schema refactor and specialization sketch**

The current private attempt/run schemas are `ZodEffects` because `.superRefine()` is applied inline; they cannot be extended. First split each into a private strict `z.object` base and a named shared refinement function. Construct both the existing legacy schema and the quality specialization from those same bases/refinements. Never call `.extend()` on `attemptEvidenceSchema`, `runEvidenceSchema`, or any other `ZodEffects`.

```ts
const attemptEvidenceBaseSchema = z.object({
  attemptId: z.string().min(1),
  runId: z.string().min(1),
  runIndex: countSchema,
  attemptNumber: z.number().int().min(1),
  startedAt: dateTimeSchema,
  completedAt: dateTimeSchema,
  durationMs: countSchema,
  outcome: z.enum(["success", "failure", "timeout", "cancelled"]),
  error: sanitizedErrorSchema.optional(),
  retryable: z.boolean(),
  backoffMs: countSchema,
}).strict();

type AttemptEvidenceInput = z.infer<typeof attemptEvidenceBaseSchema>;
function refineAttemptEvidence(value: AttemptEvidenceInput, ctx: z.RefinementCtx): void {
  // Move the complete existing attempt refinement here unchanged.
}
const attemptEvidenceSchema = attemptEvidenceBaseSchema
  .superRefine(refineAttemptEvidence); // legacy behavior

const runEvidenceBaseSchema = z.object({
  runId: z.string().min(1),
  caseId: z.string().min(1),
  runIndex: countSchema,
  outcome: z.enum(["success", "failed", "cancelled"]),
  recovered: z.boolean(),
  attempts: z.array(attemptEvidenceSchema),
}).strict();

type RunEvidenceInput = z.infer<typeof runEvidenceBaseSchema>;
function refineRunEvidence(value: RunEvidenceInput, ctx: z.RefinementCtx): void {
  // Move the complete existing run refinement here unchanged.
}
const runEvidenceSchema = runEvidenceBaseSchema
  .superRefine(refineRunEvidence); // legacy behavior

const historicalQualityAttemptBaseSchema = attemptEvidenceBaseSchema.extend({
  retryable: z.literal(false),
  backoffMs: z.literal(0),
});
const historicalQualityAttemptSchema = historicalQualityAttemptBaseSchema
  .superRefine(refineAttemptEvidence);

const historicalQualityExecutionRunBaseSchema = runEvidenceBaseSchema.extend({
  recovered: z.literal(false),
  attempts: z.tuple([historicalQualityAttemptSchema]),
});
export const HistoricalQualityExecutionRunSchema =
  historicalQualityExecutionRunBaseSchema.superRefine(refineRunEvidence);
```

Apply the same base-object-plus-named-refinement pattern to any affected payload or V2 envelope object that must be specialized for `measurement`; do not weaken or duplicate its legacy refinements.

```ts
export const HistoricalQualityMeasurementSchema = z.object({
  kind: z.literal("historical-quality-pilot"),
  scorecardSemantics: z.literal("execution-completeness"),
  repetitionsRequested: z.number().int().min(1),
  requestedSlots: z.number().int().min(1),
  completedSlots: z.number().int().min(0),
  qualityVerdictAvailable: z.boolean(),
}).strict();

export const HistoricalQualityTransportRowSchema = z.object({
  kind: z.literal("historical-quality-pilot"),
  logicalCaseId: z.string().min(1),
  trigger: z.enum(["intent", "enrichment"]),
  repetition: z.number().int().min(0),
  configurationFingerprint: sha256Schema,
  completed: z.boolean(),
  participantMetrics: z.array(HistoricalParticipantMetricSchema).length(24),
  stageFunnel: HistoricalStageFunnelSchema.nullable(),
}).strict();
```

Quality refinements require:

- envelope and payload `runs === 1`;
- unique transport IDs exactly
  `${encodeURIComponent(logicalCaseId)}/${trigger}/r${repetition + 1}`;
- rule exactly `execution-completeness`;
- case `runs === 1`, `passes === 1 | 0`, and `passRate === passes`;
- zero to `requestedSlots` transport rows may exist in an incomplete operational diagnostic; every emitted transport row has exactly one execution row with `runIndex: 0` and exactly one execution attempt, while an absent planned row has no fabricated execution record and forces verdict unavailable;
- a completed transport row has `completed: true`, `passes: 1`, a successful execution run, exactly one successful attempt, 24 valid metrics, and a non-null funnel;
- a terminal failed transport row has `completed: false`, `passes: 0`, a failed execution run, exactly one failed-or-timeout attempt, `recovered: false`, no second attempt, and a null funnel;
- `measurement.completedSlots` equals the number of completed emitted rows, and row completion, execution success, `passes`, funnel presence, and completed-slot contribution are mutually equivalent in both directions; `payload.cases.length <= requestedSlots`, and fewer emitted rows than requested forces unavailable verdict;
- `qualityVerdictAvailable === true` if and only if `completedSlots === requestedSlots`, every requested row exists, and every row is complete/successful/pass-1/has-funnel; any complete evidence set must set it to true and any unavailable/failed/missing evidence must set it to false;
- no measurement on V1 or baseline artifacts;
- no other `scorecardSemantics`.

Legacy V1/V2 and discovery A/B artifacts remain byte-compatible because `measurement` is optional only in the V2 run-report schema.

**Comparison behavior**

- `compareArtifacts` returns a non-comparable measurement finding before calling `diffBaseline`.
- `/api/compare` returns 422 with:
  `Historical quality pilot artifacts are descriptive measurements and cannot be compared as scorecards.`
- Apply the refusal when either artifact is quality and for both artifact-ID and run-ID routes.
- `FsArtifactSource` indexes `measurementKind` so clients can exclude quality without fetching every full artifact.

**Checklist**

- [ ] Refactor private attempt/run schemas into strict extendable base object schemas plus named `refineAttemptEvidence`/`refineRunEvidence` functions; reconstruct the legacy schemas from the same bases and refinements before adding quality specialization.
- [ ] Do not call `.extend()` on a schema after `.superRefine()`; add a source assertion or review grep proving no attempted extension of `ZodEffects` remains.
- [ ] Add legacy mutation-parity tests that independently exercise every existing attempt/run invariant before and after the refactor: timestamp/duration consistency, success/error/retry/backoff rules, deterministic IDs, attempt ownership and numbering, chronology, retry chaining, cancellation, success cardinality, recovered semantics, and failed-run attempt requirements.
- [ ] Prove representative valid and invalid legacy V1/V2 fixtures have identical parse outcomes and issue paths/messages across the refactor.
- [ ] Add a complete 10-row quality fixture and an incomplete fixture.
- [ ] Test unique transport IDs and reject duplicates despite different logical metadata.
- [ ] Test `runs: 1`, one execution row, one attempt, `recovered: false`, `retryable: false`, `backoffMs: 0`, and execution-only pass values.
- [ ] Add mutation tests that independently flip completed, execution status, attempt status, attempt count, recovered, retryable, backoff, passes, funnel presence, completedSlots, emitted/requested row count, and qualityVerdictAvailable; reject every inconsistent combination, including complete evidence with verdict false, while accepting a sanitized missing-row diagnostic only with verdict false.
- [ ] Reject wrong rule, wrong semantics, count drift, missing participant metrics, subset funnel, and quality baseline.
- [ ] Prove existing V1, V2, baseline, A/B, and matrix fixtures parse unchanged, in addition to the legacy mutation-parity matrix.
- [ ] Add indexed measurement-kind tests.
- [ ] Exclude quality in core comparison before statistical projection.
- [ ] Add 422 API tests for quality/reference, quality/subject, and run comparisons.
- [ ] Keep generic comparison behavior unchanged for non-quality artifacts.
- [ ] Independently review strict-schema compatibility and comparison control flow.

**RED**

```bash
cd packages/protocol
bun test eval/shared/tests/artifact.spec.ts eval/ops/tests/artifacts.spec.ts eval/ops/tests/compare.spec.ts eval/ops/tests/server.spec.ts
```

Expected: quality measurement is rejected by the strict envelope and comparison endpoints accept or project it generically.

**GREEN**

```bash
cd packages/protocol
bun test eval/shared/tests/artifact.spec.ts eval/ops/tests/artifacts.spec.ts eval/ops/tests/compare.spec.ts eval/ops/tests/server.spec.ts
```

Expected: strict quality fixtures pass, invalid projections fail, quality comparisons return the fixed exclusion, the legacy mutation-parity matrix passes, and legacy comparison tests remain green; no `.extend()` is invoked on `ZodEffects`.

**Commit**

```bash
git add packages/protocol/eval/shared/artifact.ts packages/protocol/eval/shared/tests/artifact.spec.ts packages/protocol/eval/shared/tests/artifact.fixtures.ts packages/protocol/eval/ops/ops.types.ts packages/protocol/eval/ops/ops.artifacts.ts packages/protocol/eval/ops/ops.compare.ts packages/protocol/eval/ops/ops.server.ts packages/protocol/eval/ops/tests/artifacts.spec.ts packages/protocol/eval/ops/tests/compare.spec.ts packages/protocol/eval/ops/tests/server.spec.ts
git commit -m "feat(eval): govern historical quality artifacts"
```

### 8. Render historical quality truthfully in Eval Ops

**Files**

- Create: `apps/eval-ops/src/components/HistoricalQualityReport.tsx`
- Create: `apps/eval-ops/tests/historical-quality.fixture.ts`
- Create: `apps/eval-ops/tests/historical-quality-report.test.tsx`
- Modify: `apps/eval-ops/src/api/client.ts`
- Modify: `apps/eval-ops/src/routes/ArtifactView.tsx`
- Modify: `apps/eval-ops/src/routes/Run.tsx`
- Modify: `apps/eval-ops/src/routes/Compare.tsx`
- Modify: `apps/eval-ops/src/routes/Overview.tsx`
- Modify: `apps/eval-ops/src/routes/Harness.tsx`
- Modify: `apps/eval-ops/tests/artifact.test.tsx`
- Modify: `apps/eval-ops/tests/run.test.tsx`
- Modify: `apps/eval-ops/tests/compare.test.tsx`
- Modify: `apps/eval-ops/tests/overview.test.tsx`
- Modify: `apps/eval-ops/tests/harness.test.tsx`
- Modify: `apps/eval-ops/tests/client.test.ts`

**Interfaces**

- Consumes:
  - Strict quality measurement discriminator
  - Typed `historicalQuality` rows
  - Indexed `measurementKind`
- Produces:
  - Dedicated quality report
  - Truthful overview/history labels
  - Client-side comparison exclusion
  - Unchanged generic discovery A/B and scorecard views

**Rendering sketch**

```tsx
if (artifact.measurement?.kind === "historical-quality-pilot") {
  return <HistoricalQualityReport artifact={artifact} />;
}
```

The dedicated report renders:

- `completedSlots/requestedSlots` as execution completeness;
- `quality verdict unavailable` when false;
- no aggregate quality section for incomplete artifacts;
- complete per logical case and trigger funnels;
- participant rows labeled `target`, `semantic-negative`, or `background`;
- retrieval rank/score/evidence type;
- evaluator eligible/submitted/returned/score;
- final rank and failure stage;
- a note that the runtime restores the selected child before every measured slot and uses one attempt.

It must not render aggregate pass rate, baseline delta, regression, winner, pass/fail quality percentage, prompt/profile/citation text, or reviewer data.

**Schema-valid fixture sketch**

```ts
export const COMPLETE_HISTORICAL_QUALITY_ARTIFACT =
  EvalArtifactEnvelopeV2Schema.parse(buildHistoricalQualityFixture({
    completedSlots: 10,
    requestedSlots: 10,
  }));
```

**Checklist**

- [ ] Add client types for measurement, quality rows, metrics, and funnels.
- [ ] Validate every UI fixture through the actual protocol V2 schema.
- [ ] Route Artifact and Run views by discriminator, not harness name.
- [ ] Render incomplete quality evidence with no funnel aggregate.
- [ ] Render complete case/trigger funnels and participant roles distinctly.
- [ ] Remove quality artifacts from Compare selectors.
- [ ] Replace quality pass-rate cells in Overview/Harness with `completed/requested`.
- [ ] Keep generic discovery single and A/B views unchanged.
- [ ] Keep ordinary scorecard and baseline comparison views unchanged.
- [ ] Assert forbidden labels and percentages are absent from quality views.
- [ ] Confirm no historical-quality launch control is added.
- [ ] Independently review complete and incomplete screenshots/DOM output.

**RED**

```bash
cd apps/eval-ops
bun run test -- tests/historical-quality-report.test.tsx tests/artifact.test.tsx tests/run.test.tsx tests/compare.test.tsx tests/overview.test.tsx tests/harness.test.tsx tests/client.test.ts
```

Expected: quality artifacts render as scorecards, expose aggregate pass rate, and remain selectable for comparison.

**GREEN**

```bash
cd apps/eval-ops
bun run test -- tests/historical-quality-report.test.tsx tests/artifact.test.tsx tests/run.test.tsx tests/compare.test.tsx tests/overview.test.tsx tests/harness.test.tsx tests/client.test.ts
```

Expected: dedicated complete/incomplete quality views pass and generic discovery/scorecard tests remain green.

**Commit**

```bash
git add apps/eval-ops/src/api/client.ts apps/eval-ops/src/components/HistoricalQualityReport.tsx apps/eval-ops/src/routes/ArtifactView.tsx apps/eval-ops/src/routes/Run.tsx apps/eval-ops/src/routes/Compare.tsx apps/eval-ops/src/routes/Overview.tsx apps/eval-ops/src/routes/Harness.tsx apps/eval-ops/tests/historical-quality.fixture.ts apps/eval-ops/tests/historical-quality-report.test.tsx apps/eval-ops/tests/artifact.test.tsx apps/eval-ops/tests/run.test.tsx apps/eval-ops/tests/compare.test.tsx apps/eval-ops/tests/overview.test.tsx apps/eval-ops/tests/harness.test.tsx apps/eval-ops/tests/client.test.ts
git commit -m "feat(eval-ops): render historical quality evidence"
```

### 9. Document and version the PR A contract

**Files**

- Modify: `packages/protocol/package.json`
- Modify: `packages/protocol/CHANGELOG.md`
- Modify: `services/api/package.json`
- Modify: `docs/guides/development-reference.md`
- Modify: `bun.lock`

**Interfaces**

- Consumes:
  - Completed PR A contract
  - Repository SemVer and subtree rules
- Produces:
  - Protocol `10.1.0`
  - API `0.78.0`
  - Unchanged Eval Ops `0.6.0`
  - Regenerated root lockfile
  - Operator/developer documentation

**Changelog entry**

Add under the existing changelog format:

```md
## 10.1.0 - 2026-08-07

### Added

- Added the independently reviewed 25-participant historical shared-pool contract, single-configuration dual-trigger pilot planner, descriptive stage-funnel metrics, and strict execution-completeness artifact schema for IND-638A.
```

Development Reference must document:

- exact `--historical-quality` syntax;
- omitted trigger means both;
- default 30 and first-pilot 10 invocation estimates;
- one attempt, restore-per-slot contract, 200 cap, and no subset verdict;
- no baseline/comparison semantics;
- PR A prints help and cost provider-free, then refuses runtime;
- runtime, protected-base, and operational commands arrive only in PR B;
- Eval Ops renders reports but cannot launch quality mode.

**Checklist**

- [ ] Change protocol version only from `10.0.3` to `10.1.0`.
- [ ] Change API version only from `0.77.3` to `0.78.0`.
- [ ] Assert Eval Ops remains `0.6.0`.
- [ ] Add the protocol changelog entry.
- [ ] Update the Development Reference without adding PR B operational commands.
- [ ] Run `bun install` at repository root to regenerate `bun.lock`.
- [ ] Verify mirrored dependency pins remain exact.
- [ ] Independently review versions, lock diff, and documentation claims.

**RED**

```bash
bun -e 'const p=await Bun.file("packages/protocol/package.json").json(); const a=await Bun.file("services/api/package.json").json(); const e=await Bun.file("apps/eval-ops/package.json").json(); if(p.version!=="10.1.0"||a.version!=="0.78.0"||e.version!=="0.6.0") process.exit(1)'
```

Expected: exits 1 because protocol/API still have their old versions.

**GREEN**

```bash
bun install
bun install --frozen-lockfile
bun -e 'const p=await Bun.file("packages/protocol/package.json").json(); const a=await Bun.file("services/api/package.json").json(); const e=await Bun.file("apps/eval-ops/package.json").json(); if(p.version!=="10.1.0"||a.version!=="0.78.0"||e.version!=="0.6.0") process.exit(1)'
bun run check:subtree-parity
```

Expected: lockfile is current, version assertion exits 0, Eval Ops is unchanged, and subtree parity passes.

**Commit**

```bash
git add packages/protocol/package.json packages/protocol/CHANGELOG.md services/api/package.json docs/guides/development-reference.md bun.lock
git commit -m "chore: version IND-638A shared pool contract"
```

### 10. Run provider-free validation and record the PR handoff checkpoint

**Files**

- Create: `docs/research/2026-08-07-ind-638a-validation-receipt.md`
- Modify only if validation or independent review finds a concrete defect:
  - The affected source/test files from Tasks 1–9

**Interfaces**

- Consumes:
  - Captured `baseRevision` from `git merge-base origin/dev HEAD`
  - Captured `validatedImplementationHead` containing exactly Tasks 1–9 and the immutable approval receipt, before the validation receipt exists
  - Actual local validation outputs and independent review of that exact implementation head
- Produces:
  - Durable non-self-referential validation receipt committed after validation
  - Clean final branch
  - PR handoff with no merge assumption; forge/PR/check evidence is recorded outside the receipt commit

The receipt records actual values only:

- `baseRevision` and `validatedImplementationHead` (never claims that its own later commit validated itself);
- approved pooled content revision, approval receipt commit, and reviewer receipt;
- protocol/API/Eval Ops versions;
- every command and exit result below;
- confirmation that no provider, DB, Redis, Neon, protected-base, or live-eval command ran;
- changed-file summary;
- generated-artifact/static-inventory results;
- independent review identity, reviewed revision exactly equal to `validatedImplementationHead`, timestamp, findings, and any resolution commits already included in that captured head;
- residual risks.

The receipt must not contain its own commit hash, a later final branch head, PR URL, remote check result, or PR snapshot claim. After the receipt commit exists, put the actual receipt commit/final head, PR URL, required-check evidence, and `pr:snapshot` result in the PR body/comment and Linear evidence. Do not create the receipt with blank fields. Create it only after all local evidence and exact-head review exist.

**Checklist**

- [ ] Commit every Task 1–9 implementation/review fix, require a clean index, then capture immutable `baseRevision` and `validatedImplementationHead`; do not create the validation receipt yet.
- [ ] Verify Task 3’s approved content and receipt commits remain ancestors, all three content fingerprints still match, and the approval JSON at `validatedImplementationHead` is byte-identical to the reviewer-authored blob.
- [ ] Run every targeted command below without provider credentials or `DATABASE_URL` against that exact `validatedImplementationHead`.
- [ ] Inspect the final source and documentation diff for unfinished markers, fabricated reviewer data, and forbidden quality labels.
- [ ] Inspect `${baseRevision}...${validatedImplementationHead}` with `git diff --check`, `--stat`, `--name-status`, and the complete diff.
- [ ] Run the machine-checked PR A changed-path allowlist below and reject every unlisted path.
- [ ] Verify no staged files before the final receipt commit.
- [ ] Request independent code review of exact `validatedImplementationHead`.
- [ ] Resolve every blocking finding, commit it, recapture `validatedImplementationHead`, and rerun the affected RED/GREEN plus the entire exact-head diff/validation gate.
- [ ] Commit the actual receipt only after review and local validation; verify the only path added after `validatedImplementationHead` is the receipt.
- [ ] Push and reconcile upstream state.
- [ ] Snapshot the actual PR and verify required checks/reviews.
- [ ] Stop at the merge checkpoint and obtain separate explicit authorization through `manage-pr`; do not run a merge command.

**Provider-free validation commands**

```bash
cd "$(git rev-parse --show-toplevel)"
test -z "$(git status --porcelain)"
git fetch origin dev
baseRevision="$(git merge-base origin/dev HEAD)"
validatedImplementationHead="$(git rev-parse HEAD^{commit})"
git cat-file -e "$baseRevision^{commit}"
git cat-file -e "$validatedImplementationHead^{commit}"
test "$(git rev-parse HEAD^{commit})" = "$validatedImplementationHead"
test -z "$(git diff --cached --name-only)"

approvalReceiptPath=docs/research/2026-08-07-ind-638a-shared-pool-approval.json
approvalReceiptCommit="$(git log --diff-filter=A --format=%H -- "$approvalReceiptPath" | tail -1)"
test -n "$approvalReceiptCommit"
git cat-file -e "$approvalReceiptCommit^{commit}"
git merge-base --is-ancestor "$approvalReceiptCommit" "$validatedImplementationHead"
test "$(git rev-parse "$approvalReceiptCommit:$approvalReceiptPath")" = "$(git rev-parse "$validatedImplementationHead:$approvalReceiptPath")"
git diff --exit-code "$approvalReceiptCommit" "$validatedImplementationHead" -- "$approvalReceiptPath"

bun install --frozen-lockfile
bun run check:subtree-parity

cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts eval/discovery-env-matrix/tests/historical-quality.pilot.spec.ts eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts
bun test eval/shared/tests/artifact.spec.ts eval/ops/tests/artifacts.spec.ts eval/ops/tests/compare.spec.ts eval/ops/tests/server.spec.ts
bun run eval:verify
bun run build
bun run architecture:exports
bun run architecture:consumer
bun run architecture:host-isolation
bun run architecture:capabilities
bun run architecture:cycles
bun run architecture:artifacts

cd ../../services/api
bun test src/cli/tests/discovery.quality.spec.ts src/cli/tests/discovery.contract.spec.ts src/cli/tests/discovery.parent.spec.ts src/cli/tests/discovery.plan.spec.ts
bun test src/queues/tests/discovery-trigger.builders.spec.ts src/queues/tests/from-intent.queue.isolated.ts src/queues/tests/from-enrichment.queue.isolated.ts
bun run typecheck:cli-specs
bun run build
bun run lint

cd ../../apps/eval-ops
bun run test -- tests/historical-quality-report.test.tsx tests/artifact.test.tsx tests/run.test.tsx tests/compare.test.tsx tests/overview.test.tsx tests/harness.test.tsx tests/client.test.ts
bun run typecheck
bun run build
bun run lint

cd ../..
bun run skills:validate

git diff --check "$baseRevision...$validatedImplementationHead"
git diff --stat "$baseRevision...$validatedImplementationHead"
git diff --name-status "$baseRevision...$validatedImplementationHead"
git diff "$baseRevision...$validatedImplementationHead"
while IFS= read -r path; do
  case "$path" in
    bun.lock|packages/protocol/package.json|packages/protocol/CHANGELOG.md|services/api/package.json|docs/guides/development-reference.md|docs/research/2026-08-07-ind-638a-shared-pool-approval.json) ;;
    packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.ts|packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.ts|packages/protocol/eval/discovery-env-matrix/historical-quality.pilot.ts|packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.ts) ;;
    packages/protocol/eval/discovery-env-matrix/tests/historical-quality.shared-pool.spec.ts|packages/protocol/eval/discovery-env-matrix/tests/historical-quality.pilot.spec.ts|packages/protocol/eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts) ;;
    packages/protocol/eval/shared/artifact.ts|packages/protocol/eval/shared/tests/artifact.spec.ts|packages/protocol/eval/shared/tests/artifact.fixtures.ts) ;;
    packages/protocol/eval/ops/ops.types.ts|packages/protocol/eval/ops/ops.artifacts.ts|packages/protocol/eval/ops/ops.compare.ts|packages/protocol/eval/ops/ops.server.ts|packages/protocol/eval/ops/tests/artifacts.spec.ts|packages/protocol/eval/ops/tests/compare.spec.ts|packages/protocol/eval/ops/tests/server.spec.ts) ;;
    services/api/src/cli/discovery-quality.contract.ts|services/api/src/cli/discovery.ts|services/api/src/cli/discovery.contract.ts|services/api/src/cli/tests/discovery.quality.spec.ts) ;;
    services/api/src/queues/opportunity/discovery-trigger.builders.ts|services/api/src/queues/opportunity/from-intent.queue.ts|services/api/src/queues/opportunity/from-enrichment.queue.ts|services/api/src/queues/tests/discovery-trigger.builders.spec.ts|services/api/src/queues/tests/from-intent.queue.isolated.ts|services/api/src/queues/tests/from-enrichment.queue.isolated.ts) ;;
    apps/eval-ops/src/api/client.ts|apps/eval-ops/src/components/HistoricalQualityReport.tsx|apps/eval-ops/src/routes/ArtifactView.tsx|apps/eval-ops/src/routes/Run.tsx|apps/eval-ops/src/routes/Compare.tsx|apps/eval-ops/src/routes/Overview.tsx|apps/eval-ops/src/routes/Harness.tsx) ;;
    apps/eval-ops/tests/historical-quality.fixture.ts|apps/eval-ops/tests/historical-quality-report.test.tsx|apps/eval-ops/tests/artifact.test.tsx|apps/eval-ops/tests/run.test.tsx|apps/eval-ops/tests/compare.test.tsx|apps/eval-ops/tests/overview.test.tsx|apps/eval-ops/tests/harness.test.tsx|apps/eval-ops/tests/client.test.ts) ;;
    *) printf 'PR A path outside allowlist: %s\n' "$path" >&2; exit 1 ;;
  esac
done < <(git diff --name-only "$baseRevision...$validatedImplementationHead")

unfinishedMarker='place''holder'
if git diff --unified=0 "$baseRevision...$validatedImplementationHead" | grep -E "^\\+.*(TBD|FIXME|TODO|<${unfinishedMarker}>)"; then
  exit 1
fi
test "$(git rev-parse HEAD^{commit})" = "$validatedImplementationHead"
test -z "$(git status --porcelain)"
```

Expected: every command passes; the no-match search succeeds through explicit `if ...; then exit 1; fi` handling; the captured implementation head remains unchanged and clean; no provider or infrastructure access occurs.

**Post-receipt verification**

```bash
test "$(git rev-parse HEAD^{commit})" = "$validatedImplementationHead"
git add docs/research/2026-08-07-ind-638a-validation-receipt.md
test "$(git diff --cached --name-only)" = "docs/research/2026-08-07-ind-638a-validation-receipt.md"
git commit -m "docs: record IND-638A validation receipt"
receiptCommit="$(git rev-parse HEAD^{commit})"
test "$(git rev-parse HEAD^)" = "$validatedImplementationHead"
test "$(git diff --name-only "$validatedImplementationHead..$receiptCommit")" = "docs/research/2026-08-07-ind-638a-validation-receipt.md"
git status --short --branch
git log -2 --oneline
```

Expected: the receipt commit directly follows the locally validated/reviewed implementation head, adds only the receipt, and the working tree is clean. The receipt does not claim to validate `receiptCommit`.

**PR handoff commands**

```bash
git push
git fetch origin "$(git branch --show-current)"
git status --short --branch
bun run pr:snapshot -- "$(gh pr view --json number --jq .number)"
```

Expected: local branch has no ahead/behind drift and the snapshot names the actual final head/base revisions. Record `receiptCommit`, final head, PR URL, required checks/reviews, and snapshot output in the PR body/comment and Linear—not in the committed validation receipt. Do not proceed to merge without separate explicit authorization.

## Dependencies

1. Task 1 establishes the shared-pool contract required by Tasks 2 and 3.
2. Task 2 requires Task 1 and creates the exact pending revision reviewed in Task 3.
3. Task 3 is a blocking approval gate. Tasks 4–10 must not represent the pool as admitted until it passes.
4. Task 4 depends on the admitted case IDs and shared fingerprints from Tasks 1–3.
5. Task 5 is independent of runtime implementation but must complete before PR B can consume production-shaped triggers.
6. Task 6 depends on Task 1’s participant roles.
7. Task 7 depends on Task 6’s typed metrics and summaries.
8. Task 8 depends on Task 7’s strict wire schema and indexed discriminator.
9. Task 9 follows all code surfaces so versions and documentation describe the final contract.
10. Task 10 depends on every prior task and blocks PR handoff.

## Risks

- **Independent reviewer availability:** strict admission must remain pending until a real independent audit of the exact content revision is complete.
- **Fingerprint invalidation:** any content, source path, canonical ordering, or retrieval-document change invalidates approval and requires a fresh reviewed revision.
- **Corpus order coupling:** existing case content uses arrays; shared-pool source paths and IDs must remain ID-addressed and invariant under array reordering.
- **Accidental factual invention:** the 20 derived rows must use only exact approved fields and the fixed labels/template; manual prose is prohibited.
- **Transport semantics confusion:** quality rows deliberately use scorecard fields for execution completeness. UI and aggregation must never interpret them as quality.
- **Legacy regression:** bootstrap dispatch, artifact schemas, and UI routes are shared with existing discovery modes; targeted legacy tests are mandatory.
- **Queue behavior drift:** extracting builders must not move or weaken admission, change retries, or suppress production callbacks.
- **Schema/UI drift:** UI fixtures must be parsed through the real V2 schema rather than relying on hand-maintained TypeScript mirrors.
- **Version/lock mismatch:** protocol and API version changes must be reflected in root `bun.lock`; Eval Ops must remain unbumped.
- **PR B leakage:** no runtime, manifest, database, protected-base, embedding, reset, Redis namespace, or live-pilot implementation belongs in PR A.
- **Merge governance:** green validation is not merge authorization; the final checkpoint must stop until separate explicit authorization is received.