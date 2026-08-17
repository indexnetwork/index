import { log } from '../lib/log';
import { ContactDatabaseAdapter } from '../adapters/contact.database.adapter';

const logger = log.service.from('ContactService');

/**
 * ContactService
 *
 * Reads and removes user contacts ("My Network"), stored as network_members rows
 * with 'contact' permission on the owner's personal network.
 *
 * Contact rows are CREATED by the opportunity flow, not here: accepting an
 * opportunity (and the Start Chat transition) writes the mutual memberships via
 * OpportunityService → upsertContactMembership. There is no import or
 * manual-add path, and no ghost users — every contact is a real account.
 *
 * RESPONSIBILITIES:
 * - List and search the owner's contacts
 * - Remove a contact membership
 */
export class ContactService {
  constructor(private db = new ContactDatabaseAdapter()) {}

  /**
   * List all contacts for a user.
   *
   * @param ownerId - The user whose contacts to list
   * @returns Array of contacts with user details
   */
  async listContacts(ownerId: string): Promise<Array<{
    userId: string;
    user: { id: string; name: string; email: string; avatar: string | null };
  }>> {
    return this.db.getContactMembers(ownerId);
  }

  /**
   * Search the owner's contacts by name or email (case-insensitive ILIKE).
   *
   * @param ownerId - The user whose contacts to search
   * @param q - Free-text query
   * @param limit - Maximum rows to return (default 25)
   */
  async searchContacts(ownerId: string, q: string, limit = 25): Promise<Array<{
    contactId: string;
    name: string;
    email: string;
    avatar: string | null;
  }>> {
    return this.db.searchContactMembers(ownerId, q, limit);
  }

  /**
   * Remove a contact from the user's network (hard delete from network_members).
   *
   * Hard delete is deliberate: it doubles as the reverse opt-out that
   * OpportunityService honours via `upsertContactMembership(..., { restore: false })`,
   * so a removed person is not silently re-added by the counterpart's next accept.
   *
   * @param ownerId - The user removing the contact
   * @param contactUserId - The contact user ID to remove
   */
  async removeContact(ownerId: string, contactUserId: string): Promise<void> {
    logger.info('Removing contact', { ownerId, contactUserId });
    await this.db.hardDeleteContactMembership(ownerId, contactUserId);
  }
}

export const contactService = new ContactService();
