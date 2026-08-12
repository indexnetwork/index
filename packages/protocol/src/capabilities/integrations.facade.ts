/**
 * Integrations capability's supported tool entry point.
 *
 * IND-549: sources now route through the canonical integrations module instead
 * of the legacy integration/ shim directory.
 */
export { createIntegrationTools } from "../integrations/public/index.js";
export type {
  IntegrationAdapter,
  IntegrationConnection,
  IntegrationSession,
  IntegrationSessionOptions,
  IntegrationToolDeps,
  ToolActionResponse,
} from "../integrations/public/index.js";
