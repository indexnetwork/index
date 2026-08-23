// services/api/src/queues/negotiations/run-existing.queue.ts
import { Job } from 'bullmq';
import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import type { NegotiationGraphLike, AgentDispatcher } from '@indexnetwork/protocol';

export const QUEUE_NAME = 'negotiation-run-existing';

export interface RunExistingJobData {
  opportunityId: string;
  userId: string;
}

export interface RunExistingDeps {
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
}

/**
 * NegotiationRunExistingQueue (negotiation-graph rewrite, #1494) — a stub.
 *
 * Its only job kind, `negotiate_existing`, drove the pre-rewrite
 * `OpportunityGraphFactory.negotiateExisting` continuation machinery, which
 * is deleted along with the exact-continuation-fields/receipt plumbing it
 * depended on. Callers (discovery re-enqueue, the watchdog, the MCP
 * `negotiate` tool) still enqueue by `{ opportunityId, userId }`; this class
 * exists so those call sites and the admin queues board keep compiling.
 * Redesigning "resume negotiations for an existing opportunity" against
 * IS-A's brief-driven kickoff/re-kick is out of scope for this PR — state
 * this break in the PR.
 */
export class NegotiationRunExistingQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<RunExistingJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('RunExistingJob');
  private readonly queueLogger = log.queue.from('RunExistingQueue');
  private deps: RunExistingDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<RunExistingJobData>> | null = null;

  constructor(deps?: RunExistingDeps) {
    this.deps = deps;
  }

  setRuntimeDeps(runtimeDeps: RunExistingDeps): void {
    this.deps = { ...(this.deps ?? {}), ...runtimeDeps };
  }

  async addJob(data: RunExistingJobData): Promise<Job<RunExistingJobData>> {
    const job = await this.queue.add('negotiate_existing', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
    });
    this.logger.info('Negotiation run queued', { jobId: job.id, opportunityId: data.opportunityId, userId: data.userId });
    return job;
  }

  async processJob(name: string, data: RunExistingJobData): Promise<void> {
    if (name !== 'negotiate_existing') {
      this.queueLogger.warn('Unknown job name', { name });
      return;
    }
    this.logger.warn('negotiate_existing fired — no-op stub (retired, see negotiation-graph-rewrite)', { ...data });
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
