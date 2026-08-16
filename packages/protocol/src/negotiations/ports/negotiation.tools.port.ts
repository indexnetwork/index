import type { NegotiationGraphDatabase } from "../../shared/interfaces/database.interface.js";
import type { AgentDispatcher } from "../../shared/interfaces/agent-dispatcher.interface.js";
import type { NegotiationTimeoutQueue } from "../../shared/interfaces/negotiation-events.interface.js";

/**
 * Host capabilities consumed by the negotiation tool factory.
 *
 * Defined inline here (not derived from ToolRegistryCompositionDeps) to avoid
 * a negotiation → interaction-composition capability dependency, following the
 * same pattern as contacts/ports/contact.tools.port.ts.
 *
 * IND-550: canonical port type for negotiation tool host dependencies.
 */
export interface NegotiationToolDeps {
  negotiationDatabase: NegotiationGraphDatabase;
  agentDispatcher?: AgentDispatcher;
  negotiationTimeoutQueue?: NegotiationTimeoutQueue;
}
