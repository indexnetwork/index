/**
 * integrations/ports — IntegrationToolDeps tool host port.
 *
 * Narrow port type consumed by createIntegrationTools. The host provides an
 * IntegrationAdapter, an IntegrationImporter, and the contactsEnabled flag
 * that gates the import_gmail_contacts tool (which creates ghost users).
 *
 * NOTE: This type is intentionally defined inline (not derived via Pick from
 * ToolRegistryCompositionDeps in shared/agent/tool.helpers.ts) to avoid a
 * module cycle. ToolRegistryCompositionDeps imports IntegrationAdapter from
 * shared/interfaces/integration.interface.ts, which after IND-549 forwards
 * to integrations/ports — creating a cycle back here.
 *
 * Structural equivalence with the Pick<ToolRegistryCompositionDeps,
 * "integration" | "integrationImporter" | "contactsEnabled"> definition in
 * the legacy shim is preserved.
 *
 * IND-549: extracted from capabilities/integrations.tools.port.ts into the
 * integrations capability's dedicated ports layer.
 */

import type { IntegrationAdapter } from "./integration.adapter.port.js";
import type { IntegrationImporter } from "./integration.importer.port.js";

/** Host capabilities consumed by integration-backed contact import tools. */
export type IntegrationToolDeps = {
  integration: IntegrationAdapter;
  integrationImporter: IntegrationImporter;
  contactsEnabled?: boolean;
};
