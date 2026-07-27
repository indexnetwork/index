import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { ensureGlobalUserContext } from '../lib/usercontext/global-context';
import { HydeGraphFactory, HydeGenerator, LensInferrer, IntentIndexer, buildNetworkAssignmentDecision, deriveDiscoveryNetworkIds, resolveAssignmentNetworkScope } from '@indexnetwork/protocol';
import type { AssignmentNetworkMembership, HydeGraphDatabase, IntentGraphQueue, IntentIndexerOutput, ToolScopeType } from '@indexnetwork/protocol';
import { fromIntentQueue } from './opportunity/from-intent.queue';

/** BullMQ queue name for intent HyDE generation and deletion jobs. */
export const QUEUE_NAME = 'intent-hyde-queue';

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

/** Union of all job payloads accepted by the intent queue. */
export type IntentJobPayload = IntentJobData | IntentDeleteData;

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
  getUserContextText?: (userId: string) => Promise<string>;
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
 * the protocol intent graph can enqueue jobs without depending on this module.
 *
 * @remarks
 * Workers are started only by the protocol server via {@link IntentQueue.startWorker}.
 * CLI scripts (e.g. db:seed) may add jobs without starting a worker.
 */
export class IntentQueue implements IntentGraphQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<IntentJobPayload>(QUEUE_NAME);

  /**
   * Enqueue a job to generate HyDE documents for an intent (implements {@link IntentGraphQueue}).
   * @param data - intentId, userId, and optional scope envelope. When scopeType/scopeId
   *   is set, the worker restricts indexing to the focused network plus the user's
   *   personal networks (see {@link IntentJobData}).
   * @returns The BullMQ job
   */
  addGenerateHydeJob(data: IntentJobData): Promise<Job<IntentJobPayload>> {
    return this.addJob('generate_hyde', data);
  }

  /**
   * Enqueue a job to delete HyDE documents for an intent (implements {@link IntentGraphQueue}).
   * @param data - intentId
   * @returns The BullMQ job
   */
  addDeleteHydeJob(data: { intentId: string }): Promise<Job<IntentJobPayload>> {
    return this.addJob('delete_hyde', data);
  }

  private readonly logger = log.job.from('IntentJob');
  private readonly hydeLogger = log.job.from('IntentJob:Hyde');
  private readonly assignLogger = log.job.from('IntentJob:Assign');
  private readonly reconcileLogger = log.job.from('IntentJob:Reconcile');
  private readonly queueLogger = log.queue.from('IntentQueue');
  private readonly database: IntentQueueDatabase | ChatDatabaseAdapter;
  private readonly graphDb: HydeGraphDatabase;
  private readonly deps: IntentQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<IntentJobPayload>> | null = null;

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
    return networkIds.map((networkId) => ({ networkId, isPersonal: false }));
  }

  /**
   * Add a job to the intent HyDE queue.
   * @param name - Job type: `generate_hyde` or `delete_hyde`
   * @param data - Payload for the job
   * @param options - Optional jobId and priority
   * @returns The BullMQ job
   */
  async addJob(
    name: 'generate_hyde' | 'delete_hyde' | 'reconcile_intent_networks' | 'reconcile_orphaned_intent',
    data: IntentJobData | IntentDeleteData,
    options?: { jobId?: string; priority?: number }
  ): Promise<Job<IntentJobPayload>> {
    return this.queue.add(name, data as IntentJobPayload, {
      jobId: options?.jobId,
      priority: options?.priority,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    });
  }

  /**
   * Run the job handler for a given job name and payload. Used by the worker and by tests with injected deps.
   * @param name - Job name (`generate_hyde` or `delete_hyde`)
   * @param data - Job payload
   */
  async processJob(name: string, data: IntentJobPayload): Promise<void> {
    switch (name) {
      case 'generate_hyde':
        await this.handleGenerateHyde(data as IntentJobData);
        break;
      case 'reconcile_intent_networks':
        await this.handleReconcileNetworks(data as IntentJobData);
        break;
      case 'reconcile_orphaned_intent':
        await this.handleReconcileOrphanedIntent(data as IntentJobData);
        break;
      case 'delete_hyde':
        await this.handleDeleteHyde(data as IntentDeleteData);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  /**
   * Enqueue an assignment-only reconciliation for an intent. Unlike
   * {@link addGenerateHydeJob} this never regenerates HyDE docs or runs
   * opportunity discovery — it only (re)evaluates and writes intent_networks
   * rows. Used by network-join backfill and the orphan-reconcile sweep.
   *
   * @param data - intentId, userId, and optional scope envelope to restrict the
   *   evaluated network set (defaults to all assignment-eligible memberships).
   * @returns The BullMQ job.
   */
  addReconcileJob(data: IntentJobData): Promise<Job<IntentJobPayload>> {
    return this.addJob('reconcile_intent_networks', data, {
      jobId: `reconcile-${data.intentId}-${data.scopeId ?? data.networkScopeId ?? 'global'}`,
    });
  }

  /**
   * Re-admit an active intent only when an indexing prerequisite is absent.
   * The worker rechecks lifecycle, ownership, membership, scope, assignments,
   * and HyDE state at execution time, making retries safe after pauses,
   * archives, unassignments, or scoped-agent changes.
   */
  addOrphanReconciliationJob(data: IntentJobData): Promise<Job<IntentJobPayload>> {
    return this.addJob('reconcile_orphaned_intent', data, {
      jobId: `reconcile-orphaned-${data.intentId}-${data.scopeId ?? data.networkScopeId ?? 'global'}`,
    });
  }

  /**
   * Enqueue a network-scoped reconcile for every active intent a user owns.
   *
   * This is the join-time half of the protocol rule "membership re-evaluates a
   * member's existing intents against the network": intents created before the
   * user joined never get an assignment pass for the new network otherwise.
   * Driven by the `NetworkMembershipEvents.onMemberAdded` hook so it fires for
   * every membership path (REST self-join, owner-add, and the protocol
   * `create_network_membership` graph) — all converge on `addMemberToNetwork`.
   * Best-effort per intent; assignment-only (no HyDE/opportunity side effects).
   *
   * @param userId - The member whose existing intents should be re-evaluated.
   * @param networkId - The joined network; scopes evaluation to it.
   * @returns The number of reconcile jobs enqueued.
   */
  async addNetworkReconcileForUser(userId: string, networkId: string): Promise<number> {
    const db = this.deps?.database ?? this.database;
    const intents = await db.getActiveIntents(userId);
    await Promise.all(
      intents.map((i) =>
        this.addReconcileJob({ intentId: i.id, userId, scopeType: 'network', scopeId: networkId }).catch((err) =>
          this.reconcileLogger.warn('Enqueue failed', { intentId: i.id, networkId, userId, error: err }),
        ),
      ),
    );
    this.reconcileLogger.info('Enqueued network reconcile for member', { userId, networkId, intentCount: intents.length });
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
      : (this.deps?.addOpportunityJob ?? ((d: { intentId: string; userId: string; networkIds?: string[] }) => fromIntentQueue.addJob(d)));
    await this.handleGenerateHyde(data, { addOpportunityJob });
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<IntentJobPayload>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<IntentJobPayload>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleGenerateHyde(
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
    const { assignedNetworkIds } = await this.assignIntentToNetworks(intentId, userId, scope);
    this.hydeLogger.info('Index assignment complete', { intentId, assignedIndexCount: assignedNetworkIds.length });

    // Fetch discoverer global context + active intents for HyDE context (best-effort).
    // The global user_context paragraph replaces the old identity/narrative/attributes
    // flattening; it is generated on demand when the user has no stored row yet.
    let profileContext: string | undefined;
    try {
      const getUserContextText = this.deps?.getUserContextText ?? ensureGlobalUserContext;
      const [userContext, activeIntents] = await Promise.all([
        getUserContextText(userId),
        db.getActiveIntents(userId),
      ]);
      const lines: string[] = [];
      if (userContext) {
        lines.push(userContext);
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
        await this.deps.invokeHyde({
          sourceText: intent.payload,
          sourceType: 'intent',
          sourceId: intentId,
          forceRegenerate: true,
          profileContext,
        });
      } else {
        const embedder = new EmbedderAdapter();
        const cache = new RedisCacheAdapter();
        const inferrer = new LensInferrer();
        const generator = new HydeGenerator();
        const hydeGraph = new HydeGraphFactory(this.graphDb, embedder, cache, inferrer, generator).createGraph();
        await hydeGraph.invoke({
          sourceText: intent.payload,
          sourceType: 'intent',
          sourceId: intentId,
          forceRegenerate: true,
          profileContext,
        });
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
      ((d: { intentId: string; userId: string; networkIds?: string[] }) => fromIntentQueue.addJob(d));
    // Carry only the focused network scope into discovery. Assignment writes may
    // include the user's personal network, but scoped opportunity discovery must not.
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
          const indexer = new IntentIndexer();
          return (o: {
            intent: string;
            indexPrompt: string | null;
            memberPrompt: string | null;
            sourceName?: string | null;
          }) => indexer.invoke(o.intent, o.indexPrompt, o.memberPrompt, o.sourceName ?? null);
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
   * Handle a `reconcile_intent_networks` job: run assignment only, with no HyDE
   * regeneration or opportunity discovery. Idempotent and safe to re-run.
   *
   * @param data - intentId, userId, and optional scope envelope.
   */
  private async handleReconcileNetworks(data: IntentJobData): Promise<void> {
    const { intentId, userId } = data;
    await this.assignIntentToNetworks(intentId, userId, { ...resolveIntentJobScope(data), source: 'intent-reconcile-queue' });
  }

  /**
   * Re-run the normal admission sequence for an active intent whose assignment
   * or intent HyDE artifact is missing. This deliberately does not treat a
   * prompted below-threshold result as an error: the normal assignment policy
   * remains authoritative, including deterministic 1.0 promptless assignment.
   */
  private async handleReconcileOrphanedIntent(data: IntentJobData): Promise<void> {
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
    await this.handleGenerateHyde({ intentId, userId, ...scope });
  }

  private async handleDeleteHyde(data: IntentDeleteData): Promise<void> {
    const { intentId } = data;
    const db = this.deps?.database ?? this.database;
    await db.deleteHydeDocumentsForSource('intent', intentId);
    this.hydeLogger.verbose('Deleted HyDE documents for intent', { intentId });
  }
}

/** Singleton intent HyDE queue instance. Use for adding jobs and starting the worker. */
export const intentQueue = new IntentQueue();
