/**
 * agents/domain — pure agent entity types.
 *
 * These are the core value-objects for the participant-agents capability:
 * agent records, permission grants, and the well-known system agent ID
 * constants.
 *
 * No application logic, no LLM calls, no cross-capability imports.
 *
 * IND-548: canonical home for agent entity types previously in
 * shared/interfaces/agent.interface.ts.
 */

export interface AgentRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  type: 'external' | 'system';
  status: 'active' | 'inactive';
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentPermissionRecord {
  id: string;
  agentId: string;
  userId: string;
  scope: 'global' | 'node' | 'network';
  scopeId: string | null;
  actions: string[];
  createdAt: Date;
}

export interface AgentWithRelations extends AgentRecord {
  permissions: AgentPermissionRecord[];
}

export interface CreateAgentInput {
  ownerId: string;
  name: string;
  description?: string;
  type: 'external' | 'system';
  metadata?: Record<string, unknown>;
}

export interface GrantPermissionInput {
  agentId: string;
  userId: string;
  scope?: 'global' | 'node' | 'network';
  scopeId?: string;
  actions: string[];
}

/**
 * Fixed UUIDs for built-in system agents.
 *
 * These are seeded into the database on first run and must never change,
 * as they are referenced by foreign keys and hard-coded in protocol logic.
 */
export const SYSTEM_AGENT_IDS = {
  negotiator: '00000000-0000-0000-0000-000000000002',
} as const;
