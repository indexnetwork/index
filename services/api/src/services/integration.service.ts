import { log } from '../lib/log';
import { ChatDatabaseAdapter, userDatabaseAdapter } from '../adapters/database.adapter';
import { getRedisClient } from '../adapters/cache.adapter';

import type { TelegramPrefs } from '../schemas/database.schema';
import type { IntegrationAdapter, IntegrationConnection } from '../adapters/integration.adapter';

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

type Toolkit = 'gmail' | 'slack';

/**
 * Coordinates supported external integrations.
 */
export class IntegrationService {
  private db: ChatDatabaseAdapter;
  private redis: RedisWriter;
  private telegramDb: TelegramDb;

  constructor(
    private adapter: IntegrationAdapter,
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
      throw new Error('Access denied: you must be an owner of this network');
    }
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
   * @param userId - Authenticated user ID (must be network owner)
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

}
