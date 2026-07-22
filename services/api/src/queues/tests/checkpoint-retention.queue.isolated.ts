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

import { CheckpointRetentionCron, resolveRetentionDays, resolveBatchSize } from '../checkpoint/retention.queue';
import type { CheckpointRetentionDeps } from '../checkpoint/retention.queue';
import type { CheckpointPruneResult } from '../../adapters/checkpointer.adapter';

// ---------------------------------------------------------------------------
// helpers — an injectable stub for the delete batch
// ---------------------------------------------------------------------------
const emptyBatch: CheckpointPruneResult = { threads: 0, checkpoints: 0, blobs: 0, writes: 0 };
const mockPrune = mock(async (_opts: { retentionDays: number; batchSize: number }): Promise<CheckpointPruneResult> => emptyBatch);
const deps: CheckpointRetentionDeps = { pruneStaleCheckpointThreads: mockPrune };

const ENV_KEYS = ['CHECKPOINT_RETENTION_DAYS', 'CHECKPOINT_PRUNE_BATCH_SIZE'] as const;
const savedEnv: Record<string, string | undefined> = {};

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------
describe('checkpoint retention config', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('resolveRetentionDays', () => {
    it('defaults to 7 days when unset or blank', () => {
      expect(resolveRetentionDays(undefined)).toBe(7);
      expect(resolveRetentionDays('')).toBe(7);
      expect(resolveRetentionDays('   ')).toBe(7);
    });

    it('parses a positive number of days (floored, min 1)', () => {
      expect(resolveRetentionDays('14')).toBe(14);
      expect(resolveRetentionDays('2.9')).toBe(2);
      expect(resolveRetentionDays('0.5')).toBe(1);
    });

    it('returns null (disabled) for 0, negatives, and the disable keywords', () => {
      expect(resolveRetentionDays('0')).toBeNull();
      expect(resolveRetentionDays('-3')).toBeNull();
      for (const keyword of ['off', 'none', 'never', 'disabled', 'false', 'OFF', ' Never ']) {
        expect(resolveRetentionDays(keyword)).toBeNull();
      }
    });

    it('falls back to the default for unparseable values', () => {
      expect(resolveRetentionDays('soon')).toBe(7);
    });

    it('reads CHECKPOINT_RETENTION_DAYS when no argument is given', () => {
      process.env.CHECKPOINT_RETENTION_DAYS = '3';
      expect(resolveRetentionDays()).toBe(3);
    });
  });

  describe('resolveBatchSize', () => {
    it('defaults to 100 when unset or invalid', () => {
      expect(resolveBatchSize(undefined)).toBe(100);
      expect(resolveBatchSize('abc')).toBe(100);
      expect(resolveBatchSize('0')).toBe(100);
      expect(resolveBatchSize('-5')).toBe(100);
    });

    it('parses and clamps to [1, 1000]', () => {
      expect(resolveBatchSize('50')).toBe(50);
      expect(resolveBatchSize('5000')).toBe(1000);
      expect(resolveBatchSize('1')).toBe(1);
    });
  });
});

describe('CheckpointRetentionCron', () => {
  beforeEach(() => {
    cronCallbacks.length = 0;
    mockCronSchedule.mockClear();
    mockCronStop.mockClear();
    mockPrune.mockClear();
    mockPrune.mockImplementation(async () => emptyBatch);
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('prune', () => {
    it('returns zeros without touching the DB when retention is disabled', async () => {
      process.env.CHECKPOINT_RETENTION_DAYS = 'off';
      const cron = new CheckpointRetentionCron(deps);
      const totals = await cron.prune();
      expect(totals).toEqual({ threads: 0, checkpoints: 0, blobs: 0, writes: 0, batches: 0 });
      expect(mockPrune).not.toHaveBeenCalled();
    });

    it('passes the resolved retention window and batch size to the delete batch', async () => {
      process.env.CHECKPOINT_RETENTION_DAYS = '3';
      process.env.CHECKPOINT_PRUNE_BATCH_SIZE = '25';
      const cron = new CheckpointRetentionCron(deps);
      await cron.prune();
      expect(mockPrune).toHaveBeenCalledWith({ retentionDays: 3, batchSize: 25 });
    });

    it('stops after one batch when the batch comes back short', async () => {
      mockPrune.mockImplementation(async () => ({ threads: 4, checkpoints: 40, blobs: 80, writes: 60 }));
      const cron = new CheckpointRetentionCron(deps);
      const totals = await cron.prune();
      expect(mockPrune).toHaveBeenCalledTimes(1);
      expect(totals).toEqual({ threads: 4, checkpoints: 40, blobs: 80, writes: 60, batches: 1 });
    });

    it('keeps draining full batches and aggregates the totals', async () => {
      process.env.CHECKPOINT_PRUNE_BATCH_SIZE = '2';
      const batches: CheckpointPruneResult[] = [
        { threads: 2, checkpoints: 20, blobs: 40, writes: 30 },
        { threads: 2, checkpoints: 10, blobs: 20, writes: 15 },
        { threads: 1, checkpoints: 5, blobs: 10, writes: 5 },
      ];
      let call = 0;
      mockPrune.mockImplementation(async () => batches[call++] ?? emptyBatch);
      const cron = new CheckpointRetentionCron(deps);
      const totals = await cron.prune();
      expect(mockPrune).toHaveBeenCalledTimes(3);
      expect(totals).toEqual({ threads: 5, checkpoints: 35, blobs: 70, writes: 50, batches: 3 });
    });

    it('caps a single run at 10 batches even when every batch is full', async () => {
      process.env.CHECKPOINT_PRUNE_BATCH_SIZE = '2';
      mockPrune.mockImplementation(async () => ({ threads: 2, checkpoints: 8, blobs: 16, writes: 12 }));
      const cron = new CheckpointRetentionCron(deps);
      const totals = await cron.prune();
      expect(mockPrune).toHaveBeenCalledTimes(10);
      expect(totals.batches).toBe(10);
      expect(totals.threads).toBe(20);
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

    it('does not schedule anything when retention is disabled', () => {
      process.env.CHECKPOINT_RETENTION_DAYS = '0';
      const cron = new CheckpointRetentionCron(deps);
      cron.start();
      expect(mockCronSchedule).not.toHaveBeenCalled();
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
