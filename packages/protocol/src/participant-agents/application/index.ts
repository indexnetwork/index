/**
 * participant-agents/application — registration, permission, and dispatch tools.
 *
 * Re-exports the application-tier entry points of the participant-agents
 * capability: the agent registration and permission management tool factory.
 *
 * ## Foreground adapters (participant-directed, authenticated)
 *
 * - {@link createAgentTools} — `read_own_agent`, `register_agent`,
 *   `list_agents`, `update_agent`, `delete_agent`, `grant_agent_permission`,
 *   `revoke_agent_permission` MCP tools for the authenticated registration
 *   and permission management path (IND-599: `read_own_agent` is the
 *   agent-principal self-read; the rest are human owner/admin actions).
 *
 * ## Boundary
 *
 * Imports from participant-agents/domain, participant-agents/ports, and
 * shared/ infrastructure — never from runtime/, host implementations, or
 * other capability internals.
 *
 * IND-548: canonical application layer for the participant-agents capability.
 */

// ── Registration and permission management tools ──────────────────────────────
export { createAgentTools } from "./agent.tools.js";
