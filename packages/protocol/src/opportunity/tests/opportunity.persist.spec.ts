/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect } from "bun:test";
import type { Opportunity, CreateOpportunityData, OpportunityStatus } from "../../shared/interfaces/database.interface.js";
import type { Embedder } from "../../shared/interfaces/embedder.interface.js";
import { persistOpportunities } from "../opportunity.persist.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    status: 'pending',
    payload: 'Test opportunity',
    actors: [],
    score: 80,
    reasoning: 'Test reasoning',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Opportunity;
}

function makeCreateData(overrides: Partial<CreateOpportunityData> = {}): CreateOpportunityData {
  return {
    payload: 'New opportunity',
    actors: [{ userId: 'user-1', role: 'patient', intentId: null }],
    score: 80,
    reasoning: 'Good fit',
    status: 'pending',
    ...overrides,
  } as CreateOpportunityData;
}

const mockEmbedder: Embedder = {
  generate: async () => [0.1, 0.2, 0.3],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('persistOpportunities', () => {
  it('creates a single opportunity when no overlap found', async () => {
    const created = makeOpportunity({ id: 'opp-new', status: 'pending' });

    const database = {
      findOpportunitiesByActors: async () => [],
      createOpportunity: async () => created,
      updateOpportunityStatus: async () => {},
    };

    const result = await persistOpportunities({
      database,
      embedder: mockEmbedder,
      items: [makeCreateData()],
    });

    expect(result.created).toHaveLength(1);
    expect(result.created[0].id).toBe('opp-new');
    expect(result.expired).toHaveLength(0);
    expect(result.errors).toBeUndefined();
  });

  it('returns errors array when an item fails, without throwing', async () => {
    const database = {
      findOpportunitiesByActors: async () => { throw new Error('DB error'); },
      createOpportunity: async () => makeOpportunity(),
      updateOpportunityStatus: async () => {},
    };

    const result = await persistOpportunities({
      database,
      embedder: mockEmbedder,
      items: [makeCreateData()],
    });

    expect(result.created).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].itemIndex).toBe(0);
  });

  it('calls injectChat for pending opportunities', async () => {
    const created = makeOpportunity({ id: 'opp-inject', status: 'pending' });
    const injectedIds: string[] = [];

    const database = {
      findOpportunitiesByActors: async () => [],
      createOpportunity: async () => created,
      updateOpportunityStatus: async () => {},
    };

    await persistOpportunities({
      database,
      embedder: mockEmbedder,
      items: [makeCreateData()],
      injectChat: async (opp) => { injectedIds.push(opp.id); },
    });

    expect(injectedIds).toContain('opp-inject');
  });

  it('does not call injectChat for non-pending opportunities', async () => {
    const created = makeOpportunity({ id: 'opp-no-inject', status: 'expired' });
    const injectedIds: string[] = [];

    const database = {
      findOpportunitiesByActors: async () => [],
      createOpportunity: async () => created,
      updateOpportunityStatus: async () => {},
    };

    await persistOpportunities({
      database,
      embedder: mockEmbedder,
      items: [makeCreateData({ status: 'expired' })],
      injectChat: async (opp) => { injectedIds.push(opp.id); },
    });

    expect(injectedIds).toHaveLength(0);
  });

  it('handles multiple items, collecting all created', async () => {
    let callCount = 0;

    const database = {
      findOpportunitiesByActors: async () => [],
      createOpportunity: async () => {
        callCount++;
        return makeOpportunity({ id: `opp-${callCount}`, status: 'pending' });
      },
      updateOpportunityStatus: async () => {},
    };

    const result = await persistOpportunities({
      database,
      embedder: mockEmbedder,
      items: [makeCreateData(), makeCreateData(), makeCreateData()],
    });

    expect(result.created).toHaveLength(3);
    expect(result.errors).toBeUndefined();
  });

  it('uses atomic createOpportunityAndExpireIds when available and enrichment found overlaps', async () => {
    // Use matching intent IDs to trigger Phase 1 (intent-based) enrichment path
    const SHARED_INTENT = 'intent-shared-abc' as never;
    const actor = { userId: 'user-1' as never, role: 'patient', intent: SHARED_INTENT, networkId: 'net-1' as never };

    const existingOpp = makeOpportunity({
      id: 'opp-old',
      status: 'pending',
      actors: [actor],
    });
    const newOpp = makeOpportunity({ id: 'opp-new', status: 'pending' });
    const expiredOpp = makeOpportunity({ id: 'opp-old', status: 'expired' });

    let atomicCalled = false;

    const database = {
      findOpportunitiesByActors: async () => [existingOpp],
      createOpportunity: async () => newOpp,
      updateOpportunityStatus: async (_id: string, _status: OpportunityStatus) => {},
      createOpportunityAndExpireIds: async (_data: CreateOpportunityData, expireIds: string[]) => {
        atomicCalled = true;
        return { created: newOpp, expired: expireIds.map(() => expiredOpp) };
      },
    };

    const itemWithMatchingActor = makeCreateData({
      actors: [actor] as never,
      interpretation: { category: 'connection', reasoning: 'Shared ML intent', confidence: 0.9, signals: [] } as never,
    });

    const result = await persistOpportunities({
      database,
      embedder: mockEmbedder,
      items: [itemWithMatchingActor],
    });

    expect(atomicCalled).toBe(true);
    expect(result.created).toHaveLength(1);
    expect(result.expired).toHaveLength(1);
  });
});
