import type { ToolRegistryCompositionDeps } from "../../shared/agent/tool.helpers.js";

/** Host capabilities consumed by opportunity discovery, delivery, and presentation tools. */
export type OpportunityToolDeps = Pick<ToolRegistryCompositionDeps,
  "database" | "userDb" | "systemDb" | "cache" | "chatSummary"
  | "opportunityDiscovery" | "opportunityPresentation" | "questionGenerator"
  | "questionerEnqueue" | "findPendingQuestions" | "negotiationSummary"
  | "negotiationDatabase" | "deliveryLedger" | "discoveryRuns" | "discoveryRunQueue"
  | "mintConnectLink" | "frontendUrl" | "stampNewbornOpportunities" | "reportToolError"
  | "opportunityOwnerApproval"
> & { graphs: Pick<ToolRegistryCompositionDeps["graphs"], "index" | "networkMembership" | "opportunity"> };
