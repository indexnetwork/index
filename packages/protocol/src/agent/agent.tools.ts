/**
 * @deprecated — compatibility shim.
 *
 * Canonical implementation has moved to participant-agents/application.
 * This re-export exists solely to avoid breaking imports that pre-date IND-548.
 * Import from the participant-agents module or capabilities/participant-agents.facade.ts
 * for new code.
 *
 * IND-548: migrated to src/participant-agents/application/agent.tools.ts.
 */
export { createAgentTools } from '../participant-agents/application/index.js';
