/**
 * Home Graph status filter: default narrows to latent/stalled/pending, overridable.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterEach, describe, test, expect } from 'bun:test';
import { HomeGraphFactory, DEFAULT_HOME_STATUSES, ALL_OPPORTUNITY_STATUSES } from '../feed/feed.graph.js';
import type { HomeGraphDatabase, Opportunity, OpportunityStatus } from '../../shared/interfaces/database.interface.js';
import type { OpportunityCache } from '../../shared/interfaces/cache.interface.js';

function createMockCache(): OpportunityCache {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (store.get(key) as T) ?? null,
    set: async <T>(key: string, value: T) => { store.set(key, value); },
    mget: async <T>(keys: string[]) => keys.map((k) => (store.get(k) as T) ?? null),
  };
}

/** Presenter-hit cache: lets full lifecycle tests prove ordering without LLM calls. */
function createPresenterHitCache(): OpportunityCache {
  return {
    get: async () => null,
    set: async () => {},
    mget: async <T>(keys: string[]) => keys.map((key, index) => {
      const opportunityId = key.split(':')[2] ?? `opportunity-${index}`;
      return {
        opportunityId,
        status: 'draft',
        userId: `counterpart-${index}`,
        name: `Counterpart ${index}`,
        avatar: null,
        mainText: 'Cached safe summary.',
        cta: 'Review this match.',
        primaryActionLabel: 'Connect',
        secondaryActionLabel: 'Skip',
        mutualIntentsLabel: 'Shared interests',
        _cardIndex: index,
      } as T;
    }),
  };
}

function createMockDb(
  captured: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string },
  rows: Opportunity[] = [],
): HomeGraphDatabase {
  return {
    getOpportunitiesForUser: (_userId: string, opts?: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string }) => {
      captured.statuses = opts?.statuses;
      captured.scopeType = opts?.scopeType;
      captured.scopeId = opts?.scopeId;
      return Promise.resolve(rows);
    },
    getOpportunity: () => Promise.resolve(null),
    getProfile: () => Promise.resolve(null),
    getActiveIntents: () => Promise.resolve([]),
    getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
    getUser: (id: string) => Promise.resolve({ id, name: 'User ' + id, email: '', avatar: null }),
  };
}

function opportunity(input: {
  id: string;
  counterpartId: string;
  confidence: number;
  updatedAt: string;
  factor?: number;
  detail?: string;
}): Opportunity {
  return {
    id: input.id,
    detection: { source: 'opportunity_graph', timestamp: input.updatedAt },
    actors: [
      { userId: 'u1' as never, networkId: 'network-1' as never, role: 'party' },
      { userId: input.counterpartId as never, networkId: 'network-1' as never, role: 'party' },
    ],
    interpretation: { category: 'connection', reasoning: 'Safe test summary.', confidence: input.confidence },
    context: {},
    confidence: String(input.confidence),
    status: 'draft',
    createdAt: new Date(input.updatedAt),
    updatedAt: new Date(input.updatedAt),
    expiresAt: null,
    metadata: input.factor === undefined ? {} : {
      poolAdjustments: [{
        questionId: 'question-1',
        label: 'Builders vs advisors',
        side: input.factor < 1 ? 'Advisors' : 'Builders',
        factor: input.factor,
        ...(input.detail ? { detail: input.detail } : {}),
        appliedAt: input.updatedAt,
      }],
    },
  };
}

describe('home graph status filter', () => {
  afterEach(() => {
    delete process.env.POOL_QUESTIONS_RANKING;
  });

  test('DEFAULT_HOME_STATUSES is exactly latent, pending', () => {
    expect(DEFAULT_HOME_STATUSES).toEqual(['latent', 'pending']);
  });

  test('ALL_OPPORTUNITY_STATUSES includes accepted/rejected/expired', () => {
    expect(ALL_OPPORTUNITY_STATUSES).toContain('accepted');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('rejected');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('expired');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('negotiating');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('draft');
  });

  test('default invocation passes DEFAULT_HOME_STATUSES to the database', async () => {
    const captured: { statuses?: OpportunityStatus[] } = {};
    const graph = new HomeGraphFactory(createMockDb(captured), createMockCache()).createGraph();
    await graph.invoke({ userId: 'u1' });
    expect(captured.statuses).toEqual(DEFAULT_HOME_STATUSES);
  });

  test('explicit statuses override the default', async () => {
    const captured: { statuses?: OpportunityStatus[] } = {};
    const graph = new HomeGraphFactory(createMockDb(captured), createMockCache()).createGraph();
    await graph.invoke({ userId: 'u1', statuses: ALL_OPPORTUNITY_STATUSES });
    expect(captured.statuses).toEqual(ALL_OPPORTUNITY_STATUSES);
  });

  test('explicit intent scope is forwarded with the load query before home dedupe', async () => {
    const captured: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string } = {};
    const graph = new HomeGraphFactory(createMockDb(captured), createMockCache()).createGraph();
    await graph.invoke({ userId: 'u1', scopeType: 'intent', scopeId: '00000000-0000-4000-8000-00000000a111' });
    expect(captured.statuses).toEqual(DEFAULT_HOME_STATUSES);
    expect(captured.scopeType).toBe('intent');
    expect(captured.scopeId).toBe('00000000-0000-4000-8000-00000000a111');
  });

  test('lifecycle order is unchanged while ranking is off and adjusted when on', async () => {
    const rows = [
      opportunity({
        id: 'newer-demoted',
        counterpartId: 'u2',
        confidence: 0.9,
        factor: 0.6,
        detail: 'Builders vs advisors: you chose Builders',
        updatedAt: '2026-07-15T12:10:00.000Z',
      }),
      opportunity({
        id: 'older-prioritized',
        counterpartId: 'u3',
        confidence: 0.7,
        factor: 1,
        updatedAt: '2026-07-15T12:00:00.000Z',
      }),
    ];

    const offGraph = new HomeGraphFactory(createMockDb({}, rows), createMockCache()).createGraph();
    const off = await offGraph.invoke({ userId: 'u1', statuses: ['draft'], presentation: 'skeleton' });
    expect(off.sections.flatMap((section) => section.items).map((item) => item.opportunityId))
      .toEqual(['newer-demoted', 'older-prioritized']);
    expect(off.sections.flatMap((section) => section.items)[0]?.deprioritizedReason).toBeUndefined();

    process.env.POOL_QUESTIONS_RANKING = 'on';
    const onGraph = new HomeGraphFactory(createMockDb({}, rows), createMockCache()).createGraph();
    const on = await onGraph.invoke({ userId: 'u1', statuses: ['draft'], presentation: 'skeleton' });
    const onItems = on.sections.flatMap((section) => section.items);
    expect(onItems.map((item) => item.opportunityId)).toEqual(['older-prioritized', 'newer-demoted']);
    expect(onItems[1]?.deprioritizedReason).toBe('Builders vs advisors: you chose Builders');

    // The full second phase must preserve that order too; otherwise the
    // categorizer can reshuffle sections before the intent page flattens them.
    const fullGraph = new HomeGraphFactory(createMockDb({}, rows), createPresenterHitCache()).createGraph();
    const full = await fullGraph.invoke({ userId: 'u1', statuses: ['draft'] });
    expect(full.sections.flatMap((section) => section.items).map((item) => item.opportunityId))
      .toEqual(['older-prioritized', 'newer-demoted']);
  });
});
