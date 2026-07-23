import type { Job, Queue } from 'bullmq';
import type { AskUserExpiryPayload, NegotiationGraphDatabase } from '@indexnetwork/protocol';

import { QueueFactory } from '../../lib/bullmq/bullmq';
import { log } from '../../lib/log';
import { claimParkedContinuationExecution, completeContinuationExecution, parkContinuationExecution } from '../../adapters/negotiation-continuation.atomic';
import type { ConversationDatabaseAdapter } from '../../adapters/conversation.database.adapter';

import { runTimeoutFallback, type NegotiationTaskMeta, type TimeoutNegotiatorInvoke } from './timeout.shared';

/** BullMQ queue name for negotiation timeout jobs. */
export const QUEUE_NAME = 'negotiation-timeout';

/** Payload for a negotiation timeout job. */
export interface NegotiationTimeoutJobData {
  negotiationId: string;
  turnNumber: number;
}

/** Payload for an ask_user answer-window expiry job (P3.2). */
export interface AskUserExpiryJobData extends AskUserExpiryPayload {
  negotiationId: string;
}

/** Union of job payloads carried on the negotiation-timeout queue. */
export type NegotiationTimeoutQueueJobData = NegotiationTimeoutJobData | AskUserExpiryJobData;

/** Optional deps for testing. */
export interface NegotiationTimeoutQueueDeps {
  database?: NegotiationGraphDatabase;
  queue?: Queue<NegotiationTimeoutQueueJobData>;
  invokeNegotiator?: TimeoutNegotiatorInvoke;
  parkWindowMs?: number;
  /** Authoritatively settle the exact stamped question/task cohort. */
  settleInflightExpiry?: (input: AskUserExpiryPayload & { taskId: string }) => Promise<{
    taskId: string;
    settlementId: string;
    opportunityId: string;
    userId: string;
    recipientIntentId: string;
    networkId: string;
  } | null>;
  /** Enqueue the exact durable resume continuation after an expiry. */
  enqueueResume?: (input: {
    taskId: string;
    settlementId: string;
    opportunityId: string;
    userId: string;
    recipientIntentId: string;
    networkId: string;
  }) => Promise<void>;
}

/**
 * NegotiationTimeoutQueue: BullMQ queue + worker for handling negotiation timeouts.
 *
 * When an external agent doesn't respond within the park-window budget (the
 * dispatcher-provided `timeoutMs`, currently `AMBIENT_PARK_WINDOW_MS` / 5 min
 * for the ambient trigger), the timeout worker runs the AI agent for that turn
 * and continues the negotiation evaluation (evaluate -> next turn or finalize).
 * If the AI counter-responds, the re-arm path uses `AMBIENT_PARK_WINDOW_MS`
 * again for the next speaker.
 *
 * Workers are started only by the protocol server via {@link NegotiationTimeoutQueue.startWorker}.
 */
export class NegotiationTimeoutQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  private queueInstance: Queue<NegotiationTimeoutQueueJobData> | null = null;

  private readonly logger = log.job.from('NegotiationTimeoutJob');
  private readonly queueLogger = log.queue.from('NegotiationTimeoutQueue');
  private readonly deps: NegotiationTimeoutQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<NegotiationTimeoutQueueJobData>> | null = null;

  constructor(deps?: NegotiationTimeoutQueueDeps) {
    this.deps = deps;
  }

  get queue(): Queue<NegotiationTimeoutQueueJobData> {
    this.queueInstance ??=
      this.deps?.queue ?? QueueFactory.createQueue<NegotiationTimeoutQueueJobData>(QUEUE_NAME);
    return this.queueInstance;
  }

  /**
   * Enqueue a delayed timeout job for a negotiation.
   *
   * @param negotiationId - The negotiation task ID
   * @param turnNumber - Current turn number (used to detect stale jobs)
   * @param delayMs - Delay in milliseconds before the timeout fires
   * @returns The BullMQ job ID
   */
  async enqueueTimeout(negotiationId: string, turnNumber: number, delayMs: number): Promise<string> {
    const jobId = `neg-timeout-${negotiationId}`;

    // Remove any existing timeout job for this negotiation before adding a new one
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        await existing.remove();
      }
    } catch {
      // Job may not exist, ignore
    }

    const job = await this.queue.add('negotiation_timeout', { negotiationId, turnNumber }, {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });

    this.logger.info('Timeout enqueued', { negotiationId, turnNumber, delayMs, jobId: job.id });
    return job.id ?? jobId;
  }

  /**
   * Cancel a pending timeout job for a negotiation.
   *
   * @param negotiationId - The negotiation task ID
   */
  async cancelTimeout(negotiationId: string): Promise<void> {
    const jobId = `neg-timeout-${negotiationId}`;
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
          await job.remove();
          this.logger.info('Timeout cancelled', { negotiationId, jobId });
        }
      }
    } catch (err) {
      this.logger.warn('Failed to cancel timeout', {
        negotiationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Arm the answer-window timer for an `ask_user` pause (P3.2). Delayed job
   * on this same queue under its own jobId namespace — it never collides with
   * the park-window timer for the same negotiation.
   */
  async enqueueAskUserExpiry(negotiationId: string, payload: AskUserExpiryPayload, delayMs: number): Promise<string> {
    const jobId = `neg-askuser-${negotiationId}`;

    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        await existing.remove();
      }
    } catch {
      // Job may not exist, ignore
    }

    const job = await this.queue.add('ask_user_expiry', { negotiationId, ...payload }, {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });

    this.logger.info('Ask-user expiry armed', { negotiationId, delayMs, jobId: job.id });
    return job.id ?? jobId;
  }

  /**
   * Cancel a pending ask_user answer-window timer (client answered in time).
   */
  async cancelAskUserExpiry(negotiationId: string): Promise<void> {
    const jobId = `neg-askuser-${negotiationId}`;
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
          await job.remove();
          this.logger.info('Ask-user expiry cancelled', { negotiationId, jobId });
        }
      }
    } catch (err) {
      this.logger.warn('Failed to cancel ask-user expiry', {
        negotiationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Process a timeout job. Exported for testing.
   */
  async processJob(name: string, data: NegotiationTimeoutQueueJobData): Promise<void> {
    switch (name) {
      case 'negotiation_timeout':
        await this.handleTimeout(data as NegotiationTimeoutJobData);
        break;
      case 'ask_user_expiry':
        await this.handleAskUserExpiry(data as AskUserExpiryJobData);
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

    const processor = async (job: Job<NegotiationTimeoutQueueJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };

    this.worker = QueueFactory.createWorker<NegotiationTimeoutQueueJobData>(QUEUE_NAME, processor);
  }

  /**
   * Gracefully close worker and queue.
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  /**
   * Handle a negotiation timeout: run the AI agent for the stalled turn.
   */
  private async handleTimeout(data: NegotiationTimeoutJobData): Promise<void> {
    const { negotiationId, turnNumber } = data;
    const database = (
      this.deps?.database
      ?? (await import('../../adapters/database.adapter')).conversationDatabaseAdapter
    ) as NegotiationGraphDatabase & Pick<ConversationDatabaseAdapter, 'transitionClaimedTaskToWorking'>;

    // Load the negotiation task
    const task = await database.getTask(negotiationId);
    if (!task) {
      this.logger.warn('Task not found, skipping', { negotiationId });
      return;
    }

    // Only process if still waiting_for_agent and turn matches
    if (task.state !== 'waiting_for_agent') {
      this.logger.info('Task no longer waiting, skipping (stale job)', {
        negotiationId,
        currentState: task.state,
      });
      return;
    }

    const meta = task.metadata as NegotiationTaskMeta & { continuationExecution?: { status?: unknown } } | null;
    if (meta?.type !== 'negotiation') {
      this.logger.warn('Task is not a negotiation, skipping', { negotiationId });
      return;
    }

    // A parked exact continuation must acquire a fresh token/fence before the
    // timeout path can transition or write anything.
    const parked = meta.continuationExecution?.status === 'parked';
    // Keep provider-free queue tests free of Drizzle initialization. Production
    // only loads the database singleton after durable metadata proves this is a
    // fenced parked continuation.
    const continuationDb = parked
      ? (await import('../../lib/drizzle/drizzle')).default
      : null;
    const claimedContinuation = parked && continuationDb
      ? await claimParkedContinuationExecution(continuationDb, task.id, 'system:negotiation-timeout')
      : null;
    if (parked && !claimedContinuation) return;
    const effectiveTask = claimedContinuation
      ? await database.transitionClaimedTaskToWorking(task.id, claimedContinuation.execution)
      : task;
    if (!effectiveTask) return;
    const execution = claimedContinuation?.execution;
    const messages = await database.getMessagesForConversation(effectiveTask.conversationId);
    const currentTurnCount = messages.length;

    if (currentTurnCount !== turnNumber) {
      this.logger.info('Turn count mismatch, skipping (stale job)', {
        negotiationId, expectedTurn: turnNumber, actualTurn: currentTurnCount,
      });
      return;
    }

    const result = await runTimeoutFallback({
      database,
      logger: this.logger,
      labels: {
        fallback: 'External agent timed out, running AI fallback',
        finalized: 'Negotiation finalized after timeout',
        statusUpdateFailed: 'Failed to update opportunity status on timeout finalization',
      },
      negotiationId,
      taskId: effectiveTask.id,
      conversationId: effectiveTask.conversationId,
      meta,
      messages,
      currentTurnCount,
      seedReasoning: 'Timeout fallback',
      maxTurns: 6,
      rearm: async (newTurnCount) => {
        const parkWindowMs =
          this.deps?.parkWindowMs
          ?? (await import('@indexnetwork/protocol')).AMBIENT_PARK_WINDOW_MS;
        await this.enqueueTimeout(negotiationId, newTurnCount, parkWindowMs);
      },
      invokeNegotiator: this.deps?.invokeNegotiator,
      ...(execution ? { continuationExecution: execution } : {}),
    });
    if (execution && result.continuationOutcome) {
      if (!continuationDb) throw new Error('Continuation database unavailable after fenced timeout claim');
      if (result.continuationOutcome === 'waiting_for_agent') await parkContinuationExecution(continuationDb, execution);
      else await completeContinuationExecution(continuationDb, execution, {
        priorTaskId: execution.taskId, settlementId: execution.settlementId,
        successorTaskId: execution.successorTaskId, fence: execution.fence,
        outcome: result.continuationOutcome,
      });
    }
  }

  /**
   * Handle an ask_user answer-window expiry (P3.2): the client never answered.
   * Resume the negotiation with the conservative default — do not disclose —
   * recorded as a synthetic user answer so the resuming negotiator sees the
   * non-answer in its context. No-ops when the task already left
   * `input_required` (the answer arrived and the resume path won the race, or
   * the negotiation terminated another way).
   */
  private async handleAskUserExpiry(data: AskUserExpiryJobData): Promise<void> {
    const { negotiationId, ...coordinates } = data;
    const { opportunityId } = coordinates;
    const settle = this.deps?.settleInflightExpiry
      ?? (async (input: AskUserExpiryPayload & { taskId: string }) =>
        (await import('../../adapters/questioner.adapter.instance')).questionerAdapter.expireInflightQuestion(input));
    const claim = await settle({ taskId: negotiationId, ...coordinates });
    if (!claim) {
      this.logger.info('Ask-user expiry lost or stale; no continuation enqueued', {
        negotiationId,
        opportunityId,
      });
      return;
    }
    // Content-free funnel telemetry: a winner is the sole exact task that
    // timed out, so duplicate/stale deliveries never inflate this stage.
    this.logger.info('negotiation_consultation_policy', { stage: 'timed_out' });
    const enqueueResume = this.deps?.enqueueResume
      ?? (async (input: NonNullable<typeof claim>) => {
        const { negotiationRunExistingQueue } = await import('./run-existing.queue');
        await negotiationRunExistingQueue.addJob(input);
      });
    await enqueueResume(claim);
    this.logger.info('negotiation_consultation_policy', { stage: 'resumed' });
    this.logger.info('Ask-user window expired; exact task resumed with conservative default', claim);
  }
}

/** Singleton negotiation timeout queue instance. */
export const negotiationTimeoutQueue = new NegotiationTimeoutQueue();
