import { EventEmitter } from 'events';
import { log } from '../lib/log';
import type { Id } from '../types/common.types';
import type { OpportunityControllerDatabase, OpportunityGraphDatabase, HydeGraphDatabase, HomeGraphDatabase, CreateOpportunityData, Opportunity, OpportunityActor, OpportunityStatus } from '../lib/protocol/interfaces/database.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import type { HydeCache, OpportunityCache } from '../lib/protocol/interfaces/cache.interface';
import { OpportunityGraphFactory } from '../lib/protocol/graphs/opportunity.graph';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde.graph';
import { HomeGraphFactory } from '../lib/protocol/graphs/home.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde.generator';
import { LensInferrer } from '../lib/protocol/agents/lens.inferrer';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { presentOpportunity, type UserInfo } from '../lib/protocol/support/opportunity.presentation';
import { canUserSeeOpportunity, validateOpportunityActors } from '../lib/protocol/support/opportunity.utils';
import { persistOpportunities } from '../lib/protocol/support/opportunity.persist';
import { getPrimaryActionLabel } from '../lib/protocol/support/opportunity.constants';
import { OpportunityPresenter, gatherPresenterContext, type PresenterDatabase } from '../lib/protocol/agents/opportunity.presenter';
import { stripUuids, stripIntroducerMentions } from '../lib/protocol/support/opportunity.sanitize';
import { opportunityQueue } from '../queues/opportunity.queue';

const logger = log.service.from("OpportunityService");
const presenter = new OpportunityPresenter();

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
  private graph: ReturnType<OpportunityGraphFactory['createGraph']> | null = null;
  private homeGraph: ReturnType<HomeGraphFactory['createGraph']> | null = null;
  /** Event emitter for opportunity lifecycle; subscribe via onOpportunityEvent. */
  private readonly events = new OpportunityServiceEvents();

  constructor(
    database?: OpportunityControllerDatabase,
    cache?: OpportunityCache,
  ) {
    this.db = database ?? (new ChatDatabaseAdapter() as OpportunityControllerDatabase);
    this.cache = cache ?? new RedisCacheAdapter();

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
    options?: { indexId?: string; limit?: number }
  ): Promise<{ sections: Array<{ id: string; title: string; subtitle?: string; iconName: string; items: unknown[] }>; meta: { totalOpportunities: number; totalSections: number } } | { error: string }> {
    logger.verbose('[OpportunityService] Getting home view', { userId, options });
    if (!this.homeGraph) {
      return { error: 'Home view not available' };
    }
    try {
      const result = await this.homeGraph.invoke({
        userId,
        indexId: options?.indexId,
        limit: options?.limit ?? 50,
      });
      if (result.error) {
        return { error: result.error };
      }
      const sections = result.sections ?? [];
      const meta = result.meta ?? { totalOpportunities: 0, totalSections: 0 };

      // Self-healing: when no actionable opportunities exist, re-queue discovery for active intents
      const totalItems = sections.reduce(
        (sum: number, s: { items: unknown[] }) => sum + (s.items?.length ?? 0), 0
      );
      if (totalItems === 0 && !options?.indexId) {
        this.triggerRediscoveryIfNeeded(userId).catch((err) =>
          logger.warn('[OpportunityService] Rediscovery trigger failed', { userId, error: err })
        );
      }

      return { sections, meta };
    } catch (e) {
      logger.error('[OpportunityService] getHomeView failed', { userId, error: e });
      return { error: 'Failed to load home view' };
    }
  }

  /**
   * Get opportunities for a user with optional filters.
   * 
   * @param userId - The user ID
   * @param options - Filter options (status, indexId, limit, offset)
   * @returns List of opportunities
   */
  async getOpportunitiesForUser(
    userId: string,
    options?: {
      status?: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
      indexId?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    logger.verbose('[OpportunityService] Getting opportunities for user', { userId, options });
    
    return this.db.getOpportunitiesForUser(userId, options);
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

    const contextIndexId = opp.context?.indexId;
    const actorIndexId = opp.actors[0]?.indexId;
    const indexIdForDisplay = contextIndexId ?? actorIndexId;
    const [indexRecord, ...userRecords] = await Promise.all([
      indexIdForDisplay ? this.db.getIndex(indexIdForDisplay) : Promise.resolve(null),
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
      index: indexRecord ? { id: indexRecord.id, title: indexRecord.title } : (indexIdForDisplay ? { id: indexIdForDisplay, title: '' } : { id: '', title: '' }),
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

    const updated = await this.db.updateOpportunityStatus(opportunityId, status);
    if (!updated) {
      return { error: 'Opportunity not found', status: 404 };
    }

    if (status !== 'accepted') {
      return { opportunity: updated };
    }

    const counterpart = opp.actors.find((actor) => actor.role !== 'introducer' && actor.userId !== userId)
      ?? opp.actors.find((actor) => actor.userId !== userId);

    if (!counterpart) {
      return { opportunity: updated };
    }

    await this.db.acceptSiblingOpportunities(userId, counterpart.userId, opportunityId);

    await this.db.upsertContactMembership(userId, counterpart.userId, { restore: true });

    return {
      opportunity: updated,
      counterpartUserId: counterpart.userId,
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

    const memberships = await this.db.getIndexMemberships(userId);
    const indexScope = memberships.map((m) => m.indexId);

    if (indexScope.length === 0) {
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
   * @param indexId - The index ID
   * @param userId - User requesting (for authorization)
   * @param options - Filter options
   * @returns List of opportunities or error
   */
  async getOpportunitiesForIndex(
    indexId: string,
    userId: string,
    options?: {
      status?: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
      limit?: number;
      offset?: number;
    }
  ) {
    logger.verbose('[OpportunityService] Getting opportunities for index', { indexId, userId, options });

    const isOwner = await this.db.isIndexOwner(indexId, userId);
    const isMember = await this.db.isIndexMember(indexId, userId);
    
    if (!isOwner && !isMember) {
      return { error: 'Not a member of this index', status: 403 };
    }

    return this.db.getOpportunitiesForIndex(indexId, options);
  }

  /**
   * Create a manual opportunity (curator feature).
   * 
   * @param indexId - The index ID
   * @param creatorId - User creating the opportunity
   * @param data - Opportunity creation data
   * @returns Created opportunity or error
   */
  async createManualOpportunity(
    indexId: string,
    creatorId: string,
    data: {
      parties: Array<{ userId: string; intentId?: string }>;
      reasoning: string;
      category?: string;
      confidence?: number;
    }
  ) {
    logger.verbose('[OpportunityService] Creating manual opportunity', { indexId, creatorId });

    // Check permission
    const permission = await this.checkCreatePermission(creatorId, data.parties, indexId);
    if (!permission.allowed) {
      return { error: 'Not authorized to create opportunities in this index', status: 403 };
    }

    // Check for duplicates
    const partyIds = data.parties.map((p) => p.userId);
    const exists = await this.db.opportunityExistsBetweenActors(partyIds, indexId);
    if (exists) {
      return { error: 'Opportunity already exists between these parties', status: 409 };
    }

    // Build actors (manual opportunities are single-index; all actors share indexId)
    const actors: OpportunityActor[] = data.parties.map((p) => ({
      indexId,
      userId: p.userId,
      role: 'party',
      ...(p.intentId ? { intent: p.intentId } : {}),
    }));
    actors.push({ indexId, userId: creatorId, role: 'introducer' });

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
      context: { indexId },
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
        logger.warn('[OpportunityService] createManualOpportunity persistence failed', { errors, creatorId, indexId });
        return { error: message, status: 500 };
      }

      this.events.emit('created', { opportunity: created[0] });
      for (const opp of expired) {
        this.events.emit('expired', { opportunity: opp });
      }
      return created[0];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to persist opportunity';
      logger.warn('[OpportunityService] createManualOpportunity persistence failed', { error: err, creatorId, indexId });
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
          const presented = await presenter.present(presenterInput);
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

    const { generateInviteMessage: generate } = await import('../lib/protocol/agents/invite.generator');

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
   * Re-queue opportunity discovery for a user's active intents when no actionable
   * opportunities exist. Throttled to once per 6 hours per user via cache key.
   */
  private async triggerRediscoveryIfNeeded(userId: string): Promise<void> {
    const cacheKey = `rediscovery:throttle:${userId}`;

    // Best-effort throttle: cache errors should not block self-healing
    try {
      const existing = await this.cache.get(cacheKey);
      if (existing) return;
    } catch (err) {
      logger.warn('[OpportunityService] Rediscovery throttle read failed; continuing without cooldown', { userId, error: err });
    }

    const activeIntents = await this.db.getActiveIntents(userId);
    if (!activeIntents?.length) return;

    logger.info('[OpportunityService] Triggering rediscovery for stale user', {
      userId,
      intentCount: activeIntents.length,
    });

    // Bucket jobId by 6-hour window so completed/failed job retention (24h) doesn't block the next cycle
    const bucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
    const results = await Promise.allSettled(
      activeIntents.map((intent) =>
        opportunityQueue.addJob(
          { intentId: intent.id, userId },
          { priority: 10, jobId: `rediscovery:${userId}:${intent.id}:${bucket}` },
        )
      )
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failedCount = results.length - succeeded;

    if (failedCount > 0) {
      logger.warn('[OpportunityService] Some rediscovery jobs failed to enqueue', {
        userId,
        failedCount,
        totalCount: activeIntents.length,
      });
    }

    // Only arm cooldown if all jobs were enqueued; partial failures should allow
    // retries on the next home view load (bucketed jobId deduplicates the successful ones)
    if (succeeded > 0 && failedCount === 0) {
      try {
        await this.cache.set(cacheKey, { triggeredAt: new Date().toISOString() }, { ttl: 6 * 60 * 60 });
      } catch (err) {
        logger.warn('[OpportunityService] Rediscovery throttle write failed', { userId, error: err });
      }
    }
  }

  /**
   * Check if user has permission to create opportunities in an index.
   *
   * @param creatorId - User creating the opportunity
   * @param parties - Parties involved
   * @param indexId - The index ID
   * @returns Permission result
   */
  private async checkCreatePermission(
    creatorId: string,
    parties: Array<{ userId: string }>,
    indexId: string
  ): Promise<{ allowed: boolean }> {
    const isOwner = await this.db.isIndexOwner(indexId, creatorId);
    const isSelfIncluded = parties.some((p) => p.userId === creatorId);
    
    if (isOwner) return { allowed: true };
    
    const isMember = await this.db.isIndexMember(indexId, creatorId);
    if (!isMember) return { allowed: false };
    if (isSelfIncluded) return { allowed: true };
    
    return { allowed: true };
  }
}

export const opportunityService = new OpportunityService();
