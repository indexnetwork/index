import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { HydeGraphFactory, HydeGenerator, LensInferrer, IntentIndexer } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, IntentGraphQueue } from '@indexnetwork/protocol';
import { opportunityQueue } from './opportunity.queue';

/** BullMQ queue name for intent HyDE generation and deletion jobs. */
export const QUEUE_NAME = 'intent-hyde-queue';

/** Payload for jobs that generate HyDE documents for an intent. */
export interface IntentJobData {
  intentId: string;
  userId: string;
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
  'getIntentForIndexing' | 'getUserNetworkIds' | 'assignIntentToNetwork' | 'deleteHydeDocumentsForSource' | 'getNetworkMemberContext' | 'getProfile' | 'getActiveIntents'
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
  addOpportunityJob?: (data: { intentId: string; userId: string }) => Promise<unknown>;
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
   * @param data - intentId and userId
   * @returns The BullMQ job
   */
  addGenerateHydeJob(data: { intentId: string; userId: string }): Promise<Job<IntentJobPayload>> {
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
    name: 'generate_hyde' | 'delete_hyde',
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
      case 'delete_hyde':
        await this.handleDeleteHyde(data as IntentDeleteData);
        break;
      default:
        this.queueLogger.warn(`[IntentProcessor] Unknown job name: ${name}`);
    }
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
      : (this.deps?.addOpportunityJob ?? ((d: { intentId: string; userId: string }) => opportunityQueue.addJob(d)));
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
    overrides?: { addOpportunityJob?: (d: { intentId: string; userId: string }) => Promise<unknown> }
  ): Promise<void> {
    const { intentId, userId } = data;
    const db = this.deps?.database ?? this.database;
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.logger.warn('[IntentHyde] Intent not found, skipping', { intentId });
      return;
    }
    this.logger.info('[IntentHyde] Starting HyDE generation', { intentId, userId });
    this.logger.debug('[IntentHyde] Intent payload preview', { intentId, payload: intent.payload?.slice(0, 80) });
    let assignedIndexCount = 0;
    try {
      const userIndexIds = await db.getUserNetworkIds(userId);
      this.logger.info('[IntentHyde] User indexes found', { intentId, userId, indexCount: userIndexIds.length, indexIds: userIndexIds });

      // Fetch prompts for each network to determine which need scoring
      const networkContexts = await Promise.all(
        userIndexIds.map(async (networkId) => {
          const ctx = await db.getNetworkMemberContext(networkId, userId);
          return { networkId, ctx };
        })
      );

      // Split: no-prompt networks get score 1.0, others need IntentIndexer
      const noPromptNetworks = networkContexts.filter(
        ({ ctx }) => !ctx?.networkPrompt?.trim() && !ctx?.memberPrompt?.trim()
      );
      const scorableNetworks = networkContexts.filter(
        ({ ctx }) => ctx?.networkPrompt?.trim() || ctx?.memberPrompt?.trim()
      );

      // Assign no-prompt networks with default score
      for (const { networkId } of noPromptNetworks) {
        try {
          await db.assignIntentToNetwork(intentId, networkId, 1.0);
          assignedIndexCount++;
        } catch (assignErr) {
          this.logger.debug('[IntentHyde] Assign intent to index skipped', { intentId, networkId, error: assignErr });
        }
      }

      // Score and assign scorable networks in parallel
      if (scorableNetworks.length > 0) {
        const indexer = new IntentIndexer();
        const scoringResults = await Promise.all(
          scorableNetworks.map(async ({ networkId, ctx }) => {
            try {
              const result = await indexer.invoke(
                intent.payload,
                ctx?.networkPrompt ?? null,
                ctx?.memberPrompt ?? null,
              );
              const score = result
                ? (ctx?.networkPrompt && ctx?.memberPrompt
                    ? result.indexScore * 0.6 + result.memberScore * 0.4
                    : ctx?.networkPrompt ? result.indexScore : result.memberScore)
                : 1.0;
              return { networkId, score };
            } catch (err) {
              this.logger.warn('[IntentHyde] IntentIndexer failed for index, using default score', { intentId, networkId, error: err });
              return { networkId, score: 1.0 };
            }
          })
        );

        for (const { networkId, score } of scoringResults) {
          try {
            await db.assignIntentToNetwork(intentId, networkId, score);
            assignedIndexCount++;
          } catch (assignErr) {
            this.logger.debug('[IntentHyde] Assign intent to index skipped', { intentId, networkId, error: assignErr });
          }
        }
      }
    } catch (err) {
      this.logger.warn('[IntentHyde] Failed to assign intent to user indexes', {
        intentId,
        userId,
        error: err,
      });
    }
    this.logger.info('[IntentHyde] Index assignment complete', { intentId, assignedIndexCount });

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
      ((d: { intentId: string; userId: string }) => opportunityQueue.addJob(d));
    await addJob({ intentId, userId }).catch((err: unknown) =>
      this.logger.error('[IntentHyde] Failed to enqueue opportunity discovery', { intentId, error: err })
    );
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
