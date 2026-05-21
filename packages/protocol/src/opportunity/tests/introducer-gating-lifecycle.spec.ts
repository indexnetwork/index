import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, test, expect } from 'bun:test';
import { OpportunityGraphFactory } from '../opportunity.graph.js';
import type { Id } from '../../types/common.types.js';
import type {
  OpportunityGraphDatabase,
  OpportunityActor,
  Opportunity,
} from '../../shared/interfaces/database.interface.js';
import type { Embedder } from '../../shared/interfaces/embedder.interface.js';
import type { OpportunityEvaluatorLike } from '../opportunity.graph.js';

const dummyEmbedding = new Array(2000).fill(0.1);

const mockEvaluator: OpportunityEvaluatorLike = {
  invokeEntityBundle: async () => [],
};

describe('introducer gating lifecycle', () => {
  test('gate → approve → queueNegotiateExisting → negotiate_existing → notify non-introducers only', async () => {
    const OPP_ID = 'opp-lifecycle';
    const state = {
      actors: [
        { userId: 'patient-user' as Id<'users'>, role: 'patient' as const, networkId: 'idx-1' as Id<'networks'>, intentId: 'intent-patient' as Id<'intents'>, approved: undefined },
        { userId: 'agent-user' as Id<'users'>, role: 'agent' as const, networkId: 'idx-1' as Id<'networks'>, intentId: 'intent-agent' as Id<'intents'>, approved: undefined },
        { userId: 'introducer-user' as Id<'users'>, role: 'introducer' as const, networkId: 'idx-1' as Id<'networks'>, intentId: undefined, approved: false },
      ] as OpportunityActor[],
    };
    const currentOpp = (): Opportunity => ({
      id: OPP_ID,
      detection: { source: 'manual' as const, createdBy: 'introducer-user' as Id<'users'> },
      actors: state.actors,
      interpretation: { reasoning: 'Great match.' },
      context: null,
      confidence: 0.9,
      status: 'latent' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    }) as unknown as Opportunity;

    const negotiationInvocations: unknown[] = [];
    const notifiedUserIds: string[] = [];
    const queueNegotiateExistingCalls: Array<{ opportunityId: string; userId: string }> = [];

    const mockNegotiationGraph = {
      invoke: async (input: unknown) => {
        negotiationInvocations.push(input);
        return {
          outcome: {
            hasOpportunity: true,
            agreedRoles: [
              { userId: 'patient-user', role: 'patient' as const },
              { userId: 'agent-user', role: 'agent' as const },
            ],
            reasoning: 'Accepted.',
            turnCount: 2,
          },
        };
      },
    };

    const mockDb: OpportunityGraphDatabase = {
      getProfile: () => Promise.resolve(null),
      createOpportunity: (data) => Promise.resolve({ id: 'unused', ...data, status: data.status ?? 'latent', createdAt: new Date(), updatedAt: new Date(), expiresAt: null }),
      opportunityExistsBetweenActors: () => Promise.resolve(false),
      findOpportunitiesByActors: () => Promise.resolve([]),
      getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
      getNetworkMemberships: async () => [],
      getActiveIntents: (userId: string) => Promise.resolve([
        { id: `intent-${userId}` as Id<'intents'>, payload: `Intent for ${userId}`, summary: null, createdAt: new Date() },
      ]),
      getNetworkIdsForIntent: () => Promise.resolve([]),
      getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
      getNetworkMemberCount: () => Promise.resolve(2),
      getIntentIndexScores: async () => [],
      getNetworkMemberContext: async () => null,
      getUser: (id: string) => Promise.resolve({ id, name: `User ${id}`, email: `${id}@example.com` }),
      isNetworkMember: () => Promise.resolve(false),
      isIndexOwner: () => Promise.resolve(false),
      getOpportunity: (id: string) => id === OPP_ID ? Promise.resolve(currentOpp()) : Promise.resolve(null),
      getOpportunitiesForUser: () => Promise.resolve([]),
      updateOpportunityStatus: () => Promise.resolve(null),
      updateOpportunityActorApproval: (_id, userId, approved) => {
        state.actors = state.actors.map((a) =>
          a.role === 'introducer' && a.userId === userId ? { ...a, approved } : a,
        );
        return Promise.resolve(currentOpp());
      },
      getIntent: () => Promise.resolve(null),
    };

    const mockEmbedder = { generate: async () => dummyEmbedding } as unknown as Embedder;
    const mockHyde = { invoke: async () => ({ hydeEmbeddings: {} }) };
    const queueNotification = async (_oppId: string, userId: string) => { notifiedUserIds.push(userId); };

    let compiledGraph: ReturnType<OpportunityGraphFactory['createGraph']>;
    const queueNegotiateExisting = async (opportunityId: string, userId: string) => {
      queueNegotiateExistingCalls.push({ opportunityId, userId });
      await compiledGraph.invoke({
        userId: userId as Id<'users'>,
        operationMode: 'negotiate_existing' as const,
        opportunityId,
        options: {},
      });
    };

    const factory = new OpportunityGraphFactory(
      mockDb,
      mockEmbedder,
      mockHyde,
      mockEvaluator,
      queueNotification,
      mockNegotiationGraph,
      undefined,
      queueNegotiateExisting,
    );
    compiledGraph = factory.createGraph();

    expect(negotiationInvocations).toHaveLength(0);

    await compiledGraph.invoke({
      userId: 'introducer-user' as Id<'users'>,
      opportunityId: OPP_ID,
      operationMode: 'approve_introduction' as const,
    });

    const postApprovalIntroducer = state.actors.find((a) => a.role === 'introducer');
    expect(postApprovalIntroducer?.approved).toBe(true);
    expect(queueNegotiateExistingCalls).toEqual([{ opportunityId: OPP_ID, userId: 'introducer-user' }]);
    expect(negotiationInvocations.length).toBeGreaterThan(0);
    expect(notifiedUserIds).toContain('patient-user');
    expect(notifiedUserIds).toContain('agent-user');
    expect(notifiedUserIds).not.toContain('introducer-user');
  });
});
