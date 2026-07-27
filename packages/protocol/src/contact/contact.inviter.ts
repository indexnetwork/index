/**
 * @deprecated Canonical location: contacts/application/contact.inviter
 * Retained for backward compatibility during IND-549 migration.
 * Import generateInviteMessage from contacts/application or via
 * capabilities/contacts.facade.ts instead.
 *
 * IND-549: migrated to src/contacts/application/contact.inviter.ts.
 */
export { generateInviteMessage } from "../contacts/application/index.js";
export type { InviteInput, InviteOutput } from "../contacts/application/index.js";
