/**
 * contacts/application — foreground adapters and application services.
 *
 * ## Exports
 *
 * ### Tool factory
 * - `createContactTools` — creates contact management MCP tools (import,
 *   list, add, remove, search). Write-path tools are gated behind
 *   deps.contactsEnabled; read/remove/search are always registered.
 *
 * ### Invite generator
 * - `generateInviteMessage` — LLM-based invite message generator for ghost
 *   users; produces short, contextual messages referencing the opportunity.
 *
 * IND-549: canonical application layer for the contacts capability.
 * Legacy paths:
 *   - contact/contact.tools.ts → thin compatibility shim pointing here
 *   - contact/contact.inviter.ts → thin compatibility shim pointing here
 */
export { createContactTools } from "./contact.tools.js";
export { generateInviteMessage } from "./contact.inviter.js";
export type { InviteInput, InviteOutput } from "./contact.inviter.js";
