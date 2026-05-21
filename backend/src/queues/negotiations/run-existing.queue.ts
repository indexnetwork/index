// backend/src/queues/negotiations/run-existing.queue.ts
import { Job } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import type { Id } from '../../types/common.types';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { OpportunityGraphFactory } from '@indexnetwork/protocol';
import type { OpportunityGraphDatabase, HydeGraphDatabase, Embedder, NegotiationGraphLike, AgentDispatcher } from '@indexnetwork/protocol';

export const QUEUE_NAME = 'negotiation-run-existing';

export interface RunExistingJobData {
  opportunityId: string;
  userId: string;
}

export interface RunExistingGraphInvokeOptions {
  userId: string;
  operationMode: 'negotiate_existing';
  opportunityId: string;
  options: Record<string, unknown>;
}

export interface RunExistingDeps {
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasPersonalAgent'>;
  invokeOpportunityGraph?: (opts: RunExistingGraphInvokeOptions) => Promise<void>;
}

export class NegotiationRunExistingQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<RunExistingJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('RunExistingJob');
  private readonly queueLogger = log.queue.from('RunExistingQueue');
  private readonly database = new ChatDatabaseAdapter();
  private readonly graphDb: OpportunityGraphDatabase & HydeGraphDatabase;
  private deps: RunExistingDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<RunExistingJobData>> | null = null;

  constructor(deps?: RunExistingDeps) {
    this.deps = deps;
    this.graphDb = this.database as unknown as OpportunityGraphDatabase & HydeGraphDatabase;
  }

  setRuntimeDeps(runtimeDeps: RunExistingDeps): void {
    this.deps = { ...(this.deps ?? {}), ...runtimeDeps };
  }

  async addJob(data: RunExistingJobData): Promise<Job<RunExistingJobData>> {
    return this.queue.add('negotiate_existing', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
    });
  }

  async processJob(name: string, data: RunExistingJobData): Promise<void> {
    switch (name) {
      case 'negotiate_existing':
        await this.handleNegotiate(data);
        break;
      default:
        this.queueLogger.warn(`[RunExistingQueueProcessor] Unknown job name: ${name}`);
    }
  }

  private async handleNegotiate(data: RunExistingJobData): Promise<void> {
    const { opportunityId, userId } = data;

    if (!opportunityId) {
      this.logger.warn('[RunExisting] Missing opportunityId, skipping', { userId });
      return;
    }

    this.logger.info('[RunExisting] Starting negotiation', { opportunityId, userId });

    if (this.deps?.invokeOpportunityGraph) {
      await this.deps.invokeOpportunityGraph({
        userId,
        operationMode: 'negotiate_existing',
        opportunityId,
        options: {},
      });
      this.logger.info('[RunExisting] Negotiation complete', { opportunityId, userId });
      return;
    }

    const embedder: Embedder = new EmbedderAdapter();
    const hydeGraph = { invoke: async () => ({ hydeEmbeddings: {} }) };

    const opportunityGraph = new OpportunityGraphFactory(
      this.graphDb,
      embedder,
      hydeGraph,
      undefined,
      undefined,
      this.deps?.negotiationGraph,
      this.deps?.agentDispatcher,
      async (oid: string, uid: string) => {
        await this.addJob({ opportunityId: oid, userId: uid });
      },
    ).createGraph();

    try {
      await opportunityGraph.invoke({
        userId: userId as Id<'users'>,
        operationMode: 'negotiate_existing',
        opportunityId,
        options: {},
      });
      this.logger.info('[RunExisting] Negotiation complete', { opportunityId, userId });
    } catch (err) {
      this.logger.error('[RunExisting] Graph failed', { opportunityId, userId, error: err });
      throw err;
    }
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<RunExistingJobData>) => {
      this.queueLogger.info(`[RunExistingProcessor] Processing job ${job.id}`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<RunExistingJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

export const negotiationRunExistingQueue = new NegotiationRunExistingQueue();
