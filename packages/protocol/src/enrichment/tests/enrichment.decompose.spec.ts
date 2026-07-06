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
// EnrichmentGenerator creates models at MODULE SCOPE, so it calls createModel()
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

mock.module("../enrichment.generator.js", () => ({
  EnrichmentGenerator: class MockEnrichmentGenerator {
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
  retractedPremiseIds: [] as string[],
  revisedBio: null as string | null,
};

// Mutable holder so individual tests can vary the decomposer output and
// inspect the args it was invoked with (input + offered existing premises).
let currentDecomposeOutput: typeof mockDecomposeOutput = mockDecomposeOutput;
let decomposerInvocations: Array<{ input: string; existingPremises?: Array<{ id: string; text: string }>; currentBio?: string }> = [];

mock.module("../../premise/premise.decomposer.js", () => ({
  PremiseDecomposer: class MockPremiseDecomposer {
    async invoke(input: string, existingPremises?: Array<{ id: string; text: string }>, currentBio?: string) {
      decomposerInvocations.push({
        input,
        ...(existingPremises?.length ? { existingPremises } : {}),
        ...(currentBio ? { currentBio } : {}),
      });
      return currentDecomposeOutput;
    }
  },
}));

import { EnrichmentGraphFactory } from '../enrichment.graph.js';
import type { EnrichmentGraphDatabase, PremiseRecord } from '../../shared/interfaces/database.interface.js';
import type { Scraper } from '../../shared/interfaces/scraper.interface.js';
import type { CompiledPremiseGraph } from '../enrichment.graph.js';

interface GeneratedProfile {
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
}

describe('ProfileGraph - Premise Decomposition', () => {
  let mockDatabase: EnrichmentGraphDatabase;
  let mockScraper: Scraper;
  let mockPremiseGraph: CompiledPremiseGraph;

  const mockProfile: GeneratedProfile = {
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
    currentDecomposeOutput = mockDecomposeOutput;
    decomposerInvocations = [];

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
      updatePremise: mock(async (premiseId: string) => ({
        ...mockActivePremises[0],
        id: premiseId,
        status: 'RETRACTED',
        retractedAt: new Date(),
      })),
    } as unknown as EnrichmentGraphDatabase;

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
    return new EnrichmentGraphFactory(
      mockDatabase,
      mockScraper,
      undefined, // no enricher
      undefined, // no questionerEnqueue
      mockPremiseGraph,
    ).createGraph();
  }

  function buildGraphWithoutPremise() {
    return new EnrichmentGraphFactory(
      mockDatabase,
      mockScraper,
    ).createGraph();
  }

  // ─── Write mode with input: routes through decompose_premises ───────────

  describe('write mode with meaningful input and premise graph', () => {
    it('should decompose input into premises and create them via the premise graph', async () => {
      const graph = buildGraph();
      await graph.invoke({
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

      // check_state reads ACTIVE premises to decide whether enrichment has run
      expect(mockDatabase.getPremisesForUser).toHaveBeenCalledWith('test-user-id', 'ACTIVE');

      // Premise creation is the terminal effect now — the graph never saves a profile
      expect(mockDatabase.saveProfile).not.toHaveBeenCalled();
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

  describe('write mode without premise graph', () => {
    it('should end without generating when no premise graph is injected', async () => {
      const graph = buildGraphWithoutPremise();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'I am a software engineer based in Berlin.',
        forceUpdate: true,
      });

      // With no premise graph there is nothing to decompose into — the write
      // path ends without creating premises and without saving a profile.
      expect(premiseCreateCalls.length).toBe(0);
      expect(mockDatabase.saveProfile).not.toHaveBeenCalled();
      expect(result.profile).toBeUndefined();
    }, 60_000);
  });

  // ─── Scrape then decompose ───────────────────────────────────────────────

  describe('scrape followed by decomposition', () => {
    it('should scrape first, then decompose scraped content into premises', async () => {
      // User not yet enriched -> write mode with no input triggers scraping
      (mockDatabase.getPremisesForUser as ReturnType<typeof mock>).mockResolvedValue([]);

      const graph = buildGraph();
      await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        // No input — will trigger scraping first
      });

      // Scraper should have been called
      expect(mockScraper.scrape).toHaveBeenCalled();

      // Premise graph should have been called with scraped content
      expect(premiseCreateCalls.length).toBeGreaterThanOrEqual(1);

      // Premise creation is terminal — no profile is saved
      expect(mockDatabase.saveProfile).not.toHaveBeenCalled();
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
      expect(mockDatabase.saveProfile).not.toHaveBeenCalled();

      // Profile returned as-is (query/write read of the existing users-sourced row)
      expect(result.profile).toEqual(mockProfile);
    }, 30_000);
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

  // ─── Retraction of disavowed premises ───────────────────────────────────

  describe('retraction of disavowed premises', () => {
    it("should offer the user's ACTIVE premises to the decomposer for retraction matching", async () => {
      const graph = buildGraph();
      await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'Remove all mentions of Berlin. I am based in Istanbul.',
        forceUpdate: true,
      });

      expect(decomposerInvocations.length).toBe(1);
      expect(decomposerInvocations[0].existingPremises).toEqual([
        { id: 'premise-1', text: 'I am a software engineer' },
        { id: 'premise-2', text: 'I am based in Berlin' },
      ]);
    }, 60_000);

    it('should retract premises the decomposer flags as disavowed', async () => {
      currentDecomposeOutput = {
        reasoning: 'Input disavows the Berlin premise',
        premises: [{ text: 'I am based in Istanbul', tier: 'assertive' as const }],
        retractedPremiseIds: ['premise-2'],
      };

      const graph = buildGraph();

      await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'I no longer live in Berlin. I am based in Istanbul.',
        forceUpdate: true,
      });

      expect(mockDatabase.updatePremise).toHaveBeenCalledTimes(1);
      const [premiseId, updates] = (mockDatabase.updatePremise as ReturnType<typeof mock>).mock.calls[0];
      expect(premiseId).toBe('premise-2');
      expect(updates.status).toBe('RETRACTED');
      expect(updates.retractedAt).toBeInstanceOf(Date);

      // The corrected fact is still created. Lifecycle events (cascade + context
      // regen) fire inside the host DB adapter's createPremise/updatePremise, not
      // in this graph — so retraction/creation here is sufficient.
      expect(premiseCreateCalls.map((c) => c.assertionText)).toContain('I am based in Istanbul');
    }, 60_000);

    it('should apply retractions even when no new premises are extracted', async () => {
      currentDecomposeOutput = {
        reasoning: 'Pure removal instruction — nothing new to add',
        premises: [],
        retractedPremiseIds: ['premise-1', 'premise-2'],
      };

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'Remove everything about software engineering and Berlin.',
        forceUpdate: true,
      });

      expect(result.error).toBeUndefined();
      expect(mockDatabase.updatePremise).toHaveBeenCalledTimes(2);
      expect(premiseCreateCalls.length).toBe(0);
    }, 60_000);

    it('should rewrite the stored bio when the decomposer returns a revision', async () => {
      // check_state loads the profile (identity.bio = users.intro) when the user
      // has been enriched; the decompose node offers it for revision.
      (mockDatabase.getProfile as ReturnType<typeof mock>).mockResolvedValue({
        userId: 'test-user-id',
        identity: { name: 'Test User', bio: 'Engineer. Creator of the HOPE language.', location: 'Istanbul' },
        context: '',
      });
      currentDecomposeOutput = {
        reasoning: 'Bio mentions the disavowed language',
        premises: [],
        retractedPremiseIds: ['premise-1'],
        revisedBio: 'Engineer.',
      };

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'Remove all mentions of the HOPE language.',
        forceUpdate: true,
      });

      expect(result.error).toBeUndefined();
      // Bio offered to the decomposer…
      expect(decomposerInvocations[0]?.currentBio).toBe('Engineer. Creator of the HOPE language.');
      // …and the revision persisted via saveProfile (empty name/location are
      // skipped by the identity persister).
      expect(mockDatabase.saveProfile).toHaveBeenCalledTimes(1);
      const [savedUserId, savedProfile] = (mockDatabase.saveProfile as ReturnType<typeof mock>).mock.calls[0];
      expect(savedUserId).toBe('test-user-id');
      expect(savedProfile.identity.bio).toBe('Engineer.');
    }, 60_000);

    it('should not touch the bio when the decomposer returns no revision', async () => {
      (mockDatabase.getProfile as ReturnType<typeof mock>).mockResolvedValue({
        userId: 'test-user-id',
        identity: { name: 'Test User', bio: 'Engineer.', location: 'Istanbul' },
        context: '',
      });

      const graph = buildGraph();
      await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'I also enjoy woodworking.',
        forceUpdate: true,
      });

      expect(mockDatabase.saveProfile).not.toHaveBeenCalled();
    }, 60_000);

    it('should skip retraction gracefully when the adapter lacks updatePremise', async () => {
      currentDecomposeOutput = {
        reasoning: 'Disavowal with no retraction support',
        premises: [],
        retractedPremiseIds: ['premise-1'],
      };
      delete (mockDatabase as { updatePremise?: unknown }).updatePremise;

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'Remove everything about software engineering.',
        forceUpdate: true,
      });

      expect(result.error).toBeUndefined();
      // Without updatePremise the graph must not offer existing premises either
      expect(decomposerInvocations[0]?.existingPremises).toBeUndefined();
    }, 60_000);
  });

  // ─── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should end gracefully when the premise graph throws', async () => {
      const failingPremiseGraph: CompiledPremiseGraph = {
        invoke: mock(async () => {
          throw new Error('Premise graph crashed');
        }),
      } as unknown as CompiledPremiseGraph;

      const graph = new EnrichmentGraphFactory(
        mockDatabase,
        mockScraper,
        undefined, // no enricher
        undefined, // no questionerEnqueue
        failingPremiseGraph,
      ).createGraph();

      // The decompose node swallows per-premise failures — the invoke resolves
      // rather than throwing, and nothing is saved.
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'I am a software engineer in Berlin.',
        forceUpdate: true,
      });

      expect(result.error).toBeUndefined();
      expect(mockDatabase.saveProfile).not.toHaveBeenCalled();
    }, 60_000);
  });
});
