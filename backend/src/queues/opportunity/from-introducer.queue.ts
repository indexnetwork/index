// backend/src/queues/opportunity/from-introducer.queue.ts
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

export const QUEUE_NAME = 'opportunity-from-introducer';

export interface FromIntroducerJobData {
  userId: string;
  contactUserId: string;
  networkIds?: string[];
}

export type FromIntroducerDatabase = Pick<ChatDatabaseAdapter, 'getActiveIntents'>;

export interface FromIntroducerGraphInvokeOptions {
  userId: string;
  searchQuery: string;
  operationMode: 'create';
  networkId?: string;
  onBehalfOfUserId: string;
  options: { initialStatus: 'latent' };
}

export interface FromIntroducerDeps {
  database?: FromIntroducerDatabase;
  invokeOpportunityGraph?: (opts: FromIntroducerGraphInvokeOptions) => Promise<void>;
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasPersonalAgent'>;
}

export class FromIntroducerQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<FromIntroducerJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('FromIntroducerJob');
  private readonly queueLogger = log.queue.from('FromIntroducerQueue');
  private readonly database: FromIntroducerDatabase | ChatDatabaseAdapter;
  private readonly graphDb: OpportunityGraphDatabase & HydeGraphDatabase;
  private deps: FromIntroducerDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<FromIntroducerJobData>> | null = null;

  constructor(deps?: FromIntroducerDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.graphDb = (this.database as ChatDatabaseAdapter) as unknown as OpportunityGraphDatabase & HydeGraphDatabase;
  }

  setRuntimeDeps(runtimeDeps: Pick<FromIntroducerDeps, 'negotiationGraph' | 'agentDispatcher'>): void {
    this.deps = { ...(this.deps ?? {}), ...runtimeDeps };
  }

  async addJob(
    data: FromIntroducerJobData,
    options?: { jobId?: string; priority?: number },
  ): Promise<Job<FromIntroducerJobData>> {
    return this.queue.add('discover_opportunities', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
      jobId: options?.jobId,
      priority: options?.priority,
    });
  }

  async processJob(name: string, data: FromIntroducerJobData): Promise<void> {
    switch (name) {
      case 'discover_opportunities':
        await this.handleDiscover(data);
        break;
      default:
        this.queueLogger.warn(`[FromIntroducerQueueProcessor] Unknown job name: ${name}`);
    }
  }

  private async handleDiscover(data: FromIntroducerJobData): Promise<void> {
    const { userId, contactUserId, networkIds } = data;
    const db = this.deps?.database ?? this.database;

    const contactIntents = await db.getActiveIntents(contactUserId);
    if (contactIntents.length === 0) {
      this.logger.warn('[FromIntroducer] Contact has no active intents, skipping', { contactUserId, userId });
      return;
    }

    if (networkIds && networkIds.length > 1) {
      this.logger.warn('[FromIntroducer] Multiple networkIds provided, only first used', { userId, contactUserId, networkIds });
    }
    this.logger.info('[FromIntroducer] Starting discovery', { userId, contactUserId, networkIds });

    const invokeOpts: FromIntroducerGraphInvokeOptions = {
      userId: userId as Id<'users'>,
      searchQuery: contactIntents[0].payload,
      operationMode: 'create',
      networkId: networkIds?.[0] as Id<'networks'> | undefined,
      onBehalfOfUserId: contactUserId,
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
      this.logger.error('[FromIntroducer] Graph failed', { userId, contactUserId, error: result.error });
      throw new Error(typeof result.error === 'string' ? result.error : 'from-introducer graph failed');
    }

    const trace = Array.isArray(result.trace) ? result.trace : [];
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const opportunitiesArr = Array.isArray(result.opportunities) ? result.opportunities : [];

    this.logger.info('[FromIntroducer] Graph complete', {
      userId,
      contactUserId,
      candidatesFound: candidates.length,
      opportunitiesCreated: opportunitiesArr.length,
    });
    this.logger.verbose('[FromIntroducer] Graph trace', {
      userId,
      contactUserId,
      trace: trace.map((t: { node: string; detail?: string; data?: Record<string, unknown> }) => ({
        node: t.node,
        detail: t.detail,
        ...(t.data ? { data: t.data } : {}),
      })),
    });
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<FromIntroducerJobData>) => {
      this.queueLogger.info(`[FromIntroducerProcessor] Processing job ${job.id}`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<FromIntroducerJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

export const fromIntroducerQueue = new FromIntroducerQueue();
