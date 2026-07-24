/**
 * @deprecated — compatibility shim.
 *
 * Canonical types have moved to the participant-agents domain-first module:
 * - Domain entity types → participant-agents/domain
 * - AgentDatabase port  → participant-agents/ports
 *
 * This re-export exists solely to avoid breaking imports that pre-date IND-548.
 * Import directly from participant-agents/domain or participant-agents/ports
 * for new code, or use the capabilities/participant-agents.facade.ts surface
 * from outside the package.
 *
 * IND-548: migrated to src/participant-agents/domain/ and src/participant-agents/ports/.
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
} from '../../participant-agents/domain/index.js';

export { SYSTEM_AGENT_IDS } from '../../participant-agents/domain/index.js';

// ── Persistence port ──────────────────────────────────────────────────────────
export type { AgentDatabase } from '../../participant-agents/ports/index.js';
