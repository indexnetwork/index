import type { AgentDispatcher } from '@indexnetwork/protocol';

import type { AgentWithRelations } from '../adapters/agent.database.adapter';

/** Subset of AgentService needed by the dispatcher. */
interface AgentLookup {
  findAuthorizedAgents(
    userId: string,
    action: string,
    scope: { type: 'global' | 'node' | 'network'; id?: string },
  ): Promise<AgentWithRelations[]>;
}

/**
 * Concrete AgentDispatcher — bridges the agent registry to `hasExternalAgent`
 * checks. Negotiation turn dispatch (`dispatch()`) is deleted (#1494 round-3,
 * Option A: external agents are offline in this PR, see the PR body); what
 * remains is the opportunity graph's own, unrelated use of `hasExternalAgent`
 * for the unlimited-maxTurns rule (IND-410).
 */
export class AgentDispatcherImpl implements AgentDispatcher {
  constructor(private agentService: AgentLookup) {}

  /**
   * Check whether a user has an authorized external (poller) agent for the given scope.
   * Type-only by design: no heartbeat freshness (IND-410).
   *
   * @param userId - The user to check
   * @param scope - Permission scope for agent resolution
   * @returns `true` if at least one external agent is authorized
   */
  async hasExternalAgent(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
  ): Promise<boolean> {
    const agents = await this.findAuthorizedAgentsForScope(userId, scope);
    return agents.some((agent) => agent.type === 'external' && agent.handleNegotiations);
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
