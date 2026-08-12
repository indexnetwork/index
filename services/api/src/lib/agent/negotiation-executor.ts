/** Server-enforced freshness window for an external negotiation executor. */
export const NEGOTIATION_EXECUTOR_FRESHNESS_MS = 90_000;

/** True when a negotiation-specific pickup heartbeat is inside the live window. */
export function isNegotiationExecutorFresh(
  lastNegotiationPickupAt: Date | null,
  nowMs = Date.now(),
): boolean {
  return lastNegotiationPickupAt !== null
    && lastNegotiationPickupAt.getTime() > nowMs - NEGOTIATION_EXECUTOR_FRESHNESS_MS;
}
