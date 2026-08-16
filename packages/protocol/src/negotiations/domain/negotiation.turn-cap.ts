/** Legacy persisted negotiations without an explicit cap finalize at six turns. */
export const DEFAULT_NEGOTIATION_MAX_TURNS = 6;

/**
 * Canonical negotiation turn-cap predicate.
 *
 * Missing/null legacy metadata uses the six-turn default. Zero is the explicit
 * uncapped sentinel. Only a positive limit can be reached or exceeded.
 */
export function isNegotiationTurnCapReached(
  turnCount: number,
  maxTurns: number | null | undefined,
): boolean {
  const effectiveMaxTurns = maxTurns ?? DEFAULT_NEGOTIATION_MAX_TURNS;
  return effectiveMaxTurns > 0 && turnCount >= effectiveMaxTurns;
}
