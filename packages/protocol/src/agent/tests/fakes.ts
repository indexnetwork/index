/**
 * Minimal in-memory fake of the {@link AgentDatabase} interface used by agent
 * tool tests. Only the surface area exercised by the specs in this folder is
 * implemented — unused methods throw if called so tests fail loudly.
 */

import type { AgentDatabase, AgentPermissionRecord, AgentRecord, AgentTransportRecord, AgentWithRelations, CreateAgentInput, CreateTransportInput, GrantPermissionInput } from '../../shared/interfaces/agent.interface.js';

export interface SeedAgentInput {
  id: string;
  ownerId: string;
  name: string;
  type?: 'personal' | 'system';
  description?: string | null;
  status?: 'active' | 'inactive';
}

export interface FakeAgentDb extends AgentDatabase {
  seedAgent(input: SeedAgentInput): Promise<AgentRecord>;
  getPermissionsForAgent(agentId: string): AgentPermissionRecord[];
  getTransportsForAgent(agentId: string): AgentTransportRecord[];
}

function nextId(prefix: string, counter: { value: number }): string {
  counter.value += 1;
  return `${prefix}-${counter.value}`;
}

/**
 * Creates an in-memory agent database fake for unit tests. Only the methods
 * exercised by the agent tool specs are implemented; the rest throw.
 */
export function createFakeAgentDb(): FakeAgentDb {
  const agents = new Map<string, AgentRecord>();
  const transports = new Map<string, AgentTransportRecord>();
  const permissions = new Map<string, AgentPermissionRecord>();
  const agentCounter = { value: 0 };
  const transportCounter = { value: 0 };
  const permissionCounter = { value: 0 };

  function buildRelations(agent: AgentRecord): AgentWithRelations {
    const agentTransports = [...transports.values()].filter((t) => t.agentId === agent.id);
    const agentPermissions = [...permissions.values()].filter((p) => p.agentId === agent.id);
    return {
      ...agent,
      transports: agentTransports,
      permissions: agentPermissions,
    };
  }

  const db: FakeAgentDb = {
    getPermissionsForAgent(agentId: string) {
      return [...permissions.values()]
        .filter((permission) => permission.agentId === agentId)
        .map((permission) => ({ ...permission, actions: [...permission.actions] }));
    },

    getTransportsForAgent(agentId: string) {
      return [...transports.values()]
        .filter((transport) => transport.agentId === agentId)
        .map((transport) => ({ ...transport }));
    },

    async seedAgent(input: SeedAgentInput) {
      const now = new Date();
      const agent: AgentRecord = {
        id: input.id,
        ownerId: input.ownerId,
        name: input.name,
        description: input.description ?? null,
        type: input.type ?? 'personal',
        status: input.status ?? 'active',
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };
      agents.set(agent.id, agent);
      return agent;
    },

    async createAgent(input: CreateAgentInput) {
      const now = new Date();
      const agent: AgentRecord = {
        id: nextId('agent', agentCounter),
        ownerId: input.ownerId,
        name: input.name,
        description: input.description ?? null,
        type: input.type ?? 'personal',
        status: 'active',
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      };
      agents.set(agent.id, agent);
      return agent;
    },

    async getAgent(agentId: string) {
      return agents.get(agentId) ?? null;
    },

    async getAgentWithRelations(agentId: string) {
      const agent = agents.get(agentId);
      if (!agent) return null;
      return buildRelations(agent);
    },

    async updateAgent(agentId, updates) {
      const existing = agents.get(agentId);
      if (!existing) return null;
      const updated: AgentRecord = {
        ...existing,
        ...('name' in updates && updates.name !== undefined ? { name: updates.name } : {}),
        ...('description' in updates && updates.description !== undefined ? { description: updates.description } : {}),
        ...('status' in updates && updates.status !== undefined ? { status: updates.status } : {}),
        ...('metadata' in updates && updates.metadata !== undefined ? { metadata: updates.metadata } : {}),
        updatedAt: new Date(),
      };
      agents.set(agentId, updated);
      return updated;
    },

    async deleteAgent(agentId: string) {
      agents.delete(agentId);
      for (const [id, transport] of transports) {
        if (transport.agentId === agentId) transports.delete(id);
      }
      for (const [id, permission] of permissions) {
        if (permission.agentId === agentId) permissions.delete(id);
      }
    },

    async listAgentsForUser(userId: string) {
      return [...agents.values()]
        .filter((agent) => agent.ownerId === userId)
        .map((agent) => buildRelations(agent));
    },

    async createTransport(input: CreateTransportInput) {
      const transport: AgentTransportRecord = {
        id: nextId('transport', transportCounter),
        agentId: input.agentId,
        channel: input.channel,
        config: input.config ?? {},
        priority: input.priority ?? 0,
        active: true,
        failureCount: 0,
      };
      transports.set(transport.id, transport);
      return transport;
    },

    async deleteTransport(transportId: string) {
      transports.delete(transportId);
    },

    async recordTransportFailure(transportId: string) {
      const transport = transports.get(transportId);
      if (transport) {
        transport.failureCount += 1;
      }
    },

    async recordTransportSuccess(transportId: string) {
      const transport = transports.get(transportId);
      if (transport) {
        transport.failureCount = 0;
      }
    },

    async grantPermission(input: GrantPermissionInput) {
      const permission: AgentPermissionRecord = {
        id: nextId('permission', permissionCounter),
        agentId: input.agentId,
        userId: input.userId,
        scope: input.scope ?? 'global',
        scopeId: input.scopeId ?? null,
        actions: [...input.actions],
        createdAt: new Date(),
      };
      permissions.set(permission.id, permission);
      return permission;
    },

    async revokePermission(permissionId: string) {
      permissions.delete(permissionId);
    },

    async hasPermission(agentId, userId, action, scope) {
      const requestedScope = scope?.type ?? 'global';
      const requestedScopeId = scope?.id ?? null;
      return [...permissions.values()].some(
        (permission) =>
          permission.agentId === agentId &&
          permission.userId === userId &&
          permission.scope === requestedScope &&
          (requestedScope === 'global' || permission.scopeId === requestedScopeId) &&
          permission.actions.includes(action),
      );
    },

    async findAuthorizedAgents() {
      throw new Error('findAuthorizedAgents is not implemented in the fake agent DB.');
    },

    getSystemAgentIds() {
      return {
        chatOrchestrator: '00000000-0000-0000-0000-000000000001',
        negotiator: '00000000-0000-0000-0000-000000000002',
      };
    },
  };

  return db;
}
