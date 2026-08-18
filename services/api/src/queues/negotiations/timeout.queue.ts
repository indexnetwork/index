import { createHash } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import type { AskUserExpiryPayload, NegotiationContinuationTimeoutIdentity, NegotiationGraphDatabase } from '@indexnetwork/protocol';

import { QueueFactory } from '../../lib/bullmq/bullmq';
import { log } from '../../lib/log';
import type { ConversationDatabaseAdapter } from '../../adapters/conversation.database.adapter';

import { negotiationMessagesFor, runResumableTimeoutFallback, type NegotiationTaskMeta, type ResumableTimeoutFaultStep, type TimeoutNegotiatorInvoke } from './timeout.shared';
import type { NegotiationTimeoutExecutionStore } from '../../lib/negotiation/timeout-execution';

/** BullMQ queue name for negotiation timeout jobs. */
export const QUEUE_NAME = 'negotiation-timeout';

/** Payload for a negotiation timeout job. */
export interface NegotiationTimeoutJobData {
  negotiationId: string;
  turnNumber: number;
  /** Exact token persisted when this task generation entered waiting_for_agent. */
  parkGeneration: string;
  /** Exact parked continuation attempt/fence, when applicable. */
  continuation?: NegotiationContinuationTimeoutIdentity;
}

function timeoutGenerationKey(generation: string): string {
  return createHash('sha256').update(generation, 'utf8').digest('hex').slice(0, 24);
}

/** Server-only coordinates for an external consultation expiry. */
export interface ExternalAskUserExpiryPayload extends AskUserExpiryPayload {
  claimedByAgentId: string;
}

/** Payload for an ask_user answer-window expiry job (P3.2). */
export interface AskUserExpiryJobData extends AskUserExpiryPayload {
  negotiationId: string;
  /** Server-only external consultation generation. */
  consultationAttemptId?: string;
  /** Exact external claim that armed this attempt. */
  claimedByAgentId?: string;
}

/** Union of job payloads carried on the negotiation-timeout queue. */
export type NegotiationTimeoutQueueJobData = NegotiationTimeoutJobData | AskUserExpiryJobData;

/** Optional deps for testing. */
export interface NegotiationTimeoutQueueDeps {
  database?: NegotiationGraphDatabase;
  queue?: Queue<NegotiationTimeoutQueueJobData>;
  invokeNegotiator?: TimeoutNegotiatorInvoke;
  parkWindowMs?: number;
  now?: () => number;
  /** Test-only crash seam around durable execution boundaries. */
  faultAfterStep?: (step: ResumableTimeoutFaultStep) => void | Promise<void>;
  /** Authoritatively settle the exact stamped question/task cohort. */
  settleInflightExpiry?: (input: AskUserExpiryPayload & {
    taskId: string;
    consultationAttemptId?: string;
    claimedByAgentId?: string;
  }) => Promise<{
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
  async enqueueTimeout(
    negotiationId: string,
    turnNumber: number,
    delayMs: number,
    parkGeneration: string,
    continuation?: NegotiationContinuationTimeoutIdentity,
  ): Promise<string> {
    const jobId = `neg-timeout-${negotiationId}-${timeoutGenerationKey(parkGeneration)}`;

    // Generation-specific IDs make add idempotent. Never remove-and-readd the
    // same generation: a repair must preserve its original absolute deadline.
    const job = await this.queue.add('negotiation_timeout', {
      negotiationId,
      turnNumber,
      parkGeneration,
      ...(continuation ? { continuation } : {}),
    }, {
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
  async cancelTimeout(negotiationId: string, parkGeneration: string): Promise<void> {
    const jobId = `neg-timeout-${negotiationId}-${timeoutGenerationKey(parkGeneration)}`;
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
  async enqueueAskUserExpiry(negotiationId: string, payload: AskUserExpiryPayload, delayMs: number): Promise<string>;
  async enqueueAskUserExpiry(negotiationId: string, consultationAttemptId: string, payload: ExternalAskUserExpiryPayload, delayMs: number): Promise<string>;
  async enqueueAskUserExpiry(
    negotiationId: string,
    attemptOrPayload: string | AskUserExpiryPayload,
    payloadOrDelay: AskUserExpiryPayload | ExternalAskUserExpiryPayload | number,
    maybeDelay?: number,
  ): Promise<string> {
    const consultationAttemptId = typeof attemptOrPayload === 'string' ? attemptOrPayload : undefined;
    const payload = (typeof attemptOrPayload === 'string' ? payloadOrDelay : attemptOrPayload) as AskUserExpiryPayload;
    const delayMs = (typeof attemptOrPayload === 'string' ? maybeDelay : payloadOrDelay) as number;
    const jobId = consultationAttemptId
      ? `neg-askuser-${negotiationId}-${consultationAttemptId}`
      : `neg-askuser-${negotiationId}`;

    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        await existing.remove();
      }
    } catch {
      // Job may not exist, ignore
    }

    const job = await this.queue.add('ask_user_expiry', {
      negotiationId,
      ...(consultationAttemptId ? { consultationAttemptId } : {}),
      ...payload,
    }, {
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
  async cancelAskUserExpiry(negotiationId: string, consultationAttemptId?: string): Promise<void> {
    const jobId = consultationAttemptId
      ? `neg-askuser-${negotiationId}-${consultationAttemptId}`
      : `neg-askuser-${negotiationId}`;
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
    const { negotiationId, turnNumber, parkGeneration, continuation } = data;
    if (typeof parkGeneration !== 'string' || !Number.isInteger(turnNumber)) {
      this.logger.info('Timeout job lacks an exact park generation, skipping', { negotiationId });
      return;
    }
    const database = (
      this.deps?.database
      ?? (await import('../../adapters/database.adapter')).conversationDatabaseAdapter
    ) as NegotiationGraphDatabase & NegotiationTimeoutExecutionStore & Pick<ConversationDatabaseAdapter, 'getTask'>;

    const acquired = await database.acquireWaitingNegotiationTimeoutExecution({
      taskId: negotiationId,
      parkGeneration,
      turnNumber,
      ...(continuation ? { continuation } : {}),
    });
    if (!acquired) {
      this.logger.info('Timeout generation is stale or no longer acquirable', { negotiationId });
      return;
    }
    const meta = acquired.task.metadata as NegotiationTaskMeta | null;
    if (meta?.type !== 'negotiation') {
      this.logger.warn('Task is not a negotiation, skipping', { negotiationId });
      return;
    }
    const messages = await negotiationMessagesFor(database, acquired.task);
    const parkWindowMs = this.deps?.parkWindowMs
      ?? (await import('@indexnetwork/protocol')).AMBIENT_PARK_WINDOW_MS;
    await runResumableTimeoutFallback({
      database,
      acquired,
      logger: this.logger,
      labels: {
        fallback: 'External agent timed out, running AI fallback',
        finalized: 'Negotiation finalized after timeout',
        statusUpdateFailed: 'Failed to update opportunity status on timeout finalization',
      },
      negotiationId,
      meta,
      messages,
      seedReasoning: 'Timeout fallback',
      maxTurns: meta.maxTurns,
      parkWindowMs,
      rearm: async (newTurnCount, nextParkGeneration, delayMs, nextContinuation) => {
        await this.enqueueTimeout(
          negotiationId,
          newTurnCount,
          delayMs,
          nextParkGeneration,
          nextContinuation,
        );
      },
      invokeNegotiator: this.deps?.invokeNegotiator,
      faultAfterStep: this.deps?.faultAfterStep,
      now: this.deps?.now,
    });
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
      ?? (async (input: AskUserExpiryPayload & {
        taskId: string;
        consultationAttemptId?: string;
        claimedByAgentId?: string;
      }) =>
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
