import type { ToolRegistryCompositionDeps } from "../../shared/agent/tool.helpers.js";

/** Host capabilities consumed by community discovery and membership tools. */
export type NetworkToolDeps = Pick<ToolRegistryCompositionDeps,
  "userDb" | "systemDb" | "getUserContextText" | "networkRanker" | "reportToolError"
> & { graphs: Pick<ToolRegistryCompositionDeps["graphs"], "index" | "networkMembership"> };
