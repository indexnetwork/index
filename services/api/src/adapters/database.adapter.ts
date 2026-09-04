/**
 * Database adapters used by controllers, services, and crons — public barrel.
 * Postgres implementations split into ./database/*.database.adapter.ts by domain.
 * No dependency on lib/protocol. Import adapters/types/helpers from here.
 */

// ── Domain adapter classes (public surface) ──
export { IntentDatabaseAdapter } from './intent.database.adapter';
export { ChatDatabaseAdapter } from './chat.database.adapter';
export { EnrichmentDatabaseAdapter } from './enrichment.database.adapter';
export { OpportunityDatabaseAdapter } from './opportunity.database.adapter';
import { negotiationDatabaseAdapter, type NegotiationDatabaseAdapter } from './negotiation.database.adapter';
export { HydeDatabaseAdapter } from './hyde.database.adapter';
export { UserDatabaseAdapter } from './user.database.adapter';
export { ConversationDatabaseAdapter } from './conversation.database.adapter';

// ── Public helpers + DTO types ──
export type {
  ResolvedParticipant, ConversationSummary,
} from './database.shared';

// ── Imports for singletons + scoped-DB factories ──
import { IntentDatabaseAdapter } from './intent.database.adapter';
import { ChatDatabaseAdapter } from './chat.database.adapter';
import { UserDatabaseAdapter } from './user.database.adapter';
import { ConversationDatabaseAdapter } from './conversation.database.adapter';
import { Id, SimilarIntent, VectorStore, canActorSeeOpportunity, log } from './database.shared';

// ── Singletons ──
export const chatDatabaseAdapter = new ChatDatabaseAdapter();
export const userDatabaseAdapter = new UserDatabaseAdapter();
export const intentDatabaseAdapter = new IntentDatabaseAdapter();
export const conversationDatabaseAdapter = new ConversationDatabaseAdapter();

// ── Scoped database factories ──
export function createUserDatabase(db: ChatDatabaseAdapter, authUserId: string) {
  return {
    authUserId,

    // ─────────────────────────────────────────────────────────────────────────────
    // Profile Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getProfile: () => db.getProfile(authUserId),
    getProfileByUserId: () => db.getProfileByUserId(authUserId),
    saveProfile: (profile: Parameters<ChatDatabaseAdapter['saveProfile']>[1]) => db.saveProfile(authUserId, profile),
    deleteProfile: () => db.deleteProfile(authUserId),
    getUser: () => db.getUser(authUserId),
    updateUser: (data: Parameters<ChatDatabaseAdapter['updateUser']>[1]) => db.updateUser(authUserId, data),
    getUserSocials: () => db.getUserSocials(authUserId),
    setUserSocials: (socials: { label: string; value: string }[]) => db.setUserSocials(authUserId, socials),

    // ─────────────────────────────────────────────────────────────────────────────
    // Intent Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getActiveIntents: () => db.getActiveIntents(authUserId),
    searchOwnIntents: (q: string, limit: number) => db.searchOwnIntents(authUserId, q, limit),
    getIntent: async (intentId: string) => {
      // Enforce ownership by checking userId on returned intent
      const intent = await db.getIntent(intentId);
      if (!intent) return null;
      if (intent.userId !== authUserId) {
        throw new Error('Access denied: intent not owned by user');
      }
      return intent;
    },
    createIntent: (data: Omit<Parameters<ChatDatabaseAdapter['createIntent']>[0], 'userId'>) => db.createIntent({ ...data, userId: authUserId }),
    updateIntent: async (intentId: string, data: Parameters<ChatDatabaseAdapter['updateIntent']>[1]) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.updateIntent(intentId, data);
    },
    archiveIntent: async (intentId: string) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.archiveIntent(intentId);
    },
    findSimilarIntents: async (_embedding: number[], _options?: { limit?: number; threshold?: number }) => {
      // findSimilarIntents is not yet implemented on ChatDatabaseAdapter
      // This is a placeholder - would need vector search implementation
      log.warn('UserDatabase.findSimilarIntents called but not fully implemented');
      return [] as SimilarIntent[];
    },
    getIntentForIndexing: async (intentId: string) => {
      const intent = await db.getIntentForIndexing(intentId);
      if (!intent) return null;
      if (intent.userId !== authUserId) {
        throw new Error('Access denied: intent not owned by user');
      }
      return intent;
    },
    associateIntentWithNetworks: async (intentId: string, indexIds: string[]) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      for (const networkId of indexIds) {
        await db.assignIntentToNetwork(intentId, networkId);
      }
    },
    assignIntentToNetwork: async (
      intentId: string,
      networkId: string,
      relevancyScore?: number,
      assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
    ) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.assignIntentToNetwork(intentId, networkId, relevancyScore, assignmentMetadata);
    },
    assignIntentToNetworkIfMember: (
      userId: string,
      intentId: string,
      networkId: string,
      relevancyScore?: number,
      assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
    ) => userId === authUserId
      ? intentDatabaseAdapter.assignIntentToNetworkIfMember(
          userId,
          intentId,
          networkId,
          relevancyScore,
          assignmentMetadata,
        )
      : Promise.resolve({ kind: 'intent_not_owned_or_not_found' } as const),
    unassignIntentFromIndex: async (intentId: string, networkId: string) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.unassignIntentFromIndex(intentId, networkId);
    },
    getNetworkIdsForIntent: async (intentId: string) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.getNetworkIdsForIntent(intentId);
    },
    isIntentAssignedToIndex: async (intentId: string, networkId: string) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.isIntentAssignedToIndex(intentId, networkId);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Network Membership Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getNetworkMemberships: () => db.getNetworkMemberships(authUserId),
    getUserIndexIds: () => db.getUserIndexIds(authUserId),
    getOwnedIndexes: () => db.getOwnedIndexes(authUserId),
    getNetworkMembership: (networkId: string) => db.getNetworkMembership(networkId, authUserId),
    getNetworkMemberContext: (networkId: string) => db.getNetworkMemberContext(networkId, authUserId),
    getNetworkAssignmentContext: (networkId: string) => db.getNetworkAssignmentContext(networkId, authUserId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Index CRUD Operations
    // ─────────────────────────────────────────────────────────────────────────────
    createNetwork: (data: Parameters<ChatDatabaseAdapter['createNetwork']>[0]) => db.createNetwork(data),
    updateIndexSettings: (networkId: string, data: Parameters<ChatDatabaseAdapter['updateIndexSettings']>[2]) => db.updateIndexSettings(networkId, authUserId, data),
    softDeleteNetwork: async (networkId: string) => {
      const isOwner = await db.isIndexOwner(networkId, authUserId);
      if (!isOwner) throw new Error('Access denied: not network owner');
      return db.softDeleteNetwork(networkId);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Public Network Discovery
    // ─────────────────────────────────────────────────────────────────────────────
    getPublicIndexesNotJoined: () => db.getPublicIndexesNotJoined(authUserId),
    joinPublicNetwork: (networkId: string) => db.joinPublicNetwork(networkId, authUserId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Opportunity Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getOpportunitiesForUser: (options?: Parameters<ChatDatabaseAdapter['getOpportunitiesForUser']>[1]) => db.getOpportunitiesForUser(authUserId, options),
    getOpportunity: async (id: string) => {
      const opportunity = await db.getOpportunity(id);
      if (!opportunity) return null;
      if (!canActorSeeOpportunity(opportunity.actors, opportunity.status, authUserId))
        throw new Error('Access denied: opportunity not visible to user');
      return opportunity;
    },
    updateOpportunityStatus: async (id: string, status: Parameters<ChatDatabaseAdapter['updateOpportunityStatus']>[1]) => {
      const opportunity = await db.getOpportunity(id);
      if (!opportunity) throw new Error('Opportunity not found');
      if (!canActorSeeOpportunity(opportunity.actors, opportunity.status, authUserId))
        throw new Error('Access denied: opportunity not visible to user');
      return db.updateOpportunityStatus(id, status, status === 'accepted' ? authUserId : undefined);
    },
    acceptSiblingOpportunities: (counterpartUserId: string, excludeOpportunityId: string) =>
      db.acceptSiblingOpportunities(authUserId, counterpartUserId, excludeOpportunityId),

    // ─────────────────────────────────────────────────────────────────────────────
    // HyDE Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getHydeDocument: (sourceType: Parameters<ChatDatabaseAdapter['getHydeDocument']>[0], sourceId: string, strategy: string) => db.getHydeDocument(sourceType, sourceId, strategy),
    getHydeDocumentsForSource: (sourceType: Parameters<ChatDatabaseAdapter['getHydeDocumentsForSource']>[0], sourceId: string) => db.getHydeDocumentsForSource(sourceType, sourceId),
    saveHydeDocument: (data: Parameters<ChatDatabaseAdapter['saveHydeDocument']>[0]) => db.saveHydeDocument(data),
    deleteHydeDocumentsForSource: (sourceType: Parameters<ChatDatabaseAdapter['deleteHydeDocumentsForSource']>[0], sourceId: string) => db.deleteHydeDocumentsForSource(sourceType, sourceId),
  };
}

/**
 * Creates a SystemDatabase bound to the authenticated user and network scope.
 * Cross-user operations are restricted to users within the shared networks.
 *
 * @param db - The raw ChatDatabaseAdapter
 * @param authUserId - The authenticated user's ID
 * @param indexScope - Array of network IDs the user has access to
 * @param embedder - Optional vector store for findSimilarIntentsInScope (pgvector search). When omitted, findSimilarIntentsInScope returns [].
 * @returns A SystemDatabase bound to authUserId and indexScope
 */
export function createSystemDatabase(
  db: ChatDatabaseAdapter,
  authUserId: string,
  indexScope: string[],
  embedder?: VectorStore,
) {
  /**
   * Verify that a networkId is within the allowed scope.
   * Throws if the network is not in scope.
   */
  const verifyScope = (networkId: string): void => {
    if (!indexScope.includes(networkId)) {
      throw new Error(`Access denied: index ${networkId} not in scope`);
    }
  };

  /**
   * Verify that a user shares at least one index with the auth user.
   * Returns true if they share an index, false otherwise.
   */
  const verifySharedIndex = async (userId: string): Promise<boolean> => {
    if (userId === authUserId) return true;
    const theirMemberships = await db.getNetworkMemberships(userId);
    if (theirMemberships.some((m) => indexScope.includes(m.networkId))) return true;

    return false;
  };

  return {
    authUserId,
    indexScope,

    // ─────────────────────────────────────────────────────────────────────────────
    // Profile Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    getProfile: async (userId: string) => {
      if (!(await verifySharedIndex(userId))) {
        throw new Error('Access denied: no shared network with user');
      }
      return db.getProfile(userId);
    },
    getUser: async (userId: string) => {
      if (!(await verifySharedIndex(userId))) {
        throw new Error('Access denied: no shared network with user');
      }
      return db.getUser(userId);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Intent Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    getIntentsInIndex: async (networkId: string, options?: { limit?: number; offset?: number }) => {
      verifyScope(networkId);
      return db.getNetworkIntentsForMember(networkId, authUserId, options);
    },
    getUserIntentsInIndex: async (userId: string, networkId: string) => {
      verifyScope(networkId);
      return db.getIntentsInIndexForMember(userId, networkId);
    },
    getActiveIntentsAcrossIndexes: async (userId: string, indexIds: string[]) => {
      // Caller-only semantic: the method returns the *caller's own* intents.
      // Reject cross-user lookups at the systemDb boundary as defense-in-depth,
      // even though the tool layer always passes context.userId today.
      if (userId !== authUserId) {
        throw new Error('Access denied: getActiveIntentsAcrossIndexes is caller-only');
      }
      // Filter to only IDs within scope before delegating.
      const scopedIds = indexIds.filter((id) => indexScope.includes(id));
      return db.getActiveIntentsAcrossIndexes(userId, scopedIds);
    },
    /**
     * Retrieves an intent by ID without scope check.
     * @remarks Intentionally unscoped -- used by agent graphs (e.g. opportunity evaluator,
     * negotiation) that need cross-user intent access within the discovery pipeline.
     */
    getIntent: (intentId: string) => db.getIntent(intentId),
    findSimilarIntentsInScope: async (embedding: number[], options?: { limit?: number; threshold?: number }) => {
      if (!embedder || indexScope.length === 0) {
        return [] as SimilarIntent[];
      }
      const limit = options?.limit ?? 10;
      const threshold = options?.threshold ?? 0.7;
      const results = await embedder.search<{ id: string; payload: string; summary: string | null; userId: string }>(
        embedding,
        'intents',
        { limit, minScore: threshold, filter: { indexScope } }
      );
      const intents = await Promise.all(results.map((r) => db.getIntent(r.item.id)));
      return results
        .map((r, i) => ({ r, intent: intents[i] }))
        .filter((pair): pair is { r: (typeof results)[0]; intent: NonNullable<(typeof intents)[0]> } =>
          pair.intent != null &&
          !pair.intent.archivedAt &&
          (pair.intent.status == null || pair.intent.status === 'ACTIVE')
        )
        .map(({ r, intent }): SimilarIntent => ({
          id: intent.id,
          payload: intent.payload,
          summary: intent.summary ?? null,
          userId: intent.userId,
          isIncognito: intent.isIncognito ?? false,
          createdAt: intent.createdAt,
          updatedAt: intent.updatedAt,
          archivedAt: intent.archivedAt ?? null,
          similarity: r.score,
        }));
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Network Membership Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Checks network membership without scope check.
     * @remarks Intentionally unscoped -- used by agent graphs and tools that need to verify
     * membership for any user (e.g. join flows, invitation acceptance).
     */
    isNetworkMember: (networkId: string, userId: string) => db.isNetworkMember(networkId, userId),
    /**
     * Checks index ownership without scope check.
     * @remarks Intentionally unscoped -- used by agent graphs and tools that need to verify
     * ownership for any user (e.g. permission checks during graph execution).
     */
    isIndexOwner: (networkId: string, userId: string) => db.isIndexOwner(networkId, userId),
    getNetworkMembers: async (networkId: string) => {
      verifyScope(networkId);
      return db.getNetworkMembersForMember(networkId, authUserId);
    },
    getMembersFromScope: () => db.getMembersFromUserIndexes(authUserId as Id<'users'>),
    /**
     * Adds a member to an index without scope check.
     * @remarks Intentionally unscoped -- used by join flows and invitation acceptance
     * that operate outside the caller's current network scope.
     */
    addMemberToNetwork: (networkId: string, userId: string, role: 'owner' | 'member') => db.addMemberToNetwork(networkId, userId, role),
    /**
     * Removes a member from an index without scope check.
     * @remarks Intentionally unscoped -- used by leave/kick flows and member removal
     * handlers that operate across user boundaries.
     */
    removeMemberFromIndex: (networkId: string, userId: string) => db.removeMemberFromIndex(networkId, userId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Index Operations (within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    getNetwork: async (networkId: string) => {
      verifyScope(networkId);
      return db.getNetwork(networkId);
    },
    getNetworkWithPermissions: async (networkId: string) => {
      verifyScope(networkId);
      return db.getNetworkWithPermissions(networkId);
    },
    getNetworkMemberCount: async (networkId: string) => {
      verifyScope(networkId);
      return db.getNetworkMemberCount(networkId);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Opportunity Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    createOpportunity: (data: Parameters<ChatDatabaseAdapter['createOpportunity']>[0]) => {
      const networkId = data.context?.networkId;
      if (networkId) verifyScope(networkId);
      return db.createOpportunity(data);
    },
    /**
     * Creates an opportunity and expires previous ones atomically without scope check.
     * @remarks Intentionally unscoped -- called by the discovery pipeline (negotiation
     * finalization) which creates opportunities across user boundaries.
     */
    createOpportunityAndExpireIds: (data: Parameters<ChatDatabaseAdapter['createOpportunityAndExpireIds']>[0], expireIds: string[]) => db.createOpportunityAndExpireIds(data, expireIds),
    /**
     * Discovery counterparties. Intentionally unscoped: a pair has two sides,
     * and each is read by its own principal's agent.
     */
    openCounterparties: (pairs: Parameters<NegotiationDatabaseAdapter['openCounterparties']>[0]) =>
      negotiationDatabaseAdapter.openCounterparties(pairs),
    /**
     * Retrieves an opportunity by ID without scope check.
     * @remarks Intentionally unscoped -- used by the negotiation graph and opportunity
     * tools that need cross-actor access during the discovery pipeline.
     */
    getOpportunity: (id: string) => db.getOpportunity(id),
    findEnrichedReplacementOpportunities: (opportunityId: string) => db.findEnrichedReplacementOpportunities(opportunityId),
    getOpportunitiesForNetwork: async (networkId: string, options?: Parameters<ChatDatabaseAdapter['getOpportunitiesForNetwork']>[1]) => {
      verifyScope(networkId);
      return db.getOpportunitiesForNetwork(networkId, options);
    },
    updateOpportunityStatus: async (id: string, status: Parameters<ChatDatabaseAdapter['updateOpportunityStatus']>[1], acceptedBy?: string) => {
      const opportunity = await db.getOpportunity(id);
      if (!opportunity) throw new Error('Opportunity not found');
      const opportunityIndexId = opportunity.context?.networkId;
      if (!opportunityIndexId) throw new Error('Opportunity not found');
      verifyScope(opportunityIndexId);
      return acceptedBy ? db.updateOpportunityStatus(id, status, acceptedBy) : db.updateOpportunityStatus(id, status);
    },
    stampOpportunityActorAction: async (id: string, actorUserId: string, status: Parameters<ChatDatabaseAdapter['stampOpportunityActorAction']>[2], acceptedBy?: string) => {
      const opportunity = await db.getOpportunity(id);
      if (!opportunity) throw new Error('Opportunity not found');
      const opportunityIndexId = opportunity.context?.networkId;
      if (!opportunityIndexId) throw new Error('Opportunity not found');
      verifyScope(opportunityIndexId);
      return db.stampOpportunityActorAction(id, actorUserId, status, acceptedBy);
    },
    opportunityExistsBetweenActors: (actorIds: string[], networkId: string) => {
      verifyScope(networkId);
      return db.opportunityExistsBetweenActors(actorIds, networkId);
    },
    findOpportunitiesByActors: (actorIds: string[], options?: Parameters<ChatDatabaseAdapter['findOpportunitiesByActors']>[1]) =>
      db.findOpportunitiesByActors(actorIds, options),
    /**
     * Expires all opportunities linked to an intent without scope check.
     * @remarks Intentionally unscoped -- called by intent archival event handlers
     * that clean up opportunities when an intent is expired or archived.
     */
    expireOpportunitiesByIntent: (intentId: string) => db.expireOpportunitiesByIntent(intentId),
    /**
     * Expires opportunities for a removed member without scope check.
     * @remarks Intentionally unscoped -- called by network membership removal event handlers
     * that clean up opportunities when a member leaves or is kicked from an index.
     */
    expireOpportunitiesForRemovedMember: (networkId: string, userId: string) => db.expireOpportunitiesForRemovedMember(networkId, userId),
    /**
     * Expires stale opportunities without scope check.
     * @remarks Intentionally unscoped -- called by scheduled cleanup jobs (cron)
     * that operate system-wide, not scoped to any particular user.
     */
    expireStaleOpportunities: () => db.expireStaleOpportunities(),

    // ─────────────────────────────────────────────────────────────────────────────
    // HyDE Operations (cross-user for opportunity matching)
    // ─────────────────────────────────────────────────────────────────────────────
    getHydeDocument: (sourceType: Parameters<ChatDatabaseAdapter['getHydeDocument']>[0], sourceId: string, strategy: string) => db.getHydeDocument(sourceType, sourceId, strategy),
    getHydeDocumentsForSource: (sourceType: Parameters<ChatDatabaseAdapter['getHydeDocumentsForSource']>[0], sourceId: string) => db.getHydeDocumentsForSource(sourceType, sourceId),
    saveHydeDocument: (data: Parameters<ChatDatabaseAdapter['saveHydeDocument']>[0]) => db.saveHydeDocument(data),
    deleteExpiredHydeDocuments: () => db.deleteExpiredHydeDocuments(),
    getStaleHydeDocuments: (threshold: Date) => db.getStaleHydeDocuments(threshold),
  };
}
