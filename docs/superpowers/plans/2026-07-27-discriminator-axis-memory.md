# Durable Discriminator-Axis Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent pool-discovery discriminator cards from repeating an answered or dismissed axis after ordinary intent refinements.

**Architecture:** Persisted answered/dismissed pool-discovery rows become durable per-intent semantic history, independent of their capture-time fingerprint. The protocol shadow scorer reports when it could not evaluate prior axis references; API mining suppresses enqueueing in that case. The existing advisory-lock persistence boundary additionally rejects exact normalized labels across versions.

**Tech Stack:** TypeScript, Bun tests, Drizzle ORM/PostgreSQL, LangChain structured model, existing pool discriminator embeddings.

## Global Constraints

- Scope is `pool_discovery` discriminator questions only.
- Answered or dismissed non-voided axes remain suppressed per `(userId, intentId)` across all ordinary intent updates.
- Do not add a database migration, table, UI, chat command, or automatic reopen behavior.
- Retain existing pending-card, live-pool freshness, lifecycle, budget, and delivery behavior.
- When historical semantic protection exists but comparison fails, do not enqueue a new pool question for that mining pass.
- Keep one writer in the worktree; use fresh read-only reviewers after each implementation task.

---

## File map

| File | Change |
| --- | --- |
| `packages/protocol/src/opportunity/discriminator/discriminator.types.ts` | Add the shadow-result flag that reports an unavailable comparison with prior references. |
| `packages/protocol/src/opportunity/discriminator/discriminator.shadow.ts` | Set that flag only when comparison against prior resolved-axis references cannot run. |
| `packages/protocol/src/opportunity/discriminator/tests/discriminator.shadow.spec.ts` | Cover the observable failure signal and preserve no-history degraded behavior. |
| `services/api/src/adapters/questioner.adapter.ts` | Read durable resolved axes across fingerprints and enforce cross-version exact resolved-label rejection in the locked write transaction. |
| `services/api/src/adapters/tests/questioner.lifecycle.spec.ts` | Cover resolved-label/axis retention after a material intent update. |
| `services/api/src/queues/pool/mining.shared.ts` | Add a pure enqueue-admission helper and fence pool-question enqueue when the protocol reports unavailable historical semantic protection. |
| `services/api/src/queues/pool/tests/mining.shared.isolated.ts` | Cover no-enqueue on historical comparison failure and normal distinct-axis enqueueing. |
| `services/api/src/queues/tests/pool-question.queue.isolated.ts` | Preserve initial queue exact-label behavior across a changed fingerprint. |

## Task 1: Surface historical semantic-comparison failure from protocol

**Files:**
- Modify: `packages/protocol/src/opportunity/discriminator/discriminator.types.ts`
- Modify: `packages/protocol/src/opportunity/discriminator/discriminator.shadow.ts`
- Test: `packages/protocol/src/opportunity/discriminator/tests/discriminator.shadow.spec.ts`

**Interfaces:**
- Consumes: `DiscriminatorShadowInput.priorReferenceTexts` and `DiscriminatorShadowInput.priorReferenceEmbeddings`.
- Produces: `DiscriminatorShadowResult.priorReferenceComparisonUnavailable?: boolean`.
- Contract: the flag is `true` only when at least one prior reference was supplied and the embedding batch needed to compare it failed or was invalid. It is absent when there is no prior history and ordinary reference degradation remains allowed.

- [ ] **Step 1: Write failing protocol tests**

Add one test whose input contains `priorReferenceEmbeddings: [[0.4, 0.6, 0.2]]` and an embedder that throws. Assert the result has `priorReferenceComparisonUnavailable: true`. Add a companion test with no `priorReferenceTexts` or `priorReferenceEmbeddings`, the same failing embedder, and assert the flag is absent while the returned discriminator remains scored.

- [ ] **Step 2: Run the focused protocol test to verify it fails**

Run:
```bash
cd packages/protocol && bun test src/opportunity/discriminator/tests/discriminator.shadow.spec.ts
```

Expected: the new assertion fails because `DiscriminatorShadowResult` has no failure signal.

- [ ] **Step 3: Add the result contract and implementation**

In `discriminator.types.ts`, extend the result shape:
```ts
export interface DiscriminatorShadowResult {
  poolSize: number;
  discriminators: ScoredDiscriminator[];
  priorReferenceComparisonUnavailable?: boolean;
}
```

In `runPoolDiscriminatorShadow`, compute whether `priorReferenceTexts` or `priorReferenceEmbeddings` are non-empty after normalization. In the existing embedding `catch`, retain the current `novelty = 1` fallback and return the new flag only when that prior-history boolean is true. Preserve the existing empty-mined result exactly.

- [ ] **Step 4: Run the focused protocol test to verify it passes**

Run:
```bash
cd packages/protocol && bun test src/opportunity/discriminator/tests/discriminator.shadow.spec.ts
```

Expected: PASS, including both prior-history and no-history failure cases.

- [ ] **Step 5: Commit the protocol task**

```bash
git add packages/protocol/src/opportunity/discriminator/discriminator.types.ts \
  packages/protocol/src/opportunity/discriminator/discriminator.shadow.ts \
  packages/protocol/src/opportunity/discriminator/tests/discriminator.shadow.spec.ts
git commit -m "fix(protocol): signal unavailable discriminator history comparison"
```

## Task 2: Make resolved pool axes and exact labels durable across versions

**Files:**
- Modify: `services/api/src/adapters/questioner.adapter.ts`
- Test: `services/api/src/adapters/tests/questioner.lifecycle.spec.ts`

**Interfaces:**
- Consumes: `QuestionerAdapter.listResolvedPoolAxes(userId, intentId)`.
- Produces: all non-voided `answered` or `dismissed` `pool_discovery` discriminators for that owner and intent, newest first, without a fingerprint-freshness filter.
- Contract: `persistFreshPoolQuestion` returns `null` when an existing non-voided resolved row has the same normalized discriminator label, even if the existing row has an older fingerprint.

- [ ] **Step 1: Write failing lifecycle tests**

In `questioner.lifecycle.spec.ts`, create an answered pool question with label `Working style` and an old fingerprint, mutate the intent to a different material fingerprint, then attempt a fresh pool-question persistence with the same label and the new fingerprint. Assert `persistFreshPoolQuestion` returns `null`.

Add a `listResolvedPoolAxes` test that creates an answered old-fingerprint axis, mutates the intent, calls `listResolvedPoolAxes(userId, intentId)`, and asserts the original discriminator remains returned. Include a distinct label control that is still permitted by persistence.

- [ ] **Step 2: Run the focused adapter test to verify it fails**

Run:
```bash
cd services/api && bun test src/adapters/tests/questioner.lifecycle.spec.ts
```

Expected: the old-fingerprint axis is omitted and/or same-label persistence succeeds.

- [ ] **Step 3: Implement durable history and the write fence**

Change `listResolvedPoolAxes` to take only `(userId, intentId)` and remove its current fingerprint/text freshness predicate. Keep its status, actor, mode, intent, and `voidedReason` filters, ordered newest-first.

Update its call in `services/api/src/queues/pool/mining.shared.ts` to use the two-argument signature.

In `persistFreshPoolQuestion`, replace the fingerprint-based branch of the `askedAxis` predicate with:
```ts
or(
  and(eq(questions.status, 'pending'), or(isNull(questions.expiresAt), sql`${questions.expiresAt} > NOW()`)),
  inArray(questions.status, ['answered', 'dismissed']),
)
```

Keep the surrounding actor, pool-discovery mode, intent, non-voided, normalized-label, advisory-lock, lifecycle, live-pool, and mode-enabled conditions unchanged. Add `inArray` to the existing Drizzle imports if it is not already imported.

Adjust `listPoolQuestionLabels`/`isPoolQuestionFresh` so historical answered/dismissed labels are returned independent of fingerprint, while pending behavior stays unchanged. This keeps alternate chaining aligned with the transaction fence.

- [ ] **Step 4: Run the focused adapter test to verify it passes**

Run:
```bash
cd services/api && bun test src/adapters/tests/questioner.lifecycle.spec.ts
```

Expected: PASS; the old resolved axis remains history, exact cross-version reinsert is blocked, and a distinct label remains eligible.

- [ ] **Step 5: Commit the adapter task**

```bash
git add services/api/src/adapters/questioner.adapter.ts \
  services/api/src/adapters/tests/questioner.lifecycle.spec.ts \
  services/api/src/queues/pool/mining.shared.ts
git commit -m "fix(api): retain resolved discriminator axes across intent edits"
```

## Task 3: Prevent a failed historical comparison from enqueueing a card

**Files:**
- Modify: `services/api/src/queues/pool/mining.shared.ts`
- Test: `services/api/src/queues/pool/tests/mining.shared.isolated.ts`
- Test: `services/api/src/queues/tests/pool-question.queue.isolated.ts`

**Interfaces:**
- Consumes: `DiscriminatorShadowResult.priorReferenceComparisonUnavailable` from Task 1.
- Produces: `shouldEnqueuePoolQuestionForResolvedHistory(shadow: Pick<DiscriminatorShadowResult, 'priorReferenceComparisonUnavailable'>): boolean` and no `questionerEnqueueIfEnabled()` call when it returns `false`.
- Contract: the helper returns `false` only when the protocol explicitly reports unavailable comparison against durable history; a distinct, successfully compared axis continues through `selectQuestionDiscriminators` and enqueues normally.

- [ ] **Step 1: Write failing mining tests**

In `mining.shared.isolated.ts`, import `shouldEnqueuePoolQuestionForResolvedHistory`. Add one test asserting it returns `false` for:
```ts
{ priorReferenceComparisonUnavailable: true }
```
and a control asserting it returns `true` for `{}`.

In `pool-question.queue.isolated.ts`, add a regression test whose `listPoolQuestionLabels` stub returns `['Working style']` for a new-fingerprint discriminator labelled `Working style`; call `processJob` and assert no persistence call occurs. The lifecycle adapter test in Task 2 remains the authoritative transactional cross-version proof.

- [ ] **Step 2: Run the focused API tests to verify they fail**

Run:
```bash
cd services/api && bun test src/queues/pool/tests/mining.shared.isolated.ts src/queues/tests/pool-question.queue.isolated.ts
```

Expected: the new import is unavailable; the queue regression also demonstrates the required label-history contract.

- [ ] **Step 3: Add the enqueue fence**

Export this pure helper from `mining.shared.ts`:
```ts
export function shouldEnqueuePoolQuestionForResolvedHistory(
  shadow: Pick<DiscriminatorShadowResult, 'priorReferenceComparisonUnavailable'>,
): boolean {
  return shadow.priorReferenceComparisonUnavailable !== true;
}
```

Import `DiscriminatorShadowResult` as a type from `@indexnetwork/protocol`. Immediately after `runPoolDiscriminatorShadow` returns in the internal mining function, retain the existing shadow-result log. Before calling `selectQuestionDiscriminators` or `questionerEnqueueIfEnabled`, call the helper and, when it returns `false`, log:
```ts
logger.warn('pool question skipped: resolved-axis comparison unavailable', {
  source: trigger.source,
  runId: trigger.runId ?? null,
  userId,
  intentId,
});
```
then return. Do not change question-mining behavior when the flag is absent. Do not move lifecycle, pool-size, or candidate-freshness guards.

- [ ] **Step 4: Run the focused API tests to verify they pass**

Run:
```bash
cd services/api && bun test src/queues/pool/tests/mining.shared.isolated.ts src/queues/tests/pool-question.queue.isolated.ts
```

Expected: PASS; flagged historical-comparison failures are rejected by the admission helper, normal cases remain admitted, and existing label-history queue suppression stays intact.

- [ ] **Step 5: Commit the mining task**

```bash
git add services/api/src/queues/pool/mining.shared.ts \
  services/api/src/queues/pool/tests/mining.shared.isolated.ts \
  services/api/src/queues/tests/pool-question.queue.isolated.ts
git commit -m "fix(api): suppress pool cards when axis history cannot be compared"
```

## Task 4: Verify the complete discriminator regression surface

**Files:**
- Modify: any test files only if focused verification reveals a missing assertion; otherwise no source changes.

**Interfaces:**
- Consumes: the protocol failure signal, durable adapter history, and API enqueue fence from Tasks 1–3.
- Produces: verification evidence that answered/dismissed discriminator axes remain suppressed across intent versions without affecting distinct axes.

- [ ] **Step 1: Build protocol for API isolated imports**

Run:
```bash
bun --cwd packages/protocol run build
```

Expected: exits 0 and creates the package distribution required by isolated API queue tests.

- [ ] **Step 2: Run focused protocol and API regressions**

Run:
```bash
cd packages/protocol && bun test src/opportunity/discriminator/tests/discriminator.shadow.spec.ts
cd ../../services/api && bun test \
  src/adapters/tests/questioner.lifecycle.spec.ts \
  src/queues/pool/tests/mining.shared.isolated.ts \
  src/queues/tests/pool-question.queue.isolated.ts \
  src/events/handlers/tests/question.answer.pool.isolated.ts
```

Expected: all selected tests pass.

- [ ] **Step 3: Run repository diff, compile, and lint checks used by the changed packages**

Run:
```bash
git diff origin/dev...HEAD --check
bun --cwd packages/protocol run build
bunx tsc --project services/api/tsconfig.json --noEmit
bun --cwd services/api run lint
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit any verification-driven test correction**

If verification required a test-only correction:
```bash
git add <exact corrected test paths>
git commit -m "test: cover discriminator axis history regression"
```

If no correction was needed, do not create an empty commit.

## Final review and PR

- [ ] Request an independent read-only review of the cumulative diff, specifically checking that no generic question mode changed and that any historical comparison failure fails closed only when durable resolved history exists.
- [ ] Address verified findings, rerun the Task 4 verification commands, and commit fixes.
- [ ] Push `fix/discriminator-axis-memory` and open a PR to `dev` with the problem, behavior change, no-migration/no-UI scope, and exact verification results.
