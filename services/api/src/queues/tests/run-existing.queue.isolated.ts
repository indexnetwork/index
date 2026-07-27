/**
 * Unit tests for NegotiationRunExistingQueue. Use injected deps to avoid Redis/DB/Protocol; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, afterAll } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'negotiate_existing', data: {} }));
const mockGetJob = mock(async () => null as null | { id: string; getState: () => Promise<string>; retry: () => Promise<void> });
const mockCreateWorker = mock(() => ({}));

mock.module('../../adapters/database.adapter', () => ({
  ChatDatabaseAdapter: class {},
}));

mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class {},
}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd, getJob: mockGetJob }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

afterAll(() => {
  mock.restore();
});

import { NegotiationRunExistingQueue, QUEUE_NAME, type RunExistingDeps, type RunExistingGraphInvokeOptions } from '../negotiations/run-existing.queue';

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

  it('uses one deterministic exact-settlement job id and retries a retained failed job', async () => {
    mockGetJob.mockResolvedValueOnce(null);
    const queue = new NegotiationRunExistingQueue();
    const data = {
      opportunityId: 'opp-1', userId: 'u1', taskId: 'task-1',
      settlementId: 'settlement-1', recipientIntentId: 'intent-1', networkId: 'network-1',
    };
    await queue.addJob(data);
    expect(mockAdd).toHaveBeenLastCalledWith('negotiate_existing', data, expect.objectContaining({
      jobId: 'negotiation-resume-settlement-1',
    }));

    const retry = mock(async () => {});
    mockGetJob.mockResolvedValueOnce({ id: 'existing', getState: async () => 'failed', retry });
    const existing = await queue.addJob(data);
    expect(existing.id).toBe('existing');
    expect(retry).toHaveBeenCalledTimes(1);
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

  const exactData = {
    opportunityId: 'opp-42', userId: 'u1', taskId: 'task-exact',
    settlementId: 'settlement-exact', recipientIntentId: 'intent-1', networkId: 'network-1',
  };
  const claimedExecution = {
    taskId: exactData.taskId,
    settlementId: exactData.settlementId,
    opportunityId: exactData.opportunityId,
    userId: exactData.userId,
    recipientIntentId: exactData.recipientIntentId,
    networkId: exactData.networkId,
    intentFingerprint: 'fp-1',
    opportunityStatus: 'pending',
    opportunityUpdatedAt: '2026-07-23T12:00:00.000Z',
    counterpartyUserId: 'u2',
    counterpartyIntentId: 'intent-2',
    successorTaskId: 'task-successor',
    conversationId: 'conversation-1',
    token: 'lease-token',
    fence: 2,
    leaseExpiresAt: '2026-07-23T12:01:00.000Z',
    consultation: { recipientUserId: 'u1', recipientIntentId: 'intent-1', kind: 'answer' as const, selectedOptions: ['yes'] },
  };
  const receipt = {
    priorTaskId: exactData.taskId,
    settlementId: exactData.settlementId,
    successorTaskId: claimedExecution.successorTaskId,
    fence: claimedExecution.fence,
    outcome: 'accepted' as const,
  };

  it('passes only a current fenced claim to the graph and completes only its positive receipt', async () => {
    const invokeOpportunityGraph = mock(async (_opts: RunExistingGraphInvokeOptions) => ({ negotiationContinuationReceipt: receipt }));
    const claimNegotiationContinuationExecution = mock(async () => ({ status: 'claimed' as const, execution: claimedExecution }));
    const completeNegotiationContinuationExecution = mock(async () => {});
    const queue = new NegotiationRunExistingQueue({
      invokeOpportunityGraph,
      continuationAdapter: {
        claimNegotiationContinuationExecution,
        heartbeatNegotiationContinuationExecution: async (execution) => execution,
        releaseNegotiationContinuationExecution: async () => {},
        parkNegotiationContinuationExecution: async () => {},
        completeNegotiationContinuationExecution,
      },
    });

    await queue.processJob('negotiate_existing', exactData);
    expect(claimNegotiationContinuationExecution).toHaveBeenCalledWith(exactData);
    expect(invokeOpportunityGraph).toHaveBeenCalledWith(expect.objectContaining({
      opportunityId: exactData.opportunityId,
      options: { negotiationContinuation: claimedExecution },
    }));
    expect(JSON.stringify(invokeOpportunityGraph.mock.calls)).not.toContain('latest');
    expect(completeNegotiationContinuationExecution).toHaveBeenCalledWith(claimedExecution, receipt);
  });

  it('parks rather than completes a fenced external-agent handoff', async () => {
    const parkNegotiationContinuationExecution = mock(async () => {});
    const completeNegotiationContinuationExecution = mock(async () => {});
    const queue = new NegotiationRunExistingQueue({
      invokeOpportunityGraph: async () => ({
        negotiationContinuationReceipt: { ...receipt, outcome: 'waiting_for_agent' as const },
      }),
      continuationAdapter: {
        claimNegotiationContinuationExecution: async () => ({ status: 'claimed', execution: claimedExecution }),
        heartbeatNegotiationContinuationExecution: async (execution) => execution,
        releaseNegotiationContinuationExecution: async () => {},
        parkNegotiationContinuationExecution,
        completeNegotiationContinuationExecution,
      },
    });
    await queue.processJob('negotiate_existing', exactData);
    expect(parkNegotiationContinuationExecution).toHaveBeenCalledWith(claimedExecution);
    expect(completeNegotiationContinuationExecution).not.toHaveBeenCalled();
  });

  it('parks an input-required continuation instead of releasing and reinvoking it', async () => {
    const parkNegotiationContinuationExecution = mock(async () => {});
    const invokeOpportunityGraph = mock(async () => ({
      negotiationContinuationReceipt: { ...receipt, outcome: 'input_required' as const },
    }));
    const queue = new NegotiationRunExistingQueue({
      invokeOpportunityGraph,
      continuationAdapter: {
        claimNegotiationContinuationExecution: async () => ({ status: 'claimed', execution: claimedExecution }),
        heartbeatNegotiationContinuationExecution: async (execution) => execution,
        releaseNegotiationContinuationExecution: async () => {},
        parkNegotiationContinuationExecution,
        completeNegotiationContinuationExecution: async () => {},
      },
    });
    await queue.processJob('negotiate_existing', exactData);
    expect(parkNegotiationContinuationExecution).toHaveBeenCalledWith(claimedExecution);
    expect(invokeOpportunityGraph).toHaveBeenCalledTimes(1);
  });

  it('releases the lease and retries after a process-boundary graph failure', async () => {
    let attempts = 0;
    const invokeOpportunityGraph = mock(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('worker crashed');
      return { negotiationContinuationReceipt: receipt };
    });
    const releaseNegotiationContinuationExecution = mock(async () => {});
    const completeNegotiationContinuationExecution = mock(async () => {});
    const queue = new NegotiationRunExistingQueue({
      invokeOpportunityGraph,
      continuationAdapter: {
        claimNegotiationContinuationExecution: async () => ({ status: 'claimed', execution: claimedExecution }),
        heartbeatNegotiationContinuationExecution: async (execution) => execution,
        releaseNegotiationContinuationExecution,
        parkNegotiationContinuationExecution: async () => {},
        completeNegotiationContinuationExecution,
      },
    });
    await expect(queue.processJob('negotiate_existing', exactData)).rejects.toThrow('worker crashed');
    expect(releaseNegotiationContinuationExecution).toHaveBeenCalledWith(claimedExecution);
    expect(completeNegotiationContinuationExecution).not.toHaveBeenCalled();
    await expect(queue.processJob('negotiate_existing', exactData)).resolves.toBeUndefined();
    expect(completeNegotiationContinuationExecution).toHaveBeenCalledWith(claimedExecution, receipt);
  });

  it('never invokes a graph without a claim and rejects an unreceipted graph result', async () => {
    const invokeOpportunityGraph = mock(async () => ({}));
    for (const status of ['busy', 'completed', 'invalid'] as const) {
      const queue = new NegotiationRunExistingQueue({
        invokeOpportunityGraph,
        continuationAdapter: {
          claimNegotiationContinuationExecution: async () => ({ status }),
          heartbeatNegotiationContinuationExecution: async (execution) => execution,
          releaseNegotiationContinuationExecution: async () => {},
          parkNegotiationContinuationExecution: async () => {},
          completeNegotiationContinuationExecution: async () => {},
        },
      });
      await queue.processJob('negotiate_existing', exactData);
    }
    expect(invokeOpportunityGraph).not.toHaveBeenCalled();

    const releaseNegotiationContinuationExecution = mock(async () => {});
    const queue = new NegotiationRunExistingQueue({
      invokeOpportunityGraph,
      continuationAdapter: {
        claimNegotiationContinuationExecution: async () => ({ status: 'claimed', execution: claimedExecution }),
        heartbeatNegotiationContinuationExecution: async (execution) => execution,
        releaseNegotiationContinuationExecution,
        parkNegotiationContinuationExecution: async () => {},
        completeNegotiationContinuationExecution: async () => {},
      },
    });
    await expect(queue.processJob('negotiate_existing', exactData)).rejects.toThrow('no positive successor receipt');
    expect(releaseNegotiationContinuationExecution).toHaveBeenCalledWith(claimedExecution);
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
