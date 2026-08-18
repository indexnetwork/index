// services/api/src/queues/negotiations/run-existing.queue.ts
import { Job } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import type { Id } from '../../types/common.types';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import type { QuestionerAdapter } from '../../adapters/questioner.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { OpportunityGraphFactory } from '@indexnetwork/protocol';
import type { OpportunityGraphDatabase, HydeGraphDatabase, Embedder, NegotiationGraphLike, AgentDispatcher, NegotiationContinuationExecution, NegotiationContinuationReceipt } from '@indexnetwork/protocol';

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
  | 'claimNegotiationContinuationExecution'
  | 'heartbeatNegotiationContinuationExecution'
  | 'releaseNegotiationContinuationExecution'
  | 'parkNegotiationContinuationExecution'
  | 'completeNegotiationContinuationExecution'
>;

export interface RunExistingDeps {
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
  invokeOpportunityGraph?: (opts: RunExistingGraphInvokeOptions) => Promise<{
    negotiationContinuationReceipt?: NegotiationContinuationReceipt;
  } | void>;
  continuationAdapter?: ContinuationAdapter;
  /** Stopgap seams (see handleContinuationStalled); production resolves the real collaborators lazily. */
  classifyPostStallPark?: (input: { opportunityId: string; userId: string }) => Promise<{ kind: string }>;
  enqueueQuestionMessageRegeneration?: (data: { userId: string; intentId: string }) => Promise<unknown>;
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
        const state = await existing.getState();
        if (state === 'failed') {
          await existing.retry();
          return existing;
        }
        if (state === 'completed') await existing.remove();
        else return existing;
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
    const claim = exact && continuationAdapter
      ? await continuationAdapter.claimNegotiationContinuationExecution({
          ...exact,
          opportunityId,
          userId,
        })
      : null;
    if (claim && claim.status !== 'claimed') {
      this.logger.info('Exact negotiation continuation skipped', {
        taskId: exact?.taskId,
        settlementId: exact?.settlementId,
        admission: claim.status,
      });
      return;
    }
    const execution = claim?.status === 'claimed' ? claim.execution : undefined;
    if (execution && claim?.existingReceipt && continuationAdapter) {
      await continuationAdapter.completeNegotiationContinuationExecution(execution, claim.existingReceipt);
      return;
    }

    this.logger.info('Starting negotiation', { opportunityId, userId, taskId: exact?.taskId, fence: execution?.fence });
    const options = execution ? { negotiationContinuation: execution } : {};

    if (this.deps?.invokeOpportunityGraph) {
      const receipt = await this.runClaimedContinuation(execution, continuationAdapter, async () => {
        const result = await this.deps!.invokeOpportunityGraph!({
          userId,
          operationMode: 'negotiate_existing',
          opportunityId,
          options,
        });
        return result?.negotiationContinuationReceipt;
      });
      this.logger.info('Negotiation complete', { opportunityId, userId, taskId: exact?.taskId, fence: execution?.fence });
      if (execution && exact && receipt?.outcome === 'stalled') {
        await this.handleContinuationStalled(data, exact.recipientIntentId);
      }
      return;
    }

    const embedder: Embedder = new EmbedderAdapter();
    const hydeGraph = { invoke: async () => ({ hydeEmbeddings: {} }) };

    const opportunityOperations = new OpportunityGraphFactory(
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
    );

    try {
      const receipt = await this.runClaimedContinuation(execution, continuationAdapter, async () => {
        const result = await opportunityOperations.negotiateExisting({
          userId: userId as Id<'users'>,
          opportunityId,
          ...(options.negotiationContinuation ? { continuation: options.negotiationContinuation } : {}),
        });
        return result.negotiationContinuationReceipt;
      });
      this.logger.info('Negotiation complete', { opportunityId, userId, taskId: exact?.taskId, fence: execution?.fence });
      if (execution && exact && receipt?.outcome === 'stalled') {
        await this.handleContinuationStalled(data, exact.recipientIntentId);
      }
    } catch (err) {
      this.logger.error('Graph failed', { opportunityId, userId, taskId: exact?.taskId, fence: execution?.fence, error: err });
      throw err;
    }
  }

  /**
   * STOPGAP (conversational-questions, docs/plans/2026-08-18): finalize skips
   * its `stalled_followup` questioner enqueue for continuation executions
   * (`!state.continuationExecution`), so a negotiation that resumed from a
   * client's answer and re-parked post-stall would sit invisible — no
   * question-message regeneration would ever fire for it. Until the
   * exhaustion evaluator owns this trigger on negotiation state transitions,
   * detect the narrow case here: a continuation whose terminal receipt is
   * 'stalled' AND whose negotiation re-resolved to a post-stall park on this
   * user's side enqueues the regeneration job for the answered signal's
   * scope. Best-effort: the park itself is durable, and a failure here must
   * not fail a negotiation that completed.
   */
  private async handleContinuationStalled(data: RunExistingJobData, recipientIntentId: string): Promise<void> {
    try {
      const classify = this.deps?.classifyPostStallPark
        ?? (async (input: { opportunityId: string; userId: string }) => {
          const { classifyParkedNegotiation } = await import('@indexnetwork/protocol');
          return classifyParkedNegotiation(this.database, input);
        });
      const classification = await classify({ opportunityId: data.opportunityId, userId: data.userId });
      if (classification.kind !== 'post_stall') return;
      const enqueue = this.deps?.enqueueQuestionMessageRegeneration
        ?? (async (target: { userId: string; intentId: string }) => {
          const { questionMessageQueue } = await import('../question-message.queue');
          return questionMessageQueue.addRegenerateJob(target);
        });
      await enqueue({ userId: data.userId, intentId: recipientIntentId });
      this.logger.info('continuation_repark_question_message_enqueued', {
        opportunityId: data.opportunityId,
        userId: data.userId,
        intentId: recipientIntentId,
      });
    } catch (err) {
      this.logger.error('Failed to enqueue question-message regeneration for a re-parked continuation', {
        opportunityId: data.opportunityId,
        userId: data.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async runClaimedContinuation(
    execution: NegotiationContinuationExecution | undefined,
    continuationAdapter: ContinuationAdapter | null,
    invoke: () => Promise<NegotiationContinuationReceipt | undefined>,
  ): Promise<NegotiationContinuationReceipt | undefined> {
    if (!execution || !continuationAdapter) {
      return invoke();
    }
    let currentExecution = execution;
    let heartbeatFailure: unknown;
    let heartbeatInFlight: Promise<void> = Promise.resolve();
    const timer = setInterval(() => {
      heartbeatInFlight = heartbeatInFlight.then(async () => {
        if (heartbeatFailure) return;
        try {
          currentExecution = await continuationAdapter.heartbeatNegotiationContinuationExecution(currentExecution);
        } catch (err) {
          heartbeatFailure = err;
        }
      });
    }, 15_000);
    timer.unref?.();
    try {
      const receipt = await invoke();
      clearInterval(timer);
      await heartbeatInFlight;
      if (heartbeatFailure) throw heartbeatFailure;
      if (!receipt) throw new Error('Exact negotiation continuation produced no positive successor receipt');
      // A pause retains the fence for the eventual polling/timeout path; it
      // is deliberately not a terminal receipt for the parent settlement.
      if (receipt.outcome === 'waiting_for_agent' || receipt.outcome === 'input_required') {
        await continuationAdapter.parkNegotiationContinuationExecution(currentExecution);
        return receipt;
      }
      await continuationAdapter.completeNegotiationContinuationExecution(currentExecution, receipt);
      return receipt;
    } catch (err) {
      clearInterval(timer);
      await heartbeatInFlight.catch(() => undefined);
      await continuationAdapter.releaseNegotiationContinuationExecution(currentExecution).catch(() => undefined);
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
