import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeEach } from 'bun:test';
import { IntegrationService } from '../integration.service';
import type { TelegramPrefs } from '../../schemas/database.schema';

process.env.TELEGRAM_BOT_USERNAME = 'TestIndexBot';

// ── Fakes ─────────────────────────────────────────────────────────────────

const redisFake = new Map<string, { value: string; ttl: number }>();
const telegramPrefsFake = new Map<string, TelegramPrefs>();

function makeService() {
  return new IntegrationService(
    // Composio adapter fake — minimal
    {
      listConnections: async () => [],
      getAuthUrl: async () => ({ redirectUrl: '' }),
      disconnect: async () => ({ success: true }),
    } as any,
    // Contact importer fake
    { importContacts: async () => ({ imported: 0, skipped: 0, newContacts: 0, existingContacts: 0, details: [] }), resolveUsers: async () => ({ userIds: [], skipped: 0, details: [] }) } as any,
    // db (ChatDatabaseAdapter) — pass undefined to use default
    undefined,
    // redis injectable
    {
      set: async (key: string, value: string, _ex: string, ttl: number) => { redisFake.set(key, { value, ttl }); },
      get: async (key: string) => redisFake.get(key)?.value ?? null,
    },
    // telegramDb injectable
    {
      getTelegramPrefs: async (userId: string) => telegramPrefsFake.get(userId) ?? null,
      updateTelegramPrefs: async (userId: string, prefs: TelegramPrefs) => { telegramPrefsFake.set(userId, prefs); },
      clearTelegramPrefs: async (userId: string) => { telegramPrefsFake.delete(userId); },
    },
  );
}

describe('IntegrationService.connectTelegram', () => {
  beforeEach(() => { redisFake.clear(); telegramPrefsFake.clear(); });

  it('returns a deep link with the bot username', async () => {
    const service = makeService();
    const result = await service.connectTelegram('user-1');
    expect(result.deepLink).toContain('t.me/TestIndexBot?start=');
  });

  it('stores the userId in Redis with 15-minute TTL', async () => {
    const service = makeService();
    const { deepLink } = await service.connectTelegram('user-1');
    const token = deepLink.split('start=')[1];
    const stored = redisFake.get(`telegram:connect:${token}`);
    expect(stored?.value).toBe('user-1');
    expect(stored?.ttl).toBe(900);
  });
});

describe('IntegrationService.disconnectTelegram', () => {
  beforeEach(() => { telegramPrefsFake.clear(); });

  it('clears telegram prefs for the user', async () => {
    telegramPrefsFake.set('user-1', {
      chatId: '123',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    });
    const service = makeService();
    await service.disconnectTelegram('user-1');
    expect(telegramPrefsFake.has('user-1')).toBe(false);
  });
});

describe('IntegrationService.listConnections', () => {
  beforeEach(() => { telegramPrefsFake.clear(); });

  it('returns a synthetic Telegram entry when connected', async () => {
    telegramPrefsFake.set('user-1', {
      chatId: '123',
      connectedAt: '2026-04-14T10:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    });
    const service = makeService();
    const connections = await service.listConnections('user-1');
    const telegram = connections.find((c) => c.toolkit === 'telegram');
    expect(telegram).toBeDefined();
    expect(telegram?.status).toBe('active');
    expect(telegram?.id).toContain('telegram:');
  });

  it('omits Telegram entry when not connected', async () => {
    const service = makeService();
    const connections = await service.listConnections('user-1');
    expect(connections.find((c) => c.toolkit === 'telegram')).toBeUndefined();
  });
});
