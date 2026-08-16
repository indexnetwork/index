import type { ToolRegistryCompositionDeps } from "../../shared/agent/tool.helpers.js";

/** Host capabilities consumed by enrichment and premise-derived identity tools. */
export type EnrichmentToolDeps = Pick<ToolRegistryCompositionDeps,
  "userDb" | "systemDb" | "enricher" | "grantDefaultSystemPermissions"
  | "reportToolError" | "getUserContextText" | "enrichmentRuns" | "enrichmentRunQueue"
> & { graphs: Pick<ToolRegistryCompositionDeps["graphs"], "profile"> };

/** Host capabilities consumed by premise mutation tools. */
export type PremiseToolDeps = Pick<ToolRegistryCompositionDeps, "database">
  & { graphs: Pick<ToolRegistryCompositionDeps["graphs"], "premise"> };
