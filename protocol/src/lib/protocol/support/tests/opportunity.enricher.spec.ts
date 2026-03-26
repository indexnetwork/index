/**
 * Tests for opportunity enricher: enrichOrCreate, overlap detection, semantic relatedness, and merge.
 *
 * Overlap contract: findOverlappingOpportunities(actorUserIds) returns opportunities
 * whose non-introducer actors contain all given actorUserIds (containment match).
 * E.g. [A, B] matches an opportunity with actors [A, B, C].
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, test, expect } from 'bun:test';
import { enrichOrCreate } from '../opportunity.enricher';
import type { CreateOpportunityData, Opportunity } from '../../interfaces/database.interface';
import type { Embedder } from '../../interfaces/embedder.interface';

/**
 * Meaningful test data: intent IDs and domain-rich opportunity reasonings
 * (third-party analytical style, as produced by the opportunity evaluator).
 * Reasonings are grouped by domain; within a domain they are related to each other,
 * across domains they are not (e.g. AI/ML vs hardware vs design vs fundraising).
 */
const MEANINGFUL = {
  intentIds: {
    aliceMlCofounder: 'intent-alice-ml-cofounder',
    bobEarlyStage: 'intent-bob-early-stage',
    carolHardware: 'intent-carol-hardware',
    daveDesign: 'intent-dave-design',
    eveFundraising: 'intent-eve-fundraising',
  },
  reasoning: {
    // AI/ML domain (related to each other)
    aiMlCofounder:
      'The source user is seeking a technical co-founder for an AI/ML startup; the candidate has deep ML experience and has expressed interest in early-stage roles. Strong fit on domain and stage.',
    aiMlResearch:
      'Both parties have expressed interest in machine learning research and publication; their profiles show complementary skills in NLP and systems. A collaboration could yield joint work.',
    aiMlStartup:
      'Strong match for an early-stage AI company: the source is building in ML infrastructure and the candidate has prior startup experience in the same space.',
    // Hardware domain (related to each other)
    hardwarePrototyping:
      'The source is building hardware prototypes and needs someone with embedded systems experience; the candidate has a background in firmware and PCB design. Clear complementarity.',
    hardwareFirmware:
      'Both have experience in low-level systems and embedded firmware; the source is looking for a co-founder to build IoT devices and the candidate has shipped similar products.',
    // Design domain (related to each other)
    designUx:
      'Product design and UX collaboration: the source is a designer looking for a technical co-founder, the candidate has shipped consumer products with strong design sensibility.',
    designProduct:
      'The source is a product lead seeking a design partner for a new consumer app; the candidate has a strong portfolio in mobile and web design.',
    // Fundraising domain (related to each other)
    fundraising:
      'The source is raising a pre-seed round and the candidate is an angel with relevant sector experience; a warm intro could lead to a conversation.',
    fundraisingAngel:
      'The candidate has been an active angel in the source’s sector and could be a valuable intro for the current round.',
  },
} as const;

function minimalNewData(actorUserIds: string[], indexId: string, reasoning: string): CreateOpportunityData {
  const actors = actorUserIds.map((userId) => ({
    indexId,
    userId,
    role: 'party' as const,
  }));
  return {
    detection: { source: 'manual', createdBy: 'user-1', timestamp: new Date().toISOString() },
    actors,
    interpretation: {
      category: 'collaboration',
      reasoning,
      confidence: 0.8,
      signals: [{ type: 'curator_judgment', weight: 1, detail: 'Manual' }],
    },
    context: { indexId },
    confidence: '0.8',
    status: 'pending',
  };
}

function existingOpportunity(
  id: string,
  actors: Array<{ indexId: string; userId: string; role: string; intent?: string }>,
  reasoning: string,
  status: 'latent' | 'draft' | 'pending' | 'accepted' | 'rejected' | 'expired' = 'pending'
): Opportunity {
  return {
    id,
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: actors.map((a) => ({ ...a, indexId: a.indexId as typeof a.indexId })),
    interpretation: {
      category: 'collaboration',
      reasoning,
      confidence: 0.75,
      signals: [],
    },
    context: {},
    confidence: '0.75',
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };
}

describe('Opportunity enricher', () => {
  test('no overlap: returns original data unchanged', async () => {
    const db = {
      findOverlappingOpportunities: async () => [] as Opportunity[],
    };
    const embedder = { generate: async () => [[0.1, 0.2], [0.3, 0.4]] } as unknown as Embedder;
    const newData = minimalNewData(
      ['user-a', 'user-b'],
      'idx-1',
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const result = await enrichOrCreate(db, embedder, newData);
    expect(result.enriched).toBe(false);
    expect(result.data).toBe(newData);
  });

  test('irrelevant opportunity does not merge: overlap but not semantically related', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.hardwarePrototyping
    );
    const db = {
      findOverlappingOpportunities: async () => [existing],
    };
    const embedder = {
      generate: async () => [[1, 0, 0], [0, 1, 0]] as number[][],
    } as unknown as Embedder;
    const newData = minimalNewData(
      ['user-a', 'user-b'],
      'idx-1',
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(false);
    expect(result.data).toBe(newData);
    expect(result.data.detection.source).not.toBe('enrichment');
    expect(result.data.actors).toHaveLength(newData.actors.length);
  });

  test('relevant opportunity merges: overlap and semantically related', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const db = {
      findOverlappingOpportunities: async () => [existing],
    };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = {
      generate: async () => [sameVec, sameVec] as number[][],
    } as unknown as Embedder;
    const newData = minimalNewData(
      ['user-a', 'user-b'],
      'idx-1',
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-old']);
      expect(result.resolvedStatus).toBe('pending');
      expect(result.data.detection.source).toBe('enrichment');
      expect(result.data.detection.enrichedFrom).toEqual(['opp-old']);
      expect(result.data.actors.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('enriched status is accepted when related opportunity is accepted', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      MEANINGFUL.reasoning.aiMlResearch,
      'accepted'
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec] as number[][] } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlCofounder);
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.resolvedStatus).toBe('accepted');
      expect(result.expiredIds).toEqual(['opp-old']);
    }
  });

  test('multiple overlapping (same non-introducer set) and related: merges all and returns all expiredIds', async () => {
    // Both opp1 and opp2 have exact same non-introducer set {user-a, user-b} as newData (exact-match contract).
    const opp1 = existingOpportunity(
      'opp-1',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const opp2 = existingOpportunity(
      'opp-2',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'peer' },
        { indexId: 'idx-1', userId: 'user-b', role: 'peer' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const db = {
      findOverlappingOpportunities: async () => [opp1, opp2],
    };
    const sameVec = [0.6, 0.6, 0.6];
    const embedder = {
      generate: async () => [sameVec, sameVec, sameVec] as number[][],
    } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch);
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toContain('opp-1');
      expect(result.expiredIds).toContain('opp-2');
      expect(result.expiredIds).toHaveLength(2);
      expect(result.resolvedStatus).toBe('pending');
      const userIds = new Set(result.data.actors.map((a) => a.userId));
      expect(userIds.has('user-a')).toBe(true);
      expect(userIds.has('user-b')).toBe(true);
    }
  });

  test('actor deduplication: same (indexId, userId, intent) appears once', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec] as number[][] } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlCofounder);
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      const keys = result.data.actors.map((a) => `${a.indexId}:${a.userId}:${a.intent ?? ''}`);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    }
  });

  test('introducer not used for overlap; introducers preserved in merge', async () => {
    const newDataWithIntroducer: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlCofounder),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
        { indexId: 'idx-1', userId: 'user-intro', role: 'introducer' },
      ],
    };
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec] as number[][] } as unknown as Embedder;
    const result = await enrichOrCreate(db, embedder, newDataWithIntroducer, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      const introducers = result.data.actors.filter((a) => a.role === 'introducer');
      expect(introducers.some((a) => a.userId === 'user-intro')).toBe(true);
    }
  });

  test('short reasoning uses intent overlap for relatedness', async () => {
    const sharedIntent = MEANINGFUL.intentIds.aliceMlCofounder;
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'Short.'
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const embedder = { generate: async () => [] } as unknown as Embedder;
    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', 'Hi'),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const result = await enrichOrCreate(db, embedder, newData);
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-old']);
      expect(result.resolvedStatus).toBe('pending');
    }
  });

  test('when incoming status is draft and enrichment merges with latent, resolved status stays draft (chat-only, not home)', async () => {
    const sharedIntent = MEANINGFUL.intentIds.aliceMlCofounder;
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'Short.',
      'latent'
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const embedder = { generate: async () => [] } as unknown as Embedder;
    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', 'Hi'),
      status: 'draft',
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const result = await enrichOrCreate(db, embedder, newData);
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-old']);
      expect(result.resolvedStatus).toBe('draft');
    }
  });

  test('when incoming status is draft and enrichment merges with expired, resolved status stays draft (chat-only)', async () => {
    const sharedIntent = MEANINGFUL.intentIds.aliceMlCofounder;
    const existing = existingOpportunity(
      'opp-expired',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'Short.',
      'expired'
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const embedder = { generate: async () => [] } as unknown as Embedder;
    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', 'Hi'),
      status: 'draft',
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const result = await enrichOrCreate(db, embedder, newData);
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-expired']);
      expect(result.resolvedStatus).toBe('draft');
    }
  });

  test('when incoming status is latent and enrichment merges with draft, resolved status stays latent (broker not downgraded by chat draft)', async () => {
    const sharedIntent = MEANINGFUL.intentIds.aliceMlCofounder;
    const existing = existingOpportunity(
      'opp-draft',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'Short.',
      'draft'
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const embedder = { generate: async () => [] } as unknown as Embedder;
    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', 'Hi'),
      status: 'latent',
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const result = await enrichOrCreate(db, embedder, newData);
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-draft']);
      expect(result.resolvedStatus).toBe('latent');
    }
  });

  test('no non-introducer actors: returns original data unchanged', async () => {
    const newDataOnlyIntroducers: CreateOpportunityData = {
      ...minimalNewData([], 'idx-1', MEANINGFUL.reasoning.fundraising),
      actors: [{ indexId: 'idx-1', userId: 'user-intro', role: 'introducer' }],
    };
    const db = { findOverlappingOpportunities: async () => [] as Opportunity[] };
    const embedder = { generate: async () => [] } as unknown as Embedder;
    const result = await enrichOrCreate(db, embedder, newDataOnlyIntroducers);
    expect(result.enriched).toBe(false);
    expect(result.data.actors).toHaveLength(1);
  });

});

/**
 * Cross-domain deduplication: the enricher prevents presenting users with multiple
 * opportunities that are really the same match rediscovered from a different source
 * or angle, while keeping genuinely different value propositions separate.
 *
 * The mock embedder maps each reasoning string to a domain tag (ai_ml, hardware,
 * design, fundraising). Same-domain reasonings produce identical vectors (cosine = 1),
 * different-domain reasonings produce orthogonal vectors (cosine = 0). This avoids
 * brittle keyword-substring matching and makes domain boundaries explicit.
 */
describe('Opportunity enricher — cross-domain deduplication', () => {
  type DomainTag = 'ai_ml' | 'hardware' | 'design' | 'fundraising';

  /** Each domain gets an orthogonal unit vector so cross-domain cosine = 0. */
  const domainVectors: Record<DomainTag, number[]> = {
    ai_ml:       [1, 0, 0, 0],
    hardware:    [0, 1, 0, 0],
    design:      [0, 0, 1, 0],
    fundraising: [0, 0, 0, 1],
  };

  /** Map every MEANINGFUL.reasoning value to its domain. */
  const reasoningDomains = new Map<string, DomainTag>([
    [MEANINGFUL.reasoning.aiMlCofounder,       'ai_ml'],
    [MEANINGFUL.reasoning.aiMlResearch,        'ai_ml'],
    [MEANINGFUL.reasoning.aiMlStartup,         'ai_ml'],
    [MEANINGFUL.reasoning.hardwarePrototyping,  'hardware'],
    [MEANINGFUL.reasoning.hardwareFirmware,     'hardware'],
    [MEANINGFUL.reasoning.designUx,             'design'],
    [MEANINGFUL.reasoning.designProduct,        'design'],
    [MEANINGFUL.reasoning.fundraising,          'fundraising'],
    [MEANINGFUL.reasoning.fundraisingAngel,     'fundraising'],
  ]);

  /**
   * Embedder that returns the domain vector for a reasoning string.
   * Same-domain pairs → cosine similarity 1. Cross-domain → cosine 0.
   */
  function domainEmbedder(): Embedder {
    return {
      generate: async (texts: string[]) =>
        texts.map((t) => {
          const domain = reasoningDomains.get(t);
          return domain ? domainVectors[domain] : [0.25, 0.25, 0.25, 0.25];
        }),
    } as unknown as Embedder;
  }

  /** Shorthand: two-party actor list. */
  const actors = (idx = 'idx-1') => [
    { indexId: idx, userId: 'user-a', role: 'party' },
    { indexId: idx, userId: 'user-b', role: 'party' },
  ];

  // ── Same match rediscovered ──────────────────────────────────────────

  test('graph detects AI match, then chat rediscovers the same match → merges into one', async () => {
    const graphOpp = existingOpportunity('opp-graph', actors(), MEANINGFUL.reasoning.aiMlCofounder);
    const db = { findOverlappingOpportunities: async () => [graphOpp] };

    // Chat finds a similar AI angle for the same pair
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-graph']);
      expect(result.data.detection.source).toBe('enrichment');
    }
  });

  test('three AI/ML matches for same pair consolidate into one', async () => {
    const opp1 = existingOpportunity('opp-1', actors(), MEANINGFUL.reasoning.aiMlCofounder);
    const opp2 = existingOpportunity('opp-2', actors(), MEANINGFUL.reasoning.aiMlResearch);
    const db = { findOverlappingOpportunities: async () => [opp1, opp2] };

    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlStartup);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toContain('opp-1');
      expect(result.expiredIds).toContain('opp-2');
      expect(result.expiredIds).toHaveLength(2);
      // Merged reasoning uses new data only (avoids repetitive concatenation in chat cards)
      expect(result.data.interpretation.reasoning).toBe(MEANINGFUL.reasoning.aiMlStartup);
      expect(result.data.interpretation.reasoning).toContain('ML infrastructure');
    }
  });

  // ── Genuinely different value stays separate ──────────────────────────

  test('AI collaboration and fundraising intro for same pair are different opportunities', async () => {
    const aiOpp = existingOpportunity('opp-ai', actors(), MEANINGFUL.reasoning.aiMlCofounder);
    const db = { findOverlappingOpportunities: async () => [aiOpp] };

    // Fundraising is a different value proposition — should NOT merge
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.fundraising);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(false);
    expect(result.data.detection.source).not.toBe('enrichment');
  });

  test('hardware match and design match for same pair are different opportunities', async () => {
    const hwOpp = existingOpportunity('opp-hw', actors(), MEANINGFUL.reasoning.hardwarePrototyping);
    const db = { findOverlappingOpportunities: async () => [hwOpp] };

    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.designUx);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(false);
  });

  // ── Mixed: some related, some not ────────────────────────────────────

  test('AI merges with AI but hardware and fundraising stay separate', async () => {
    const oppAI = existingOpportunity('opp-ai', actors(), MEANINGFUL.reasoning.aiMlResearch);
    const oppHW = existingOpportunity('opp-hw', actors(), MEANINGFUL.reasoning.hardwareFirmware);
    const oppFund = existingOpportunity('opp-fund', actors(), MEANINGFUL.reasoning.fundraisingAngel);
    const db = { findOverlappingOpportunities: async () => [oppAI, oppHW, oppFund] };

    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlCofounder);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-ai']);
      expect(result.expiredIds).not.toContain('opp-hw');
      expect(result.expiredIds).not.toContain('opp-fund');
    }
  });

  test('all four domains present — new hardware match only merges with existing hardware', async () => {
    const oppAI = existingOpportunity('opp-ai', actors(), MEANINGFUL.reasoning.aiMlStartup);
    const oppHW = existingOpportunity('opp-hw', actors(), MEANINGFUL.reasoning.hardwareFirmware);
    const oppDesign = existingOpportunity('opp-design', actors(), MEANINGFUL.reasoning.designProduct);
    const oppFund = existingOpportunity('opp-fund', actors(), MEANINGFUL.reasoning.fundraisingAngel);
    const db = { findOverlappingOpportunities: async () => [oppAI, oppHW, oppDesign, oppFund] };

    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.hardwarePrototyping);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-hw']);
      expect(result.expiredIds).not.toContain('opp-ai');
      expect(result.expiredIds).not.toContain('opp-design');
      expect(result.expiredIds).not.toContain('opp-fund');
    }
  });

  test('all four domains present — new fundraising match only merges with existing fundraising', async () => {
    const oppAI = existingOpportunity('opp-ai', actors(), MEANINGFUL.reasoning.aiMlCofounder);
    const oppHW = existingOpportunity('opp-hw', actors(), MEANINGFUL.reasoning.hardwarePrototyping);
    const oppDesign = existingOpportunity('opp-design', actors(), MEANINGFUL.reasoning.designUx);
    const oppFund = existingOpportunity('opp-fund', actors(), MEANINGFUL.reasoning.fundraising);
    const db = { findOverlappingOpportunities: async () => [oppAI, oppHW, oppDesign, oppFund] };

    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.fundraisingAngel);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-fund']);
      expect(result.expiredIds).not.toContain('opp-ai');
      expect(result.expiredIds).not.toContain('opp-hw');
      expect(result.expiredIds).not.toContain('opp-design');
    }
  });

  // ── Intent-driven vs profile-based ───────────────────────────────────

  test('intent-driven and profile-based matches in same domain merge', async () => {
    // Existing: intent-driven AI match
    const intentOpp = existingOpportunity(
      'opp-intent',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient', intent: MEANINGFUL.intentIds.bobEarlyStage },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const db = { findOverlappingOpportunities: async () => [intentOpp] };

    // New: profile-based AI match (no intents, same domain reasoning)
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-intent']);
      // Intent IDs from the old opportunity are preserved in merged actors
      expect(result.data.actors.some((a) => a.intent === MEANINGFUL.intentIds.aliceMlCofounder)).toBe(true);
    }
  });

  test('intent-driven AI match and intent-driven design match for same pair stay separate', async () => {
    const aiOpp = existingOpportunity(
      'opp-ai',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient', intent: MEANINGFUL.intentIds.bobEarlyStage },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const db = { findOverlappingOpportunities: async () => [aiOpp] };

    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.designProduct),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: MEANINGFUL.intentIds.daveDesign },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(false);
  });

  // ── Merge mechanics ──────────────────────────────────────────────────

  test('accepted predecessor keeps accepted status through merge', async () => {
    const acceptedOpp = existingOpportunity('opp-old', actors(), MEANINGFUL.reasoning.aiMlResearch, 'accepted');
    const db = { findOverlappingOpportunities: async () => [acceptedOpp] };

    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlCofounder);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.resolvedStatus).toBe('accepted');
    }
  });

  test('pending + rejected predecessors resolve to pending', async () => {
    const pendingOpp = existingOpportunity('opp-p', actors(), MEANINGFUL.reasoning.aiMlCofounder, 'pending');
    const rejectedOpp = existingOpportunity('opp-r', actors(), MEANINGFUL.reasoning.aiMlResearch, 'rejected');
    const db = { findOverlappingOpportunities: async () => [pendingOpp, rejectedOpp] };

    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlStartup);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.resolvedStatus).toBe('pending');
      expect(result.expiredIds).toHaveLength(2);
    }
  });

  test('all latent predecessors + latent new yields latent', async () => {
    const opp1 = existingOpportunity('opp-1', actors(), MEANINGFUL.reasoning.hardwarePrototyping, 'latent');
    const opp2 = existingOpportunity('opp-2', actors(), MEANINGFUL.reasoning.hardwareFirmware, 'latent');
    const db = { findOverlappingOpportunities: async () => [opp1, opp2] };

    const newData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.hardwarePrototyping),
      status: 'latent' as const,
    };
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.resolvedStatus).toBe('latent');
    }
  });

  test('merged reasoning includes context from all predecessor matches', async () => {
    const opp1 = existingOpportunity('opp-1', actors(), MEANINGFUL.reasoning.aiMlCofounder);
    opp1.interpretation = { ...opp1.interpretation!, confidence: 0.7 };
    const opp2 = existingOpportunity('opp-2', actors(), MEANINGFUL.reasoning.aiMlResearch);
    opp2.interpretation = { ...opp2.interpretation!, confidence: 0.9 };
    const db = { findOverlappingOpportunities: async () => [opp1, opp2] };

    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlStartup);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      const r = result.data.interpretation.reasoning;
      // Merged reasoning uses new data only
      expect(r).toBe(MEANINGFUL.reasoning.aiMlStartup);
      expect(r).toContain('ML infrastructure');
      // Max confidence wins
      const conf = typeof result.data.interpretation.confidence === 'number'
        ? result.data.interpretation.confidence
        : parseFloat(String(result.data.interpretation.confidence));
      expect(conf).toBe(0.9);
    }
  });

  test('signals are deduplicated across merged matches', async () => {
    const opp1 = existingOpportunity('opp-1', actors(), MEANINGFUL.reasoning.designUx);
    const opp2 = existingOpportunity('opp-2', actors(), MEANINGFUL.reasoning.designProduct);
    const opp1s: Opportunity = {
      ...opp1,
      interpretation: {
        ...opp1.interpretation!,
        signals: [
          { type: 'skill_match', weight: 0.8, detail: 'Figma' },
          { type: 'interest_overlap', weight: 0.9, detail: 'UX' },
        ],
      },
    };
    const opp2s: Opportunity = {
      ...opp2,
      interpretation: {
        ...opp2.interpretation!,
        signals: [
          { type: 'skill_match', weight: 0.8, detail: 'Figma' },   // duplicate
          { type: 'portfolio_match', weight: 0.7, detail: 'mobile' },
        ],
      },
    };
    const db = { findOverlappingOpportunities: async () => [opp1s, opp2s] };

    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.designUx),
      interpretation: {
        category: 'collaboration',
        reasoning: MEANINGFUL.reasoning.designUx,
        confidence: 0.8,
        signals: [{ type: 'curator_judgment', weight: 1, detail: 'Manual' }],
      },
    };
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      const signals = result.data.interpretation.signals ?? [];
      const keys = signals.map((s) => `${s.type}:${s.detail ?? ''}`);
      expect(new Set(keys).size).toBe(keys.length); // no duplicates
      expect(signals.some((s) => s.type === 'skill_match' && s.detail === 'Figma')).toBe(true);
      expect(signals.some((s) => s.type === 'portfolio_match')).toBe(true);
      expect(signals.some((s) => s.type === 'curator_judgment')).toBe(true);
    }
  });

  // ── Phase 1: Intent-first relatedness ────────────────────────────────

  test('shared intent merges without needing embedding (Phase 1)', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    // Embedder should never be called — Phase 1 catches the shared intent
    let embedderCalled = false;
    const embedder = {
      generate: async () => { embedderCalled = true; return []; },
    } as unknown as Embedder;

    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const result = await enrichOrCreate(db, embedder, newData);

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-old']);
    }
    expect(embedderCalled).toBe(false);
  });

  test('shared intent merges even when reasoning is in a different domain (Phase 1 overrides Phase 2)', async () => {
    // Existing has AI reasoning but shares an intent with new data that has fundraising reasoning
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const db = { findOverlappingOpportunities: async () => [existing] };

    // New data shares the intent but has fundraising reasoning (different domain embedding)
    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.fundraising),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    // domainEmbedder would say these are unrelated (AI vs fundraising = cosine 0)
    // but Phase 1 catches the shared intent
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-old']);
    }
  });

  // ── Fallback paths ───────────────────────────────────────────────────

  test('embedder failure with shared intents: Phase 1 already captured the match', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const embedder = {
      generate: async () => { throw new Error('Embedder unavailable'); },
    } as unknown as Embedder;

    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const result = await enrichOrCreate(db, embedder, newData);

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-old']);
    }
  });

  test('embedder failure without shared intents: does not merge', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const embedder = {
      generate: async () => { throw new Error('Embedder unavailable'); },
    } as unknown as Embedder;

    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch);
    const result = await enrichOrCreate(db, embedder, newData);

    expect(result.enriched).toBe(false);
  });

  test('short reasoning with shared intent merges; without shared intent does not', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'Short.' // below MIN_REASONING_LENGTH_FOR_EMBEDDING
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const embedder = { generate: async () => [] } as unknown as Embedder;

    // With shared intent → merges (Phase 1 catches it)
    const withSharedIntent: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', 'Brief.'),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const resultMerge = await enrichOrCreate(db, embedder, withSharedIntent);
    expect(resultMerge.enriched).toBe(true);

    // Without shared intent → does not merge (Phase 1 misses, Phase 2 skips short reasoning)
    const withoutSharedIntent: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', 'Brief.'),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: MEANINGFUL.intentIds.carolHardware },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const resultNoMerge = await enrichOrCreate(db, embedder, withoutSharedIntent);
    expect(resultNoMerge.enriched).toBe(false);
  });

  // ── Cross-index ──────────────────────────────────────────────────────

  test('same match found in two indexes merges and preserves both index contexts', async () => {
    const opp1 = existingOpportunity(
      'opp-idx1',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const opp2 = existingOpportunity(
      'opp-idx2',
      [
        { indexId: 'idx-2', userId: 'user-a', role: 'party' },
        { indexId: 'idx-2', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const db = { findOverlappingOpportunities: async () => [opp1, opp2] };

    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlStartup);
    const result = await enrichOrCreate(db, domainEmbedder(), newData, { similarityThreshold: 0.7 });

    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toContain('opp-idx1');
      expect(result.expiredIds).toContain('opp-idx2');
      const indexIds = new Set(result.data.actors.map((a) => a.indexId));
      expect(indexIds.has('idx-1')).toBe(true);
      expect(indexIds.has('idx-2')).toBe(true);
    }
  });
});
