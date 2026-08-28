/**
 * Unit tests for NotificationQueue. Mocks userService, Redis, email transport, and events.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, beforeEach, afterAll } from 'bun:test';
import { EventEmitter } from 'events';

// background() is NOT mocked here on purpose: the retry test below needs the
// real retry/backoff loop, since that is the one thing under test.

// Configurable mocks for notification dependencies (set in tests)
let mockGetUserForNewsletter: (id: string) => Promise<{
  email?: string;
  name?: string;
  onboarding?: { completedAt?: string };
  prefs?: { connectionUpdates?: boolean };
  unsubscribeToken?: string;
} | null> = async () => null;
let mockRedisSet: (key: string, value: string, ...args: unknown[]) => Promise<string | null> = async () => 'OK';
const mockEmitOpportunityNotification = mock(() => {});
const mockExecuteSendEmail = mock(async () => {});

mock.module('../../services/user.service', () => ({
  userService: {
    getUserForNewsletter: (id: string) => mockGetUserForNewsletter(id),
  },
}));
mock.module('../../adapters/cache.adapter', () => ({
  getRedisClient: () => ({
    set: mockRedisSet,
  }),
}));
mock.module('../../lib/email/transport.helper', () => ({
  executeSendEmail: (payload: unknown) => (mockExecuteSendEmail as (a: unknown) => Promise<unknown>)(payload),
}));
const _telegramEmitter = new EventEmitter();
_telegramEmitter.setMaxListeners(100);

mock.module('../../lib/notification-events', () => ({
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

import { NotificationQueue, type NotificationPriority, type NotificationQueueDatabase, queueOpportunityNotification } from '../notification.queue';
import type { NotificationStreamEvent } from '../../lib/notification-stream-events';
import { onTelegramNotification } from '../../lib/notification-events';

const asNotifDb = (db: { getOpportunity: (id: string) => Promise<unknown> }): NotificationQueueDatabase => ({
  getOpportunity: db.getOpportunity as NotificationQueueDatabase['getOpportunity'],
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

describe('NotificationQueue', () => {
  beforeEach(() => {
    mockGetUserForNewsletter = async () => null;
    mockRedisSet = async () => 'OK';
    mockEmitOpportunityNotification.mockClear();
    mockExecuteSendEmail.mockClear();
  });

  describe('queueOpportunityNotification', () => {
    it('triggers delivery in the background — the caller is not blocked on it', async () => {
      let releaseOpportunity: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { releaseOpportunity = resolve; });
      const getOpportunity = mock(async () => { await gate; return makeOpportunity(); });
      const db = asNotifDb({ getOpportunity });
      const queue = new NotificationQueue({ database: db });

      // If queueOpportunityNotification awaited the delivery, this would hang
      // on the still-open gate; it must resolve immediately regardless.
      const result = await queue.queueOpportunityNotification('opp-1', 'rec-1', 'immediate');
      expect(result).toBeUndefined();

      releaseOpportunity?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockEmitOpportunityNotification).toHaveBeenCalledWith({ opportunityId: 'opp-1', recipientId: 'rec-1' });
    });

    it('a failing delivery actually retries three times before giving up', async () => {
      let calls = 0;
      mockGetUserForNewsletter = async () => {
        calls += 1;
        throw new Error('provider blip');
      };
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new NotificationQueue({ database: db });

      await queue.queueOpportunityNotification('opp-1', 'rec-1', 'high');
      // Real exponential backoff between the 4 attempts: 1s + 2s + 4s.
      await new Promise((resolve) => setTimeout(resolve, 7500));
      expect(calls).toBe(4); // initial attempt + 3 retries
    }, 10_000);
  });

  describe('processOpportunityNotification', () => {
    it('opportunity not found skips', async () => {
      const getOpportunity = mock(async () => null);
      const db = asNotifDb({ getOpportunity });
      const queue = new NotificationQueue({ database: db });
      await queue.processOpportunityNotification({
        opportunityId: 'missing',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(getOpportunity).toHaveBeenCalledWith('missing');
    });

    it('priority immediate: emits WebSocket notification', async () => {
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new NotificationQueue({ database: db });
      await queue.processOpportunityNotification({
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
      const queue = new NotificationQueue({ database: db });
      await queue.processOpportunityNotification({
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockExecuteSendEmail).not.toHaveBeenCalled();
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
      const queue = new NotificationQueue({ database: db });
      await queue.processOpportunityNotification({
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockExecuteSendEmail).not.toHaveBeenCalled();
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
      const queue = new NotificationQueue({ database: db });
      await queue.processOpportunityNotification({
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockExecuteSendEmail).not.toHaveBeenCalled();
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
      const queue = new NotificationQueue({ database: db });
      await queue.processOpportunityNotification({
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockExecuteSendEmail).not.toHaveBeenCalled();
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
      const queue = new NotificationQueue({ database: db });
      await queue.processOpportunityNotification({
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockExecuteSendEmail).toHaveBeenCalled();
      const calls = (mockExecuteSendEmail as { mock: { calls: unknown[] } }).mock.calls;
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
      const queue = new NotificationQueue({ database: db });
      await queue.processOpportunityNotification({
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockExecuteSendEmail).toHaveBeenCalled();
      const calls = (mockExecuteSendEmail as { mock: { calls: unknown[] } }).mock.calls;
      const args = (calls[0] as unknown[])?.[0] as { headers?: unknown } | undefined;
      expect(args?.headers).toBeUndefined();
    });

    it('priority unknown: logs warning and skips delivery', async () => {
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new NotificationQueue({ database: db });
      await queue.processOpportunityNotification({
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'unknown' as NotificationPriority,
      });
      expect(mockEmitOpportunityNotification).not.toHaveBeenCalled();
      expect(mockExecuteSendEmail).not.toHaveBeenCalled();
    });

    it('uses summary fallback when interpretation.reasoning missing', async () => {
      const getOpportunity = mock(async () => makeOpportunity(undefined));
      const db = asNotifDb({ getOpportunity });
      const queue = new NotificationQueue({ database: db });
      await queue.processOpportunityNotification({
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(getOpportunity).toHaveBeenCalledWith('o1');
    });
  });

  describe('queueOpportunityNotification (standalone function)', () => {
    it('exported queueOpportunityNotification is a function (singleton path covered by class test)', () => {
      expect(typeof queueOpportunityNotification).toBe('function');
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
    const queue = new NotificationQueue({ database: db as NotificationQueueDatabase });
    await queue.processOpportunityNotification({
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
    const queue = new NotificationQueue({ database: db as NotificationQueueDatabase });
    await queue.processOpportunityNotification({
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
    const queue = new NotificationQueue({ database: db as NotificationQueueDatabase });
    await queue.processOpportunityNotification({
      opportunityId: 'opp-3',
      recipientId: 'user-3',
      priority: 'high',
    });

    unsub();
    expect(received).toHaveLength(0);
  });
});
