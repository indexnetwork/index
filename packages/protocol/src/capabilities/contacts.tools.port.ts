import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";

/** Host capabilities consumed by contact tools. */
export type ContactToolDeps = Pick<ToolRegistryCompositionDeps, "contactService" | "contactsEnabled">;
