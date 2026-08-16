/**
 * agents/ports — AgentToolDeps tool host port.
 *
 * Narrow port type consumed by createAgentTools. The host provides an
 * optional AgentDatabase so agent registration tools are compiled only
 * when the database adapter is wired at the composition root.
 *
 * NOTE: This type is intentionally defined inline rather than derived from
 * ToolRegistryCompositionDeps, keeping the capability port independent from
 * the all-capability composition contract.
 *
 * Structural equivalence with ToolRegistryCompositionDeps.agentDatabase is
 * preserved: both have type `AgentDatabase | undefined`.
 *
 * IND-548: extracted from capabilities/participant-agents.tools.port.ts
 * into the participant-agents capability's dedicated ports layer.
 */

import type { AgentDatabase } from './agent.repository.port.js';

/** Host capabilities consumed by participant-agent registry tools. */
export type AgentToolDeps = { agentDatabase?: AgentDatabase };
