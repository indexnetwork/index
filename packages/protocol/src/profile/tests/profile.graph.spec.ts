/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ProfileGraphFactory } from '../profile.graph.js';
import type { ProfileGraphDatabase } from '../../shared/interfaces/database.interface.js';
import type { Scraper } from '../../shared/interfaces/scraper.interface.js';
import type { ProfileDocument } from '../profile.generator.js';

describe('ProfileGraph', () => {
  let factory: ProfileGraphFactory;
  let mockDatabase: ProfileGraphDatabase;
  let mockScraper: Scraper;

  const mockProfile: ProfileDocument = {
    userId: 'test-user-id',
    identity: {
      name: 'Test User',
      bio: 'A test user bio',
      location: 'Test City, Test Country'
    },
    narrative: {
      context: 'Test user is working on testing things'
    },
    attributes: {
      interests: ['testing', 'coding'],
      skills: ['TypeScript', 'Testing']
    },
  };

  beforeEach(() => {
    // Mock database
    mockDatabase = {
      getProfile: mock(async (userId: string) => null),
      getProfileByUserId: mock(async (userId: string) => null),
      getUser: mock(async (userId: string) => ({
        id: userId,
        name: 'Test User',
        email: 'test@example.com',
        socials: []
      })),
      getUserSocials: mock(async () => []),
      setUserSocials: mock(async () => {}),
      updateUser: mock(async (userId: string, data: any) => ({
        id: userId,
        name: data.name ?? 'Test User',
        email: 'test@example.com',
        socials: [],
        location: data.location ?? null,
      })),
      saveProfile: mock(async () => {}),
      softDeleteGhost: mock(async () => true),
      getPremisesForUser: mock(async () => []),
    } as any;

    // Mock scraper
    mockScraper = {
      scrape: mock(async (objective: string) => 'Scraped data about the user')
    } as any;

    factory = new ProfileGraphFactory(mockDatabase, mockScraper);
  });

  describe('Query Mode (Fast Path)', () => {
    it('should return existing profile without generation in query mode', async () => {
      // Setup: Profile exists in DB
      (mockDatabase.getProfile as any).mockResolvedValue(mockProfile);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'query'
      });

      expect(result.profile).toEqual(mockProfile);
      expect(mockDatabase.getProfile).toHaveBeenCalledWith('test-user-id');

      // Should NOT call generation methods in query mode
      expect(mockScraper.scrape).not.toHaveBeenCalled();
    });

    it('should return undefined in query mode when profile does not exist', async () => {
      // Setup: No profile in DB
      (mockDatabase.getProfile as any).mockResolvedValue(null);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'query'
      });

      expect(result.profile).toBeUndefined();

      // Should NOT attempt to generate profile in query mode
      expect(mockScraper.scrape).not.toHaveBeenCalled();
    });
  });

  describe('Write Mode - Conditional Generation', () => {
    it('should generate profile when missing', async () => {
      // Setup: No profile exists
      (mockDatabase.getProfile as any).mockResolvedValue(null);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'Test user information'
      });

      expect(result.profile).toBeDefined();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    });

    it('should do nothing when profile already exists', async () => {
      // Setup: Complete profile exists
      (mockDatabase.getProfile as any).mockResolvedValue(mockProfile);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write'
      });

      // Should return existing profile without any generation
      expect(result.profile).toEqual(mockProfile);
      expect(mockDatabase.saveProfile).not.toHaveBeenCalled();
    });
  });

  describe('Force Update Behavior', () => {
    it('should regenerate profile when forceUpdate is true with new input', async () => {
      // Setup: Complete profile exists
      const existingProfile = { ...mockProfile };
      (mockDatabase.getProfile as any).mockResolvedValue(existingProfile);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        forceUpdate: true,
        input: 'New information about the user'
      });

      // Should regenerate and save profile
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    });

    it('should save profile when generating from scratch', async () => {
      // Setup: No profile exists
      (mockDatabase.getProfile as any).mockResolvedValue(null);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'New profile information'
      });

      // Profile should be generated and saved
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    });
  });

  describe('Scraping Behavior', () => {
    it('should scrape when no input is provided', async () => {
      // Setup: No profile, no input
      (mockDatabase.getProfile as any).mockResolvedValue(null);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write'
      });

      // Should call scraper to get input
      expect(mockScraper.scrape).toHaveBeenCalled();

      // Should then generate profile
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    });

    it('should skip scraping when input is provided', async () => {
      // Setup: No profile, but input provided
      (mockDatabase.getProfile as any).mockResolvedValue(null);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'Provided profile information'
      });

      // Should NOT call scraper
      expect(mockScraper.scrape).not.toHaveBeenCalled();

      // Should generate profile from provided input
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    });
  });

  describe('User Information Detection', () => {
    it('should detect missing user information when no socials and incomplete name', async () => {
      // Setup: No profile, user has only email
      (mockDatabase.getProfile as any).mockResolvedValue(null);
      (mockDatabase.getUser as any).mockResolvedValue({
        id: 'test-user-id',
        name: 'test@example.com', // Just email as name
        email: 'test@example.com',
        socials: [] // No socials
      });

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write'
        // No input - would need scraping
      });

      // Should detect missing user info
      expect(result.needsUserInfo).toBe(true);
      expect(result.missingUserInfo).toContain('social_urls');
      expect(result.missingUserInfo).toContain('full_name');

      // Should NOT attempt to scrape
      expect(mockScraper.scrape).not.toHaveBeenCalled();

      // Should NOT generate profile
      expect(mockDatabase.saveProfile).not.toHaveBeenCalled();
    });

    it('should proceed with scraping when user has social URLs', async () => {
      // Setup: No profile, user has social URLs
      (mockDatabase.getProfile as any).mockResolvedValue(null);
      (mockDatabase.getUser as any).mockResolvedValue({
        id: 'test-user-id',
        name: 'Test',
        email: 'test@example.com',
      });
      (mockDatabase.getUserSocials as any).mockResolvedValue([
        { id: '1', userId: 'test-user-id', label: 'twitter', value: 'https://x.com/testuser' },
        { id: '2', userId: 'test-user-id', label: 'linkedin', value: 'https://linkedin.com/in/testuser' },
      ]);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write'
      });

      // Should NOT detect missing user info
      expect(result.needsUserInfo).toBe(false);

      // Should proceed with scraping
      expect(mockScraper.scrape).toHaveBeenCalled();
    });

    it('should proceed with scraping when user has meaningful name', async () => {
      // Setup: No profile, user has full name
      (mockDatabase.getProfile as any).mockResolvedValue(null);
      (mockDatabase.getUser as any).mockResolvedValue({
        id: 'test-user-id',
        name: 'John Doe', // Full name
        email: 'test@example.com',
        socials: [],
        location: 'San Francisco, CA'
      });

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write'
      });

      // Should NOT detect missing user info
      expect(result.needsUserInfo).toBe(false);

      // Should proceed with scraping
      expect(mockScraper.scrape).toHaveBeenCalled();
    });

    it('should not check user info when input is provided', async () => {
      // Setup: No profile, insufficient user info, but input provided
      (mockDatabase.getProfile as any).mockResolvedValue(null);
      (mockDatabase.getUser as any).mockResolvedValue({
        id: 'test-user-id',
        name: 'Test',
        email: 'test@example.com',
        socials: []
      });

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write',
        input: 'User provided profile data'
      });

      // Should NOT detect missing user info (because input was provided)
      expect(result.needsUserInfo).toBe(false);

      // Should NOT scrape
      expect(mockScraper.scrape).not.toHaveBeenCalled();

      // Should generate profile from input
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    });

    it('should not check user info when profile already exists', async () => {
      // Setup: Profile exists
      (mockDatabase.getProfile as any).mockResolvedValue(mockProfile);

      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: 'test-user-id',
        operationMode: 'write'
      });

      // Should NOT detect missing user info (profile exists)
      expect(result.needsUserInfo).toBe(false);

      // Should NOT scrape (not needed)
      expect(mockScraper.scrape).not.toHaveBeenCalled();
    });
  });
});

// ─── Generate mode tests ─────────────────────────────────────────────────────

const mockEnrichUserProfile = mock(async () => null as any);

/**
 * Integration tests for generate mode (ghost user profile generation).
 *
 * These tests mock the enrichUserProfile Chat API call and verify that the
 * profile graph correctly handles both enrichment success (text blob routed
 * through LLM generation) and fallback to basic info LLM generation.
 */
describe('ProfileGraph - Generate Mode', () => {
  let mockDatabase: ProfileGraphDatabase;
  let mockScraper: Scraper;

  let savedProfiles: Map<string, any>;

  beforeEach(() => {
    savedProfiles = new Map();
    mockEnrichUserProfile.mockReset();

    mockDatabase = {
      getProfile: mock(async () => null),
      getProfileByUserId: mock(async () => null),
      getUser: mock(async () => null),
      getUserSocials: mock(async () => []),
      setUserSocials: mock(async () => {}),
      updateUser: mock(async (userId: string, data: any) => ({ id: userId, ...data })),
      saveProfile: mock(async (userId: string, profile: any) => {
        savedProfiles.set(userId, profile);
      }),
      softDeleteGhost: mock(async () => true),
      findDuplicateUser: mock(async () => null),
      mergeGhostUser: mock(async () => {}),
      getPremisesForUser: mock(async () => []),
    } as any;

    mockScraper = {
      scrape: mock(async () => ''),
    } as any;
  });

  function buildGraph() {
    return new ProfileGraphFactory(mockDatabase, mockScraper, { enrichUserProfile: mockEnrichUserProfile }).createGraph();
  }

  // ─────────────────────────────────────────────────────────
  // enrichUserProfile success path (text blob → LLM generation)
  // ─────────────────────────────────────────────────────────

  describe('when enrichUserProfile returns a structured profile', () => {
    const user = {
      id: 'user-enriched',
      name: 'Jane Doe',
      email: 'jane@example.com',
      socials: [{ id: '1', userId: 'user-enriched', label: 'linkedin', value: 'janedoe' }],
      location: null,
      intro: null,
    };

    const enrichmentResult = {
      identity: { name: 'Jane Doe', bio: 'Senior engineer at Acme Corp', location: 'San Francisco, USA' },
      narrative: { context: 'Jane is a seasoned software engineer with 10 years of experience.' },
      attributes: { skills: ['TypeScript', 'React', 'Node.js'], interests: ['AI', 'Open Source'] },
      socials: { linkedin: 'janedoe', twitter: 'janedoe', github: 'janedoe', websites: [] },
      confidentMatch: true,
      isHuman: true,
    };

    it('should generate profile from enrichment text blob via LLM', async () => {
      (mockDatabase.getUser as any).mockResolvedValue(user);
      mockEnrichUserProfile.mockResolvedValue(enrichmentResult);

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: user.id,
        operationMode: 'generate',
      });

      expect(result.error).toBeUndefined();
      expect(result.profile).toBeDefined();
      expect(result.profile!.identity.name).toBeTruthy();
      expect(mockDatabase.saveProfile).toHaveBeenCalledWith(user.id, expect.anything());
      expect(mockDatabase.updateUser).toHaveBeenCalled();
    }, 120_000);

    it('should update ghost user display name from enrichment when placeholder', async () => {
      const ghost = {
        id: 'ghost-enriched',
        name: 'jane',
        email: 'jane@example.com',
        isGhost: true,
        socials: [],
        location: null,
        intro: null,
      };
      (mockDatabase.getUser as any).mockResolvedValue(ghost);
      mockEnrichUserProfile.mockResolvedValue(enrichmentResult);

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: ghost.id,
        operationMode: 'generate',
      });

      expect(result.error).toBeUndefined();
      expect(result.profile).toBeDefined();
      expect(mockDatabase.updateUser).toHaveBeenCalledWith(
        ghost.id,
        expect.objectContaining({ name: 'Jane Doe' }),
      );
    }, 60_000);

    it('should not overwrite non-ghost user display name from enrichment', async () => {
      (mockDatabase.getUser as any).mockResolvedValue(user);
      mockEnrichUserProfile.mockResolvedValue(enrichmentResult);

      const graph = buildGraph();
      await graph.invoke({
        userId: user.id,
        operationMode: 'generate',
      });

      const updateCall = (mockDatabase.updateUser as any).mock.calls[0];
      expect(updateCall[1]).not.toHaveProperty('name');
    }, 60_000);
  });

  // ─────────────────────────────────────────────────────────
  // enrichUserProfile failure fallback (LLM generation)
  // ─────────────────────────────────────────────────────────

  describe('when enrichUserProfile fails', () => {
    const user = {
      id: 'user-fallback',
      name: 'John Smith',
      email: 'john@example.com',
      socials: [],
      location: 'London',
      intro: null,
    };

    it('should fall back to LLM profile generation from basic info', async () => {
      (mockDatabase.getUser as any).mockResolvedValue(user);
      mockEnrichUserProfile.mockRejectedValue(new Error('API timeout'));

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: user.id,
        operationMode: 'generate',
      });

      expect(result.error).toBeUndefined();
      expect(result.profile).toBeDefined();
      expect(result.profile!.identity.name).toBeTruthy();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    }, 120_000);
  });

  describe('when enrichUserProfile returns low-signal data', () => {
    const user = {
      id: 'user-lowsignal',
      name: 'seren',
      email: 'seren@index.network',
      socials: [],
      location: null,
      intro: null,
    };

    it('should fall back to LLM generation when enrichment has empty fields', async () => {
      (mockDatabase.getUser as any).mockResolvedValue(user);
      mockEnrichUserProfile.mockResolvedValue({
        identity: { name: 'seren', bio: '', location: '' },
        narrative: { context: '' },
        attributes: { skills: [], interests: [] },
        socials: [],
        confidentMatch: true,
        isHuman: true,
      });

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: user.id,
        operationMode: 'generate',
      });

      expect(result.error).toBeUndefined();
      expect(result.profile).toBeDefined();
      expect(result.profile!.identity.name).toBeTruthy();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    }, 120_000);
  });

  describe('when enrichUserProfile returns confidentMatch: false', () => {
    const user = {
      id: 'user-not-confident',
      name: 'Alex Unknown',
      email: 'alex@unknown.io',
      socials: [],
      location: null,
      intro: null,
    };

    it('should fall back to LLM generation despite rich payload', async () => {
      (mockDatabase.getUser as any).mockResolvedValue(user);
      mockEnrichUserProfile.mockResolvedValue({
        identity: { name: 'Alex Unknown', bio: 'Possibly a developer.', location: 'Remote' },
        narrative: { context: 'May work in tech.' },
        attributes: { skills: ['JavaScript'], interests: ['Web'] },
        socials: [],
        confidentMatch: false,
        isHuman: true,
      });

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: user.id,
        operationMode: 'generate',
      });

      expect(result.error).toBeUndefined();
      expect(result.profile).toBeDefined();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
      expect(mockDatabase.updateUser).not.toHaveBeenCalled();
    }, 120_000);
  });

  // ─────────────────────────────────────────────────────────
  // Full pipeline
  // ─────────────────────────────────────────────────────────

  describe('full pipeline produces saved profile', () => {
    const ghost = {
      id: 'ghost-pipeline',
      name: 'seren',
      email: 'seren@index.network',
      socials: [],
      location: null,
      intro: null,
    };

    it('should generate and save profile end to end', async () => {
      (mockDatabase.getUser as any).mockResolvedValue(ghost);
      mockEnrichUserProfile.mockResolvedValue(null);

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: ghost.id,
        operationMode: 'generate',
      });

      expect(result.error).toBeUndefined();
      expect(result.profile).toBeDefined();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    }, 120_000);
  });
});

// ─── Enrichment → Premise Decomposition Path ─────────────────────────────────

describe('ProfileGraph - Enrichment with Premise Decomposition', () => {
  let mockDatabase: ProfileGraphDatabase;
  let mockScraper: Scraper;
  let mockPremiseGraph: { invoke: ReturnType<typeof mock> };

  const enrichmentResult = {
    identity: { name: 'Jane Doe', bio: 'Senior engineer at Acme Corp', location: 'San Francisco, USA' },
    narrative: { context: 'Jane is a seasoned software engineer with 10 years of experience.' },
    attributes: { skills: ['TypeScript', 'React', 'Node.js'], interests: ['AI', 'Open Source'] },
    socials: { linkedin: 'janedoe', twitter: 'janedoe', github: 'janedoe', websites: [] },
    confidentMatch: true,
    isHuman: true,
  };

  const user = {
    id: 'user-premise-enrichment',
    name: 'Jane Doe',
    email: 'jane@example.com',
    socials: [{ id: '1', userId: 'user-premise-enrichment', label: 'linkedin', value: 'janedoe' }],
    location: null,
    intro: null,
  };

  beforeEach(() => {
    mockEnrichUserProfile.mockReset();

    mockDatabase = {
      getProfile: mock(async () => null),
      getProfileByUserId: mock(async () => null),
      getUser: mock(async () => user),
      getUserSocials: mock(async () => user.socials),
      setUserSocials: mock(async () => {}),
      updateUser: mock(async (userId: string, data: any) => ({ id: userId, ...data })),
      saveProfile: mock(async () => {}),
      softDeleteGhost: mock(async () => true),
      findDuplicateUser: mock(async () => null),
      mergeGhostUser: mock(async () => {}),
      getPremisesForUser: mock(async () => []),
    } as any;

    mockScraper = { scrape: mock(async () => '') } as any;

    mockPremiseGraph = {
      invoke: mock(async (input: any) => ({
        premise: { id: `premise-${Date.now()}` },
      })),
    };
  });

  it('should route enrichment through premise decomposition when premiseGraph is provided', async () => {
    mockEnrichUserProfile.mockResolvedValue(enrichmentResult);

    const factory = new ProfileGraphFactory(
      mockDatabase,
      mockScraper,
      { enrichUserProfile: mockEnrichUserProfile },
      undefined, // questionerEnqueue
      mockPremiseGraph as any, // premiseGraph — 5th constructor arg
    );
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: user.id,
      operationMode: 'generate',
    });

    expect(result.error).toBeUndefined();
    expect(result.profile).toBeDefined();
    expect(mockDatabase.saveProfile).toHaveBeenCalled();

    // The premise graph should have been called at least once with
    // assertion text derived from the enrichment data
    expect(mockPremiseGraph.invoke).toHaveBeenCalled();
    const firstCall = (mockPremiseGraph.invoke as any).mock.calls[0][0];
    expect(firstCall.userId).toBe(user.id);
    expect(firstCall.operationMode).toBe('create');
    expect(firstCall.assertionText).toBeTruthy();
  }, 120_000);
});
