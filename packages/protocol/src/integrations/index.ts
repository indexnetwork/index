/**
 * integrations — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/*.facade.ts + integrations/public/ pair; the export
 * list is the union of the facades it replaces, so the contract is unchanged.
 */
export {
  createIntegrationTools,
} from "./application/index.js";
export type {
  IntegrationConnection,
  IntegrationSession,
  IntegrationSessionOptions,
  ToolActionResponse,
} from "./domain/index.js";
export type {
  IntegrationAdapter,
  IntegrationToolDeps,
} from "./ports/index.js";
