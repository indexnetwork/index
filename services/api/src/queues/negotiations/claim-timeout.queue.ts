import { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm/sql';

import db from '../../lib/drizzle/drizzle';
import * as convSchema from '../../schemas/conversation.schema';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { AMBIENT_PARK_WINDOW_MS } from '@indexnetwork/protocol';
import type { NegotiationGraphDatabase } from '@indexnetwork/protocol';

import { runTimeoutFallback, type NegotiationTaskMeta } from './timeout.shared';

/** BullMQ queue name for negotiation claim-timeout jobs. */
export const QUEUE_NAME = 'negotiation-claim-timeout';

/** Payload for a negotiation claim-timeout job. */
export interface NegotiationClaimTimeoutJobData {
  negotiationId: string;
  turnNumber: number;
  agentId: string;
}

/** Optional deps for testing. */
export interface NegotiationClaimTimeoutQueueDeps {
  database?: NegotiationGraphDatabase;
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

  readonly queue = QueueFactory.createQueue<NegotiationClaimTimeoutJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('NegotiationClaimTimeoutJob');
  private readonly queueLogger = log.queue.from('NegotiationClaimTimeoutQueue');
  private readonly deps: NegotiationClaimTimeoutQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<NegotiationClaimTimeoutJobData>> | null = null;

  constructor(deps?: NegotiationClaimTimeoutQueueDeps) {
    this.deps = deps;
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
    delayMs: number,
  ): Promise<string> {
    const jobId = `neg-claim-timeout-${negotiationId}`;

    // Remove any existing claim-timeout job for this negotiation before adding a new one
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        await existing.remove();
      }
    } catch {
      // Job may not exist, ignore
    }

    const job = await this.queue.add('negotiation_claim_timeout', { negotiationId, turnNumber, agentId }, {
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
  async cancelTimeout(negotiationId: string): Promise<void> {
    const jobId = `neg-claim-timeout-${negotiationId}`;
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
        this.queueLogger.warn(`Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker. Idempotent.
   */
  startWorker(): void {
    if (this.worker) return;

    const processor = async (job: Job<NegotiationClaimTimeoutJobData>) => {
      this.queueLogger.info(`Processing job ${job.id} (${job.name})`);
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
    await this.queue.close();
  }

  /**
   * Handle a negotiation claim timeout: an agent claimed the turn but never responded.
   * Run the AI agent as a fallback for the abandoned turn.
   */
  private async handleClaimTimeout(data: NegotiationClaimTimeoutJobData): Promise<void> {
    const { negotiationId, turnNumber, agentId } = data;
    const database = this.deps?.database ?? conversationDatabaseAdapter;

    // Atomically transition out of 'claimed' to 'working' before doing any
    // work. If another path (agent respond) is racing this worker, only one
    // side will flip the state — the other no-ops. This prevents both paths
    // from appending a turn for the same claimed state.
    const [task] = await db
      .update(convSchema.tasks)
      .set({ state: 'working', updatedAt: new Date() })
      .where(
        and(
          eq(convSchema.tasks.id, negotiationId),
          eq(convSchema.tasks.state, 'claimed'),
        ),
      )
      .returning();

    if (!task) {
      this.logger.info('Task no longer claimed, skipping (stale job)', {
        negotiationId,
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
        job: '[NegotiationClaimTimeoutJob]',
        fallback: 'Claimed agent timed out, running AI fallback',
        finalized: 'Negotiation finalized after claim timeout',
        statusUpdateFailed: 'Failed to update opportunity status on claim-timeout finalization',
      },
      negotiationId,
      taskId: task.id,
      conversationId: task.conversationId,
      meta,
      messages,
      currentTurnCount,
      seedReasoning: 'Claim timeout fallback',
      maxTurns: meta.maxTurns ?? 6,
      fallbackLogExtra: { agentId },
      // Import dynamically to avoid a circular dependency with timeout.queue;
      // arm the park-window timeout for the next speaker.
      rearm: async (newTurnCount) => {
        const { negotiationTimeoutQueue } = await import('./timeout.queue');
        await negotiationTimeoutQueue.enqueueTimeout(negotiationId, newTurnCount, AMBIENT_PARK_WINDOW_MS);
      },
    });
  }
}

/** Singleton negotiation claim-timeout queue instance. */
export const negotiationClaimTimeoutQueue = new NegotiationClaimTimeoutQueue();
