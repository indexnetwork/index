/**
 * integrations/application — foreground adapters for the integrations capability.
 *
 * ## Exports
 *
 * ### Tool factory
 * - `createIntegrationTools` — creates integration MCP tools (import_gmail_contacts).
 *   The tool is gated behind deps.contactsEnabled; when disabled, returns [].
 *
 * IND-549: canonical application layer for the integrations capability.
 * Legacy path:
 *   - integration/integration.tools.ts → thin compatibility shim pointing here
 */
export { createIntegrationTools } from "./integration.tools.js";
