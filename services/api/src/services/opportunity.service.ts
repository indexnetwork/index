import { EventEmitter } from 'events';
import { log } from '../lib/log';
import type { Id } from '../types/common.types';
import { OpportunityGraphFactory, HydeGraphFactory, HomeGraphFactory, MaintenanceGraphFactory, type MaintenanceGraphDatabase, type MaintenanceGraphCache, type MaintenanceGraphQueue, HydeGenerator, LensInferrer, presentOpportunity, type UserInfo, canUserSeeOpportunity, validateOpportunityActors, persistOpportunities, getPrimaryActionLabel, OpportunityPresenter, gatherPresenterContext, getOrCreateDeliveryCardBatch, type PresenterDatabase, safeFallbackSummary, truncateAtBoundary, buildApiChatCardPresentationCacheKey } from '@indexnetwork/protocol';
import type { OpportunityControllerDatabase, OpportunityGraphDatabase, HydeGraphDatabase, HomeGraphDatabase, CreateOpportunityData, Opportunity, OpportunityActor, OpportunityStatus, Embedder, HydeCache, OpportunityCache } from '@indexnetwork/protocol';
import { and, eq } from 'drizzle-orm/sql';

import { ChatDatabaseAdapter, chatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { fromIntentQueue } from '../queues/opportunity/from-intent.queue';
import { fromIntroducerQueue } from '../queues/opportunity/from-introducer.queue';
import db from '../lib/drizzle/drizzle';
import { userSocials } from '../schemas/database.schema';
import { normalizeTelegramHandle } from '@indexnetwork/protocol';
import { uptakeAcceptanceGuard, type UptakeAcceptanceAdvisoryResult, type UptakeAcceptanceGuardLike } from '../lib/opportunity/uptake-acceptance.guard';
import { outcomeFeedbackRecorder, type OutcomeFeedbackRecorderLike } from '../lib/opportunity/outcome-feedback.recorder';

const logger = log.service.from("OpportunityService");
const startChatLogger = log.service.from("OpportunityService.startChat");
const updateStatusLogger = log.service.from("OpportunityService.updateOpportunityStatus");

/**
 * Lifecycle statuses surfaced in the default opportunity list (when no explicit
 * `status` filter is given). This is everything a user currently sees EXCEPT the
 * terminal-stale `expired` and `rejected`, which otherwise clutter the live list
 * inline with active matches (IND-254). Pre-send `draft` is excluded simply by
 * its absence from this list: passing an explicit `statuses` filter makes the
 * adapter treat it as a caller-chosen filter, which bypasses the adapter's own
 * `!= 'draft'` default branch — so the omission here is what keeps drafts out on
 * this path, not that branch. A caller can still request a single terminal status
 * explicitly (e.g. `?status=expired`) for a history view — that path bypasses
 * this default.
 */
const DEFAULT_LIST_STATUSES: OpportunityStatus[] = ['latent', 'negotiating', 'pending', 'stalled', 'accepted'];

/**
 * Default statuses for the per-network community list. Stricter than
 * {@link DEFAULT_LIST_STATUSES}: it also drops `latent`. The per-user list can
 * include `latent` because the adapter applies a role-based visibility guard
 * that gates candidate-pool opportunities per actor — but the network list only
 * checks membership, with no per-actor guard, so surfacing `latent` would leak
 * pre-draft candidates to every member. Live community statuses only.
 */
const DEFAULT_NETWORK_LIST_STATUSES: OpportunityStatus[] = ['negotiating', 'pending', 'stalled', 'accepted'];

function sanitizeOpportunityForResponse<T extends Opportunity>(
  opportunity: T,
  names: { counterpartName?: string; viewerName?: string } = {},
): T {
  return {
    ...opportunity,
    interpretation: {
      ...opportunity.interpretation,
      reasoning: safeFallbackSummary(opportunity.interpretation.reasoning, {
        ...names,
        emptyText: 'Connection opportunity',
      }),
    },
  };
}

interface OpportunityStatusUpdateResult {
  opportunity: Awaited<ReturnType<OpportunityControllerDatabase['updateOpportunityStatus']>>;
  counterpartUserId?: string;
}

interface IntentScopeOptions {
  scopeType?: 'intent';
  scopeId?: string;
  acknowledgedUptakeQuestionIds?: string[];
  /** Internal clamp derived from a network-scoped API-key principal. */
  networkScopeId?: string;
}

function matchesSelectedIntentScope(
  opportunity: Pick<Opportunity, 'detection' | 'actors'>,
  userId: string,
  scope?: IntentScopeOptions,
): boolean {
  if (scope?.scopeType !== 'intent' || !scope.scopeId) return true;
  if (opportunity.detection?.triggeredBy === scope.scopeId) return true;
  return opportunity.actors.some((actor) => actor.userId === userId && actor.intent === scope.scopeId);
}

function matchesAgentNetworkScope(
  opportunity: Pick<Opportunity, 'actors'>,
  userId: string,
  networkScopeId?: string,
): boolean {
  if (!networkScopeId) return true;
  const callerAnchored = opportunity.actors.some(
    (actor) => actor.userId === userId && actor.networkId === networkScopeId,
  );
  if (!callerAnchored) return false;
  const participantIds = new Set(opportunity.actors.map((actor) => actor.userId));
  return [...participantIds].every((participantId) => opportunity.actors.some(
    (actor) => actor.userId === participantId && actor.networkId === networkScopeId,
  ));
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

/**
 * Resolve the counterpart actor for a viewer: the first non-introducer actor
 * other than the viewer, falling back to the first non-viewer actor of any role.
 * Returns `undefined` when the viewer is the only actor.
 */
function resolveCounterpart<A extends { userId: string; role: string }>(
  actors: A[],
  viewerId: string,
): A | undefined {
  return (
    actors.find((a) => a.role !== 'introducer' && a.userId !== viewerId)
    ?? actors.find((a) => a.userId !== viewerId)
  );
}

export class OpportunityService {
  private db: OpportunityControllerDatabase;
  private cache: OpportunityCache;
  private readonly presenter: OpportunityPresenter;
  private readonly presenterDb: PresenterDatabase;
  private readonly deliveryCache: RedisCacheAdapter;
  private readonly uptakeGuard: UptakeAcceptanceGuardLike;
  /** Lens B (IND-434): captures explicit owner accept/reject as feedback. */
  private readonly outcomeRecorder: OutcomeFeedbackRecorderLike;
  private graph: ReturnType<OpportunityGraphFactory['createGraph']> | null = null;
  private homeGraph: ReturnType<HomeGraphFactory['createGraph']> | null = null;
  private maintenanceGraph: ReturnType<MaintenanceGraphFactory['createGraph']> | null = null;
  /** Event emitter for opportunity lifecycle; subscribe via onOpportunityEvent. */
  private readonly events = new OpportunityServiceEvents();

  constructor(
    database?: OpportunityControllerDatabase,
    cache?: OpportunityCache,
    acceptanceGuard: UptakeAcceptanceGuardLike = uptakeAcceptanceGuard,
    outcomeRecorder: OutcomeFeedbackRecorderLike = outcomeFeedbackRecorder,
  ) {
    this.db = database ?? (new ChatDatabaseAdapter() as OpportunityControllerDatabase);
    this.cache = cache ?? new RedisCacheAdapter();
    this.presenter = new OpportunityPresenter();
    this.presenterDb = chatDatabaseAdapter as unknown as PresenterDatabase;
    this.deliveryCache = new RedisCacheAdapter();
    this.uptakeGuard = acceptanceGuard;
    this.outcomeRecorder = outcomeRecorder;

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
      {
        addJob: (
          data: { intentId: string; userId: string; indexIds?: string[]; contactUserId?: string },
          options?: { priority?: number; jobId?: string },
        ) => {
          if (data.contactUserId) {
            return fromIntroducerQueue.addJob(
              { userId: data.userId, contactUserId: data.contactUserId, networkIds: data.indexIds },
              options,
            );
          }
          return fromIntentQueue.addJob(
            { intentId: data.intentId, userId: data.userId },
            options,
          );
        },
      } satisfies MaintenanceGraphQueue,
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
   * Render (or reuse cached) the delivery card for a given (opportunity, viewer)
   * pair and return the snapshotted greeting string. Returns `''` when the
   * presenter could not produce one (cache miss + LLM fallback path).
   *
   * @param opportunityId - The opportunity to render.
   * @param viewerUserId - The user the card is being rendered for.
   * @returns The greeting string, or `''` when unavailable.
   */
  async getGreetingForCard(opportunityId: string, viewerUserId: string): Promise<string> {
    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) return '';
    try {
      const cards = await getOrCreateDeliveryCardBatch(
        this.deliveryCache,
        this.presenter,
        this.presenterDb,
        [
          {
            id: opp.id,
            status: opp.status,
            actors: opp.actors as Array<{ userId: string; role: string }>,
            interpretation: opp.interpretation,
            detection: opp.detection,
          },
        ],
        viewerUserId,
      );
      return cards.get(opportunityId)?.greeting ?? '';
    } catch (err) {
      logger.warn('getGreetingForCard failed', { opportunityId, error: err });
      return '';
    }
  }

  /**
   * Get home view: dynamic sections of opportunities with presenter text and LLM-chosen section titles/icons.
   */
  async getHomeView(
    userId: string,
    options?: { networkId?: string; scopeType?: 'intent'; scopeId?: string; limit?: number; noCache?: boolean; statuses?: OpportunityStatus[]; presentation?: 'full' | 'skeleton' }
  ): Promise<{ sections: Array<{ id: string; title: string; subtitle?: string; iconName: string; items: unknown[] }>; meta: { totalOpportunities: number; totalSections: number; maintenanceTriggered: boolean } } | { error: string }> {
    logger.verbose('Getting home view', { userId, options });
    if (!this.homeGraph) {
      return { error: 'Home view not available' };
    }
    try {
      const homeInput = {
        userId,
        networkId: options?.networkId,
        scopeType: options?.scopeType,
        scopeId: options?.scopeId,
        limit: options?.limit ?? 50,
        noCache: options?.noCache,
        statuses: options?.statuses,
        presentation: options?.presentation,
      };
      const result = await this.homeGraph.invoke(homeInput);
      if (result.error) {
        return { error: result.error };
      }
      const sections = result.sections ?? [];
      const meta: { totalOpportunities: number; totalSections: number; maintenanceTriggered: boolean } = {
        ...(result.meta ?? { totalOpportunities: 0, totalSections: 0 }),
        maintenanceTriggered: false,
      };

      // Fire-and-forget maintenance: health-scored check replaces empty-feed-only trigger.
      // Intent scope is a feed narrowing, not a maintenance target, so it does not suppress
      // the existing unscoped maintenance trigger. Network scope retains current behavior.
      // Skeleton requests are the fast first phase of a two-phase fetch; the
      // full request that follows immediately will trigger maintenance, so
      // firing here would just double it.
      if (this.maintenanceGraph && !options?.networkId && options?.presentation !== 'skeleton') {
        meta.maintenanceTriggered = true;
        logger.info('Triggering maintenance via health scoring', { userId, source: 'home-view' });
        this.maintenanceGraph.invoke({ userId }).catch((err) =>
          logger.warn('Maintenance graph failed', { userId, error: err })
        );
      }

      return { sections, meta };
    } catch (e) {
      logger.error('getHomeView failed', { userId, error: e });
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
      statuses?: OpportunityStatus[];
      networkId?: string;
      scopeType?: 'intent';
      scopeId?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    logger.verbose('Getting opportunities for user', { userId, options });

    // No explicit status filter ⇒ show only live statuses, hiding terminal-stale
    // expired/rejected from the default list (IND-254). An explicit `status` or
    // `statuses` filter (e.g. ?status=expired for a history view) is honored as-is.
    const hasExplicitStatus = !!options?.status || (options?.statuses?.length ?? 0) > 0;
    const rows = await this.db.getOpportunitiesForUser(
      userId,
      hasExplicitStatus ? options : { ...options, statuses: DEFAULT_LIST_STATUSES },
    );

    // Resolve actor names in bulk for CLI/API consumers
    const allUserIds = new Set<string>();
    for (const opp of rows) {
      for (const actor of opp.actors) {
        allUserIds.add(actor.userId);
      }
    }
    const userMap = new Map<string, { name?: string; avatar: string | null }>();
    const lookups = [...allUserIds].map(async (uid) => {
      const user = await this.db.getUser(uid);
      if (user) userMap.set(uid, { name: user.name ?? undefined, avatar: user.avatar ?? null });
    });
    await Promise.all(lookups);

    return rows.map((opp) => {
      const counterpart = resolveCounterpart(opp.actors, userId);
      const enrichedActors = opp.actors.map((a) => ({
        ...a,
        name: userMap.get(a.userId)?.name ?? undefined,
        avatar: userMap.get(a.userId)?.avatar ?? null,
      }));
      const counterpartInfo = counterpart ? userMap.get(counterpart.userId) : undefined;
      const viewerInfo = userMap.get(userId);
      return {
        ...sanitizeOpportunityForResponse(opp, {
          counterpartName: counterpartInfo?.name ?? undefined,
          viewerName: viewerInfo?.name ?? undefined,
        }),
        actors: enrichedActors,
        counterpartName: counterpartInfo?.name ?? undefined,
        counterpartAvatar: counterpartInfo?.avatar ?? null,
      };
    });
  }

  private assertOpportunityVisible(opp: Opportunity, viewerId: string): { error: string; status: number } | null {
    const isActor = opp.actors.some((a) => a.userId === viewerId);
    if (!isActor) {
      return { error: 'Not authorized to view this opportunity', status: 403 };
    }
    if (!canUserSeeOpportunity(opp.actors, opp.status, viewerId)) {
      return { error: 'Not authorized to view this opportunity', status: 403 };
    }
    return null;
  }

  private async resolveVisibleEnrichedReplacement(
    original: Opportunity,
    viewerId: string,
  ): Promise<{ opportunity: Opportunity; resolvedFromOpportunityId?: string }> {
    let current = original;
    let resolvedFromOpportunityId: string | undefined;
    const seenIds = new Set<string>([original.id]);

    for (let depth = 0; depth < 5 && current.status === 'expired'; depth++) {
      const replacements = await this.db.findEnrichedReplacementOpportunities(current.id);
      const replacement = replacements.find((candidate) => {
        if (seenIds.has(candidate.id)) return false;

        const visibilityError = this.assertOpportunityVisible(candidate, viewerId);
        if (visibilityError) {
          logger.warn('Enriched replacement hidden from viewer', {
            originalOpportunityId: original.id,
            replacementOpportunityId: candidate.id,
            viewerId,
            status: candidate.status,
          });
          return false;
        }

        return true;
      });

      if (!replacement) break;
      seenIds.add(replacement.id);
      resolvedFromOpportunityId ??= original.id;
      current = replacement;
    }

    return resolvedFromOpportunityId
      ? { opportunity: current, resolvedFromOpportunityId }
      : { opportunity: current };
  }

  /**
   * Get a single opportunity with full presentation details.
   *
   * @param opportunityId - The opportunity ID
   * @param viewerId - The user viewing the opportunity
   * @returns Opportunity with presentation data or null
   */
  async getOpportunityWithPresentation(opportunityId: string, viewerId: string) {
    logger.verbose('Getting opportunity', { opportunityId, viewerId });

    let opp = await this.db.getOpportunity(opportunityId);
    if (!opp) {
      return null;
    }

    // Check if viewer is an actor and allowed to see per role-based visibility (Latent Opportunity Lifecycle)
    const visibilityError = this.assertOpportunityVisible(opp, viewerId);
    if (visibilityError) {
      return visibilityError;
    }

    const replacementResolution = await this.resolveVisibleEnrichedReplacement(opp, viewerId);
    opp = replacementResolution.opportunity;

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
      index: indexRecord ? { id: indexRecord.id, title: indexRecord.title } : (networkIdForDisplay ? { id: networkIdForDisplay, title: '' } : { id: '', title: '' }),
      status: opp.status,
      isGhost: isCounterpartGhost,
      primaryActionLabel: getPrimaryActionLabel(myActor.role),
      createdAt: opp.createdAt instanceof Date ? opp.createdAt.toISOString() : opp.createdAt,
      expiresAt: opp.expiresAt ? (opp.expiresAt instanceof Date ? opp.expiresAt.toISOString() : opp.expiresAt) : undefined,
      ...(replacementResolution.resolvedFromOpportunityId
        ? { resolvedFromOpportunityId: replacementResolution.resolvedFromOpportunityId }
        : {}),
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
    userId: string,
    options?: IntentScopeOptions,
  ): Promise<OpportunityStatusUpdateResult | UptakeAcceptanceAdvisoryResult | { error: string; status: number }> {
    logger.verbose('Updating opportunity status', {
      opportunityId,
      status,
      userId,
      scopeType: options?.scopeType,
      scopeId: options?.scopeId,
    });

    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) {
      return { error: 'Opportunity not found', status: 404 };
    }

    const callerActor = opp.actors.find((a) => a.userId === userId);
    if (!callerActor) {
      return { error: 'Not authorized to update this opportunity', status: 403 };
    }
    if (!matchesSelectedIntentScope(opp, userId, options)) {
      return { error: 'Opportunity not found', status: 404 };
    }
    if (!matchesAgentNetworkScope(opp, userId, options?.networkScopeId)) {
      return { error: 'Opportunity not found', status: 404 };
    }

    // Self-accept guard: if the caller has already committed (actedAt is set)
    // and they are trying to accept, block them — the other party must accept.
    if (status === 'accepted' && callerActor.actedAt) {
      return { error: 'You have already acted on this opportunity. The other party must accept.', status: 409 };
    }

    if (status === 'accepted') {
      const advisory = await this.uptakeGuard.check({
        opportunityId,
        userId,
        networkId: options?.networkScopeId,
        acknowledgedUptakeQuestionIds: options?.acknowledgedUptakeQuestionIds,
      });
      if (advisory) return advisory;
    }

    const counterpart = status === 'accepted'
      ? resolveCounterpart(opp.actors, userId)
      : undefined;

    if (counterpart) {
      try {
        await this.db.getOrCreateDM(userId, counterpart.userId);
      } catch (err) {
        updateStatusLogger.error('getOrCreateDM failed; status left untouched', {
          opportunityId,
          userId,
          counterpartUserId: counterpart.userId,
          error: err,
        });
        return { error: 'Failed to create conversation for this opportunity', status: 500 };
      }
    }

    let updated: Awaited<ReturnType<OpportunityControllerDatabase['updateOpportunityStatus']>>;
    if (status === 'accepted') {
      updated = await this.db.stampOpportunityActorAction(opportunityId, userId, 'accepted', userId);
    } else if (status === 'pending') {
      updated = await this.db.stampOpportunityActorAction(opportunityId, userId, 'pending');
    } else {
      // Terminal flips (rejected, expired) — no actor stamp needed
      updated = await this.db.updateOpportunityStatus(opportunityId, status);
    }
    if (!updated) {
      return { error: 'Opportunity not found', status: 404 };
    }

    // Lens B (IND-434): capture the explicit owner decision as append-only
    // feedback. Only accept/reject are preferences; this is the authoritative
    // owner path, runs after the write succeeded (rollback → no event), and is
    // fully best-effort (never throws), so it cannot affect the response.
    if (status === 'accepted' || status === 'rejected') {
      await this.outcomeRecorder.record({ opportunity: opp, recipientUserId: userId, action: status });
    }

    if (!counterpart) {
      return { opportunity: sanitizeOpportunityForResponse(updated) };
    }

    const counterpartUserId = counterpart.userId;

    if (options?.scopeType !== 'intent') {
      await this.db.acceptSiblingOpportunities(userId, counterpartUserId, opportunityId).catch((err) => {
        updateStatusLogger.error('acceptSiblingOpportunities failed (non-blocking)', {
          opportunityId,
          userId,
          counterpartUserId,
          error: err,
        });
      });
    }

    // Accepter explicitly acted — restore if previously removed.
    // Counterpart: add them to the accepter but honour any prior opt-out on their side.
    await this.db.upsertContactMembership(userId, counterpartUserId, { restore: true }).catch((err) => {
      updateStatusLogger.error('upsertContactMembership failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId,
        error: err,
      });
    });
    await this.db.upsertContactMembership(counterpartUserId, userId, { restore: false }).catch((err) => {
      updateStatusLogger.error('upsertContactMembership (counterpart) failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId,
        error: err,
      });
    });

    return {
      opportunity: sanitizeOpportunityForResponse(updated),
      counterpartUserId,
    };
  }

  /**
   * Approve an introduction: validate the user is an introducer with
   * `approved: false`, flip the approved flag, and transition the
   * opportunity to `pending` (which triggers negotiation).
   *
   * @param opportunityId - The opportunity ID
   * @param userId - The user approving (must be an introducer)
   * @returns Success object or error with status
   */
  async approveIntroduction(
    opportunityId: string,
    userId: string,
    options?: Pick<IntentScopeOptions, 'networkScopeId'>,
  ): Promise<{ success: true } | { error: string; status: number }> {
    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) {
      return { error: 'Opportunity not found', status: 404 };
    }

    const actor = opp.actors.find((a) => a.userId === userId);
    if (!actor || actor.role !== 'introducer') {
      return { error: 'Not authorized — user is not an introducer on this opportunity', status: 403 };
    }
    if (!matchesAgentNetworkScope(opp, userId, options?.networkScopeId)) {
      return { error: 'Opportunity not found', status: 404 };
    }

    const TERMINAL_STATUSES = new Set(['pending', 'negotiating', 'accepted', 'rejected', 'expired']);

    if (actor.approved === true) {
      // Approval already flipped — only retry the status transition if it hasn't landed yet.
      // This handles the case where a prior call flipped approved but failed to transition status.
      if (TERMINAL_STATUSES.has(opp.status)) {
        return { success: true };
      }
    } else {
      // Flip approved flag
      const updated = await this.db.updateOpportunityActorApproval(opportunityId, userId, true);
      if (!updated) {
        return { error: 'Failed to update approval', status: 500 };
      }
    }

    // Transition to pending (triggers negotiation)
    const statusResult = await this.updateOpportunityStatus(opportunityId, 'pending', userId);
    if (statusResult && 'error' in statusResult) {
      logger.error('Status transition failed during introduction approval', {
        opportunityId,
        userId,
        error: statusResult.error,
      });
      return { error: 'Failed to trigger negotiation after approval', status: 500 };
    }

    return { success: true };
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
    options?: IntentScopeOptions,
  ): Promise<
    | { conversationId: string; counterpartUserId: string; opportunity: Opportunity }
    | UptakeAcceptanceAdvisoryResult
    | { error: string; status: number }
  > {
    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) {
      return { error: 'Opportunity not found', status: 404 };
    }
    if (opp.status === 'accepted') {
      const isActor = opp.actors.some((a) => a.userId === userId);
      if (!isActor) {
        return { error: 'Not authorized to start chat for this opportunity', status: 403 };
      }
      if (!matchesSelectedIntentScope(opp, userId, options)) {
        return { error: 'Opportunity not found', status: 404 };
      }
      if (!matchesAgentNetworkScope(opp, userId, options?.networkScopeId)) {
        return { error: 'Opportunity not found', status: 404 };
      }
      const counterpart = resolveCounterpart(opp.actors, userId);
      if (!counterpart) {
        return { error: 'Opportunity has no counterpart to chat with', status: 400 };
      }
      let conversation: { id: string };
      try {
        conversation = await this.db.getOrCreateDM(userId, counterpart.userId);
      } catch (err) {
        startChatLogger.error('getOrCreateDM failed for accepted opp', {
          opportunityId, userId, counterpartUserId: counterpart.userId, error: err,
        });
        return { error: 'Failed to resolve conversation for this opportunity', status: 500 };
      }
      await this.db.unhideConversation(userId, conversation.id).catch((err) => {
        startChatLogger.error('unhideConversation failed (non-blocking)', {
          conversationId: conversation.id, userId, error: err,
        });
      });
      return {
        conversationId: conversation.id,
        counterpartUserId: counterpart.userId,
        opportunity: sanitizeOpportunityForResponse(opp),
      };
    }
    if (opp.status !== 'pending' && opp.status !== 'draft' && opp.status !== 'latent') {
      return {
        error: `Cannot start chat on opportunity in status '${opp.status}'; must be pending, draft, or latent.`,
        status: 400,
      };
    }
    const callerActor = opp.actors.find((a) => a.userId === userId);
    if (!callerActor) {
      return { error: 'Not authorized to start chat for this opportunity', status: 403 };
    }
    if (!matchesSelectedIntentScope(opp, userId, options)) {
      return { error: 'Opportunity not found', status: 404 };
    }
    if (!matchesAgentNetworkScope(opp, userId, options?.networkScopeId)) {
      return { error: 'Opportunity not found', status: 404 };
    }

    // Self-accept guard: if the caller already committed (actedAt is set) they
    // cannot accept again — the other party must be the one to accept.
    if (callerActor.actedAt) {
      return { error: 'You have already acted on this opportunity. The other party must accept.', status: 409 };
    }

    const advisory = await this.uptakeGuard.check({
      opportunityId,
      userId,
      networkId: options?.networkScopeId,
      acknowledgedUptakeQuestionIds: options?.acknowledgedUptakeQuestionIds,
    });
    if (advisory) return advisory;

    const counterpart = resolveCounterpart(opp.actors, userId);
    if (!counterpart) {
      return { error: 'Opportunity has no counterpart to chat with', status: 400 };
    }

    // Resolve the DM first — independent of opp state, safe to retry if it
    // throws (opp is still pending/draft/latent, button re-appears).
    let conversation: { id: string };
    try {
      conversation = await this.db.getOrCreateDM(userId, counterpart.userId);
    } catch (err) {
      startChatLogger.error('getOrCreateDM failed; opp left untouched', {
        opportunityId,
        userId,
        counterpartUserId: counterpart.userId,
        error: err,
      });
      return { error: 'Failed to resolve conversation for this opportunity', status: 500 };
    }

    // Clear hiddenAt so the conversation appears in the sidebar even if the
    // user previously hid it. This must happen before returning — the frontend
    // immediately calls refreshConversations() and expects to see the DM.
    await this.db.unhideConversation(userId, conversation.id).catch((err) => {
      startChatLogger.error('unhideConversation failed (non-blocking)', {
        conversationId: conversation.id,
        userId,
        error: err,
      });
    });

    // Only flip status once we know the chat destination exists.
    const updated = await this.db.stampOpportunityActorAction(opportunityId, userId, 'accepted', userId);
    if (!updated) {
      return { error: 'Failed to accept opportunity', status: 500 };
    }

    // Lens B (IND-434): the Connect/Start-Chat accept is an explicit owner
    // decision — capture it as append-only feedback (best-effort, never throws).
    await this.outcomeRecorder.record({ opportunity: opp, recipientUserId: userId, action: 'accepted' });

    // Best-effort side effects — their failure must not block the user from
    // reaching the chat. The opp is already accepted and the DM already
    // resolved; these keep the home feed and contacts view in sync.
    if (options?.scopeType !== 'intent') {
      await this.db.acceptSiblingOpportunities(userId, counterpart.userId, opportunityId).catch((err) => {
        startChatLogger.error('acceptSiblingOpportunities failed (non-blocking)', {
          opportunityId,
          userId,
          counterpartUserId: counterpart.userId,
          error: err,
        });
      });
    }
    await this.db.upsertContactMembership(userId, counterpart.userId, { restore: true }).catch((err) => {
      startChatLogger.error('upsertContactMembership failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId: counterpart.userId,
        error: err,
      });
    });
    await this.db.upsertContactMembership(counterpart.userId, userId, { restore: false }).catch((err) => {
      startChatLogger.error('upsertContactMembership (counterpart) failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId: counterpart.userId,
        error: err,
      });
    });

    return {
      conversationId: conversation.id,
      counterpartUserId: counterpart.userId,
      opportunity: sanitizeOpportunityForResponse(updated),
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
    logger.verbose('Discovering opportunities', { userId, query, limit });

    if (!this.graph) {
      return { error: 'Discovery not available; graph dependencies not configured', status: 503 };
    }

    const memberships = await this.db.getNetworkMemberships(userId);
    const indexScope = memberships.map((m) => m.networkId);

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

    return {
      ...result,
      opportunities: (result.opportunities ?? []).map((opportunity) =>
        sanitizeOpportunityForResponse(opportunity)),
    };
  }

  /**
   * Get opportunities for a specific index.
   *
   * @param networkId - The network ID
   * @param userId - User requesting (for authorization)
   * @param options - Filter options
   * @returns List of opportunities or error
   */
  async getOpportunitiesForNetwork(
    networkId: string,
    userId: string,
    options?: {
      status?: 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
      statuses?: OpportunityStatus[];
      limit?: number;
      offset?: number;
    }
  ) {
    logger.verbose('Getting opportunities for index', { networkId, userId, options });

    const isOwner = await this.db.isIndexOwner(networkId, userId);
    const isMember = await this.db.isNetworkMember(networkId, userId);

    if (!isOwner && !isMember) {
      return { error: 'Not a member of this network', status: 403 };
    }

    // IND-254: the network list had no status filtering at all, so it leaked
    // draft/latent and terminal-stale expired/rejected into the community view.
    // Default to live community statuses (no latent — there's no per-actor
    // visibility guard here) unless an explicit status/statuses filter is given.
    const hasExplicitStatus = !!options?.status || (options?.statuses?.length ?? 0) > 0;
    const rows = await this.db.getOpportunitiesForNetwork(
      networkId,
      hasExplicitStatus ? options : { ...options, statuses: DEFAULT_NETWORK_LIST_STATUSES },
    );
    return rows.map((opp) => sanitizeOpportunityForResponse(opp));
  }

  /**
   * Create a manual opportunity (curator feature).
   *
   * @param networkId - The network ID
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
    logger.verbose('Creating manual opportunity', { networkId, creatorId });

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
        logger.warn('createManualOpportunity persistence failed', { errors, creatorId, networkId });
        return { error: message, status: 500 };
      }

      this.events.emit('created', { opportunity: created[0] });
      for (const opp of expired) {
        this.events.emit('expired', { opportunity: opp });
      }
      return sanitizeOpportunityForResponse(created[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to persist opportunity';
      logger.warn('createManualOpportunity persistence failed', { error: err, creatorId, networkId });
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
    logger.verbose('Getting chat context', { userId, peerUserId });

    const [allRows, peerUser] = await Promise.all([
      this.db.findOpportunitiesByActors([userId, peerUserId], { includeIntroducers: true, statuses: ['accepted'] }),
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
      const cacheKeys = rows.map((opp) =>
        buildApiChatCardPresentationCacheKey(opp.id, userId)
      );
      cachedResults = await this.cache.mget<ChatCardCached>(cacheKeys);
    } catch (e) {
      logger.warn('getChatContext cache read failed, skipping', { error: e });
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
          if (!presented.isFallback) {
            try {
              await this.cache.set(
                buildApiChatCardPresentationCacheKey(opp.id, userId),
                card,
                { ttl: CHAT_CACHE_TTL },
              );
            } catch {
              // Cache write failure is non-critical
            }
          }
          return card;
        } catch (err) {
          logger.warn('getChatContext presenter failed, using fallback', { error: err, opportunityId: opp.id });
          const introducerActor = opp.actors.find((a) => a.role === 'introducer');
          const introducerName = introducerActor ? opp.detection?.createdByName ?? null : null;
          // Shared sanitization standard — see opportunity.safe-presentation.ts in protocol.
          const fallbackSummary = safeFallbackSummary(opp.interpretation?.reasoning, {
            counterpartName: peerUser?.name ?? undefined,
            introducerName,
            emptyText: 'Connection opportunity',
          });
          return {
            opportunityId: opp.id,
            headline: truncateAtBoundary(fallbackSummary, 79) || 'Connection opportunity',
            personalizedSummary: fallbackSummary,
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

    const counterpart = resolveCounterpart(opp.actors, viewerId);

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
      logger.warn('Maintenance graph not available', { userId, source });
      return;
    }
    logger.info('Triggering maintenance', { userId, source });
    this.maintenanceGraph.invoke({ userId }).catch((err) =>
      logger.warn('Maintenance graph failed', { userId, source, error: err })
    );
  }

  /**
   * Check if user has permission to create opportunities in an index.
   *
   * @param creatorId - User creating the opportunity
   * @param parties - Parties involved
   * @param networkId - The network ID
   * @returns Permission result
   */
  private async checkCreatePermission(
    creatorId: string,
    parties: Array<{ userId: string }>,
    networkId: string
  ): Promise<{ allowed: boolean }> {
    const isOwner = await this.db.isIndexOwner(networkId, creatorId);
    const isSelfIncluded = parties.some((p) => p.userId === creatorId);

    if (isOwner) return { allowed: true };

    const isMember = await this.db.isNetworkMember(networkId, creatorId);
    if (!isMember) return { allowed: false };
    if (isSelfIncluded) return { allowed: true };

    return { allowed: true };
  }

  /**
   * Look up a user's Telegram handle from user_socials.
   * Returns the normalized handle (no @ prefix, no URL) or null.
   */
  async getCounterpartTelegramHandle(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ value: userSocials.value })
      .from(userSocials)
      .where(and(eq(userSocials.userId, userId), eq(userSocials.label, 'telegram')))
      .limit(1);

    return normalizeTelegramHandle(row?.value);
  }

  /**
   * Telegram handle of the counterpart on an opportunity, given the viewer.
   * Resolves the counterpart from the opportunity's actors JSONB (excluding
   * the viewer and any introducer) and looks up their public Telegram handle
   * in user_socials.
   *
   * @param opportunityId - The opportunity to inspect.
   * @param viewerUserId - The user viewing the opportunity (excluded from counterpart pick).
   * @returns The counterpart's normalized Telegram handle, or null if there is
   *   no counterpart, no telegram social, or the opportunity is not found.
   */
  async getCounterpartTelegramHandleForOpp(opportunityId: string, viewerUserId: string): Promise<string | null> {
    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) return null;
    const counterpart = resolveCounterpart(opp.actors, viewerUserId);
    if (!counterpart) return null;
    return this.getCounterpartTelegramHandle(counterpart.userId);
  }


  /**
   * Conversation id (DM) for the (opportunity, viewer) pair.
   *
   * Resolves the counterpart from the opportunity's actors JSONB and returns
   * the DM conversation id between the viewer and the counterpart via
   * `getOrCreateDM` (idempotent — does not create a new chat row when one
   * already exists for the user pair).
   *
   * @param opportunityId - The opportunity to inspect.
   * @param viewerUserId - The user requesting the conversation.
   * @returns The DM conversation id, or null if the opportunity has no
   *   resolvable counterpart.
   */
  async getConversationIdForOpp(opportunityId: string, viewerUserId: string): Promise<string | null> {
    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) return null;
    const counterpart = resolveCounterpart(opp.actors, viewerUserId);
    if (!counterpart) return null;
    try {
      const dm = await this.db.getOrCreateDM(viewerUserId, counterpart.userId);
      return dm.id;
    } catch (err) {
      logger.error('getOrCreateDM failed while resolving conversation for opportunity', {
        opportunityId, viewerUserId, counterpartUserId: counterpart.userId, error: err,
      });
      return null;
    }
  }
}

export const opportunityService = new OpportunityService();
