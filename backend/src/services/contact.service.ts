import { log } from '../lib/log';
import { ContactDatabaseAdapter } from '../adapters/contact.database.adapter';
import { enrichmentQueue } from '../queues/enrichment.queue';
import { deduplicateContacts, getPreset } from '../lib/dedup/dedup';

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

/** Result of adding a single contact. */
export interface ContactResult {
  userId: string;
  isNew: boolean;
  isGhost: boolean;
}

/** Result of importing contacts in bulk. */
export interface ImportResult {
  imported: number;
  skipped: number;
  newContacts: number;
  existingContacts: number;
  details: Array<{ email: string; userId: string; isNew: boolean }>;
}

/** Result of resolving contacts to user IDs (without membership changes). */
export interface ResolveResult {
  /** All resolved user IDs (existing + newly created ghosts). */
  userIds: string[];
  /** IDs of users that were newly created as ghosts. */
  newGhostIds: string[];
  /** Number of input contacts that were filtered or invalid. */
  skipped: number;
  /** Per-user details. */
  details: Array<{ email: string; userId: string; isNew: boolean }>;
}

/**
 * ContactService
 *
 * Manages user contacts ("My Network") using index_members with 'contact' permission
 * on the owner's personal index.
 *
 * RESPONSIBILITIES:
 * - Add/remove contacts via index_members rows
 * - Create ghost users for contacts without existing accounts
 * - Enqueue enrichment jobs for new ghost users
 * - List and manage contacts
 */
export class ContactService {
  constructor(private db = new ContactDatabaseAdapter()) {}

  /**
   * Add a single contact by email.
   * Resolves user by email, creates a ghost if not found, upserts contact membership,
   * clears any reverse opt-out, and enqueues enrichment for new ghosts.
   *
   * @param ownerId - The user adding the contact
   * @param email - Email of the contact to add
   * @param options - Optional name and restore flag
   * @returns Result with userId, isNew, and isGhost flags
   */
  async addContact(
    ownerId: string,
    email: string,
    options: { name?: string; restore?: boolean } = {}
  ): Promise<ContactResult> {
    const normalizedEmail = email.toLowerCase().trim();
    const name = options.name?.trim() || normalizedEmail.split('@')[0];

    // Look up existing user
    let user = await this.db.getUserByEmail(normalizedEmail);
    let isNew = false;
    let isGhost: boolean;

    if (!user) {
      // Create ghost user (handles concurrency, creates profile)
      const { id: ghostId } = await this.db.createGhostUser({ name, email: normalizedEmail });

      // Re-query to get full user record
      user = await this.db.getUserByEmail(normalizedEmail);
      if (!user) {
        throw new Error(`Failed to create or find user for email: ${normalizedEmail}`);
      }
      isNew = user.id === ghostId;
      isGhost = true;
    } else {
      isGhost = user.isGhost;
    }

    // Upsert contact membership
    await this.db.upsertContactMembership(ownerId, user.id, { restore: options.restore });

    // Clear reverse opt-out
    await this.db.clearReverseOptOut(ownerId, user.id);

    // Enqueue enrichment for new ghosts
    if (isNew && isGhost) {
      await enrichmentQueue.addEnrichUserJob({ userId: user.id });
      logger.info('[ContactService] Enrichment job enqueued for new ghost', { userId: user.id });
    }

    return { userId: user.id, isNew, isGhost };
  }

  /**
   * Resolve contacts to user IDs without creating any memberships.
   * Normalizes, filters non-human, deduplicates by email, looks up existing users,
   * and creates ghost users for unknowns. Does NOT enqueue enrichment — callers
   * that apply further filtering (e.g. name-based dedup) should enqueue after filtering.
   *
   * @param ownerId - The requesting user (excluded from results)
   * @param contacts - Raw contact data (name, email)
   * @returns Resolved user IDs, new ghost IDs, skip count, and per-user details
   */
  async resolveUsers(
    ownerId: string,
    contacts: ContactInput[]
  ): Promise<ResolveResult> {
    const owner = await this.db.getUser(ownerId);
    const ownerEmail = owner?.email.toLowerCase();

    const seenEmails = new Set<string>();
    const validContacts: Array<{ name: string; email: string }> = [];
    let skipped = 0;

    for (const contact of contacts) {
      const email = contact.email.toLowerCase().trim();
      if (!email || !email.includes('@')) { skipped++; continue; }
      if (ownerEmail === email) { skipped++; continue; }
      if (seenEmails.has(email)) { skipped++; continue; }
      const name = contact.name?.trim() || '';
      if (!isHumanContact(email, name)) {
        logger.debug('[ContactService] Skipped non-human contact', { domain: email.split('@')[1] });
        skipped++;
        continue;
      }
      seenEmails.add(email);
      validContacts.push({ name: name || email.split('@')[0], email });
    }

    if (validContacts.length === 0) {
      return { userIds: [], newGhostIds: [], skipped, details: [] };
    }

    const emails = validContacts.map(c => c.email);
    const existingUsers = await this.db.getUsersByEmails(emails);
    const emailToUser = new Map(existingUsers.map(u => [u.email, u]));
    const existingEmails = new Set(existingUsers.map(u => u.email));

    const newContactData = validContacts.filter(c => !emailToUser.has(c.email));
    const createdGhosts = await this.db.createGhostUsersBulk(newContactData);
    const newGhostIds = new Set<string>();
    for (const ghost of createdGhosts) {
      if (!existingEmails.has(ghost.email)) {
        newGhostIds.add(ghost.id);
      }
      emailToUser.set(ghost.email, { ...ghost, isGhost: true });
    }

    const userIds: string[] = [];
    const details: ResolveResult['details'] = [];
    for (const vc of validContacts) {
      const user = emailToUser.get(vc.email);
      if (user) {
        userIds.push(user.id);
        details.push({ email: vc.email, userId: user.id, isNew: newGhostIds.has(user.id) });
      } else {
        skipped++;
      }
    }

    return { userIds, newGhostIds: [...newGhostIds], skipped, details };
  }

  /**
   * Import contacts in bulk using batched DB operations.
   * Resolves users, upserts contact memberships on the owner's personal index,
   * and clears reverse opt-outs.
   *
   * @param ownerId - The user importing contacts
   * @param contacts - Array of contact data (name, email)
   * @returns Import statistics and details
   */
  async importContacts(
    ownerId: string,
    contacts: ContactInput[]
  ): Promise<ImportResult> {
    logger.info('[ContactService] Importing contacts', { ownerId, count: contacts.length });

    const resolved = await this.resolveUsers(ownerId, contacts);

    if (resolved.userIds.length === 0) {
      return { imported: 0, skipped: resolved.skipped, newContacts: 0, existingContacts: 0, details: [] };
    }

    const preset = getPreset(process.env.CONTACT_DEDUP_STRATEGY);
    const dedupResult = deduplicateContacts(contacts, resolved.details, preset);
    const dedupedUserIds = dedupResult.kept.map(d => d.userId);
    const nameSkipped = dedupResult.removed.length;

    if (dedupResult.removed.length > 0) {
      logger.info('[ContactService] Dedup removed contacts', {
        ownerId,
        removed: dedupResult.removed.map(r => ({
          email: r.email,
          matchedWith: r.matchedWith,
          nameScore: r.nameScore.toFixed(3),
          emailScore: r.emailScore.toFixed(3),
        })),
      });
    }

    await this.db.upsertContactMembershipBulk(ownerId, dedupedUserIds);
    await this.db.clearReverseOptOutBulk(ownerId, dedupedUserIds);

    // Enqueue enrichment only for kept new ghosts (after dedup)
    const newGhostIdsToEnrich = dedupResult.kept
      .filter(d => d.isNew && resolved.newGhostIds.includes(d.userId))
      .map(d => d.userId);
    if (newGhostIdsToEnrich.length > 0) {
      await enrichmentQueue.addEnrichUserJobBulk(newGhostIdsToEnrich.map(id => ({ userId: id })));
      logger.info('[ContactService] Enrichment jobs enqueued for new ghosts', { count: newGhostIdsToEnrich.length });
    }

    const newCount = dedupResult.kept.filter(d => d.isNew).length;
    const result: ImportResult = {
      imported: dedupedUserIds.length,
      skipped: resolved.skipped + nameSkipped,
      newContacts: newCount,
      existingContacts: dedupedUserIds.length - newCount,
      details: dedupResult.kept,
    };

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
  async listContacts(ownerId: string): Promise<Array<{
    userId: string;
    user: { id: string; name: string; email: string; avatar: string | null; isGhost: boolean };
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
    isGhost: boolean;
  }>> {
    return this.db.searchContactMembers(ownerId, q, limit);
  }

  /**
   * Remove a contact from the user's network (hard delete from index_members).
   *
   * @param ownerId - The user removing the contact
   * @param contactUserId - The contact user ID to remove
   */
  async removeContact(ownerId: string, contactUserId: string): Promise<void> {
    logger.info('[ContactService] Removing contact', { ownerId, contactUserId });
    await this.db.hardDeleteContactMembership(ownerId, contactUserId);
  }
}

export const contactService = new ContactService();
