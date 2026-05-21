// backend/src/queues/opportunity/from-intent.queue.ts
import { Job } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import type { Id } from '../../types/common.types';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../../adapters/cache.adapter';
import { OpportunityGraphFactory, HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
import type { OpportunityGraphDatabase, HydeGraphDatabase, Embedder, HydeCache, NegotiationGraphLike, AgentDispatcher } from '@indexnetwork/protocol';
import { negotiationRunExistingQueue } from '../negotiations/run-existing.queue';

export const QUEUE_NAME = 'opportunity-from-intent';

export interface FromIntentJobData {
  intentId: string;
  userId: string;
  networkIds?: string[];
}

export type FromIntentDatabase = Pick<ChatDatabaseAdapter, 'getIntentForIndexing'>;

export interface FromIntentGraphInvokeOptions {
  userId: string;
  searchQuery: string;
  operationMode: 'create';
  networkId?: string;
  triggerIntentId: string;
  options: { initialStatus: 'latent' };
}

export interface FromIntentDeps {
  database?: FromIntentDatabase;
  invokeOpportunityGraph?: (opts: FromIntentGraphInvokeOptions) => Promise<void>;
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasPersonalAgent'>;
}

export class FromIntentQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<FromIntentJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('FromIntentJob');
  private readonly queueLogger = log.queue.from('FromIntentQueue');
  private readonly database: FromIntentDatabase | ChatDatabaseAdapter;
  private readonly graphDb: OpportunityGraphDatabase & HydeGraphDatabase;
  private deps: FromIntentDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<FromIntentJobData>> | null = null;

  constructor(deps?: FromIntentDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.graphDb = (this.database as ChatDatabaseAdapter) as unknown as OpportunityGraphDatabase & HydeGraphDatabase;
  }

  setRuntimeDeps(runtimeDeps: Pick<FromIntentDeps, 'negotiationGraph' | 'agentDispatcher'>): void {
    this.deps = { ...(this.deps ?? {}), ...runtimeDeps };
  }

  async addJob(
    data: FromIntentJobData,
    options?: { jobId?: string; priority?: number },
  ): Promise<Job<FromIntentJobData>> {
    return this.queue.add('discover_opportunities', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
      jobId: options?.jobId,
      priority: options?.priority,
    });
  }

  async processJob(name: string, data: FromIntentJobData): Promise<void> {
    switch (name) {
      case 'discover_opportunities':
        await this.handleDiscover(data);
        break;
      default:
        this.queueLogger.warn(`[FromIntentQueueProcessor] Unknown job name: ${name}`);
    }
  }

  private async handleDiscover(data: FromIntentJobData): Promise<void> {
    const { intentId, userId, networkIds } = data;
    const db = this.deps?.database ?? this.database;

    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.logger.warn('[FromIntent] Intent not found, skipping', { intentId });
      return;
    }

    if (networkIds && networkIds.length > 1) {
      this.logger.warn('[FromIntent] Multiple networkIds provided, only first used', { intentId, networkIds });
    }
    this.logger.info('[FromIntent] Starting discovery', { intentId, userId, networkIds });

    const invokeOpts: FromIntentGraphInvokeOptions = {
      userId: userId as Id<'users'>,
      searchQuery: intent.payload,
      operationMode: 'create',
      networkId: networkIds?.[0] as Id<'networks'> | undefined,
      triggerIntentId: intentId,
      options: { initialStatus: 'latent' },
    };

    if (this.deps?.invokeOpportunityGraph) {
      await this.deps.invokeOpportunityGraph(invokeOpts);
      return;
    }

    const embedder: Embedder = new EmbedderAdapter();
    const cache: HydeCache = new RedisCacheAdapter();
    const inferrer = new LensInferrer();
    const generator = new HydeGenerator();
    const hydeGraph = new HydeGraphFactory(this.graphDb, embedder, cache, inferrer, generator).createGraph();
    const opportunityGraph = new OpportunityGraphFactory(
      this.graphDb,
      embedder,
      hydeGraph,
      undefined,
      undefined,
      this.deps?.negotiationGraph,
      this.deps?.agentDispatcher,
      async (opportunityId: string, userId: string) => {
        await negotiationRunExistingQueue.addJob({ opportunityId, userId });
      },
    ).createGraph();

    const result = await opportunityGraph.invoke(invokeOpts);
    if (result.error) {
      this.logger.error('[FromIntent] Graph failed', { intentId, userId, error: result.error });
      throw new Error(typeof result.error === 'string' ? result.error : 'from-intent graph failed');
    }

    const trace = Array.isArray(result.trace) ? result.trace : [];
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const opportunitiesArr = Array.isArray(result.opportunities) ? result.opportunities : [];

    this.logger.info('[FromIntent] Graph complete', {
      intentId,
      userId,
      candidatesFound: candidates.length,
      opportunitiesCreated: opportunitiesArr.length,
    });
    this.logger.verbose('[FromIntent] Graph trace', {
      intentId,
      userId,
      trace: trace.map((t: { node: string; detail?: string; data?: Record<string, unknown> }) => ({
        node: t.node,
        detail: t.detail,
        ...(t.data ? { data: t.data } : {}),
      })),
    });
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<FromIntentJobData>) => {
      this.queueLogger.info(`[FromIntentProcessor] Processing job ${job.id}`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<FromIntentJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

export const fromIntentQueue = new FromIntentQueue();
