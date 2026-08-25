import { EventEmitter } from 'events';
import { log } from '../lib/log';
import { RadarGraphFactory, MaintenanceGraphFactory, type MaintenanceGraphDatabase, type MaintenanceGraphCache, type MaintenanceGraphQueue, presentOpportunity, type UserInfo, canUserSeeOpportunity, validateOpportunityActors, persistOpportunities, getPrimaryActionLabel, OpportunityPresenter, gatherPresenterContext, type PresenterDatabase, safeFallbackSummary, truncateAtBoundary, buildApiChatCardPresentationCacheKey } from '@indexnetwork/protocol';
import type { OpportunityControllerDatabase, RadarGraphDatabase, CreateOpportunityData, Opportunity, OpportunityActor, OpportunityStatus, Embedder, OpportunityCache } from '@indexnetwork/protocol';

import { ChatDatabaseAdapter, chatDatabaseAdapter, conversationDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { outcomeFeedbackRecorder, type OutcomeFeedbackRecorderLike, type PreparedOutcomeCapture, type OwnerActionProvenance } from '../lib/opportunity/outcome-feedback.recorder';
import type { OutcomeOutbox } from '@indexnetwork/protocol';

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
  /** Internal clamp derived from a network-scoped API-key principal. */
  networkScopeId?: string;
  /**
   * Verified provenance of the owner action, set ONLY by controller entry
   * points that represent a genuine explicit human owner action (REST session
   * accept/reject/start-chat). Absent for
   * internal, queue, agent, and API-key callers — so Lens B capture (IND-434)
   * never records their status mutations as preference labels.
   */
  actionProvenance?: OwnerActionProvenance;
}

/**
 * Build an atomic Lens B outbox for an eligible owner action, or return empty
 * when capture is ineligible. The returned `outbox` is passed into the winning
 * transition so the event is written in the same transaction; `prepared.scope`
 * is used to trigger mining after commit iff a new row was inserted.
 */
async function buildOutcomeOutbox(
  recorder: OutcomeFeedbackRecorderLike,
  opportunity: Opportunity,
  recipientUserId: string,
  action: 'accepted' | 'rejected',
  provenance: OwnerActionProvenance | undefined,
  selectedIntentId?: string,
): Promise<{ outbox?: OutcomeOutbox; prepared: PreparedOutcomeCapture | null }> {
  if (!provenance) return { prepared: null };
  const prepared = await recorder.prepare({
    opportunity,
    recipientUserId,
    action,
    provenance,
    selectedIntentId,
  });
  if (!prepared) return { prepared: null };
  return {
    outbox: {
      event: prepared.event,
      actorResolution: prepared.actorResolution,
      result: { inserted: false },
    },
    prepared,
  };
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

interface MatchProvenanceInput {
  opportunityId: string;
  intents: Array<{ userId: string; intentId: string }>;
  recordedAt: string;
}

type MatchProvenanceDatabase = OpportunityControllerDatabase & {
  appendMatchProvenance(conversationId: string, provenance: MatchProvenanceInput): Promise<void>;
};

function buildMatchProvenance(opportunity: Pick<Opportunity, 'id' | 'actors'>): MatchProvenanceInput {
  return {
    opportunityId: opportunity.id,
    intents: opportunity.actors
      .filter((actor): actor is typeof actor & { intent: string } => typeof actor.intent === 'string' && actor.intent.length > 0)
      .map((actor) => ({ userId: actor.userId, intentId: actor.intent })),
    recordedAt: new Date().toISOString(),
  };
}

async function appendMatchProvenance(
  database: OpportunityControllerDatabase,
  conversationId: string,
  provenance: MatchProvenanceInput,
): Promise<void> {
  await (database as MatchProvenanceDatabase).appendMatchProvenance(conversationId, provenance);
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

interface OpportunityPresentationDeps {
  presenter?: OpportunityPresenter;
  presenterDatabase?: PresenterDatabase;
  gatherContext?: typeof gatherPresenterContext;
}

/**
 * Negotiation-closure seam for the owner verdict.
 *
 * An owner accept/reject is a user action on the OPPORTUNITY, outside the
 * negotiation loop — but the pairing it decides may still have a live
 * negotiation, and `NegotiationGraph`'s owner-close lane is the terminal write
 * on a negotiation task: it records the outcome artifact, completes the task,
 * and re-runs the all-paused check that arms each seat's drain-generation job.
 *
 * Production composes the conversation adapter's task read with the single
 * compiled graph; specs pass a fake pair.
 */
export interface OwnerVerdictNegotiationCloser {
  /** The opportunity's live (non-completed) negotiation, or null when it never negotiated. */
  liveNegotiationId(opportunityId: string): Promise<string | null>;
  /** Close the task after this service has committed the owner's opportunity verdict. */
  close(input: {
    negotiationId: string;
    verdict: 'pending' | 'reject';
    reasoning: string;
    byUserId: string;
  }): Promise<{ status: string; error?: string }>;
}

export class OpportunityService {
  private db: OpportunityControllerDatabase;
  private cache: OpportunityCache;
  private presenter: OpportunityPresenter | null = null;
  private readonly presenterDb: PresenterDatabase;
  private readonly gatherPresentationContext: typeof gatherPresenterContext;
  private readonly deliveryCache: RedisCacheAdapter;
  /** Lens B (IND-434): captures explicit owner accept/reject as feedback. */
  private readonly outcomeRecorder: OutcomeFeedbackRecorderLike;
  private radarGraph: ReturnType<RadarGraphFactory['createGraph']> | null = null;
  private maintenanceGraph: ReturnType<MaintenanceGraphFactory['createGraph']> | null = null;
  /** Event emitter for opportunity lifecycle; subscribe via onOpportunityEvent. */
  private readonly events = new OpportunityServiceEvents();
  /** Injected only by specs; production resolves the real graph lazily. */
  private readonly negotiationCloser: OwnerVerdictNegotiationCloser | null;

  constructor(
    database?: OpportunityControllerDatabase,
    cache?: OpportunityCache,
    outcomeRecorder: OutcomeFeedbackRecorderLike = outcomeFeedbackRecorder,
    presentation: OpportunityPresentationDeps = {},
    negotiationCloser: OwnerVerdictNegotiationCloser | null = null,
  ) {
    this.db = database ?? (new ChatDatabaseAdapter() as OpportunityControllerDatabase);
    this.cache = cache ?? new RedisCacheAdapter();
    this.presenter = presentation.presenter ?? null;
    this.presenterDb = presentation.presenterDatabase
      ?? chatDatabaseAdapter as unknown as PresenterDatabase;
    this.gatherPresentationContext = presentation.gatherContext ?? gatherPresenterContext;
    this.deliveryCache = new RedisCacheAdapter();
    this.outcomeRecorder = outcomeRecorder;
    this.negotiationCloser = negotiationCloser;
  }

  /**
   * The negotiation closer is imported lazily so loading this service does not
   * compile the negotiation graph or open the queue connection behind its
   * reflect enqueue.
   */
  private async getNegotiationCloser(): Promise<OwnerVerdictNegotiationCloser> {
    if (this.negotiationCloser) return this.negotiationCloser;
    const { negotiationGraph } = await import('../lib/negotiation/negotiation-graph');
    return {
      liveNegotiationId: async (opportunityId: string) =>
        (await conversationDatabaseAdapter.getNegotiationTaskForOpportunity(opportunityId))?.id ?? null,
      close: (input) => negotiationGraph.invoke({
        negotiationId: input.negotiationId,
        close: { reason: 'owner_verdict', verdict: input.verdict, reasoning: input.reasoning },
        byUserId: input.byUserId,
      }),
    };
  }

  /**
   * End the pairing's negotiation, if it still has one, on the owner's verdict.
   *
   * The graph's owner-close lane records the outcome artifact, completes the
   * task, and re-runs the all-paused check so each
   * bound seat's current drain-generation job can finally be enqueued. It leaves
   * the opportunity status this method already wrote alone.
   *
   * A match that never negotiated has no task and nothing happens here.
   *
   * Best-effort immediately: the owner's decision is already committed and
   * their request must not fail because this follow-up is unavailable. Any
   * active task left behind beside an accepted/rejected opportunity remains a
   * durable watchdog candidate and is retried on the next bounded sweep.
   */
  private async closeNegotiationForOwnerVerdict(
    opportunityId: string,
    action: 'accepted' | 'rejected',
    byUserId: string,
  ): Promise<void> {
    try {
      const closer = await this.getNegotiationCloser();
      const negotiationId = await closer.liveNegotiationId(opportunityId);
      if (!negotiationId) return;
      const result = await closer.close({
        negotiationId,
        // An accept closes the negotiation on its promotable outcome — the
        // owner's own `accepted` is the status, already written above. A
        // reject closes it as a reject. There is no third verdict: the graph's
        // vocabulary is the negotiation's, not the owner's.
        verdict: action === 'rejected' ? 'reject' : 'pending',
        reasoning: action === 'rejected'
          ? 'Closed by the owner declining this match.'
          : 'Closed by the owner accepting this match.',
        byUserId,
      });
      if (result.status === 'error') {
        updateStatusLogger.error('negotiation close failed after owner verdict (non-blocking)', {
          opportunityId,
          negotiationId,
          action,
          error: result.error,
        });
      }
    } catch (err) {
      updateStatusLogger.error('negotiation close failed after owner verdict (non-blocking)', {
        opportunityId,
        action,
        error: err,
      });
    }
  }

  private getPresenter(): OpportunityPresenter {
    this.presenter ??= new OpportunityPresenter();
    return this.presenter;
  }


  private getRadarGraph(): ReturnType<RadarGraphFactory['createGraph']> {
    this.radarGraph ??= new RadarGraphFactory(
      this.db as unknown as RadarGraphDatabase,
      this.cache,
    ).createGraph();
    return this.radarGraph;
  }

  private getMaintenanceGraph(): ReturnType<MaintenanceGraphFactory['createGraph']> {
    this.maintenanceGraph ??= new MaintenanceGraphFactory(
      this.db as unknown as MaintenanceGraphDatabase,
      this.cache as unknown as MaintenanceGraphCache,
      {
        addJob: async (
          data: { intentId: string; userId: string; indexIds?: string[] },
          options?: { priority?: number; jobId?: string },
        ) => {
          const { fromIntentQueue } = await import('../queues/opportunity/from-intent.queue');
          return fromIntentQueue.addJob(
            { intentId: data.intentId, userId: data.userId },
            options,
          );
        },
      } satisfies MaintenanceGraphQueue,
    ).createGraph();
    return this.maintenanceGraph;
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
   * Get radar view: a flat list of opportunity cards with presenter text,
   * optionally scoped to one intent. Clients bucket by lifecycle status.
   */
  async getRadarView(
    userId: string,
    options?: { networkId?: string; scopeType?: 'intent'; scopeId?: string; limit?: number; noCache?: boolean; statuses?: OpportunityStatus[]; presentation?: 'full' | 'skeleton' }
  ): Promise<{ items: unknown[]; meta: { totalOpportunities: number } } | { error: string }> {
    logger.verbose('Getting radar view', { userId, options });
    try {
      const radarGraph = this.getRadarGraph();
      const radarInput = {
        userId,
        networkId: options?.networkId,
        scopeType: options?.scopeType,
        scopeId: options?.scopeId,
        limit: options?.limit ?? 50,
        noCache: options?.noCache,
        statuses: options?.statuses,
        presentation: options?.presentation,
      };
      const result = await radarGraph.invoke(radarInput);
      if (result.error) {
        return { error: result.error };
      }
      const items = result.items ?? [];
      return { items, meta: result.meta ?? { totalOpportunities: 0 } };
    } catch (e) {
      logger.error('getRadarView failed', { userId, error: e });
      return { error: 'Failed to load radar view' };
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

    // Check actor visibility; the code-traceable rules live in docs/design/opportunity-status-lifecycle.md (§3.E).
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
  ): Promise<OpportunityStatusUpdateResult | { error: string; status: number }> {
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

    // Lens B (IND-434): prepare an atomic outcome-capture outbox for the two
    // explicit owner decisions (accept/reject). The event is inserted in the
    // SAME transaction as the winning transition, so a rolled-back flip leaves
    // no event. Only verified explicit human owner actions are eligible.
    const captureAction = status === 'accepted' || status === 'rejected' ? status : undefined;
    const { outbox, prepared } = captureAction
      ? await buildOutcomeOutbox(
          this.outcomeRecorder,
          opp,
          userId,
          captureAction,
          options?.actionProvenance,
          options?.scopeType === 'intent' ? options.scopeId : undefined,
        )
      : { outbox: undefined, prepared: null };

    let updated: Awaited<ReturnType<OpportunityControllerDatabase['updateOpportunityStatus']>>;
    if (status === 'accepted') {
      updated = outbox
        ? await this.db.stampOpportunityActorAction(opportunityId, userId, 'accepted', userId, outbox)
        : await this.db.stampOpportunityActorAction(opportunityId, userId, 'accepted', userId);
    } else if (status === 'pending') {
      updated = await this.db.stampOpportunityActorAction(opportunityId, userId, 'pending');
    } else {
      // Terminal flips (rejected, expired) — no actor stamp needed.
      updated = outbox
        ? await this.db.updateOpportunityStatus(opportunityId, status, undefined, outbox)
        : await this.db.updateOpportunityStatus(opportunityId, status);
    }
    if (!updated) {
      return { error: 'Opportunity not found', status: 404 };
    }

    // Fire shadow mining only when a genuinely NEW event was inserted (idempotent
    // retries and duplicates set inserted=false), and only now — after commit.
    if (prepared && outbox?.result.inserted) {
      this.outcomeRecorder.triggerMine(prepared.scope);
    }

    // An owner verdict on a NEGOTIATED pairing has to end the negotiation too.
    // The reflect trigger waits for every task in each bound seat's round to
    // stop working, so a reject or accept that flips only the opportunity
    // leaves its task `working` forever and prevents that drain from enqueueing.
    if (captureAction) {
      await this.closeNegotiationForOwnerVerdict(opportunityId, captureAction, userId);
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

    return {
      opportunity: sanitizeOpportunityForResponse(updated),
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
   *
   * Step 3 is best-effort after the status flip: its failure must
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
      await appendMatchProvenance(this.db, conversation.id, buildMatchProvenance(opp)).catch((err: unknown) => {
        startChatLogger.error('appendMatchProvenance failed (non-blocking)', {
          conversationId: conversation.id, opportunityId, userId, error: err,
        });
      });
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

    await appendMatchProvenance(this.db, conversation.id, buildMatchProvenance(opp)).catch((err: unknown) => {
      startChatLogger.error('appendMatchProvenance failed (non-blocking)', {
        conversationId: conversation.id,
        opportunityId,
        userId,
        error: err,
      });
    });

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

    // Lens B (IND-434): the Connect/Start-Chat accept is an explicit owner
    // decision. Prepare an atomic capture outbox so the append-only event is
    // written in the same transaction as the accept stamp (rollback → no event).
    const { outbox, prepared } = await buildOutcomeOutbox(
      this.outcomeRecorder,
      opp,
      userId,
      'accepted',
      options?.actionProvenance,
      options?.scopeType === 'intent' ? options.scopeId : undefined,
    );

    // Only flip status once we know the chat destination exists.
    const updated = outbox
      ? await this.db.stampOpportunityActorAction(opportunityId, userId, 'accepted', userId, outbox)
      : await this.db.stampOpportunityActorAction(opportunityId, userId, 'accepted', userId);
    if (!updated) {
      return { error: 'Failed to accept opportunity', status: 500 };
    }

    // Trigger shadow mining only on a genuine new insert, after commit.
    if (prepared && outbox?.result.inserted) {
      this.outcomeRecorder.triggerMine(prepared.scope);
    }

    // Best-effort side effects — their failure must not block the user from
    // reaching the chat. The opportunity is already accepted and the DM already
    // resolved.
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
    return {
      conversationId: conversation.id,
      counterpartUserId: counterpart.userId,
      opportunity: sanitizeOpportunityForResponse(updated),
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
          const presenterInput = await this.gatherPresentationContext(
            this.db as unknown as PresenterDatabase,
            opp,
            userId,
          );
          presenterInput.opportunityStatus = 'accepted';
          presenterInput.matchReasoning += '\n\nCONTEXT: This is shown inside an active chat between the two parties. Both already accepted. Write a warm, concise 1-sentence headline and 1-sentence summary — not a pitch or analysis.';
          const presented = await this.getPresenter().present(presenterInput);
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
   * Trigger maintenance for a specific user via the maintenance graph.
   * Fire-and-forget: logs errors but does not throw.
   *
   * @param userId - The user whose feed to evaluate
   * @param source - What triggered this maintenance check
   */
  triggerMaintenance(userId: string, source: string): void {
    logger.info('Triggering maintenance', { userId, source });
    this.getMaintenanceGraph().invoke({ userId }).catch((err) =>
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
}

export const opportunityService = new OpportunityService();
