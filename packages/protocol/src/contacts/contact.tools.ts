/**
 * contacts — createContactTools canonical implementation.
 *
 * Creates contact management tools for the chat agent. Enables listing,
 * removing, and searching the user's personal network.
 *
 * Contacts are established by accepting an opportunity — opportunity accept
 * and start-chat write the mutual `contact` memberships. There is no import or
 * manual-add path, and no ghost users: every contact is a real account.
 */

import { z } from 'zod';
import type { DefineTool } from '../shared/agent/tool.helpers.js';
import type { ContactToolDeps } from './contact.tools.port.js';
import { success, error } from '../shared/agent/tool.helpers.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('ChatTools:Contact');

/**
 * Creates contact management tools for the chat agent.
 * Enables listing, searching, and removing entries in the user's network.
 */
export function createContactTools(defineTool: DefineTool, deps: ContactToolDeps) {
  const { contactService } = deps;

  const list_contacts = defineTool({
    name: 'list_contacts',
    description:
      "Lists all contacts in the authenticated user's personal network. Contacts are people the user has " +
      "accepted an opportunity with, stored as members of their personal network.\n\n" +
      "**When to use:** To see who's in the user's network, find a contact's userId for other operations, " +
      "or check if a specific person is already a contact.\n\n" +
      "**Returns:** Array of contacts, each with userId (use with read_user_contexts), name, email, and avatar URL. " +
      "Use read_user_contexts(userId) to get the full profile. " +
      "Approved signals are matched in the background; list_opportunities only reviews persisted results.",
    querySchema: z.object({
      limit: z.number().optional().describe('Maximum number of contacts to return. Omit to return all contacts. Use for large networks to paginate results.'),
    }),
    handler: async ({ context, query }) => {
      try {
        let contacts = await contactService.listContacts(context.userId);

        if (query.limit && query.limit > 0) {
          contacts = contacts.slice(0, query.limit);
        }

        return success({
          count: contacts.length,
          contacts: contacts.map(c => ({
            userId: c.userId,
            name: c.user.name,
            email: c.user.email,
            avatar: c.user.avatar,
          })),
        });
      } catch (err) {
        logger.error('Failed to list contacts', { err });
        return error('Failed to list contacts. Please try again.');
      }
    },
  });

  const remove_contact = defineTool({
    name: 'remove_contact',
    description:
      "Removes a contact from the authenticated user's personal network. The contact relationship is deleted — " +
      "the person is no longer a member of the user's personal network and their signals are no longer eligible for matching there.\n\n" +
      "**When to use:** When the user wants to remove someone from their network (e.g. 'remove John from my contacts').\n\n" +
      "**Note:** This only removes the contact relationship. If the contact is a real user (not a ghost), " +
      "they still exist on the platform and their approved signals may remain eligible in shared networks.\n\n" +
      "**Returns:** Confirmation that the contact was removed.",
    querySchema: z.object({
      contactUserId: z.string().describe('The userId of the contact to remove. Get this from list_contacts results.'),
    }),
    handler: async ({ context, query }) => {
      try {
        await contactService.removeContact(context.userId, query.contactUserId);
        return success({ removed: true, message: 'Contact removed from your network.' });
      } catch (err) {
        logger.error('Failed to remove contact', { err });
        return error('Failed to remove contact. Please try again.');
      }
    },
  });

  const search_contacts = defineTool({
    name: 'search_contacts',
    description:
      "Searches the authenticated user's personal network by name or email (case-insensitive substring). " +
      "Use when the user refers to a contact by partial name or email and you need their userId for another tool " +
      "(e.g. read_user_contexts).\n\n" +
      "**When to use:** Before list_contacts when the network is large — returns only matching contacts, bounded by limit.\n\n" +
      "**Returns:** Array of matching contacts: userId, name, email, avatar.",
    querySchema: z.object({
      query: z.string().trim().min(1).describe('Free-text query matched against contact name and email (case-insensitive, substring).'),
      limit: z.number().int().positive().max(100).optional().describe('Maximum rows to return. Defaults to 25.'),
    }),
    handler: async ({ context, query }) => {
      try {
        const rows = await contactService.searchContacts(context.userId, query.query, query.limit ?? 25);
        return success({
          count: rows.length,
          contacts: rows.map(r => ({
            userId: r.contactId,
            name: r.name,
            email: r.email,
            avatar: r.avatar,
          })),
        });
      } catch (err) {
        logger.error('Failed to search contacts', { err });
        return error('Failed to search contacts. Please try again.');
      }
    },
  });

  return [list_contacts, remove_contact, search_contacts];
}
