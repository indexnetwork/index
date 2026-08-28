/**
 * Unit tests for DiscoveryQueue. Use injected deps to avoid Redis/DB.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { beforeEach, describe, expect, it, mock, afterAll } from 'bun:test';
import type { OpportunityDiscoverySummary } from '../opportunity/discovery.shared';

mock.module('../../adapters/database.adapter', () => ({
  ChatDatabaseAdapter: class ChatDatabaseAdapter {},
  chatDatabaseAdapter: {},
}));
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class EmbedderAdapter {},
  embedderAdapter: {},
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

import type { DiscoveryDatabase, DiscoveryGraphInvokeOptions } from '../opportunity/discovery.queue';
import { buildIntentDiscoveryTrigger } from '../opportunity/discovery-trigger.builders';

const { DiscoveryQueue } = await import('../opportunity/discovery.queue');
const { summarizeOpportunityDiscoveryResult } = await import('../opportunity/discovery.shared');

type DiscoveryDatabaseOverrides = Partial<DiscoveryDatabase> & Pick<DiscoveryDatabase, 'getIntentForIndexing'>;

const asDb = (db: DiscoveryDatabaseOverrides): DiscoveryDatabase => ({
  getIntentForIndexing: db.getIntentForIndexing,
  getNetworkIdsForIntent: db.getNetworkIdsForIntent ?? (async () => ['idx1']),
  getAssignmentNetworkMembershipsForUser:
    db.getAssignmentNetworkMembershipsForUser
    ?? (async () => [{ networkId: 'idx1', isPersonal: false }]),
  markIntentFirstDiscoverySucceeded: db.markIntentFirstDiscoverySucceeded ?? (async () => {}),
  recordIntentDiscoveryProgress: db.recordIntentDiscoveryProgress ?? (async () => {}),
});

type ProgressWrite = Parameters<NonNullable<DiscoveryDatabase['recordIntentDiscoveryProgress']>>[0];

/** A complete summary; overrides name only the tallies a test is about. */
const discoverySummary = (overrides: Partial<OpportunityDiscoverySummary> = {}): OpportunityDiscoverySummary => ({
  candidatesFound: 0,
  evaluatedCount: 0,
  opportunitiesCreated: 0,
  completionReason: 'created_or_reactivated',
  sameIntentPairDuplicateSuppressions: 0,
  crossIntentPairAllowedCount: 0,
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

describe('DiscoveryQueue', () => {
  beforeEach(() => {
    nextDiscoverySummary = null;
  });

  describe('constructor', () => {
    it('uses provided database when deps given', async () => {
      const getIntentForIndexing = mock(async () => null as unknown as Awaited<ReturnType<DiscoveryDatabase['getIntentForIndexing']>>);
      const db = { getIntentForIndexing };
      const queue = new DiscoveryQueue({ database: asDb(db) });
      await queue.runDiscover({ intentId: 'i1', userId: 'u1' });
      expect(getIntentForIndexing).toHaveBeenCalledWith('i1');
    });
  });

  describe('addJob', () => {
    it('records the attached community count as queued, then runs the scan in the background', async () => {
      const recordIntentDiscoveryProgress = mock(async (_input: ProgressWrite) => {});
      const getIntentForIndexing = mock(async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }));
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing,
          getNetworkIdsForIntent: async () => ['idx1', 'idx2'],
          getAssignmentNetworkMembershipsForUser: async () => [
            { networkId: 'idx1', isPersonal: false },
            { networkId: 'idx2', isPersonal: false },
          ],
          recordIntentDiscoveryProgress,
        }),
        invokeOpportunityGraph: async () => {},
      });

      const result = await queue.addJob({ intentId: 'i1', userId: 'u1' });

      expect(result).toBeUndefined();
      expect(progressWrite(recordIntentDiscoveryProgress, 'queued')).toMatchObject({
        assignedCommunityCount: 2,
      });
      // The scan itself is backgrounded, not awaited by addJob.
      expect(getIntentForIndexing).not.toHaveBeenCalled();
    });
  });

  describe('handlers', () => {
    it('records aggregate queued, running, and completed lifecycle states without candidate data', async () => {
      const recordIntentDiscoveryProgress = mock(async () => {});
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          recordIntentDiscoveryProgress,
        }),
        invokeOpportunityGraph: async () => {},
      });
      await queue.runDiscover({ intentId: 'i1', userId: 'u1' });
      expect(recordIntentDiscoveryProgress).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', attempt: 1, assignedCommunityCount: 1 }));
      expect(recordIntentDiscoveryProgress).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded', attempt: 1 }));
    });

    it('records both persisted floor matches when one different intent pair was allowed', async () => {
      const recordIntentDiscoveryProgress = mock(async (_input: ProgressWrite) => {});
      nextDiscoverySummary = discoverySummary({
        candidatesFound: 2,
        evaluatedCount: 2,
        opportunitiesCreated: 2,
        crossIntentPairAllowedCount: 1,
      });
      const queue = new DiscoveryQueue({
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

      await queue.runDiscover({ intentId: 'i1', userId: 'u1' });

      expect(recordIntentDiscoveryProgress).toHaveBeenCalledWith(expect.objectContaining({
        status: 'succeeded',
        assignedCommunityCount: 2,
        // The graph runs once across every valid network, so the whole
        // still-valid set is what was processed.
        processedCommunityCount: 2,
        possibleOverlapCount: 2,
        conversationsStartedCount: 2,
      }));
    });

    it('writes a zero-result run honestly rather than skipping the tallies', async () => {
      const recordIntentDiscoveryProgress = mock(async (_input: ProgressWrite) => {});
      nextDiscoverySummary = discoverySummary({ completionReason: 'no_search_candidates' });
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          recordIntentDiscoveryProgress,
        }),
      });

      await queue.runDiscover({ intentId: 'i1', userId: 'u1' });

      expect(recordIntentDiscoveryProgress).toHaveBeenCalledWith(expect.objectContaining({
        status: 'succeeded', processedCommunityCount: 1, possibleOverlapCount: 0, conversationsStartedCount: 0,
      }));
    });

    it('omits the tallies entirely when the graph was injected and returned no summary', async () => {
      const recordIntentDiscoveryProgress = mock(async (_input: ProgressWrite) => {});
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          recordIntentDiscoveryProgress,
        }),
        invokeOpportunityGraph: async () => {},
      });

      await queue.runDiscover({ intentId: 'i1', userId: 'u1' });

      const succeeded = progressWrite(recordIntentDiscoveryProgress, 'succeeded');
      // Omitted, not zeroed: the adapter leaves stored counts untouched, so an
      // injected graph can never claim a run found nothing.
      expect(succeeded).not.toHaveProperty('processedCommunityCount');
      expect(succeeded).not.toHaveProperty('possibleOverlapCount');
      expect(succeeded).not.toHaveProperty('conversationsStartedCount');
    });

    it('leaves the blocked write free of tallies', async () => {
      const recordIntentDiscoveryProgress = mock(async (_input: ProgressWrite) => {});
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getAssignmentNetworkMembershipsForUser: async () => [],
          recordIntentDiscoveryProgress,
        }),
        invokeOpportunityGraph: async () => {},
      });

      await queue.runDiscover({ intentId: 'i1', userId: 'u1' });

      const blocked = progressWrite(recordIntentDiscoveryProgress, 'blocked');
      expect(blocked).toMatchObject({ status: 'blocked', attempt: 0, assignedCommunityCount: 0 });
      expect(blocked).not.toHaveProperty('possibleOverlapCount');
      expect(blocked).not.toHaveProperty('conversationsStartedCount');
    });

    it('discover: intent not found skips', async () => {
      const db = {
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<DiscoveryDatabase['getIntentForIndexing']>>,
      };
      const queue = new DiscoveryQueue({ database: asDb(db) });
      await queue.runDiscover({ intentId: 'missing', userId: 'u1' });
    });

    it('discover: skips paused, archived, and wrong-owner jobs at admission', async () => {
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const markIntentFirstDiscoverySucceeded = mock(async (_intentId: string) => {});
      const rows = [
        { id: 'paused', payload: 'P', userId: 'u1', sourceType: null, sourceId: null, status: 'PAUSED' as const, archivedAt: null },
        { id: 'archived', payload: 'P', userId: 'u1', sourceType: null, sourceId: null, status: 'ACTIVE' as const, archivedAt: new Date() },
        { id: 'foreign', payload: 'P', userId: 'u2', sourceType: null, sourceId: null, status: 'ACTIVE' as const, archivedAt: null },
      ];
      for (const row of rows) {
        const queue = new DiscoveryQueue({
          database: asDb({ getIntentForIndexing: async () => row, markIntentFirstDiscoverySucceeded }),
          invokeOpportunityGraph,
        });
        await queue.runDiscover({ intentId: row.id, userId: 'u1' });
      }
      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
      expect(markIntentFirstDiscoverySucceeded).not.toHaveBeenCalled();
    });

    it('intent-resume follows the ordinary discovery path', async () => {
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const db = {
        getIntentForIndexing: async () => ({
          id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null,
          status: 'ACTIVE' as const, archivedAt: null,
        }),
      };
      const queue = new DiscoveryQueue({ database: asDb(db), invokeOpportunityGraph });
      await queue.runDiscover({
        intentId: 'i1', userId: 'u1', trigger: 'intent_resume',
      });
      expect(invokeOpportunityGraph).toHaveBeenCalledTimes(1);
    });

    it('discover: stamps first-discovery success after the graph completes', async () => {
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const markIntentFirstDiscoverySucceeded = mock(async (_intentId: string) => {});
      const db = asDb({
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
        markIntentFirstDiscoverySucceeded,
      });
      const queue = new DiscoveryQueue({ database: db, invokeOpportunityGraph });
      await queue.runDiscover({
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
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {
        throw new Error('graph failed');
      });
      const markIntentFirstDiscoverySucceeded = mock(async (_intentId: string) => {});
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
          markIntentFirstDiscoverySucceeded,
        }),
        invokeOpportunityGraph,
      });

      await expect(queue.runDiscover({ intentId: 'i1', userId: 'u1' }))
        .rejects.toThrow('graph failed');
      expect(markIntentFirstDiscoverySucceeded).not.toHaveBeenCalled();
    });

    it('discover: does not stamp when assignment disappears after the graph completes', async () => {
      const markIntentFirstDiscoverySucceeded = mock(async () => {});
      const getNetworkIdsForIntent = mock()
        .mockResolvedValueOnce(['idx1'])
        .mockResolvedValueOnce([]);
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent,
          markIntentFirstDiscoverySucceeded,
        }),
        invokeOpportunityGraph: async () => {},
      });
      await expect(queue.runDiscover({ intentId: 'i1', userId: 'u1' }))
        .rejects.toThrow('stamp precondition failed');
      expect(markIntentFirstDiscoverySucceeded).not.toHaveBeenCalled();
    });

    it('forwards every assigned active network through deterministic indexScope', async () => {
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const db = asDb({
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getNetworkIdsForIntent: async () => ['idx-b', 'idx-a', 'idx-b', 'idx-foreign'],
        getAssignmentNetworkMembershipsForUser: async () => [
          { networkId: 'idx-a', isPersonal: false },
          { networkId: 'idx-b', isPersonal: false },
          { networkId: 'idx-owner-only', isPersonal: false },
        ],
      });
      const queue = new DiscoveryQueue({ database: db, invokeOpportunityGraph });

      await queue.runDiscover({ intentId: 'i1', userId: 'u1' });

      expect(invokeOpportunityGraph).toHaveBeenCalledWith(expect.objectContaining({
        indexScope: ['idx-a', 'idx-b'],
      }));
      expect(invokeOpportunityGraph.mock.calls[0]?.[0]).not.toHaveProperty('networkId');
    });

    it('allows explicit networkIds to narrow but never broaden authoritative scope', async () => {
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const db = asDb({
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getNetworkIdsForIntent: async () => ['idx-a', 'idx-b'],
        getAssignmentNetworkMembershipsForUser: async () => [
          { networkId: 'idx-a', isPersonal: false },
          { networkId: 'idx-b', isPersonal: false },
          { networkId: 'idx-foreign', isPersonal: false },
        ],
      });
      const queue = new DiscoveryQueue({ database: db, invokeOpportunityGraph });

      await queue.runDiscover({
        intentId: 'i1', userId: 'u1', networkIds: ['idx-foreign', 'idx-b'],
      });

      expect(invokeOpportunityGraph).toHaveBeenCalledWith(expect.objectContaining({ networkId: 'idx-b' }));
      expect(invokeOpportunityGraph.mock.calls[0]?.[0]).not.toHaveProperty('indexScope');
    });

    it('fails closed for foreign explicit scope', async () => {
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => ['idx-assigned'],
          getAssignmentNetworkMembershipsForUser: async () => [{ networkId: 'idx-assigned', isPersonal: false }],
        }),
        invokeOpportunityGraph,
      });

      await queue.runDiscover({
        intentId: 'i1', userId: 'u1', networkIds: ['idx-foreign'],
      });

      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
    });

    it('fails closed when the intent has no network assignments', async () => {
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const markIntentFirstDiscoverySucceeded = mock(async (_intentId: string) => {});
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => [],
          getAssignmentNetworkMembershipsForUser: async () => [{ networkId: 'idx-owner-only', isPersonal: false }],
          markIntentFirstDiscoverySucceeded,
        }),
        invokeOpportunityGraph,
      });

      await queue.runDiscover({ intentId: 'i1', userId: 'u1' });

      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
      expect(markIntentFirstDiscoverySucceeded).not.toHaveBeenCalled();
    });

    it('fails closed when assignment membership lookup excludes a soft-deleted membership', async () => {
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => ['idx-soft-deleted'],
          // The production lookup omits soft-deleted membership/network rows.
          getAssignmentNetworkMembershipsForUser: async () => [],
        }),
        invokeOpportunityGraph,
      });

      await queue.runDiscover({ intentId: 'i1', userId: 'u1' });

      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
    });

    it('keeps an assigned owner personal network eligible', async () => {
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => ['personal-net'],
          getAssignmentNetworkMembershipsForUser: async () => [{ networkId: 'personal-net', isPersonal: true }],
        }),
        invokeOpportunityGraph,
      });

      await queue.runDiscover({ intentId: 'i1', userId: 'u1' });

      expect(invokeOpportunityGraph).toHaveBeenCalledWith(expect.objectContaining({ networkId: 'personal-net' }));
    });

    it('discover: empty explicit networkIds skips fail-closed instead of broadening', async () => {
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        }),
        invokeOpportunityGraph,
      });
      await queue.runDiscover({
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
          sameIntentPairDuplicateSuppressions: 1,
          crossIntentPairAllowedCount: 0,
          finalAtomicConflictCount: 0,
        },
      });

      expect(evaluatorZero.completionReason).toBe('evaluator_rejected_all');
      expect(persistenceDedupZero.completionReason).toBe('same_intent_pair_duplicate_suppressed');
    });

    it('reports persisted different-intent-pair matches as created without an atomic conflict', () => {
      const summary = summarizeOpportunityDiscoveryResult({
        candidates: [{}, {}],
        evaluatedOpportunities: [{}, {}],
        opportunities: [{}, {}],
        persistenceOutcome: {
          evaluatedCount: 2,
          sameIntentPairDuplicateSuppressions: 0,
          crossIntentPairAllowedCount: 1,
          finalAtomicConflictCount: 0,
        },
      });

      expect(summary).toMatchObject({
        candidatesFound: 2,
        evaluatedCount: 2,
        opportunitiesCreated: 2,
        completionReason: 'created_or_reactivated',
        crossIntentPairAllowedCount: 1,
        finalAtomicConflictCount: 0,
      });
      expect(summary).not.toHaveProperty('pairActiveNegotiationSuppressions');
    });
  });

  describe('same-intent overlap guard', () => {
    it('a second run for an intent already scanning waits, then runs once the first releases', async () => {
      let releaseFirst: (() => void) | undefined;
      const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
      const started: string[] = [];
      const invokeOpportunityGraph = mock(async (opts: DiscoveryGraphInvokeOptions) => {
        started.push(opts.triggerIntentId ?? '?');
        if (started.length === 1) await firstGate;
      });
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'intent-same', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        }),
        invokeOpportunityGraph,
        sameIntentDeferDelayMs: 10,
      });

      const first = queue.runDiscover({ intentId: 'intent-same', userId: 'u1' });
      await Bun.sleep(5);
      // Arrives while the first scan is in flight; without the guard both would run at once.
      const second = queue.runDiscover({ intentId: 'intent-same', userId: 'u1' });
      await Bun.sleep(30);
      expect(started).toEqual(['intent-same']);

      releaseFirst?.();
      await Promise.all([first, second]);
      expect(started).toEqual(['intent-same', 'intent-same']);
    });

    it('two different intents scan side by side, unbounded', async () => {
      const started: string[] = [];
      const invokeOpportunityGraph = mock(async (opts: DiscoveryGraphInvokeOptions) => {
        started.push(opts.triggerIntentId ?? '?');
      });
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async (id: string) => ({ id, payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        }),
        invokeOpportunityGraph,
      });

      await Promise.all([
        queue.runDiscover({ intentId: 'intent-a', userId: 'u1' }),
        queue.runDiscover({ intentId: 'intent-b', userId: 'u1' }),
      ]);

      expect(started.sort()).toEqual(['intent-a', 'intent-b']);
    });

    it('a waiter that never wins the lock gives up rather than spinning forever', async () => {
      const recordIntentDiscoveryProgress = mock(async (_input: ProgressWrite) => {});
      const invokeOpportunityGraph = mock(async (_opts: DiscoveryGraphInvokeOptions) => {});
      const queue = new DiscoveryQueue({
        database: asDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          recordIntentDiscoveryProgress,
        }),
        invokeOpportunityGraph,
        intentLock: { tryAcquire: async () => false, release: async () => {} },
        sameIntentDeferDelayMs: 5,
        maxSameIntentWaitMs: 20,
      });

      await expect(queue.runDiscover({ intentId: 'i1', userId: 'u1' })).rejects.toThrow(/same-intent/i);
      expect(invokeOpportunityGraph).not.toHaveBeenCalled();
      expect(progressWrite(recordIntentDiscoveryProgress, 'failed')).toBeDefined();
    });
  });
});
