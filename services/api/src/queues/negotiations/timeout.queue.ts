import type { Job, Queue } from 'bullmq';
import type { NegotiationGraphLike } from '@indexnetwork/protocol';

import { QueueFactory } from '../../lib/bullmq/bullmq';
import { log } from '../../lib/log';
import { conversationDatabaseAdapter } from '../../adapters/database.adapter';

/** BullMQ queue name for negotiation timeout jobs. */
export const QUEUE_NAME = 'negotiation-timeout';

/**
 * Payload for a negotiation timeout job. `turnCount` is the negotiation's
 * turn count at enqueue time — the staleness check at fire time: if the
 * negotiation has moved on (more turns, no longer `working`), the job no-ops.
 */
export interface NegotiationTimeoutJobData {
  negotiationId: string;
  turnCount: number;
}

/** Optional deps for testing. */
export interface NegotiationTimeoutQueueDeps {
  queue?: Queue<NegotiationTimeoutJobData>;
  negotiationGraph?: NegotiationGraphLike;
  database?: Pick<typeof conversationDatabaseAdapter, 'getNegotiationTask' | 'getNegotiationMessages'>;
}

/**
 * NegotiationTimeoutQueue (rewrite, #1494): BullMQ queue + worker for turning
 * a stalled negotiation into a `{ negotiationId, pause: 'counterparty_silent' }`
 * graph invoke.
 *
 * There is no more park generation, continuation fence, or ask_user expiry —
 * the graph never parks into a distinct state; a negotiation stays `working`
 * until it pauses or resolves, and staleness is detected by comparing the
 * enqueued turn count against the current one at fire time, not by explicit
 * cancellation (callers may still cancel via {@link cancelTimeout} as an
 * optimization, but correctness does not depend on it).
 *
 * Workers are started only by the protocol server via {@link NegotiationTimeoutQueue.startWorker}.
 */
export class NegotiationTimeoutQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  private queueInstance: Queue<NegotiationTimeoutJobData> | null = null;

  private readonly logger = log.job.from('NegotiationTimeoutJob');
  private readonly queueLogger = log.queue.from('NegotiationTimeoutQueue');
  private negotiationGraph: NegotiationGraphLike | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<NegotiationTimeoutJobData>> | null = null;

  constructor(private readonly deps?: NegotiationTimeoutQueueDeps) {
    this.negotiationGraph = deps?.negotiationGraph;
  }

  get queue(): Queue<NegotiationTimeoutJobData> {
    this.queueInstance ??=
      this.deps?.queue ?? QueueFactory.createQueue<NegotiationTimeoutJobData>(QUEUE_NAME);
    return this.queueInstance;
  }

  /** Wired once at startup by main.ts, after the single NegotiationGraph is compiled. */
  setNegotiationGraph(graph: NegotiationGraphLike): void {
    this.negotiationGraph = graph;
  }

  /**
   * Enqueue a delayed timeout job for a negotiation.
   *
   * @param negotiationId - The negotiation task ID
   * @param turnCount - Turn count at enqueue time (used to detect stale jobs)
   * @param delayMs - Delay in milliseconds before the timeout fires
   * @returns The BullMQ job ID
   */
  async enqueueTimeout(negotiationId: string, turnCount: number, delayMs: number): Promise<string> {
    const jobId = `neg-timeout-${negotiationId}-${turnCount}`;
    const job = await this.queue.add('negotiation_timeout', { negotiationId, turnCount }, {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
    this.logger.info('Timeout enqueued', { negotiationId, turnCount, delayMs, jobId: job.id });
    return job.id ?? jobId;
  }

  /** Cancel a pending timeout job (a turn landed before it fired). Best-effort. */
  async cancelTimeout(negotiationId: string, jobId: string): Promise<void> {
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

  /** Process a timeout job. Exported for testing. */
  async processJob(name: string, data: NegotiationTimeoutJobData): Promise<void> {
    if (name !== 'negotiation_timeout') {
      this.queueLogger.warn('Unknown job name', { name });
      return;
    }
    await this.handleTimeout(data);
  }

  /** Start the BullMQ worker. Idempotent. */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<NegotiationTimeoutJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<NegotiationTimeoutJobData>(QUEUE_NAME, processor);
  }

  /** Gracefully close worker and queue. */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleTimeout(data: NegotiationTimeoutJobData): Promise<void> {
    const { negotiationId, turnCount } = data;
    const database = this.deps?.database ?? conversationDatabaseAdapter;
    const task = await database.getNegotiationTask(negotiationId);
    if (!task || task.state !== 'working') {
      this.logger.info('Negotiation no longer working, skipping timeout', { negotiationId });
      return;
    }
    const messages = await database.getNegotiationMessages(negotiationId);
    if (messages.length !== turnCount) {
      this.logger.info('A newer turn already landed, timeout job is stale', { negotiationId });
      return;
    }
    const graph = this.negotiationGraph;
    if (!graph) {
      this.logger.error('Negotiation timeout fired before the graph was wired', { negotiationId });
      return;
    }
    await graph.invoke({ negotiationId, pause: 'counterparty_silent' });
    this.logger.info('Negotiation paused on timeout', { negotiationId });
  }
}

/** Singleton negotiation timeout queue instance. */
export const negotiationTimeoutQueue = new NegotiationTimeoutQueue();
