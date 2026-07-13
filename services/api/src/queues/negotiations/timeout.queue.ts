import { Job } from 'bullmq';
import { eq, and, sql } from 'drizzle-orm/sql';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import db from '../../lib/drizzle/drizzle';
import { questions } from '../../schemas/database.schema';
import { conversationDatabaseAdapter, ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { AMBIENT_PARK_WINDOW_MS } from '@indexnetwork/protocol';
import type { NegotiationGraphDatabase, AskUserExpiryPayload } from '@indexnetwork/protocol';

import { runTimeoutFallback, type NegotiationTaskMeta } from './timeout.shared';

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
  /** Append a synthetic conservative answer to opportunity metadata (ask_user expiry). */
  storeExpiryAnswer?: (opportunityId: string, disclosureSubject: string) => Promise<void>;
  /** Dismiss pending negotiation_inflight question rows for an opportunity. */
  dismissInflightQuestions?: (opportunityId: string) => Promise<void>;
  /** Enqueue the resume continuation after an expiry. */
  enqueueResume?: (opportunityId: string, userId: string) => Promise<void>;
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

  readonly queue = QueueFactory.createQueue<NegotiationTimeoutQueueJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('NegotiationTimeoutJob');
  private readonly queueLogger = log.queue.from('NegotiationTimeoutQueue');
  private readonly deps: NegotiationTimeoutQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<NegotiationTimeoutQueueJobData>> | null = null;

  constructor(deps?: NegotiationTimeoutQueueDeps) {
    this.deps = deps;
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
    const database = this.deps?.database ?? conversationDatabaseAdapter;

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

    const messages = await database.getMessagesForConversation(task.conversationId);
    const currentTurnCount = messages.length;

    // Check if turnNumber still matches (response may have come in between)
    if (currentTurnCount !== turnNumber) {
      this.logger.info('Turn count mismatch, skipping (stale job)', {
        negotiationId,
        expectedTurn: turnNumber,
        actualTurn: currentTurnCount,
      });
      return;
    }

    const meta = task.metadata as NegotiationTaskMeta | null;
    if (meta?.type !== 'negotiation') {
      this.logger.warn('Task is not a negotiation, skipping', { negotiationId });
      return;
    }

    await runTimeoutFallback({
      database,
      logger: this.logger,
      labels: {
        fallback: 'External agent timed out, running AI fallback',
        finalized: 'Negotiation finalized after timeout',
        statusUpdateFailed: 'Failed to update opportunity status on timeout finalization',
      },
      negotiationId,
      taskId: task.id,
      conversationId: task.conversationId,
      meta,
      messages,
      currentTurnCount,
      seedReasoning: 'Timeout fallback',
      maxTurns: 6,
      rearm: async (newTurnCount) => {
        await this.enqueueTimeout(negotiationId, newTurnCount, AMBIENT_PARK_WINDOW_MS);
      },
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
    const { negotiationId, opportunityId, userId, disclosureSubject } = data;
    const database = this.deps?.database ?? conversationDatabaseAdapter;

    const task = await database.getTask(negotiationId);
    if (!task) {
      this.logger.warn('Task not found, skipping ask-user expiry', { negotiationId });
      return;
    }
    if (task.state !== 'input_required') {
      this.logger.info('Task no longer input_required, skipping ask-user expiry (stale job)', {
        negotiationId,
        currentState: task.state,
      });
      return;
    }

    // 1. Record the conservative default as a synthetic answer on the
    //    opportunity so the resuming session's userAnswers context carries it.
    const storeExpiryAnswer = this.deps?.storeExpiryAnswer ?? defaultStoreExpiryAnswer;
    await storeExpiryAnswer(opportunityId, disclosureSubject).catch((err) => {
      this.logger.error('Failed to store conservative expiry answer', { negotiationId, opportunityId, error: err });
    });

    // 2. Dismiss the now-moot pending question row(s) so the inbox stops asking.
    const dismissInflight = this.deps?.dismissInflightQuestions ?? defaultDismissInflightQuestions;
    await dismissInflight(opportunityId).catch((err) => {
      this.logger.warn('Failed to dismiss expired inflight questions', { opportunityId, error: err });
    });

    // 3. Terminally close the paused task — the resume session creates a fresh
    //    task that inherits seat + protocol version from this one's metadata.
    await database.updateTaskState(negotiationId, 'canceled', { reason: 'ask_user_window_expired' });

    // 4. Resume via the existing continuation path. Lazy import: keeps this
    //    module free of a static run-existing dependency (circular-import and
    //    barrel-mock hazard — run-existing pulls OpportunityGraphFactory from
    //    the protocol barrel at module scope).
    const enqueueResume = this.deps?.enqueueResume
      ?? (async (oid: string, uid: string) => {
        const { negotiationRunExistingQueue } = await import('./run-existing.queue');
        await negotiationRunExistingQueue.addJob({ opportunityId: oid, userId: uid });
      });
    await enqueueResume(opportunityId, userId);

    this.logger.info('Ask-user window expired; negotiation resumed with conservative default', {
      negotiationId,
      opportunityId,
      userId,
    });
  }
}

/**
 * Default expiry-answer store: appends a synthetic `userAnswers` entry to the
 * opportunity metadata. The resuming IndexNegotiator renders it under
 * "additional context (provided between sessions)".
 */
async function defaultStoreExpiryAnswer(opportunityId: string, disclosureSubject: string): Promise<void> {
  const chatDb = new ChatDatabaseAdapter();
  const opportunity = await chatDb.getOpportunity(opportunityId);
  if (!opportunity) return;
  const metadata = (opportunity.metadata ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(metadata.userAnswers) ? metadata.userAnswers : [];
  await chatDb.updateOpportunityMetadata(opportunityId, {
    ...metadata,
    userAnswers: [
      ...existing,
      {
        questionId: `ask-user-expired-${opportunityId}`,
        selectedOptions: [],
        freeText: `(no response) The client did not answer the negotiator's question about "${disclosureSubject}" within the allowed window. Conservative default applies: do NOT disclose or commit on this subject; proceed without it.`,
        answeredAt: new Date().toISOString(),
      },
    ],
  });
}

/** Default dismissal: pending negotiation_inflight rows for the opportunity. */
async function defaultDismissInflightQuestions(opportunityId: string): Promise<void> {
  await db
    .update(questions)
    .set({ status: 'dismissed' })
    .where(
      and(
        eq(questions.status, 'pending'),
        sql`${questions.detection}->>'mode' = 'negotiation_inflight'`,
        sql`${questions.detection}->>'sourceId' = ${opportunityId}`,
      ),
    );
}

/** Singleton negotiation timeout queue instance. */
export const negotiationTimeoutQueue = new NegotiationTimeoutQueue();
