/**
 * Opportunity Graph: Trace event emission tests.
 *
 * Hypothesis: The bug occurs because the opportunity graph's non-evaluation nodes
 * (prep, scope, resolve, discovery, ranking, persist) do not emit agent_start/agent_end
 * trace events, leaving the frontend with no progress updates during the 10-30s pipeline.
 *
 * This test injects a traceEmitter via requestContext and verifies that every significant
 * node emits agent_start/agent_end events with kebab-case names.
 */

/** Config — must set OPENROUTER_API_KEY before any module-level createModel() runs */
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-key-unused";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dir, '../../../../..', '.env.test') });

import { describe, test, expect } from 'bun:test';
import { OpportunityGraphFactory, type OpportunityEvaluatorLike } from '../opportunity.graph';
import type { Id } from '../../../../types/common.types';
import type { OpportunityGraphDatabase } from '../../interfaces/database.interface';
import type { Embedder } from '../../interfaces/embedder.interface';
import type { EvaluatedOpportunityWithActors } from '../../agents/opportunity.evaluator';
import { requestContext } from '../../../request-context';

const dummyEmbedding = new Array(2000).fill(0.1);

const defaultMockEvaluatorResult: EvaluatedOpportunityWithActors[] = [
  {
    reasoning: 'Test reasoning for trace event test.',
    score: 88,
    actors: [
      { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
      { userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const, intentId: null },
    ],
  },
];

function createMockEvaluator(
  result: EvaluatedOpportunityWithActors[] = defaultMockEvaluatorResult
): OpportunityEvaluatorLike {
  return {
    invokeEntityBundle: async () => result,
  };
}

function createTraceMockGraph() {
  const mockDb: OpportunityGraphDatabase = {
    getProfile: () => Promise.resolve(null),
    createOpportunity: (data) =>
      Promise.resolve({
        id: 'opp-1',
        detection: data.detection,
        actors: data.actors,
        interpretation: data.interpretation,
        context: data.context,
        confidence: data.confidence,
        status: data.status ?? 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      }),
    opportunityExistsBetweenActors: () => Promise.resolve(false),
    getOpportunityBetweenActors: () => Promise.resolve(null),
    findOverlappingOpportunities: () => Promise.resolve([]),
    getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'indexes'>[]),
    getIndexMemberships: async () => [
      { indexId: 'idx-1', indexTitle: 'Test Index', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
    ],
    getActiveIntents: () =>
      Promise.resolve([
        {
          id: 'intent-1' as Id<'intents'>,
          payload: 'Looking for a technical co-founder',
          summary: 'Co-founder',
          createdAt: new Date(),
        },
      ]),
    getIndex: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
    getIndexMemberCount: () => Promise.resolve(2),
    getIndexIdsForIntent: () => Promise.resolve(['idx-1']),
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com' }),
    isIndexMember: () => Promise.resolve(true),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
    getIntentIndexScores: async () => [],
    getIndexMemberContext: async () => null,
  };

  const mockEmbedder: Embedder = {
    generate: () => Promise.resolve(dummyEmbedding),
    search: () => Promise.resolve([]),
    searchWithHydeEmbeddings: () =>
      Promise.resolve([
        {
          type: 'intent' as const,
          id: 'intent-bob' as Id<'intents'>,
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]),
    searchWithProfileEmbedding: () => Promise.resolve([]),
  } as unknown as Embedder;

  const mockHydeGenerator = {
    invoke: () =>
      Promise.resolve({
        hydeEmbeddings: {
          mirror: dummyEmbedding,
          reciprocal: dummyEmbedding,
        },
      }),
  };

  const evaluator = createMockEvaluator();
  const queueNotification = async () => undefined;
  const factory = new OpportunityGraphFactory(mockDb, mockEmbedder, mockHydeGenerator, evaluator, queueNotification);
  const compiledGraph = factory.createGraph();
  return { compiledGraph };
}

/** The node names we expect trace events for (kebab-case). */
const EXPECTED_NODE_TRACE_NAMES = [
  'opportunity-prep',
  'opportunity-scope',
  'opportunity-resolve',
  'opportunity-discovery',
  'opportunity-ranking',
  'opportunity-persist',
];

describe('Opportunity Graph — Trace Events', () => {
  test('emits agent_start/agent_end trace events for each significant node', async () => {
    const { compiledGraph } = createTraceMockGraph();
    const traceEvents: Array<{ type: string; name: string; durationMs?: number; summary?: string }> = [];
    const traceEmitter = (event: { type: string; name: string; durationMs?: number; summary?: string }) => {
      traceEvents.push(event);
    };

    // Run the graph inside a requestContext with our traceEmitter
    await requestContext.run({ traceEmitter }, async () => {
      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      });
    });

    // Verify that each expected node emitted both agent_start and agent_end
    for (const nodeName of EXPECTED_NODE_TRACE_NAMES) {
      const starts = traceEvents.filter(e => e.type === 'agent_start' && e.name === nodeName);
      const ends = traceEvents.filter(e => e.type === 'agent_end' && e.name === nodeName);

      expect(starts.length).toBeGreaterThanOrEqual(1);
      expect(ends.length).toBeGreaterThanOrEqual(1);

      // agent_end events must have durationMs
      for (const end of ends) {
        expect(end.durationMs).toBeDefined();
        expect(typeof end.durationMs).toBe('number');
      }
    }

    // Also verify the evaluation node still emits its own events (existing behavior)
    const evalStarts = traceEvents.filter(e => e.type === 'agent_start' && e.name === 'opportunity-evaluator');
    const evalEnds = traceEvents.filter(e => e.type === 'agent_end' && e.name === 'opportunity-evaluator');
    expect(evalStarts.length).toBeGreaterThanOrEqual(1);
    expect(evalEnds.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  test('trace events are in correct chronological order (start before end)', async () => {
    const { compiledGraph } = createTraceMockGraph();
    const traceEvents: Array<{ type: string; name: string; ts: number }> = [];
    const traceEmitter = (event: { type: string; name: string }) => {
      traceEvents.push({ ...event, ts: Date.now() });
    };

    await requestContext.run({ traceEmitter }, async () => {
      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      });
    });

    // For each node, verify start comes before end
    for (const nodeName of EXPECTED_NODE_TRACE_NAMES) {
      const start = traceEvents.find(e => e.type === 'agent_start' && e.name === nodeName);
      const end = traceEvents.find(e => e.type === 'agent_end' && e.name === nodeName);
      if (start && end) {
        expect(start.ts).toBeLessThanOrEqual(end.ts);
      }
    }
  }, 60_000);
});
