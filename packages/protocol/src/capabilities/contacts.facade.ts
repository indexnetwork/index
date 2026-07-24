/**
 * Contacts capability's supported invite and contact-tool entry points.
 *
 * IND-549: sources now route through the canonical contacts module instead
 * of the legacy contact/ shim directories.
 */
export { generateInviteMessage } from "../contacts/public/index.js";
export { createContactTools } from "../contacts/public/index.js";
export type { ContactToolDeps } from "../contacts/public/index.js";
