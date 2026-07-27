/**
 * @deprecated Canonical location: integrations/ports
 * Retained for backward compatibility during IND-549 migration.
 *
 * IND-549: types and interfaces migrated to src/integrations/domain and
 * src/integrations/ports. This file is a thin compatibility shim.
 */

// Domain value types
export type {
  IntegrationSession,
  IntegrationSessionOptions,
  ToolActionResponse,
  IntegrationConnection,
} from "../../integrations/domain/index.js";

// Platform adapter port
export type { IntegrationAdapter } from "../../integrations/ports/index.js";
