import { z } from 'zod';
import type { DefineTool, ToolDeps } from '../shared/agent/tool.helpers.js';
import { success, error } from '../shared/agent/tool.helpers.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('ContactTools');

/**
 * Creates contact management tools for the chat agent.
 * Enables importing, listing, and managing the user's network.
 */
export function createContactTools(defineTool: DefineTool, deps: ToolDeps) {
  const { contactService } = deps;
  // Contact import / manual-add create ghost users. These are gated behind the
  // CONTACTS_ENABLED flag (injected as deps.contactsEnabled). Read/remove/search
  // tools below are always available so existing contacts stay manageable.
  const contactsEnabled = deps.contactsEnabled === true;

  // Only register when enabled: in the registry path defineTool registers as a
  // side effect, so the call itself must be gated, not just the returned array.
  const import_contacts = contactsEnabled ? defineTool({
    name: 'import_contacts',
    description:
      "Bulk-imports contacts into the authenticated user's personal network (personal index). Contacts become members of the user's " +
      "personal index with 'contact' permission, making them available for opportunity discovery.\n\n" +
      "**What happens:** Each contact is matched by email. If the email belongs to an existing user, they're linked directly. " +
      "If not, a 'ghost user' is created — a placeholder account enriched with public profile data (from LinkedIn, GitHub, etc.) " +
      "that participates in opportunity matching even before the person joins the platform.\n\n" +
      "**When to use:** When the user provides a list of contacts to add (from CSV, manual input, or any source other than Gmail). " +
      "For Gmail specifically, use import_gmail_contacts instead.\n\n" +
      "**Returns:** Import statistics: imported (total processed), skipped (invalid), newContacts (ghost users created), " +
      "existingContacts (already in network). Use list_contacts to see all contacts after import.",
    querySchema: z.object({
      contacts: z.array(z.object({
        name: z.string().describe('Full name of the contact (e.g. "Jane Smith")'),
        email: z.string().describe('Email address — used as the unique identifier for matching existing users'),
      })).describe('Array of contact objects to import. Each must have name and email. Duplicates (by email) are skipped.'),
    }),
    handler: async ({ context, query }) => {
      try {
        const result = await contactService.importContacts(
          context.userId,
          query.contacts
        );
        return success({
          message: `Imported ${result.imported} contacts to your network.`,
          imported: result.imported,
          skipped: result.skipped,
          newContacts: result.newContacts,
          existingContacts: result.existingContacts,
        });
      } catch (err) {
        logger.error('Failed to import contacts', { err });
        return error('Failed to import contacts. Please try again.');
      }
    },
  }) : null;

  const list_contacts = defineTool({
    name: 'list_contacts',
    description:
      "Lists all contacts in the authenticated user's personal network. Contacts are people the user has added " +
      "(via import_contacts, add_contact, or import_gmail_contacts) stored as members of their personal index.\n\n" +
      "**When to use:** To see who's in the user's network, find a contact's userId for other operations, " +
      "or check if a specific person is already a contact.\n\n" +
      "**Returns:** Array of contacts, each with: userId (use with read_user_contexts or discover_opportunities), " +
      "name, email, avatar URL, and isGhost (true = no account yet, profile enriched from public data). " +
      "Use the userId with read_user_contexts(userId) to get the full profile, or with discover_opportunities(targetUserId) to connect.",
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
            isGhost: c.user.isGhost,
          })),
        });
      } catch (err) {
        logger.error('Failed to list contacts', { err });
        return error('Failed to list contacts. Please try again.');
      }
    },
  });

  const add_contact = contactsEnabled ? defineTool({
    name: 'add_contact',
    description:
      "Adds a single contact to the authenticated user's personal network by email address. " +
      "For bulk imports, use import_contacts instead.\n\n" +
      "**What happens:** Looks up the email. If an account exists, links that user as a contact. " +
      "If not, creates a ghost user (placeholder enriched with public profile data) and adds them. " +
      "The contact can then appear in opportunity discovery within the user's personal index.\n\n" +
      "**When to use:** When the user wants to add a specific person (e.g. 'add john@example.com to my network').\n\n" +
      "**Returns:** Confirmation with the contact's userId and whether a new ghost user was created (isNewGhost). " +
      "Use the userId with discover_opportunities(targetUserId) to find connection opportunities.",
    querySchema: z.object({
      email: z.string().describe('Email address of the person to add. Used as unique identifier — if already a contact, the operation is idempotent.'),
      name: z.string().optional().describe('Full name of the contact. Optional — if omitted, the email prefix is used as name. Provide when known for better profile enrichment.'),
    }),
    handler: async ({ context, query }) => {
      try {
        const result = await contactService.addContact(context.userId, query.email, { name: query.name, restore: true });

        return success({
          added: true,
          message: result.isNew
            ? `Added ${query.name || query.email} to your network. Their profile is being enriched.`
            : `Added ${query.name || query.email} to your network.`,
          userId: result.userId,
          isNewGhost: result.isNew,
        });
      } catch (err) {
        logger.error('Failed to add contact', { err });
        return error('Failed to add contact. Please try again.');
      }
    },
  }) : null;

  const remove_contact = defineTool({
    name: 'remove_contact',
    description:
      "Removes a contact from the authenticated user's personal network. The contact relationship is deleted — " +
      "the person is no longer a member of the user's personal index and won't appear in personal-index-scoped discovery.\n\n" +
      "**When to use:** When the user wants to remove someone from their network (e.g. 'remove John from my contacts').\n\n" +
      "**Note:** This only removes the contact relationship. If the contact is a real user (not a ghost), " +
      "they still exist on the platform and may appear in shared index discovery.\n\n" +
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
      "(e.g. read_user_contexts, discover_opportunities).\n\n" +
      "**When to use:** Before list_contacts when the network is large — returns only matching contacts, bounded by limit.\n\n" +
      "**Returns:** Array of matching contacts: userId, name, email, avatar, isGhost.",
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
            isGhost: r.isGhost,
          })),
        });
      } catch (err) {
        logger.error('Failed to search contacts', { err });
        return error('Failed to search contacts. Please try again.');
      }
    },
  });

  return [
    ...(import_contacts ? [import_contacts] : []),
    ...(add_contact ? [add_contact] : []),
    list_contacts,
    remove_contact,
    search_contacts,
  ];
}
