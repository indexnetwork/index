/**
 * negotiation/ports — injected dependency contracts for the negotiation capability.
 *
 * Re-exports the narrow port types that the negotiation module declares as
 * explicit injected boundaries. Consumers import these to wire host
 * implementations without depending on the application layer.
 *
 * ## Port groups
 *
 * ### Tool host port
 * - NegotiationToolDeps — host capabilities for the negotiation tool factory:
 *   negotiationDatabase, agentDispatcher (optional), negotiationTimeoutQueue (optional).
 *
 * IND-550: canonical ports surface for the negotiation capability.
 * Legacy paths:
 *   - capabilities/negotiation.tools.port.ts → re-exports NegotiationToolDeps from here
 */

// ── Tool host ─────────────────────────────────────────────────────────────────
export type { NegotiationToolDeps } from "./negotiation.tools.port.js";
