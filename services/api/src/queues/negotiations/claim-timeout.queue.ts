import type { Job, Queue } from 'bullmq';

import { QueueFactory } from '../../lib/bullmq/bullmq';
import { log } from '../../lib/log';

/** BullMQ queue name for negotiation claim-timeout jobs. */
export const QUEUE_NAME = 'negotiation-claim-timeout';

/** Payload for a negotiation claim-timeout job. */
export interface NegotiationClaimTimeoutJobData {
  negotiationId: string;
  turnNumber: number;
  agentId: string;
  /** Exact claim generation preserved across idempotent pickup repair. */
  claimedAt: string;
}

/** Optional deps for testing. */
export interface NegotiationClaimTimeoutQueueDeps {
  queue?: Queue<NegotiationClaimTimeoutJobData>;
}

function claimTimeoutJobId(negotiationId: string, claimedAt: string): string {
  return `neg-claim-timeout-${negotiationId}-${claimedAt}`;
}

/**
 * NegotiationClaimTimeoutQueue (rewrite, #1494) — a stub.
 *
 * Pickup/claim (`pickupNegotiationAtomically`) stays host-side per the
 * design doc, but its old `waiting_for_agent` → `claimed` state cycle no
 * longer exists: the graph never parks a negotiation into a distinct state,
 * it stays `working`. A negotiation can no longer actually be claimed under
 * the new model, so a claim-timeout job is never enqueued in practice — this
 * class exists only so `enqueueTimeout`/`cancelTimeout` call sites still
 * compile. Redesigning external-agent claim/dispatch against the new
 * `working`-only lifecycle is out of scope for this PR; state this break in
 * the PR.
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

  async enqueueTimeout(
    negotiationId: string,
    turnNumber: number,
    agentId: string,
    claimedAt: string,
    delayMs: number,
  ): Promise<string> {
    const jobId = claimTimeoutJobId(negotiationId, claimedAt);
    const job = await this.queue.add('negotiation_claim_timeout', {
      negotiationId,
      turnNumber,
      agentId,
      claimedAt,
    }, {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
    this.logger.info('Claim timeout enqueued', { negotiationId, turnNumber, agentId, delayMs, jobId: job.id });
    return job.id ?? jobId;
  }

  async cancelTimeout(negotiationId: string, claimedAt: string): Promise<void> {
    const jobId = claimTimeoutJobId(negotiationId, claimedAt);
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

  async processJob(name: string, data: NegotiationClaimTimeoutJobData): Promise<void> {
    if (name !== 'negotiation_claim_timeout') {
      this.queueLogger.warn('Unknown job name', { name });
      return;
    }
    this.logger.warn('Claim timeout fired — no-op stub (claim lifecycle retired, see negotiation-graph-rewrite)', { ...data });
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<NegotiationClaimTimeoutJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<NegotiationClaimTimeoutJobData>(QUEUE_NAME, processor);
  }

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
}

/** Singleton negotiation claim-timeout queue instance. */
export const negotiationClaimTimeoutQueue = new NegotiationClaimTimeoutQueue();
