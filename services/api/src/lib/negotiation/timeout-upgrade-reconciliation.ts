/**
 * Legacy park-origin derivation for the pickup claim seam (`pickupNegotiationAtomically`).
 *
 * The startup reconciler that used to live in this file (`TimeoutUpgradeReconciler`
 * / `RedisTimeoutUpgradeLease`) migrated pre-#1494 delayed-job rows forward;
 * the negotiation-graph rewrite does not migrate in-flight negotiation rows
 * at all (state this break in the PR), so it has no more rows to reconcile
 * and was deleted along with it.
 */

/** Derive a legacy park origin without ever consulting claim-time updatedAt. */
export function deriveLegacyNegotiationParkOrigin(input: {
  taskId: string;
  state: 'waiting_for_agent' | 'claimed';
  metadata: unknown;
  statusTimestamp: Date | null;
  claimedAt: Date | null;
}): Date {
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown>
    : {};
  const hasStoredOrigin = Object.prototype.hasOwnProperty.call(metadata, 'hermesParkStartedAt');
  const rawOrigin = hasStoredOrigin ? metadata.hermesParkStartedAt : input.statusTimestamp;
  const origin = typeof rawOrigin === 'string' || rawOrigin instanceof Date
    ? new Date(rawOrigin)
    : null;
  if (!origin || !Number.isFinite(origin.getTime())) {
    throw new Error(`Legacy negotiation timeout has no valid park chronology for ${input.taskId}`);
  }
  if (input.state === 'claimed') {
    const claimAt = input.claimedAt;
    if (!claimAt || !Number.isFinite(claimAt.getTime()) || origin.getTime() > claimAt.getTime()) {
      throw new Error(`Legacy claimed negotiation timeout has malformed chronology for ${input.taskId}`);
    }
  }
  return origin;
}
