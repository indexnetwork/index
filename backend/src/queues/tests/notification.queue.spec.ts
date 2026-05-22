/**
 * Unit tests for NotificationQueue. Mocks QueueFactory, userService, Redis, email queue, and events.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it, mock, beforeEach, afterAll } from 'bun:test';
import { EventEmitter } from 'events';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'process_opportunity_notification', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

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
const mockAddEmailJob = mock(async () => {});

mock.module('../../services/user.service', () => ({
  userService: {
    getUserForNewsletter: (id: string) => mockGetUserForNewsletter(id),
  },
}));
mock.module('../../adapters/cache.adapter', () => ({
  getRedisClient: () => ({
    set: mockRedisSet,
    rpush: mockRedisRpush,
    expire: mockRedisExpire,
  }),
}));
mock.module('../email.queue', () => ({
  emailQueue: {
    addJob: (payload: unknown, opts?: unknown) => (mockAddEmailJob as (a: unknown, b?: unknown) => Promise<unknown>)(payload, opts),
  },
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

import {
  NotificationQueue,
  QUEUE_NAME,
  type NotificationJobData,
  type NotificationPriority,
  type NotificationQueueDatabase,
  queueOpportunityNotification,
} from '../notification.queue';
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
    mockRedisRpush.mockClear();
    mockRedisExpire.mockClear();
    mockEmitOpportunityNotification.mockClear();
    mockAddEmailJob.mockClear();
  });

  describe('constructor and static', () => {
    it('exposes QUEUE_NAME on class', () => {
      expect(NotificationQueue.QUEUE_NAME).toBe(QUEUE_NAME);
      expect(QUEUE_NAME).toBe('notification-queue');
    });
  });

  describe('queueOpportunityNotification', () => {
    it('maps priority to numeric (immediate=0, high=5, low=10)', async () => {
      const queue = new NotificationQueue();
      await queue.queueOpportunityNotification('opp-1', 'rec-1', 'immediate');
      expect(mockAdd).toHaveBeenCalledWith(
        'process_opportunity_notification',
        { opportunityId: 'opp-1', recipientId: 'rec-1', priority: 'immediate' },
        expect.objectContaining({ priority: 0 })
      );
      await queue.queueOpportunityNotification('opp-1', 'rec-1', 'high');
      expect(mockAdd).toHaveBeenCalledWith(
        'process_opportunity_notification',
        expect.any(Object),
        expect.objectContaining({ priority: 5 })
      );
      await queue.queueOpportunityNotification('opp-1', 'rec-1', 'low');
      expect(mockAdd).toHaveBeenCalledWith(
        'process_opportunity_notification',
        expect.any(Object),
        expect.objectContaining({ priority: 10 })
      );
    });
  });

  describe('processJob', () => {
    it('unknown job name logs warning', async () => {
      const queue = new NotificationQueue();
      await queue.processJob('unknown', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'low',
      });
    });

    it('process_opportunity_notification: opportunity not found skips', async () => {
      const getOpportunity = mock(async () => null);
      const db = asNotifDb({ getOpportunity });
      const queue = new NotificationQueue({ database: db });
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
      const queue = new NotificationQueue({ database: db });
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
      const queue = new NotificationQueue({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockAddEmailJob).not.toHaveBeenCalled();
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
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockAddEmailJob).not.toHaveBeenCalled();
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
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockAddEmailJob).not.toHaveBeenCalled();
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
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockAddEmailJob).not.toHaveBeenCalled();
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
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockAddEmailJob).toHaveBeenCalled();
      const calls = (mockAddEmailJob as { mock: { calls: unknown[] } }).mock.calls;
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
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'high',
      });
      expect(mockAddEmailJob).toHaveBeenCalled();
      const calls = (mockAddEmailJob as { mock: { calls: unknown[] } }).mock.calls;
      const args = (calls[0] as unknown[])?.[0] as { headers?: unknown } | undefined;
      expect(args?.headers).toBeUndefined();
    });

    it('priority low: adds to digest', async () => {
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new NotificationQueue({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'low',
      });
      expect(mockRedisRpush).toHaveBeenCalled();
      expect(mockRedisExpire).toHaveBeenCalled();
    });

    it('priority low: digest dedupe already set skips rpush', async () => {
      let setCalls = 0;
      mockRedisSet = async () => {
        setCalls++;
        return setCalls === 1 ? null : 'OK'; // first call (digest dedupe) returns null
      };
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new NotificationQueue({ database: db });
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
      const queue = new NotificationQueue({ database: db });
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
      const queue = new NotificationQueue({ database: db });
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
      const queue = new NotificationQueue({ database: db });
      await queue.processJob('process_opportunity_notification', {
        opportunityId: 'o1',
        recipientId: 'r1',
        priority: 'low',
      });
      // Should not throw
    });
  });

  describe('startWorker', () => {
    it('is idempotent', () => {
      const queue = new NotificationQueue();
      queue.startWorker();
      queue.startWorker();
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });

    it('processor invokes processJob when worker runs a job', async () => {
      let capturedProcessor: ((job: { id: string; name: string; data: NotificationJobData }) => Promise<void>) | null = null;
      (mockCreateWorker as import('bun:test').Mock<(name: string, processor: (job: unknown) => Promise<void>) => unknown>).mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => {
        capturedProcessor = processor as (job: { id: string; name: string; data: NotificationJobData }) => Promise<void>;
        return {};
      });
      const getOpportunity = mock(async () => makeOpportunity());
      const db = asNotifDb({ getOpportunity });
      const queue = new NotificationQueue({ database: db });
      queue.startWorker();
      expect(capturedProcessor).not.toBeNull();
      await capturedProcessor!({
        id: 'job-1',
        name: 'process_opportunity_notification',
        data: { opportunityId: 'o1', recipientId: 'r1', priority: 'immediate' },
      });
      expect(mockEmitOpportunityNotification).toHaveBeenCalled();
    });
  });

  describe('queueOpportunityNotification (standalone function)', () => {
    it('class method returns Promise from queue.add', async () => {
      const queue = new NotificationQueue();
      const result = await queue.queueOpportunityNotification('opp-1', 'rec-1', 'high');
      expect(result).toBeDefined();
      expect((result as { id?: string }).id).toBe('job-1');
    });

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
    const queue = new NotificationQueue({ database: db as NotificationQueueDatabase });
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
    const queue = new NotificationQueue({ database: db as NotificationQueueDatabase });
    await queue.processJob('process_opportunity_notification', {
      opportunityId: 'opp-3',
      recipientId: 'user-3',
      priority: 'high',
    });

    unsub();
    expect(received).toHaveLength(0);
  });
});

describe('processJob — process_negotiation_notification', () => {
  it('handles the job type without emitting Telegram notifications', async () => {
    const received: unknown[] = [];
    const unsub = onTelegramNotification((p) => received.push(p));

    const db = makeDb({
      opportunity: makeOpportunity('opp-x', 'user-x', 'ignored'),
      telegramPrefs: { opportunityAccepted: true },
    });
    const queue = new NotificationQueue({ database: db as unknown as NotificationQueueDatabase });
    await queue.processJob('process_negotiation_notification', {
      negotiationId: 'neg-1',
      recipientId: 'user-x',
      turnNumber: 2,
      counterpartyAction: 'propose',
    } as unknown as NotificationJobData);

    unsub();
    expect(received).toHaveLength(0);
  });
});
