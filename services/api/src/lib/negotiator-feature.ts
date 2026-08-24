/**
 * The `negotiator_memories` write path (P5.2 / IND-406) ships on.
 *
 * This predicate survives its flag only as call-site vocabulary; it is
 * unconditionally true and can be inlined once nothing reads it.
 */

/** @returns true — negotiator memory writes are always on. */
export function isNegotiatorMemoryWriteEnabled(): boolean {
  return true;
}
