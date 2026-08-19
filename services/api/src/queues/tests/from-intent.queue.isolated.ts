/**
 * Unit tests for FromIntentQueue. Use injected deps to avoid Redis/DB; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { beforeEach, describe, expect, it, mock, afterAll } from 'bun:test';
import type { OpportunityDiscoverySummary } from '../opportunity/discovery.shared';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'discover_opportunities', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));
mock.module('../../adapters/database.adapter', () => ({
  ChatDatabaseAdapter: class ChatDatabaseAdapter {},
  chatDatabaseAdapter: {},
}));
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class EmbedderAdapter {},
  embedderAdapter: {},
}));

// Stub the run-existing queue that from-intent imports
mock.module('../negotiations/run-existing.queue', () => ({
  negotiationRunExistingQueue: { addJob: async () => ({ id: 'neg-1' }) },
}));
mock.module('../pool/negotiation-evidence.shadow', () => ({
  maybeRunNegotiationEvidenceShadow: async () => {},
}));
mock.module('../questioner/recovery.shared', () => ({
  maybeEnqueueIntentRecovery: async () => {},
}));

// Stand in for the discovery graph runner so a test can hand the queue a real
// `OpportunityDiscoverySummary` without building the protocol graph. The
// injected-graph short-circuit is reproduced faithfully (it returns null), so
// every existing `invokeOpportunityGraph` test keeps its original semantics.
const actualDiscoveryShared = await import('../opportunity/discovery.shared');
let nextDiscoverySummary: OpportunityDiscoverySummary | null = null;
const runOpportunityDiscoveryMock = mock(async (params: {
  deps?: { invokeOpportunityGraph?: (opts: unknown) => Promise<void> };
  invokeOpts: unknown;
}): Promise<OpportunityDiscoverySummary | null> => {
  if (params.deps?.invokeOpportunityGraph) {
    await params.deps.invokeOpportunityGraph(params.invokeOpts);
    return null;
  }
  return nextDiscoverySummary;
});
mock.module('../opportunity/discovery.shared', () => ({
  ...actualDiscoveryShared,
  runOpportunityDiscovery: runOpportunityDiscoveryMock,
}));

afterAll(() => {
  mock.restore();
});

import type { FromIntentJobData, FromIntentDatabase, FromIntentDeps, FromIntentGraphInvokeOptions } from '../opportunity/from-intent.queue';
import { buildIntentDiscoveryTrigger } from '../opportunity/discovery-trigger.builders';

const { FromIntentQueue, QUEUE_NAME } = await import('../opportunity/from-intent.queue');
const { summarizeOpportunityDiscoveryResult } = await import('../opportunity/discovery.shared');

type FromIntentDatabaseOverrides = Partial<FromIntentDatabase> & Pick<FromIntentDatabase, 'getIntentForIndexing'>;

const asDb = (db: FromIntentDatabaseOverrides): FromIntentDatabase => ({
  getIntentForIndexing: db.getIntentForIndexing,
  getNetworkIdsForIntent: db.getNetworkIdsForIntent ?? (async () => ['idx1']),
  getAssignmentNetworkMembershipsForUser:
    db.getAssignmentNetworkMembershipsForUser
    ?? (async () => [{ networkId: 'idx1', isPersonal: false }]),
  markIntentFirstDiscoverySucceeded: db.markIntentFirstDiscoverySucceeded ?? (async () => {}),
  recordIntentDiscoveryProgress: db.recordIntentDiscoveryProgress ?? (async () => {}),
});

type ProgressWrite = Parameters<NonNullable<FromIntentDatabase['recordIntentDiscoveryProgress']>>[0];

/** A complete summary; overrides name only the tallies a test is about. */
const discoverySummary = (overrides: Partial<OpportunityDiscoverySummary> = {}): OpportunityDiscoverySummary => ({
  candidatesFound: 0,
  evaluatedCount: 0,
  opportunitiesCreated: 0,
  completionReason: 'created_or_reactivated',
  unevaluatedCandidates: 0,
  sameTriggerDuplicateSuppressions: 0,
  pairActiveNegotiationSuppressions: 0,
  crossTriggerAllowedCount: 0,
  finalAtomicConflictCount: 0,
  ...overrides,
});

const progressWrite = (
  record: { mock: { calls: unknown[][] } },
  status: ProgressWrite['status'],
): ProgressWrite => {
  const call = record.mock.calls.find((args) => (args[0] as ProgressWrite).status === status);
  if (!call) throw new Error(`no ${status} progress write recorded`);
  return call[0] as ProgressWrite;
};

describe('FromIntentQueue', () => {
  beforeEach(() => {
    nextDiscoverySummary = null;
  });

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

    it('supports debounce and removal options', async () => {
      const queue = new FromIntentQueue();
      await queue.addJob(
        { intentId: 'i1', userId: 'u1', trigger: 'intent_resume' },
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
        { intentId: 'i1', userId: 'u1', trigger: 'intent_resume' },
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
    it('records aggregate queued, running, and completed lifecycle states without candidate data', async () => {
      const recordIntentDiscoveryProgress = mock(async () => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          recordIntentDiscoveryProgress,
        }),
        invokeOpportunityGraph: async () => {},
      });
      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' }, 2);
      expect(recordIntentDiscoveryProgress).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', attempt: 2, assignedCommunityCount: 1 }));
      expect(recordIntentDiscoveryProgress).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded', attempt: 2 }));
    });

    it('carries the graph summary tallies into the succeeded write', async () => {
      const recordIntentDiscoveryProgress = mock(async (_input: ProgressWrite) => {});
      nextDiscoverySummary = discoverySummary({ candidatesFound: 7, evaluatedCount: 4, opportunitiesCreated: 2 });
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => ['idx1', 'idx2'],
          getAssignmentNetworkMembershipsForUser: async () => [
            { networkId: 'idx1', isPersonal: false },
            { networkId: 'idx2', isPersonal: false },
          ],
          recordIntentDiscoveryProgress,
        }),
      });

      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' }, 1);

      expect(recordIntentDiscoveryProgress).toHaveBeenCalledWith(expect.objectContaining({
        status: 'succeeded',
        assignedCommunityCount: 2,
        // The graph runs once across every valid network, so the whole
        // still-valid set is what was processed.
        processedCommunityCount: 2,
        possibleOverlapCount: 7,
        conversationsStartedCount: 2,
      }));
    });

    it('writes a zero-result run honestly rather than skipping the tallies', async () => {
      const recordIntentDiscoveryProgress = mock(async (_input: ProgressWrite) => {});
      nextDiscoverySummary = discoverySummary({ completionReason: 'no_search_candidates' });
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          recordIntentDiscoveryProgress,
        }),
      });

      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' }, 1);

      expect(recordIntentDiscoveryProgress).toHaveBeenCalledWith(expect.objectContaining({
        status: 'succeeded', processedCommunityCount: 1, possibleOverlapCount: 0, conversationsStartedCount: 0,
      }));
    });

    it('omits the tallies entirely when the graph was injected and returned no summary', async () => {
      const recordIntentDiscoveryProgress = mock(async (_input: ProgressWrite) => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          recordIntentDiscoveryProgress,
        }),
        invokeOpportunityGraph: async () => {},
      });

      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' }, 1);

      const succeeded = progressWrite(recordIntentDiscoveryProgress, 'succeeded');
      // Omitted, not zeroed: the adapter leaves stored counts untouched, so an
      // injected graph can never claim a run found nothing.
      expect(succeeded).not.toHaveProperty('processedCommunityCount');
      expect(succeeded).not.toHaveProperty('possibleOverlapCount');
      expect(succeeded).not.toHaveProperty('conversationsStartedCount');
    });

    it('leaves the blocked write free of tallies', async () => {
      const recordIntentDiscoveryProgress = mock(async (_input: ProgressWrite) => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getAssignmentNetworkMembershipsForUser: async () => [],
          recordIntentDiscoveryProgress,
        }),
        invokeOpportunityGraph: async () => {},
      });

      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' }, 1);

      const blocked = progressWrite(recordIntentDiscoveryProgress, 'blocked');
      expect(blocked).toMatchObject({ status: 'blocked', attempt: 0, assignedCommunityCount: 0 });
      expect(blocked).not.toHaveProperty('possibleOverlapCount');
      expect(blocked).not.toHaveProperty('conversationsStartedCount');
    });

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
      const rows = [
        { id: 'paused', payload: 'P', userId: 'u1', sourceType: null, sourceId: null, status: 'PAUSED' as const, archivedAt: null },
        { id: 'archived', payload: 'P', userId: 'u1', sourceType: null, sourceId: null, status: 'ACTIVE' as const, archivedAt: new Date() },
        { id: 'foreign', payload: 'P', userId: 'u2', sourceType: null, sourceId: null, status: 'ACTIVE' as const, archivedAt: null },
      ];
      for (const row of rows) {
        const queue = new FromIntentQueue({
          database: asDb({ getIntentForIndexing: async () => row, markIntentFirstDiscoverySucceeded }),
          invokeOpportunityGraph,
        });
        await queue.processJob('discover_opportunities', { intentId: row.id, userId: 'u1' });
      }
      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
      expect(markIntentFirstDiscoverySucceeded).not.toHaveBeenCalled();
    });

    it('intent-resume follows the ordinary discovery path', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const db = {
        getIntentForIndexing: async () => ({
          id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null,
          status: 'ACTIVE' as const, archivedAt: null,
        }),
      };
      const queue = new FromIntentQueue({ database: asDb(db), invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', {
        intentId: 'i1', userId: 'u1', trigger: 'intent_resume',
      });
      expect(invokeOpportunityGraph).toHaveBeenCalledTimes(1);
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
      const expected = buildIntentDiscoveryTrigger({
        userId: 'u1',
        searchQuery: 'Build a SaaS',
        networkIds: ['idx1'],
        triggerIntentId: 'i1',
      });
      expect(JSON.stringify(invokeOpportunityGraph.mock.calls[0]![0])).toBe(JSON.stringify(expected));
    });

    it('discover: does not stamp when the graph fails', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {
        throw new Error('graph failed');
      });
      const markIntentFirstDiscoverySucceeded = mock(async (_intentId: string) => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
          markIntentFirstDiscoverySucceeded,
        }),
        invokeOpportunityGraph,
      });

      await expect(queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' }))
        .rejects.toThrow('graph failed');
      expect(markIntentFirstDiscoverySucceeded).not.toHaveBeenCalled();
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

    it('fails closed for foreign explicit scope', async () => {
      const invokeOpportunityGraph = mock(async (_opts: FromIntentGraphInvokeOptions) => {});
      const queue = new FromIntentQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => ['idx-assigned'],
          getAssignmentNetworkMembershipsForUser: async () => [{ networkId: 'idx-assigned', isPersonal: false }],
        }),
        invokeOpportunityGraph,
      });

      await queue.processJob('discover_opportunities', {
        intentId: 'i1', userId: 'u1', networkIds: ['idx-foreign'],
      });

      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
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

    it('reports a stranded tail as a bound, not as an evaluator rejection', () => {
      const bounded = summarizeOpportunityDiscoveryResult({
        candidates: [{}, {}],
        remainingCandidates: [{}],
        evaluatedOpportunities: [],
        opportunities: [],
      });

      expect(bounded.completionReason).toBe('evaluation_bound_reached');
      expect(bounded.unevaluatedCandidates).toBe(1);
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
