/**
 * Unit tests for FromIntentQueue. Use injected deps to avoid Redis/DB; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

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

// Stub the run-existing queue that from-intent imports
mock.module('../negotiations/run-existing.queue', () => ({
  negotiationRunExistingQueue: { addJob: async () => ({ id: 'neg-1' }) },
}));

afterAll(() => {
  mock.restore();
});

import { FromIntentQueue, QUEUE_NAME, type FromIntentJobData, type FromIntentDatabase, type FromIntentDeps, type FromIntentGraphInvokeOptions } from '../opportunity/from-intent.queue';
import { summarizeOpportunityDiscoveryResult } from '../opportunity/discovery.shared';

type FromIntentDatabaseOverrides = Partial<FromIntentDatabase> & Pick<FromIntentDatabase, 'getIntentForIndexing'>;

const asDb = (db: FromIntentDatabaseOverrides): FromIntentDatabase => ({
  getIntentForIndexing: db.getIntentForIndexing,
  getNetworkIdsForIntent: db.getNetworkIdsForIntent ?? (async () => ['idx1']),
  getAssignmentNetworkMembershipsForUser:
    db.getAssignmentNetworkMembershipsForUser
    ?? (async () => [{ networkId: 'idx1', isPersonal: false }]),
  markIntentFirstDiscoverySucceeded: db.markIntentFirstDiscoverySucceeded ?? (async () => {}),
});

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

    it('retains the production newborn stamper supplied through runtime deps', () => {
      const stampNewbornOpportunities: NonNullable<FromIntentDeps['stampNewbornOpportunities']> = async ({ items }) => items;
      const queue = new FromIntentQueue({
        database: asDb({ getIntentForIndexing: async () => null }),
      });
      queue.setRuntimeDeps({ stampNewbornOpportunities });
      const deps = (queue as unknown as {
        deps?: { stampNewbornOpportunities?: typeof stampNewbornOpportunities };
      }).deps;
      expect(deps?.stampNewbornOpportunities).toBe(stampNewbornOpportunities);
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

    it('supports debounce and removal options', async () => {
      const queue = new FromIntentQueue();
      await queue.addJob(
        { intentId: 'i1', userId: 'u1', trigger: 'pool_answer' },
        {
          priority: 1,
          delay: 60_000,
          removeOnComplete: true,
          removeOnFail: true,
          deduplication: { id: 'intent-i1', ttl: 60_000, extend: true, replace: true, keepLastIfActive: true },
        },
      );
      expect(mockAdd).toHaveBeenCalledWith(
        'discover_opportunities',
        { intentId: 'i1', userId: 'u1', trigger: 'pool_answer' },
        expect.objectContaining({
          priority: 1,
          delay: 60_000,
          removeOnComplete: true,
          removeOnFail: true,
          deduplication: { id: 'intent-i1', ttl: 60_000, extend: true, replace: true, keepLastIfActive: true },
        }),
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

    it('discover: skips paused, archived, and wrong-owner jobs at admission', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const markIntentFirstDiscoverySucceeded = mock(async (_intentId: string) => {});
      const minePoolDiscriminators = mock((_trigger: unknown) => {});
      const rows = [
        { id: 'paused', payload: 'P', userId: 'u1', sourceType: null, sourceId: null, status: 'PAUSED' as const, archivedAt: null },
        { id: 'archived', payload: 'P', userId: 'u1', sourceType: null, sourceId: null, status: 'ACTIVE' as const, archivedAt: new Date() },
        { id: 'foreign', payload: 'P', userId: 'u2', sourceType: null, sourceId: null, status: 'ACTIVE' as const, archivedAt: null },
      ];
      for (const row of rows) {
        const queue = new FromIntentQueue({
          database: asDb({ getIntentForIndexing: async () => row, markIntentFirstDiscoverySucceeded }),
          invokeOpportunityGraph,
          minePoolDiscriminators,
        });
        await queue.processJob('discover_opportunities', { intentId: row.id, userId: 'u1' });
      }
      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
      expect(markIntentFirstDiscoverySucceeded).not.toHaveBeenCalled();
      expect(minePoolDiscriminators).not.toHaveBeenCalled();
    });

    it('intent-resume follows the ordinary discovery and mining path', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const minePoolDiscriminators = mock((_trigger: unknown) => {});
      const db = {
        getIntentForIndexing: async () => ({
          id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null,
          status: 'ACTIVE' as const, archivedAt: null,
        }),
      };
      const queue = new FromIntentQueue({ database: asDb(db), invokeOpportunityGraph, minePoolDiscriminators });
      await queue.processJob('discover_opportunities', {
        intentId: 'i1', userId: 'u1', trigger: 'intent_resume',
      });
      expect(invokeOpportunityGraph).toHaveBeenCalledTimes(1);
      expect(minePoolDiscriminators).toHaveBeenCalledTimes(1);
    });

    it('discover: fires the pool-mining hook after discovery completes (IND-418 web coverage)', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const minePoolDiscriminators = mock((_trigger: unknown) => {});
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
      };
      const queue = new FromIntentQueue({ database: asDb(db), invokeOpportunityGraph, minePoolDiscriminators });
      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' });
      expect(minePoolDiscriminators).toHaveBeenCalledWith({
        source: 'from_intent',
        userId: 'u1',
        intentId: 'i1',
      });
    });

    it('discover: invokes recovery only after successful exact-intent completion', async () => {
      const order: string[] = [];
      const recoverAfterCompletion = mock(async () => { order.push('recover'); });
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({
            id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null,
            status: 'ACTIVE' as const, archivedAt: null,
          }),
        }),
        invokeOpportunityGraph: async () => { order.push('discover'); },
        minePoolDiscriminators: () => { order.push('pool'); },
        recoverAfterCompletion,
      });
      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' });
      expect(recoverAfterCompletion).toHaveBeenCalledWith({
        source: 'from_intent', recipientUserId: 'u1', intentId: 'i1',
      });
      expect(order).toEqual(['discover', 'recover', 'pool']);
    });

    it('discover: does NOT fire the pool-mining hook when the intent is missing', async () => {
      const minePoolDiscriminators = mock((_trigger: unknown) => {});
      const recoverAfterCompletion = mock(async () => {});
      const db = {
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<FromIntentDatabase['getIntentForIndexing']>>,
      };
      const queue = new FromIntentQueue({ database: asDb(db), minePoolDiscriminators, recoverAfterCompletion });
      await queue.processJob('discover_opportunities', { intentId: 'missing', userId: 'u1' });
      expect(minePoolDiscriminators).not.toHaveBeenCalled();
      expect(recoverAfterCompletion).not.toHaveBeenCalled();
    });

    it('discover: stamps first-discovery success after the graph completes', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const markIntentFirstDiscoverySucceeded = mock(async (_intentId: string) => {});
      const db = asDb({
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
        markIntentFirstDiscoverySucceeded,
      });
      const queue = new FromIntentQueue({ database: db, invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', {
        intentId: 'i1',
        userId: 'u1',
        networkIds: ['idx1'],
      });
      expect(markIntentFirstDiscoverySucceeded).toHaveBeenCalledWith('i1');
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

    it('discover: does not stamp when the graph fails', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {
        throw new Error('graph failed');
      });
      const markIntentFirstDiscoverySucceeded = mock(async (_intentId: string) => {});
      const recoverAfterCompletion = mock(async () => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
          markIntentFirstDiscoverySucceeded,
        }),
        invokeOpportunityGraph,
        recoverAfterCompletion,
      });

      await expect(queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' }))
        .rejects.toThrow('graph failed');
      expect(markIntentFirstDiscoverySucceeded).not.toHaveBeenCalled();
      expect(recoverAfterCompletion).not.toHaveBeenCalled();
    });

    it('discover: does not stamp when assignment disappears after the graph completes', async () => {
      const markIntentFirstDiscoverySucceeded = mock(async () => {});
      const getNetworkIdsForIntent = mock()
        .mockResolvedValueOnce(['idx1'])
        .mockResolvedValueOnce([]);
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent,
          markIntentFirstDiscoverySucceeded,
        }),
        invokeOpportunityGraph: async () => {},
      });
      await expect(queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' }))
        .rejects.toThrow('stamp precondition failed');
      expect(markIntentFirstDiscoverySucceeded).not.toHaveBeenCalled();
    });

    it('pool-answer discovery appends all durable answer context and narrates after mining', async () => {
      const callOrder: string[] = [];
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {
        callOrder.push('discover');
      });
      const getPoolAnswerContext = mock(async () => 'User-stated matching preferences:\n- Builders vs advisors: Builders');
      const minePoolDiscriminators = mock(async () => {
        callOrder.push('mine-start');
        await Promise.resolve();
        callOrder.push('mine-end');
      });
      const narratePoolRerun = mock(async () => {
        callOrder.push('narrate');
      });
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
      };
      const queue = new FromIntentQueue({
        database: asDb(db),
        invokeOpportunityGraph,
        getPoolAnswerContext,
        minePoolDiscriminators,
        narratePoolRerun,
      });

      await queue.processJob('discover_opportunities', {
        intentId: 'i1',
        userId: 'u1',
        trigger: 'pool_answer',
      });

      expect(getPoolAnswerContext).toHaveBeenCalledWith('u1', 'i1');
      expect(invokeOpportunityGraph).toHaveBeenCalledWith(expect.objectContaining({
        searchQuery: 'Build a SaaS\n\nUser-stated matching preferences:\n- Builders vs advisors: Builders',
      }));
      expect(narratePoolRerun).toHaveBeenCalledWith({
        userId: 'u1',
        intentId: 'i1',
        newCandidates: null,
      });
      expect(callOrder).toEqual(['discover', 'mine-start', 'mine-end', 'narrate']);
    });

    it('runs recovery exactly once before a pool-answer narration failure propagates', async () => {
      const callOrder: string[] = [];
      const recoverAfterCompletion = mock(async () => { callOrder.push('recover'); });
      const minePoolDiscriminators = mock(async () => { callOrder.push('mine'); });
      const narratePoolRerun = mock(async () => {
        callOrder.push('narrate');
        throw new Error('narration failed');
      });
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({
            id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null,
          }),
        }),
        invokeOpportunityGraph: async () => { callOrder.push('discover'); },
        recoverAfterCompletion,
        minePoolDiscriminators,
        narratePoolRerun,
      });

      await expect(queue.processJob('discover_opportunities', {
        intentId: 'i1', userId: 'u1', trigger: 'pool_answer',
      })).rejects.toThrow('narration failed');
      expect(recoverAfterCompletion).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['discover', 'recover', 'mine', 'narrate']);
    });

    it('forwards every assigned active network through deterministic indexScope', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const db = asDb({
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getNetworkIdsForIntent: async () => ['idx-b', 'idx-a', 'idx-b', 'idx-foreign'],
        getAssignmentNetworkMembershipsForUser: async () => [
          { networkId: 'idx-a', isPersonal: false },
          { networkId: 'idx-b', isPersonal: false },
          { networkId: 'idx-owner-only', isPersonal: false },
        ],
      });
      const queue = new FromIntentQueue({ database: db, invokeOpportunityGraph });

      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' });

      expect(invokeOpportunityGraph).toHaveBeenCalledWith(expect.objectContaining({
        indexScope: ['idx-a', 'idx-b'],
      }));
      expect(invokeOpportunityGraph.mock.calls[0]?.[0]).not.toHaveProperty('networkId');
    });

    it('allows explicit networkIds to narrow but never broaden authoritative scope', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const db = asDb({
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getNetworkIdsForIntent: async () => ['idx-a', 'idx-b'],
        getAssignmentNetworkMembershipsForUser: async () => [
          { networkId: 'idx-a', isPersonal: false },
          { networkId: 'idx-b', isPersonal: false },
          { networkId: 'idx-foreign', isPersonal: false },
        ],
      });
      const queue = new FromIntentQueue({ database: db, invokeOpportunityGraph });

      await queue.processJob('discover_opportunities', {
        intentId: 'i1', userId: 'u1', networkIds: ['idx-foreign', 'idx-b'],
      });

      expect(invokeOpportunityGraph).toHaveBeenCalledWith(expect.objectContaining({ networkId: 'idx-b' }));
      expect(invokeOpportunityGraph.mock.calls[0]?.[0]).not.toHaveProperty('indexScope');
    });

    it('fails closed for foreign explicit scope and does not mine or narrate', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const minePoolDiscriminators = mock(async () => {});
      const narratePoolRerun = mock(async () => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => ['idx-assigned'],
          getAssignmentNetworkMembershipsForUser: async () => [{ networkId: 'idx-assigned', isPersonal: false }],
        }),
        invokeOpportunityGraph,
        minePoolDiscriminators,
        narratePoolRerun,
      });

      await queue.processJob('discover_opportunities', {
        intentId: 'i1', userId: 'u1', networkIds: ['idx-foreign'], trigger: 'pool_answer',
      });

      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
      expect(minePoolDiscriminators).not.toHaveBeenCalled();
      expect(narratePoolRerun).not.toHaveBeenCalled();
    });

    it('fails closed when the intent has no network assignments', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const markIntentFirstDiscoverySucceeded = mock(async (_intentId: string) => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => [],
          getAssignmentNetworkMembershipsForUser: async () => [{ networkId: 'idx-owner-only', isPersonal: false }],
          markIntentFirstDiscoverySucceeded,
        }),
        invokeOpportunityGraph,
      });

      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' });

      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
      expect(markIntentFirstDiscoverySucceeded).not.toHaveBeenCalled();
    });

    it('fails closed when assignment membership lookup excludes a soft-deleted membership', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => ['idx-soft-deleted'],
          // The production lookup omits soft-deleted membership/network rows.
          getAssignmentNetworkMembershipsForUser: async () => [],
        }),
        invokeOpportunityGraph,
      });

      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' });

      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
    });

    it('keeps an assigned owner personal network eligible', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => ['personal-net'],
          getAssignmentNetworkMembershipsForUser: async () => [{ networkId: 'personal-net', isPersonal: true }],
        }),
        invokeOpportunityGraph,
      });

      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' });

      expect(invokeOpportunityGraph).toHaveBeenCalledWith(expect.objectContaining({ networkId: 'personal-net' }));
    });

    it('discover: empty explicit networkIds skips fail-closed instead of broadening', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        }),
        invokeOpportunityGraph,
      });
      await queue.processJob('discover_opportunities', {
        intentId: 'i1', userId: 'u1', networkIds: [],
      });
      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
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

  describe('completion telemetry', () => {
    it('distinguishes evaluator-zero from persistence-dedup-zero', () => {
      const evaluatorZero = summarizeOpportunityDiscoveryResult({
        candidates: [{}],
        evaluatedOpportunities: [],
        opportunities: [],
      });
      const persistenceDedupZero = summarizeOpportunityDiscoveryResult({
        candidates: [{}],
        evaluatedOpportunities: [{}],
        opportunities: [],
        persistenceOutcome: {
          evaluatedCount: 1,
          sameTriggerDuplicateSuppressions: 1,
          pairActiveNegotiationSuppressions: 0,
          crossTriggerAllowedCount: 0,
          finalAtomicConflictCount: 0,
        },
      });

      expect(evaluatorZero.completionReason).toBe('evaluator_rejected_all');
      expect(persistenceDedupZero.completionReason).toBe('same_trigger_duplicate_suppressed');
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
