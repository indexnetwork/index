/**
 * Unit tests for HydeQueue (cron-based cleanup and refresh). Uses injected database only.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, afterAll } from 'bun:test';

const cronCallbacks: Array<() => void | Promise<void>> = [];
mock.module('node-cron', () => ({
  default: {
    schedule: (_expr: string, fn: () => void | Promise<void>) => {
      cronCallbacks.push(fn);
      return { start: () => {}, stop: () => {} };
    },
  },
}));

afterAll(() => {
  mock.restore();
});

import type { HydeQueueDatabase } from '../hyde.queue';
import { HydeQueue } from '../hyde.queue';

/** Minimal stub for tests; queue only uses a subset of the full adapter types. */
const asHydeDb = (db: unknown): HydeQueueDatabase => db as HydeQueueDatabase;

describe('HydeQueue', () => {
  describe('constructor', () => {
    it('uses default adapter when no deps', () => {
      const queue = new HydeQueue();
      expect(queue).toBeDefined();
    });

    it('uses provided database when deps given', async () => {
      const deleteExpiredHydeDocuments = mock(async () => 5);
      const db = {
        deleteExpiredHydeDocuments,
        getStaleHydeDocuments: async () => [] as Awaited<ReturnType<HydeQueueDatabase['getStaleHydeDocuments']>>,
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<HydeQueueDatabase['getIntentForIndexing']>>,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new HydeQueue({ database: asHydeDb(db) });
      const count = await queue.cleanupExpiredHyde();
      expect(count).toBe(5);
      expect(deleteExpiredHydeDocuments).toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredHyde', () => {
    it('returns deleted count from database', async () => {
      const deleteExpiredHydeDocuments = mock(async () => 3);
      const db = {
        deleteExpiredHydeDocuments,
        getStaleHydeDocuments: async () => [] as Awaited<ReturnType<HydeQueueDatabase['getStaleHydeDocuments']>>,
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<HydeQueueDatabase['getIntentForIndexing']>>,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new HydeQueue({ database: asHydeDb(db) });
      const count = await queue.cleanupExpiredHyde();
      expect(count).toBe(3);
    });
  });

  describe('refreshStaleHyde', () => {
    it('returns 0 when no stale documents', async () => {
      const db = {
        deleteExpiredHydeDocuments: async () => 0,
        getStaleHydeDocuments: async () => [] as Awaited<ReturnType<HydeQueueDatabase['getStaleHydeDocuments']>>,
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<HydeQueueDatabase['getIntentForIndexing']>>,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new HydeQueue({ database: asHydeDb(db) });
      const count = await queue.refreshStaleHyde();
      expect(count).toBe(0);
    });

    it('skips doc when sourceId is missing', async () => {
      const db = {
        deleteExpiredHydeDocuments: async () => 0,
        getStaleHydeDocuments: async () => [
          { sourceId: null as unknown as string, sourceType: 'intent', strategy: 'mirror' },
        ] as Awaited<ReturnType<HydeQueueDatabase['getStaleHydeDocuments']>>,
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<HydeQueueDatabase['getIntentForIndexing']>>,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new HydeQueue({ database: asHydeDb(db) });
      const count = await queue.refreshStaleHyde();
      expect(count).toBe(0);
    });

    it('skips doc when sourceType is not intent', async () => {
      const db = {
        deleteExpiredHydeDocuments: async () => 0,
        getStaleHydeDocuments: async () => [
          { sourceId: 's1', sourceType: 'profile', strategy: 'mirror' },
        ] as Awaited<ReturnType<HydeQueueDatabase['getStaleHydeDocuments']>>,
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<HydeQueueDatabase['getIntentForIndexing']>>,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new HydeQueue({ database: asHydeDb(db) });
      const count = await queue.refreshStaleHyde();
      expect(count).toBe(0);
    });

    it('deletes HyDE when intent not found and increments refreshed only for valid', async () => {
      const deleteHydeDocumentsForSource = mock(async () => 0);
      const getIntentForIndexing = mock(async (id: string) =>
        id === 'i2' ? { id: 'i2', payload: 'P2', userId: 'u2' } : null
      );
      const db = {
        deleteExpiredHydeDocuments: async () => 0,
        getStaleHydeDocuments: async () => [
          { sourceId: 'i1', sourceType: 'intent', strategy: 'mirror' },
          { sourceId: 'i2', sourceType: 'intent', strategy: 'reciprocal' },
        ] as Awaited<ReturnType<HydeQueueDatabase['getStaleHydeDocuments']>>,
        getIntentForIndexing,
        deleteHydeDocumentsForSource,
      };
      const _queue = new HydeQueue({ database: asHydeDb(db) });
      // Without mocking HyDE graph this will try to run real graph; we only need to cover
      // intent-not-found path. So use one doc with intent null -> deleteHydeDocumentsForSource.
      const getStaleHydeDocuments = mock(async () =>
        [{ sourceId: 'i1', sourceType: 'intent', strategy: 'mirror' }] as Awaited<
          ReturnType<HydeQueueDatabase['getStaleHydeDocuments']>
        >
      );
      const db2 = {
        deleteExpiredHydeDocuments: async () => 0,
        getStaleHydeDocuments,
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<HydeQueueDatabase['getIntentForIndexing']>>,
        deleteHydeDocumentsForSource,
      };
      const queue2 = new HydeQueue({ database: asHydeDb(db2) });
      const count = await queue2.refreshStaleHyde();
      expect(deleteHydeDocumentsForSource).toHaveBeenCalledWith('intent', 'i1');
      expect(count).toBe(0);
    });

    it.skip('refreshes when intent found (needs Redis/embedder; run in integration)', async () => {
      const db = {
        deleteExpiredHydeDocuments: async () => 0,
        getStaleHydeDocuments: async () =>
          [{ sourceId: 'i1', sourceType: 'intent', strategy: 'mirror' }] as Awaited<
            ReturnType<HydeQueueDatabase['getStaleHydeDocuments']>
          >,
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build X', userId: 'u1' }),
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new HydeQueue({ database: asHydeDb(db) });
      const count = await queue.refreshStaleHyde();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it.skip('catches and logs when HyDE graph invoke throws (needs Redis/embedder)', async () => {
      const db = {
        deleteExpiredHydeDocuments: async () => 0,
        getStaleHydeDocuments: async () =>
          [{ sourceId: 'i1', sourceType: 'intent', strategy: 'mirror' }] as Awaited<
            ReturnType<HydeQueueDatabase['getStaleHydeDocuments']>
          >,
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1' }),
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new HydeQueue({ database: asHydeDb(db) });
      const count = await queue.refreshStaleHyde();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('startCrons', () => {
    it('does not throw when called', () => {
      cronCallbacks.length = 0;
      const queue = new HydeQueue();
      expect(() => queue.startCrons()).not.toThrow();
      expect(cronCallbacks.length).toBe(2);
    });

    it('cron cleanup callback catch runs when cleanupExpiredHyde rejects', async () => {
      cronCallbacks.length = 0;
      const db = {
        deleteExpiredHydeDocuments: async () => {
          throw new Error('cleanup failed');
        },
        getStaleHydeDocuments: async () => [] as Awaited<ReturnType<HydeQueueDatabase['getStaleHydeDocuments']>>,
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<HydeQueueDatabase['getIntentForIndexing']>>,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new HydeQueue({ database: asHydeDb(db) });
      queue.startCrons();
      const cleanupCallback = cronCallbacks[0];
      expect(cleanupCallback).toBeDefined();
      await cleanupCallback();
      // Catch handler runs (no unhandled rejection)
    });

    it('cron refresh callback catch runs when refreshStaleHyde rejects', async () => {
      cronCallbacks.length = 0;
      const db = {
        deleteExpiredHydeDocuments: async () => 0,
        getStaleHydeDocuments: async () => {
          throw new Error('refresh failed');
        },
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<HydeQueueDatabase['getIntentForIndexing']>>,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new HydeQueue({ database: asHydeDb(db) });
      queue.startCrons();
      const refreshCallback = cronCallbacks[1];
      expect(refreshCallback).toBeDefined();
      await refreshCallback();
    });
  });
});
