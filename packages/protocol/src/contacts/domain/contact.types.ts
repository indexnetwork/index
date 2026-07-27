/**
 * contacts/domain — pure contact entity value types.
 *
 * No application logic, no LLM calls, no cross-capability imports.
 *
 * IND-549: canonical domain layer for the contacts capability.
 * Legacy path (shared/interfaces/contact.interface.ts) is a thin
 * compatibility shim pointing here.
 */

/** Input for importing a single contact. */
export interface ContactInput {
  name: string;
  email: string;
}

/** Result of adding a single contact. */
export interface ContactResult {
  userId: string;
  isNew: boolean;
  isGhost: boolean;
}

/** Result of importing contacts in bulk. */
export interface ContactImportResult {
  imported: number;
  skipped: number;
  newContacts: number;
  existingContacts: number;
  details: Array<{ email: string; userId: string; isNew: boolean }>;
}

/** Contact with user details, as returned by listContacts. */
export interface ContactEntry {
  userId: string;
  user: { id: string; name: string; email: string; avatar: string | null; isGhost: boolean };
}

/** Flat contact row returned by searchContacts. */
export interface ContactSearchResult {
  contactId: string;
  name: string;
  email: string;
  avatar: string | null;
  isGhost: boolean;
}
