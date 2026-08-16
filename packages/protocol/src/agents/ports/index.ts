/**
 * agents/ports — injected dependency contracts.
 *
 * Re-exports the narrow port types that the participant-agents module
 * declares as explicit injected boundaries.  Consumers import these to
 * wire host implementations without depending on the application layer.
 *
 * ## Port groups
 *
 * ### Persistence port
 * - AgentDatabase — agent CRUD, transport management, permission grants.
 *
 * ### Dispatch port
 * - AgentDispatcher — negotiation turn dispatch (external poller + fallback).
 * - AgentDispatchResult — dispatch outcome discriminated union.
 * - NegotiationTurnPayload — full context sent to the dispatched agent.
 *
 * ### Tool host port
 * - AgentToolDeps — host capabilities for registration/permission tools.
 *
 * IND-548: canonical ports surface for the participant-agents capability.
 * Compatibility path:
 *   - shared/interfaces/agent-dispatcher.interface.ts → re-exports from here
 */

// ── Persistence ───────────────────────────────────────────────────────────────
export type { AgentDatabase } from "./agent.repository.port.js";

// ── Dispatch ──────────────────────────────────────────────────────────────────
export type {
  AgentDispatcher,
  AgentDispatchResult,
  NegotiationTurnPayload,
} from "./agent.dispatcher.port.js";

// ── Tool host ─────────────────────────────────────────────────────────────────
export type { AgentToolDeps } from "./agent.tools.port.js";
