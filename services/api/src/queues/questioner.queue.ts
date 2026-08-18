import { Job } from 'bullmq';

import { NegotiationQuestionCandidateSchema, POOL_QUESTION_MAX_PENDING_PER_INTENT, QuestionerAgent, isQuestionerEnabled, isValidQuestionerInputContract, poolQuestionCycleKey, poolQuestionsMode } from '@indexnetwork/protocol';
import type { NegotiationConsultationReason, NegotiationQuestionProvenance, PersistableQuestion, PoolDiscoveryContext, QuestionGenerationResult, QuestionerEnqueueFn, QuestionerInput } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import type { QuestionerAdapter } from '../adapters/questioner.adapter';
import { QuestionEvents } from '../events/question.event';
import { IntentRecoveryRefinementService, type IntentRecoveryCompletion } from '../services/intent-recovery-refinement.service';
import { buildPoolQuestion, dedupDiscriminators, persistPoolQuestion } from './pool/question.shared';
import type { PoolQuestionPostPersist } from './pool/question.shared';
import { isPoolArtifactFresh } from './pool/poolquestions.constants';
import { isSafeNegotiationQuestionPayload } from '../lib/question/negotiation-question.contract';
import { emitConsultationDeliveredTelemetry } from '../lib/question/consultation-policy.telemetry';
import { routeParkedQuestionEnqueue } from './question-message.queue';

/** BullMQ queue name for question generation jobs. */
export const QUEUE_NAME = 'questioner-queue';

/** Privacy-minimal post-discovery recovery job. */
export type RecoveryQuestionerJobData = IntentRecoveryCompletion;

/** All payloads processed by the shared Questioner worker. */
export type QuestionerJobData = QuestionerInput | RecoveryQuestionerJobData;

function uniqueConstraintName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown };
  if (candidate.code === '23505') {
    if (typeof candidate.constraint_name === 'string') return candidate.constraint_name;
    if (typeof candidate.constraint === 'string') return candidate.constraint;
  }
  return uniqueConstraintName(candidate.cause);
}

/**
 * Optional dependencies for testing. Use abstractions so tests can inject
 * stubs without touching real DB or LLM.
 */
type QuestionerQueueAdapter = Pick<
  QuestionerAdapter,
  'persist' | 'persistFreshPoolQuestion' | 'isPoolQuestionFreshForDelivery' | 'findPending' | 'listPoolQuestionLabels'
> & Partial<Pick<QuestionerAdapter, 'prepareNegotiationQuestion' | 'persistFreshNegotiationQuestions'>>;

export interface QuestionerQueueDeps {
  adapter?: QuestionerQueueAdapter;
  /** Content-free IND-508 telemetry emitted only after authoritative persistence. */
  onConsultationTelemetry?: (event: { stage: 'delivered'; reason: NegotiationConsultationReason }) => void;
  agent?: Pick<QuestionerAgent, 'invoke'>;
  /** Lifecycle lookup used to gate intent-scoped jobs before generation. */
  getIntentLifecycle?: Pick<QuestionerAdapter, 'getIntentLifecycle'>['getIntentLifecycle'];
  /** Post-persist delivery enqueue; injected so tests never touch Redis. */
  poolQuestionPostPersist?: PoolQuestionPostPersist;
  /** Recovery policy/generation service; injected so queue tests remain hermetic. */
  recoveryService?: Pick<IntentRecoveryRefinementService, 'recover'>;
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
  private adapter: QuestionerQueueAdapter | null;
  private readonly getIntentLifecycle: Pick<QuestionerAdapter, 'getIntentLifecycle'>['getIntentLifecycle'];
  private readonly poolQuestionPostPersist?: PoolQuestionPostPersist;
  private readonly recoveryService: Pick<IntentRecoveryRefinementService, 'recover'>;
  private readonly onConsultationTelemetry: (event: { stage: 'delivered'; reason: NegotiationConsultationReason }) => void;
  private agent: Pick<QuestionerAgent, 'invoke'> | null;
  private worker: ReturnType<typeof QueueFactory.createWorker<QuestionerJobData>> | null = null;

  /**
   * @param deps - Optional overrides for adapter and agent (for tests).
   */
  constructor(deps?: QuestionerQueueDeps) {
    this.adapter = deps?.adapter ?? null;
    this.getIntentLifecycle = deps?.getIntentLifecycle
      ?? (deps
        ? async (intentId) => ({ id: intentId, status: 'ACTIVE' as const, archivedAt: null })
        : async (intentId, userId) => (await this.getAdapter()).getIntentLifecycle!(intentId, userId));
    this.poolQuestionPostPersist = deps
      ? deps.poolQuestionPostPersist
      : async (questionId, userId) => {
          const { enqueuePoolQuestionPush } = await import('./pool/questionpush.queue');
          await enqueuePoolQuestionPush(questionId, userId);
        };
    this.recoveryService = deps?.recoveryService ?? new IntentRecoveryRefinementService();
    this.onConsultationTelemetry = deps?.onConsultationTelemetry
      ?? ((event) => this.logger.info('negotiation_consultation_policy', event));
    this.agent = deps?.agent ?? null; // lazy — created on first job
  }

  /** Resolve the production adapter lazily so provider-free queue tests never import Drizzle. */
  private async getAdapter(): Promise<QuestionerQueueAdapter & Pick<QuestionerAdapter, 'getIntentLifecycle'>> {
    if (!this.adapter) {
      const { questionerAdapter } = await import('../adapters/questioner.adapter.instance');
      this.adapter = questionerAdapter;
    }
    return this.adapter as QuestionerQueueAdapter & Pick<QuestionerAdapter, 'getIntentLifecycle'>;
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
  addGenerateJob(
    data: QuestionerInput,
    options?: { jobId?: string; priority?: number },
  ): Promise<Job<QuestionerJobData>> {
    return this.addJob('generate_questions', data, options);
  }

  /** Enqueue one privacy-minimal post-discovery recovery attempt. */
  addRecoveryJob(
    data: RecoveryQuestionerJobData,
    options?: { jobId?: string; priority?: number },
  ): Promise<Job<QuestionerJobData>> {
    return this.addJob('generate_recovery_refinement', data, options);
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
    name: 'generate_questions' | 'generate_recovery_refinement',
    data: QuestionerJobData,
    options?: { jobId?: string; priority?: number },
  ): Promise<Job<QuestionerJobData>> {
    if (name === 'generate_questions' && !isValidQuestionerInputContract(data as QuestionerInput)) {
      throw new Error('Invalid questioner mode/purpose/context contract');
    }
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
        await this.handleGenerateQuestions(data as QuestionerInput);
        break;
      case 'generate_recovery_refinement':
        await this.recoveryService.recover(data as RecoveryQuestionerJobData);
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

  private async handleGenerateQuestions(data: QuestionerInput): Promise<void> {
    // Recovery must use the dedicated service so generic generation cannot
    // bypass authoritative cadence/actionability/fingerprint gates.
    if (data.purpose === 'recovery') {
      this.logger.warn('Recovery input rejected on generic generation job', {
        userId: data.userId,
        sourceId: data.sourceId,
      });
      return;
    }
    if (!isValidQuestionerInputContract(data)) {
      this.logger.warn('Question generation rejected invalid mode/purpose/context contract', { mode: data.mode });
      return;
    }
    const adapter = await this.getAdapter();
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

    // Ordinary intent questions from intent creation and post-discovery
    // refinement share one fingerprint-deduplicated persistence path. This
    // makes the intent-page Personal Agent symmetric with pool questions:
    // creation can surface the clarification immediately, while completion
    // hooks safely retry the same material intent version without duplicates.
    if (
      data.mode === 'intent'
      && data.purpose === undefined
      && data.sourceType === 'intent'
      && data.sourceId.trim()
    ) {
      await this.recoveryService.recover({
        source: 'intent_creation',
        recipientUserId: data.userId,
        intentId: data.sourceId,
      });
      return;
    }

    let negotiationAdmission: Omit<NegotiationQuestionProvenance, 'questionOrdinal'> | null = null;
    if (data.mode === 'negotiation' || data.mode === 'negotiation_inflight') {
      const parsed = NegotiationQuestionCandidateSchema.safeParse(data.negotiation);
      const expectedPurpose = data.mode === 'negotiation_inflight'
        ? 'inflight_consultation'
        : data.purpose;
      const contextNegotiationId = data.context && typeof data.context === 'object'
        && 'negotiationId' in data.context
        && typeof data.context.negotiationId === 'string'
          ? data.context.negotiationId
          : undefined;
      const expectedNegotiationId = parsed.success
        ? parsed.data.taskId ?? parsed.data.opportunityId
        : undefined;
      if (
        !parsed.success
        || !expectedPurpose
        || parsed.data.purpose !== expectedPurpose
        || parsed.data.recipientUserId !== data.userId
        || parsed.data.opportunityId !== data.sourceId
        || contextNegotiationId !== expectedNegotiationId
        || data.sourceType !== 'opportunity'
        || !adapter.prepareNegotiationQuestion
        || !adapter.persistFreshNegotiationQuestions
      ) {
        this.logger.info('Negotiation question skipped: exact candidate provenance missing or inconsistent', {
          mode: data.mode,
          userId: data.userId,
          sourceId: data.sourceId,
        });
        return;
      }
      negotiationAdmission = await adapter.prepareNegotiationQuestion(parsed.data);
      if (!negotiationAdmission) {
        this.logger.info('Negotiation question skipped by authoritative admission', {
          mode: data.mode,
          userId: data.userId,
          sourceId: data.sourceId,
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

    const actorNetworkId = negotiationAdmission?.networkId
      ?? (data.scopeType === 'network' && data.scopeId?.trim()
        ? data.scopeId.trim()
        : undefined);
    const triggeredByIntentId = data.triggeredByIntentId?.trim()
      || (data.scopeType === 'intent' && data.scopeId?.trim() ? data.scopeId.trim() : undefined);

    const generatedQuestions = (data.mode === 'negotiation' || data.mode === 'negotiation_inflight')
      ? result.questions.slice(0, 2)
      : result.questions;
    if (
      negotiationAdmission
      && (
        generatedQuestions.length === 0
        || result.strategies.length < generatedQuestions.length
        || result.underspecificationTypes.length < generatedQuestions.length
        || generatedQuestions.some((question) => !isSafeNegotiationQuestionPayload(question))
      )
    ) {
      this.logger.warn('Negotiation question output rejected by deterministic safety gate', {
        mode: data.mode,
        sourceId: data.sourceId,
      });
      return;
    }
    const batch: PersistableQuestion[] = generatedQuestions.map((question, i) => ({
      detection: {
        mode: data.mode,
        ...(data.purpose ? { purpose: data.purpose } : {}),
        ...(negotiationAdmission ? {
          negotiation: { ...negotiationAdmission, questionOrdinal: i },
        } : {}),
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        timestamp: new Date().toISOString(),
        ...(triggeredByIntentId ? { triggeredBy: triggeredByIntentId } : {}),
        ...(data.messageId && !negotiationAdmission ? { messageId: data.messageId } : {}),
      },
      actors: [{ userId: data.userId, ...(actorNetworkId ? { networkId: actorNetworkId } : {}), role: 'subject' as const }],
      payload: question,
      strategy: result.strategies[i],
      underspecificationType: result.underspecificationTypes[i],
      conversationId: negotiationAdmission ? undefined : data.conversationId,
    }));

    let ids: string[];
    try {
      ids = negotiationAdmission
        ? await adapter.persistFreshNegotiationQuestions!(batch)
        : await adapter.persist(batch);
    } catch (error) {
      // This named expression constraint is the sole retry-idempotency guard.
      // Other uniqueness failures are real defects and must retry/fail loudly.
      if (uniqueConstraintName(error) === 'questions_negotiation_provenance_uniq') {
        this.logger.info('Negotiation question skipped: concurrent persist won', {
          userId: data.userId,
          sourceId: data.sourceId,
          purpose: data.purpose,
        });
        return;
      }
      throw error;
    }
    if (negotiationAdmission && ids.length === 0) {
      this.logger.info('Negotiation question skipped by final freshness gate', {
        userId: data.userId,
        sourceId: data.sourceId,
        purpose: data.purpose,
      });
      return;
    }

    this.logger.info('Persisted questions', {
      mode: data.mode,
      sourceId: data.sourceId,
      count: batch.length,
    });

    // This is the shared final persistence choke point: enqueue, generation,
    // rejected visible payloads, and zero-row freshness outcomes cannot claim
    // delivery. The category stays worker-private and is never added to row
    // detection/payload/actors or public projections.
    emitConsultationDeliveredTelemetry(data, { state: 'persisted', ids }, this.onConsultationTelemetry);

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
  private async handlePoolDiscovery(data: QuestionerInput): Promise<void> {
    const adapter = await this.getAdapter();
    const context = data.context as PoolDiscoveryContext & { opportunityIds?: string[] };
    const intentId = context.intentId;

    const pending = await adapter.findPending(data.userId, {
      scopeType: 'intent',
      scopeId: intentId,
    });
    const existingPoolQuestion = pending.find((q) => q.detection.mode === 'pool_discovery');
    if (existingPoolQuestion) {
      const existingPool = existingPoolQuestion.detection.pool;
      const incomingCycle = poolQuestionCycleKey({ runId: context.runId, minedAt: context.minedAt });
      if (
        existingPool
        && poolQuestionCycleKey(existingPool) === incomingCycle
        && this.poolQuestionPostPersist
        && poolQuestionsMode() === 'on'
        && await adapter.isPoolQuestionFreshForDelivery(
          existingPoolQuestion.id,
          data.userId,
          isPoolArtifactFresh,
        )
      ) {
        await this.poolQuestionPostPersist(existingPoolQuestion.id, data.userId);
        this.logger.info('Re-enqueued existing same-cycle pool question', {
          intentId,
          questionId: existingPoolQuestion.id,
          cycleKey: incomingCycle,
        });
      } else {
        this.logger.info('Pool question skipped: one already pending for intent', { intentId });
      }
      return;
    }
    const budgetPending = pending.filter((question) => question.detection.purpose !== 'recovery');
    if (budgetPending.length >= POOL_QUESTION_MAX_PENDING_PER_INTENT) {
      this.logger.info('Pool question skipped: intent question budget exhausted', {
        intentId,
        pending: budgetPending.length,
      });
      return;
    }

    const askedLabels = await adapter.listPoolQuestionLabels(data.userId, intentId, {
      ...(context.intentFingerprint ? { currentIntentFingerprint: context.intentFingerprint } : {}),
      currentIntentText: context.intentText,
    });
    const fresh = dedupDiscriminators(context.discriminators, askedLabels);
    const question = buildPoolQuestion({
      userId: data.userId,
      intentId,
      poolSize: context.poolSize,
      opportunityIds: context.opportunityIds ?? [],
      minedAt: context.minedAt,
      ...(context.runId ? { runId: context.runId } : {}),
      ...(context.intentText ? { intentText: context.intentText } : {}),
      ...(context.intentFingerprint ? { intentFingerprint: context.intentFingerprint } : {}),
      discriminators: fresh,
    });
    if (!question) {
      this.logger.info('Pool question skipped: no fresh discriminator', { intentId });
      return;
    }

    const id = await persistPoolQuestion(
      adapter,
      question,
      data.userId,
      this.poolQuestionPostPersist,
    );
    if (!id) {
      this.logger.info('Pool question skipped by final freshness gate', { intentId });
      return;
    }
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
    // Park-path payloads (mid-flight consults, post-stall parks) no longer
    // generate QuestionerAgent rows: the parked negotiation is the durable
    // record, and the question-message regeneration job renders it into the
    // signal's DM (conversational-questions delivery spine). The generator's
    // machinery stays for the remaining modes; retirements come later.
    if (await routeParkedQuestionEnqueue(input)) return;
    await questionerQueue.addGenerateJob(input);
  };
}
