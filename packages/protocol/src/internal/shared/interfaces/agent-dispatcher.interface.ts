/**
 * AgentDispatcher interface for the negotiation graph (rewrite, #1494).
 *
 * The graph calls dispatch() per turn and receives a result. It never knows
 * about webhooks, MCP, transports, or agent resolution. The concrete
 * implementation lives in the host application.
 */

import type { NegotiationTurn } from '../../negotiations/negotiation.turn.js';

/** Payload sent to the dispatcher for one negotiation turn. */
export interface NegotiationTurnPayload {
  negotiationId: string;
  /** IS-A's per-negotiation context — the only thing carried in from the DM. */
  brief: string;
  /** This negotiation's turns so far, oldest first, from this seat's perspective. */
  thread: Array<{ speaker: 'own' | 'counterparty'; turn: NegotiationTurn }>;
  /** True on the negotiation's very first turn — the reply must be `outreach`. */
  isOpening: boolean;
}

/** Result of a dispatch attempt. */
export type AgentDispatchResult =
  | { handled: true; turn: NegotiationTurn }
  | { handled: false; reason: 'no_agent' | 'timeout' }
  | { handled: false; reason: 'waiting'; resumeToken: string };

/**
 * Dispatches a negotiation turn to the appropriate agent.
 * Tries external (poller) agents first, falls back to the internal author.
 */
export interface AgentDispatcher {
  /**
   * Attempt to dispatch a negotiation turn to an external (poller) agent.
   * @param userId - The user whose agent should handle this turn
   * @param scope - Permission scope for agent resolution
   * @param payload - Turn context (brief, thread)
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
   * scope. Type-only by design (no heartbeat freshness) — see IND-410.
   */
  hasExternalAgent(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
  ): Promise<boolean>;
}
