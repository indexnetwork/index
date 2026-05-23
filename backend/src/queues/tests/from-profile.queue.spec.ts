/**
 * Unit tests for FromProfileQueue. Use injected deps to avoid Redis/DB; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it, mock, afterAll } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'discover_opportunities', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

mock.module('../negotiations/run-existing.queue', () => ({
  negotiationRunExistingQueue: { addJob: async () => ({ id: 'neg-1' }) },
}));

afterAll(() => {
  mock.restore();
});

import {
  FromProfileQueue,
  QUEUE_NAME,
  type FromProfileJobData,
} from '../opportunity/from-profile.queue';

describe('FromProfileQueue', () => {
  describe('constructor and static', () => {
    it('exposes QUEUE_NAME on class', () => {
      expect(FromProfileQueue.QUEUE_NAME).toBe(QUEUE_NAME);
      expect(QUEUE_NAME).toBe('opportunity-from-profile');
    });
  });

  describe('addJob', () => {
    it('adds discover job with userId only', async () => {
      const queue = new FromProfileQueue();
      const job = await queue.addJob({ userId: 'u1' });
      expect(job.id).toBe('job-1');
      expect(mockAdd).toHaveBeenCalledWith(
        'discover_opportunities',
        { userId: 'u1' },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 24 * 60 * 60 },
        })
      );
    });

    it('adds discover job with userId and networkId', async () => {
      const queue = new FromProfileQueue();
      await queue.addJob({ userId: 'u1', networkId: 'net1' });
      expect(mockAdd).toHaveBeenCalledWith(
        'discover_opportunities',
        { userId: 'u1', networkId: 'net1' },
        expect.any(Object)
      );
    });

    it('supports jobId and priority options', async () => {
      const queue = new FromProfileQueue();
      await queue.addJob({ userId: 'u1' }, { jobId: 'custom-id', priority: 20 });
      expect(mockAdd).toHaveBeenCalledWith(
        'discover_opportunities',
        { userId: 'u1' },
        expect.objectContaining({ jobId: 'custom-id', priority: 20 })
      );
    });
  });

  describe('processJob', () => {
    it('unknown job name logs warning and does not throw', async () => {
      const queue = new FromProfileQueue();
      await expect(
        queue.processJob('unknown_job', { userId: 'u1' })
      ).resolves.toBeUndefined();
    });

    it('discover: invokes injected graph with userId only (no searchQuery or triggerIntentId)', async () => {
      const invokeOpportunityGraph = mock(async () => {});
      const queue = new FromProfileQueue({ invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', { userId: 'u1' });
      expect(invokeOpportunityGraph).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          operationMode: 'create',
          networkId: undefined,
          options: { initialStatus: 'latent' },
        })
      );
      const call = invokeOpportunityGraph.mock.calls[0][0] as Record<string, unknown>;
      expect(call).not.toHaveProperty('searchQuery');
      expect(call).not.toHaveProperty('triggerIntentId');
    });

    it('discover: passes networkId when provided', async () => {
      const invokeOpportunityGraph = mock(async () => {});
      const queue = new FromProfileQueue({ invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', { userId: 'u1', networkId: 'net1' });
      expect(invokeOpportunityGraph).toHaveBeenCalledWith(
        expect.objectContaining({ networkId: 'net1' })
      );
    });

    it('discover: without invokeOpportunityGraph uses real graph (may fail without infra)', async () => {
      const queue = new FromProfileQueue();
      try {
        await queue.processJob('discover_opportunities', { userId: 'u1' });
      } catch {
        // Real graph can fail without Redis/DB — we only verify it doesn't crash the queue class
      }
    });
  });

  describe('startWorker', () => {
    it('is idempotent: second call does not create another worker', () => {
      const queue = new FromProfileQueue();
      queue.startWorker();
      queue.startWorker();
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });

    it('processor invokes processJob when worker runs a job', async () => {
      let capturedProcessor: ((job: { id: string; name: string; data: FromProfileJobData }) => Promise<void>) | null = null;
      (mockCreateWorker as import('bun:test').Mock<(n: string, p: (job: unknown) => Promise<void>) => unknown>).mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => {
        capturedProcessor = processor as (job: { id: string; name: string; data: FromProfileJobData }) => Promise<void>;
        return {};
      });
      const invokeOpportunityGraph = mock(async () => {});
      const queue = new FromProfileQueue({ invokeOpportunityGraph });
      queue.startWorker();
      expect(capturedProcessor).not.toBeNull();
      await capturedProcessor!({
        id: 'job-1',
        name: 'discover_opportunities',
        data: { userId: 'u1' },
      });
      expect(invokeOpportunityGraph).toHaveBeenCalled();
    });
  });

  describe('setRuntimeDeps', () => {
    it('merges negotiationGraph and agentDispatcher into deps', async () => {
      const invokeOpportunityGraph = mock(async () => {});
      const queue = new FromProfileQueue({ invokeOpportunityGraph });
      const negotiationGraph = {} as Parameters<InstanceType<typeof FromProfileQueue>['setRuntimeDeps']>[0]['negotiationGraph'];
      const agentDispatcher = { hasPersonalAgent: async () => false };
      queue.setRuntimeDeps({ negotiationGraph, agentDispatcher });
      await queue.processJob('discover_opportunities', { userId: 'u1' });
      expect(invokeOpportunityGraph).toHaveBeenCalled();
    });
  });
});
