# Final discriminator-axis memory fix report

## Status

Completed the final review fix wave with no product-scope expansion. The changes remain limited to pool-discovery semantic-history scoring and its regression coverage; generic question behavior, migrations, UI, reopening, and pool lifecycle/pending guards are unchanged.

## Implementation

- Removed the 24-item caps from `priorReferenceTexts` and `priorReferenceEmbeddings` in `runPoolDiscriminatorShadow`. Every normalized durable resolved-axis reference now reaches novelty scoring; the separate 24-item cap for ordinary current intent/premise text remains unchanged.
- Validated a common vector dimension across all generated comparison vectors and supplied non-empty prior vectors before cosine scoring. Any incompatible batch follows the existing novelty-`1` fallback and, when resolved history exists, returns `priorReferenceComparisonUnavailable: true` so the existing API admission helper rejects enqueueing.
- Updated `questioner.adapter.isolated.ts` to assert durable resolved labels/axes across fingerprints and all 49 resolved rows (25 current plus 24 stale), rather than stale filtering or a 24-row cap.

## Regression coverage

- Protocol tests prove the 25th prior text reference and 25th prior embedding reference each suppress an equivalent new axis.
- Protocol tests prove incompatible prior/generated dimensions set `priorReferenceComparisonUnavailable` while preserving fallback scoring.
- The existing API queue helper test proves that explicit flag fails closed; the queue suite continues to prove label-history suppression, lifecycle final gates, MODE re-read, and pending-budget protection.

## Verification

Passed:

```sh
cd packages/protocol && bun test ./src/opportunity/discriminator/tests/discriminator.shadow.spec.ts
# 14 pass, 0 fail, 37 assertions

cd services/api && TEST_DATABASE_SAFE=1 bun test ./tests/questioner.adapter.isolated.ts --test-name-pattern 'keeps resolved labels|returns every resolved axis'
# 2 pass, 0 fail, 12 assertions

cd services/api && TEST_DATABASE_SAFE=1 bun test ./src/queues/pool/tests/mining.shared.isolated.ts ./src/queues/tests/pool-question.queue.isolated.ts
# 26 pass, 0 fail, 59 assertions

bunx tsc --project services/api/tsconfig.json --noEmit --pretty false
# passed

git diff --check
# passed
```

Also ran the complete `services/api/tests/questioner.adapter.isolated.ts` file. The two unrelated pre-existing failures remain: its generic `profile`/unproven `negotiation` fixtures are excluded by current generic mode/provenance behavior. They are present unchanged in `origin/dev`; this fix intentionally did not alter generic question modes or negotiation guards. The two updated discriminator-history tests pass when targeted above.

## Changed files

- `packages/protocol/src/opportunity/discriminator/discriminator.shadow.ts`
- `packages/protocol/src/opportunity/discriminator/discriminator.types.ts`
- `packages/protocol/src/opportunity/discriminator/tests/discriminator.shadow.spec.ts`
- `services/api/tests/questioner.adapter.isolated.ts`
- `.superpowers/sdd/2026-07-27-discriminator-axis-memory/final-fix-report.md`

## Residual risk

Unbounded resolved-axis history now intentionally grows the embedding comparison batch with all durable axes. This is required for complete duplicate suppression, but exceptionally long-lived intents may increase embedding request size and latency. The full adapter-isolated file still has the two unrelated stale-fixture failures documented above.
