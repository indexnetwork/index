import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { HydeGraphFactory, HydeGenerator, LensInferrer, IntentIndexer, buildNetworkAssignmentDecision, resolveAssignmentNetworkScope } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, IntentGraphQueue, IntentIndexerOutput } from '@indexnetwork/protocol';
import { fromIntentQueue } from './opportunity/from-intent.queue';

/** BullMQ queue name for intent HyDE generation and deletion jobs. */
export const QUEUE_NAME = 'intent-hyde-queue';

/** Payload for jobs that generate HyDE documents for an intent. */
export interface IntentJobData {
  intentId: string;
  userId: string;
  /** When set, intent indexing is restricted to this network plus the user's personal networks. */
  networkScopeId?: string;
}

/** Payload for jobs that delete HyDE documents for an intent. */
export interface IntentDeleteData {
  intentId: string;
}

/** Union of all job payloads accepted by the intent queue. */
export type IntentJobPayload = IntentJobData | IntentDeleteData;

/** Minimal database interface for intent queue (used when deps provided in tests). */
export type IntentQueueDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getAssignmentNetworkIdsForUser' | 'assignIntentToNetwork' | 'deleteHydeDocumentsForSource' | 'getNetworkAssignmentContext' | 'getProfile' | 'getActiveIntents'
>;

/**
 * Optional dependencies for testing. Use abstractions (`Pick<Adapter, ...>` or protocol interfaces)
 * to stub database, HyDE invocation, or opportunity job enqueue.
 */
export interface IntentQueueDeps {
  database?: IntentQueueDatabase;
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
   * @param data - intentId, userId, and optional networkScopeId. When networkScopeId
   *   is set, the worker restricts indexing to that network plus the user's personal
   *   networks (see {@link IntentJobData}).
   * @returns The BullMQ job
   */
  addGenerateHydeJob(data: { intentId: string; userId: string; networkScopeId?: string }): Promise<Job<IntentJobPayload>> {
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

  /**
   * Add a job to the intent HyDE queue.
   * @param name - Job type: `generate_hyde` or `delete_hyde`
   * @param data - Payload for the job
   * @param options - Optional jobId and priority
   * @returns The BullMQ job
   */
  async addJob(
    name: 'generate_hyde' | 'delete_hyde' | 'reconcile_intent_networks',
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
      case 'delete_hyde':
        await this.handleDeleteHyde(data as IntentDeleteData);
        break;
      default:
        this.queueLogger.warn(`[IntentProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Enqueue an assignment-only reconciliation for an intent. Unlike
   * {@link addGenerateHydeJob} this never regenerates HyDE docs or runs
   * opportunity discovery — it only (re)evaluates and writes intent_networks
   * rows. Used by network-join backfill and the orphan-reconcile sweep.
   *
   * @param data - intentId, userId, and optional networkScopeId to restrict the
   *   evaluated network set (defaults to all assignment-eligible memberships).
   * @returns The BullMQ job.
   */
  addReconcileJob(data: IntentJobData): Promise<Job<IntentJobPayload>> {
    return this.addJob('reconcile_intent_networks', data, {
      jobId: `reconcile-${data.intentId}-${data.networkScopeId ?? 'global'}`,
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
        this.addReconcileJob({ intentId: i.id, userId, networkScopeId: networkId }).catch((err) =>
          this.logger.warn('[IntentReconcile] enqueue failed', { intentId: i.id, networkId, userId, error: err }),
        ),
      ),
    );
    this.logger.info('[IntentReconcile] Enqueued network reconcile for member', { userId, networkId, intentCount: intents.length });
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
      this.queueLogger.info(`[IntentProcessor] Processing job ${job.id} (${job.name})`);
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
    const { intentId, userId, networkScopeId } = data;
    const db = this.deps?.database ?? this.database;
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.logger.warn('[IntentHyde] Intent not found, skipping', { intentId });
      return;
    }
    this.logger.info('[IntentHyde] Starting HyDE generation', { intentId, userId });
    this.logger.debug('[IntentHyde] Intent payload preview', { intentId, payload: intent.payload?.slice(0, 80) });
    const { assignedNetworkIds } = await this.assignIntentToNetworks(intentId, userId, { networkScopeId });
    this.logger.info('[IntentHyde] Index assignment complete', { intentId, assignedIndexCount: assignedNetworkIds.length });

    // Fetch discoverer profile + active intents for HyDE context (best-effort)
    let profileContext: string | undefined;
    try {
      const [profile, activeIntents] = await Promise.all([
        db.getProfile(userId),
        db.getActiveIntents(userId),
      ]);
      const lines: string[] = [];
      if (profile) {
        const identity = profile.identity;
        const attrs = profile.attributes;
        if (identity?.name || identity?.bio) {
          lines.push(`Profile: ${[identity.name, identity.bio].filter(Boolean).join(', ')}`);
        }
        if (attrs?.skills?.length) {
          lines.push(`Skills: ${attrs.skills.join(', ')}`);
        }
        if (attrs?.interests?.length) {
          lines.push(`Interests: ${attrs.interests.join(', ')}`);
        }
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
      this.logger.warn('[IntentHyde] Failed to fetch discoverer context for HyDE, proceeding without', { intentId, userId, error: ctxErr });
    }

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
    this.logger.info('[IntentHyde] HyDE generation complete, enqueuing opportunity discovery', { intentId, userId });
    const addJob =
      overrides?.addOpportunityJob ??
      this.deps?.addOpportunityJob ??
      ((d: { intentId: string; userId: string; networkIds?: string[] }) => fromIntentQueue.addJob(d));
    // Carry the agent's network scope into discovery. Without this, a network-scoped
    // agent's intent is matched against every network the user belongs to, leaking
    // opportunities across networks (e.g. agentvillage setups matching outside their
    // bound community). The from-intent queue scopes the opportunity graph to networkIds[0].
    await addJob({
      intentId,
      userId,
      ...(networkScopeId ? { networkIds: [networkScopeId] } : {}),
    }).catch((err: unknown) =>
      this.logger.error('[IntentHyde] Failed to enqueue opportunity discovery', { intentId, error: err })
    );
  }

  /**
   * Resolve the user's eligible networks (respecting optional scope), score the
   * intent against each, and upsert intent_networks rows for assigned networks.
   *
   * Pure assignment: no HyDE regeneration and no opportunity discovery, so it is
   * safe to call for reconciliation/backfill without spamming users with new
   * opportunity notifications on existing intents. Idempotent —
   * {@link ChatDatabaseAdapter.assignIntentToNetwork} upserts on
   * (intentId, networkId).
   *
   * @param intentId - Intent to assign.
   * @param userId - Owner of the intent.
   * @param opts - Optional `networkScopeId` to restrict the evaluated set and a
   *   `source` tag recorded in assignment metadata.
   * @returns Assigned network IDs and the number of networks evaluated.
   */
  private async assignIntentToNetworks(
    intentId: string,
    userId: string,
    opts?: { networkScopeId?: string; source?: string },
  ): Promise<{ assignedNetworkIds: string[]; evaluatedCount: number }> {
    const networkScopeId = opts?.networkScopeId;
    const source = opts?.source ?? 'intent-hyde-queue';
    const db = this.deps?.database ?? this.database;
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.logger.warn('[IntentAssign] Intent not found, skipping', { intentId });
      return { assignedNetworkIds: [], evaluatedCount: 0 };
    }

    const assignedNetworkIds: string[] = [];
    let evaluatedCount = 0;
    try {
      const membershipNetworkIds = await db.getAssignmentNetworkIdsForUser(userId);
      const userIndexIds = resolveAssignmentNetworkScope({ memberships: membershipNetworkIds, networkScopeId });
      evaluatedCount = userIndexIds.length;
      this.logger.info('[IntentAssign] User assignment networks found', { intentId, userId, indexCount: userIndexIds.length, indexIds: userIndexIds });

      // Instantiate once per run so the same withStructuredOutput binding is
      // reused across all network evaluations in the Promise.all below.
      const defaultIndexer = this.deps?.evaluateIntentAssignment ? null : new IntentIndexer();
      const evaluateIntentAssignment = this.deps?.evaluateIntentAssignment ?? ((o: {
        intent: string;
        indexPrompt: string | null;
        memberPrompt: string | null;
        sourceName?: string | null;
      }) => defaultIndexer!.invoke(o.intent, o.indexPrompt, o.memberPrompt, o.sourceName ?? null));

      const sourceName = intent.sourceType
        ? `${intent.sourceType}:${intent.sourceId ?? ''}`
        : undefined;

      const scoringResults = await Promise.all(
        userIndexIds.map(async (networkId) => {
          const ctx = await db.getNetworkAssignmentContext(networkId, userId);
          if (!ctx) {
            this.logger.warn('[IntentAssign] Assignment context missing for network, skipping fail-closed', { intentId, userId, networkId });
            return null;
          }
          const indexPrompt = ctx.indexPrompt ?? null;
          const memberPrompt = ctx.memberPrompt ?? null;
          const hasPrompts = !!indexPrompt?.trim() || !!memberPrompt?.trim();
          let result: IntentIndexerOutput | null = null;
          if (hasPrompts) {
            try {
              result = await evaluateIntentAssignment({ intent: intent.payload, indexPrompt, memberPrompt, sourceName });
            } catch (err) {
              this.logger.warn('[IntentAssign] IntentIndexer failed for network', { intentId, networkId, error: err });
            }
          }

          const decision = buildNetworkAssignmentDecision({
            resourceType: 'intent',
            mode: 'automatic',
            scope: networkScopeId ? 'network' : 'global',
            indexPrompt,
            memberPrompt,
            rawScores: result ? { indexScore: result.indexScore, memberScore: result.memberScore } : undefined,
            evaluator: 'intent-indexer',
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
          await db.assignIntentToNetwork(intentId, networkId, decision.finalScore, decision.metadata);
          assignedNetworkIds.push(networkId);
        } catch (assignErr) {
          this.logger.debug('[IntentAssign] Assign intent to network skipped', { intentId, networkId, error: assignErr });
        }
      }
    } catch (err) {
      this.logger.warn('[IntentAssign] Failed to assign intent to user networks', { intentId, userId, error: err });
    }

    if (assignedNetworkIds.length === 0) {
      // Explicit orphan signal: an intent registered to no network is invisible
      // in every network UI. Surface it so it can be alerted on or swept rather
      // than silently lost.
      this.logger.warn('[IntentAssign] Intent assigned to NO networks', { intentId, userId, networkScopeId, evaluatedCount });
    }
    return { assignedNetworkIds, evaluatedCount };
  }

  /**
   * Handle a `reconcile_intent_networks` job: run assignment only, with no HyDE
   * regeneration or opportunity discovery. Idempotent and safe to re-run.
   *
   * @param data - intentId, userId, and optional networkScopeId.
   */
  private async handleReconcileNetworks(data: IntentJobData): Promise<void> {
    const { intentId, userId, networkScopeId } = data;
    await this.assignIntentToNetworks(intentId, userId, { networkScopeId, source: 'intent-reconcile-queue' });
  }

  private async handleDeleteHyde(data: IntentDeleteData): Promise<void> {
    const { intentId } = data;
    const db = this.deps?.database ?? this.database;
    await db.deleteHydeDocumentsForSource('intent', intentId);
    this.logger.verbose('[IntentHyde] Deleted HyDE documents for intent', { intentId });
  }
}

/** Singleton intent HyDE queue instance. Use for adding jobs and starting the worker. */
export const intentQueue = new IntentQueue();
