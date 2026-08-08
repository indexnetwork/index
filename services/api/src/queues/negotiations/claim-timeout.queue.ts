import { createHash } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import type { NegotiationContinuationTimeoutIdentity, NegotiationGraphDatabase } from '@indexnetwork/protocol';

import type { ConversationDatabaseAdapter } from '../../adapters/conversation.database.adapter';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { log } from '../../lib/log';
import type { NegotiationTaskMeta, ResumableTimeoutFaultStep, TimeoutNegotiatorInvoke } from './timeout.shared';
import { runResumableTimeoutFallback } from './timeout.shared';
import type { NegotiationTimeoutExecutionStore } from '../../lib/negotiation/timeout-execution';

/** BullMQ queue name for negotiation claim-timeout jobs. */
export const QUEUE_NAME = 'negotiation-claim-timeout';

/** Payload for a negotiation claim-timeout job. */
export interface NegotiationClaimTimeoutJobData {
  negotiationId: string;
  turnNumber: number;
  agentId: string;
  /** Exact claim generation preserved across idempotent pickup repair. */
  claimedAt: string;
  continuation?: NegotiationContinuationTimeoutIdentity;
}

function claimGenerationKey(claimedAt: string): string {
  return createHash('sha256').update(claimedAt, 'utf8').digest('hex').slice(0, 24);
}

export type NegotiationClaimTimeoutDatabase = NegotiationGraphDatabase &
  NegotiationTimeoutExecutionStore & Pick<ConversationDatabaseAdapter, 'getTask'>;

/** Optional deps for testing. */
export interface NegotiationClaimTimeoutQueueDeps {
  database?: NegotiationClaimTimeoutDatabase;
  queue?: Queue<NegotiationClaimTimeoutJobData>;
  invokeNegotiator?: TimeoutNegotiatorInvoke;
  now?: () => number;
  rearm?: (
    negotiationId: string,
    turnNumber: number,
    parkGeneration: string,
    delayMs: number,
    continuation?: NegotiationContinuationTimeoutIdentity,
  ) => Promise<void>;
  /** Test-only crash seam around durable execution boundaries. */
  faultAfterStep?: (step: ResumableTimeoutFaultStep) => void | Promise<void>;
}

/**
 * NegotiationClaimTimeoutQueue: BullMQ queue + worker for handling claimed-but-abandoned negotiation turns.
 *
 * When an external agent claims a negotiation turn via polling but never responds
 * within the remaining park-window budget, the timeout worker runs the AI agent
 * as a fallback for that turn and continues the negotiation evaluation
 * (evaluate -> next turn or finalize).
 *
 * This is distinct from {@link NegotiationTimeoutQueue}, which fires when a turn
 * is never picked up at all. This queue fires after a turn has been claimed but
 * the agent abandoned it without responding. Both queues share the same
 * park-window budget (default {@link AMBIENT_PARK_WINDOW_MS}, 5 minutes) — the
 * remaining budget carries across the waiting_for_agent → claimed transition
 * rather than being re-armed fresh.
 *
 * Workers are started only by the protocol server via {@link NegotiationClaimTimeoutQueue.startWorker}.
 */
export class NegotiationClaimTimeoutQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  private queueInstance: Queue<NegotiationClaimTimeoutJobData> | null = null;

  private readonly logger = log.job.from('NegotiationClaimTimeoutJob');
  private readonly queueLogger = log.queue.from('NegotiationClaimTimeoutQueue');
  private readonly deps: NegotiationClaimTimeoutQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<NegotiationClaimTimeoutJobData>> | null = null;

  constructor(deps?: NegotiationClaimTimeoutQueueDeps) {
    this.deps = deps;
  }

  get queue(): Queue<NegotiationClaimTimeoutJobData> {
    this.queueInstance ??= this.deps?.queue ?? QueueFactory.createQueue<NegotiationClaimTimeoutJobData>(QUEUE_NAME);
    return this.queueInstance;
  }

  /**
   * Enqueue a delayed claim-timeout job for a negotiation.
   *
   * @param negotiationId - The negotiation task ID
   * @param turnNumber - Current turn number (used to detect stale jobs)
   * @param agentId - The agent that claimed the turn
   * @param delayMs - Remaining park-window budget in milliseconds (typically the
   *   value returned by `computeRemainingBudgetMs(parkStart, AMBIENT_PARK_WINDOW_MS)`
   *   — required so callers cannot accidentally fall back to a stale default).
   * @returns The BullMQ job ID
   */
  async enqueueTimeout(
    negotiationId: string,
    turnNumber: number,
    agentId: string,
    claimedAt: string,
    delayMs: number,
    continuation?: NegotiationContinuationTimeoutIdentity,
  ): Promise<string> {
    const jobId = `neg-claim-timeout-${negotiationId}-${claimGenerationKey(claimedAt)}`;

    // Generation-specific IDs make exact pickup repair an idempotent add. Do
    // not remove an existing generation: that would extend its deadline.
    const job = await this.queue.add('negotiation_claim_timeout', {
      negotiationId,
      turnNumber,
      agentId,
      claimedAt,
      ...(continuation ? { continuation } : {}),
    }, {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });

    this.logger.info('Claim timeout enqueued', {
      negotiationId,
      turnNumber,
      agentId,
      delayMs,
      jobId: job.id,
    });
    return job.id ?? jobId;
  }

  /**
   * Cancel a pending claim-timeout job for a negotiation.
   *
   * @param negotiationId - The negotiation task ID
   */
  async cancelTimeout(negotiationId: string, claimedAt: string): Promise<void> {
    const jobId = `neg-claim-timeout-${negotiationId}-${claimGenerationKey(claimedAt)}`;
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
          await job.remove();
          this.logger.info('Claim timeout cancelled', { negotiationId, jobId });
        }
      }
    } catch (err) {
      this.logger.warn('Failed to cancel claim timeout', {
        negotiationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Process a claim-timeout job. Exported for testing.
   *
   * @param name - The BullMQ job name
   * @param data - The job payload
   */
  async processJob(name: string, data: NegotiationClaimTimeoutJobData): Promise<void> {
    switch (name) {
      case 'negotiation_claim_timeout':
        await this.handleClaimTimeout(data);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  /**
   * Start the BullMQ worker. Idempotent.
   */
  startWorker(): void {
    if (this.worker) return;

    const processor = async (job: Job<NegotiationClaimTimeoutJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };

    this.worker = QueueFactory.createWorker<NegotiationClaimTimeoutJobData>(QUEUE_NAME, processor);
  }

  /**
   * Gracefully close worker and queue.
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queueInstance) {
      await this.queueInstance.close();
      this.queueInstance = null;
    }
  }

  /**
   * Handle a negotiation claim timeout: an agent claimed the turn but never responded.
   * Run the AI agent as a fallback for the abandoned turn.
   */
  private async handleClaimTimeout(data: NegotiationClaimTimeoutJobData): Promise<void> {
    const { negotiationId, turnNumber, agentId, claimedAt, continuation } = data;
    const claimedAtDate = new Date(claimedAt);
    if (!Number.isInteger(turnNumber) || !Number.isFinite(claimedAtDate.getTime())) {
      this.logger.info('Claim timeout job lacks an exact claim generation, skipping', { negotiationId });
      return;
    }
    const database = this.deps?.database ??
      (await import('../../adapters/database.adapter')).conversationDatabaseAdapter;

    // Claim generation, continuation identity, turn cardinality, and the
    // durable pending execution are one adapter transaction. A matching
    // working+pending/invoked row is resumable on Bull redelivery.
    const acquired = await database.acquireClaimedNegotiationTimeoutExecution({
      taskId: negotiationId,
      claimedByAgentId: agentId,
      claimedAt: claimedAtDate,
      turnNumber,
      ...(continuation ? { continuation } : {}),
    });

    if (!acquired) {
      this.logger.info('Claim timeout generation is stale or no longer acquirable', { negotiationId });
      return;
    }
    const meta = acquired.task.metadata as NegotiationTaskMeta | null;
    if (meta?.type !== 'negotiation') {
      this.logger.warn('Task is not a negotiation, skipping', { negotiationId });
      return;
    }
    const messages = await database.getMessagesForConversation(acquired.task.conversationId);
    const { AMBIENT_PARK_WINDOW_MS } = await import('@indexnetwork/protocol');
    await runResumableTimeoutFallback({
      database,
      acquired,
      logger: this.logger,
      labels: {
        fallback: 'Claimed agent timed out, running AI fallback',
        finalized: 'Negotiation finalized after claim timeout',
        statusUpdateFailed: 'Failed to update opportunity status on claim-timeout finalization',
      },
      negotiationId,
      meta,
      messages,
      seedReasoning: 'Claim timeout fallback',
      maxTurns: meta.maxTurns,
      parkWindowMs: AMBIENT_PARK_WINDOW_MS,
      fallbackLogExtra: { agentId },
      invokeNegotiator: this.deps?.invokeNegotiator,
      rearm: async (newTurnCount, parkGeneration, delayMs, nextContinuation) => {
        if (this.deps?.rearm) {
          await this.deps.rearm(negotiationId, newTurnCount, parkGeneration, delayMs, nextContinuation);
          return;
        }
        const { negotiationTimeoutQueue } = await import('./timeout.queue');
        await negotiationTimeoutQueue.enqueueTimeout(
          negotiationId,
          newTurnCount,
          delayMs,
          parkGeneration,
          nextContinuation,
        );
      },
      faultAfterStep: this.deps?.faultAfterStep,
      now: this.deps?.now,
    });
  }
}

/** Singleton negotiation claim-timeout queue instance. */
export const negotiationClaimTimeoutQueue = new NegotiationClaimTimeoutQueue();
