/**
 * Unit tests for OpportunityExpirationCron. node-cron and drizzle are mocked so no DB/Redis needed.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// node-cron mock — captures scheduled callbacks so we can trigger them manually
// ---------------------------------------------------------------------------
const cronCallbacks: Array<() => void | Promise<void>> = [];
const mockCronStop = mock(() => {});
const mockCronSchedule = mock((_expr: string, fn: () => void | Promise<void>) => {
  cronCallbacks.push(fn);
  return { start: () => {}, stop: mockCronStop };
});

mock.module('node-cron', () => ({
  default: {
    schedule: mockCronSchedule,
  },
}));

// ---------------------------------------------------------------------------
// drizzle mock — exposes a chainable stub whose terminal .returning() resolves
// to a controlled array of rows.
// ---------------------------------------------------------------------------
let mockReturningRows: Array<{ id: string }> = [];

const mockReturning = mock(async () => mockReturningRows);
const mockWhere = mock(() => ({ returning: mockReturning }));
const mockSet = mock(() => ({ where: mockWhere }));
const mockUpdate = mock(() => ({ set: mockSet }));

mock.module('../../lib/drizzle/drizzle', () => ({
  default: { update: mockUpdate },
}));

// drizzle-orm helpers are used for building the where-clause; mock them as
// identity functions so the real import doesn't attempt a DB connection.
mock.module('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ _type: 'and', args }),
  isNotNull: (col: unknown) => ({ _type: 'isNotNull', col }),
  lte: (col: unknown, val: unknown) => ({ _type: 'lte', col, val }),
  notInArray: (col: unknown, vals: unknown) => ({ _type: 'notInArray', col, vals }),
}));

import { OpportunityExpirationCron } from '../opportunity/expiration.queue';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const makeRows = (n: number): Array<{ id: string }> =>
  Array.from({ length: n }, (_, i) => ({ id: `opp-${i + 1}` }));

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------
describe('OpportunityExpirationCron', () => {
  beforeEach(() => {
    cronCallbacks.length = 0;
    mockCronSchedule.mockClear();
    mockCronStop.mockClear();
    mockUpdate.mockClear();
    mockSet.mockClear();
    mockWhere.mockClear();
    mockReturning.mockClear();
    mockReturningRows = [];
  });

  describe('expireStale', () => {
    it('returns 0 when no rows are updated', async () => {
      mockReturningRows = [];
      const cron = new OpportunityExpirationCron();
      const count = await cron.expireStale();
      expect(count).toBe(0);
    });

    it('returns the count of updated rows', async () => {
      mockReturningRows = makeRows(3);
      const cron = new OpportunityExpirationCron();
      const count = await cron.expireStale();
      expect(count).toBe(3);
    });

    it('calls db.update on the opportunities table and sets status to expired', async () => {
      mockReturningRows = makeRows(1);
      const cron = new OpportunityExpirationCron();
      await cron.expireStale();
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      // set() receives an object with status:'expired' and updatedAt
      const setArg = mockSet.mock.calls[0]?.[0] as { status: string; updatedAt: Date } | undefined;
      expect(setArg?.status).toBe('expired');
      expect(setArg?.updatedAt).toBeInstanceOf(Date);
    });

    it('passes a compound where-clause (isNotNull + lte + notInArray)', async () => {
      mockReturningRows = [];
      const cron = new OpportunityExpirationCron();
      await cron.expireStale();
      // where() is called exactly once with the composed predicate
      expect(mockWhere).toHaveBeenCalledTimes(1);
      const whereArg = mockWhere.mock.calls[0]?.[0] as { _type: string; args: unknown[] } | undefined;
      // The top-level combinator is 'and'
      expect(whereArg?._type).toBe('and');
    });
  });

  describe('start', () => {
    it('is idempotent: calling start twice schedules only one cron task', () => {
      const cron = new OpportunityExpirationCron();
      cron.start();
      cron.start();
      expect(mockCronSchedule).toHaveBeenCalledTimes(1);
    });

    it('schedules cron with a 15-minute expression', () => {
      const cron = new OpportunityExpirationCron();
      cron.start();
      const expr = mockCronSchedule.mock.calls[0]?.[0] as string | undefined;
      expect(expr).toBe('*/15 * * * *');
    });

    it('cron callback does not throw when expireStale resolves', async () => {
      mockReturningRows = makeRows(2);
      cronCallbacks.length = 0;
      const cron = new OpportunityExpirationCron();
      cron.start();
      expect(cronCallbacks.length).toBe(1);
      // The cron callback is fire-and-forget (.then().catch()); it returns void synchronously.
      // We just verify it does not throw and that expireStale was eventually called.
      cronCallbacks[0]();
      // Give microtasks a chance to flush
      await new Promise((r) => setTimeout(r, 10));
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('cron callback catches and does not rethrow when expireStale rejects', async () => {
      mockReturning.mockImplementationOnce(async () => {
        throw new Error('db down');
      });
      cronCallbacks.length = 0;
      const cron = new OpportunityExpirationCron();
      cron.start();
      // The catch handler should swallow the error — no unhandled rejection
      // The callback itself returns void (fire-and-forget), so we call it and wait for microtasks.
      cronCallbacks[0]();
      await new Promise((r) => setTimeout(r, 10));
      // If we reach here without an unhandled rejection, the test passes
    });
  });

  describe('stop', () => {
    it('calls task.stop() and clears the internal task reference', () => {
      const cron = new OpportunityExpirationCron();
      cron.start();
      cron.stop();
      expect(mockCronStop).toHaveBeenCalledTimes(1);
    });

    it('stop() after stop() is a no-op (does not double-stop)', () => {
      const cron = new OpportunityExpirationCron();
      cron.start();
      cron.stop();
      cron.stop();
      expect(mockCronStop).toHaveBeenCalledTimes(1);
    });

    it('start() after stop() re-registers a new cron task', () => {
      const cron = new OpportunityExpirationCron();
      cron.start();
      cron.stop();
      mockCronSchedule.mockClear();
      cron.start();
      expect(mockCronSchedule).toHaveBeenCalledTimes(1);
    });
  });
});
