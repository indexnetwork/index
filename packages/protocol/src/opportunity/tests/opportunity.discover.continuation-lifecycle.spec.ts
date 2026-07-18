import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, expect, test } from 'bun:test';

import { continueDiscovery } from '../opportunity.discover.js';
import type { Opportunity } from '../../shared/interfaces/database.interface.js';

const viewerId = 'continuation-viewer';
const candidateId = 'continuation-candidate';
const persistedAt = new Date('2026-06-01T12:00:00.000Z');

function opportunity(status: Opportunity['status']): Opportunity {
  return {
    id: 'continuation-opportunity',
    detection: { source: 'opportunity_graph', timestamp: persistedAt.toISOString() },
    actors: [
      { userId: viewerId, networkId: 'network-1', role: 'patient' },
      { userId: candidateId, networkId: 'network-1', role: 'agent' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: 'A relevant collaboration.',
      confidence: 0.9,
      signals: [],
    },
    context: { networkId: 'network-1' },
    confidence: '0.9',
    status,
    createdAt: persistedAt,
    updatedAt: persistedAt,
    expiresAt: null,
  };
}

describe('continueDiscovery lifecycle refresh', () => {
  test('preserves the current database status instead of the persist-time or chat-session projection', async () => {
    const graphOpportunity = opportunity('negotiating');
    const currentOpportunity = { ...graphOpportunity, status: 'rejected' as const, updatedAt: new Date(persistedAt.getTime() + 1_000) };
    let refreshedIds: string[] = [];

    const result = await continueDiscovery({
      opportunityGraph: {
        invoke: async () => ({
          opportunities: [graphOpportunity],
          remainingCandidates: [],
          trace: [],
        }),
      } as never,
      database: {
        getOpportunitiesByIds: async (ids: string[]) => {
          refreshedIds = ids;
          return [currentOpportunity];
        },
        getProfile: async () => ({
          identity: { name: 'Candidate' },
          context: '',
        }),
        getUser: async (id: string) => ({
          id,
          name: id === viewerId ? 'Viewer' : 'Candidate',
          email: `${id}@test.local`,
          socials: [],
        }),
      } as never,
      cache: {
        get: async () => ({
          candidates: [],
          userId: viewerId,
          query: 'find a collaborator',
          indexScope: ['network-1'],
          options: {},
          trigger: 'orchestrator',
        }),
        set: async () => undefined,
        delete: async () => undefined,
      } as never,
      userId: viewerId,
      discoveryId: 'continuation-id',
      chatSessionId: 'chat-session-1',
      minimalForChat: true,
    });

    expect(refreshedIds).toEqual([graphOpportunity.id]);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities?.[0].status).toBe('rejected');
    expect(result.opportunities?.[0].homeCardPresentation?.personalizedSummary).toBeTruthy();
  });
});
