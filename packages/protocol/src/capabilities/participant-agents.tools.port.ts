import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";

/** Host capabilities consumed by participant-agent registry tools. */
export type AgentToolDeps = Pick<ToolRegistryCompositionDeps, "agentDatabase">;
