/**
 * contacts/domain — pure contact entity value types.
 *
 * No application logic, no LLM calls, no cross-capability imports.
 *
 * IND-549: canonical domain layer for the contacts capability.
 */

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
