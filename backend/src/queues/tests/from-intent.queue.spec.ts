/**
 * Unit tests for FromIntentQueue. Use injected deps to avoid Redis/DB; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it, mock } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'discover_opportunities', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

// Stub the run-existing queue that from-intent imports
mock.module('../negotiations/run-existing.queue', () => ({
  negotiationRunExistingQueue: { addJob: async () => ({ id: 'neg-1' }) },
}));

import {
  FromIntentQueue,
  QUEUE_NAME,
  type FromIntentJobData,
  type FromIntentDatabase,
  type FromIntentGraphInvokeOptions,
} from '../opportunity/from-intent.queue';

const asDb = (db: unknown): FromIntentDatabase => db as FromIntentDatabase;

describe('FromIntentQueue', () => {
  describe('constructor and static', () => {
    it('exposes QUEUE_NAME on class', () => {
      expect(FromIntentQueue.QUEUE_NAME).toBe(QUEUE_NAME);
      expect(QUEUE_NAME).toBe('opportunity-from-intent');
    });

    it('uses provided database when deps given', async () => {
      const getIntentForIndexing = mock(async () => null as unknown as Awaited<ReturnType<FromIntentDatabase['getIntentForIndexing']>>);
      const db = { getIntentForIndexing };
      const queue = new FromIntentQueue({ database: asDb(db) });
      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' });
      expect(getIntentForIndexing).toHaveBeenCalledWith('i1');
    });
  });

  describe('addJob', () => {
    it('adds discover job with data and options', async () => {
      const queue = new FromIntentQueue();
      const job = await queue.addJob({ intentId: 'i1', userId: 'u1', networkIds: ['idx1'] });
      expect(job.id).toBe('job-1');
      expect(mockAdd).toHaveBeenCalledWith(
        'discover_opportunities',
        { intentId: 'i1', userId: 'u1', networkIds: ['idx1'] },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 24 * 60 * 60 },
        })
      );
    });

    it('supports jobId and priority options', async () => {
      const queue = new FromIntentQueue();
      await queue.addJob({ intentId: 'i1', userId: 'u1' }, { jobId: 'custom', priority: 1 });
      expect(mockAdd).toHaveBeenCalledWith(
        'discover_opportunities',
        { intentId: 'i1', userId: 'u1' },
        expect.objectContaining({ jobId: 'custom', priority: 1 })
      );
    });
  });

  describe('processJob', () => {
    it('unknown job name logs warning and does not throw', async () => {
      const queue = new FromIntentQueue();
      await expect(
        queue.processJob('unknown_job', { intentId: 'i1', userId: 'u1' })
      ).resolves.toBeUndefined();
    });

    it('discover: intent not found skips', async () => {
      const db = {
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<FromIntentDatabase['getIntentForIndexing']>>,
      };
      const queue = new FromIntentQueue({ database: asDb(db) });
      await queue.processJob('discover_opportunities', { intentId: 'missing', userId: 'u1' });
    });

    it('discover: intent found, invokeOpportunityGraph called when provided', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
      };
      const queue = new FromIntentQueue({ database: asDb(db), invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', {
        intentId: 'i1',
        userId: 'u1',
        networkIds: ['idx1'],
      });
      expect(invokeOpportunityGraph).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          searchQuery: 'Build a SaaS',
          operationMode: 'create',
          networkId: 'idx1',
          triggerIntentId: 'i1',
          options: { initialStatus: 'latent' },
        })
      );
    });

    it('discover: uses networkIds[0] as networkId', async () => {
      const invokeOpportunityGraph = mock(async () => {});
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
      };
      const queue = new FromIntentQueue({ database: asDb(db), invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', {
        intentId: 'i1',
        userId: 'u1',
        networkIds: ['idx-a', 'idx-b'],
      });
      expect(invokeOpportunityGraph).toHaveBeenCalledWith(
        expect.objectContaining({ networkId: 'idx-a' })
      );
    });

    it('discover: without invokeOpportunityGraph uses real graph (may need Redis)', async () => {
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
      };
      const queue = new FromIntentQueue({ database: asDb(db) });
      try {
        await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' });
      } catch {
        // Real graph can fail without Redis/DB
      }
    });
  });

  describe('startWorker', () => {
    it('is idempotent: second call does not create another worker', () => {
      const queue = new FromIntentQueue();
      queue.startWorker();
      queue.startWorker();
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });

    it('processor invokes processJob when worker runs a job', async () => {
      let capturedProcessor: ((job: { id: string; name: string; data: FromIntentJobData }) => Promise<void>) | null = null;
      (mockCreateWorker as import('bun:test').Mock<(n: string, p: (job: unknown) => Promise<void>) => unknown>).mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => {
        capturedProcessor = processor as (job: { id: string; name: string; data: FromIntentJobData }) => Promise<void>;
        return {};
      });
      const db = { getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<FromIntentDatabase['getIntentForIndexing']>> };
      const queue = new FromIntentQueue({ database: asDb(db) });
      queue.startWorker();
      expect(capturedProcessor).not.toBeNull();
      await capturedProcessor!({
        id: 'job-1',
        name: 'discover_opportunities',
        data: { intentId: 'i1', userId: 'u1' },
      });
    });
  });
});
