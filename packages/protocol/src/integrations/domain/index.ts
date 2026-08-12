/**
 * integrations/domain — pure integration entity value types.
 *
 * Contains IntegrationSession, IntegrationSessionOptions, ToolActionResponse,
 * and IntegrationConnection.
 *
 * ## What does NOT live here
 *
 * - IntegrationAdapter: platform adapter port — lives in integrations/ports.
 * - IntegrationImporter: bulk-import port — lives in integrations/ports.
 * - IntegrationToolDeps: tool host port — lives in integrations/ports.
 * - createIntegrationTools: application layer — lives in integrations/application.
 *
 * IND-549: canonical domain layer for the integrations capability.
 */
export type {
  IntegrationSession,
  IntegrationSessionOptions,
  ToolActionResponse,
  IntegrationConnection,
} from "./integration.types.js";
