// ═══════════════════════════════════════════════════════════════════════════════
// NEGOTIATOR CLIENT DM INJECTION (A2H read path)
// ═══════════════════════════════════════════════════════════════════════════════
//
// The negotiator's other conversation. `negotiator_memories` holds what a
// reflection pass distilled OUT of past negotiations; this seam reads the live
// agent-to-human thread the client and their negotiator are having about ONE
// signal — the negotiator-persona DM pinned to that intent.
//
// Why the DM and not memory: memory has no intent column. It is keyed
// (agentId, userId) with an optional subject and retrieved by vector
// similarity, so grounding on it crosses signals silently — a threshold the
// client set for one signal could shape a question about another. The DM is
// intent-scoped at the database: `chat_session_scopes` keyed
// ('negotiator-intent', intentId), unique on (userId, scopeType, scopeId).
// Exactly one DM per signal, or none.
//
// Retrieval itself lives in services/api (the protocol package has no DB
// access) and is injected as `NegotiatorClientDmRetrieveFn` — the same
// composition-root pattern as `memoryRetrieve`/`questionerEnqueue`.
//
// Contract: an empty list is the normal case, not a failure. Most signals have
// no negotiator DM. Flag off, no DM, retrieval error → `[]`, and every
// consumer must render nothing rather than degrade.
//
// SYSTEM AGENT ONLY. Unlike `negotiatorMemory`, this MUST NOT be added to
// `NegotiationTurnPayload`. Distilled standing rules are safe to hand an
// external registered agent holding the personal-agent seat; a verbatim
// excerpt of the client's private conversation with their own negotiator is
// not. Ground the in-process system agent; withhold from external seats.

/** One message from the client's negotiator DM, as injected into prompts. */
export interface NegotiatorClientDmMessage {
  /** Who spoke: the client themself, or their negotiator. */
  role: "client" | "agent";
  /** Message text only — ids, timestamps, and tool parts never enter a prompt. */
  content: string;
}

/**
 * Query the graph hands to the injected retrieval function.
 *
 * Keyed on (userId, intentId) — NOT on the counterparty. The counterparty's DM
 * is unreachable by construction rather than by a check that could be
 * forgotten: there is no field here through which to ask for it.
 */
export interface NegotiatorClientDmQuery {
  /** The user whose OWN negotiator DM is being read. */
  userId: string;
  /** The signal this negotiation is about; the DM is pinned to it. */
  intentId: string;
}

/**
 * Injected read seam (services/api implements it over `chat_session_scopes` +
 * `messages`). MUST resolve to `[]` on any failure, when the flag is off, and
 * when the user has no negotiator DM for this signal — a missing or unreadable
 * DM must never break a negotiation.
 *
 * Returns a bounded recent excerpt, MOST RECENT LAST, so a consumer can append
 * it to a prompt in reading order without re-sorting.
 */
export type NegotiatorClientDmRetrieveFn = (
  query: NegotiatorClientDmQuery,
) => Promise<NegotiatorClientDmMessage[]>;
