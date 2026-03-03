import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import type { Id } from '../types/common.types';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import type { OpportunityGraphDatabase, HydeGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import type { HydeCache } from '../lib/protocol/interfaces/cache.interface';
import { OpportunityGraphFactory } from '../lib/protocol/graphs/opportunity.graph';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde.generator';
import { LensInferrer } from '../lib/protocol/agents/lens.inferrer';
import { triggerNegotiationsForDiscovery } from '../lib/protocol/support/negotiation.integration';

/** BullMQ queue name for opportunity discovery jobs. */
export const QUEUE_NAME = 'opportunity-discovery-queue';

/** Payload for a single opportunity discovery job (runs the opportunity graph for one intent). */
export interface OpportunityJobData {
  intentId: string;
  userId: string;
  indexIds?: string[];
}

/** Minimal database interface for opportunity queue (used when deps provided in tests). */
export type OpportunityQueueDatabase = Pick<ChatDatabaseAdapter, 'getIntentForIndexing'>;

/** Options passed to the opportunity graph when processing a discovery job. */
export interface OpportunityGraphInvokeOptions {
  userId: string;
  searchQuery: string;
  operationMode: 'create';
  indexId?: string;
  /** Intent that triggered this job; used for search text and triggeredBy when in scope. */
  triggerIntentId?: string;
  options: { initialStatus: 'latent' };
}

/**
 * Optional dependencies for testing. Use abstractions (`Pick<Adapter, ...>` or protocol interfaces)
 * to stub database or opportunity graph invocation.
 */
export interface OpportunityQueueDeps {
  database?: OpportunityQueueDatabase;
  invokeOpportunityGraph?: (opts: OpportunityGraphInvokeOptions) => Promise<void>;
}

/**
 * Opportunity discovery queue: BullMQ queue plus worker and job handlers.
 *
 * Handles `discover_opportunities`: loads intent, invokes the opportunity graph to find/create
 * latent opportunities. Triggered after intent HyDE generation (see intent queue).
 *
 * @remarks
 * Workers are started only by the protocol server via {@link OpportunityQueue.startWorker}.
 * CLI scripts (e.g. db:seed) may add jobs without starting a worker.
 */
export class OpportunityQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<OpportunityJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('OpportunityJob');
  private readonly queueLogger = log.queue.from('OpportunityQueue');
  private readonly database: OpportunityQueueDatabase | ChatDatabaseAdapter;
  private readonly graphDb: OpportunityGraphDatabase & HydeGraphDatabase;
  private readonly deps: OpportunityQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<OpportunityJobData>> | null = null;

  /**
   * @param deps - Optional overrides for database and opportunity graph (for tests).
   */
  constructor(deps?: OpportunityQueueDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.graphDb = (this.database as ChatDatabaseAdapter) as unknown as OpportunityGraphDatabase & HydeGraphDatabase;
    // When deps is omitted, default adapter implements the same interface.
  }

  /**
   * Add a discover_opportunities job for an intent/user.
   * @param data - intentId, userId, optional indexIds
   * @param options - Optional jobId and priority
   * @returns The BullMQ job
   */
  async addJob(
    data: OpportunityJobData,
    options?: { jobId?: string; priority?: number }
  ): Promise<Job<OpportunityJobData>> {
    const initialDelayMs = 1000;
    return this.queue.add('discover_opportunities', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: initialDelayMs },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
      jobId: options?.jobId,
      priority: options?.priority,
    });
  }

  /**
   * Run the job handler for a given job name and payload. Used by the worker and by tests with injected deps.
   * @param name - Job name (`discover_opportunities`)
   * @param data - Job payload
   */
  async processJob(name: string, data: OpportunityJobData): Promise<void> {
    switch (name) {
      case 'discover_opportunities':
        await this.handleDiscoverOpportunities(data);
        break;
      default:
        this.queueLogger.warn(`[OpportunityProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<OpportunityJobData>) => {
      this.queueLogger.info(`[OpportunityProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<OpportunityJobData>(QUEUE_NAME, processor);
  }

  private async handleDiscoverOpportunities(data: OpportunityJobData): Promise<void> {
    const { intentId } = data;
    const db = this.deps?.database ?? this.database;
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.logger.warn('[OpportunityDiscovery] Intent not found, skipping', { intentId });
      return;
    }

    // Always use negotiation-based discovery
    await this.handleDiscoverWithNegotiation(data, intent);
  }

  /**
   * Handle discovery with negotiation mode.
   * Runs discovery to find candidates, then triggers negotiations instead of inline evaluation.
   */
  private async handleDiscoverWithNegotiation(
    data: OpportunityJobData,
    intent: { payload: string }
  ): Promise<void> {
    const { intentId, userId, indexIds } = data;

    this.logger.info('[OpportunityDiscovery] Using negotiation mode', { intentId, userId });

    // Run opportunity graph in discovery-only mode to get candidates
    // We invoke the graph but intercept at the discovery stage
    const embedder: Embedder = new EmbedderAdapter();
    const cache: HydeCache = new RedisCacheAdapter();
    const inferrer = new LensInferrer();
    const generator = new HydeGenerator();
    const hydeGraph = new HydeGraphFactory(
      this.graphDb as HydeGraphDatabase,
      embedder,
      cache,
      inferrer,
      generator
    ).createGraph();
    const opportunityGraph = new OpportunityGraphFactory(
      this.graphDb as OpportunityGraphDatabase,
      embedder,
      hydeGraph
    ).createGraph();

    // Invoke graph to run discovery (it will still do evaluation, but we'll also trigger negotiations)
    const result = await opportunityGraph.invoke({
      userId: userId as Id<'users'>,
      searchQuery: intent.payload,
      operationMode: 'create',
      indexId: indexIds?.[0] as Id<'indexes'> | undefined,
      triggerIntentId: intentId,
      options: { initialStatus: 'latent' },
    });

    // Extract candidates from the graph result and trigger negotiations
    // The graph stores candidates in state.candidates after discovery
    const candidates = (result as { candidates?: Array<{ candidateUserId: string; candidateIntentId?: string; indexId: string; similarity?: number }> }).candidates ?? [];

    if (candidates.length > 0) {
      const negotiationResult = await triggerNegotiationsForDiscovery({
        initiatorUserId: userId,
        candidates: candidates.map(c => ({
          candidateUserId: c.candidateUserId,
          candidateIntentId: c.candidateIntentId,
          indexId: c.indexId,
          similarity: c.similarity,
        })),
        triggerIntentId: intentId,
        searchQuery: intent.payload,
        limit: 5, // Limit negotiations per discovery
      });

      this.logger.info('[OpportunityDiscovery] Negotiations triggered', {
        intentId,
        userId,
        negotiationsInitiated: negotiationResult.initiated,
      });
    }

    this.logger.verbose('[OpportunityDiscovery] Discovery with negotiation complete', { intentId, userId });
  }
}

/** Singleton opportunity discovery queue instance. Use for adding jobs and starting the worker. */
export const opportunityQueue = new OpportunityQueue();
