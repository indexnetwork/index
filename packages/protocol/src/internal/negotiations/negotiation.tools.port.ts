import type { NegotiationGraphDatabase } from "../../platform/database.js";
import type { AgentDispatcher } from "../shared/interfaces/agent-dispatcher.interface.js";
import type { NegotiationTimeoutQueue } from "../../platform/negotiation-events.js";
import type { NegotiationListingParkHost } from "../../platform/negotiation-listing-park.js";
import type { NegotiatorAnswerToolsHost } from "../../platform/negotiator-answer.js";

/**
 * Host capabilities consumed by the negotiation tool factory.
 *
 * Defined inline here (not derived from ToolRegistryCompositionDeps) to avoid
 * a negotiation → interaction-composition capability dependency, following the
 * same pattern as contacts/contact.tools.port.ts.
 *
 * IND-550: canonical port type for negotiation tool host dependencies.
 */
export interface NegotiationToolDeps {
  negotiationDatabase: NegotiationGraphDatabase;
  agentDispatcher?: AgentDispatcher;
  negotiationTimeoutQueue?: NegotiationTimeoutQueue;
  /**
   * Resolves a signal's open questions for the listing's park annotations
   * (#1472) — the same record the prompt's open-questions section is built
   * from. Optional: without it the listing still says whether a pairing is
   * parked and on whose side, it just cannot name the question's number.
   */
  negotiationListingPark?: NegotiationListingParkHost;
  /**
   * Host bridge behind the MCP-surface `answer_pending_question` tool — the
   * same host, numbering, and consumption path the negotiator persona's chat
   * tool uses (#1466). Optional: without it the tool reports an honest
   * unavailability error rather than not registering, so the MCP tool
   * inventory stays static.
   */
  negotiatorAnswerTools?: NegotiatorAnswerToolsHost;
}
