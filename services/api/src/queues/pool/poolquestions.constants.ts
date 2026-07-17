import type { QuestionPoolDiscriminator, QuestionPoolSnapshot } from '@indexnetwork/protocol';

/** Minimum retained pool overlap required for a stored pool artifact to stay fresh. */
export const POOL_QUESTION_FRESHNESS_THRESHOLD = 0.7;

/**
 * Jaccard similarity over two ID sets. Inputs are deduplicated and an empty
 * side fails closed rather than treating two empty sets as fresh.
 */
export function setJaccard(left: Iterable<string>, right: Iterable<string>): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;

  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection++;
  }
  return intersection / (leftSet.size + rightSet.size - intersection);
}

/** Extract and deduplicate the stored assignment opportunity IDs. */
export function extractAssignmentOpportunityIds(
  value: QuestionPoolSnapshot | QuestionPoolDiscriminator | null | undefined,
): string[] {
  if (!value) return [];
  const discriminator = 'discriminator' in value ? value.discriminator : value;
  if (!Array.isArray(discriminator.assignments)) return [];
  return [...new Set(discriminator.assignments.flatMap((assignment) =>
    typeof assignment?.opportunityId === 'string' && assignment.opportunityId.trim()
      ? [assignment.opportunityId]
      : []))];
}

/** Cadence uses the exact stored pool when available, with legacy assignment fallback. */
export function extractSnapshotOpportunityIds(pool: QuestionPoolSnapshot | null | undefined): string[] {
  if (!pool) return [];
  const stored = Array.isArray(pool.opportunityIds)
    ? pool.opportunityIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  return stored.length > 0 ? [...new Set(stored)] : extractAssignmentOpportunityIds(pool);
}

/** Strict fingerprint plus asked-assignment freshness for queued artifacts. */
export function isPoolArtifactFresh(
  pool: QuestionPoolSnapshot | undefined,
  currentIntentFingerprint: string,
  currentPoolIds: Iterable<string>,
): boolean {
  if (!pool?.intentFingerprint || pool.intentFingerprint !== currentIntentFingerprint) return false;
  const assignmentIds = extractAssignmentOpportunityIds(pool);
  if (assignmentIds.length === 0) return false;
  return setJaccard(assignmentIds, currentPoolIds) >= POOL_QUESTION_FRESHNESS_THRESHOLD;
}
