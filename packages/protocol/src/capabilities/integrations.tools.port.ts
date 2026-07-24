import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";

/** Host capabilities consumed by integration-backed contact import tools. */
export type IntegrationToolDeps = Pick<ToolRegistryCompositionDeps,
  "integration" | "integrationImporter" | "contactsEnabled"
>;
