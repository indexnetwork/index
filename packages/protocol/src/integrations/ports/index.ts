/**
 * integrations/ports — injected dependency contracts for the integrations capability.
 *
 * Re-exports the narrow port types that the integrations module declares as
 * explicit injected boundaries. Consumers import these to wire host
 * implementations without depending on the application layer.
 *
 * ## Port groups
 *
 * ### Platform adapter port
 * - IntegrationAdapter — session creation, tool execution, connection management,
 *   OAuth auth URLs, and disconnection.
 *
 * ### Bulk import port
 * - IntegrationImporter — toolkit-to-contacts bulk import pipeline.
 * - IntegrationImportResult — aggregate import statistics.
 *
 * ### Tool host port
 * - IntegrationToolDeps — host capabilities for integration-backed tools.
 *
 * IND-549: canonical ports surface for the integrations capability.
 * Legacy path:
 *   - shared/interfaces/integration.interface.ts → re-exports types from here
 */

// ── Platform adapter ──────────────────────────────────────────────────────────
export type { IntegrationAdapter } from "./integration.adapter.port.js";

// ── Bulk import ───────────────────────────────────────────────────────────────
export type { IntegrationImporter, IntegrationImportResult } from "./integration.importer.port.js";

// ── Tool host ─────────────────────────────────────────────────────────────────
export type { IntegrationToolDeps } from "./integration.tools.port.js";
