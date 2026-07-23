/** State observed while holding an opportunity row lock for reactivation. */
export interface LockedNegotiatingOpportunity {
  status: string;
}

/**
 * Transaction-bound operations required to reactivate a taskless negotiation.
 * The caller owns the surrounding transaction, so its advisory and row locks
 * remain held until the returned mutation commits or rolls back.
 */
export interface NegotiationReactivationBoundary<T> {
  acquireAttemptLock(): Promise<void>;
  validateEligibility(): Promise<boolean>;
  lockOpportunity(): Promise<LockedNegotiatingOpportunity | null>;
  hasFreshNegotiationTask(): Promise<boolean>;
  reactivate(): Promise<T | null>;
}

/**
 * Serialize reactivation with negotiation task creation and recheck both the
 * opportunity row and canonical fresh-task predicate immediately before the
 * mutation.
 *
 * @param boundary - Transaction-bound lock, validation, read, and write hooks
 * @returns The reactivated value, or null when eligibility, status, or task ownership drifted
 */
export async function runTasklessNegotiationReactivation<T>(
  boundary: NegotiationReactivationBoundary<T>,
): Promise<T | null> {
  await boundary.acquireAttemptLock();
  if (!await boundary.validateEligibility()) return null;

  const opportunity = await boundary.lockOpportunity();
  if (opportunity?.status !== 'negotiating') return null;
  if (await boundary.hasFreshNegotiationTask()) return null;

  return boundary.reactivate();
}
