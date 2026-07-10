/**
 * Database adapter interface for agent registry operations.
 * Implemented by the host application and injected via ProtocolDeps.
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
 * Database adapter interface for agent registry operations.
 *
 * Handles CRUD for agents, their transports, and permission grants.
 * Implemented by the host application (backend) and injected into the
 * protocol layer via constructor injection at the composition root.
 */
export interface AgentDatabase {
  /**
   * Creates a new agent record.
   * @param input - Agent creation parameters.
   * @returns The persisted agent record.
   */
  createAgent(input: CreateAgentInput): Promise<AgentRecord>;

  /**
   * Retrieves an agent by its ID.
   * @param agentId - The agent UUID.
   * @returns The agent record, or null if not found.
   */
  getAgent(agentId: string): Promise<AgentRecord | null>;

  /**
   * Retrieves an agent along with its transports and permissions.
   * @param agentId - The agent UUID.
   * @returns The agent with relations, or null if not found.
   */
  getAgentWithRelations(agentId: string): Promise<AgentWithRelations | null>;

  /**
   * Updates mutable fields on an agent.
   * @param agentId - The agent UUID.
   * @param updates - Partial set of fields to update.
   * @returns The updated agent record, or null if not found.
   */
  updateAgent(
    agentId: string,
    updates: Partial<Pick<AgentRecord, 'name' | 'description' | 'status' | 'metadata'>>,
  ): Promise<AgentRecord | null>;

  /**
   * Deletes an agent and its associated transports and permissions.
   * @param agentId - The agent UUID.
   */
  deleteAgent(agentId: string): Promise<void>;

  /**
   * Lists all agents owned by a user, including their relations.
   * @param userId - The owner's user ID.
   * @returns Array of agents with transports and permissions.
   */
  listAgentsForUser(userId: string): Promise<AgentWithRelations[]>;

  /**
   * Creates a transport channel for an agent.
   * @param input - Transport creation parameters.
   * @returns The persisted transport record.
   */
  createTransport(input: CreateTransportInput): Promise<AgentTransportRecord>;

  /**
   * Deletes a transport channel.
   * @param transportId - The transport UUID.
   */
  deleteTransport(transportId: string): Promise<void>;

  /**
   * Increments the failure counter for a transport channel.
   * @param transportId - The transport UUID.
   */
  recordTransportFailure(transportId: string): Promise<void>;

  /**
   * Resets the failure counter for a transport channel after a successful delivery.
   * @param transportId - The transport UUID.
   */
  recordTransportSuccess(transportId: string): Promise<void>;

  /**
   * Grants a permission to an agent for a given user and scope.
   * @param input - Permission grant parameters.
   * @returns The persisted permission record.
   */
  grantPermission(input: GrantPermissionInput): Promise<AgentPermissionRecord>;

  /**
   * Revokes a permission by its ID.
   * @param permissionId - The permission UUID.
   */
  revokePermission(permissionId: string): Promise<void>;

  /**
   * Checks whether an agent holds a specific permission for a user.
   * @param agentId - The agent UUID.
   * @param userId - The user whose permission is being checked.
   * @param action - The action string to verify (e.g. `"read"`, `"write"`).
   * @param scope - Optional scope restriction; defaults to global if omitted.
   * @returns True if the permission exists, false otherwise.
   */
  hasPermission(
    agentId: string,
    userId: string,
    action: string,
    scope?: { type: 'global' | 'node' | 'network'; id?: string },
  ): Promise<boolean>;

  /**
   * Returns all agents authorized for a user and action, optionally within a scope.
   * @param userId - The user to check authorization for.
   * @param action - The action string (e.g. `"read"`, `"write"`).
   * @param scope - Optional scope restriction.
   * @returns Array of authorized agents with their relations.
   */
  findAuthorizedAgents(
    userId: string,
    action: string,
    scope?: { type: 'global' | 'node' | 'network'; id?: string },
  ): Promise<AgentWithRelations[]>;

  /**
   * Returns the well-known IDs for built-in system agents.
   * @returns Object mapping system agent roles to their fixed UUIDs.
   */
  getSystemAgentIds(): { chatOrchestrator: string; negotiator: string };
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
