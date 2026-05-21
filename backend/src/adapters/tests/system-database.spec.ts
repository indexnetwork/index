/**
 * Unit tests for createSystemDatabase factory.
 *
 * Tests scope enforcement (verifyScope), cross-user access via verifySharedIndex,
 * embedder integration, and delegation to ChatDatabaseAdapter.
 * Uses a mock ChatDatabaseAdapter — no database connection needed.
 */

import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Mock getPersonalIndexId before importing the module under test.
// This prevents verifySharedIndex from hitting the real DB.
const mockGetPersonalIndexId = mock(() => Promise.resolve(null));
mock.module('../database.adapter', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- self-mock needs runtime require to preserve original exports
  const actual = require('../database.adapter');
  return {
    ...actual,
    getPersonalIndexId: mockGetPersonalIndexId,
  };
});

import { createSystemDatabase } from '../database.adapter';
import type { ChatDatabaseAdapter } from '../database.adapter';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_USER = 'user-auth-123';
const OTHER_USER = 'user-other-456';
const SCOPED_INDEX = 'index-scoped-1';
const SCOPED_INDEX_2 = 'index-scoped-2';
const OUT_OF_SCOPE_INDEX = 'index-out-of-scope';

function createMockDb(): ChatDatabaseAdapter {
  return {
    // Profile
    getProfile: mock(() => Promise.resolve(null)),
    getUser: mock(() => Promise.resolve(null)),

    // Intents
    getIntent: mock(() => Promise.resolve(null)),
    getNetworkIntentsForMember: mock(() => Promise.resolve([])),
    getIntentsInIndexForMember: mock(() => Promise.resolve([])),

    // Network membership
    getNetworkMemberships: mock(() => Promise.resolve([])),
    getNetworkMembership: mock(() => Promise.resolve(null)),
    isNetworkMember: mock(() => Promise.resolve(false)),
    isIndexOwner: mock(() => Promise.resolve(false)),
    getNetworkMembersForMember: mock(() => Promise.resolve([])),
    getMembersFromUserIndexes: mock(() => Promise.resolve([])),
    addMemberToNetwork: mock(() => Promise.resolve({ success: true })),
    removeMemberFromIndex: mock(() => Promise.resolve({ success: true })),

    // Index operations
    getNetwork: mock(() => Promise.resolve(null)),
    getNetworkWithPermissions: mock(() => Promise.resolve(null)),
    getNetworkMemberCount: mock(() => Promise.resolve(0)),

    // Opportunities
    createOpportunity: mock(() => Promise.resolve({})),
    createOpportunityAndExpireIds: mock(() => Promise.resolve({ created: {}, expired: [] })),
    getOpportunity: mock(() => Promise.resolve(null)),
    getOpportunitiesForNetwork: mock(() => Promise.resolve([])),
    updateOpportunityStatus: mock(() => Promise.resolve(null)),
    opportunityExistsBetweenActors: mock(() => Promise.resolve(false)),
    findOpportunitiesByActors: mock(() => Promise.resolve([])),
    expireOpportunitiesByIntent: mock(() => Promise.resolve(0)),
    expireOpportunitiesForRemovedMember: mock(() => Promise.resolve(0)),
    expireStaleOpportunities: mock(() => Promise.resolve(0)),

    // HyDE
    getHydeDocument: mock(() => Promise.resolve(null)),
    getHydeDocumentsForSource: mock(() => Promise.resolve([])),
    saveHydeDocument: mock(() => Promise.resolve({})),
    deleteExpiredHydeDocuments: mock(() => Promise.resolve(0)),
    getStaleHydeDocuments: mock(() => Promise.resolve([])),
  } as unknown as ChatDatabaseAdapter;
}

function createMockEmbedder() {
  return {
    search: mock(() => Promise.resolve([])),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('createSystemDatabase', () => {
  let mockDb: ChatDatabaseAdapter;
  let sysDb: ReturnType<typeof createSystemDatabase>;

  beforeEach(() => {
    mockDb = createMockDb();
    sysDb = createSystemDatabase(mockDb, AUTH_USER, [SCOPED_INDEX, SCOPED_INDEX_2]);
  });

  it('exposes authUserId and indexScope', () => {
    expect(sysDb.authUserId).toBe(AUTH_USER);
    expect(sysDb.indexScope).toEqual([SCOPED_INDEX, SCOPED_INDEX_2]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope enforcement (verifyScope)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('verifyScope — index operations', () => {
    it('getIntentsInIndex allows scoped index', async () => {
      await sysDb.getIntentsInIndex(SCOPED_INDEX);
      expect(mockDb.getNetworkIntentsForMember).toHaveBeenCalledWith(SCOPED_INDEX, AUTH_USER, undefined);
    });

    it('getIntentsInIndex throws for out-of-scope index', async () => {
      await expect(sysDb.getIntentsInIndex(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('getUserIntentsInIndex allows scoped index', async () => {
      await sysDb.getUserIntentsInIndex(OTHER_USER, SCOPED_INDEX);
      expect(mockDb.getIntentsInIndexForMember).toHaveBeenCalledWith(OTHER_USER, SCOPED_INDEX);
    });

    it('getUserIntentsInIndex throws for out-of-scope index', async () => {
      await expect(sysDb.getUserIntentsInIndex(OTHER_USER, OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('getNetworkMembers allows scoped index', async () => {
      await sysDb.getNetworkMembers(SCOPED_INDEX);
      expect(mockDb.getNetworkMembersForMember).toHaveBeenCalledWith(SCOPED_INDEX, AUTH_USER);
    });

    it('getNetworkMembers throws for out-of-scope index', async () => {
      await expect(sysDb.getNetworkMembers(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('getNetwork allows scoped index', async () => {
      await sysDb.getNetwork(SCOPED_INDEX);
      expect(mockDb.getNetwork).toHaveBeenCalledWith(SCOPED_INDEX);
    });

    it('getNetwork throws for out-of-scope index', async () => {
      await expect(sysDb.getNetwork(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('getNetworkWithPermissions allows scoped index', async () => {
      await sysDb.getNetworkWithPermissions(SCOPED_INDEX);
      expect(mockDb.getNetworkWithPermissions).toHaveBeenCalledWith(SCOPED_INDEX);
    });

    it('getNetworkWithPermissions throws for out-of-scope index', async () => {
      await expect(sysDb.getNetworkWithPermissions(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('getNetworkMemberCount allows scoped index', async () => {
      await sysDb.getNetworkMemberCount(SCOPED_INDEX);
      expect(mockDb.getNetworkMemberCount).toHaveBeenCalledWith(SCOPED_INDEX);
    });

    it('getNetworkMemberCount throws for out-of-scope index', async () => {
      await expect(sysDb.getNetworkMemberCount(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope enforcement — opportunity operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('verifyScope — opportunity operations', () => {
    it('createOpportunity allows scoped networkId in context', async () => {
      const data = { context: { networkId: SCOPED_INDEX } } as never;
      await sysDb.createOpportunity(data);
      expect(mockDb.createOpportunity).toHaveBeenCalledWith(data);
    });

    it('createOpportunity throws for out-of-scope networkId in context', () => {
      const data = { context: { networkId: OUT_OF_SCOPE_INDEX } } as never;
      expect(() => sysDb.createOpportunity(data)).toThrow('not in scope');
    });

    it('createOpportunity allows data without context.indexId', async () => {
      const data = { context: {} } as never;
      await sysDb.createOpportunity(data);
      expect(mockDb.createOpportunity).toHaveBeenCalled();
    });

    it('getOpportunitiesForNetwork allows scoped index', async () => {
      await sysDb.getOpportunitiesForNetwork(SCOPED_INDEX);
      expect(mockDb.getOpportunitiesForNetwork).toHaveBeenCalledWith(SCOPED_INDEX, undefined);
    });

    it('getOpportunitiesForNetwork throws for out-of-scope index', async () => {
      await expect(sysDb.getOpportunitiesForNetwork(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('updateOpportunityStatus validates scope via opportunity lookup', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'opp-1',
        context: { networkId: SCOPED_INDEX },
      });
      await sysDb.updateOpportunityStatus('opp-1', 'accepted' as never);
      expect(mockDb.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'accepted');
    });

    it('updateOpportunityStatus throws for missing opportunity', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      await expect(sysDb.updateOpportunityStatus('missing', 'accepted' as never)).rejects.toThrow('not found');
    });

    it('updateOpportunityStatus throws for out-of-scope opportunity', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'opp-1',
        context: { networkId: OUT_OF_SCOPE_INDEX },
      });
      await expect(sysDb.updateOpportunityStatus('opp-1', 'accepted' as never)).rejects.toThrow('not in scope');
    });

    it('updateOpportunityStatus throws for opportunity without networkId', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'opp-1',
        context: {},
      });
      await expect(sysDb.updateOpportunityStatus('opp-1', 'accepted' as never)).rejects.toThrow('not found');
    });

    it('opportunityExistsBetweenActors allows scoped index', async () => {
      await sysDb.opportunityExistsBetweenActors([AUTH_USER, OTHER_USER], SCOPED_INDEX);
      expect(mockDb.opportunityExistsBetweenActors).toHaveBeenCalledWith([AUTH_USER, OTHER_USER], SCOPED_INDEX);
    });

    it('opportunityExistsBetweenActors throws for out-of-scope index', () => {
      expect(() =>
        sysDb.opportunityExistsBetweenActors([AUTH_USER], OUT_OF_SCOPE_INDEX)
      ).toThrow('not in scope');
    });

  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Unscoped pass-through operations
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // Intentionally unscoped operations — system-level methods
  //
  // These methods are called by background queues, agent graphs, and event
  // handlers that operate across user boundaries by design. They bypass
  // verifyScope/verifySharedIndex intentionally and are documented with TSDoc.
  // ─────────────────────────────────────────────────────────────────────────────

  describe('intentionally unscoped system operations', () => {
    it('getIntent delegates directly (used by graphs for cross-user intent lookup)', async () => {
      await sysDb.getIntent('intent-1');
      expect(mockDb.getIntent).toHaveBeenCalledWith('intent-1');
    });

    it('isNetworkMember delegates directly (used by graphs for membership checks)', async () => {
      await sysDb.isNetworkMember(SCOPED_INDEX, OTHER_USER);
      expect(mockDb.isNetworkMember).toHaveBeenCalledWith(SCOPED_INDEX, OTHER_USER);
    });

    it('isIndexOwner delegates directly (used by graphs for ownership checks)', async () => {
      await sysDb.isIndexOwner(SCOPED_INDEX, AUTH_USER);
      expect(mockDb.isIndexOwner).toHaveBeenCalledWith(SCOPED_INDEX, AUTH_USER);
    });

    it('addMemberToNetwork delegates directly (used by join flows and invitation acceptance)', async () => {
      await sysDb.addMemberToNetwork(SCOPED_INDEX, OTHER_USER, 'member');
      expect(mockDb.addMemberToNetwork).toHaveBeenCalledWith(SCOPED_INDEX, OTHER_USER, 'member');
    });

    it('removeMemberFromIndex delegates directly (used by leave/kick flows)', async () => {
      await sysDb.removeMemberFromIndex(SCOPED_INDEX, OTHER_USER);
      expect(mockDb.removeMemberFromIndex).toHaveBeenCalledWith(SCOPED_INDEX, OTHER_USER);
    });

    it('getMembersFromScope delegates with authUserId', async () => {
      await sysDb.getMembersFromScope();
      expect(mockDb.getMembersFromUserIndexes).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getOpportunity delegates directly (used by negotiation graph for cross-actor lookup)', async () => {
      await sysDb.getOpportunity('opp-1');
      expect(mockDb.getOpportunity).toHaveBeenCalledWith('opp-1');
    });

    it('findOpportunitiesByActors delegates directly', async () => {
      const actorIds = [AUTH_USER, OTHER_USER];
      await sysDb.findOpportunitiesByActors(actorIds, { includeIntroducers: true });
      expect(mockDb.findOpportunitiesByActors).toHaveBeenCalledWith(actorIds, { includeIntroducers: true });
    });

    it('createOpportunityAndExpireIds delegates directly (used by discovery pipeline)', async () => {
      const data = { context: {} } as never;
      await sysDb.createOpportunityAndExpireIds(data, ['exp-1']);
      expect(mockDb.createOpportunityAndExpireIds).toHaveBeenCalledWith(data, ['exp-1']);
    });

    it('expireOpportunitiesByIntent delegates directly (used by intent archival)', async () => {
      await sysDb.expireOpportunitiesByIntent('intent-1');
      expect(mockDb.expireOpportunitiesByIntent).toHaveBeenCalledWith('intent-1');
    });

    it('expireOpportunitiesForRemovedMember delegates directly (used by member removal)', async () => {
      await sysDb.expireOpportunitiesForRemovedMember(SCOPED_INDEX, OTHER_USER);
      expect(mockDb.expireOpportunitiesForRemovedMember).toHaveBeenCalledWith(SCOPED_INDEX, OTHER_USER);
    });

    it('expireStaleOpportunities delegates directly (used by scheduled cleanup)', async () => {
      await sysDb.expireStaleOpportunities();
      expect(mockDb.expireStaleOpportunities).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // HyDE Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('HyDE operations delegate directly', () => {
    it('getHydeDocument delegates', async () => {
      await sysDb.getHydeDocument('intent' as never, 'src-1', 'strategy-1');
      expect(mockDb.getHydeDocument).toHaveBeenCalledWith('intent', 'src-1', 'strategy-1');
    });

    it('getHydeDocumentsForSource delegates', async () => {
      await sysDb.getHydeDocumentsForSource('intent' as never, 'src-1');
      expect(mockDb.getHydeDocumentsForSource).toHaveBeenCalledWith('intent', 'src-1');
    });

    it('saveHydeDocument delegates', async () => {
      const data = { sourceType: 'intent' } as never;
      await sysDb.saveHydeDocument(data);
      expect(mockDb.saveHydeDocument).toHaveBeenCalledWith(data);
    });

    it('deleteExpiredHydeDocuments delegates', async () => {
      await sysDb.deleteExpiredHydeDocuments();
      expect(mockDb.deleteExpiredHydeDocuments).toHaveBeenCalled();
    });

    it('getStaleHydeDocuments delegates', async () => {
      const threshold = new Date();
      await sysDb.getStaleHydeDocuments(threshold);
      expect(mockDb.getStaleHydeDocuments).toHaveBeenCalledWith(threshold);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // findSimilarIntentsInScope — embedder integration
  // ─────────────────────────────────────────────────────────────────────────────

  describe('findSimilarIntentsInScope', () => {
    it('returns empty array when no embedder provided', async () => {
      const result = await sysDb.findSimilarIntentsInScope([1, 2, 3]);
      expect(result).toEqual([]);
    });

    it('returns empty array when indexScope is empty', async () => {
      const emptyScope = createSystemDatabase(mockDb, AUTH_USER, [], createMockEmbedder());
      const result = await emptyScope.findSimilarIntentsInScope([1, 2, 3]);
      expect(result).toEqual([]);
    });

    it('calls embedder.search and maps results with intent data', async () => {
      const mockEmbedder = createMockEmbedder();
      const sysDbWithEmbedder = createSystemDatabase(mockDb, AUTH_USER, [SCOPED_INDEX], mockEmbedder);

      const intentData = {
        id: 'intent-1',
        payload: 'test',
        summary: 'sum',
        userId: AUTH_USER,
        isIncognito: false,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        archivedAt: null,
      };

      (mockEmbedder.search as ReturnType<typeof mock>).mockResolvedValueOnce([
        { item: { id: 'intent-1', payload: 'test', summary: 'sum', userId: AUTH_USER }, score: 0.85 },
      ]);
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(intentData);

      const result = await sysDbWithEmbedder.findSimilarIntentsInScope([1, 2, 3], { limit: 5, threshold: 0.8 });

      expect(mockEmbedder.search).toHaveBeenCalledWith(
        [1, 2, 3],
        'intents',
        { limit: 5, minScore: 0.8, filter: { indexScope: [SCOPED_INDEX] } },
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('intent-1');
      expect(result[0].similarity).toBe(0.85);
    });

    it('filters out intents that no longer exist', async () => {
      const mockEmbedder = createMockEmbedder();
      const sysDbWithEmbedder = createSystemDatabase(mockDb, AUTH_USER, [SCOPED_INDEX], mockEmbedder);

      (mockEmbedder.search as ReturnType<typeof mock>).mockResolvedValueOnce([
        { item: { id: 'intent-1', payload: 'test', summary: null, userId: AUTH_USER }, score: 0.9 },
        { item: { id: 'intent-deleted', payload: 'gone', summary: null, userId: AUTH_USER }, score: 0.8 },
      ]);
      // First intent exists, second doesn't
      (mockDb.getIntent as ReturnType<typeof mock>)
        .mockResolvedValueOnce({
          id: 'intent-1', payload: 'test', summary: null, userId: AUTH_USER,
          isIncognito: false, createdAt: new Date(), updatedAt: new Date(), archivedAt: null,
        })
        .mockResolvedValueOnce(null);

      const result = await sysDbWithEmbedder.findSimilarIntentsInScope([1, 2, 3]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('intent-1');
    });

    it('uses default limit=10 and threshold=0.7 when options omitted', async () => {
      const mockEmbedder = createMockEmbedder();
      const sysDbWithEmbedder = createSystemDatabase(mockDb, AUTH_USER, [SCOPED_INDEX], mockEmbedder);

      (mockEmbedder.search as ReturnType<typeof mock>).mockResolvedValueOnce([]);

      await sysDbWithEmbedder.findSimilarIntentsInScope([1, 2, 3]);

      expect(mockEmbedder.search).toHaveBeenCalledWith(
        [1, 2, 3],
        'intents',
        { limit: 10, minScore: 0.7, filter: { indexScope: [SCOPED_INDEX] } },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile operations — verifySharedIndex
  // ─────────────────────────────────────────────────────────────────────────────

  describe('verifySharedIndex — profile/user access', () => {
    it('getProfile allows access to own profile (userId === authUserId)', async () => {
      await sysDb.getProfile(AUTH_USER);
      expect(mockDb.getProfile).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getUser allows access to own user (userId === authUserId)', async () => {
      await sysDb.getUser(AUTH_USER);
      expect(mockDb.getUser).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getProfile allows access when other user shares a scoped network', async () => {
      (mockDb.getNetworkMemberships as ReturnType<typeof mock>).mockResolvedValueOnce([
        { networkId: SCOPED_INDEX },
      ]);
      await sysDb.getProfile(OTHER_USER);
      expect(mockDb.getProfile).toHaveBeenCalledWith(OTHER_USER);
    });

    it('getProfile throws when other user shares no scoped network and no personal network contact', async () => {
      // No shared memberships, getPersonalIndexId returns null (mocked)
      (mockDb.getNetworkMemberships as ReturnType<typeof mock>).mockResolvedValueOnce([
        { networkId: 'some-unrelated-network' },
      ]);
      await expect(sysDb.getProfile(OTHER_USER)).rejects.toThrow('no shared index');
    });

    it('getUser throws when other user shares no scoped network and no personal network contact', async () => {
      (mockDb.getNetworkMemberships as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(sysDb.getUser(OTHER_USER)).rejects.toThrow('no shared index');
    });
  });
});
