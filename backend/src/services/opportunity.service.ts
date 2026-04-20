import { EventEmitter } from 'events';
import { log } from '../lib/log';
import type { Id } from '../types/common.types';
import { OpportunityGraphFactory, HydeGraphFactory, HomeGraphFactory, MaintenanceGraphFactory, type MaintenanceGraphDatabase, type MaintenanceGraphCache, type MaintenanceGraphQueue, HydeGenerator, LensInferrer, presentOpportunity, type UserInfo, canUserSeeOpportunity, validateOpportunityActors, persistOpportunities, getPrimaryActionLabel, OpportunityPresenter, gatherPresenterContext, type PresenterDatabase, stripUuids, stripIntroducerMentions } from '@indexnetwork/protocol';
import type { OpportunityControllerDatabase, OpportunityGraphDatabase, HydeGraphDatabase, HomeGraphDatabase, CreateOpportunityData, Opportunity, OpportunityActor, OpportunityStatus, Embedder, HydeCache, OpportunityCache } from '@indexnetwork/protocol';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { opportunityQueue } from '../queues/opportunity.queue';

const logger = log.service.from("OpportunityService");

interface OpportunityStatusUpdateResult {
  opportunity: Awaited<ReturnType<OpportunityControllerDatabase['updateOpportunityStatus']>>;
  counterpartUserId?: string;
}


/** Events emitted after opportunity lifecycle changes (e.g. create, expire). */
export type OpportunityCreatedPayload = { opportunity: Opportunity };
export type OpportunityExpiredPayload = { opportunity: Opportunity };

export class OpportunityServiceEvents extends EventEmitter {
  override emit(event: 'created', payload: OpportunityCreatedPayload): boolean;
  override emit(event: 'expired', payload: OpportunityExpiredPayload): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * OpportunityService
 * 
 * Manages opportunity operations including discovery, listing, and creation.
 * Uses OpportunityControllerDatabase adapter for database operations.
 * Uses OpportunityGraph for AI-powered opportunity discovery.
 * Emits opportunity events (created, expired) after transactional writes so subscribers see consistent state.
 * 
 * RESPONSIBILITIES:
 * - List opportunities for users and indexes
 * - Get and present individual opportunities
 * - Discover opportunities via HyDE graph
 * - Create manual opportunities
 * - Update opportunity status
 */
const CHAT_CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds

interface ChatCardCached {
  opportunityId: string;
  headline: string;
  personalizedSummary: string;
  narratorRemark: string;
  introducerName: string | null;
  peerName: string;
  peerAvatar: string | null;
  acceptedAt: string | null;
}

export class OpportunityService {
  private db: OpportunityControllerDatabase;
  private cache: OpportunityCache;
  private readonly presenter: OpportunityPresenter;
  private graph: ReturnType<OpportunityGraphFactory['createGraph']> | null = null;
  private homeGraph: ReturnType<HomeGraphFactory['createGraph']> | null = null;
  private maintenanceGraph: ReturnType<MaintenanceGraphFactory['createGraph']> | null = null;
  /** Event emitter for opportunity lifecycle; subscribe via onOpportunityEvent. */
  private readonly events = new OpportunityServiceEvents();

  constructor(
    database?: OpportunityControllerDatabase,
    cache?: OpportunityCache,
  ) {
    this.db = database ?? (new ChatDatabaseAdapter() as OpportunityControllerDatabase);
    this.cache = cache ?? new RedisCacheAdapter();
    this.presenter = new OpportunityPresenter();

    // Lazy-build graph for discover when adapter supports it
    if (this.db && 'getHydeDocument' in this.db) {
      const embedder: Embedder = new EmbedderAdapter();
      const cache: HydeCache = new RedisCacheAdapter();
      const inferrer = new LensInferrer();
      const generator = new HydeGenerator();
      const compiledHydeGraph = new HydeGraphFactory(
        this.db as unknown as HydeGraphDatabase,
        embedder,
        cache,
        inferrer,
        generator
      ).createGraph();
      const factory = new OpportunityGraphFactory(
        this.db as unknown as OpportunityGraphDatabase,
        embedder,
        compiledHydeGraph
      );
      this.graph = factory.createGraph();
    }
    this.homeGraph = new HomeGraphFactory(this.db as unknown as HomeGraphDatabase, this.cache).createGraph();
    this.maintenanceGraph = new MaintenanceGraphFactory(
      this.db as unknown as MaintenanceGraphDatabase,
      this.cache as unknown as MaintenanceGraphCache,
      opportunityQueue as unknown as MaintenanceGraphQueue,
    ).createGraph();
  }

  /**
   * Subscribe to opportunity events (e.g. 'created', 'expired'). Call after transaction commits.
   */
  onOpportunityEvent(
    event: 'created' | 'expired',
    handler: (payload: OpportunityCreatedPayload | OpportunityExpiredPayload) => void
  ): () => void {
    this.events.on(event, handler);
    return () => this.events.off(event, handler);
  }

  /**
   * Get home view: dynamic sections of opportunities with presenter text and LLM-chosen section titles/icons.
   */
  async getHomeView(
    userId: string,
    options?: { networkId?: string; limit?: number; noCache?: boolean; statuses?: OpportunityStatus[] }
  ): Promise<{ sections: Array<{ id: string; title: string; subtitle?: string; iconName: string; items: unknown[] }>; meta: { totalOpportunities: number; totalSections: number; maintenanceTriggered: boolean } } | { error: string }> {
    logger.verbose('[OpportunityService] Getting home view', { userId, options });
    if (!this.homeGraph) {
      return { error: 'Home view not available' };
    }
    try {
      const result = await this.homeGraph.invoke({
        userId,
        networkId: options?.networkId,
        limit: options?.limit ?? 50,
        noCache: options?.noCache,
        statuses: options?.statuses,
      });
      if (result.error) {
        return { error: result.error };
      }
      const sections = result.sections ?? [];
      const meta: { totalOpportunities: number; totalSections: number; maintenanceTriggered: boolean } = {
        ...(result.meta ?? { totalOpportunities: 0, totalSections: 0 }),
        maintenanceTriggered: false,
      };

      // Fire-and-forget maintenance: health-scored check replaces empty-feed-only trigger
      if (this.maintenanceGraph && !options?.networkId) {
        meta.maintenanceTriggered = true;
        logger.info('[OpportunityService] Triggering maintenance via health scoring', { userId, source: 'home-view' });
        this.maintenanceGraph.invoke({ userId }).catch((err) =>
          logger.warn('[OpportunityService] Maintenance graph failed', { userId, error: err })
        );
      }

      return { sections, meta };
    } catch (e) {
      logger.error('[OpportunityService] getHomeView failed', { userId, error: e });
      return { error: 'Failed to load home view' };
    }
  }

  /**
   * Resolve an opportunity identifier (full UUID or short prefix) to a full UUID.
   * @param idOrPrefix - Full UUID or short hex prefix
   * @param userId - The user ID (for visibility scoping)
   * @returns Resolved ID, or error object with status
   */
  async resolveId(idOrPrefix: string, userId: string): Promise<{ id: string } | { error: string; status: number }> {
    const result = await this.db.resolveOpportunityId(idOrPrefix, userId);
    if (!result) {
      return { error: 'Opportunity not found', status: 404 };
    }
    if ('ambiguous' in result) {
      return { error: 'Ambiguous ID prefix, please provide more characters', status: 409 };
    }
    return { id: result.id };
  }

  /**
   * Get opportunities for a user with optional filters.
   *
   * @param userId - The user ID
   * @param options - Filter options (status, networkId, limit, offset)
   * @returns List of opportunities
   */
  async getOpportunitiesForUser(
    userId: string,
    options?: {
      status?: 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
      networkId?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    logger.verbose('[OpportunityService] Getting opportunities for user', { userId, options });

    const rows = await this.db.getOpportunitiesForUser(userId, options);

    // Resolve actor names in bulk for CLI/API consumers
    const allUserIds = new Set<string>();
    for (const opp of rows) {
      for (const actor of opp.actors) {
        allUserIds.add(actor.userId);
      }
    }
    const userMap = new Map<string, string>();
    const lookups = [...allUserIds].map(async (uid) => {
      const user = await this.db.getUser(uid);
      if (user?.name) userMap.set(uid, user.name);
    });
    await Promise.all(lookups);

    return rows.map((opp) => {
      const counterpart = opp.actors.find(
        (a) => a.role !== 'introducer' && a.userId !== userId,
      ) ?? opp.actors.find((a) => a.userId !== userId);
      const enrichedActors = opp.actors.map((a) => ({
        ...a,
        name: userMap.get(a.userId) ?? undefined,
      }));
      return {
        ...opp,
        actors: enrichedActors,
        counterpartName: counterpart ? (userMap.get(counterpart.userId) ?? undefined) : undefined,
      };
    });
  }

  /**
   * Get a single opportunity with full presentation details.
   * 
   * @param opportunityId - The opportunity ID
   * @param viewerId - The user viewing the opportunity
   * @returns Opportunity with presentation data or null
   */
  async getOpportunityWithPresentation(opportunityId: string, viewerId: string) {
    logger.verbose('[OpportunityService] Getting opportunity', { opportunityId, viewerId });

    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) {
      return null;
    }

    // Check if viewer is an actor and allowed to see per role-based visibility (Latent Opportunity Lifecycle)
    const isActor = opp.actors.some((a) => a.userId === viewerId);
    if (!isActor) {
      return { error: 'Not authorized to view this opportunity', status: 403 };
    }
    if (!canUserSeeOpportunity(opp.actors, opp.status, viewerId)) {
      return { error: 'Not authorized to view this opportunity', status: 403 };
    }

    const myActor = opp.actors.find((a) => a.userId === viewerId)!;
    const introducer = opp.actors.find((a) => a.role === 'introducer');
    const introducerId = introducer?.userId;
    const nonIntroducerActors = opp.actors.filter((a) => a.role !== 'introducer' && a.userId !== viewerId);
    const otherPartyIds = nonIntroducerActors.map((a) => a.userId);

    const contextNetworkId = opp.context?.networkId;
    const actorNetworkId = nonIntroducerActors[0]?.networkId ?? myActor?.networkId;
    const networkIdForDisplay = contextNetworkId ?? actorNetworkId;
    const [indexRecord, ...userRecords] = await Promise.all([
      networkIdForDisplay ? this.db.getNetwork(networkIdForDisplay) : Promise.resolve(null),
      ...otherPartyIds.map((uid) => this.db.getUser(uid)),
    ]);
    const introducerRecord = introducerId ? await this.db.getUser(introducerId) : null;
    const introducerInfo: UserInfo | null = introducerRecord
      ? { id: introducerRecord.id, name: introducerRecord.name ?? 'Unknown', avatar: introducerRecord.avatar ?? null }
      : null;

    const userMap = new Map<string | null, UserInfo>();
    otherPartyIds.forEach((uid, i) => {
      const u = userRecords[i];
      userMap.set(uid, u ? { id: u.id, name: u.name ?? 'Unknown', avatar: u.avatar ?? null } : { id: uid, name: 'Unknown', avatar: null });
    });

    const otherPartyInfo = otherPartyIds[0] ? userMap.get(otherPartyIds[0])! : { id: '', name: 'Unknown', avatar: null as string | null };
    const counterpartUser = userRecords[0];
    const isCounterpartGhost = counterpartUser?.isGhost === true && counterpartUser?.deletedAt == null;
    const presentation = presentOpportunity(opp, viewerId, otherPartyInfo, introducerInfo, 'card');

    const otherParties = nonIntroducerActors.map((a) => {
      const info = userMap.get(a.userId) ?? { id: a.userId, name: 'Unknown', avatar: null as string | null };
      return { id: info.id, name: info.name, avatar: info.avatar, role: a.role };
    });

    const confidenceNum = typeof opp.interpretation.confidence === 'number'
      ? opp.interpretation.confidence
      : parseFloat(opp.confidence ?? opp.interpretation.confidence as unknown as string) || 0;

    return {
      id: opp.id,
      presentation,
      myRole: myActor.role,
      otherParties,
      introducedBy: introducerInfo ?? undefined,
      category: opp.interpretation.category,
      confidence: confidenceNum,
      network: indexRecord ? { id: indexRecord.id, title: indexRecord.title } : (networkIdForDisplay ? { id: networkIdForDisplay, title: '' } : { id: '', title: '' }),
      status: opp.status,
      isGhost: isCounterpartGhost,
      primaryActionLabel: getPrimaryActionLabel(myActor.role),
      createdAt: opp.createdAt instanceof Date ? opp.createdAt.toISOString() : opp.createdAt,
      expiresAt: opp.expiresAt ? (opp.expiresAt instanceof Date ? opp.expiresAt.toISOString() : opp.expiresAt) : undefined,
    };
  }

  /**
   * Update opportunity status.
   * 
   * @param opportunityId - The opportunity ID
   * @param status - New status
   * @param userId - User making the update (for authorization)
   * @returns Updated opportunity or error
   */
  async updateOpportunityStatus(
    opportunityId: string,
    status: OpportunityStatus,
    userId: string
  ): Promise<OpportunityStatusUpdateResult | { error: string; status: number }> {
    logger.verbose('[OpportunityService] Updating opportunity status', { opportunityId, status, userId });

    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) {
      return { error: 'Opportunity not found', status: 404 };
    }

    const isActor = opp.actors.some((a) => a.userId === userId);
    if (!isActor) {
      return { error: 'Not authorized to update this opportunity', status: 403 };
    }

    const counterpart = status === 'accepted'
      ? (opp.actors.find((actor) => actor.role !== 'introducer' && actor.userId !== userId)
          ?? opp.actors.find((actor) => actor.userId !== userId))
      : undefined;

    if (counterpart) {
      try {
        await this.db.getOrCreateDM(userId, counterpart.userId);
      } catch (err) {
        logger.error('[OpportunityService.updateOpportunityStatus] getOrCreateDM failed; status left untouched', {
          opportunityId,
          userId,
          counterpartUserId: counterpart.userId,
          error: err,
        });
        return { error: 'Failed to create conversation for this opportunity', status: 500 };
      }
    }

    const updated = await this.db.updateOpportunityStatus(opportunityId, status);
    if (!updated) {
      return { error: 'Opportunity not found', status: 404 };
    }

    if (!counterpart) {
      return { opportunity: updated };
    }

    const counterpartUserId = counterpart.userId;

    await this.db.acceptSiblingOpportunities(userId, counterpartUserId, opportunityId).catch((err) => {
      logger.error('[OpportunityService.updateOpportunityStatus] acceptSiblingOpportunities failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId,
        error: err,
      });
    });

    // Accepter explicitly acted — restore if previously removed.
    // Counterpart: add them to the accepter but honour any prior opt-out on their side.
    await this.db.upsertContactMembership(userId, counterpartUserId, { restore: true }).catch((err) => {
      logger.error('[OpportunityService.updateOpportunityStatus] upsertContactMembership failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId,
        error: err,
      });
    });
    await this.db.upsertContactMembership(counterpartUserId, userId, { restore: false }).catch((err) => {
      logger.error('[OpportunityService.updateOpportunityStatus] upsertContactMembership (counterpart) failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId,
        error: err,
      });
    });

    return {
      opportunity: updated,
      counterpartUserId,
    };
  }

  /**
   * Transition a `pending`/`draft` opportunity to `accepted` and surface the
   * h2h conversation to navigate to. Used by the frontend's "Start Chat"
   * button on both ambient and orchestrator opportunity cards.
   *
   * **Step ordering is failure-safe, not wrapped in a single transaction.**
   * The four writes run in an order chosen so a partial failure never leaves
   * the user in a permanent dead end:
   *
   * 1. `getOrCreateDM` — resolves the pair's conversation. DM existence is
   *    independent of opportunity state (dmPair unique column handles
   *    concurrency); if it throws, the opp is still at its original status
   *    and the button re-appears, so a retry recovers.
   * 2. `updateOpportunityStatus` → `accepted` — only happens once the DM is
   *    known, so we never flip status without a destination to navigate to.
   * 3. `acceptSiblingOpportunities` — matches the PATCH /status='accepted'
   *    side effect; already transactional internally.
   * 4. `upsertContactMembership` — idempotent; safe to re-run.
   *
   * Steps 3 and 4 are best-effort after the status flip: their failure must
   * not block the user from reaching the chat (the opp is already accepted
   * and the conversation already resolved). Errors are logged for later
   * reconciliation.
   *
   * Does NOT insert a seed system message — IND-237 renders the accepted
   * opportunity inline in the chat timeline, so a seed would duplicate it.
   *
   * @param opportunityId - The opportunity to accept and navigate from
   * @param userId - The authenticated user (must be an actor)
   * @returns `{ conversationId, counterpartUserId, opportunity }` on success, or `{ error, status }` on failure.
   * @throws Does not throw for business-logic failures — every failure path
   *   returns an `{ error, status }` tuple so controllers can map to HTTP.
   */
  async startChat(
    opportunityId: string,
    userId: string,
  ): Promise<
    | { conversationId: string; counterpartUserId: string; opportunity: Opportunity }
    | { error: string; status: number }
  > {
    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) {
      return { error: 'Opportunity not found', status: 404 };
    }
    if (opp.status !== 'pending' && opp.status !== 'draft') {
      return {
        error: `Cannot start chat on opportunity in status '${opp.status}'; must be pending or draft.`,
        status: 400,
      };
    }
    const isActor = opp.actors.some((a) => a.userId === userId);
    if (!isActor) {
      return { error: 'Not authorized to start chat for this opportunity', status: 403 };
    }

    const counterpart =
      opp.actors.find((a) => a.role !== 'introducer' && a.userId !== userId)
      ?? opp.actors.find((a) => a.userId !== userId);
    if (!counterpart) {
      return { error: 'Opportunity has no counterpart to chat with', status: 400 };
    }

    // Resolve the DM first — independent of opp state, safe to retry if it
    // throws (opp is still pending/draft, button re-appears).
    let conversation: { id: string };
    try {
      conversation = await this.db.getOrCreateDM(userId, counterpart.userId);
    } catch (err) {
      logger.error('[OpportunityService.startChat] getOrCreateDM failed; opp left untouched', {
        opportunityId,
        userId,
        counterpartUserId: counterpart.userId,
        error: err,
      });
      return { error: 'Failed to resolve conversation for this opportunity', status: 500 };
    }

    // Only flip status once we know the chat destination exists.
    const updated = await this.db.updateOpportunityStatus(opportunityId, 'accepted');
    if (!updated) {
      return { error: 'Failed to accept opportunity', status: 500 };
    }

    // Best-effort side effects — their failure must not block the user from
    // reaching the chat. The opp is already accepted and the DM already
    // resolved; these keep the home feed and contacts view in sync.
    await this.db.acceptSiblingOpportunities(userId, counterpart.userId, opportunityId).catch((err) => {
      logger.error('[OpportunityService.startChat] acceptSiblingOpportunities failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId: counterpart.userId,
        error: err,
      });
    });
    await this.db.upsertContactMembership(userId, counterpart.userId, { restore: true }).catch((err) => {
      logger.error('[OpportunityService.startChat] upsertContactMembership failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId: counterpart.userId,
        error: err,
      });
    });
    await this.db.upsertContactMembership(counterpart.userId, userId, { restore: false }).catch((err) => {
      logger.error('[OpportunityService.startChat] upsertContactMembership (counterpart) failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId: counterpart.userId,
        error: err,
      });
    });

    return {
      conversationId: conversation.id,
      counterpartUserId: counterpart.userId,
      opportunity: updated,
    };
  }

  /**
   * Discover opportunities via HyDE graph.
   * 
   * @param userId - The user ID
   * @param query - Search query
   * @param limit - Number of results
   * @returns Discovery results
   */
  async discoverOpportunities(userId: string, query: string, limit: number = 5) {
    logger.verbose('[OpportunityService] Discovering opportunities', { userId, query, limit });

    if (!this.graph) {
      return { error: 'Discovery not available; graph dependencies not configured', status: 503 };
    }

    const memberships = await this.db.getNetworkMemberships(userId);
    const networkScope = memberships.map((m) => m.networkId);

    if (networkScope.length === 0) {
      return {
        userId: userId as Id<'users'>,
        searchQuery: query,
        options: { limit, initialStatus: 'latent' as const },
        opportunities: [],
      };
    }

    const result = await this.graph!.invoke({
      userId: userId as Id<'users'>,
      searchQuery: query,
      options: { limit, initialStatus: 'latent' as const },
    });

    return result;
  }

  /**
   * Get opportunities for a specific index.
   * 
   * @param networkId - The index ID
   * @param userId - User requesting (for authorization)
   * @param options - Filter options
   * @returns List of opportunities or error
   */
  async getOpportunitiesForNetwork(
    networkId: string,
    userId: string,
    options?: {
      status?: 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
      limit?: number;
      offset?: number;
    }
  ) {
    logger.verbose('[OpportunityService] Getting opportunities for index', { networkId, userId, options });

    const isOwner = await this.db.isNetworkOwner(networkId, userId);
    const isMember = await this.db.isNetworkMember(networkId, userId);
    
    if (!isOwner && !isMember) {
      return { error: 'Not a member of this network', status: 403 };
    }

    return this.db.getOpportunitiesForNetwork(networkId, options);
  }

  /**
   * Create a manual opportunity (curator feature).
   * 
   * @param networkId - The index ID
   * @param creatorId - User creating the opportunity
   * @param data - Opportunity creation data
   * @returns Created opportunity or error
   */
  async createManualOpportunity(
    networkId: string,
    creatorId: string,
    data: {
      parties: Array<{ userId: string; intentId?: string }>;
      reasoning: string;
      category?: string;
      confidence?: number;
    }
  ) {
    logger.verbose('[OpportunityService] Creating manual opportunity', { networkId, creatorId });

    // Check permission
    const permission = await this.checkCreatePermission(creatorId, data.parties, networkId);
    if (!permission.allowed) {
      return { error: 'Not authorized to create opportunities in this network', status: 403 };
    }

    // Check for duplicates
    const partyIds = data.parties.map((p) => p.userId);
    const exists = await this.db.opportunityExistsBetweenActors(partyIds, networkId);
    if (exists) {
      return { error: 'Opportunity already exists between these parties', status: 409 };
    }

    // Build actors (manual opportunities are single-index; all actors share networkId)
    const actors: OpportunityActor[] = data.parties.map((p) => ({
      networkId,
      userId: p.userId,
      role: 'party',
      ...(p.intentId ? { intent: p.intentId } : {}),
    }));
    actors.push({ networkId, userId: creatorId, role: 'introducer' });

    try {
      validateOpportunityActors(actors);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid opportunity actors';
      return { error: message, status: 400 };
    }

    const conf = data.confidence ?? 0.8;
    const opportunityData: CreateOpportunityData = {
      detection: {
        source: 'manual',
        createdBy: creatorId,
        timestamp: new Date().toISOString(),
      },
      actors,
      interpretation: {
        category: data.category ?? 'collaboration',
        reasoning: data.reasoning,
        confidence: conf,
        signals: [{ type: 'curator_judgment', weight: 1, detail: 'Manual match by curator' }],
      },
      context: { networkId },
      confidence: String(conf),
      status: 'pending',
    };

    const embedder = new EmbedderAdapter();
    try {
      const { created, expired, errors } = await persistOpportunities({
        database: this.db,
        embedder,
        items: [opportunityData],
      });

      if (!created?.length) {
        const message =
          errors?.length ? (errors[0].error instanceof Error ? errors[0].error.message : String(errors[0].error)) : 'Failed to persist opportunity';
        logger.warn('[OpportunityService] createManualOpportunity persistence failed', { errors, creatorId, networkId });
        return { error: message, status: 500 };
      }

      this.events.emit('created', { opportunity: created[0] });
      for (const opp of expired) {
        this.events.emit('expired', { opportunity: opp });
      }
      return created[0];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to persist opportunity';
      logger.warn('[OpportunityService] createManualOpportunity persistence failed', { error: err, creatorId, networkId });
      return { error: message, status: 500 };
    }
  }

  /**
   * Get chat context for a conversation between two users.
   * Returns accepted opportunities shared between them and peer user info.
   *
   * @param userId - The authenticated user ID
   * @param peerUserId - The peer user ID
   * @returns Opportunity cards and peer info for chat context
   */
  async getChatContext(userId: string, peerUserId: string) {
    logger.verbose('[OpportunityService] Getting chat context', { userId, peerUserId });

    const [allRows, peerUser] = await Promise.all([
      this.db.getAcceptedOpportunitiesBetweenActors(userId, peerUserId),
      this.db.getUser(peerUserId),
    ]);

    // Filter out opportunities where either chat participant is the introducer.
    // Chat context should only show direct connections, not introductions they facilitated.
    const rows = allRows.filter((opp) =>
      !opp.actors.some((a) =>
        (a.userId === userId || a.userId === peerUserId) && a.role === 'introducer'
      )
    );

    // Check cache for all opportunities (graceful fallback if Redis unavailable)
    let cachedResults: (ChatCardCached | null)[] = [];
    try {
      const cacheKeys = rows.map((opp) => `chat:card:${opp.id}:${userId}`);
      cachedResults = await this.cache.mget<ChatCardCached>(cacheKeys);
    } catch (e) {
      logger.warn('[OpportunityService] getChatContext cache read failed, skipping', { error: e });
      cachedResults = rows.map(() => null);
    }

    const opportunityCards = await Promise.all(
      rows.map(async (opp, idx) => {
        // Return cached result if available
        const cached = cachedResults[idx];
        if (cached) {
          return cached;
        }

        try {
          const presenterInput = await gatherPresenterContext(
            this.db as unknown as PresenterDatabase,
            opp,
            userId,
          );
          presenterInput.opportunityStatus = 'accepted';
          presenterInput.matchReasoning += '\n\nCONTEXT: This is shown inside an active chat between the two parties. Both already accepted. Write a warm, concise 1-sentence headline and 1-sentence summary — not a pitch or analysis.';
          const presented = await this.presenter.present(presenterInput);
          const card: ChatCardCached = {
            opportunityId: opp.id,
            headline: presented.headline,
            personalizedSummary: presented.personalizedSummary,
            narratorRemark: '',
            introducerName: presenterInput.introducerName ?? null,
            peerName: peerUser?.name ?? 'Someone',
            peerAvatar: peerUser?.avatar ?? null,
            acceptedAt: opp.updatedAt instanceof Date ? opp.updatedAt.toISOString() : (opp.updatedAt ?? null),
          };
          try {
            await this.cache.set(`chat:card:${opp.id}:${userId}`, card, { ttl: CHAT_CACHE_TTL });
          } catch {
            // Cache write failure is non-critical
          }
          return card;
        } catch (err) {
          logger.warn('[OpportunityService] getChatContext presenter failed, using fallback', { error: err, opportunityId: opp.id });
          const introducerActor = opp.actors.find((a) => a.role === 'introducer');
          const introducerName = introducerActor ? opp.detection?.createdByName ?? null : null;
          let rawReasoning = opp.interpretation?.reasoning ?? '';
          rawReasoning = stripUuids(rawReasoning);
          if (introducerName) {
            rawReasoning = stripIntroducerMentions(rawReasoning, introducerName);
          }
          return {
            opportunityId: opp.id,
            headline: rawReasoning.substring(0, 80) || 'Connection opportunity',
            personalizedSummary: rawReasoning,
            narratorRemark: '',
            introducerName,
            peerName: peerUser?.name ?? 'Someone',
            peerAvatar: peerUser?.avatar ?? null,
            acceptedAt: opp.updatedAt instanceof Date ? opp.updatedAt.toISOString() : (opp.updatedAt ?? null),
          };
        }
      }),
    );

    return { opportunities: opportunityCards };
  }

  /**
   * Generate an invite message for a ghost user counterpart in an opportunity.
   * @param opportunityId - The opportunity ID
   * @param viewerId - The authenticated user requesting the invite
   * @returns Generated invite message or error
   */
  async generateInviteMessage(opportunityId: string, viewerId: string) {
    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) {
      return { error: 'Opportunity not found', status: 404 };
    }

    const isActor = opp.actors.some((a) => a.userId === viewerId);
    if (!isActor) {
      return { error: 'Not authorized', status: 403 };
    }
    if (!canUserSeeOpportunity(opp.actors, opp.status, viewerId)) {
      return { error: 'Not authorized to view this opportunity', status: 403 };
    }

    const counterpart = opp.actors.find(
      (a) => a.role !== 'introducer' && a.userId !== viewerId
    ) ?? opp.actors.find((a) => a.userId !== viewerId);

    if (!counterpart) {
      return { error: 'No counterpart found', status: 400 };
    }

    const [viewer, recipient] = await Promise.all([
      this.db.getUser(viewerId),
      this.db.getUser(counterpart.userId),
    ]);

    if (!recipient || recipient.deletedAt != null) {
      return { error: 'Counterpart not available', status: 400 };
    }
    if (!recipient.isGhost) {
      return { error: 'Counterpart is not a ghost user', status: 400 };
    }

    const introducer = opp.actors.find((a) => a.role === 'introducer');
    const introducerUser = introducer ? await this.db.getUser(introducer.userId) : null;

    // Gather intents for context
    const [senderIntents, recipientIntents] = await Promise.all([
      this.db.getActiveIntents(viewerId).then(intents => intents.map(i => i.payload)),
      this.db.getActiveIntents(counterpart.userId).then(intents => intents.map(i => i.payload)),
    ]);

    const { generateInviteMessage: generate } = await import('@indexnetwork/protocol');

    const result = await generate({
      recipientName: recipient.name ?? 'there',
      senderName: viewer?.name ?? 'Someone',
      opportunityInterpretation: opp.interpretation.reasoning,
      senderIntents,
      recipientIntents,
      referrerName: introducerUser?.name ?? undefined,
    });

    return { message: result.message };
  }

  /**
   * Trigger maintenance for a specific user via the maintenance graph.
   * Fire-and-forget: logs errors but does not throw.
   *
   * @param userId - The user whose feed to evaluate
   * @param source - What triggered this maintenance check
   */
  triggerMaintenance(userId: string, source: string): void {
    if (!this.maintenanceGraph) {
      logger.warn('[OpportunityService] Maintenance graph not available', { userId, source });
      return;
    }
    logger.info('[OpportunityService] Triggering maintenance', { userId, source });
    this.maintenanceGraph.invoke({ userId }).catch((err) =>
      logger.warn('[OpportunityService] Maintenance graph failed', { userId, source, error: err })
    );
  }

  /**
   * Check if user has permission to create opportunities in an index.
   *
   * @param creatorId - User creating the opportunity
   * @param parties - Parties involved
   * @param networkId - The index ID
   * @returns Permission result
   */
  private async checkCreatePermission(
    creatorId: string,
    parties: Array<{ userId: string }>,
    networkId: string
  ): Promise<{ allowed: boolean }> {
    const isOwner = await this.db.isNetworkOwner(networkId, creatorId);
    const isSelfIncluded = parties.some((p) => p.userId === creatorId);
    
    if (isOwner) return { allowed: true };
    
    const isMember = await this.db.isNetworkMember(networkId, creatorId);
    if (!isMember) return { allowed: false };
    if (isSelfIncluded) return { allowed: true };
    
    return { allowed: true };
  }
}

export const opportunityService = new OpportunityService();
