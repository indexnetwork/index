/**
 * The negotiator persona chat surface (P4.1 / IND-402) and the
 * `negotiator_memories` write path (P5.2 / IND-406) both ship on.
 *
 * These predicates survive their flags only as call-site vocabulary; they are
 * unconditionally true and can be inlined once nothing reads them.
 */

/** @returns true — the negotiator chat surface is always available. */
export function isNegotiatorChatEnabled(): boolean {
  return true;
}

/** @returns true — negotiator memory writes are always on. */
export function isNegotiatorMemoryWriteEnabled(): boolean {
  return true;
}
