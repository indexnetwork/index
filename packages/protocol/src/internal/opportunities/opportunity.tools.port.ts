import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";

/** Host capabilities consumed by opportunity discovery, delivery, and presentation tools. */
export type OpportunityToolDeps = Pick<ToolRegistryCompositionDeps,
  "database" | "userDb" | "systemDb" | "cache"
  | "opportunityPresentation"
  | "frontendUrl" | "stampNewbornOpportunities" | "reportToolError"
  | "opportunityOperations"
> & { graphs: Pick<ToolRegistryCompositionDeps["graphs"], "network" | "networkMembership" | "opportunity"> };
