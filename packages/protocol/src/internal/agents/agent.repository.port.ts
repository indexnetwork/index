/**
 * agents/ports — AgentDatabase persistence port.
 *
 * Injected boundary for agent registry persistence.  Implemented by the
 * host application and passed into the protocol layer at the composition root.
 *
 * IND-548: extracted from shared/interfaces/agent.interface.ts into the
 * participant-agents capability's dedicated ports layer.
 */

import type { AgentRecord, AgentTransportRecord, AgentPermissionRecord, AgentWithRelations, CreateAgentInput, CreateTransportInput, GrantPermissionInput } from "./agent.types.js";

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
   * Returns the well-known IDs for built-in system agents.
   * @returns Object mapping system agent roles to their fixed UUIDs.
   */
  getSystemAgentIds(): { chatOrchestrator: string; negotiator: string };
}
