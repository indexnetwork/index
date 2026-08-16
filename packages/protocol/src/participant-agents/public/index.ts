/**
 * participant-agents/public — curated public surface of the participant-agents capability.
 *
 * Re-exports stable contracts from domain, application, and ports.
 * Runtime adapter creation (tool factories) is accessible here for package
 * consumers; internal module details (persona definitions, prompt builders,
 * graph state) remain private to the application layer.
 *
 * ## Boundary
 *
 * References only participant-agents/domain, participant-agents/application,
 * and participant-agents/ports.  Never imports from runtime/foreground, host
 * implementations, or other capability internals.
 *
 * ## Intentionally excluded from public surface
 *
 * The following are application-internal or runtime-owned:
 * - ChatGraphFactory, ChatPersonaConfig, ChatPersona — runtime graph wiring;
 *   consumers should import via capabilities/participant-agents.facade.ts.
 * - Persona constants (SIGNAL_PERSONA, REPORTER_PERSONA, etc.) — chat
 *   runtime internals; import from capabilities/participant-agents.facade.ts.
 * - ChatTitleGenerator, ChatSummarizer, etc. — runtime tool composition; import
 *   via capabilities/participant-agents.facade.ts.
 *
 * ## Foreground adapters (participant-directed, authenticated)
 *
 * - `createAgentTools` — registration, permission grant/revoke, listing, CRUD
 *   MCP tools for authenticated agent management paths.
 *
 * IND-548: canonical public surface for the participant-agents capability.
 * Legacy paths (capabilities/participant-agents.facade.ts) re-export from here
 * for the agent-registry portion of the facade.
 */

// ── Domain entity types ───────────────────────────────────────────────────────
export type {
  AgentRecord,
  AgentTransportRecord,
  AgentPermissionRecord,
  AgentWithRelations,
  CreateAgentInput,
  CreateTransportInput,
  GrantPermissionInput,
} from "../domain/index.js";

export { SYSTEM_AGENT_IDS } from "../domain/index.js";

// ── Ports ─────────────────────────────────────────────────────────────────────
export type { AgentDatabase } from "../ports/index.js";
export type {
  AgentDispatcher,
  AgentDispatchResult,
  NegotiationTurnPayload,
} from "../ports/index.js";
export type { AgentToolDeps } from "../ports/index.js";

// ── Application: foreground adapter tools ─────────────────────────────────────
export { createAgentTools } from "../application/index.js";
