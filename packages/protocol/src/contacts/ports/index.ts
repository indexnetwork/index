/**
 * contacts/ports — injected dependency contracts for the contacts capability.
 *
 * Re-exports the narrow port types that the contacts module declares as
 * explicit injected boundaries. Consumers import these to wire host
 * implementations without depending on the application layer.
 *
 * ## Port groups
 *
 * ### Persistence port
 * - ContactServiceAdapter — contact CRUD: import, list, add, remove, search.
 *
 * ### Tool host port
 * - ContactToolDeps — host capabilities for contact management tools.
 *
 * IND-549: canonical ports surface for the contacts capability.
 * Legacy path:
 *   - shared/interfaces/contact.interface.ts → re-exports types from here
 */

// ── Persistence ───────────────────────────────────────────────────────────────
export type { ContactServiceAdapter } from "./contact.repository.port.js";

// ── Tool host ─────────────────────────────────────────────────────────────────
export type { ContactToolDeps } from "./contact.tools.port.js";
