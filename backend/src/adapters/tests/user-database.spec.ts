/**
 * Unit tests for createUserDatabase factory.
 *
 * Tests ownership guards, authUserId binding, and delegation to ChatDatabaseAdapter.
 * Uses a mock ChatDatabaseAdapter — no database connection needed.
 */

import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { createUserDatabase } from '../database.adapter';
import type { ChatDatabaseAdapter } from '../database.adapter';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_USER = 'user-owner-123';
const OTHER_USER = 'user-other-456';

const ownedIntent = {
  id: 'intent-1',
  userId: AUTH_USER,
  payload: 'test intent',
  summary: 'summary',
  isIncognito: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  embedding: undefined as number[] | undefined,
  sourceType: undefined as 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment' | undefined,
  sourceId: undefined as string | undefined,
};

const otherIntent = {
  id: 'intent-2',
  userId: OTHER_USER,
  payload: 'other intent',
  summary: null,
  isIncognito: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  embedding: undefined as number[] | undefined,
  sourceType: undefined as 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment' | undefined,
  sourceId: undefined as string | undefined,
};

const ownedIntentForIndexing = {
  id: 'intent-1',
  payload: 'test intent',
  userId: AUTH_USER,
  sourceType: null as 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment' | null,
  sourceId: null as string | null,
};

const otherIntentForIndexing = {
  id: 'intent-2',
  payload: 'other intent',
  userId: OTHER_USER,
  sourceType: null as 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment' | null,
  sourceId: null as string | null,
};

const stubDetection = { source: 'opportunity_graph' as const, timestamp: new Date().toISOString() };
const stubInterpretation = { category: 'test', reasoning: 'stub', confidence: 1 };
const stubDates = { createdAt: new Date(), updatedAt: new Date(), expiresAt: null };

const ownedOpportunity = {
  id: 'opp-1',
  detection: stubDetection,
  actors: [
    { userId: AUTH_USER, networkId: 'idx-a', role: 'patient' },
    { userId: OTHER_USER, networkId: 'idx-a', role: 'peer' },
  ],
  interpretation: stubInterpretation,
  context: { networkId: 'idx-a' },
  confidence: '0.9',
  status: 'pending' as const,
  ...stubDates,
};

const otherOpportunity = {
  id: 'opp-2',
  detection: stubDetection,
  actors: [
    { userId: 'user-random-789', networkId: 'idx-b', role: 'patient' },
    { userId: OTHER_USER, networkId: 'idx-b', role: 'peer' },
  ],
  interpretation: stubInterpretation,
  context: { networkId: 'idx-b' },
  confidence: '0.9',
  status: 'pending' as const,
  ...stubDates,
};

/** Opportunity where AUTH_USER is agent and an introducer exists — latent status should be hidden */
const latentWithIntroducer = {
  id: 'opp-3',
  detection: stubDetection,
  actors: [
    { userId: AUTH_USER, networkId: 'idx-c', role: 'agent' },
    { userId: OTHER_USER, networkId: 'idx-c', role: 'introducer' },
  ],
  interpretation: stubInterpretation,
  context: { networkId: 'idx-c' },
  confidence: '0.9',
  status: 'latent' as const,
  ...stubDates,
};

function createMockDb(): ChatDatabaseAdapter {
  return {
    // Profile
    getProfile: mock(() => Promise.resolve(null)),
    getProfileByUserId: mock(() => Promise.resolve(null)),
    saveProfile: mock(() => Promise.resolve()),
    deleteProfile: mock(() => Promise.resolve()),
    getUser: mock(() => Promise.resolve(null)),
    updateUser: mock(() => Promise.resolve(null)),

    // Intents
    getActiveIntents: mock(() => Promise.resolve([])),
    getIntent: mock(() => Promise.resolve(null)),
    createIntent: mock(() => Promise.resolve({ ...ownedIntent })),
    updateIntent: mock(() => Promise.resolve({ ...ownedIntent })),
    archiveIntent: mock(() => Promise.resolve({ success: true })),
    getIntentForIndexing: mock(() => Promise.resolve(null)),
    assignIntentToNetwork: mock(() => Promise.resolve()),
    unassignIntentFromIndex: mock(() => Promise.resolve()),
    getNetworkIdsForIntent: mock(() => Promise.resolve([])),
    isIntentAssignedToIndex: mock(() => Promise.resolve(false)),

    // Network membership
    getNetworkMemberships: mock(() => Promise.resolve([])),
    getUserIndexIds: mock(() => Promise.resolve([])),
    getOwnedIndexes: mock(() => Promise.resolve([])),
    getNetworkMembership: mock(() => Promise.resolve(null)),
    getNetworkMemberContext: mock(() => Promise.resolve(null)),

    // Network CRUD
    createNetwork: mock(() => Promise.resolve({ id: 'idx-1', title: 'Test', prompt: null, imageUrl: null, permissions: {} })),
    updateIndexSettings: mock(() => Promise.resolve({})),
    softDeleteNetwork: mock(() => Promise.resolve()),
    isIndexOwner: mock(() => Promise.resolve(false)),
    isPersonalNetwork: mock(() => Promise.resolve(false)),

    // Public network discovery
    getPublicIndexesNotJoined: mock(() => Promise.resolve({ networks: [] })),
    joinPublicNetwork: mock(() => Promise.resolve({ success: true })),

    // Opportunities
    getOpportunitiesForUser: mock(() => Promise.resolve([])),
    getOpportunity: mock(() => Promise.resolve(null)),
    updateOpportunityStatus: mock(() => Promise.resolve(null)),
    acceptSiblingOpportunities: mock(() => Promise.resolve([])),

    // HyDE
    getHydeDocument: mock(() => Promise.resolve(null)),
    getHydeDocumentsForSource: mock(() => Promise.resolve([])),
    saveHydeDocument: mock(() => Promise.resolve({})),
    deleteHydeDocumentsForSource: mock(() => Promise.resolve(0)),
  } as unknown as ChatDatabaseAdapter;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('createUserDatabase', () => {
  let mockDb: ChatDatabaseAdapter;
  let userDb: ReturnType<typeof createUserDatabase>;

  beforeEach(() => {
    mockDb = createMockDb();
    userDb = createUserDatabase(mockDb, AUTH_USER);
  });

  it('exposes authUserId', () => {
    expect(userDb.authUserId).toBe(AUTH_USER);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Operations — authUserId binding
  // ─────────────────────────────────────────────────────────────────────────────

  describe('profile operations bind authUserId', () => {
    it('getProfile delegates with authUserId', async () => {
      await userDb.getProfile();
      expect(mockDb.getProfile).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getProfileByUserId delegates with authUserId', async () => {
      await userDb.getProfileByUserId();
      expect(mockDb.getProfileByUserId).toHaveBeenCalledWith(AUTH_USER);
    });

    it('saveProfile delegates with authUserId', async () => {
      const profile = { summary: 'test' } as never;
      await userDb.saveProfile(profile);
      expect(mockDb.saveProfile).toHaveBeenCalledWith(AUTH_USER, profile);
    });

    it('deleteProfile delegates with authUserId', async () => {
      await userDb.deleteProfile();
      expect(mockDb.deleteProfile).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getUser delegates with authUserId', async () => {
      await userDb.getUser();
      expect(mockDb.getUser).toHaveBeenCalledWith(AUTH_USER);
    });

    it('updateUser delegates with authUserId', async () => {
      const data = { name: 'New Name' };
      await userDb.updateUser(data);
      expect(mockDb.updateUser).toHaveBeenCalledWith(AUTH_USER, data);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Intent Operations — ownership enforcement
  // ─────────────────────────────────────────────────────────────────────────────

  describe('intent ownership guards', () => {
    it('getIntent returns owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      const result = await userDb.getIntent('intent-1');
      expect(result).toEqual(ownedIntent);
    });

    it('getIntent returns null for missing intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      const result = await userDb.getIntent('missing');
      expect(result).toBeNull();
    });

    it('getIntent throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.getIntent('intent-2')).rejects.toThrow('Access denied');
    });

    it('updateIntent succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      await userDb.updateIntent('intent-1', { payload: 'updated' });
      expect(mockDb.updateIntent).toHaveBeenCalledWith('intent-1', { payload: 'updated' });
    });

    it('updateIntent throws for missing intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      await expect(userDb.updateIntent('missing', { payload: 'x' })).rejects.toThrow('Intent not found');
    });

    it('updateIntent throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.updateIntent('intent-2', { payload: 'x' })).rejects.toThrow('Access denied');
    });

    it('archiveIntent succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      await userDb.archiveIntent('intent-1');
      expect(mockDb.archiveIntent).toHaveBeenCalledWith('intent-1');
    });

    it('archiveIntent throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.archiveIntent('intent-2')).rejects.toThrow('Access denied');
    });

    it('associateIntentWithNetworks succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      await userDb.associateIntentWithNetworks('intent-1', ['idx-a', 'idx-b']);
      expect(mockDb.assignIntentToNetwork).toHaveBeenCalledTimes(2);
      expect(mockDb.assignIntentToNetwork).toHaveBeenCalledWith('intent-1', 'idx-a');
      expect(mockDb.assignIntentToNetwork).toHaveBeenCalledWith('intent-1', 'idx-b');
    });

    it('associateIntentWithNetworks throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.associateIntentWithNetworks('intent-2', ['idx-a'])).rejects.toThrow('Access denied');
    });

    it('assignIntentToNetwork succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      await userDb.assignIntentToNetwork('intent-1', 'idx-a', 0.9);
      expect(mockDb.assignIntentToNetwork).toHaveBeenCalledWith('intent-1', 'idx-a', 0.9);
    });

    it('assignIntentToNetwork throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.assignIntentToNetwork('intent-2', 'idx-a')).rejects.toThrow('Access denied');
    });

    it('unassignIntentFromIndex succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      await userDb.unassignIntentFromIndex('intent-1', 'idx-a');
      expect(mockDb.unassignIntentFromIndex).toHaveBeenCalledWith('intent-1', 'idx-a');
    });

    it('unassignIntentFromIndex throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.unassignIntentFromIndex('intent-2', 'idx-a')).rejects.toThrow('Access denied');
    });
  });

  describe('intent creation binds authUserId', () => {
    it('createIntent injects authUserId into data', async () => {
      await userDb.createIntent({ payload: 'new intent' });
      expect(mockDb.createIntent).toHaveBeenCalledWith({ payload: 'new intent', userId: AUTH_USER });
    });
  });

  describe('intent read operations bind authUserId', () => {
    it('getActiveIntents delegates with authUserId', async () => {
      await userDb.getActiveIntents();
      expect(mockDb.getActiveIntents).toHaveBeenCalledWith(AUTH_USER);
    });
  });

  describe('intent read operations — ownership guards', () => {
    it('getIntentForIndexing returns owned intent', async () => {
      (mockDb.getIntentForIndexing as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntentForIndexing);
      const result = await userDb.getIntentForIndexing('intent-1');
      expect(result).toEqual(ownedIntentForIndexing);
    });

    it('getIntentForIndexing returns null for missing intent', async () => {
      (mockDb.getIntentForIndexing as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      const result = await userDb.getIntentForIndexing('missing');
      expect(result).toBeNull();
    });

    it('getIntentForIndexing throws for intent owned by another user', async () => {
      (mockDb.getIntentForIndexing as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntentForIndexing);
      await expect(userDb.getIntentForIndexing('intent-2')).rejects.toThrow('Access denied');
    });

    it('getNetworkIdsForIntent succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      (mockDb.getNetworkIdsForIntent as ReturnType<typeof mock>).mockResolvedValueOnce(['idx-a', 'idx-b']);
      const result = await userDb.getNetworkIdsForIntent('intent-1');
      expect(result).toEqual(['idx-a', 'idx-b']);
      expect(mockDb.getNetworkIdsForIntent).toHaveBeenCalledWith('intent-1');
    });

    it('getNetworkIdsForIntent throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.getNetworkIdsForIntent('intent-2')).rejects.toThrow('Access denied');
    });

    it('getNetworkIdsForIntent throws for missing intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      await expect(userDb.getNetworkIdsForIntent('missing')).rejects.toThrow('Intent not found');
    });

    it('isIntentAssignedToIndex succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      (mockDb.isIntentAssignedToIndex as ReturnType<typeof mock>).mockResolvedValueOnce(true);
      const result = await userDb.isIntentAssignedToIndex('intent-1', 'idx-a');
      expect(result).toBe(true);
    });

    it('isIntentAssignedToIndex throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.isIntentAssignedToIndex('intent-2', 'idx-a')).rejects.toThrow('Access denied');
    });

    it('isIntentAssignedToIndex throws for missing intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      await expect(userDb.isIntentAssignedToIndex('missing', 'idx-a')).rejects.toThrow('Intent not found');
    });
  });

  describe('findSimilarIntents placeholder', () => {
    it('returns empty array (not yet implemented)', async () => {
      const result = await userDb.findSimilarIntents([1, 2, 3]);
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Membership Operations — authUserId binding
  // ─────────────────────────────────────────────────────────────────────────────

  describe('network membership operations bind authUserId', () => {
    it('getNetworkMemberships delegates with authUserId', async () => {
      await userDb.getNetworkMemberships();
      expect(mockDb.getNetworkMemberships).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getUserIndexIds delegates with authUserId', async () => {
      await userDb.getUserIndexIds();
      expect(mockDb.getUserIndexIds).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getOwnedIndexes delegates with authUserId', async () => {
      await userDb.getOwnedIndexes();
      expect(mockDb.getOwnedIndexes).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getNetworkMembership delegates with networkId and authUserId', async () => {
      await userDb.getNetworkMembership('idx-a');
      expect(mockDb.getNetworkMembership).toHaveBeenCalledWith('idx-a', AUTH_USER);
    });

    it('getNetworkMemberContext delegates with indexId and authUserId', async () => {
      await userDb.getNetworkMemberContext('idx-a');
      expect(mockDb.getNetworkMemberContext).toHaveBeenCalledWith('idx-a', AUTH_USER);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Index CRUD Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('network CRUD operations', () => {
    it('createNetwork delegates directly', async () => {
      const data = { title: 'Test Network' };
      await userDb.createNetwork(data);
      expect(mockDb.createNetwork).toHaveBeenCalledWith(data);
    });

    it('updateIndexSettings delegates with authUserId', async () => {
      const data = { title: 'Updated' };
      await userDb.updateIndexSettings('idx-a', data);
      expect(mockDb.updateIndexSettings).toHaveBeenCalledWith('idx-a', AUTH_USER, data);
    });

    it('softDeleteNetwork succeeds when user is owner and index is not personal', async () => {
      (mockDb.isIndexOwner as ReturnType<typeof mock>).mockResolvedValueOnce(true);
      (mockDb.isPersonalNetwork as ReturnType<typeof mock>).mockResolvedValueOnce(false);
      await userDb.softDeleteNetwork('idx-a');
      expect(mockDb.isIndexOwner).toHaveBeenCalledWith('idx-a', AUTH_USER);
      expect(mockDb.softDeleteNetwork).toHaveBeenCalledWith('idx-a');
    });

    it('softDeleteNetwork throws when user is not owner', async () => {
      (mockDb.isIndexOwner as ReturnType<typeof mock>).mockResolvedValueOnce(false);
      await expect(userDb.softDeleteNetwork('idx-a')).rejects.toThrow('Access denied');
    });

    it('softDeleteNetwork throws when index is personal even if user is owner', async () => {
      (mockDb.isIndexOwner as ReturnType<typeof mock>).mockResolvedValueOnce(true);
      (mockDb.isPersonalNetwork as ReturnType<typeof mock>).mockResolvedValueOnce(true);
      await expect(userDb.softDeleteNetwork('idx-personal')).rejects.toThrow('Cannot delete personal index');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Index Discovery
  // ─────────────────────────────────────────────────────────────────────────────

  describe('public network discovery binds authUserId', () => {
    it('getPublicIndexesNotJoined delegates with authUserId', async () => {
      const result = await userDb.getPublicIndexesNotJoined();
      expect(mockDb.getPublicIndexesNotJoined).toHaveBeenCalledWith(AUTH_USER);
      expect(result).toMatchObject({ networks: [] });
    });

    it('joinPublicNetwork delegates with networkId and authUserId', async () => {
      await userDb.joinPublicNetwork('idx-public');
      expect(mockDb.joinPublicNetwork).toHaveBeenCalledWith('idx-public', AUTH_USER);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Opportunity Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('opportunity operations', () => {
    it('getOpportunitiesForUser delegates with authUserId', async () => {
      const opts = { limit: 10 };
      await userDb.getOpportunitiesForUser(opts);
      expect(mockDb.getOpportunitiesForUser).toHaveBeenCalledWith(AUTH_USER, opts);
    });

    it('getOpportunity returns opportunity when user is an actor', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce(ownedOpportunity);
      const result = await userDb.getOpportunity('opp-1');
      expect(result).toEqual(ownedOpportunity);
    });

    it('getOpportunity returns null for missing opportunity', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      const result = await userDb.getOpportunity('missing');
      expect(result).toBeNull();
    });

    it('getOpportunity throws when user is not an actor', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce(otherOpportunity);
      await expect(userDb.getOpportunity('opp-2')).rejects.toThrow('Access denied');
    });

    it('getOpportunity throws for latent opportunity hidden by visibility rules', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce(latentWithIntroducer);
      await expect(userDb.getOpportunity('opp-3')).rejects.toThrow('Access denied');
    });

    it('updateOpportunityStatus succeeds when user is an actor', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce(ownedOpportunity);
      await userDb.updateOpportunityStatus('opp-1', 'accepted' as never);
      expect(mockDb.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'accepted', AUTH_USER);
    });

    it('updateOpportunityStatus throws for missing opportunity', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      await expect(userDb.updateOpportunityStatus('missing', 'accepted' as never)).rejects.toThrow('not found');
    });

    it('updateOpportunityStatus throws when user is not an actor', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce(otherOpportunity);
      await expect(userDb.updateOpportunityStatus('opp-2', 'accepted' as never)).rejects.toThrow('Access denied');
    });

    it('updateOpportunityStatus throws for latent opportunity hidden by visibility rules', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce(latentWithIntroducer);
      await expect(userDb.updateOpportunityStatus('opp-3', 'accepted' as never)).rejects.toThrow('Access denied');
    });

    it('acceptSiblingOpportunities delegates with authUserId', async () => {
      await userDb.acceptSiblingOpportunities(OTHER_USER, 'opp-exclude');
      expect(mockDb.acceptSiblingOpportunities).toHaveBeenCalledWith(AUTH_USER, OTHER_USER, 'opp-exclude');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // HyDE Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('HyDE operations delegate directly', () => {
    it('getHydeDocument delegates', async () => {
      await userDb.getHydeDocument('intent' as never, 'src-1', 'strategy-1');
      expect(mockDb.getHydeDocument).toHaveBeenCalledWith('intent', 'src-1', 'strategy-1');
    });

    it('getHydeDocumentsForSource delegates', async () => {
      await userDb.getHydeDocumentsForSource('intent' as never, 'src-1');
      expect(mockDb.getHydeDocumentsForSource).toHaveBeenCalledWith('intent', 'src-1');
    });

    it('saveHydeDocument delegates', async () => {
      const data = { sourceType: 'intent', sourceId: 'x' } as never;
      await userDb.saveHydeDocument(data);
      expect(mockDb.saveHydeDocument).toHaveBeenCalledWith(data);
    });

    it('deleteHydeDocumentsForSource delegates', async () => {
      await userDb.deleteHydeDocumentsForSource('intent' as never, 'src-1');
      expect(mockDb.deleteHydeDocumentsForSource).toHaveBeenCalledWith('intent', 'src-1');
    });
  });
});
