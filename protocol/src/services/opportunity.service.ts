import { EventEmitter } from 'events';
import { eq } from 'drizzle-orm';
import { log } from '../lib/log';
import type { Id } from '../types/common.types';
import type { OpportunityControllerDatabase, OpportunityGraphDatabase, HydeGraphDatabase, HomeGraphDatabase, CreateOpportunityData, Opportunity, OpportunityActor, OpportunityStatus } from '../lib/protocol/interfaces/database.interface';
import { OpportunityPresenter, gatherPresenterContext } from '../lib/protocol/agents/opportunity.presenter';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import type { HydeCache } from '../lib/protocol/interfaces/cache.interface';
import { OpportunityGraphFactory } from '../lib/protocol/graphs/opportunity.graph';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde.graph';
import { HomeGraphFactory } from '../lib/protocol/graphs/home.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde.generator';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { presentOpportunity, type UserInfo } from '../lib/protocol/support/opportunity.presentation';
import { canUserSeeOpportunity } from '../lib/protocol/support/opportunity.utils';
import { enrichOrCreate } from '../lib/protocol/support/opportunity.enricher';
import type { OpportunityChatProvider, ChatChannel } from '../lib/protocol/interfaces/chat.interface';
import { getChatProvider } from '../adapters/chat.adapter';
import {
  getDirectChannelId,
  ensureStreamUsers,
  ensureIndexBotUser,
  sendBotMessage,
  channelHasMessageForOpportunity,
  getChannelIntroOpportunityIds,
  addChannelIntroOpportunityId,
} from '../lib/protocol/support/chat-provider.utils';
import { sendOpportunityToHomeFeed } from '../agent/xmtp.agent';
import type { OpportunityCardContent } from '../agent/content-types';
import db from '../lib/drizzle/drizzle';
import { users } from '../schemas/database.schema';

const logger = log.service.from("OpportunityService");

interface AcceptedOpportunityChannelMeta {
  opportunityId: string;
  acceptedAt: string;
}

interface OpportunityStatusUpdateResult {
  opportunity: Awaited<ReturnType<OpportunityControllerDatabase['updateOpportunityStatus']>>;
  chat?: {
    channelId: string;
    counterpartUserId: string;
    acceptedOpportunities?: AcceptedOpportunityChannelMeta[];
  };
}

function toIso(value: Date | string | null | undefined): string {
  const fallback = () => new Date().toISOString();
  if (!value) return fallback();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback();
  return date.toISOString();
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
export class OpportunityService {
  private db: OpportunityControllerDatabase;
  private chatProvider: OpportunityChatProvider | null;
  private graph: ReturnType<OpportunityGraphFactory['createGraph']> | null = null;
  private homeGraph: ReturnType<HomeGraphFactory['createGraph']> | null = null;
  /** Event emitter for opportunity lifecycle; subscribe via onOpportunityEvent. */
  private readonly events = new OpportunityServiceEvents();

  constructor(
    database?: OpportunityControllerDatabase,
    chatProvider?: OpportunityChatProvider | null,
  ) {
    this.db = database ?? (new ChatDatabaseAdapter() as OpportunityControllerDatabase);
    this.chatProvider = chatProvider ?? getChatProvider();

    // Lazy-build graph for discover when adapter supports it
    if (this.db && 'getHydeDocument' in this.db) {
      const embedder: Embedder = new EmbedderAdapter();
      const cache: HydeCache = new RedisCacheAdapter();
      const generator = new HydeGenerator();
      const compiledHydeGraph = new HydeGraphFactory(
        this.db as unknown as HydeGraphDatabase,
        embedder,
        cache,
        generator
      ).createGraph();
      const factory = new OpportunityGraphFactory(
        this.db as unknown as OpportunityGraphDatabase,
        embedder,
        compiledHydeGraph
      );
      this.graph = factory.createGraph();
    }
    this.homeGraph = new HomeGraphFactory(this.db as unknown as HomeGraphDatabase).createGraph();
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
    logger.info('[OpportunityService] Getting home view', { userId, options });
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
      return {
        sections: result.sections ?? [],
        meta: result.meta ?? { totalOpportunities: 0, totalSections: 0 },
      };
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
    logger.info('[OpportunityService] Getting opportunities for user', { userId, options });
    
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
    logger.info('[OpportunityService] Getting opportunity', { opportunityId, viewerId });

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
    logger.info('[OpportunityService] Updating opportunity status', { opportunityId, status, userId });

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

    // Accept all sibling opportunities between the same actor pair in one transaction (targeted query + bulk update).
    await this.db.acceptSiblingOpportunities(userId, counterpart.userId, opportunityId);

    const acceptedBetweenActors = await this.db.getAcceptedOpportunitiesBetweenActors(userId, counterpart.userId);
    const acceptedOpportunitiesMeta: AcceptedOpportunityChannelMeta[] = acceptedBetweenActors.map((candidate) => ({
      opportunityId: candidate.id,
      acceptedAt: toIso(candidate.updatedAt),
    }));

    const chatProvider = this.chatProvider;
    const channelId = getDirectChannelId(userId, counterpart.userId);

    if (!chatProvider) {
      logger.warn('[OpportunityService] Chat provider not configured; skipping chat activation', {
        opportunityId,
        channelId,
      });
      return {
        opportunity: updated,
        chat: {
          channelId,
          counterpartUserId: counterpart.userId,
          acceptedOpportunities: acceptedOpportunitiesMeta,
        },
      };
    }

    const [accepterUser, counterpartUser] = await Promise.all([
      this.db.getUser(userId),
      this.db.getUser(counterpart.userId),
    ]);
    await ensureStreamUsers(chatProvider, [
      { id: userId, name: accepterUser?.name, image: accepterUser?.avatar ?? undefined },
      { id: counterpart.userId, name: counterpartUser?.name, image: counterpartUser?.avatar ?? undefined },
    ]);
    await ensureIndexBotUser(chatProvider);

    let channel: ChatChannel;
    let existingMessages: unknown[] = [];

    const existingChannels = await chatProvider.queryChannels(
      { type: 'messaging', id: channelId },
      {},
      { state: true, watch: false, messages: { limit: 50 } },
    );

    if (existingChannels.length > 0) {
      channel = existingChannels[0];
      existingMessages = channel.state?.messages ?? [];
    } else {
      channel = chatProvider.channel('messaging', channelId, {
        members: [userId, counterpart.userId],
        pending: false,
        created_by_id: userId,
      });
      try {
        await channel.create?.();
      } catch (error) {
        logger.debug('[OpportunityService] Stream channel create failed', { opportunityId, channelId, error });
      }
    }

    try {
      await channel.updatePartial({
        set: {
          pending: false,
          acceptedOpportunities: acceptedOpportunitiesMeta,
        },
        unset: ['requestedBy'],
      });
    } catch (error) {
      logger.warn('[OpportunityService] Failed to update channel partial', { opportunityId, channelId, error });
    }

    try {
      // Same idempotency signal as reinjection (opportunity.chat-injection): channel.data.introOpportunityIds.
      // Fall back to recent-message scan for legacy channels that may not have metadata yet.
      const introOpportunityIds = getChannelIntroOpportunityIds(channel);
      const introExists =
        introOpportunityIds.includes(opportunityId) ||
        channelHasMessageForOpportunity(existingMessages, opportunityId);
      if (!introExists) {
        let introText: string;
        let presentation: { headline: string; personalizedSummary: string; suggestedAction: string } | undefined;
        try {
          const context = await gatherPresenterContext(this.db, opp, userId);
          const presenter = new OpportunityPresenter();
          const result = await presenter.present(context);
          presentation = result;
          introText = `**${result.headline}**\n\n${result.personalizedSummary}\n\n${result.suggestedAction}`;
        } catch (presenterError) {
          logger.warn('[OpportunityService] Presenter failed; using fallback intro', {
            opportunityId,
            channelId,
            error: presenterError,
          });
          const counterpartUser = await this.db.getUser(counterpart.userId);
          introText = [
            `Index intro: you are now connected with ${counterpartUser?.name ?? 'this member'}.`,
            `Accepted opportunities between you: ${acceptedOpportunitiesMeta.length}.`,
            'Start by sharing what you are currently working on and what help you need.',
          ].join('\n');
        }

        logger.info('[OpportunityService] Sending Index intro message', { opportunityId, channelId });
        await sendBotMessage(channel, {
          type: 'system',
          text: introText,
          introType: 'opportunity_intro',
          opportunityId,
          ...(presentation && { presentation }),
          acceptedOpportunityIds: acceptedOpportunitiesMeta.map((item) => item.opportunityId),
          acceptedAt: toIso(updated.updatedAt),
        });
        await addChannelIntroOpportunityId(channel, opportunityId);
        logger.info('[OpportunityService] Index intro message sent', { opportunityId, channelId });
      }
    } catch (error) {
      logger.error('[OpportunityService] Failed to send Index intro message; rethrowing', {
        error,
        opportunityId,
        channelId,
      });
      throw error;
    }

    // Fire-and-forget: also send accepted opportunity notification to XMTP home feeds
    this.sendOpportunityToXMTPHomeFeeds(opp).catch((err) =>
      logger.error('[OpportunityService] XMTP home feed notification failed on accept', {
        opportunityId,
        error: err,
      })
    );

    return {
      opportunity: updated,
      chat: {
        channelId,
        counterpartUserId: counterpart.userId,
        acceptedOpportunities: acceptedOpportunitiesMeta,
      },
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
    logger.info('[OpportunityService] Discovering opportunities', { userId, query, limit });

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
    logger.info('[OpportunityService] Getting opportunities for index', { indexId, userId, options });

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
    logger.info('[OpportunityService] Creating manual opportunity', { indexId, creatorId });

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
    const enrichment = await enrichOrCreate(this.db, embedder, opportunityData);
    const toCreate = enrichment.data;
    if (enrichment.enriched) {
      toCreate.status = enrichment.resolvedStatus;
    }
    const expireIds = enrichment.enriched ? enrichment.expiredIds : [];
    const { created, expired } = await this.db.createOpportunityAndExpireIds(toCreate, expireIds);

    this.events.emit('created', { opportunity: created });
    for (const opp of expired) {
      this.events.emit('expired', { opportunity: opp });
    }

    // Fire-and-forget: send opportunity card to actors' XMTP home feeds
    this.sendOpportunityToXMTPHomeFeeds(created).catch((err) =>
      logger.error('[OpportunityService] XMTP home feed notification failed', {
        opportunityId: created.id,
        error: err,
      })
    );

    return created;
  }

  /**
   * Send an opportunity card to all non-introducer actors' XMTP home feeds.
   * Fire-and-forget: XMTP failures are logged but never break the opportunity flow.
   */
  private async sendOpportunityToXMTPHomeFeeds(opportunity: Opportunity): Promise<void> {
    const nonIntroducerActors = opportunity.actors.filter((a) => a.role !== 'introducer');
    if (nonIntroducerActors.length === 0) return;

    // Resolve user info for all actors (for card display)
    const actorUsers = await Promise.all(
      nonIntroducerActors.map((a) => this.db.getUser(a.userId))
    );

    const cardContent: OpportunityCardContent = {
      type: 'opportunity_card',
      opportunityId: opportunity.id,
      headline: opportunity.interpretation?.reasoning?.slice(0, 80) || 'New opportunity',
      summary: opportunity.interpretation?.reasoning || '',
      actors: nonIntroducerActors.map((actor, i) => ({
        userId: actor.userId,
        name: actorUsers[i]?.name || 'Unknown',
        avatar: actorUsers[i]?.avatar ?? undefined,
      })),
    };

    // Look up XMTP inbox IDs and send to each actor's home feed
    for (const actor of nonIntroducerActors) {
      const userRows = await db
        .select({ xmtpInboxId: users.xmtpInboxId })
        .from(users)
        .where(eq(users.id, actor.userId))
        .limit(1);

      const inboxId = userRows[0]?.xmtpInboxId;
      if (!inboxId) {
        logger.debug('[Opportunity] No XMTP inbox ID for user; skipping home feed send', {
          userId: actor.userId,
          opportunityId: opportunity.id,
        });
        continue;
      }

      sendOpportunityToHomeFeed(inboxId, cardContent).catch((err) =>
        logger.error('[Opportunity] Failed to send opportunity to XMTP home feed', {
          userId: actor.userId,
          opportunityId: opportunity.id,
          error: err,
        })
      );
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
