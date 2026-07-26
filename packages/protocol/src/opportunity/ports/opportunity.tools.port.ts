import type { ToolRegistryCompositionDeps } from "../../shared/agent/tool.helpers.js";
import type { OpportunityOwnerApprovalAuthority } from "../application/opportunity.owner-approval.js";

/**
 * IND-593 host authority consumed only by the opportunity mutation boundary.
 *
 * This stays capability-local rather than extending the shared registry shape:
 * the shared helper participates in the negotiation/question architecture
 * cycle, while owner approval belongs to the opportunity composition seam.
 */
export interface OpportunityOwnerApprovalDeps {
  opportunityOwnerApproval?: OpportunityOwnerApprovalAuthority;
}

/** Host capabilities consumed by opportunity discovery, delivery, and presentation tools. */
export type OpportunityToolDeps = Pick<ToolRegistryCompositionDeps,
  "database" | "userDb" | "systemDb" | "cache" | "chatSummary"
  | "opportunityDiscovery" | "opportunityPresentation" | "questionGenerator"
  | "questionerEnqueue" | "findPendingQuestions" | "negotiationSummary"
  | "negotiationDatabase" | "deliveryLedger" | "discoveryRuns" | "discoveryRunQueue"
  | "mintConnectLink" | "frontendUrl" | "stampNewbornOpportunities" | "reportToolError"
> & OpportunityOwnerApprovalDeps
  & { graphs: Pick<ToolRegistryCompositionDeps["graphs"], "index" | "networkMembership" | "opportunity"> };
