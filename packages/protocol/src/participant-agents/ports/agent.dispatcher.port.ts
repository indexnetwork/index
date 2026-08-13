/**
 * participant-agents/ports — AgentDispatcher dispatch port.
 *
 * Re-exports the canonical agent dispatcher contract from shared/interfaces.
 *
 * ## Why re-export instead of defining here?
 *
 * The negotiation capability imports AgentDispatcher and NegotiationTurnPayload
 * from shared/interfaces/agent-dispatcher.interface.ts.  If this file defined
 * the types and shared/interfaces became a shim pointing here, a cycle would
 * form through the module graph:
 *
 *   agent.dispatcher.port (participant-agents) → capabilities/negotiation.facade
 *   (the facade represents the negotiation implementation boundary) →
 *   negotiation.graph.ts → shared/interfaces/agent-dispatcher.interface.ts
 *   (shim) → participant-agents/ports/index.ts → agent.dispatcher.port
 *
 * The solution is to leave shared/interfaces/agent-dispatcher.interface.ts as
 * the authoritative file and surface its types through the participant-agents
 * ports boundary via re-export.
 *
 * IND-548: participant-agents/ports re-exports the dispatcher contract
 * established in shared/interfaces/agent-dispatcher.interface.ts.
 */
export type {
  AgentDispatcher,
  AgentDispatchResult,
  NegotiationTurnPayload,
} from '../../shared/interfaces/agent-dispatcher.interface.js';
