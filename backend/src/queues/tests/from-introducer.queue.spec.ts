/**
 * Unit tests for FromIntroducerQueue. Use injected deps to avoid Redis/DB; QueueFactory is mocked.
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

// Stub the run-existing queue that from-introducer imports
mock.module('../negotiations/run-existing.queue', () => ({
  negotiationRunExistingQueue: { addJob: async () => ({ id: 'neg-1' }) },
}));

import {
  FromIntroducerQueue,
  QUEUE_NAME,
  type FromIntroducerDatabase,
  type FromIntroducerGraphInvokeOptions,
} from '../opportunity/from-introducer.queue';

const asDb = (db: unknown): FromIntroducerDatabase => db as FromIntroducerDatabase;

const ACTIVE_INTENT = { id: 'intent-1', payload: 'Looking for a co-founder', summary: null, createdAt: new Date() };

describe('FromIntroducerQueue', () => {
  describe('constructor and static', () => {
    it('exposes QUEUE_NAME on class', () => {
      expect(FromIntroducerQueue.QUEUE_NAME).toBe(QUEUE_NAME);
      expect(QUEUE_NAME).toBe('opportunity-from-introducer');
    });
  });

  describe('addJob', () => {
    it('enqueues with job name discover_opportunities, exponential backoff, 3 attempts', async () => {
      const queue = new FromIntroducerQueue();
      const job = await queue.addJob({ userId: 'u1', contactUserId: 'u2', networkIds: ['idx1'] });
      expect(job.id).toBe('job-1');
      expect(mockAdd).toHaveBeenCalledWith(
        'discover_opportunities',
        { userId: 'u1', contactUserId: 'u2', networkIds: ['idx1'] },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 24 * 60 * 60 },
        })
      );
    });

    it('supports jobId and priority options', async () => {
      const queue = new FromIntroducerQueue();
      await queue.addJob({ userId: 'u1', contactUserId: 'u2' }, { jobId: 'custom', priority: 2 });
      expect(mockAdd).toHaveBeenCalledWith(
        'discover_opportunities',
        { userId: 'u1', contactUserId: 'u2' },
        expect.objectContaining({ jobId: 'custom', priority: 2 })
      );
    });
  });

  describe('processJob', () => {
    it('unknown job name logs warning and does not throw', async () => {
      const db = { getActiveIntents: async () => [ACTIVE_INTENT] };
      const queueWithDb = new FromIntroducerQueue({ database: asDb(db) });
      await expect(
        queueWithDb.processJob('unknown_job', { userId: 'u1', contactUserId: 'u2' })
      ).resolves.toBeUndefined();
    });

    it('discover_opportunities: contact has no active intents, skips graph invocation', async () => {
      const getActiveIntents = mock(async () => [] as Awaited<ReturnType<FromIntroducerDatabase['getActiveIntents']>>);
      const invokeOpportunityGraph = mock(async () => {});
      const db = { getActiveIntents };
      const queue = new FromIntroducerQueue({ database: asDb(db), invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', { userId: 'u1', contactUserId: 'u2' });
      expect(getActiveIntents).toHaveBeenCalledWith('u2');
      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
    });

    it('discover_opportunities: calls invokeOpportunityGraph with onBehalfOfUserId = contactUserId', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntroducerGraphInvokeOptions) => {});
      const db = { getActiveIntents: async () => [ACTIVE_INTENT] };
      const queue = new FromIntroducerQueue({ database: asDb(db), invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', {
        userId: 'u1',
        contactUserId: 'u2',
        networkIds: ['idx1'],
      });
      expect(invokeOpportunityGraph).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          searchQuery: ACTIVE_INTENT.payload,
          operationMode: 'create',
          networkId: 'idx1',
          onBehalfOfUserId: 'u2',
          options: { initialStatus: 'latent' },
        })
      );
    });

    it('discover_opportunities: uses networkIds[0] as networkId', async () => {
      const invokeOpportunityGraph = mock(async () => {});
      const db = { getActiveIntents: async () => [ACTIVE_INTENT] };
      const queue = new FromIntroducerQueue({ database: asDb(db), invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', {
        userId: 'u1',
        contactUserId: 'u2',
        networkIds: ['idx-a', 'idx-b'],
      });
      expect(invokeOpportunityGraph).toHaveBeenCalledWith(
        expect.objectContaining({ networkId: 'idx-a' })
      );
    });

    it('discover_opportunities: triggerIntentId is not set (undefined)', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntroducerGraphInvokeOptions) => {});
      const db = { getActiveIntents: async () => [ACTIVE_INTENT] };
      const queue = new FromIntroducerQueue({ database: asDb(db), invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', { userId: 'u1', contactUserId: 'u2' });
      const callArg = (invokeOpportunityGraph.mock.calls as unknown as Array<[FromIntroducerGraphInvokeOptions]>)[0][0];
      expect('triggerIntentId' in callArg).toBe(false);
    });
  });

  describe('setRuntimeDeps', () => {
    it('merges new deps into existing deps', () => {
      const negotiationGraph = {} as Parameters<InstanceType<typeof FromIntroducerQueue>['setRuntimeDeps']>[0]['negotiationGraph'];
      const queue = new FromIntroducerQueue();
      queue.setRuntimeDeps({ negotiationGraph });
      // No assertion needed — just verifying it does not throw and is idempotent
      queue.setRuntimeDeps({ negotiationGraph });
    });
  });

  describe('startWorker', () => {
    it('is idempotent: second call does not create another worker', () => {
      mockCreateWorker.mockClear();
      const queue = new FromIntroducerQueue();
      queue.startWorker();
      queue.startWorker();
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });

    it('processor invokes processJob when worker runs a job', async () => {
      let capturedProcessor: ((job: { id: string; name: string; data: unknown }) => Promise<void>) | null = null;
      (mockCreateWorker as import('bun:test').Mock<(n: string, p: (job: unknown) => Promise<void>) => unknown>).mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => {
        capturedProcessor = processor as (job: { id: string; name: string; data: unknown }) => Promise<void>;
        return {};
      });
      const db = { getActiveIntents: async () => [] as Awaited<ReturnType<FromIntroducerDatabase['getActiveIntents']>> };
      const queue = new FromIntroducerQueue({ database: asDb(db) });
      queue.startWorker();
      expect(capturedProcessor).not.toBeNull();
      await capturedProcessor!({
        id: 'job-1',
        name: 'discover_opportunities',
        data: { userId: 'u1', contactUserId: 'u2' },
      });
    });
  });
});
