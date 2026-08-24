/**
 * Who plays a seat's turn.
 *
 * The negotiation graph owns the thread, the rules and the persistence; it
 * does not own judgment. `turn` asks this port for the current seat's move
 * and hands whatever comes back to `apply`, which validates it against the
 * seat and the opening rule exactly as it validates an externally submitted
 * one. Production binds it to the PersonalAgent in negotiation scope —
 * `agentGraph.invoke({ userId, intentId, negotiationId })` — so the seat is
 * the principal's own agent rather than a negotiator persona of its own.
 *
 * The port takes ids only. The author reads the brief and the thread itself,
 * which costs one extra pair of reads per turn and buys the property that
 * matters: the AgentGraph's negotiation-scope input is exactly the documented
 * `{ userId, intentId, negotiationId }` and nothing about the negotiation
 * travels through the caller.
 */
import type { NegotiationAuthoredTurn } from "./negotiation.turn.js";

export interface NegotiationTurnAuthorInput {
  negotiationId: string;
  /** The seat speaking — the graph's computed next speaker. */
  userId: string;
  /** The speaking seat's own persisted opportunity-actor signal. */
  intentId: string;
}

export interface NegotiationTurnAuthor {
  authorTurn(input: NegotiationTurnAuthorInput): Promise<NegotiationAuthoredTurn>;
}
