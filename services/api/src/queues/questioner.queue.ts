import { Job } from 'bullmq';

import { POOL_QUESTION_MAX_PENDING_PER_INTENT, QuestionerAgent, isQuestionerEnabled } from '@indexnetwork/protocol';
import type { PersistableQuestion, PoolDiscoveryContext, QuestionGenerationResult, QuestionerEnqueueFn, QuestionerInput } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import db from '../lib/drizzle/drizzle';
import { QuestionerAdapter } from '../adapters/questioner.adapter';
import { QuestionEvents } from '../events/question.event';
import { buildPoolQuestion, dedupDiscriminators, persistPoolQuestion } from './pool/question.shared';

/** BullMQ queue name for question generation jobs. */
export const QUEUE_NAME = 'questioner-queue';

/** Job data for question generation. Identical to QuestionerInput from protocol. */
export type QuestionerJobData = QuestionerInput;

/**
 * Optional dependencies for testing. Use abstractions so tests can inject
 * stubs without touching real DB or LLM.
 */
export interface QuestionerQueueDeps {
  adapter?: Pick<QuestionerAdapter, 'persist' | 'findPending' | 'listPoolQuestionLabels'>;
  agent?: Pick<QuestionerAgent, 'invoke'>;
  /** Lifecycle lookup used to gate intent-scoped jobs before generation. */
  getIntentLifecycle?: Pick<QuestionerAdapter, 'getIntentLifecycle'>['getIntentLifecycle'];
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
  private readonly adapter: Pick<QuestionerAdapter, 'persist' | 'findPending' | 'listPoolQuestionLabels'>;
  private readonly getIntentLifecycle: Pick<QuestionerAdapter, 'getIntentLifecycle'>['getIntentLifecycle'];
  private agent: Pick<QuestionerAgent, 'invoke'> | null;
  private worker: ReturnType<typeof QueueFactory.createWorker<QuestionerJobData>> | null = null;

  /**
   * @param deps - Optional overrides for adapter and agent (for tests).
   */
  constructor(deps?: QuestionerQueueDeps) {
    const defaultAdapter = new QuestionerAdapter(db);
    this.adapter = deps?.adapter ?? defaultAdapter;
    this.getIntentLifecycle = deps?.getIntentLifecycle
      ?? (deps
        ? async (intentId) => ({ id: intentId, status: 'ACTIVE' as const, archivedAt: null })
        : defaultAdapter.getIntentLifecycle.bind(defaultAdapter));
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
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the
   * protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<QuestionerJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
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
    const intentId = data.triggeredByIntentId?.trim()
      || (data.scopeType === 'intent' ? data.scopeId?.trim() : undefined)
      || (data.mode === 'intent' ? data.sourceId?.trim() : undefined)
      || (data.mode === 'pool_discovery'
        ? (data.context as PoolDiscoveryContext).intentId?.trim()
        : undefined);
    if (intentId) {
      const lifecycle = await this.getIntentLifecycle(intentId, data.userId);
      if (!lifecycle || lifecycle.archivedAt || (lifecycle.status != null && lifecycle.status !== 'ACTIVE')) {
        this.logger.info('Intent-scoped question generation skipped at admission', {
          intentId,
          userId: data.userId,
          status: lifecycle?.status ?? (lifecycle ? 'ACTIVE' : 'missing'),
          archived: Boolean(lifecycle?.archivedAt),
        });
        return;
      }
    }

    this.logger.info('Starting question generation', {
      mode: data.mode,
      userId: data.userId,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
    });

    // pool_discovery questions are synthesized deterministically from mined
    // discriminators — no generator LLM (IND-418). Budget + dedup live here
    // so every producer (mining hook, future paths) hits one choke point.
    if (data.mode === 'pool_discovery') {
      await this.handlePoolDiscovery(data);
      return;
    }

    const result: QuestionGenerationResult | null = await this.getAgent().invoke(data);

    if (!result) {
      this.logger.info('Agent returned null, skipping persist', {
        mode: data.mode,
        sourceId: data.sourceId,
      });
      return;
    }

    const actorNetworkId = data.scopeType === 'network' && data.scopeId?.trim()
      ? data.scopeId.trim()
      : undefined;
    const triggeredByIntentId = data.triggeredByIntentId?.trim()
      || (data.scopeType === 'intent' && data.scopeId?.trim() ? data.scopeId.trim() : undefined);

    const batch: PersistableQuestion[] = result.questions.map((question, i) => ({
      detection: {
        mode: data.mode,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        timestamp: new Date().toISOString(),
        ...(triggeredByIntentId ? { triggeredBy: triggeredByIntentId } : {}),
        ...(data.messageId ? { messageId: data.messageId } : {}),
      },
      actors: [{ userId: data.userId, ...(actorNetworkId ? { networkId: actorNetworkId } : {}), role: 'subject' as const }],
      payload: question,
      strategy: result.strategies[i],
      underspecificationType: result.underspecificationTypes[i],
      conversationId: data.conversationId,
    }));

    const ids = await this.adapter.persist(batch);

    this.logger.info('Persisted questions', {
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

  /**
   * Deterministic pool_discovery arm: enforce the unattended budget
   * (≤1 pending pool_discovery per intent, ≤{@link POOL_QUESTION_MAX_PENDING_PER_INTENT}
   * pending total per intent), dedup against already-asked axes, then
   * synthesize + persist the top discriminator.
   */
  private async handlePoolDiscovery(data: QuestionerJobData): Promise<void> {
    const context = data.context as PoolDiscoveryContext;
    const intentId = context.intentId;

    const pending = await this.adapter.findPending(data.userId, {
      scopeType: 'intent',
      scopeId: intentId,
    });
    if (pending.some((q) => q.detection.mode === 'pool_discovery')) {
      this.logger.info('Pool question skipped: one already pending for intent', { intentId });
      return;
    }
    if (pending.length >= POOL_QUESTION_MAX_PENDING_PER_INTENT) {
      this.logger.info('Pool question skipped: intent question budget exhausted', {
        intentId,
        pending: pending.length,
      });
      return;
    }

    const askedLabels = await this.adapter.listPoolQuestionLabels(data.userId, intentId);
    const fresh = dedupDiscriminators(context.discriminators, askedLabels);
    const question = buildPoolQuestion({
      userId: data.userId,
      intentId,
      poolSize: context.poolSize,
      minedAt: context.minedAt,
      ...(context.runId ? { runId: context.runId } : {}),
      ...(context.intentText ? { intentText: context.intentText } : {}),
      discriminators: fresh,
    });
    if (!question) {
      this.logger.info('Pool question skipped: no fresh discriminator', { intentId });
      return;
    }

    const id = await persistPoolQuestion(this.adapter, question, data.userId);
    this.logger.info('Persisted pool question', { intentId, questionId: id });
  }
}

/** Singleton questioner queue instance. Use for adding jobs and starting the worker. */
export const questionerQueue = new QuestionerQueue();

/**
 * Returns the questioner enqueue callback when question generation is enabled
 * (`QUESTIONER_ENABLED=true`), or `undefined` otherwise.
 *
 * Use at graph/tool composition sites (MCP composition root, background
 * queues) so every path injects the same env-gated enqueue instead of
 * silently dropping question generation. Reads the env at call time, so
 * composition sites that build graphs per job pick up flag changes without
 * a process restart ordering hazard.
 */
export function questionerEnqueueIfEnabled(): QuestionerEnqueueFn | undefined {
  if (!isQuestionerEnabled()) return undefined;
  return async (input) => {
    await questionerQueue.addGenerateJob(input);
  };
}
