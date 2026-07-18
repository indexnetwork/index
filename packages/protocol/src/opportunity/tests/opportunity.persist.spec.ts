/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import type { Opportunity, CreateOpportunityData, OpportunityStatus } from "../../shared/interfaces/database.interface.js";
import type { Embedder } from "../../shared/interfaces/embedder.interface.js";
import { persistOpportunities, type PersistOpportunityDatabase } from "../opportunity.persist.js";

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
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [{ networkId: 'net-1' as never, userId: 'user-1' as never, role: 'patient' }],
    interpretation: {
      category: 'collaboration',
      reasoning: 'Good fit',
      confidence: 0.8,
      signals: [],
    },
    context: { networkId: 'net-1' as never },
    confidence: '0.8',
    status: 'pending',
    ...overrides,
  };
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

  it('normalizes null-like runtime actor intents without mutating inputs', async () => {
    const nullLikeValues: unknown[] = [null, undefined, '', '   ', 'null', ' NULL ', 'undefined'];

    for (const value of nullLikeValues) {
      const inputActor = {
        networkId: 'net-1',
        userId: 'user-1',
        role: 'patient',
        intent: value,
        preserved: { source: 'test' },
      };
      let persisted: CreateOpportunityData | undefined;
      const database = {
        findOpportunitiesByActors: async () => [],
        createOpportunity: async (data: CreateOpportunityData) => {
          persisted = data;
          return makeOpportunity({ actors: data.actors });
        },
        updateOpportunityStatus: async () => {},
      };

      await persistOpportunities({
        database,
        embedder: mockEmbedder,
        items: [makeCreateData({ actors: [inputActor] as never })],
      });

      const persistedActor = persisted?.actors[0] as unknown as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(persistedActor, 'intent')).toBe(false);
      expect(persistedActor.preserved).toEqual({ source: 'test' });
      expect(persistedActor).not.toBe(inputActor);
      expect(inputActor.intent).toBe(value);
      expect(inputActor.preserved).toEqual({ source: 'test' });
    }
  });

  it('preserves and trims valid non-UUID actor intents', async () => {
    const inputActor = {
      networkId: 'net-1',
      userId: 'user-1',
      role: 'patient',
      intent: '  intent-1  ',
    };
    let persisted: CreateOpportunityData | undefined;
    const database = {
      findOpportunitiesByActors: async () => [],
      createOpportunity: async (data: CreateOpportunityData) => {
        persisted = data;
        return makeOpportunity({ actors: data.actors });
      },
      updateOpportunityStatus: async () => {},
    };

    await persistOpportunities({
      database,
      embedder: mockEmbedder,
      items: [makeCreateData({ actors: [inputActor] as never })],
    });

    expect(persisted?.actors[0]?.intent).toBe('intent-1');
    expect(inputActor.intent).toBe('  intent-1  ');
  });

  it('removes malformed intents before enrichment overlap checks', async () => {
    const existing = makeOpportunity({
      actors: [{
        networkId: 'net-1',
        userId: 'user-1',
        role: 'patient',
        intent: 'null',
      }] as never,
      interpretation: {
        category: 'collaboration',
        reasoning: 'short',
        confidence: 0.5,
        signals: [],
      },
    });
    let atomicCalled = false;
    let persisted: CreateOpportunityData | undefined;
    const database = {
      findOpportunitiesByActors: async () => [existing],
      createOpportunity: async (data: CreateOpportunityData) => {
        persisted = data;
        return makeOpportunity({ actors: data.actors });
      },
      createOpportunityAndExpireIds: async () => {
        atomicCalled = true;
        return { created: makeOpportunity(), expired: [existing] };
      },
      updateOpportunityStatus: async () => {},
    };
    const input = makeCreateData({
      actors: [{ networkId: 'net-1', userId: 'user-1', role: 'patient', intent: 'null' }] as never,
      interpretation: {
        category: 'collaboration',
        reasoning: 'short',
        confidence: 0.8,
        signals: [],
      },
    });

    await persistOpportunities({ database, embedder: mockEmbedder, items: [input] });

    expect(atomicCalled).toBe(false);
    expect(persisted).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(persisted!.actors[0], 'intent')).toBe(false);
    expect(input.actors[0]?.intent).toBe('null');
  });

  it('normalizes actors immediately before every create path', async () => {
    const existing = makeOpportunity({
      id: 'opp-existing',
      actors: [
        { networkId: 'net-1', userId: 'user-1', role: 'patient', intent: 'intent-shared' },
        {
          networkId: 'net-1',
          userId: 'user-2',
          role: 'agent',
          intent: ' undefined ',
          preserved: 'legacy-key',
        },
      ] as never,
    });
    const eligibility = { ownerUserId: 'user-1', allowedNetworkIds: ['net-1'] };

    async function runPath(
      path: 'plain' | 'atomic' | 'eligible' | 'eligible-atomic',
    ): Promise<CreateOpportunityData> {
      let persisted: CreateOpportunityData | undefined;
      const enrichedPath = path !== 'eligible';
      const database: PersistOpportunityDatabase = {
        findOpportunitiesByActors: async () => enrichedPath ? [existing] : [],
        createOpportunity: async (data) => {
          persisted = data;
          return makeOpportunity({ id: `opp-${path}`, actors: data.actors });
        },
        updateOpportunityStatus: async () => {},
      };

      if (path === 'atomic') {
        database.createOpportunityAndExpireIds = async (data) => {
          persisted = data;
          return {
            created: makeOpportunity({ id: 'opp-atomic', actors: data.actors }),
            expired: [existing],
          };
        };
      }
      if (path === 'eligible') {
        database.createOpportunityIfNetworkEligible = async (data) => {
          persisted = data;
          return makeOpportunity({ id: 'opp-eligible', actors: data.actors });
        };
      }
      if (path === 'eligible-atomic') {
        database.createOpportunityAndExpireIdsIfNetworkEligible = async (data) => {
          persisted = data;
          return {
            created: makeOpportunity({ id: 'opp-eligible-atomic', actors: data.actors }),
            expired: [existing],
          };
        };
      }

      const actors = enrichedPath
        ? [{ networkId: 'net-1', userId: 'user-1', role: 'patient', intent: 'intent-shared' }]
        : [{ networkId: 'net-1', userId: 'user-1', role: 'patient', intent: ' NULL ' }];
      const result = await persistOpportunities({
        database,
        embedder: mockEmbedder,
        items: [makeCreateData({ actors: actors as never })],
        ...(path.startsWith('eligible') ? { networkEligibility: eligibility } : {}),
      });

      expect(result.errors).toBeUndefined();
      expect(result.created).toHaveLength(1);
      expect(persisted).toBeDefined();
      return persisted!;
    }

    for (const path of ['plain', 'atomic', 'eligible', 'eligible-atomic'] as const) {
      const persisted = await runPath(path);
      for (const actor of persisted.actors) {
        expect(actor.intent).not.toBe('null');
        expect(actor.intent).not.toBe('undefined');
        expect(actor.intent?.trim().toLowerCase()).not.toBe('null');
        expect(actor.intent?.trim().toLowerCase()).not.toBe('undefined');
      }
      if (path !== 'eligible') {
        const legacyActor = persisted.actors.find((actor) => actor.userId === 'user-2') as unknown as Record<string, unknown>;
        expect(legacyActor.preserved).toBe('legacy-key');
        expect(Object.prototype.hasOwnProperty.call(legacyActor, 'intent')).toBe(false);
      }
    }
  });
});
