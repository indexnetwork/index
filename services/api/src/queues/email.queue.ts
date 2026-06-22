import { Job } from 'bullmq';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { executeSendEmail } from '../lib/email/transport.helper';

export const QUEUE_NAME = 'email-processing-queue';

export interface EmailJobData {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Optional Resend headers (e.g. List-Unsubscribe). */
  headers?: Record<string, string>;
}

export interface AddEmailJobOptions {
  priority?: number;
  /** When set, BullMQ uses this as job id (deduplicates pending jobs with same id). */
  jobId?: string;
}

/**
 * Email queue: BullMQ queue, worker, and job handlers for sending emails via Resend.
 *
 * Workers are started only by the protocol server via {@link EmailQueue.startWorker}.
 * CLI scripts may add jobs without starting a worker.
 *
 * @remarks Preserves email-specific settings: 5 attempts, rate limiter (max 2 per second).
 */
export class EmailQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<EmailJobData>(QUEUE_NAME, {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
    },
  });

  readonly queueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);

  private readonly logger = log.job.from('EmailJob');
  private readonly queueLogger = log.queue.from('EmailQueue');
  private worker: ReturnType<typeof QueueFactory.createWorker<EmailJobData>> | null = null;

  /**
   * Add an email job to the queue.
   * @param data - Email payload (to, subject, html, text, headers)
   * @param options - Optional priority and jobId for deduplication
   * @returns The BullMQ job
   */
  async addJob(
    data: EmailJobData,
    options?: AddEmailJobOptions
  ): Promise<Job<EmailJobData>> {
    const job = await this.queue.add('send_email', data, {
      priority: options?.priority,
      jobId: options?.jobId,
    });
    this.queueLogger.debug(`[EmailQueue] Job added with ID: ${job.id}`, {
      priority: options?.priority,
      jobId: options?.jobId,
    });
    return job;
  }

  /**
   * Run job handler for a given job name and payload. Used by the worker and by tests.
   * @param name - Job name (`send_email`)
   * @param data - Email payload
   */
  async processJob(name: string, data: EmailJobData): Promise<void> {
    switch (name) {
      case 'send_email':
        await this.handleSendEmail(data);
        break;
      default:
        this.queueLogger.warn(`[EmailProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<EmailJobData>) => {
      this.queueLogger.info(`[EmailProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<EmailJobData>(QUEUE_NAME, processor, {
      limiter: { max: 2, duration: 1000 },
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error('Email job failed', { jobId: job?.id, error: err });
    });
    this.worker.on('completed', (job) => {
      if (job) {
        this.logger.info('Email job sent', { jobId: job.id });
      }
    });
    this.worker.on('error', (err) => {
      this.logger.error('Worker error', { error: err });
    });
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleSendEmail(data: EmailJobData): Promise<void> {
    await executeSendEmail(data);
  }
}

/** Singleton email queue instance. */
export const emailQueue = new EmailQueue();
