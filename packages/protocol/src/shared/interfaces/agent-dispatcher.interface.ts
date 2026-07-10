/**
 * AgentDispatcher interface for the negotiation graph.
 *
 * The graph calls dispatch() per turn and receives a result.
 * It never knows about webhooks, MCP, transports, or agent resolution.
 * The concrete implementation lives in the host application.
 */

import type { NegotiationTurn, UserNegotiationContext, SeedAssessment } from '../schemas/negotiation-state.schema.js';

/** Payload sent to the dispatcher for each negotiation turn. */
export interface NegotiationTurnPayload {
  negotiationId: string;
  ownUser: UserNegotiationContext;
  otherUser: UserNegotiationContext;
  indexContext: { networkId: string; prompt?: string };
  seedAssessment: SeedAssessment;
  history: NegotiationTurn[];
  isFinalTurn: boolean;
  /** Whether ownUser is the party that initiated the discovery. */
  isDiscoverer: boolean;
  /** The explicit search query that triggered this discovery (if any). Takes priority over background intents. */
  discoveryQuery?: string;
  /** The acting user's seat under the v2 client-advocate protocol (`initiator` | `counterparty`). */
  seat?: string;
  /** Negotiation protocol version for this task (`v1` | `v2`). */
  protocolVersion?: string;
  /** Actions the acting seat may submit on this turn (seat + version + final-turn scoped). */
  allowedActions?: string[];
}

/** Result of a dispatch attempt. */
export type AgentDispatchResult =
  | { handled: true; turn: NegotiationTurn }
  | { handled: false; reason: 'no_agent' | 'timeout' }
  | { handled: false; reason: 'waiting'; resumeToken: string };

/**
 * Dispatches a negotiation turn to the appropriate agent.
 * Tries external (poller) agents first, falls back to system agent.
 */
export interface AgentDispatcher {
  /**
   * Attempt to dispatch a negotiation turn to an external (poller) agent.
   * @param userId - The user whose agent should handle this turn
   * @param scope - Permission scope for agent resolution
   * @param payload - Turn context (users, history, seed assessment)
   * @param options - Timeout configuration
   * @returns Handled result with turn, or unhandled result with reason
   */
  dispatch(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
    payload: NegotiationTurnPayload,
    options: { timeoutMs: number },
  ): Promise<AgentDispatchResult>;

  /**
   * Check whether a user has an authorized external (poller) agent for the given
   * scope. Used at init to determine scenario-based turn caps. Type-only by design
   * (no heartbeat freshness) — see IND-410.
   */
  hasExternalAgent(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
  ): Promise<boolean>;
}
