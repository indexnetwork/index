/**
 * Unit tests for NegotiationRunExistingQueue. Use injected deps to avoid Redis/DB/Protocol; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it, mock } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'negotiate_existing', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

import {
  NegotiationRunExistingQueue,
  QUEUE_NAME,
  type RunExistingDeps,
  type RunExistingGraphInvokeOptions,
} from '../negotiations/run-existing.queue';

describe('NegotiationRunExistingQueue', () => {
  describe('constructor and static', () => {
    it('exposes QUEUE_NAME on class', () => {
      expect(NegotiationRunExistingQueue.QUEUE_NAME).toBe(QUEUE_NAME);
      expect(QUEUE_NAME).toBe('negotiation-run-existing');
    });
  });

  describe('addJob', () => {
    it('enqueues with job name negotiate_existing and payload preserved', async () => {
      const queue = new NegotiationRunExistingQueue();
      const job = await queue.addJob({ opportunityId: 'opp-1', userId: 'u1' });
      expect(job.id).toBe('job-1');
      expect(mockAdd).toHaveBeenCalledWith(
        'negotiate_existing',
        { opportunityId: 'opp-1', userId: 'u1' },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 24 * 60 * 60 },
        })
      );
    });
  });

  describe('processJob', () => {
    it('unknown job name logs warning and does not throw', async () => {
      const invokeOpportunityGraph = mock(async () => {});
      const queue = new NegotiationRunExistingQueue({ invokeOpportunityGraph });
      await expect(
        queue.processJob('unknown_job', { opportunityId: 'opp-1', userId: 'u1' })
      ).resolves.toBeUndefined();
      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
    });

    it('negotiate_existing: missing opportunityId skips graph invocation', async () => {
      const invokeOpportunityGraph = mock(async () => {});
      const queue = new NegotiationRunExistingQueue({ invokeOpportunityGraph });
      // Simulate a BullMQ payload that crosses JSON boundary with empty string
      await queue.processJob('negotiate_existing', { opportunityId: '', userId: 'u1' });
      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
    });

    it('negotiate_existing: missing opportunityId (undefined cast) skips graph invocation', async () => {
      const invokeOpportunityGraph = mock(async () => {});
      const queue = new NegotiationRunExistingQueue({ invokeOpportunityGraph });
      // Cast to simulate a runtime payload with missing field
      await queue.processJob('negotiate_existing', { opportunityId: undefined as unknown as string, userId: 'u1' });
      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
    });

    it('negotiate_existing: calls invokeOpportunityGraph with operationMode=negotiate_existing and correct opportunityId', async () => {
      const invokeOpportunityGraph = mock(async (_opts: RunExistingGraphInvokeOptions) => {});
      const queue = new NegotiationRunExistingQueue({ invokeOpportunityGraph });
      await queue.processJob('negotiate_existing', { opportunityId: 'opp-42', userId: 'u1' });
      expect(invokeOpportunityGraph).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          operationMode: 'negotiate_existing',
          opportunityId: 'opp-42',
          options: {},
        })
      );
    });
  });

  describe('setRuntimeDeps', () => {
    it('is idempotent and merges', () => {
      const queue = new NegotiationRunExistingQueue();
      const negotiationGraph = {} as Parameters<InstanceType<typeof NegotiationRunExistingQueue>['setRuntimeDeps']>[0]['negotiationGraph'];
      queue.setRuntimeDeps({ negotiationGraph });
      // Second call should not throw and should merge
      queue.setRuntimeDeps({ negotiationGraph });
    });

    it('merged invokeOpportunityGraph dep is used by processJob', async () => {
      const invokeOpportunityGraph = mock(async () => {});
      const queue = new NegotiationRunExistingQueue();
      queue.setRuntimeDeps({ invokeOpportunityGraph } as Partial<RunExistingDeps>);
      await queue.processJob('negotiate_existing', { opportunityId: 'opp-1', userId: 'u1' });
      expect(invokeOpportunityGraph).toHaveBeenCalled();
    });
  });

  describe('startWorker', () => {
    it('is idempotent: second call does not create another worker', () => {
      mockCreateWorker.mockClear();
      const queue = new NegotiationRunExistingQueue();
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
      const invokeOpportunityGraph = mock(async () => {});
      const queue = new NegotiationRunExistingQueue({ invokeOpportunityGraph });
      queue.startWorker();
      expect(capturedProcessor).not.toBeNull();
      await capturedProcessor!({
        id: 'job-1',
        name: 'negotiate_existing',
        data: { opportunityId: 'opp-1', userId: 'u1' },
      });
      expect(invokeOpportunityGraph).toHaveBeenCalled();
    });
  });
});
