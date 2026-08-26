/**
 * Unit tests for OpportunityNotifier. Mocks userService, Redis, email, and events.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, beforeEach, afterAll } from 'bun:test';
import { EventEmitter } from 'events';


// Configurable mocks for notification dependencies (set in tests)
let mockGetUserForNewsletter: (id: string) => Promise<{
  email?: string;
  name?: string;
  onboarding?: { completedAt?: string };
  prefs?: { connectionUpdates?: boolean };
  unsubscribeToken?: string;
} | null> = async () => null;
let mockRedisSet: (key: string, value: string, ...args: unknown[]) => Promise<string | null> = async () => 'OK';
let mockRedisRpush = mock(async () => 1);
const mockRedisExpire = mock(async () => 'OK');
const mockEmitOpportunityNotification = mock(() => {});
const mockSendEmail = mock(async () => {});

mock.module('../../../services/user.service', () => ({
  userService: {
    getUserForNewsletter: (id: string) => mockGetUserForNewsletter(id),
  },
}));
mock.module('../../../adapters/cache.adapter', () => ({
  getRedisClient: () => ({
    set: mockRedisSet,
    rpush: mockRedisRpush,
    expire: mockRedisExpire,
  }),
}));
mock.module('../../email/transport.helper', () => ({
  executeSendEmail: (payload: unknown) => (mockSendEmail as (a: unknown) => Promise<unknown>)(payload),
}));
const _telegramEmitter = new EventEmitter();
_telegramEmitter.setMaxListeners(100);

mock.module('../../notification-events', () => ({
  emitOpportunityNotification: (opts: { opportunityId: string; recipientId: string }) =>
    (mockEmitOpportunityNotification as (opts: unknown) => void)(opts),
  emitTelegramNotification: (payload: unknown) => _telegramEmitter.emit('telegram', payload),
  onTelegramNotification: (handler: (payload: unknown) => void) => {
    _telegramEmitter.on('telegram', handler);
    return () => _telegramEmitter.off('telegram', handler);
  },
}));

afterAll(() => {
  mock.restore();
});

import { OpportunityNotifier, type NotificationJobData, type NotificationPriority, type OpportunityNotifierDatabase, notifyOpportunity } from '../opportunity-notifier';
import type { NotificationStreamEvent } from '../../notification-stream-events';
import { onTelegramNotification } from '../../notification-events';

const asNotifDb = (db: { getOpportunity: (id: string) => Promise<unknown> }): OpportunityNotifierDatabase => ({
  getOpportunity: db.getOpportunity as OpportunityNotifierDatabase['getOpportunity'],
  getTelegramPrefs: async () => null,
});

const makeOpportunity = (idOrReasoning?: string, _recipientId?: string, reasoning?: string) => ({
  id: reasoning !== undefined ? idOrReasoning ?? 'opp-1' : 'opp-1',
  interpretation: { reasoning: reasoning ?? idOrReasoning ?? 'A match for you' },
});

function makeDb(opts: {
  opportunity: ReturnType<typeof makeOpportunity>;
  telegramPrefs?: { opportunityAccepted: boolean } | null;
}) {
  return {
    getOpportunity: async (id: string) =>
      id === opts.opportunity.id ? opts.opportunity : null,
    getTelegramPrefs: async (_userId: string) =>
      opts.telegramPrefs
        ? { chatId: 'tg-chat', connectedAt: '2026-01-01T00:00:00Z', notifications: opts.telegramPrefs }
        : null,
  };
}

describe('OpportunityNotifier', () => {
  beforeEach(() => {
    mockGetUserForNewsletter = async () => null;
    mockRedisSet = async () => 'OK';
    mockRedisRpush.mockClear();
    mockRedisExpire.mockClear();
    mockEmitOpportunityNotification.mockClear();
    mockSendEmail.mockClear();
  });

  describe('processJob', () => {
    it('unknown job name logs warning', async () => {
      const queue = new OpportunityNotifier();
      await queue.processJob('unknown', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'low',
      });
    });

    it('process_opportunity_notification: opportunity not found skips', async () => {
      const getOpportunity = mock(async () => null);
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'missing',
        recipientId: 'r1',
        priority: 'low',
      });
      expect(getOpportunity).toHaveBeenCalledWith('missing');
    });

    it('priority immediate: emits WebSocket notification', async () => {
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'immediate',
      });
      expect(mockEmitOpportunityNotification).toHaveBeenCalledWith({
        opportunityId: 'o1',
        recipientId: 'r1',
      });
    });

    it('priority high: recipient no email skips email', async () => {
      mockGetUserForNewsletter = async () => ({ name: 'Bob' }); // no email
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('priority high: onboarding not completed skips email', async () => {
      mockGetUserForNewsletter = async () => ({
        email: 'a@b.com',
        name: 'Bob',
        onboarding: {},
        prefs: {},
      });
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('priority high: connectionUpdates false skips email', async () => {
      mockGetUserForNewsletter = async () => ({
        email: 'a@b.com',
        name: 'Bob',
        onboarding: { completedAt: '2024-01-01' },
        prefs: { connectionUpdates: false },
      });
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('priority high: dedupe key already set skips email', async () => {
      mockRedisSet = async () => null; // NX not set, duplicate
      mockGetUserForNewsletter = async () => ({
        email: 'a@b.com',
        name: 'Bob',
        onboarding: { completedAt: '2024-01-01' },
        prefs: {},
      });
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('priority high: sends email with unsubscribe when token present', async () => {
      mockRedisSet = async () => 'OK';
      mockGetUserForNewsletter = async () => ({
        email: 'a@b.com',
        name: 'Bob',
        onboarding: { completedAt: '2024-01-01' },
        prefs: {},
        unsubscribeToken: 'token123',
      });
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockSendEmail).toHaveBeenCalled();
      const calls = (mockSendEmail as { mock: { calls: unknown[] } }).mock.calls;
      const firstCall = calls[0];
      expect(firstCall).toBeDefined();
      expect((firstCall as unknown[])[0]).toMatchObject({ to: 'a@b.com' });
      expect((firstCall as unknown[])[0]).toHaveProperty('headers');
      expect(((firstCall as unknown[])[0] as { headers?: Record<string, string> }).headers?.['List-Unsubscribe']).toContain('token123');
    });

    it('priority high: sends email without unsubscribe when no token', async () => {
      mockGetUserForNewsletter = async () => ({
        email: 'a@b.com',
        name: 'Bob',
        onboarding: { completedAt: '2024-01-01' },
        prefs: {},
      });
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockSendEmail).toHaveBeenCalled();
      const calls = (mockSendEmail as { mock: { calls: unknown[] } }).mock.calls;
      const args = (calls[0] as unknown[])?.[0] as { headers?: unknown } | undefined;
      expect(args?.headers).toBeUndefined();
    });

    it('priority low: adds to digest', async () => {
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'low',
      });
      expect(mockRedisRpush).toHaveBeenCalled();
      expect(mockRedisExpire).toHaveBeenCalled();
    });

    it('priority low: strips unsupported affiliation claims from digest payloads', async () => {
      const getOpportunity = mock(async () => makeOpportunity(
        'Yusuf, an attendee of the Edge Esmeralda network, is a strong match.',
      ));
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });

      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'low',
      });

      expect(mockRedisRpush).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(mockRedisRpush.mock.calls[0])).not.toContain('attendee');
    });

    it('priority low: digest dedupe already set skips rpush', async () => {
      let setCalls = 0;
      mockRedisSet = async () => {
        setCalls++;
        return setCalls === 1 ? null : 'OK'; // first call (digest dedupe) returns null
      };
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'low',
      });
      expect(mockRedisRpush).not.toHaveBeenCalled();
    });

    it('priority default/unknown: treats as low and adds to digest', async () => {
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'unknown' as NotificationPriority,
      });
      expect(mockRedisRpush).toHaveBeenCalled();
    });

    it('uses summary fallback when interpretation.reasoning missing', async () => {
      const getOpportunity = mock(async () => makeOpportunity(undefined));
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'low',
      });
      expect(getOpportunity).toHaveBeenCalledWith('o1');
    });

    it('addToDigest catch: logs error when redis throws', async () => {
      mockRedisSet = async () => 'OK';
      mockRedisRpush = mock(async () => {
        throw new Error('Redis down');
      });
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new OpportunityNotifier({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'low',
      });
      // Should not throw
    });
  });

  describe('notifyOpportunity (standalone function)', () => {
    it('exported notifyOpportunity is a function', () => {
      expect(typeof notifyOpportunity).toBe('function');
    });
  });
});

describe('processOpportunityNotification — Telegram delivery', () => {
  it('emits Telegram notification when user has telegram prefs with opportunityAccepted=true', async () => {
    const opportunityId = 'opp-tg-1';
    const recipientId = 'user-tg-1';

    const received: unknown[] = [];
    const unsub = onTelegramNotification((p) => received.push(p));

    const db = makeDb({
      opportunity: makeOpportunity(opportunityId, recipientId, 'A great match'),
      telegramPrefs: { opportunityAccepted: true },
    });
    const queue = new OpportunityNotifier({ database: db as OpportunityNotifierDatabase });
    await queue.processJob('process_opportunity_notification', {
      opportunityId,
      recipientId,
      priority: 'high',
    });

    unsub();
    expect(received).toHaveLength(1);
    expect((received[0] as { userId: string }).userId).toBe(recipientId);
  });

  it('does NOT emit Telegram notification when opportunityAccepted=false', async () => {
    const received: unknown[] = [];
    const unsub = onTelegramNotification((p) => received.push(p));

    const db = makeDb({
      opportunity: makeOpportunity('opp-2', 'user-2', 'A match'),
      telegramPrefs: { opportunityAccepted: false },
    });
    const queue = new OpportunityNotifier({ database: db as OpportunityNotifierDatabase });
    await queue.processJob('process_opportunity_notification', {
      opportunityId: 'opp-2',
      recipientId: 'user-2',
      priority: 'high',
    });

    unsub();
    expect(received).toHaveLength(0);
  });

  it('does NOT emit Telegram notification when user has no telegram prefs', async () => {
    const received: unknown[] = [];
    const unsub = onTelegramNotification((p) => received.push(p));

    const db = makeDb({
      opportunity: makeOpportunity('opp-3', 'user-3', 'A match'),
      telegramPrefs: null,
    });
    const queue = new OpportunityNotifier({ database: db as OpportunityNotifierDatabase });
    await queue.processJob('process_opportunity_notification', {
      opportunityId: 'opp-3',
      recipientId: 'user-3',
      priority: 'high',
    });

    unsub();
    expect(received).toHaveLength(0);
  });
});
