import { log } from '../lib/log';
import type { IntegrationAdapter } from '../lib/protocol/interfaces/integration.interface';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';

import { deduplicateContacts, getPreset } from '../lib/dedup/dedup';

// TODO: fix layering violation — services should not import other services directly; use events or queues
// eslint-disable-next-line boundaries/dependencies
import { contactService, type ImportResult } from './contact.service';

const logger = log.service.from('IntegrationService');

/** A single contact entry returned by the Gmail People API. */
interface GmailContact {
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
}

/** A single member entry returned by the Slack users.list API. */
interface SlackMember {
  id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { real_name?: string; email?: string };
}

type Toolkit = 'gmail' | 'slack';

/**
 * Fetches contacts from external integration platforms and imports them
 * into a user's network via ContactService.
 *
 * @remarks Each toolkit has its own paginated fetch strategy. The service
 * normalises provider responses into `{name, email}` pairs before delegating
 * bulk import to ContactService.
 */
export class IntegrationService {
  private db: ChatDatabaseAdapter;

  constructor(private adapter: IntegrationAdapter, db?: ChatDatabaseAdapter) {
    this.db = db ?? new ChatDatabaseAdapter();
  }

  /**
   * Verify the user is an owner of the given index.
   * @throws If the user is not an owner
   */
  private async assertIndexOwner(indexId: string, userId: string): Promise<void> {
    const isOwner = await this.db.isIndexOwner(indexId, userId);
    if (!isOwner) {
      throw new Error('Access denied: you must be an owner of this index');
    }
  }

  /**
   * Fetch contacts from the given toolkit and import them into an index.
   * Personal indexes get contacts with 'contact' permission; non-personal
   * indexes get members with 'member' permission.
   *
   * @param userId - Authenticated user ID
   * @param toolkit - Which provider to import from
   * @param indexId - Target index (uses personal index when omitted)
   * @returns Bulk import statistics
   */
  async importContacts(userId: string, toolkit: Toolkit, indexId?: string): Promise<ImportResult> {
    const isPersonal = !indexId || await this.db.isPersonalIndex(indexId);

    if (!isPersonal) {
      if (!indexId) {
        throw new Error('indexId is required for non-personal import');
      }
      await this.assertIndexOwner(indexId, userId);
    }

    const contacts = toolkit === 'gmail'
      ? await this.fetchGmailContacts(userId)
      : await this.fetchSlackMembers(userId);

    logger.info('Fetched contacts from provider', { userId, toolkit, count: contacts.length });

    const empty: ImportResult = { imported: 0, skipped: 0, newContacts: 0, existingContacts: 0, details: [] };
    if (contacts.length === 0) return empty;

    if (isPersonal) {
      return contactService.importContacts(userId, contacts);
    }

    const resolved = await contactService.resolveUsers(userId, contacts);
    if (resolved.userIds.length === 0) {
      return { ...empty, skipped: resolved.skipped };
    }

    const preset = getPreset(process.env.CONTACT_DEDUP_STRATEGY);
    const dedupResult = deduplicateContacts(contacts, resolved.details, preset);
    const dedupedUserIds = dedupResult.kept.map(d => d.userId);
    const nameSkipped = dedupResult.removed.length;

    if (dedupResult.removed.length > 0) {
      logger.info('[IntegrationService] Dedup removed contacts', {
        indexId,
        removed: dedupResult.removed.map(r => ({
          email: r.email,
          matchedWith: r.matchedWith,
          nameScore: r.nameScore.toFixed(3),
          emailScore: r.emailScore.toFixed(3),
        })),
      });
    }

    await this.db.addMembersBulkToIndex(indexId, dedupedUserIds);

    const newCount = dedupResult.kept.filter(d => d.isNew).length;
    return {
      imported: dedupedUserIds.length,
      skipped: resolved.skipped + nameSkipped,
      newContacts: newCount,
      existingContacts: dedupedUserIds.length - newCount,
      details: dedupResult.kept,
    };
  }

  /**
   * Link a toolkit to an index by finding the user's Composio connection
   * and recording it in the index_integrations table.
   *
   * @param userId - User whose Composio account to look up
   * @param toolkit - Toolkit slug (e.g. 'gmail', 'slack')
   * @param indexId - Index to link to
   * @throws If the user has no Composio connection for the toolkit
   */
  async linkToIndex(userId: string, toolkit: string, indexId: string): Promise<void> {
    await this.assertIndexOwner(indexId, userId);
    const connections = await this.adapter.listConnections(userId);
    const conn = connections.find(c => c.toolkit === toolkit);
    if (!conn) {
      throw new Error(`No ${toolkit} connection found for user`);
    }
    await this.db.insertIndexIntegration(indexId, toolkit, conn.id);
    logger.info('Linked integration to index', { userId, toolkit, indexId, connectedAccountId: conn.id });
  }

  /**
   * Unlink a toolkit from an index.
   * Does NOT revoke the Composio OAuth connection.
   *
   * @param toolkit - Toolkit slug
   * @param indexId - Index to unlink from
   */
  async unlinkFromIndex(userId: string, toolkit: string, indexId: string): Promise<void> {
    await this.assertIndexOwner(indexId, userId);
    await this.db.deleteIndexIntegration(indexId, toolkit);
    logger.info('Unlinked integration from index', { toolkit, indexId });
  }

  /**
   * List all linked integrations for an index.
   *
   * @param userId - Authenticated user ID (must be index owner)
   * @param indexId - The index to query
   * @returns Array of toolkit/connectedAccountId pairs
   */
  async getLinkedIntegrations(userId: string, indexId: string): Promise<Array<{ toolkit: string; connectedAccountId: string }>> {
    await this.assertIndexOwner(indexId, userId);
    return this.db.getIndexIntegrations(indexId);
  }

  /**
   * Remove all index links for a Composio connected account.
   * Called when the user fully disconnects their Composio connection.
   *
   * @param connectedAccountId - Composio connected account ID
   */
  async cleanupConnectionLinks(connectedAccountId: string): Promise<void> {
    await this.db.deleteIndexIntegrationsByConnectedAccount(connectedAccountId);
    logger.info('Cleaned up index links for disconnected account', { connectedAccountId });
  }

  /**
   * Paginated fetch of Gmail contacts via the GMAIL_GET_CONTACTS Composio action.
   *
   * @param userId - User whose Gmail account to query
   * @returns Array of name/email pairs
   */
  async fetchGmailContacts(userId: string): Promise<Array<{ name: string; email: string }>> {
    const contacts: Array<{ name: string; email: string }> = [];
    let nextPageToken: string | undefined;

    do {
      const result = await this.adapter.executeToolAction('GMAIL_GET_CONTACTS', userId, {
        resource_name: 'people/me',
        person_fields: 'names,emailAddresses',
        include_other_contacts: true,
        ...(nextPageToken ? { pageToken: nextPageToken } : {}),
      });

      if (!result.successful) {
        logger.error('Gmail contacts fetch failed', { userId, error: result.error });
        throw new Error(`Failed to fetch Gmail contacts: ${result.error}`);
      }

      const data = result.data as { connections?: GmailContact[]; otherContacts?: GmailContact[]; nextPageToken?: string } | undefined;
      const allContacts = [
        ...(data?.connections || []),
        ...(data?.otherContacts || []),
      ];

      for (const contact of allContacts) {
        const email = contact.emailAddresses?.[0]?.value;
        if (email) {
          const name = contact.names?.[0]?.displayName || email.split('@')[0];
          contacts.push({ name, email });
        }
      }

      nextPageToken = data?.nextPageToken;
    } while (nextPageToken);

    return contacts;
  }

  /**
   * Paginated fetch of Slack workspace members via the SLACK_LIST_ALL_USERS Composio action.
   * Filters out bots and deleted users; skips members without an email.
   *
   * @param userId - User whose Slack workspace to query
   * @returns Array of name/email pairs
   */
  async fetchSlackMembers(userId: string): Promise<Array<{ name: string; email: string }>> {
    const contacts: Array<{ name: string; email: string }> = [];
    let cursor: string | undefined;

    do {
      const result = await this.adapter.executeToolAction('SLACK_LIST_ALL_USERS', userId, {
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });

      if (!result.successful) {
        logger.error('Slack members fetch failed', { userId, error: result.error });
        throw new Error(`Failed to fetch Slack members: ${result.error}`);
      }

      const data = result.data as { members?: SlackMember[]; response_metadata?: { next_cursor?: string } } | undefined;
      const members = data?.members || [];

      for (const member of members) {
        if (member.is_bot || member.deleted) continue;
        const email = member.profile?.email;
        if (!email) continue;
        const name = member.profile?.real_name || email.split('@')[0];
        contacts.push({ name, email });
      }

      cursor = data?.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return contacts;
  }
}
