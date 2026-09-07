import { agentDatabaseAdapter, type AgentRegistryStore, type AgentRow } from '../adapters/agent.database.adapter';
import { userDatabaseAdapter } from '../adapters/database.adapter';
import { log } from '../lib/log';

const logger = log.service.from('AgentService');

export type AgentServiceStore = AgentRegistryStore;

/**
 * AgentService
 *
 * Business logic for the agent registry. Agents are records the user owns;
 * the only product-level choice is which one handles negotiations.
 */
export class AgentService {
  constructor(
    private readonly db: AgentServiceStore = agentDatabaseAdapter,
  ) {}

  /**
   * Register an external agent runtime for a user.
   *
   * @param ownerId - Owner of the new agent.
   * @param name - Display name.
   * @param description - Optional description.
   * @returns The created agent.
   * @throws Error when the name is blank.
   */
  async create(ownerId: string, name: string, description?: string): Promise<AgentRow> {
    const cleanName = name.trim();
    if (!cleanName) {
      throw new Error('Agent name is required');
    }

    const agent = await this.db.createAgent({
      ownerId,
      name: cleanName,
      description: description?.trim() || undefined,
      type: 'external',
    });

    logger.info('Created external agent', { agentId: agent.id, ownerId });
    return agent;
  }

  /**
   * Read one of the user's own agents.
   *
   * @param agentId - Agent to read.
   * @param userId - Caller, who must own it.
   * @returns The agent.
   * @throws Error('Agent not found') when missing or owned by someone else.
   */
  async getById(agentId: string, userId: string): Promise<AgentRow> {
    const agent = await this.db.getAgent(agentId);
    if (!agent || agent.ownerId !== userId) {
      throw new Error('Agent not found');
    }

    return agent;
  }

  /**
   * Resolve the agent the user selected to handle negotiations, alongside the
   * user's onboarding state. This is what an agent runtime reads to learn who
   * it is acting as — the credential it authenticated with names no agent.
   *
   * @param userId - Authenticated owner.
   * @returns The selected negotiator and the owner's onboarding completion time.
   * @throws Error('Agent not found') when the user has selected no negotiator.
   */
  async getMe(userId: string): Promise<{ agent: AgentRow; onboardingCompletedAt: string | null }> {
    const [agent, user] = await Promise.all([
      this.db.getSelectedNegotiator(userId),
      userDatabaseAdapter.findById(userId),
    ]);
    if (!agent) {
      throw new Error('Agent not found');
    }

    return { agent, onboardingCompletedAt: user?.onboarding?.completedAt ?? null };
  }

  /**
   * Resolve the user's selected negotiator, or null when they have none.
   *
   * @param userId - Owner whose negotiator is resolved.
   * @returns The selected negotiator, or null.
   */
  async getSelectedNegotiator(userId: string): Promise<AgentRow | null> {
    return this.db.getSelectedNegotiator(userId);
  }

  async listForUser(userId: string): Promise<AgentRow[]> {
    return this.db.listAgentsForUser(userId);
  }

  async update(
    agentId: string,
    userId: string,
    updates: {
      name?: string;
      description?: string | null;
      status?: 'active' | 'inactive';
      notifyOnOpportunity?: boolean;
      dailySummaryEnabled?: boolean;
      handleNegotiations?: boolean;
    },
  ): Promise<AgentRow> {
    const agent = await this.requireMutableOwnedAgent(agentId, userId);

    const cleanUpdates: Parameters<AgentServiceStore['updateAgent']>[1] = {};

    if (updates.name !== undefined) {
      const cleanName = updates.name.trim();
      if (!cleanName) {
        throw new Error('Agent name is required');
      }

      cleanUpdates.name = cleanName;
    }

    if (updates.description !== undefined) {
      cleanUpdates.description = updates.description?.trim() || null;
    }

    if (updates.status !== undefined) {
      cleanUpdates.status = updates.status;
    }

    if (updates.notifyOnOpportunity !== undefined) {
      cleanUpdates.notifyOnOpportunity = updates.notifyOnOpportunity;
    }

    if (updates.dailySummaryEnabled !== undefined) {
      cleanUpdates.dailySummaryEnabled = updates.dailySummaryEnabled;
    }

    const hasColumnUpdates = Object.keys(cleanUpdates).length > 0;
    const syncingNegotiations = updates.handleNegotiations !== undefined;

    if (!hasColumnUpdates && !syncingNegotiations) {
      return agent;
    }

    if (hasColumnUpdates) {
      const updated = await this.db.updateAgent(agentId, cleanUpdates);
      if (!updated) {
        throw new Error('Agent not found');
      }
    }

    if (syncingNegotiations) {
      await this.db.setNegotiationExecutorBinding({
        ownerId: userId,
        targetAgentId: updates.handleNegotiations ? agentId : null,
        ...(!updates.handleNegotiations && { disableTargetAgentId: agentId }),
      });
    }

    const refreshed = await this.db.getAgent(agentId);
    if (!refreshed) {
      throw new Error('Agent not found');
    }

    return refreshed;
  }

  async delete(agentId: string, userId: string): Promise<void> {
    await this.requireMutableOwnedAgent(agentId, userId);
    await this.db.deleteAgent(agentId);
    logger.info('Deleted agent', { agentId, userId });
  }

  /**
   * Bump the agent's lastSeenAt timestamp. Called by pickup endpoints.
   *
   * @param agentId - The agent whose heartbeat to update.
   */
  async touchLastSeen(agentId: string): Promise<void> {
    return this.db.touchLastSeen(agentId);
  }

  private async requireMutableOwnedAgent(agentId: string, userId: string): Promise<AgentRow> {
    const agent = await this.getById(agentId, userId);
    if (agent.type === 'system') {
      throw new Error('System agents cannot be modified');
    }

    return agent;
  }
}

export const agentService = new AgentService();
