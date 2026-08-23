/**
 * The all-paused → reflect trigger queue (negotiation-graph rewrite, #1494).
 *
 * `NegotiationGraph`'s apply step enqueues one of these once every
 * negotiation of `(intentId, round)` has paused. Not to be confused with
 * `reflect.queue.ts`'s `NegotiationReflectQueue` — the unrelated pre-existing
 * memory-distillation pass keyed by negotiation id.
 *
 * The consumer is a stub here: log and ack. IS-A's reflect phase (ASK/ACT)
 * lands in the AgentGraph step of this rewrite.
 */
import type { Job, Queue } from 'bullmq';
import type { NegotiationRoundReflectEnqueueFn, NegotiationRoundReflectJobData } from '@indexnetwork/protocol';
import { negotiationRoundReflectJobId } from '@indexnetwork/protocol';

import { QueueFactory } from '../../lib/bullmq/bullmq';
import { log } from '../../lib/log';

export const QUEUE_NAME = 'negotiation-round-reflect';

export interface NegotiationRoundReflectQueueDeps {
  queue?: Queue<NegotiationRoundReflectJobData>;
}

export class NegotiationRoundReflectQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  private queueInstance: Queue<NegotiationRoundReflectJobData> | null = null;
  private readonly logger = log.job.from('NegotiationRoundReflectJob');
  private readonly queueLogger = log.queue.from('NegotiationRoundReflectQueue');
  private worker: ReturnType<typeof QueueFactory.createWorker<NegotiationRoundReflectJobData>> | null = null;

  constructor(private readonly deps?: NegotiationRoundReflectQueueDeps) {}

  get queue(): Queue<NegotiationRoundReflectJobData> {
    this.queueInstance ??= this.deps?.queue ?? QueueFactory.createQueue<NegotiationRoundReflectJobData>(QUEUE_NAME);
    return this.queueInstance;
  }

  async addJob(data: NegotiationRoundReflectJobData): Promise<void> {
    const jobId = negotiationRoundReflectJobId(data.intentId, data.round);
    await this.queue.add('round_reflect', data, { jobId });
  }

  async processJob(name: string, data: NegotiationRoundReflectJobData): Promise<void> {
    if (name !== 'round_reflect') {
      this.queueLogger.warn('Unknown job name', { name });
      return;
    }
    // Stub: IS-A's reflect phase (ASK/ACT) is not built yet — this PR only
    // wires the trigger through.
    this.logger.info('All negotiations of this round paused; reflect not yet implemented', { ...data });
  }

  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<NegotiationRoundReflectJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<NegotiationRoundReflectJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

/** Singleton round-reflect queue instance. */
export const negotiationRoundReflectQueue = new NegotiationRoundReflectQueue();

/** The enqueue callback injected into `NegotiationGraphDeps.reflectEnqueue`. */
export function roundReflectEnqueue(): NegotiationRoundReflectEnqueueFn {
  return async (job) => {
    await negotiationRoundReflectQueue.addJob(job);
  };
}
