// Stub API key to prevent module-level createModel() from throwing
process.env.OPENROUTER_API_KEY = 'test-key-unused';

import { mock, describe, expect, it, afterAll } from 'bun:test';
import { getOrCreateDeliveryCardBatch } from './delivery-card.cache.js';
import type { OpportunityPresenter } from './opportunity.presenter.js';
import type { PresenterDatabase } from './opportunity.presenter.js';
import type { Cache } from '../shared/interfaces/cache.interface.js';

// Mock the gatherPresenterContext function
mock.module('./opportunity.presenter.js', () => ({
  gatherPresenterContext: mock(async (presenterDb: PresenterDatabase, opp: any, viewerId: string) => ({
    opportunityStatus: opp.status,
  })),
}));

afterAll(() => mock.restore());

describe('getOrCreateDeliveryCardBatch', () => {
  it('returns cached card without calling presenter on cache hit', async () => {
    const cachedCard = {
      opportunityId: 'opp-1',
      headline: 'Cached headline',
      personalizedSummary: 'Cached summary',
      suggestedAction: 'Cached action',
      narratorRemark: 'Cached remark',
    };

    let presentCalledCount = 0;
    const mockCache: Cache = {
      get: mock(() => Promise.resolve(null)),
      set: mock(() => Promise.resolve(undefined)),
      mget: mock(() => Promise.resolve([cachedCard])),
      delete: mock(() => Promise.resolve(undefined)),
      exists: mock(() => Promise.resolve(false)),
      deleteByPattern: mock(() => Promise.resolve(undefined)),
    };
    const mockPresenter = {
      presentHomeCard: mock(() => {
        presentCalledCount++;
        return Promise.resolve({
          headline: '',
          personalizedSummary: '',
          suggestedAction: '',
          narratorRemark: '',
        });
      }),
    } as unknown as OpportunityPresenter;
    const mockPresenterDb = {
      getProfile: mock(() => Promise.resolve(null)),
      getActiveIntents: mock(() => Promise.resolve([])),
      getNetwork: mock(() => Promise.resolve(null)),
    } as unknown as PresenterDatabase;

    const opportunities = [{ id: 'opp-1', status: 'pending', actors: [] }];
    const result = await getOrCreateDeliveryCardBatch(
      mockCache,
      mockPresenter,
      mockPresenterDb,
      opportunities as any,
      'user-1'
    );

    expect(result.get('opp-1')).toEqual(cachedCard);
    expect(presentCalledCount).toBe(0);
  });

  it('calls presenter and caches result on cache miss', async () => {
    const presentedCard = {
      headline: 'Generated headline',
      personalizedSummary: 'Generated summary',
      suggestedAction: 'Generated action',
      narratorRemark: 'Generated remark',
    };

    let presentCalledCount = 0;
    let setCalls: any[] = [];

    const mockCache: Cache = {
      get: mock(() => Promise.resolve(null)),
      set: mock((key: string, value: any, opts: any) => {
        setCalls.push({ key, value, opts });
        return Promise.resolve(undefined);
      }),
      mget: mock(() => Promise.resolve([null])),
      delete: mock(() => Promise.resolve(undefined)),
      exists: mock(() => Promise.resolve(false)),
      deleteByPattern: mock(() => Promise.resolve(undefined)),
    };
    const mockPresenter = {
      presentHomeCard: mock(() => {
        presentCalledCount++;
        return Promise.resolve(presentedCard);
      }),
    } as unknown as OpportunityPresenter;
    const mockPresenterDb = {
      getProfile: mock(() => Promise.resolve(null)),
      getActiveIntents: mock(() => Promise.resolve([])),
      getNetwork: mock(() => Promise.resolve(null)),
    } as unknown as PresenterDatabase;

    const opportunities = [{
      id: 'opp-2',
      status: 'pending',
      actors: [{ userId: 'user-1', role: 'candidate' }],
      interpretation: { reasoning: 'test' },
    }];

    const result = await getOrCreateDeliveryCardBatch(
      mockCache,
      mockPresenter,
      mockPresenterDb,
      opportunities as any,
      'user-1'
    );

    const resultCard = result.get('opp-2');
    expect(resultCard?.opportunityId).toBe('opp-2');
    expect(resultCard?.headline).toBe('Generated headline');
    expect(presentCalledCount).toBeGreaterThan(0);
    expect(setCalls.length).toBeGreaterThan(0);
    expect(setCalls[0].key).toBe('delivery:card:opp-2:pending:user-1');
    expect(setCalls[0].opts).toEqual({ ttl: 24 * 60 * 60 });
  });

  it('propagates presenter error so callers can handle failure', async () => {
    const mockCache: Cache = {
      get: mock(() => Promise.resolve(null)),
      set: mock(() => Promise.resolve(undefined)),
      mget: mock(() => Promise.resolve([null])),
      delete: mock(() => Promise.resolve(undefined)),
      exists: mock(() => Promise.resolve(false)),
      deleteByPattern: mock(() => Promise.resolve(undefined)),
    };
    const mockPresenter = {
      presentHomeCard: mock(() => Promise.reject(new Error('LLM unavailable'))),
    } as unknown as OpportunityPresenter;
    const mockPresenterDb = {
      getProfile: mock(() => Promise.resolve(null)),
      getActiveIntents: mock(() => Promise.resolve([])),
      getNetwork: mock(() => Promise.resolve(null)),
    } as unknown as PresenterDatabase;

    const opportunities = [{
      id: 'opp-err',
      status: 'pending',
      actors: [{ userId: 'user-1', role: 'candidate' }],
    }];

    await expect(
      getOrCreateDeliveryCardBatch(
        mockCache,
        mockPresenter,
        mockPresenterDb,
        opportunities as any,
        'user-1'
      )
    ).rejects.toThrow('LLM unavailable');
  });

  it('handles mixed batch with some hits and some misses', async () => {
    const cachedCard = {
      opportunityId: 'opp-1',
      headline: 'Cached',
      personalizedSummary: 'Cached summary',
      suggestedAction: 'Cached action',
      narratorRemark: 'Cached remark',
    };
    let presentCalledCount = 0;
    let setCalls: any[] = [];

    const mockCache: Cache = {
      get: mock(() => Promise.resolve(null)),
      set: mock((key: string, value: any, opts: any) => {
        setCalls.push({ key, value, opts });
        return Promise.resolve(undefined);
      }),
      mget: mock(() => Promise.resolve([cachedCard, null])),
      delete: mock(() => Promise.resolve(undefined)),
      exists: mock(() => Promise.resolve(false)),
      deleteByPattern: mock(() => Promise.resolve(undefined)),
    };

    const presentedCard = {
      headline: 'Generated',
      personalizedSummary: 'Generated summary',
      suggestedAction: 'Generated action',
      narratorRemark: 'Generated remark',
    };

    const mockPresenter = {
      presentHomeCard: mock(() => {
        presentCalledCount++;
        return Promise.resolve(presentedCard);
      }),
    } as unknown as OpportunityPresenter;
    const mockPresenterDb = {
      getProfile: mock(() => Promise.resolve(null)),
      getActiveIntents: mock(() => Promise.resolve([])),
      getNetwork: mock(() => Promise.resolve(null)),
    } as unknown as PresenterDatabase;

    const opportunities = [
      { id: 'opp-1', status: 'pending', actors: [] },
      { id: 'opp-2', status: 'pending', actors: [{ userId: 'user-1', role: 'candidate' }] },
    ];

    const result = await getOrCreateDeliveryCardBatch(
      mockCache,
      mockPresenter,
      mockPresenterDb,
      opportunities as any,
      'user-1'
    );

    expect(result.size).toBe(2);
    expect(result.get('opp-1')?.headline).toBe('Cached');
    expect(result.get('opp-2')?.headline).toBe('Generated');
    expect(presentCalledCount).toBe(1);
    expect(setCalls.length).toBe(1);
  });
});
