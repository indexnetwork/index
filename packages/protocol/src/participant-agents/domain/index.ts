/**
 * participant-agents/domain — pure agent entity value types and constants.
 *
 * Contains AgentRecord, AgentTransportRecord, AgentPermissionRecord,
 * AgentWithRelations, CreateAgentInput, CreateTransportInput,
 * GrantPermissionInput, and SYSTEM_AGENT_IDS.
 *
 * No application logic, no LLM calls, no cross-capability imports.
 *
 * ## What does NOT live here
 *
 * - AgentDatabase: persistence port — lives in participant-agents/ports.
 * - AgentDispatcher: dispatch port — lives in participant-agents/ports.
 * - createAgentTools: application layer — lives in participant-agents/application.
 *
 * IND-548: canonical domain layer for the participant-agents capability.
 */
export type {
  AgentRecord,
  AgentTransportRecord,
  AgentPermissionRecord,
  AgentWithRelations,
  CreateAgentInput,
  CreateTransportInput,
  GrantPermissionInput,
} from "./agent.types.js";

export { SYSTEM_AGENT_IDS } from "./agent.types.js";
