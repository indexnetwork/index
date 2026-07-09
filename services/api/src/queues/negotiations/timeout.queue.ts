import { Job } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { AMBIENT_PARK_WINDOW_MS } from '@indexnetwork/protocol';
import type { NegotiationGraphDatabase } from '@indexnetwork/protocol';

import { runTimeoutFallback, type NegotiationTaskMeta } from './timeout.shared';

/** BullMQ queue name for negotiation timeout jobs. */
export const QUEUE_NAME = 'negotiation-timeout';

/** Payload for a negotiation timeout job. */
export interface NegotiationTimeoutJobData {
  negotiationId: string;
  turnNumber: number;
}

/** Optional deps for testing. */
export interface NegotiationTimeoutQueueDeps {
  database?: NegotiationGraphDatabase;
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

  readonly queue = QueueFactory.createQueue<NegotiationTimeoutJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('NegotiationTimeoutJob');
  private readonly queueLogger = log.queue.from('NegotiationTimeoutQueue');
  private readonly deps: NegotiationTimeoutQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<NegotiationTimeoutJobData>> | null = null;

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
   * Process a timeout job. Exported for testing.
   */
  async processJob(name: string, data: NegotiationTimeoutJobData): Promise<void> {
    switch (name) {
      case 'negotiation_timeout':
        await this.handleTimeout(data);
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

    const processor = async (job: Job<NegotiationTimeoutJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };

    this.worker = QueueFactory.createWorker<NegotiationTimeoutJobData>(QUEUE_NAME, processor);
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
}

/** Singleton negotiation timeout queue instance. */
export const negotiationTimeoutQueue = new NegotiationTimeoutQueue();
