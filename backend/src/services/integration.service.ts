import { log } from '../lib/log';
import type { IntegrationAdapter } from '@indexnetwork/protocol';
import { ChatDatabaseAdapter, userDatabaseAdapter } from '../adapters/database.adapter';
import { getRedisClient } from '../adapters/cache.adapter';

import { deduplicateContacts, getPreset } from '../lib/dedup/dedup';
import { profileQueue } from '../queues/profile.queue';
import type { ContactImporter, ImportResult } from '../types/integrations.types';
import type { TelegramPrefs } from '../schemas/database.schema';
import type { IntegrationConnection } from '../adapters/integration.adapter';
import { SyncConfigSchema } from '../schemas/network.validation';

const logger = log.service.from('IntegrationService');

const CONNECT_TOKEN_PREFIX = 'telegram:connect:';
const CONNECT_TOKEN_TTL_SEC = 15 * 60;

interface RedisWriter {
  set(key: string, value: string, ex: string, ttl: number): Promise<void>;
  get(key: string): Promise<string | null>;
}

interface TelegramDb {
  getTelegramPrefs(userId: string): Promise<TelegramPrefs | null>;
  updateTelegramPrefs(userId: string, prefs: TelegramPrefs): Promise<void>;
  clearTelegramPrefs(userId: string): Promise<void>;
}

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

type Toolkit = 'gmail' | 'slack' | 'google_calendar';

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
  private redis: RedisWriter;
  private telegramDb: TelegramDb;

  constructor(
    private adapter: IntegrationAdapter,
    private contactImporter: ContactImporter,
    db?: ChatDatabaseAdapter,
    redis?: RedisWriter,
    telegramDb?: TelegramDb,
  ) {
    this.db = db ?? new ChatDatabaseAdapter();
    this.redis = redis ?? (() => {
      const r = getRedisClient();
      return {
        set: (key: string, value: string, _ex: string, ttl: number) => r.set(key, value, 'EX', ttl).then(() => undefined),
        get: (key: string) => r.get(key),
      };
    })();
    this.telegramDb = telegramDb ?? userDatabaseAdapter;
  }

  /**
   * Verify the user is an owner of the given index.
   * @throws If the user is not an owner
   */
  private async assertNetworkOwner(networkId: string, userId: string): Promise<void> {
    const isOwner = await this.db.isIndexOwner(networkId, userId);
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
   * @param networkId - Target index (uses personal index when omitted)
   * @returns Bulk import statistics
   */
  async importContacts(userId: string, toolkit: Toolkit, networkId?: string): Promise<ImportResult> {
    if (networkId) {
      await this.assertNetworkOwner(networkId, userId);
    }
    const isPersonal = !networkId || await this.db.isPersonalNetwork(networkId);

    const contacts = toolkit === 'gmail'
      ? await this.fetchGmailContacts(userId)
      : await this.fetchSlackMembers(userId);

    logger.info('Fetched contacts from provider', { userId, toolkit, count: contacts.length });

    const empty: ImportResult = { imported: 0, skipped: 0, newContacts: 0, existingContacts: 0, details: [] };
    if (contacts.length === 0) return empty;

    if (isPersonal) {
      return this.contactImporter.importContacts(userId, contacts);
    }

    const resolved = await this.contactImporter.resolveUsers(userId, contacts);
    if (resolved.userIds.length === 0) {
      return { ...empty, skipped: resolved.skipped };
    }

    const preset = getPreset(process.env.CONTACT_DEDUP_STRATEGY);
    const dedupResult = deduplicateContacts(contacts, resolved.details, preset);
    const dedupedUserIds = dedupResult.kept.map(d => d.userId);
    const nameSkipped = dedupResult.removed.length;

    if (dedupResult.removed.length > 0) {
      logger.info('[IntegrationService] Dedup removed contacts', {
        networkId,
        removed: dedupResult.removed.map(r => ({
          email: r.email,
          matchedWith: r.matchedWith,
          nameScore: r.nameScore.toFixed(3),
          emailScore: r.emailScore.toFixed(3),
        })),
      });
    }

    await this.db.addMembersBulkToIndex(networkId, dedupedUserIds);

    // Enqueue enrichment only for kept new ghosts (after dedup)
    const newGhostIdsToEnrich = dedupResult.kept
      .filter(d => d.isNew && resolved.newGhostIds.includes(d.userId))
      .map(d => d.userId);
    if (newGhostIdsToEnrich.length > 0) {
      await profileQueue.addEnrichUserJobBulk(newGhostIdsToEnrich.map(id => ({ userId: id })));
      logger.info('[IntegrationService] Enrichment jobs enqueued for new ghosts', { count: newGhostIdsToEnrich.length });
    }

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
   * @param networkId - Index to link to
   * @throws If the user has no Composio connection for the toolkit
   */
  async linkToIndex(userId: string, toolkit: string, networkId: string): Promise<void> {
    await this.assertNetworkOwner(networkId, userId);
    const connections = await this.adapter.listConnections(userId);
    const conn = connections.find(c => c.toolkit === toolkit);
    if (!conn) {
      throw new Error(`No ${toolkit} connection found for user`);
    }
    await this.db.insertIndexIntegration(networkId, toolkit, conn.id);
    logger.info('Linked integration to index', { userId, toolkit, networkId, connectedAccountId: conn.id });
  }

  /**
   * Unlink a toolkit from an index.
   * Does NOT revoke the Composio OAuth connection.
   *
   * @param toolkit - Toolkit slug
   * @param networkId - Index to unlink from
   */
  async unlinkFromIndex(userId: string, toolkit: string, networkId: string): Promise<void> {
    await this.assertNetworkOwner(networkId, userId);
    await this.db.deleteIndexIntegration(networkId, toolkit);
    logger.info('Unlinked integration from index', { toolkit, networkId });
  }

  /**
   * List all linked integrations for an index.
   *
   * @param userId - Authenticated user ID (must be index owner)
   * @param networkId - The index to query
   * @returns Array of toolkit/connectedAccountId pairs
   */
  async getLinkedIntegrations(userId: string, networkId: string): Promise<Array<{ toolkit: string; connectedAccountId: string }>> {
    await this.assertNetworkOwner(networkId, userId);
    return this.db.getNetworkIntegrations(networkId);
  }

  /**
   * List all connected accounts for a user, including a synthetic Telegram entry if connected.
   * @param userId - The authenticated user ID
   * @returns Array of integration connections (Composio + optional Telegram)
   */
  async listConnections(userId: string): Promise<IntegrationConnection[]> {
    const composioConnections = await this.adapter.listConnections(userId);
    const telegramPrefs = await this.telegramDb.getTelegramPrefs(userId);
    if (!telegramPrefs) return composioConnections;

    const telegramEntry: IntegrationConnection = {
      id: `telegram:${userId}`,
      toolkit: 'telegram',
      status: 'active',
      createdAt: telegramPrefs.connectedAt,
    };
    return [...composioConnections, telegramEntry];
  }

  /**
   * Get OAuth URL for connecting a toolkit.
   */
  async getAuthUrl(userId: string, toolkit: string, callbackUrl: string) {
    return this.adapter.getAuthUrl(userId, toolkit, callbackUrl);
  }

  /**
   * Disconnect a Composio connected account.
   */
  async disconnect(connectedAccountId: string) {
    return this.adapter.disconnect(connectedAccountId);
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
   * Configure sync settings (interval, calendarId, status) for an integration on an index.
   * The integration must already be linked via linkToIndex.
   *
   * @param userId - Authenticated user (must be index owner)
   * @param networkId - Target index
   * @param toolkit - Toolkit slug (e.g. 'google_calendar')
   * @param config - Partial sync configuration to merge
   * @throws If the user is not an owner or the toolkit is not linked
   */
  async configureSyncConfig(
    userId: string,
    networkId: string,
    toolkit: string,
    config: { calendarId?: string; intervalMs?: number; status?: 'active' | 'paused' },
  ): Promise<void> {
    await this.assertNetworkOwner(networkId, userId);
    const linked = await this.db.getNetworkIntegrations(networkId);
    const integration = linked.find(i => i.toolkit === toolkit);
    if (!integration) {
      throw new Error(`No ${toolkit} integration linked to this network`);
    }
    const validated = SyncConfigSchema.parse(config);
    await this.db.updateIntegrationSyncConfig(networkId, toolkit, validated);
    logger.info('Sync config updated', { userId, networkId, toolkit });
  }

  /**
   * Return all integrations with active sync enabled.
   * Used by the integration sync worker.
   */
  async getActiveIntegrationSyncs(): Promise<Array<{
    networkId: string;
    toolkit: string;
    connectedAccountId: string;
    syncConfig: Record<string, unknown>;
    ownerUserId: string;
  }>> {
    return this.db.getActiveIntegrationSyncs();
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
   * Generate a one-time deep link for connecting a Telegram account.
   * Stores a 15-minute Redis token mapping token → userId.
   *
   * @param userId - The Index user ID to associate with the Telegram account
   * @returns Object containing the Telegram deep link URL
   */
  async connectTelegram(userId: string): Promise<{ deepLink: string }> {
    const token = crypto.randomUUID();
    await this.redis.set(`${CONNECT_TOKEN_PREFIX}${token}`, userId, 'EX', CONNECT_TOKEN_TTL_SEC);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? '';
    return { deepLink: `https://t.me/${botUsername}?start=${token}` };
  }

  /**
   * Remove the Telegram connection for a user.
   *
   * @param userId - The Index user ID whose Telegram connection should be removed
   */
  async disconnectTelegram(userId: string): Promise<void> {
    await this.telegramDb.clearTelegramPrefs(userId);
    logger.info('Telegram disconnected', { userId });
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
