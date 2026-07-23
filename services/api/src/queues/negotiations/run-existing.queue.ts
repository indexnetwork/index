// services/api/src/queues/negotiations/run-existing.queue.ts
import { Job } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import type { Id } from '../../types/common.types';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import type { QuestionerAdapter } from '../../adapters/questioner.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { OpportunityGraphFactory } from '@indexnetwork/protocol';
import type { OpportunityGraphDatabase, HydeGraphDatabase, Embedder, NegotiationGraphLike, AgentDispatcher } from '@indexnetwork/protocol';

export const QUEUE_NAME = 'negotiation-run-existing';

export interface RunExistingJobData {
  opportunityId: string;
  userId: string;
  /** Exact durable consultation settlement; all four fields are all-or-none. */
  taskId?: string;
  settlementId?: string;
  recipientIntentId?: string;
  networkId?: string;
}

export interface RunExistingGraphInvokeOptions {
  userId: string;
  operationMode: 'negotiate_existing';
  opportunityId: string;
  options: Record<string, unknown>;
}

type ContinuationAdapter = Pick<
  QuestionerAdapter,
  'getNegotiationContinuationRequest' | 'markNegotiationContinuationCompleted'
>;

export interface RunExistingDeps {
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
  invokeOpportunityGraph?: (opts: RunExistingGraphInvokeOptions) => Promise<void>;
  continuationAdapter?: ContinuationAdapter;
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
    const exactFields = [data.taskId, data.settlementId, data.recipientIntentId, data.networkId];
    const exactCount = exactFields.filter((value) => typeof value === 'string' && value.length > 0).length;
    if (exactCount !== 0 && exactCount !== exactFields.length) {
      throw new Error('Exact negotiation continuation fields must be all-or-none');
    }
    const deterministicJobId = data.settlementId
      ? `negotiation-resume-${data.settlementId}`
      : undefined;
    if (deterministicJobId) {
      const existing = await this.queue.getJob(deterministicJobId);
      if (existing) {
        if (await existing.getState() === 'failed') await existing.retry();
        return existing;
      }
    }
    return this.queue.add('negotiate_existing', data, {
      ...(deterministicJobId ? { jobId: deterministicJobId } : {}),
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
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  private async handleNegotiate(data: RunExistingJobData): Promise<void> {
    const { opportunityId, userId } = data;

    if (!opportunityId) {
      this.logger.warn('Missing opportunityId, skipping', { userId });
      return;
    }

    const exact = data.taskId && data.settlementId && data.recipientIntentId && data.networkId
      ? {
          taskId: data.taskId,
          settlementId: data.settlementId,
          recipientIntentId: data.recipientIntentId,
          networkId: data.networkId,
        }
      : null;
    const continuationAdapter = exact ? await this.getContinuationAdapter() : null;
    if (exact && continuationAdapter) {
      const admission = await continuationAdapter.getNegotiationContinuationRequest({
        ...exact,
        opportunityId,
        userId,
      });
      if (admission === 'invalid' || admission === 'completed') {
        this.logger.info('Exact negotiation continuation skipped', {
          taskId: exact.taskId,
          settlementId: exact.settlementId,
          admission,
        });
        return;
      }
    }

    this.logger.info('Starting negotiation', { opportunityId, userId, taskId: exact?.taskId });
    const options = exact ? { negotiationContinuation: exact } : {};

    if (this.deps?.invokeOpportunityGraph) {
      await this.deps.invokeOpportunityGraph({
        userId,
        operationMode: 'negotiate_existing',
        opportunityId,
        options,
      });
      if (exact && continuationAdapter) {
        await continuationAdapter.markNegotiationContinuationCompleted({ ...exact, opportunityId, userId });
      }
      this.logger.info('Negotiation complete', { opportunityId, userId, taskId: exact?.taskId });
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
        options,
      });
      if (exact && continuationAdapter) {
        await continuationAdapter.markNegotiationContinuationCompleted({ ...exact, opportunityId, userId });
      }
      this.logger.info('Negotiation complete', { opportunityId, userId, taskId: exact?.taskId });
    } catch (err) {
      this.logger.error('Graph failed', { opportunityId, userId, taskId: exact?.taskId, error: err });
      throw err;
    }
  }

  private async getContinuationAdapter(): Promise<ContinuationAdapter> {
    if (this.deps?.continuationAdapter) return this.deps.continuationAdapter;
    return (await import('../../adapters/questioner.adapter.instance')).questionerAdapter;
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<RunExistingJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id });
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
