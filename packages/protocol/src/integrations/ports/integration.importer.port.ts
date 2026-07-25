/**
 * integrations/ports — IntegrationImporter bulk-import port.
 *
 * Narrow port for bulk contact import from integration toolkits (e.g. Gmail).
 * Implemented by the host application and injected at the composition root.
 *
 * Decoupled from IntegrationAdapter: the importer handles the full import
 * pipeline (fetching, deduplication, ghost creation) so tools only need to
 * invoke it by toolkit slug — they do not need raw toolkit access.
 *
 * IND-549: extracted from the inline `integrationImporter` type in
 * shared/agent/tool.helpers.ts into the integrations capability's dedicated
 * ports layer as a named interface.
 */

/** Result of a bulk contact import from an integration toolkit. */
export interface IntegrationImportResult {
  imported: number;
  skipped: number;
  newContacts: number;
  existingContacts: number;
}

/**
 * Bulk contact importer for integration toolkit sources.
 *
 * Implementors handle the full fetch→match→ghost-create pipeline.
 * The tool layer invokes importContacts with the userId and the
 * toolkit slug (e.g. 'gmail') and receives aggregate import statistics.
 */
export interface IntegrationImporter {
  importContacts(userId: string, toolkit: string): Promise<IntegrationImportResult>;
}
