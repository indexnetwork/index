import { log } from '../lib/log';
import { background } from '../lib/background';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { buildProfileFromUser } from '../adapters/database.shared';
import { HydeGraphFactory, HydeGenerator, LensInferrer, Intents, buildNetworkAssignmentDecision, deriveDiscoveryNetworkIds, resolveAssignmentNetworkScope } from '@indexnetwork/protocol';
import type { AssignmentNetworkMembership, HydeGraphDatabase, IntentGraphQueue, IntentIndexerOutput, ToolScopeType } from '@indexnetwork/protocol';
import { discoveryQueue } from './opportunity/discovery.queue';
import { intentResumeDiscoveryJobId } from '../events/intent.event';

/** Payload for jobs that generate HyDE documents for an intent. */
export interface IntentJobData {
  intentId: string;
  userId: string;
  /** Focused request scope type. Currently only `network` is supported. */
  scopeType?: ToolScopeType;
  /** Focused request scope id. When `scopeType === 'network'`, this is the focused network id. */
  scopeId?: string;
  /** @deprecated Use `scopeType: 'network'` + `scopeId`. */
  networkScopeId?: string;
}

/** Payload for jobs that delete HyDE documents for an intent. */
export interface IntentDeleteData {
  intentId: string;
}

type IntentJobScope = { scopeType?: ToolScopeType; scopeId?: string };

function resolveIntentJobScope(data: { scopeType?: ToolScopeType; scopeId?: string; networkScopeId?: string } | undefined): IntentJobScope {
  if (data?.scopeType === 'network' && data.scopeId?.trim()) {
    return { scopeType: 'network', scopeId: data.scopeId.trim() };
  }
  const legacyScopeId = data?.networkScopeId?.trim();
  return legacyScopeId ? { scopeType: 'network', scopeId: legacyScopeId } : {};
}

function deriveIntentDiscoveryNetworkIds(memberships: AssignmentNetworkMembership[], scope: IntentJobScope): { networkIds?: string[] } {
  const networkIds = deriveDiscoveryNetworkIds({ memberships, ...scope });
  return scope.scopeType && scope.scopeId ? { networkIds } : {};
}

/** Minimal database interface for intent queue (used when deps provided in tests). */
export type IntentQueueDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getAssignmentNetworkMembershipsForUser' | 'getAssignmentNetworkIdsForUser' | 'assignIntentToNetworkIfMember' | 'deleteHydeDocumentsForSource' | 'getHydeDocumentsForSource' | 'getNetworkIdsForIntent' | 'getNetworkAssignmentContext' | 'getProfile' | 'getActiveIntents'
>;

/**
 * Optional dependencies for testing. Use abstractions (`Pick<Adapter, ...>` or protocol interfaces)
 * to stub database, HyDE invocation, or opportunity job enqueue.
 */
export interface IntentQueueDeps {
  database?: IntentQueueDatabase;
  /** Resolve the user's global user_context paragraph for HyDE enrichment (generate-if-empty). */
  invokeHyde?: (opts: {
    sourceText: string;
    sourceType: string;
    sourceId: string;
    forceRegenerate: boolean;
    profileContext?: string;
  }) => Promise<void>;
  addOpportunityJob?: (data: { intentId: string; userId: string; networkIds?: string[] }) => Promise<unknown>;
  evaluateIntentAssignment?: (opts: {
    intent: string;
    indexPrompt: string | null;
    memberPrompt: string | null;
    sourceName?: string | null;
  }) => Promise<IntentIndexerOutput | null>;
}

/**
 * Intent HyDE queue: BullMQ queue plus worker and job handlers.
 *
 * Handles `generate_hyde` (assign intent to user indexes, run HyDE graph, enqueue opportunity discovery)
 * and `delete_hyde` (remove HyDE documents for an intent). Implements {@link IntentGraphQueue} so
 * the protocol intent graph can trigger this work without depending on this module.
 *
 * @remarks
 * `addGenerateHydeJob`/`addDeleteHydeJob`/`addReconcileJob`/`addOrphanReconciliationJob` are
 * fire-and-forget: each runs its handler via {@link background}, unbounded, with no retry and
 * no dedup. `addResumeDiscoveryJob` is the one exception — it still enqueues onto
 * {@link discoveryQueue}, a BullMQ queue until its own slice.
 */
export class IntentQueue implements IntentGraphQueue {
  /**
   * Run HyDE generation for an intent (implements {@link IntentGraphQueue}). Fire-and-forget.
   * @param data - intentId, userId, and optional scope envelope. When scopeType/scopeId
   *   is set, indexing is restricted to the focused network plus the user's personal networks.
   */
  addGenerateHydeJob(data: IntentJobData): Promise<unknown> {
    background('intent', () => this.generateHyde(data));
    return Promise.resolve();
  }

  /**
   * Delete HyDE documents for an intent (implements {@link IntentGraphQueue}). Fire-and-forget.
   * @param data - intentId
   */
  addDeleteHydeJob(data: { intentId: string }): Promise<unknown> {
    background('intent', () => this.deleteHyde(data));
    return Promise.resolve();
  }

  /**
   * Enqueue discovery for an intent resumed from PAUSED back to ACTIVE
   * (implements {@link IntentGraphQueue}). The lifecycle-version job id
   * deduplicates retries of the same resume. Discovery is still a BullMQ
   * queue until its own slice.
   */
  addResumeDiscoveryJob(data: { intentId: string; userId: string; lifecycleVersionMs: number }): Promise<unknown> {
    return discoveryQueue.addJob(
      { intentId: data.intentId, userId: data.userId, trigger: 'intent_resume' },
      { priority: 10, jobId: intentResumeDiscoveryJobId(data.userId, data.intentId, data.lifecycleVersionMs) },
    );
  }

  private readonly logger = log.job.from('IntentJob');
  private readonly hydeLogger = log.job.from('IntentJob:Hyde');
  private readonly assignLogger = log.job.from('IntentJob:Assign');
  private readonly reconcileLogger = log.job.from('IntentJob:Reconcile');
  private readonly database: IntentQueueDatabase | ChatDatabaseAdapter;
  private readonly graphDb: HydeGraphDatabase;
  private readonly deps: IntentQueueDeps | undefined;

  /**
   * @param deps - Optional overrides for database and HyDE/opportunity calls (for tests).
   */
  constructor(deps?: IntentQueueDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.graphDb = (this.database as ChatDatabaseAdapter) as unknown as HydeGraphDatabase;
    // When deps is omitted, default adapter implements the same interface.
  }

  private async getAssignmentMemberships(userId: string): Promise<AssignmentNetworkMembership[]> {
    const db = this.deps?.database ?? this.database;
    if (typeof db.getAssignmentNetworkMembershipsForUser === 'function') {
      return db.getAssignmentNetworkMembershipsForUser(userId);
    }
    const networkIds = await db.getAssignmentNetworkIdsForUser(userId);
    return networkIds.map((networkId) => ({ networkId }));
  }

  /**
   * Run an assignment-only reconciliation for an intent, fire-and-forget. Unlike
   * {@link addGenerateHydeJob} this never regenerates HyDE docs or runs
   * opportunity discovery — it only (re)evaluates and writes intent_networks
   * rows. Used by network-join backfill and the orphan-reconcile sweep.
   *
   * @param data - intentId, userId, and optional scope envelope to restrict the
   *   evaluated network set (defaults to all assignment-eligible memberships).
   */
  addReconcileJob(data: IntentJobData): Promise<unknown> {
    background('intent', () => this.reconcileIntentNetworks(data));
    return Promise.resolve();
  }

  /**
   * Re-admit an active intent only when an indexing prerequisite is absent,
   * fire-and-forget. The handler rechecks lifecycle, ownership, membership,
   * scope, assignments, and HyDE state at execution time.
   */
  addOrphanReconciliationJob(data: IntentJobData): Promise<unknown> {
    background('intent', () => this.reconcileOrphanedIntent(data));
    return Promise.resolve();
  }

  /**
   * Run a network-scoped reconcile for every active intent a user owns, fire-and-forget.
   *
   * This is the join-time half of the protocol rule "membership re-evaluates a
   * member's existing intents against the network": intents created before the
   * user joined never get an assignment pass for the new network otherwise.
   * Driven by the `NetworkMembershipEvents.onMemberAdded` hook so it fires for
   * every membership path (REST self-join, owner-add, and the protocol
   * `create_network_membership` graph) — all converge on `addMemberToNetwork`.
   * Best-effort per intent; assignment-only (no HyDE/opportunity side effects).
   * No concurrency cap: one `background()` call per intent.
   *
   * @param userId - The member whose existing intents should be re-evaluated.
   * @param networkId - The joined network; scopes evaluation to it.
   * @returns The number of reconciles triggered.
   */
  async addNetworkReconcileForUser(userId: string, networkId: string): Promise<number> {
    const db = this.deps?.database ?? this.database;
    const intents = await db.getActiveIntents(userId);
    for (const i of intents) {
      this.addReconcileJob({ intentId: i.id, userId, scopeType: 'network', scopeId: networkId });
    }
    this.reconcileLogger.info('Triggered network reconcile for member', { userId, networkId, intentCount: intents.length });
    return intents.length;
  }

  /**
   * Run HyDE generation for an intent synchronously (e.g. during db-seed).
   * When skipOpportunity is true, does not enqueue opportunity discovery — use for seed to avoid matching test users.
   * @param data - intentId and userId
   * @param options - skipOpportunity: if true, do not add opportunity discovery job
   */
  async runGenerateHydeSync(
    data: IntentJobData,
    options?: { skipOpportunity?: boolean }
  ): Promise<void> {
    const addOpportunityJob = options?.skipOpportunity
      ? async () => {}
      : (this.deps?.addOpportunityJob ?? ((d: { intentId: string; userId: string; networkIds?: string[] }) => discoveryQueue.addJob(d)));
    await this.generateHyde(data, { addOpportunityJob });
  }

  async generateHyde(
    data: IntentJobData,
    overrides?: { addOpportunityJob?: (d: { intentId: string; userId: string; networkIds?: string[] }) => Promise<unknown> }
  ): Promise<void> {
    const { intentId, userId } = data;
    const scope = resolveIntentJobScope(data);
    const db = this.deps?.database ?? this.database;
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.hydeLogger.warn('Intent not found, skipping admission', { intentId, userId });
      return;
    }
    if (
      intent.userId !== userId ||
      intent.archivedAt ||
      (intent.status != null && intent.status !== 'ACTIVE')
    ) {
      this.hydeLogger.info('Intent is not eligible for HyDE generation, skipping admission', {
        intentId,
        userId,
        actualUserId: intent.userId,
        status: intent.status ?? 'ACTIVE',
        archived: Boolean(intent.archivedAt),
      });
      return;
    }
    this.hydeLogger.info('Starting HyDE generation', { intentId, userId });
    this.hydeLogger.debug('Intent payload preview', { intentId, payload: intent.payload?.slice(0, 80) });
    // Assignment only needs its intent_networks write to land before discovery is
    // enqueued below, so run it concurrently with the HyDE graph instead of blocking on it.
    // The `.catch` below settles this promise FULFILLED (it doesn't rethrow), which is what
    // actually closes the unhandled-rejection window across the profile-context await further
    // down — a rethrowing `.catch` would just move the unhandled rejection to its own derived
    // promise. The stashed error is rethrown after the `Promise.all` instead, preserving today's
    // behaviour of failing (and BullMQ-retrying) the job on a real assignment error, e.g. from
    // the un-try'd `getIntentForIndexing` call inside `assignIntentToNetworks`.
    let assignmentError: unknown;
    const assignmentPromise = this.assignIntentToNetworks(intentId, userId, scope)
      .then(({ assignedNetworkIds }) => {
        this.hydeLogger.info('Index assignment complete', { intentId, assignedIndexCount: assignedNetworkIds.length });
      })
      .catch((error) => {
        this.hydeLogger.error('Intent network assignment failed; BullMQ will retry admission', {
          event: 'intent_assignment_failed',
          intentId,
          userId,
          error,
        });
        assignmentError = error;
      });

    // Fetch discoverer profile (users row) + active intents for HyDE context (best-effort).
    let profileContext: string | undefined;
    try {
      const [profile, activeIntents] = await Promise.all([
        buildProfileFromUser(userId),
        db.getActiveIntents(userId),
      ]);
      const lines: string[] = [];
      if (profile) {
        const id = profile.identity;
        if (id.name?.trim()) lines.push(id.name.trim());
        if (id.bio?.trim()) lines.push(id.bio.trim());
        if (id.location?.trim()) lines.push(id.location.trim());
      }
      if (activeIntents?.length) {
        const capped = activeIntents.slice(0, 5);
        lines.push('');
        lines.push('Active intents:');
        for (const ai of capped) {
          lines.push(`- ${ai.payload}`);
        }
      }
      if (lines.length > 0) {
        profileContext = lines.join('\n');
      }
    } catch (ctxErr) {
      this.hydeLogger.warn('Failed to fetch discoverer context for HyDE, proceeding without', { intentId, userId, error: ctxErr });
    }

    try {
      if (this.deps?.invokeHyde) {
        await Promise.all([
          this.deps.invokeHyde({
            sourceText: intent.payload,
            sourceType: 'intent',
            sourceId: intentId,
            forceRegenerate: true,
            profileContext,
          }),
          assignmentPromise,
        ]);
        if (assignmentError) throw assignmentError;
      } else {
        const embedder = new EmbedderAdapter();
        const cache = new RedisCacheAdapter();
        const inferrer = new LensInferrer();
        const generator = new HydeGenerator();
        const hydeGraph = new HydeGraphFactory(this.graphDb, embedder, cache, inferrer, generator).createGraph();
        await Promise.all([
          hydeGraph.invoke({
            sourceText: intent.payload,
            sourceType: 'intent',
            sourceId: intentId,
            forceRegenerate: true,
            profileContext,
          }),
          assignmentPromise,
        ]);
        if (assignmentError) throw assignmentError;
      }
    } catch (error) {
      this.hydeLogger.error('HyDE generation failed; BullMQ will retry admission', {
        event: 'intent_hyde_generation_failed',
        intentId,
        userId,
        error,
      });
      throw error;
    }
    this.hydeLogger.info('HyDE generation complete, enqueuing opportunity discovery', { intentId, userId });
    const addJob =
      overrides?.addOpportunityJob ??
      this.deps?.addOpportunityJob ??
      ((d: { intentId: string; userId: string; networkIds?: string[] }) => discoveryQueue.addJob(d));
    // Carry only the focused network scope into discovery. Assignment writes may
    const discoveryScope: { networkIds?: string[] } = await (async () => {
      try {
        const assignmentMemberships = await this.getAssignmentMemberships(userId);
        return deriveIntentDiscoveryNetworkIds(assignmentMemberships, scope);
      } catch (err) {
        this.hydeLogger.warn('Failed to resolve assignment memberships for discovery scope, falling back to focused scope', { intentId, userId, error: err });
        return scope.scopeType && scope.scopeId ? { networkIds: [scope.scopeId] } : {};
      }
    })();
    try {
      await addJob({
        intentId,
        userId,
        ...discoveryScope,
      });
    } catch (error) {
      this.hydeLogger.error('Discovery enqueue failed; BullMQ will retry admission', {
        event: 'intent_discovery_enqueue_failed',
        intentId,
        userId,
        error,
      });
      throw error;
    }
  }

  /**
   * Resolve the user's eligible networks (respecting optional scope), score the
   * intent against each, and upsert intent_networks rows for assigned networks.
   *
   * Pure assignment: no HyDE regeneration and no opportunity discovery, so it is
   * safe to call for reconciliation/backfill without spamming users with new
   * opportunity notifications on existing intents. Idempotent —
   * {@link ChatDatabaseAdapter.assignIntentToNetworkIfMember} upserts on
   * (intentId, networkId).
   *
   * @param intentId - Intent to assign.
   * @param userId - Owner of the intent.
   * @param opts - Optional scope envelope to restrict the evaluated set and a
   *   `source` tag recorded in assignment metadata.
   * @returns Assigned network IDs and the number of networks evaluated.
   */
  private async assignIntentToNetworks(
    intentId: string,
    userId: string,
    opts?: { scopeType?: ToolScopeType; scopeId?: string; networkScopeId?: string; source?: string },
  ): Promise<{ assignedNetworkIds: string[]; evaluatedCount: number }> {
    const scope = resolveIntentJobScope(opts);
    const source = opts?.source ?? 'intent-hyde-queue';
    const db = this.deps?.database ?? this.database;
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.assignLogger.warn('Intent not found, skipping', { intentId });
      return { assignedNetworkIds: [], evaluatedCount: 0 };
    }
    if (
      intent.userId !== userId ||
      intent.archivedAt ||
      (intent.status != null && intent.status !== 'ACTIVE')
    ) {
      this.assignLogger.info('Intent is not eligible for assignment, skipping', {
        intentId,
        userId,
        actualUserId: intent.userId,
        status: intent.status ?? 'ACTIVE',
        archived: Boolean(intent.archivedAt),
      });
      return { assignedNetworkIds: [], evaluatedCount: 0 };
    }

    const assignedNetworkIds: string[] = [];
    let evaluatedCount = 0;
    try {
      const assignmentMemberships = await this.getAssignmentMemberships(userId);
      const userIndexIds = resolveAssignmentNetworkScope({ memberships: assignmentMemberships, ...scope });
      evaluatedCount = userIndexIds.length;
      this.assignLogger.info('User assignment networks found', { intentId, userId, indexCount: userIndexIds.length, indexIds: userIndexIds });

      // Instantiate the model-backed evaluator only when at least one network
      // actually has prompts. Prompt-less networks deterministically assign at
      // score 1 and must not require an OpenRouter credential.
      let evaluateIntentAssignment = this.deps?.evaluateIntentAssignment;
      const getIntentAssignmentEvaluator = () => {
        evaluateIntentAssignment ??= (() => {
          const indexer = new Intents();
          return (o: {
            intent: string;
            indexPrompt: string | null;
            memberPrompt: string | null;
            sourceName?: string | null;
          }) => indexer.indexIntent(o.intent, o.indexPrompt, o.memberPrompt, o.sourceName ?? null);
        })();
        return evaluateIntentAssignment;
      };

      const sourceName = intent.sourceType
        ? `${intent.sourceType}:${intent.sourceId ?? ''}`
        : undefined;

      const scoringResults = await Promise.all(
        userIndexIds.map(async (networkId) => {
          const ctx = await db.getNetworkAssignmentContext(networkId, userId);
          if (!ctx) {
            this.assignLogger.warn('Assignment context missing for network, skipping fail-closed', { intentId, userId, networkId });
            return null;
          }
          const indexPrompt = ctx.indexPrompt ?? null;
          const memberPrompt = ctx.memberPrompt ?? null;
          const hasPrompts = !!indexPrompt?.trim() || !!memberPrompt?.trim();
          let result: IntentIndexerOutput | null = null;
          if (hasPrompts) {
            try {
              result = await getIntentAssignmentEvaluator()({
                intent: intent.payload,
                indexPrompt,
                memberPrompt,
                sourceName,
              });
            } catch (err) {
              this.assignLogger.warn('IntentIndexer failed for network', { intentId, networkId, error: err });
            }
          }

          const decision = buildNetworkAssignmentDecision({
            resourceType: 'intent',
            mode: 'automatic',
            scope: scope.scopeType ? 'network' : 'global',
            indexPrompt,
            memberPrompt,
            rawScores: result ? { indexScore: result.indexScore, memberScore: result.memberScore } : undefined,
            evaluator: 'intent-networker',
            source,
            reason: result?.reasoning,
            createdAt: new Date().toISOString(),
          });
          return { networkId, decision };
        })
      );

      for (const scoringResult of scoringResults) {
        if (!scoringResult) continue;
        const { networkId, decision } = scoringResult;
        if (!decision.assigned) continue;
        try {
          const outcome = await db.assignIntentToNetworkIfMember(
            userId,
            intentId,
            networkId,
            decision.finalScore,
            decision.metadata,
          );
          if (outcome.kind === 'assigned' || outcome.kind === 'already_assigned') {
            assignedNetworkIds.push(networkId);
          } else {
            this.assignLogger.debug('Assign intent to network skipped by final authority', {
              intentId,
              networkId,
              outcome: outcome.kind,
            });
          }
        } catch (assignErr) {
          this.assignLogger.debug('Assign intent to network skipped', { intentId, networkId, error: assignErr });
        }
      }
    } catch (err) {
      this.assignLogger.warn('Failed to assign intent to user networks', { intentId, userId, error: err });
    }

    if (assignedNetworkIds.length === 0) {
      // Explicit orphan signal: an intent registered to no network is invisible
      // in every network UI. Surface it so it can be alerted on or swept rather
      // than silently lost.
      this.assignLogger.warn('Intent assigned to no networks', {
        event: 'intent_network_assignment_zero',
        intentId,
        userId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        evaluatedCount,
        reason: evaluatedCount === 0 ? 'no_eligible_memberships' : 'below_threshold_or_assignment_failure',
      });
    }
    return { assignedNetworkIds, evaluatedCount };
  }

  /**
   * Run assignment only, with no HyDE regeneration or opportunity discovery.
   * Idempotent and safe to re-run.
   *
   * @param data - intentId, userId, and optional scope envelope.
   */
  async reconcileIntentNetworks(data: IntentJobData): Promise<void> {
    const { intentId, userId } = data;
    await this.assignIntentToNetworks(intentId, userId, { ...resolveIntentJobScope(data), source: 'intent-reconcile-queue' });
  }

  /**
   * Re-run the normal admission sequence for an active intent whose assignment
   * or intent HyDE artifact is missing. This deliberately does not treat a
   * prompted below-threshold result as an error: the normal assignment policy
   * remains authoritative, including deterministic 1.0 promptless assignment.
   */
  async reconcileOrphanedIntent(data: IntentJobData): Promise<void> {
    const { intentId, userId } = data;
    const db = this.deps?.database ?? this.database;
    const scope = resolveIntentJobScope(data);
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent || intent.userId !== userId || intent.archivedAt || (intent.status != null && intent.status !== 'ACTIVE')) {
      this.reconcileLogger.info('Orphan reconciliation skipped by lifecycle admission', {
        event: 'intent_orphan_reconciliation_skipped',
        intentId,
        userId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        reason: !intent ? 'missing' : intent.userId !== userId ? 'owner_mismatch' : intent.archivedAt ? 'archived' : 'not_active',
      });
      return;
    }

    const [assignedNetworkIds, hydeDocuments, memberships] = await Promise.all([
      db.getNetworkIdsForIntent(intentId),
      db.getHydeDocumentsForSource('intent', intentId),
      this.getAssignmentMemberships(userId),
    ]);
    const eligibleNetworkIds = new Set(resolveAssignmentNetworkScope({ memberships, ...scope }));
    const validAssignedNetworkIds = assignedNetworkIds.filter((networkId) => eligibleNetworkIds.has(networkId));
    if (validAssignedNetworkIds.length > 0 && hydeDocuments.length > 0) {
      this.reconcileLogger.info('Orphan reconciliation already satisfied', {
        event: 'intent_orphan_reconciliation_noop',
        intentId,
        userId,
        assignedNetworkCount: validAssignedNetworkIds.length,
        hydeDocumentCount: hydeDocuments.length,
      });
      return;
    }

    this.reconcileLogger.warn('Orphan reconciliation re-admitting intent', {
      event: 'intent_orphan_reconciliation_started',
      intentId,
      userId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      assignedNetworkCount: validAssignedNetworkIds.length,
      hydeDocumentCount: hydeDocuments.length,
    });
    await this.generateHyde({ intentId, userId, ...scope });
  }

  async deleteHyde(data: IntentDeleteData): Promise<void> {
    const { intentId } = data;
    const db = this.deps?.database ?? this.database;
    await db.deleteHydeDocumentsForSource('intent', intentId);
    this.hydeLogger.verbose('Deleted HyDE documents for intent', { intentId });
  }
}

/** Singleton intent HyDE handler instance. Use for triggering handlers and background work. */
export const intentQueue = new IntentQueue();

/** Re-admit an active intent whose assignment or HyDE artifact is missing. */
export function reconcileOrphanedIntent(data: IntentJobData): Promise<void> {
  return intentQueue.reconcileOrphanedIntent(data);
}
