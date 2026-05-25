/**
 * Unit tests for the decompose_premises node in ProfileGraph.
 *
 * All LLM calls are mocked — no real API key needed. The dummy key
 * prevents createModel() from throwing at module load time.
 */
import { config } from "dotenv";
config({ path: ".env.test", override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ─── Mock LLM-calling modules ──────────────────────────────────────────────
// ProfileGenerator creates models at MODULE SCOPE, so it calls createModel()
// before mock.module on model.config can intercept it. Instead, we mock the
// entire module that exports the class.

const mockProfileOutput = {
  identity: {
    name: 'Test User',
    bio: 'A software engineer based in Berlin',
    location: 'Berlin',
  },
  narrative: { context: 'Test user context' },
  attributes: {
    interests: ['distributed systems'],
    skills: ['TypeScript', 'software engineering'],
  },
};

mock.module("../profile.generator.js", () => ({
  ProfileGenerator: class MockProfileGenerator {
    async invoke(input: string) {
      return {
        output: mockProfileOutput,
        textToEmbed: 'mock text to embed',
      };
    }
  },
}));

const mockDecomposeOutput = {
  reasoning: 'Decomposed input into premises',
  premises: [
    { text: 'I am a software engineer', tier: 'assertive' as const },
    { text: 'I am based in Berlin', tier: 'assertive' as const },
  ],
};

mock.module("../../premise/premise.decomposer.js", () => ({
  PremiseDecomposer: class MockPremiseDecomposer {
    async invoke(_input: string) {
      return mockDecomposeOutput;
    }
  },
}));

import { ProfileGraphFactory } from '../profile.graph.js';
import type { ProfileGraphDatabase, PremiseRecord } from '../../shared/interfaces/database.interface.js';
import type { Scraper } from '../../shared/interfaces/scraper.interface.js';
import type { CompiledPremiseGraph } from '../profile.graph.js';

interface ProfileDocument {
  userId: string;
  identity: {
    name: string;
    bio: string;
    location: string;
  };
  narrative: { context: string };
  attributes: {
    interests: string[];
    skills: string[];
  };
  embedding: number[] | number[][] | null;
}

describe('ProfileGraph - Premise Decomposition', () => {
  let mockDatabase: ProfileGraphDatabase;
  let mockScraper: Scraper;
  let mockPremiseGraph: CompiledPremiseGraph;

  const mockProfile: ProfileDocument = {
    userId: 'test-user-id',
    identity: {
      name: 'Test User',
      bio: 'A test user bio',
      location: 'Test City',
    },
    narrative: { context: 'Test user context' },
    attributes: {
      interests: ['testing'],
      skills: ['TypeScript'],
    },
    embedding: null,
  };

  const mockActivePremises: PremiseRecord[] = [
    {
      id: 'premise-1',
      userId: 'test-user-id',
      assertion: { text: 'I am a software engineer', tier: 'assertive' },
      provenance: { source: 'explicit', confidence: 1.0, timestamp: new Date().toISOString() },
      analysis: null,
      validity: { volatile: false },
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      retractedAt: null,
    },
    {
      id: 'premise-2',
      userId: 'test-user-id',
      assertion: { text: 'I am based in Berlin', tier: 'assertive' },
      provenance: { source: 'explicit', confidence: 1.0, timestamp: new Date().toISOString() },
      analysis: null,
      validity: { volatile: false },
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      retractedAt: null,
    },
  ];

  let premiseCreateCalls: Array<{ userId: string; assertionText: string; tier: string }>;

  beforeEach(() => {
    premiseCreateCalls = [];

    mockDatabase = {
      getProfile: mock(async () => null),
      getProfileByUserId: mock(async () => null),
      getUser: mock(async (userId: string) => ({
        id: userId,
        name: 'Test User',
        email: 'test@example.com',
        socials: [],
      })),
      getUserSocials: mock(async () => []),
      setUserSocials: mock(async () => {}),
      updateUser: mock(async (userId: string, data: unknown) => ({
        id: userId,
        name: 'Test User',
        email: 'test@example.com',
        ...(data as object),
      })),
      saveProfile: mock(async () => {}),
      softDeleteGhost: mock(async () => true),
      getPremisesForUser: mock(async () => mockActivePremises),
    } as unknown as ProfileGraphDatabase;

    mockScraper = {
      scrape: mock(async () => 'Scraped content about the user: software engineer in Berlin'),
    } as unknown as Scraper;

    mockPremiseGraph = {
      invoke: mock(async (input: { userId: string; assertionText: string; tier: string; operationMode: string }) => {
        premiseCreateCalls.push({
          userId: input.userId,
          assertionText: input.assertionText,
          tier: input.tier,
        });
        return {
          premise: { id: `premise-${premiseCreateCalls.length}` },
        };
      }),
    } as unknown as CompiledPremiseGraph;
  });

  function buildGraph() {
    return new ProfileGraphFactory(
      mockDatabase,
      mockScraper,
      undefined, // no enricher
      undefined, // no questionerEnqueue
      mockPremiseGraph,
    ).createGraph();
  }

  function buildGraphWithoutPremise() {
    return new ProfileGraphFactory(
      mockDatabase,
      mockScraper,
    ).createGraph();
  }

  // ─── Write mode with input: routes through decompose_premises ───────────

  describe('write mode with meaningful input and premise graph', () => {
    it('should decompose input into premises and route to aggregate', async () => {
      const graph = buildGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'I am a software engineer based in Berlin. I specialize in distributed systems.',
        forceUpdate: true,
      });

      // Premise graph should have been called to create premises
      expect(premiseCreateCalls.length).toBeGreaterThanOrEqual(1);

      // All created premises should be for the correct user
      for (const call of premiseCreateCalls) {
        expect(call.userId).toBe('test-user-id');
      }

      // Should have fetched active premises for aggregation
      expect(mockDatabase.getPremisesForUser).toHaveBeenCalledWith('test-user-id', 'ACTIVE');

      // Should have generated a profile (via aggregate -> generate_profile)
      expect(result.profile).toBeDefined();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    }, 60_000);

    it('should create premises with correct tiers', async () => {
      const graph = buildGraph();
      await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'I am a climate tech founder. I am attending ETHDenver this week.',
        forceUpdate: true,
      });

      // At least one premise should have been created
      expect(premiseCreateCalls.length).toBeGreaterThanOrEqual(1);

      // Each premise should have a valid tier
      for (const call of premiseCreateCalls) {
        expect(['assertive', 'contextual']).toContain(call.tier);
      }
    }, 60_000);
  });

  // ─── Legacy fallback: no premise graph ────────────────────────────────────

  describe('write mode without premise graph (legacy)', () => {
    it('should route directly to generate_profile when no premise graph is injected', async () => {
      const graph = buildGraphWithoutPremise();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'I am a software engineer based in Berlin.',
        forceUpdate: true,
      });

      // Should have generated profile directly (no decomposition)
      expect(result.profile).toBeDefined();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();

      // Premise graph should NOT have been called
      expect(premiseCreateCalls.length).toBe(0);
    }, 60_000);
  });

  // ─── Scrape then decompose ───────────────────────────────────────────────

  describe('scrape followed by decomposition', () => {
    it('should scrape first, then decompose scraped content into premises', async () => {
      const graph = buildGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        // No input — will trigger scraping first
      });

      // Scraper should have been called
      expect(mockScraper.scrape).toHaveBeenCalled();

      // Premise graph should have been called with scraped content
      expect(premiseCreateCalls.length).toBeGreaterThanOrEqual(1);

      // Should have generated profile via aggregate
      expect(result.profile).toBeDefined();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    }, 60_000);

    it('should skip scraping and decomposition when scraping is not needed', async () => {
      // Profile already exists, no forceUpdate
      (mockDatabase.getProfile as ReturnType<typeof mock>).mockResolvedValue(mockProfile);

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
      });

      // No scraping, no decomposition
      expect(mockScraper.scrape).not.toHaveBeenCalled();
      expect(premiseCreateCalls.length).toBe(0);

      // Profile returned as-is
      expect(result.profile).toEqual(mockProfile);
    }, 30_000);
  });

  // ─── Aggregate mode still works directly ─────────────────────────────────

  describe('aggregate mode', () => {
    it('should still work directly without going through decomposition', async () => {
      const graph = buildGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'aggregate',
      });

      // Should fetch active premises
      expect(mockDatabase.getPremisesForUser).toHaveBeenCalledWith('test-user-id', 'ACTIVE');

      // Should generate profile
      expect(result.profile).toBeDefined();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();

      // Should NOT call premise graph (aggregate uses existing premises)
      expect(premiseCreateCalls.length).toBe(0);
    }, 60_000);
  });

  // ─── Query mode unaffected ───────────────────────────────────────────────

  describe('query mode', () => {
    it('should return profile without decomposition', async () => {
      (mockDatabase.getProfile as ReturnType<typeof mock>).mockResolvedValue(mockProfile);

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'query',
      });

      expect(result.profile).toEqual(mockProfile);
      expect(premiseCreateCalls.length).toBe(0);
      expect(mockScraper.scrape).not.toHaveBeenCalled();
    }, 30_000);
  });

  // ─── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should fall back to direct generation if premise graph throws', async () => {
      const failingPremiseGraph: CompiledPremiseGraph = {
        invoke: mock(async () => {
          throw new Error('Premise graph crashed');
        }),
      } as unknown as CompiledPremiseGraph;

      const graph = new ProfileGraphFactory(
        mockDatabase,
        mockScraper,
        undefined, // no enricher
        undefined, // no questionerEnqueue
        failingPremiseGraph,
      ).createGraph();

      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'I am a software engineer in Berlin.',
        forceUpdate: true,
      });

      // Should still generate a profile (fallback to direct generation)
      expect(result.profile).toBeDefined();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    }, 60_000);
  });
});
