/**
 * contacts — pure contact entity value types.
 *
 * No application logic, no LLM calls, no cross-capability imports.
 *
 * Canonical contact types for the contacts capability.
 */

/** Contact with user details, as returned by listContacts. */
export interface ContactEntry {
  userId: string;
  user: { id: string; name: string; email: string; avatar: string | null };
}

/** Flat contact row returned by searchContacts. */
export interface ContactSearchResult {
  contactId: string;
  name: string;
  email: string;
  avatar: string | null;
}
