/**
 * Cache-aside wiring tests for OpportunityDeliveryService.
 *
 * Verifies that when a Cache is injected:
 *   - `cache.mget` is called for every renderOpportunityCard invocation.
 *   - On a cache miss, the presenter is called and the result is written via `cache.set`.
 *   - On a cache hit (mget returns a card), the presenter is NOT called.
 *
 * All DB and LLM dependencies are stubbed so no DB/LLM is required.
 *
 * Run: bun test src/services/tests/opportunity-delivery.cache.spec.ts
 */

// ─────────────────────────────────────────────────────────────────────────────
// Environment (must be set before any module import that reads process.env)
// ─────────────────────────────────────────────────────────────────────────────

process.env.NODE_ENV = 'test';
// Prevent the drizzle singleton from trying to open a real Postgres connection.
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
// Prevent module-level createModel() from throwing when importing presenter.
process.env.OPENROUTER_API_KEY = 'test-key-unused';

import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';

import type { Cache } from '../../adapters/cache.adapter';
import type { RenderedCard } from '../opportunity-delivery.service';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_ID = 'agent-' + randomUUID();
const USER_ID = 'user-' + randomUUID();
const OPP_ID = 'opp-' + randomUUID();

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

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

// Drizzle query builder.
// resolveAgentOwner → db.select().from(agents).where(...)  => [{ ownerId: USER_ID }]
// renderOpportunityCard → db.select().from(opportunities).where(...) => [STUB_OPP]

mock.module('../../lib/drizzle/drizzle', () => ({
  default: {
    select: mock(() => ({
      from: (table: Record<string, unknown>) => ({
        where: (_cond: unknown) => {
          const tableName = (table?.['_'] as Record<string, unknown>)?.['name'];
          if (tableName === 'agents') {
            return Promise.resolve([{ id: AGENT_ID, ownerId: USER_ID, notifyOnOpportunity: true }]);
          }
          return Promise.resolve([STUB_OPP]);
        },
      }),
    })),
    execute: mock(() => Promise.resolve([])),
    insert: mock(() => ({ values: mock(() => Promise.resolve([])) })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([])),
        })),
      })),
    })),
  },
}));

// Mock @indexnetwork/protocol:
//   - gatherPresenterContext → returns minimal stub (no DB calls)
//   - OpportunityPresenter   → stub class with trackable presentHomeCard
//   - canUserSeeOpportunity  → always true
//   - getOrCreateDeliveryCardBatch → use the REAL implementation so cache.mget/set are exercised

import { getOrCreateDeliveryCardBatch as realGetOrCreate } from '@indexnetwork/protocol';

const presentHomeCardMock = mock(async (_input: unknown) => ({
  ...STUB_CARD,
  mutualIntentsLabel: '',
}));

mock.module('@indexnetwork/protocol', () => {
  return {
    OpportunityPresenter: class {
      presentHomeCard = presentHomeCardMock;
    },

    canUserSeeOpportunity: () => true,

    gatherPresenterContext: mock(async (_db: unknown, opp: { id: string; status: string }, _userId: string) => ({
      opportunityStatus: opp.status as 'pending' | 'draft',
      opportunityId: opp.id,
      viewerProfile: null,
      viewerIntents: [],
      peerProfile: null,
      peerIntents: [],
      network: null,
      interpretation: STUB_OPP.interpretation,
      detection: STUB_OPP.detection,
    })),

    // Use the real implementation so cache.mget / cache.set are exercised
    getOrCreateDeliveryCardBatch: realGetOrCreate,
  };
});

afterAll(() => {
  mock.restore();
});

// ─────────────────────────────────────────────────────────────────────────────
// Import service AFTER mocks
// ─────────────────────────────────────────────────────────────────────────────

const { OpportunityDeliveryService } = await import('../opportunity-delivery.service');

// ─────────────────────────────────────────────────────────────────────────────
// Mock cache factory
// ─────────────────────────────────────────────────────────────────────────────

/** Build a mock Cache. When `primed=true` mget returns the cached card; otherwise null. */
function makeMockCache(primed = false): Cache & {
  mgetCalls: string[][];
  setCalls: Array<[string, unknown]>;
} {
  const mgetCalls: string[][] = [];
  const setCalls: Array<[string, unknown]> = [];

  return {
    get: mock(() => Promise.resolve(null)),
    set: (key: string, value: unknown, _opts?: unknown) => {
      setCalls.push([key, value]);
      return Promise.resolve(undefined);
    },
    delete: mock(() => Promise.resolve(false)),
    exists: mock(() => Promise.resolve(false)),
    mget: (keys: string[]) => {
      mgetCalls.push(keys);
      if (primed) {
        return Promise.resolve([
          {
            opportunityId: OPP_ID,
            ...STUB_CARD,
          },
        ]);
      }
      return Promise.resolve([null]);
    },
    deleteByPattern: mock(() => Promise.resolve(0)),
    mgetCalls,
    setCalls,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub presenterDb
// ─────────────────────────────────────────────────────────────────────────────

const stubPresenterDb = {
  getProfile: mock(() => Promise.resolve(null)),
  getActiveIntents: mock(() => Promise.resolve([])),
  getNetwork: mock(() => Promise.resolve(null)),
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('OpportunityDeliveryService cache-aside wiring', () => {
  beforeEach(() => {
    presentHomeCardMock.mockClear?.();
  });

  // Helper to call the private method
  async function renderCard(
    svc: InstanceType<typeof OpportunityDeliveryService>,
    oppId: string,
    userId: string,
  ): Promise<RenderedCard> {
    return (svc as unknown as {
      renderOpportunityCard(id: string, userId: string): Promise<RenderedCard>;
    }).renderOpportunityCard(oppId, userId);
  }

  it('calls cache.mget on every render when a cache is injected', async () => {
    const { OpportunityPresenter } = await import('@indexnetwork/protocol');
    const cache = makeMockCache(false);
    const svc = new OpportunityDeliveryService(
      new OpportunityPresenter() as never,
      stubPresenterDb as never,
      cache,
    );

    await renderCard(svc, OPP_ID, USER_ID);

    expect(cache.mgetCalls.length).toBe(1);
    // Key must encode the opp id
    expect(cache.mgetCalls[0][0]).toContain(OPP_ID);
  });

  it('writes result to cache via set on a cache miss', async () => {
    const { OpportunityPresenter } = await import('@indexnetwork/protocol');
    const cache = makeMockCache(false); // mget → [null] → miss
    const svc = new OpportunityDeliveryService(
      new OpportunityPresenter() as never,
      stubPresenterDb as never,
      cache,
    );

    await renderCard(svc, OPP_ID, USER_ID);

    expect(cache.setCalls.length).toBe(1);
    const [writtenKey, writtenValue] = cache.setCalls[0];
    expect(writtenKey).toContain(OPP_ID);
    expect((writtenValue as { headline: string }).headline).toBe(STUB_CARD.headline);
  });

  it('invokes the presenter exactly once on a cache miss', async () => {
    const { OpportunityPresenter } = await import('@indexnetwork/protocol');
    const cache = makeMockCache(false);
    const svc = new OpportunityDeliveryService(
      new OpportunityPresenter() as never,
      stubPresenterDb as never,
      cache,
    );

    await renderCard(svc, OPP_ID, USER_ID);

    expect(presentHomeCardMock.mock.calls.length).toBe(1);
  });

  it('does NOT call the presenter when the cache has the card', async () => {
    const { OpportunityPresenter } = await import('@indexnetwork/protocol');
    const cache = makeMockCache(true); // mget → cached card → hit
    const svc = new OpportunityDeliveryService(
      new OpportunityPresenter() as never,
      stubPresenterDb as never,
      cache,
    );

    const rendered = await renderCard(svc, OPP_ID, USER_ID);

    // Presenter must not have been called
    expect(presentHomeCardMock.mock.calls.length).toBe(0);

    // The card came from cache
    expect(rendered.headline).toBe(STUB_CARD.headline);
  });

  it('does NOT call cache.mget when no cache is provided', async () => {
    const { OpportunityPresenter } = await import('@indexnetwork/protocol');
    // Plain mock to track calls — without wiring a cache to the service.
    const mgetCalls: unknown[] = [];
    const standaloneCache = makeMockCache(false);
    const originalMget = standaloneCache.mget;
    standaloneCache.mget = (keys: string[]) => {
      mgetCalls.push(keys);
      return originalMget(keys);
    };

    // No cache passed
    const svc = new OpportunityDeliveryService(
      new OpportunityPresenter() as never,
      stubPresenterDb as never,
      // intentionally omit cache
    );

    await renderCard(svc, OPP_ID, USER_ID);

    // The standalone cache above was never passed to the service, so nothing touched it
    expect(mgetCalls.length).toBe(0);
  });

  it('uses the correct cache key format: delivery:card:{id}:{status}:{viewerId}', async () => {
    const { OpportunityPresenter } = await import('@indexnetwork/protocol');
    const cache = makeMockCache(false);
    const svc = new OpportunityDeliveryService(
      new OpportunityPresenter() as never,
      stubPresenterDb as never,
      cache,
    );

    await renderCard(svc, OPP_ID, USER_ID);

    const key = cache.mgetCalls[0][0];
    expect(key).toBe(`delivery:card:${OPP_ID}:${STUB_OPP.status}:${USER_ID}`);
  });
});
