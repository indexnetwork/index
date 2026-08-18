import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";
import type { OpportunityOwnerApprovalAuthority } from "./opportunity.owner-approval.js";

/**
 * IND-593 host authority consumed only by the opportunity mutation boundary.
 *
 * This stays capability-local rather than extending the shared registry shape:
 * the shared helper participates in the negotiations/question architecture
 * cycle, while owner approval belongs to the opportunity composition seam.
 */
export interface OpportunityOwnerApprovalDeps {
  opportunityOwnerApproval?: OpportunityOwnerApprovalAuthority;
}

/** Host capabilities consumed by opportunity discovery, delivery, and presentation tools. */
export type OpportunityToolDeps = Pick<ToolRegistryCompositionDeps,
  "database" | "userDb" | "systemDb" | "cache" | "chatSummary"
  | "opportunityPresentation"
  | "questionerEnqueue" | "negotiationSummary"
  | "negotiationDatabase" | "deliveryLedger"
  | "frontendUrl" | "stampNewbornOpportunities" | "reportToolError"
  | "opportunityOperations"
> & OpportunityOwnerApprovalDeps
  & { graphs: Pick<ToolRegistryCompositionDeps["graphs"], "index" | "networkMembership" | "opportunity"> };
