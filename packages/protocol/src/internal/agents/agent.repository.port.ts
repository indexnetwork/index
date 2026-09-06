/**
 * agents/ports — AgentDatabase persistence port.
 *
 * Injected boundary for agent registry persistence. Implemented by the
 * host application and passed into the protocol layer at the composition root.
 */

import type { AgentRecord, CreateAgentInput } from "./agent.types.js";

/**
 * Database adapter interface for agent registry operations.
 *
 * Handles CRUD for the agents a user owns, plus reading the single agent the
 * owner selected to handle negotiations. Implemented by the host application
 * and injected into the protocol layer at the composition root.
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
   * Deletes an agent.
   * @param agentId - The agent UUID.
   */
  deleteAgent(agentId: string): Promise<void>;

  /**
   * Lists all agents owned by a user.
   * @param userId - The owner's user ID.
   * @returns Array of agents.
   */
  listAgentsForUser(userId: string): Promise<AgentRecord[]>;

  /**
   * Reads the single agent the owner selected to handle negotiations.
   * @param ownerId - The owner's user ID.
   * @returns The selected negotiator, or null when none is selected.
   */
  getSelectedNegotiator(ownerId: string): Promise<AgentRecord | null>;

  /**
   * Returns the well-known IDs for built-in system agents.
   * @returns Object mapping system agent roles to their fixed UUIDs.
   */
  getSystemAgentIds(): { negotiator: string };
}
