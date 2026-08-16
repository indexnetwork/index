/**
 * contacts — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/contacts.facade.ts + contacts/public/ pair; the
 * export list is the union of the facades it replaces, so the contract is unchanged.
 */
export {
  createContactTools,
  generateInviteMessage,
} from "./application/index.js";
export type {
  ContactServiceAdapter,
  ContactToolDeps,
} from "./ports/index.js";
