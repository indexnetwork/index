/**
 * contacts — ContactServiceAdapter persistence port.
 *
 * Injected boundary for contact management persistence. Implemented by
 * the host application and passed into the protocol layer at the composition root.
 *
 * Retains participant reachability semantics: listContacts, removeContact,
 * and searchContacts scope all operations to the owning user's personal
 * network. Contact rows are created by the opportunity accept / start-chat
 * flow, not through this port.
 */

import type { ContactEntry, ContactSearchResult } from "./contact.types.js";

/**
 * Contact management operations used by chat tools.
 * Consumers must provide a concrete implementation (e.g. backed by ContactService).
 */
export interface ContactServiceAdapter {
  listContacts(ownerId: string): Promise<ContactEntry[]>;
  removeContact(ownerId: string, contactUserId: string): Promise<void>;
  searchContacts(ownerId: string, q: string, limit?: number): Promise<ContactSearchResult[]>;
}
