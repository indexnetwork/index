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

export const QUEUE_NAME = 'opportunity-from-profile';

export interface FromProfileJobData {
  userId: string;
  networkId?: string;
}

export interface FromProfileDeps {
  invokeOpportunityGraph?: (opts: {
    userId: string;
    operationMode: 'create';
    networkId?: string;
    options: { initialStatus: 'latent' };
  }) => Promise<void>;
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasPersonalAgent'>;
}

/**
 * Profile-to-profile opportunity discovery queue.
 *
 * Invokes OpportunityGraph with only userId (+ optional networkId), no
 * searchQuery or triggerIntentId. The graph falls back to profile-embedding
 * vector search, discovering connections based on profile similarity.
 *
 * Triggered after profile enrichment completes for experiment-network imports
 * and headless signups.
 */
export class FromProfileQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<FromProfileJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('FromProfileJob');
  private readonly queueLogger = log.queue.from('FromProfileQueue');
  private readonly graphDb: OpportunityGraphDatabase & HydeGraphDatabase;
  private deps: FromProfileDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<FromProfileJobData>> | null = null;

  constructor(deps?: FromProfileDeps) {
    this.deps = deps;
    this.graphDb = new ChatDatabaseAdapter() as unknown as OpportunityGraphDatabase & HydeGraphDatabase;
  }

  setRuntimeDeps(runtimeDeps: Pick<FromProfileDeps, 'negotiationGraph' | 'agentDispatcher'>): void {
    this.deps = { ...(this.deps ?? {}), ...runtimeDeps };
  }

  async addJob(
    data: FromProfileJobData,
    options?: { jobId?: string; priority?: number },
  ): Promise<Job<FromProfileJobData>> {
    return this.queue.add('discover_opportunities', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
      jobId: options?.jobId,
      priority: options?.priority,
    });
  }

  async processJob(name: string, data: FromProfileJobData): Promise<void> {
    switch (name) {
      case 'discover_opportunities':
        await this.handleDiscover(data);
        break;
      default:
        this.queueLogger.warn(`[FromProfileQueueProcessor] Unknown job name: ${name}`);
    }
  }

  private async handleDiscover(data: FromProfileJobData): Promise<void> {
    const { userId, networkId } = data;

    this.logger.info('[FromProfile] Starting profile-based discovery', { userId, networkId });

    const invokeOpts = {
      userId: userId as Id<'users'>,
      operationMode: 'create' as const,
      networkId: networkId as Id<'networks'> | undefined,
      options: { initialStatus: 'latent' as const },
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
      this.logger.error('[FromProfile] Graph failed', { userId, networkId, error: result.error });
      throw new Error(typeof result.error === 'string' ? result.error : 'from-profile graph failed');
    }

    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const opportunitiesArr = Array.isArray(result.opportunities) ? result.opportunities : [];

    this.logger.info('[FromProfile] Graph complete', {
      userId,
      networkId,
      candidatesFound: candidates.length,
      opportunitiesCreated: opportunitiesArr.length,
    });
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<FromProfileJobData>) => {
      this.queueLogger.info(`[FromProfileProcessor] Processing job ${job.id}`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<FromProfileJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

export const fromProfileQueue = new FromProfileQueue();
