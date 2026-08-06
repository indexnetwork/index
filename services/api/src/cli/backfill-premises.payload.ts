import type { EnrichUserData } from '../queues/enrichment.queue';

/** Preserve the selected network scope through worker-time admission. */
export function buildBackfillEnrichmentItems(
  members: ReadonlyArray<{ userId: string }>,
  networkId: string,
): EnrichUserData[] {
  return members.map(({ userId }) => ({
    userId,
    networkId,
    reason: 'backfill_premises',
  }));
}
