import { Job } from 'bullmq';

import { QuestionerAgent } from '@indexnetwork/protocol';
import type { QuestionerInput, PersistableQuestion, QuestionGenerationResult } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import db from '../lib/drizzle/drizzle';
import { QuestionerAdapter } from '../adapters/questioner.adapter';
import { QuestionEvents } from '../events/question.event';

/** BullMQ queue name for question generation jobs. */
export const QUEUE_NAME = 'questioner-queue';

/** Job data for question generation. Identical to QuestionerInput from protocol. */
export type QuestionerJobData = QuestionerInput;

/**
 * Optional dependencies for testing. Use abstractions so tests can inject
 * stubs without touching real DB or LLM.
 */
export interface QuestionerQueueDeps {
  adapter?: Pick<QuestionerAdapter, 'persist'>;
  agent?: Pick<QuestionerAgent, 'invoke'>;
}

/**
 * Questioner queue: BullMQ queue + worker + job handler.
 *
 * Accepts `QuestionerInput` jobs via {@link addGenerateJob}, invokes the
 * QuestionerAgent from `@indexnetwork/protocol`, maps the result into
 * {@link PersistableQuestion} rows, and persists them via the adapter.
 *
 * Workers are started only by the protocol server via {@link startWorker}.
 * CLI scripts may add jobs without starting a worker.
 */
export class QuestionerQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<QuestionerJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('QuestionerJob');
  private readonly queueLogger = log.queue.from('QuestionerQueue');
  private readonly adapter: Pick<QuestionerAdapter, 'persist'>;
  private agent: Pick<QuestionerAgent, 'invoke'> | null;
  private worker: ReturnType<typeof QueueFactory.createWorker<QuestionerJobData>> | null = null;

  /**
   * @param deps - Optional overrides for adapter and agent (for tests).
   */
  constructor(deps?: QuestionerQueueDeps) {
    this.adapter = deps?.adapter ?? new QuestionerAdapter(db);
    this.agent = deps?.agent ?? null; // lazy — created on first job
  }

  /** Return the agent, creating it on first access (deferred so the module can
   *  be imported without requiring OPENROUTER_API_KEY at load time). */
  private getAgent(): Pick<QuestionerAgent, 'invoke'> {
    if (!this.agent) this.agent = new QuestionerAgent();
    return this.agent;
  }

  /**
   * Enqueue a question-generation job.
   *
   * @param data - The QuestionerInput payload (mode, userId, sourceType, sourceId, context).
   * @returns The BullMQ job.
   */
  addGenerateJob(data: QuestionerJobData): Promise<Job<QuestionerJobData>> {
    return this.addJob('generate_questions', data);
  }

  /**
   * Add a job to the questioner queue.
   *
   * @param name  - Job type (currently only `generate_questions`).
   * @param data  - Job payload.
   * @param options - Optional jobId and priority.
   * @returns The BullMQ job.
   */
  async addJob(
    name: 'generate_questions',
    data: QuestionerJobData,
    options?: { jobId?: string; priority?: number },
  ): Promise<Job<QuestionerJobData>> {
    return this.queue.add(name, data, {
      jobId: options?.jobId,
      priority: options?.priority,
    });
  }

  /**
   * Run the job handler for a given job name and payload. Used by the worker
   * and by tests with injected deps.
   *
   * @param name - Job name (`generate_questions`).
   * @param data - Job payload.
   */
  async processJob(name: string, data: QuestionerJobData): Promise<void> {
    switch (name) {
      case 'generate_questions':
        await this.handleGenerateQuestions(data);
        break;
      default:
        this.queueLogger.warn(`[QuestionerProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the
   * protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<QuestionerJobData>) => {
      this.queueLogger.info(`[QuestionerProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<QuestionerJobData>(QUEUE_NAME, processor);
  }

  /**
   * Gracefully close the worker and queue connections.
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleGenerateQuestions(data: QuestionerJobData): Promise<void> {
    this.logger.info('[QuestionerJob] Starting question generation', {
      mode: data.mode,
      userId: data.userId,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
    });

    const result: QuestionGenerationResult | null = await this.getAgent().invoke(data);

    if (!result) {
      this.logger.info('[QuestionerJob] Agent returned null, skipping persist', {
        mode: data.mode,
        sourceId: data.sourceId,
      });
      return;
    }

    const batch: PersistableQuestion[] = result.questions.map((question, i) => ({
      detection: {
        mode: data.mode,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        timestamp: new Date().toISOString(),
      },
      actors: [{ userId: data.userId, role: 'subject' as const }],
      payload: question,
      strategy: result.strategies[i],
    }));

    const ids = await this.adapter.persist(batch);

    this.logger.info('[QuestionerJob] Persisted questions', {
      mode: data.mode,
      sourceId: data.sourceId,
      count: batch.length,
    });

    for (let i = 0; i < ids.length; i++) {
      QuestionEvents.onCreated({
        questionId: ids[i],
        userId: data.userId,
        mode: data.mode,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
      });
    }
  }
}

/** Singleton questioner queue instance. Use for adding jobs and starting the worker. */
export const questionerQueue = new QuestionerQueue();
