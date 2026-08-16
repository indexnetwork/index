/**
 * integrations/public — curated public surface of the integrations capability.
 *
 * Re-exports stable contracts from domain, application, and ports.
 * Runtime adapter creation (tool factories) is accessible here for package
 * consumers; internal module details remain private to the application layer.
 *
 * ## Boundary
 *
 * References only integrations/domain, integrations/application, and
 * integrations/ports. Never imports from the tool composition root (shared/agent), host
 * implementations, or other capability internals.
 *
 * ## Intentionally excluded from public surface
 *
 * The following are application-internal or use-site specific:
 * - OAuth callback URL derivation — runtime context detail in integration.tools.ts.
 * - AuthorizeFn cast — internal type coercion for integration platform SDK.
 *
 * ## Foreground adapters (participant-directed, authenticated)
 *
 * - `createIntegrationTools` — import_gmail_contacts MCP tool for importing
 *   the user's Google contacts. Gated behind `contactsEnabled`.
 *
 * ## Allowed outbound dependencies
 *
 * integrations has no allowed capability dependencies (empty set in
 * capability-boundaries.ts). It may only depend on shared/ primitives.
 *
 * IND-549: canonical public surface for the integrations capability.
 * Legacy path (capabilities/integrations.facade.ts) re-exports from here.
 */

// ── Domain entity types ───────────────────────────────────────────────────────
export type {
  IntegrationSession,
  IntegrationSessionOptions,
  ToolActionResponse,
  IntegrationConnection,
} from "../domain/index.js";

// ── Ports ─────────────────────────────────────────────────────────────────────
export type { IntegrationAdapter } from "../ports/index.js";
export type { IntegrationImporter, IntegrationImportResult } from "../ports/index.js";
export type { IntegrationToolDeps } from "../ports/index.js";

// ── Application: foreground adapter tools ─────────────────────────────────────
export { createIntegrationTools } from "../application/index.js";
