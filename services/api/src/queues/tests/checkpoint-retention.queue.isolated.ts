/**
 * Unit tests for CheckpointRetentionCron. node-cron is mocked and the delete
 * batch is injected via deps, so no DB/Redis/drizzle is touched.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, beforeEach, afterEach, afterAll } from 'bun:test';

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

import { BATCH_SIZE, CheckpointRetentionCron } from '../checkpoint/retention.queue';
import type { CheckpointRetentionDeps } from '../checkpoint/retention.queue';
import type { CheckpointPruneResult } from '../../adapters/checkpointer.adapter';

// ---------------------------------------------------------------------------
// helpers — an injectable stub for the delete batch
// ---------------------------------------------------------------------------
const emptyBatch: CheckpointPruneResult = { threads: 0, checkpoints: 0, blobs: 0, writes: 0 };
const mockPrune = mock(async (_opts: { retentionDays: number; batchSize: number }): Promise<CheckpointPruneResult> => emptyBatch);
const deps: CheckpointRetentionDeps = { pruneStaleCheckpointThreads: mockPrune };


// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------
describe('CheckpointRetentionCron', () => {
  beforeEach(() => {
    cronCallbacks.length = 0;
    mockCronSchedule.mockClear();
    mockCronStop.mockClear();
    mockPrune.mockClear();
    mockPrune.mockImplementation(async () => emptyBatch);
  });

  describe('prune', () => {
    it('passes the retention window and batch size to the delete batch', async () => {
      const cron = new CheckpointRetentionCron(deps);
      await cron.prune();
      expect(mockPrune).toHaveBeenCalledWith({ retentionDays: 7, batchSize: BATCH_SIZE });
    });

    it('stops after one batch when the batch comes back short', async () => {
      mockPrune.mockImplementation(async () => ({ threads: 4, checkpoints: 40, blobs: 80, writes: 60 }));
      const cron = new CheckpointRetentionCron(deps);
      const totals = await cron.prune();
      expect(mockPrune).toHaveBeenCalledTimes(1);
      expect(totals).toEqual({ threads: 4, checkpoints: 40, blobs: 80, writes: 60, batches: 1 });
    });

    it('keeps draining full batches and aggregates the totals', async () => {
      const batches: CheckpointPruneResult[] = [
        { threads: BATCH_SIZE, checkpoints: 20, blobs: 40, writes: 30 },
        { threads: BATCH_SIZE, checkpoints: 10, blobs: 20, writes: 15 },
        { threads: 1, checkpoints: 5, blobs: 10, writes: 5 },
      ];
      let call = 0;
      mockPrune.mockImplementation(async () => batches[call++] ?? emptyBatch);
      const cron = new CheckpointRetentionCron(deps);
      const totals = await cron.prune();
      expect(mockPrune).toHaveBeenCalledTimes(3);
      expect(totals).toEqual({
        threads: BATCH_SIZE * 2 + 1, checkpoints: 35, blobs: 70, writes: 50, batches: 3,
      });
    });

    it('caps a single run at 10 batches even when every batch is full', async () => {
      mockPrune.mockImplementation(async () => ({ threads: BATCH_SIZE, checkpoints: 8, blobs: 16, writes: 12 }));
      const cron = new CheckpointRetentionCron(deps);
      const totals = await cron.prune();
      expect(mockPrune).toHaveBeenCalledTimes(10);
      expect(totals.batches).toBe(10);
      expect(totals.threads).toBe(BATCH_SIZE * 10);
    });
  });

  describe('start', () => {
    it('is idempotent: calling start twice schedules only one cron task', () => {
      const cron = new CheckpointRetentionCron(deps);
      cron.start();
      cron.start();
      expect(mockCronSchedule).toHaveBeenCalledTimes(1);
    });

    it('schedules cron with an hourly expression', () => {
      const cron = new CheckpointRetentionCron(deps);
      cron.start();
      const expr = mockCronSchedule.mock.calls[0]?.[0] as string | undefined;
      expect(expr).toBe('43 * * * *');
    });

    it('cron callback runs prune when triggered', async () => {
      mockPrune.mockImplementation(async () => ({ threads: 1, checkpoints: 2, blobs: 3, writes: 4 }));
      const cron = new CheckpointRetentionCron(deps);
      cron.start();
      expect(cronCallbacks.length).toBe(1);
      cronCallbacks[0]();
      await new Promise((r) => setTimeout(r, 10));
      expect(mockPrune).toHaveBeenCalled();
    });

    it('cron callback catches and does not rethrow when prune rejects', async () => {
      mockPrune.mockImplementationOnce(async () => {
        throw new Error('db down');
      });
      const cron = new CheckpointRetentionCron(deps);
      cron.start();
      // The catch handler should swallow the error — no unhandled rejection
      cronCallbacks[0]();
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  describe('stop', () => {
    it('calls task.stop() and clears the internal task reference', () => {
      const cron = new CheckpointRetentionCron(deps);
      cron.start();
      cron.stop();
      expect(mockCronStop).toHaveBeenCalledTimes(1);
    });

    it('stop() after stop() is a no-op (does not double-stop)', () => {
      const cron = new CheckpointRetentionCron(deps);
      cron.start();
      cron.stop();
      cron.stop();
      expect(mockCronStop).toHaveBeenCalledTimes(1);
    });

    it('start() after stop() re-registers a new cron task', () => {
      const cron = new CheckpointRetentionCron(deps);
      cron.start();
      cron.stop();
      mockCronSchedule.mockClear();
      cron.start();
      expect(mockCronSchedule).toHaveBeenCalledTimes(1);
    });
  });

  describe('default construction', () => {
    it('constructs without deps (wires the real pruneStaleCheckpointThreads)', () => {
      // Smoke: no-arg construction must not throw; the adapter is lazily used only on prune().
      const cron = new CheckpointRetentionCron();
      expect(cron).toBeInstanceOf(CheckpointRetentionCron);
    });
  });
});
