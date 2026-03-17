import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import type { ContactSource } from '../schemas/database.schema';
import { profileQueue } from '../queues/profile.queue';

const logger = log.service.from('ContactService');

/** Email prefixes that indicate automated/service accounts. */
const NON_HUMAN_PREFIXES = new Set([
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply',
  'support', 'info', 'help', 'sales', 'marketing', 'hello',
  'notifications', 'notification', 'alerts', 'alert',
  'newsletter', 'newsletters', 'news', 'updates', 'update',
  'billing', 'invoices', 'receipts', 'orders',
  'admin', 'administrator', 'system', 'mailer', 'mailer-daemon',
  'daemon', 'postmaster', 'webmaster', 'hostmaster',
  'feedback', 'contact', 'team', 'service', 'services',
  'security', 'privacy', 'legal', 'compliance',
  'calendar', 'calendar-server', 'calendar-notification',
]);

/** Domain patterns that indicate automated/service emails. */
const NON_HUMAN_DOMAIN_PATTERNS = [
  /calendar-notification\.google\.com$/i,
  /accounts\.google\.com$/i,
  /notifications\..+\.com$/i,
  /noreply\..+$/i,
  /mailer\..+$/i,
  /^test\.(com|dev|local|internal)$/i,
];

/** Name patterns that indicate non-human contacts. */
const NON_HUMAN_NAME_PATTERNS = [
  /^no[ -_]?reply$/i,
  /support$/i,
  /team$/i,
  /^(the )?.+ (team|support|notifications|alerts)$/i,
];

/**
 * Determines if a contact appears to be a human (not a service/automated account).
 * @param email - The contact's email address
 * @param name - The contact's name (may be empty)
 * @returns true if the contact appears to be human
 */
export function isHumanContact(email: string, name: string): boolean {
  const [prefix, domain] = email.toLowerCase().split('@');

  if (NON_HUMAN_PREFIXES.has(prefix)) return false;

  if (NON_HUMAN_DOMAIN_PATTERNS.some(p => p.test(domain))) return false;

  if (name && NON_HUMAN_NAME_PATTERNS.some(p => p.test(name))) return false;

  return true;
}

/** Input for importing a single contact. */
export interface ContactInput {
  name: string;
  email: string;
}

/** Result of importing contacts. */
export interface ImportResult {
  imported: number;
  skipped: number;
  newContacts: number;
  existingContacts: number;
  details: Array<{ email: string; userId: string; isNew: boolean }>;
}

/** Contact with user details. */
export interface Contact {
  id: string;
  userId: string;
  source: string;
  importedAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
    isGhost: boolean;
  };
}

/**
 * ContactService
 *
 * Manages user contacts ("My Network") including importing from integrations,
 * creating ghost users for unknown contacts, and listing/removing contacts.
 *
 * RESPONSIBILITIES:
 * - Import contacts from integration output (Gmail, Calendar) or manual input
 * - Create ghost users for contacts without existing accounts
 * - Enqueue enrichment jobs for new ghost users
 * - List and manage contacts
 */
export class ContactService {
  constructor(private db = new ChatDatabaseAdapter()) {}

  /**
   * Import contacts into the user's network.
   * For each contact:
   * - If email exists in users table, link to existing user
   * - If email doesn't exist, create a ghost user
   * - Upsert the contact relationship
   * - Enqueue enrichment for new ghost users
   *
   * Uses bulk operations for performance.
   *
   * @param ownerId - The user importing contacts
   * @param contacts - Array of contact data (name, email)
   * @param source - Where contacts came from (gmail, google_calendar, manual)
   * @returns Import statistics and details
   */
  async importContacts(
    ownerId: string,
    contacts: ContactInput[],
    source: ContactSource
  ): Promise<ImportResult> {
    logger.info('[ContactService] Importing contacts', {
      ownerId,
      count: contacts.length,
      source,
    });

    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      newContacts: 0,
      existingContacts: 0,
      details: [],
    };

    // Fetch owner once
    const owner = await this.db.getUser(ownerId);
    const ownerEmail = owner?.email.toLowerCase();

    // Normalize, filter, and deduplicate contacts
    const seenEmails = new Set<string>();
    const validContacts: Array<{ name: string; email: string }> = [];
    for (const contact of contacts) {
      const email = contact.email.toLowerCase().trim();
      if (!email || !email.includes('@')) {
        result.skipped++;
        continue;
      }
      if (ownerEmail === email) {
        result.skipped++;
        continue;
      }
      if (seenEmails.has(email)) {
        result.skipped++;
        continue;
      }
      const name = contact.name?.trim() || '';
      if (!isHumanContact(email, name)) {
        logger.debug('[ContactService] Skipped non-human contact', { domain: email.split('@')[1] });
        result.skipped++;
        continue;
      }
      seenEmails.add(email);
      validContacts.push({
        name: name || email.split('@')[0],
        email,
      });
    }

    if (validContacts.length === 0) {
      logger.info('[ContactService] No valid contacts to import', { ownerId });
      return result;
    }

    // Bulk lookup existing users by email
    const emails = validContacts.map(c => c.email);
    const existingUsers = await this.db.getUsersByEmails(emails);
    const existingByEmail = new Map(existingUsers.map(u => [u.email.toLowerCase(), u]));

    // Check for soft-deleted ghosts (opted out of emails — must not be re-created)
    const softDeletedEmails = await this.db.getSoftDeletedGhostEmails(emails);
    const softDeletedSet = new Set(softDeletedEmails.map(e => e.toLowerCase()));

    // Contacts not matched by email and not soft-deleted
    const unmatchedContacts = validContacts.filter(
      c => !existingByEmail.has(c.email) && !softDeletedSet.has(c.email)
    );

    // Name-based ghost dedup: reuse existing ghost if same name exists
    const unmatchedNames = [...new Set(unmatchedContacts.map(c => c.name))];
    const ghostsByName = await this.db.getGhostUsersByNames(unmatchedNames);
    const ghostByName = new Map(ghostsByName.map(g => [g.name.toLowerCase(), g]));

    const needGhosts: Array<{ name: string; email: string }> = [];
    for (const contact of unmatchedContacts) {
      const existingGhost = ghostByName.get(contact.name.toLowerCase());
      if (existingGhost) {
        existingByEmail.set(contact.email, {
          id: existingGhost.id, email: existingGhost.email,
          name: existingGhost.name, isGhost: true,
        });
      } else {
        needGhosts.push(contact);
      }
    }

    // Atomically create ghosts + upsert all contacts in a single transaction
    const { newContacts } = await this.db.importContactsBulk(
      ownerId,
      needGhosts,
      validContacts,
      existingByEmail,
      source
    );

    result.newContacts = newContacts;

    // Build result details (existingByEmail was updated inside the transaction with ghost IDs)
    for (const contact of validContacts) {
      const user = existingByEmail.get(contact.email);
      if (user) {
        result.details.push({
          email: contact.email,
          userId: user.id,
          isNew: !existingUsers.some(u => u.id === user.id),
        });
      }
    }
    result.imported = result.details.length;
    result.existingContacts = result.imported - result.newContacts;

    // Enqueue enrichment for newly created ghost users only.
    const newGhostDetails = result.details.filter(d => {
      const user = existingByEmail.get(d.email);
      return user?.isGhost === true && d.isNew;
    });
    if (newGhostDetails.length > 0) {
      for (const ghost of newGhostDetails) {
        await profileQueue.addEnrichGhostJob({ userId: ghost.userId });
      }
      logger.info('[ContactService] Enrichment jobs enqueued for new ghost users', {
        ghostIds: newGhostDetails.map(g => g.userId),
        count: newGhostDetails.length,
      });
    }

    logger.info('[ContactService] Import completed', {
      ownerId,
      imported: result.imported,
      skipped: result.skipped,
      newContacts: result.newContacts,
      existingContacts: result.existingContacts,
    });

    return result;
  }

  /**
   * List all contacts for a user.
   *
   * @param ownerId - The user whose contacts to list
   * @returns Array of contacts with user details
   */
  async listContacts(ownerId: string): Promise<Contact[]> {
    logger.verbose('[ContactService] Listing contacts', { ownerId });
    return this.db.getContacts(ownerId);
  }

  /**
   * Remove a contact from the user's network (soft delete).
   *
   * @param ownerId - The user removing the contact
   * @param contactId - The contact record ID to remove
   */
  async removeContact(ownerId: string, contactId: string): Promise<void> {
    logger.info('[ContactService] Removing contact', { ownerId, contactId });
    await this.db.removeContact(ownerId, contactId);
  }

  /**
   * Add a single contact manually by email.
   *
   * @param ownerId - The user adding the contact
   * @param email - Email of the contact to add
   * @param name - Optional name for the contact
   * @returns The import result for the single contact
   */
  async addContact(
    ownerId: string,
    email: string,
    name?: string
  ): Promise<ImportResult> {
    return this.importContacts(
      ownerId,
      [{ name: name || '', email }],
      'manual'
    );
  }
}

export const contactService = new ContactService();
