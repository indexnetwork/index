/**
 * Cache-aside wiring tests for OpportunityDeliveryService.
 * All database, cache, and presenter dependencies are injected directly so the
 * spec cannot replace Bun's process-wide module registry.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';

import type { OpportunityPresenter, PresenterDatabase } from '@indexnetwork/protocol';

import type { Cache } from '../../adapters/cache.adapter';
import { OpportunityDeliveryService, type OpportunityDeliveryDatabase, type RenderedCard } from '../opportunity-delivery.service';

const USER_ID = `user-${randomUUID()}`;
const OPP_ID = `opp-${randomUUID()}`;

const STUB_CARD: RenderedCard = {
  headline: 'Test Headline',
  personalizedSummary: 'Test summary',
  suggestedAction: 'Test action',
  narratorRemark: 'Test remark',
};

const STUB_OPP = {
  id: OPP_ID,
  status: 'pending',
  actors: [{ userId: USER_ID, role: 'peer' }],
  interpretation: { reasoning: 'test reasoning', category: 'test' },
  detection: { kind: 'test', summary: 'test summary' },
  confidence: '0.9',
  context: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
};

const presentHomeCard = mock(async () => ({
  ...STUB_CARD,
  mutualIntentsLabel: '',
}));
const presenter = { presentHomeCard } as unknown as OpportunityPresenter;

const database = {
  select: mock(() => ({
    from: mock(() => ({
      where: mock(async () => [STUB_OPP]),
    })),
  })),
} as unknown as OpportunityDeliveryDatabase;

const presenterDb = {
  getProfile: mock(async () => null),
  getActiveIntents: mock(async () => []),
  getNetwork: mock(async () => null),
  getPremisesForUser: mock(async () => []),
} as unknown as PresenterDatabase;

/** Build a mock Cache. When primed, mget returns the cached card. */
function makeMockCache(primed = false): Cache & {
  mgetCalls: string[][];
  setCalls: Array<[string, unknown]>;
} {
  const mgetCalls: string[][] = [];
  const setCalls: Array<[string, unknown]> = [];

  return {
    get: mock(async () => null),
    set: async (key: string, value: unknown) => {
      setCalls.push([key, value]);
    },
    delete: mock(async () => false),
    exists: mock(async () => false),
    mget: async (keys: string[]) => {
      mgetCalls.push(keys);
      return primed ? [{ opportunityId: OPP_ID, ...STUB_CARD }] : [null];
    },
    deleteByPattern: mock(async () => 0),
    mgetCalls,
    setCalls,
  };
}

describe('OpportunityDeliveryService cache-aside wiring', () => {
  beforeEach(() => {
    presentHomeCard.mockClear();
  });

  async function renderCard(
    service: OpportunityDeliveryService,
    opportunityId: string,
    userId: string,
  ): Promise<RenderedCard> {
    return (service as unknown as {
      renderOpportunityCard(id: string, viewerId: string): Promise<RenderedCard>;
    }).renderOpportunityCard(opportunityId, userId);
  }

  function makeService(cache?: Cache) {
    return new OpportunityDeliveryService(presenter, presenterDb, cache, database);
  }

  it('calls cache.mget on every render when a cache is injected', async () => {
    const cache = makeMockCache();

    await renderCard(makeService(cache), OPP_ID, USER_ID);

    expect(cache.mgetCalls).toHaveLength(1);
    expect(cache.mgetCalls[0][0]).toContain(OPP_ID);
  });

  it('writes the rendered result on a cache miss', async () => {
    const cache = makeMockCache();

    await renderCard(makeService(cache), OPP_ID, USER_ID);

    expect(cache.setCalls).toHaveLength(1);
    const [writtenKey, writtenValue] = cache.setCalls[0];
    expect(writtenKey).toContain(OPP_ID);
    expect((writtenValue as { headline: string }).headline).toBe(STUB_CARD.headline);
  });

  it('invokes the presenter exactly once on a cache miss', async () => {
    await renderCard(makeService(makeMockCache()), OPP_ID, USER_ID);

    expect(presentHomeCard).toHaveBeenCalledTimes(1);
  });

  it('does not call the presenter on a cache hit', async () => {
    const rendered = await renderCard(makeService(makeMockCache(true)), OPP_ID, USER_ID);

    expect(presentHomeCard).not.toHaveBeenCalled();
    expect(rendered.headline).toBe(STUB_CARD.headline);
  });

  it('does not touch an unrelated cache when no cache is provided', async () => {
    const unrelated = makeMockCache();

    await renderCard(makeService(), OPP_ID, USER_ID);

    expect(unrelated.mgetCalls).toHaveLength(0);
  });

  it('uses the v2 cache key format', async () => {
    const cache = makeMockCache();

    await renderCard(makeService(cache), OPP_ID, USER_ID);

    expect(cache.mgetCalls[0][0]).toBe(`delivery:v2:card:${OPP_ID}:${STUB_OPP.status}:${USER_ID}`);
  });
});
