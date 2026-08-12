/**
 * integrations/ports — IntegrationToolDeps tool host port.
 *
 * Narrow port type consumed by createIntegrationTools. The host provides an
 * IntegrationAdapter, an IntegrationImporter, and the contactsEnabled flag
 * that gates the import_gmail_contacts tool (which creates ghost users).
 *
 * NOTE: This type is intentionally defined inline rather than derived from
 * ToolRegistryCompositionDeps, keeping the capability port independent from
 * the all-capability composition contract.
 *
 * Its shape remains structurally equivalent to the matching
 * ToolRegistryCompositionDeps fields.
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
