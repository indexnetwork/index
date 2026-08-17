/**
 * contacts — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 */
export { createContactTools } from "./contact.tools.js";
export type { ContactServiceAdapter } from "./contact.repository.port.js";
export type { ContactToolDeps } from "./contact.tools.port.js";
