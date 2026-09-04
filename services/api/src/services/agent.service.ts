import { agentDatabaseAdapter, type AgentPermissionRow, type AgentRegistryStore, type AgentScope, type AgentRow, type AgentWithRelations, type PermissionScope } from '../adapters/agent.database.adapter';
import { agentTokenAdapter, type AgentTokenStore } from '../adapters/agent-token.adapter';
import { userDatabaseAdapter } from '../adapters/database.adapter';
import { log } from '../lib/log';

const logger = log.service.from('AgentService');

/** All valid agent actions. Used for input validation. */
export const AGENT_ACTIONS = [
  'manage:identity',
  'manage:intents',
  'manage:networks',
  'manage:opportunities',
  'manage:negotiations',
] as const;

export type AgentAction = (typeof AGENT_ACTIONS)[number];

/** Default actions granted to the owner of a newly created personal agent. */
export const PERSONAL_AGENT_DEFAULT_ACTIONS: readonly AgentAction[] = [
  'manage:identity',
  'manage:intents',
  'manage:networks',
  'manage:opportunities',
];

export type AgentServiceStore = AgentRegistryStore;

/**
 * AgentService
 *
 * Business logic for the agent registry. Owns validation and authorization
 * rules around agent CRUD and permissions.
 */
export class AgentService {
  constructor(
    private readonly db: AgentServiceStore = agentDatabaseAdapter,
    private readonly tokens: AgentTokenStore = agentTokenAdapter,
  ) {}

  async create(ownerId: string, name: string, description?: string): Promise<AgentWithRelations> {
    const cleanName = name.trim();
    if (!cleanName) {
      throw new Error('Agent name is required');
    }

    // User-registered agents are external poller runtimes authenticated via
    // API key.
    const agent = await this.db.createAgent({
      ownerId,
      name: cleanName,
      description: description?.trim() || undefined,
      type: 'external',
    });

    const permission = await this.db.grantPermission({
      agentId: agent.id,
      userId: ownerId,
      scope: 'global',
      actions: [...PERSONAL_AGENT_DEFAULT_ACTIONS],
    });

    logger.info('Created external agent with default permissions', { agentId: agent.id, ownerId });
    return this.sanitizeAgent({
      ...agent,
      permissions: [permission],
    });
  }

  async getById(agentId: string, userId: string): Promise<AgentWithRelations> {
    const agent = await this.db.getAgentWithRelations(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    const isOwner = agent.ownerId === userId;
    const isAuthorizedUser = agent.permissions.some((permission) => permission.userId === userId);
    if (!isOwner && !isAuthorizedUser) {
      throw new Error('Agent not found');
    }

    return this.sanitizeAgent(agent, userId);
  }

  async getMe(agentId: string, userId: string): Promise<{ agent: AgentWithRelations; onboardingCompletedAt: string | null }> {
    const [agent, user] = await Promise.all([
      this.getById(agentId, userId),
      userDatabaseAdapter.findById(userId),
    ]);
    const onboardingCompletedAt = user?.onboarding?.completedAt ?? null;
    return { agent, onboardingCompletedAt };
  }

  async listForUser(userId: string): Promise<AgentWithRelations[]> {
    return (await this.db.listAgentsForUser(userId)).map((agent) => this.sanitizeAgent(agent, userId));
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
  ): Promise<AgentWithRelations> {
    const agent = await this.requireOwnedAgentWithRelations(agentId, userId);
    if (agent.type === 'system') {
      throw new Error('System agents cannot be modified');
    }

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
      return this.sanitizeAgent(agent);
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

    const refreshed = await this.db.getAgentWithRelations(agentId);
    if (!refreshed) {
      throw new Error('Agent not found');
    }

    return this.sanitizeAgent(refreshed);
  }

  async delete(agentId: string, userId: string): Promise<void> {
    await this.requireMutableOwnedAgent(agentId, userId);

    try {
      const tokens = await this.tokens.list(userId);
      const linkedTokenIds = tokens
        .filter((token) => token.metadata?.agentId === agentId)
        .map((token) => token.id);

      for (const tokenId of linkedTokenIds) {
        await this.tokens.revoke(userId, tokenId);
      }
    } catch (err) {
      logger.warn('Token revocation failed; adapter cleanup will handle remaining tokens', {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await this.db.deleteAgent(agentId);
    logger.info('Deleted agent', { agentId, userId });
  }

  async grantPermission(
    agentId: string,
    userId: string,
    actions: string[],
    scope: PermissionScope = 'global',
    scopeId?: string,
  ): Promise<AgentPermissionRow> {
    const cleanActions = [...new Set(actions.map((action) => action.trim()).filter(Boolean))];
    if (cleanActions.length === 0) {
      throw new Error('At least one action is required');
    }

    for (const action of cleanActions) {
      if (!AGENT_ACTIONS.includes(action as AgentAction)) {
        throw new Error(`Invalid action: ${action}`);
      }
    }

    if (scope !== 'global' && !scopeId?.trim()) {
      throw new Error(`scopeId is required for ${scope} permissions`);
    }

    const agent = await this.db.getAgent(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    if (agent.ownerId !== userId) {
      throw new Error('Not authorized');
    }

    return this.db.grantPermission({
      agentId,
      userId,
      scope,
      scopeId: scope === 'global' ? null : scopeId?.trim(),
      actions: cleanActions,
    });
  }

  async revokePermission(agentId: string, permissionId: string, userId: string): Promise<void> {
    const agent = await this.db.getAgentWithRelations(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    const permission = agent.permissions.find((item) => item.id === permissionId);
    if (!permission) {
      throw new Error('Permission not found');
    }

    if (permission.userId !== userId && agent.ownerId !== userId) {
      throw new Error('Not authorized');
    }

    await this.db.revokePermission(permissionId);
  }

  async listTokens(agentId: string, userId: string) {
    await this.requireOwnedAgent(agentId, userId);

    const tokens = await this.tokens.list(userId);
    return tokens.filter((token) => token.metadata?.agentId === agentId);
  }

  async createToken(
    agentId: string,
    userId: string,
    name?: string,
  ) {
    const agent = await this.requireMutableOwnedAgent(agentId, userId);
    const tokenName = name?.trim() || `${agent.name} API Key`;

    return this.tokens.create(userId, {
      name: tokenName,
      agentId: agent.id,
    });
  }

  async revokeToken(agentId: string, tokenId: string, userId: string): Promise<void> {
    await this.requireMutableOwnedAgent(agentId, userId);

    const tokens = await this.tokens.list(userId);
    const token = tokens.find((item) => item.id === tokenId);
    if (!token) {
      throw new Error('Token not found');
    }

    if (token.metadata?.agentId !== agentId) {
      throw new Error('Token not found');
    }

    await this.tokens.revoke(userId, tokenId);
  }

  async grantDefaultSystemPermissions(userId: string): Promise<void> {
    const { negotiator } = this.db.getSystemAgentIds();
    const negotiatorAgent = await this.db.getAgent(negotiator);

    if (negotiatorAgent) {
      const missingNegotiatorActions = await this.findMissingGlobalActions(
        negotiator,
        userId,
        ['manage:opportunities', 'manage:negotiations'],
      );
      if (missingNegotiatorActions.length > 0) {
        await this.db.grantPermission({
          agentId: negotiator,
          userId,
          scope: 'global',
          actions: missingNegotiatorActions,
        });
      }
    } else {
      logger.warn('Skipping default negotiator permissions; system agent missing', { userId });
    }
  }

  /**
   * Bump the agent's lastSeenAt timestamp. Called by pickup endpoints.
   *
   * @param agentId - The agent whose heartbeat to update.
   */
  async touchLastSeen(agentId: string): Promise<void> {
    return this.db.touchLastSeen(agentId);
  }

  async hasPermission(
    agentId: string,
    userId: string,
    action: string,
    scope?: AgentScope,
  ): Promise<boolean> {
    return this.db.hasPermission(agentId, userId, action, scope);
  }

  private async requireOwnedAgent(agentId: string, userId: string): Promise<AgentRow> {
    const agent = await this.db.getAgent(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    if (agent.ownerId !== userId) {
      throw new Error('Not authorized');
    }

    return agent;
  }

  private async requireMutableOwnedAgent(agentId: string, userId: string): Promise<AgentRow> {
    const agent = await this.requireOwnedAgent(agentId, userId);
    if (agent.type === 'system') {
      throw new Error('System agents cannot be modified');
    }

    return agent;
  }

  private async requireOwnedAgentWithRelations(agentId: string, userId: string) {
    const agent = await this.db.getAgentWithRelations(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    if (agent.ownerId !== userId) {
      throw new Error('Not authorized');
    }

    return agent;
  }

  private sanitizeAgent(agent: AgentWithRelations, viewerId?: string): AgentWithRelations {
    const isOwner = viewerId === undefined || agent.ownerId === viewerId;
    // Owners of non-system agents see every permission; everyone else (and any
    // viewer of a system agent) sees only their own permission rows.
    const keepAllPermissions = agent.type !== 'system' && isOwner;

    return {
      ...agent,
      permissions: keepAllPermissions
        ? agent.permissions
        : agent.permissions.filter((permission) => permission.userId === viewerId),
    };
  }

  private async findMissingGlobalActions(
    agentId: string,
    userId: string,
    actions: readonly string[],
  ): Promise<string[]> {
    const results = await Promise.all(
      actions.map(async (action) => ({
        action,
        hasPermission: await this.db.hasPermission(agentId, userId, action, { type: 'global' }),
      })),
    );

    return results.filter((result) => !result.hasPermission).map((result) => result.action);
  }

}

export const agentService = new AgentService();
