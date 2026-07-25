/**
 * participant-agents/domain — pure agent entity types.
 *
 * These are the core value-objects for the participant-agents capability:
 * agent records, transport channels, permission grants, and the well-known
 * system agent ID constants.
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
  type: 'personal' | 'external' | 'system';
  status: 'active' | 'inactive';
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentTransportRecord {
  id: string;
  agentId: string;
  channel: 'mcp';
  config: Record<string, unknown>;
  priority: number;
  active: boolean;
  failureCount: number;
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
  transports: AgentTransportRecord[];
  permissions: AgentPermissionRecord[];
}

export interface CreateAgentInput {
  ownerId: string;
  name: string;
  description?: string;
  /** Required: personal rows are auto-provisioned negotiators; tool/registration paths create 'external'. */
  type: 'personal' | 'external' | 'system';
  metadata?: Record<string, unknown>;
}

export interface CreateTransportInput {
  agentId: string;
  channel: 'mcp';
  config?: Record<string, unknown>;
  priority?: number;
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
  chatOrchestrator: '00000000-0000-0000-0000-000000000001',
  negotiator: '00000000-0000-0000-0000-000000000002',
} as const;
