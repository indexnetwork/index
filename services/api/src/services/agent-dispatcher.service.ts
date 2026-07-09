import type { AgentDispatcher, AgentDispatchResult, NegotiationTurnPayload } from '@indexnetwork/protocol';
import type { NegotiationTimeoutQueue } from '@indexnetwork/protocol';

import type { AgentWithRelations } from '../adapters/agent.database.adapter';

import { log } from '../lib/log';

const logger = log.service.from('AgentDispatcher');

/** How recently a personal agent must have polled to be considered live. */
const FRESHNESS_THRESHOLD_MS = 90_000;

/** Subset of AgentService needed by the dispatcher. */
interface AgentLookup {
  findAuthorizedAgents(
    userId: string,
    action: string,
    scope: { type: 'global' | 'node' | 'network'; id?: string },
  ): Promise<AgentWithRelations[]>;
}

/**
 * Concrete AgentDispatcher that bridges the agent registry to the negotiation graph.
 * Checks for personal agents and parks the turn for polling pickup.
 */
export class AgentDispatcherImpl implements AgentDispatcher {
  constructor(
    private agentService: AgentLookup,
    private timeoutQueue: NegotiationTimeoutQueue | undefined,
  ) {}

  /**
   * Attempt to dispatch a negotiation turn to a personal agent.
   *
   * Heartbeat-aware: checks `lastSeenAt` on each personal agent. If none is fresh
   * (within 90 seconds), returns `timeout` so the graph falls back to the system
   * agent inline. Otherwise parks the turn in `waiting_for_agent` and arms the
   * response-window timer with the caller-supplied `timeoutMs`.
   *
   * `timeoutMs` is the park-window budget (5 min ambient / 60 s orchestrator),
   * not a long-vs-short gate as in the previous implementation.
   *
   * @param userId - The user whose agent should handle this turn
   * @param scope - Permission scope for agent resolution
   * @param payload - Turn context (users, history, seed assessment)
   * @param options - Timeout configuration
   * @returns Handled result with turn, or unhandled result with reason
   */
  async dispatch(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
    payload: NegotiationTurnPayload,
    options: { timeoutMs: number },
  ): Promise<AgentDispatchResult> {
    const authorizedAgents = await this.findAuthorizedAgentsForScope(userId, scope);

    const personalAgents = authorizedAgents.filter((a) => a.type === 'personal');

    if (personalAgents.length === 0) {
      return { handled: false, reason: 'no_agent' };
    }

    const cutoff = Date.now() - FRESHNESS_THRESHOLD_MS;
    const freshAgents = personalAgents.filter(
      (a) => a.lastSeenAt != null && a.lastSeenAt.getTime() > cutoff,
    );

    if (freshAgents.length === 0) {
      logger.info('Personal agent registered but stale — falling back to system agent', {
        userId,
        agentCount: personalAgents.length,
        freshnessThresholdMs: FRESHNESS_THRESHOLD_MS,
      });
      return { handled: false, reason: 'timeout' };
    }

    if (this.timeoutQueue) {
      try {
        await this.timeoutQueue.enqueueTimeout(
          payload.negotiationId,
          payload.history.length,
          options.timeoutMs,
        );
      } catch (err) {
        // Without a safety timer, a parked turn could strand forever. Fall back to
        // the system agent inline instead of returning `waiting` with no timer.
        logger.error('Failed to enqueue negotiation timeout; falling back to system agent', {
          userId,
          negotiationId: payload.negotiationId,
          error: err,
        });
        return { handled: false, reason: 'timeout' };
      }
    }

    logger.info('Turn parked for polling pickup', {
      userId,
      negotiationId: payload.negotiationId,
      freshAgentCount: freshAgents.length,
      parkWindowMs: options.timeoutMs,
    });

    return { handled: false, reason: 'waiting', resumeToken: payload.negotiationId };
  }

  /**
   * Check whether a user has an authorized personal agent for the given scope.
   *
   * @param userId - The user to check
   * @param scope - Permission scope for agent resolution
   * @returns `true` if at least one personal agent is authorized
   */
  async hasPersonalAgent(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
  ): Promise<boolean> {
    const agents = await this.findAuthorizedAgentsForScope(userId, scope);
    return agents.some((a) => a.type === 'personal');
  }

  /**
   * Resolve authorized agents for a scope, mapping the 'negotiation' scope type
   * to 'network' (negotiation permissions are scoped to networks) so the adapter
   * queries the correct permission scope.
   */
  private findAuthorizedAgentsForScope(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
  ): Promise<AgentWithRelations[]> {
    const resolvedScopeType = scope.scopeType === 'negotiation' ? 'network' : scope.scopeType;
    return this.agentService.findAuthorizedAgents(userId, scope.action, {
      type: resolvedScopeType as 'global' | 'node' | 'network',
      id: scope.scopeId,
    });
  }
}
