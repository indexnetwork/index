/**
 * Thin backward-compat shim — IND-550.
 * Canonical location: negotiation/domain/negotiation.memory.ts
 * DistilledMemoryKind / NEGOTIATOR_MEMORY_KINDS are also exported from here
 * (previously in negotiation.reflect.ts) so existing imports remain valid.
 */
export * from "./domain/negotiation.memory.js";
