/**
 * Memory kinds a reflection pass may distill (P5.1 `negotiator_memories.kind`).
 * Plain text at the DB level (55P04 lesson) — adding kinds is code-only.
 *
 * IND-550: moved here from negotiation.reflect.ts so the domain layer owns the
 * vocabulary and the application-layer reflector can import it without a cycle.
 */
export const NEGOTIATOR_MEMORY_KINDS = [
  "playbook",
  "disclosure_rule",
  "counterparty_dossier",
  "threshold",
] as const;

export type DistilledMemoryKind = (typeof NEGOTIATOR_MEMORY_KINDS)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// NEGOTIATOR MEMORY INJECTION (P5.3 — read path)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Pure prompt-side counterpart of the P5.2 write path: retrieved
// `negotiator_memories` rows shape how the negotiator screens, argues, and
// chats. Retrieval itself lives in services/api (the protocol package has no
// DB access) and is injected via `NegotiatorMemoryRetrieveFn`.
//
// Contract: when the entry list is empty (memory empty, flag off, retrieval
// failed) every renderer returns the empty string, so prompts are
// byte-identical to the pre-P5.3 build.

/**
 * A single memory entry as injected into prompts. A projection of the
 * `negotiator_memories` row: content + kind + confidence only — ids,
 * embeddings, and provenance never enter the prompt.
 */
export interface NegotiatorMemoryEntry {
  kind: DistilledMemoryKind;
  content: string;
  /** Anti-poisoning weight (0..1); rendered so the model can weigh hints. */
  confidence?: number;
}

/** Where a retrieval is happening — lets the read service tune top-k/scope. */
export type NegotiatorMemoryScope = "turn";

/** Query the graph hands to the injected retrieval function. */
export interface NegotiatorMemoryQuery {
  /** The user whose negotiator's own memory is being retrieved. */
  userId: string;
  /** The other side of this negotiation (dossier subject). */
  counterpartyUserId: string;
  /** Free-text similarity query (seed reasoning + counterparty context). */
  queryText: string;
  scope: NegotiatorMemoryScope;
}

/**
 * Injected retrieval seam (services/api implements it over the
 * `negotiator_memories` store). MUST resolve to `[]` on any failure — memory
 * must never break a negotiation.
 */
export type NegotiatorMemoryRetrieveFn = (
  query: NegotiatorMemoryQuery,
) => Promise<NegotiatorMemoryEntry[]>;
