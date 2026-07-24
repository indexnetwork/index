import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";

/** Host capabilities consumed by negotiation tools. */
export type NegotiationToolDeps = Pick<ToolRegistryCompositionDeps,
  "negotiationDatabase" | "agentDispatcher" | "negotiationTimeoutQueue"
>;
