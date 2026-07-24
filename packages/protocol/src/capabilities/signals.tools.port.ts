import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";

/** Host capabilities consumed by signal and intent tools. */
export type IntentToolDeps = Pick<ToolRegistryCompositionDeps, "userDb" | "systemDb">
  & { graphs: Pick<ToolRegistryCompositionDeps["graphs"], "intent" | "intentIndex" | "profile"> };
