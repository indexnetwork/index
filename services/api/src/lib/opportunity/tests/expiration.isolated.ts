/**
 * Unit tests for OpportunityExpirationCron. node-cron is mocked and the persistence
 * sweep is injected via deps, so no DB/Redis/drizzle is touched.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, beforeEach, afterAll } from 'bun:test';

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
    validate: () => true,
  },
}));

afterAll(() => {
  mock.restore();
});

import { OpportunityExpirationCron } from '../expiration';
import type { OpportunityExpirationDeps } from '../expiration';

// ---------------------------------------------------------------------------
// helpers — an injectable stub for the persistence sweep
// ---------------------------------------------------------------------------
const mockExpire = mock(async () => 0);
const deps: OpportunityExpirationDeps = { expireStaleOpportunities: mockExpire };

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------
describe('OpportunityExpirationCron', () => {
  beforeEach(() => {
    cronCallbacks.length = 0;
    mockCronSchedule.mockClear();
    mockCronStop.mockClear();
    mockExpire.mockClear();
    mockExpire.mockImplementation(async () => 0);
  });

  describe('expireStale', () => {
    it('returns 0 when the adapter reports no rows updated', async () => {
      mockExpire.mockImplementation(async () => 0);
      const cron = new OpportunityExpirationCron(deps);
      const count = await cron.expireStale();
      expect(count).toBe(0);
    });

    it('returns the count the adapter reports', async () => {
      mockExpire.mockImplementation(async () => 3);
      const cron = new OpportunityExpirationCron(deps);
      const count = await cron.expireStale();
      expect(count).toBe(3);
    });

    it('delegates to deps.expireStaleOpportunities exactly once', async () => {
      const cron = new OpportunityExpirationCron(deps);
      await cron.expireStale();
      expect(mockExpire).toHaveBeenCalledTimes(1);
    });
  });

  describe('start', () => {
    it('is idempotent: calling start twice schedules only one cron task', () => {
      const cron = new OpportunityExpirationCron(deps);
      cron.start();
      cron.start();
      expect(mockCronSchedule).toHaveBeenCalledTimes(1);
    });

    it('schedules cron with a 15-minute expression', () => {
      const cron = new OpportunityExpirationCron(deps);
      cron.start();
      const expr = mockCronSchedule.mock.calls[0]?.[0] as string | undefined;
      expect(expr).toBe('*/15 * * * *');
    });

    it('cron callback does not throw when expireStale resolves', async () => {
      mockExpire.mockImplementation(async () => 2);
      cronCallbacks.length = 0;
      const cron = new OpportunityExpirationCron(deps);
      cron.start();
      expect(cronCallbacks.length).toBe(1);
      // The cron callback is fire-and-forget (.then().catch()); it returns void synchronously.
      cronCallbacks[0]();
      // Give microtasks a chance to flush
      await new Promise((r) => setTimeout(r, 10));
      expect(mockExpire).toHaveBeenCalled();
    });

    it('cron callback catches and does not rethrow when expireStale rejects', async () => {
      mockExpire.mockImplementationOnce(async () => {
        throw new Error('db down');
      });
      cronCallbacks.length = 0;
      const cron = new OpportunityExpirationCron(deps);
      cron.start();
      // The catch handler should swallow the error — no unhandled rejection
      cronCallbacks[0]();
      await new Promise((r) => setTimeout(r, 10));
      // If we reach here without an unhandled rejection, the test passes
    });
  });

  describe('stop', () => {
    it('calls task.stop() and clears the internal task reference', () => {
      const cron = new OpportunityExpirationCron(deps);
      cron.start();
      cron.stop();
      expect(mockCronStop).toHaveBeenCalledTimes(1);
    });

    it('stop() after stop() is a no-op (does not double-stop)', () => {
      const cron = new OpportunityExpirationCron(deps);
      cron.start();
      cron.stop();
      cron.stop();
      expect(mockCronStop).toHaveBeenCalledTimes(1);
    });

    it('start() after stop() re-registers a new cron task', () => {
      const cron = new OpportunityExpirationCron(deps);
      cron.start();
      cron.stop();
      mockCronSchedule.mockClear();
      cron.start();
      expect(mockCronSchedule).toHaveBeenCalledTimes(1);
    });
  });

  describe('default construction', () => {
    it('constructs without deps (wires the real OpportunityDatabaseAdapter)', () => {
      // Smoke: no-arg construction must not throw; the adapter is lazily used only on expireStale().
      const cron = new OpportunityExpirationCron();
      expect(cron).toBeInstanceOf(OpportunityExpirationCron);
    });
  });
});
