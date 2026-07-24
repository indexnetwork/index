/**
 * contacts/ports — ContactServiceAdapter persistence port.
 *
 * Injected boundary for contact management persistence. Implemented by
 * the host application and passed into the protocol layer at the composition root.
 *
 * Retains participant reachability semantics: importContacts, listContacts,
 * addContact, removeContact, and searchContacts scope all operations to the
 * owning user's personal network.
 *
 * IND-549: extracted from shared/interfaces/contact.interface.ts into the
 * contacts capability's dedicated ports layer.
 */

import type { ContactInput, ContactResult, ContactImportResult, ContactEntry, ContactSearchResult } from "../domain/index.js";

/**
 * Contact management operations used by chat tools.
 * Consumers must provide a concrete implementation (e.g. backed by ContactService).
 */
export interface ContactServiceAdapter {
  importContacts(ownerId: string, contacts: ContactInput[]): Promise<ContactImportResult>;
  listContacts(ownerId: string): Promise<ContactEntry[]>;
  addContact(ownerId: string, email: string, options?: { name?: string; restore?: boolean }): Promise<ContactResult>;
  removeContact(ownerId: string, contactUserId: string): Promise<void>;
  searchContacts(ownerId: string, q: string, limit?: number): Promise<ContactSearchResult[]>;
}
