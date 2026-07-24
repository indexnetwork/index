/**
 * contacts/public — curated public surface of the contacts capability.
 *
 * Re-exports stable contracts from domain, application, and ports.
 * Runtime adapter creation (tool factories) is accessible here for package
 * consumers; internal module details remain private to the application layer.
 *
 * ## Boundary
 *
 * References only contacts/domain, contacts/application, and contacts/ports.
 * Never imports from runtime/foreground, host implementations, or other
 * capability internals.
 *
 * ## Intentionally excluded from public surface
 *
 * The following are application-internal or use-site specific:
 * - Invite generator system prompt constants — internal to contact.inviter.ts.
 * - InviteInputSchema, InviteOutputSchema — Zod validation internals.
 *
 * ## Foreground adapters (participant-directed, authenticated)
 *
 * - `createContactTools` — import, list, add, remove, search MCP tools for
 *   the authenticated user's personal network. Write-path tools (import,
 *   add) are feature-gated behind `contactsEnabled`.
 * - `generateInviteMessage` — LLM-based invite message generator for ghost
 *   user outreach.
 *
 * IND-549: canonical public surface for the contacts capability.
 * Legacy path (capabilities/contacts.facade.ts) re-exports from here.
 */

// ── Domain entity types ───────────────────────────────────────────────────────
export type {
  ContactInput,
  ContactResult,
  ContactImportResult,
  ContactEntry,
  ContactSearchResult,
} from "../domain/index.js";

// ── Ports ─────────────────────────────────────────────────────────────────────
export type { ContactServiceAdapter } from "../ports/index.js";
export type { ContactToolDeps } from "../ports/index.js";

// ── Application: foreground adapter tools ─────────────────────────────────────
export { createContactTools } from "../application/index.js";
export { generateInviteMessage } from "../application/index.js";
export type { InviteInput, InviteOutput } from "../application/index.js";
