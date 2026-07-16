import { Job } from 'bullmq';

import { buildPoolQuestionPushMessage, poolQuestionsMode, poolQuestionsPushMode } from '@indexnetwork/protocol';

import { conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { QuestionerAdapter } from '../../adapters/questioner.adapter';
import { agentService } from '../../services/agent.service';
import { chatSessionService } from '../../services/chat.service';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import db from '../../lib/drizzle/drizzle';
import { isNegotiatorChatEnabled } from '../../lib/negotiator-feature';
import { log } from '../../lib/log';

/** Dedicated BullMQ queue for proactive pool-question delivery. */
export const POOL_QUESTION_PUSH_QUEUE_NAME = 'pool-question-push-queue';
export const POOL_QUESTION_PUSH_RECOVERY_JOB_NAME = 'recover_pool_question_pushes';
export const POOL_QUESTION_PUSH_RECOVERY_SCHEDULER_ID = 'pool-question-push-recovery-v1';
const POOL_QUESTION_PUSH_RECOVERY_LIMIT = 100;

/** Minimal retry payload; all authoritative content is re-read after claim. */
export interface PoolQuestionPushJobData {
  questionId: string;
  userId: string;
}

interface PoolQuestionPushRecoveryJobData {
  trigger: 'scheduler';
}

type PoolQuestionPushQueueData = PoolQuestionPushJobData | PoolQuestionPushRecoveryJobData;

type PoolQuestioner = Pick<
  QuestionerAdapter,
  | 'claimPoolQuestionPush'
  | 'markPoolQuestionPushFailed'
  | 'markPoolQuestionPushRequested'
  | 'listRecoverablePoolQuestionPushRequests'
>;

export interface PoolQuestionPushQueueDeps {
  questioner?: PoolQuestioner;
  negotiatorAvailable?: (userId: string) => Promise<boolean>;
  resolveSession?: typeof chatSessionService.resolveNegotiatorSession;
  deliver?: typeof conversationDatabaseAdapter.deliverClaimedPoolQuestionPush;
  pushEnabled?: () => boolean;
  enqueuePush?: (data: PoolQuestionPushJobData) => Promise<unknown>;
}

interface RequestPoolQuestionPushDeps {
  pushEnabled: () => boolean;
  markRequested: (questionId: string, userId: string) => Promise<boolean>;
  enqueue: (data: PoolQuestionPushJobData) => Promise<unknown>;
}

/** Deterministic BullMQ ID. BullMQ custom IDs must not contain colons. */
export function poolQuestionPushJobId(questionId: string): string {
  return `pool-question-push-${questionId}`;
}

/**
 * Write the durable request marker before attempting the non-transactional
 * Redis enqueue. Disabled creation deliberately writes no marker (no backfill).
 */
export async function requestPoolQuestionPush(
  questionId: string,
  userId: string,
  deps: RequestPoolQuestionPushDeps,
): Promise<void> {
  if (!deps.pushEnabled()) return;
  if (!await deps.markRequested(questionId, userId)) return;
  await deps.enqueue({ questionId, userId });
}

/** Retryable worker for claim + deterministic stable-DM delivery and recovery. */
export class PoolQuestionPushQueue {
  readonly queue = QueueFactory.createQueue<PoolQuestionPushQueueData>(POOL_QUESTION_PUSH_QUEUE_NAME);

  private readonly logger = log.queue.from('PoolQuestionPushQueue');
  private readonly questioner: PoolQuestioner;
  private readonly negotiatorAvailable: (userId: string) => Promise<boolean>;
  private readonly resolveSession: typeof chatSessionService.resolveNegotiatorSession;
  private readonly deliver: typeof conversationDatabaseAdapter.deliverClaimedPoolQuestionPush;
  private readonly pushEnabled: () => boolean;
  private readonly enqueuePush: (data: PoolQuestionPushJobData) => Promise<unknown>;
  private worker: ReturnType<typeof QueueFactory.createWorker<PoolQuestionPushQueueData>> | null = null;

  constructor(deps?: PoolQuestionPushQueueDeps) {
    this.questioner = deps?.questioner ?? new QuestionerAdapter(db);
    this.negotiatorAvailable = deps?.negotiatorAvailable ?? (async (userId) => {
      if (!isNegotiatorChatEnabled()) return false;
      return Boolean(await agentService.getNegotiatorAgent(userId));
    });
    this.resolveSession = deps?.resolveSession ?? chatSessionService.resolveNegotiatorSession.bind(chatSessionService);
    this.deliver = deps?.deliver ?? conversationDatabaseAdapter.deliverClaimedPoolQuestionPush.bind(conversationDatabaseAdapter);
    this.pushEnabled = deps?.pushEnabled ?? poolQuestionPushEnabled;
    this.enqueuePush = deps?.enqueuePush ?? ((data) => this.addPushJob(data));
  }

  /** Enqueue one deterministic delivery attempt. */
  addPushJob(data: PoolQuestionPushJobData): Promise<Job<PoolQuestionPushQueueData>> {
    return this.queue.add('deliver_pool_question', data, {
      jobId: poolQuestionPushJobId(data.questionId),
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /** Process one delivery job; exposed for focused hermetic tests. */
  async processJob(data: PoolQuestionPushJobData): Promise<void> {
    const enabled = this.pushEnabled();
    let available = false;
    if (enabled) {
      try {
        available = await this.negotiatorAvailable(data.userId);
      } catch (error) {
        this.logger.warn('Negotiator availability check failed; only an existing claim may resume', {
          event: 'pool_question_push_availability_failed',
          questionId: data.questionId,
          userId: data.userId,
          error,
        });
      }
    }
    const allowNewClaim = enabled && available;
    const claim = await this.questioner.claimPoolQuestionPush(
      data.questionId,
      data.userId,
      { allowNewClaim },
    );
    this.logger.info('Pool question push claim evaluated', {
      event: 'pool_question_push_claim_evaluated',
      questionId: data.questionId,
      userId: data.userId,
      allowNewClaim,
      result: claim.kind,
      ...(claim.kind === 'ineligible' ? { reason: claim.reason } : {}),
    });
    if (claim.kind !== 'claimed') return;

    const resolved = await this.resolveSession(data.userId, 'Personal Agent');
    if ('error' in resolved) throw new Error(resolved.error);

    const messageText = buildPoolQuestionPushMessage({
      intentId: claim.intentId,
      intentTitle: claim.intentTitle,
      questionPrompt: claim.questionPrompt,
    });
    const result = await this.deliver({
      questionId: claim.questionId,
      recipientId: claim.recipientId,
      intentId: claim.intentId,
      cycleKey: claim.cycleKey,
      conversationId: resolved.session.id,
      messageText,
    });
    this.logger.info('Pool question push delivery settled', {
      event: 'pool_question_push_delivery_settled',
      questionId: data.questionId,
      userId: data.userId,
      status: result.status,
      ...(result.status === 'delivered' ? { inserted: result.inserted } : {}),
    });
  }

  /** Re-add deterministic jobs for durable unfulfilled request markers. */
  async recoverRequestedPushes(limit = POOL_QUESTION_PUSH_RECOVERY_LIMIT): Promise<number> {
    const requested = await this.questioner.listRecoverablePoolQuestionPushRequests(limit);
    const enabled = this.pushEnabled();
    const recoverable = enabled ? requested : requested.filter((row) => row.claimed);
    await Promise.all(recoverable.map((row) => this.enqueuePush({
      questionId: row.questionId,
      userId: row.userId,
    })));
    this.logger.info('Pool question push recovery sweep completed', {
      event: 'pool_question_push_recovery_completed',
      scanned: requested.length,
      requeued: recoverable.length,
      newClaimsEnabled: enabled,
    });
    return recoverable.length;
  }

  /** Register the repeatable recovery sweep. Called by the composition root. */
  startRecoveryScheduler(): void {
    void this.queue.upsertJobScheduler(
      POOL_QUESTION_PUSH_RECOVERY_SCHEDULER_ID,
      { every: 60_000 },
      {
        name: POOL_QUESTION_PUSH_RECOVERY_JOB_NAME,
        data: { trigger: 'scheduler' },
        opts: {
          removeOnComplete: { age: 24 * 3600, count: 100 },
          removeOnFail: { age: 7 * 24 * 3600, count: 100 },
        },
      },
    ).catch((error) => {
      this.logger.error('Failed to register pool question push recovery scheduler', {
        event: 'pool_question_push_recovery_scheduler_failed',
        error,
      });
    });
  }

  /** Start the worker once. */
  startWorker(): void {
    if (this.worker) return;
    this.worker = QueueFactory.createWorker<PoolQuestionPushQueueData>(
      POOL_QUESTION_PUSH_QUEUE_NAME,
      async (job) => {
        if (job.name === POOL_QUESTION_PUSH_RECOVERY_JOB_NAME) {
          try {
            await this.recoverRequestedPushes();
          } catch (error) {
            this.logger.error('Pool question push recovery sweep failed', {
              event: 'pool_question_push_recovery_failed',
              jobId: job.id,
              error,
            });
            throw error;
          }
          return;
        }

        const data = job.data as PoolQuestionPushJobData;
        try {
          await this.processJob(data);
        } catch (error) {
          const attempts = job.opts.attempts ?? 1;
          const finalAttempt = job.attemptsMade + 1 >= attempts;
          this.logger.error('Pool question push processing failed', {
            event: 'pool_question_push_processing_failed',
            jobId: job.id,
            questionId: data.questionId,
            userId: data.userId,
            attempt: job.attemptsMade + 1,
            maxAttempts: attempts,
            finalAttempt,
            error,
          });
          if (finalAttempt) {
            await this.questioner.markPoolQuestionPushFailed(
              data.questionId,
              data.userId,
              error instanceof Error ? error.message : String(error),
            );
          }
          throw error;
        }
      },
    );
  }

  /** Close queue and worker connections. */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

function poolQuestionPushEnabled(): boolean {
  return poolQuestionsPushMode() === 'on' && poolQuestionsMode() === 'on';
}

/** Runtime singleton used by both pool-question producers. */
export const poolQuestionPushQueue = new PoolQuestionPushQueue();
const poolQuestionPushRequestAdapter = new QuestionerAdapter(db);

/** Post-persist callback injected into the shared pool-question choke point. */
export async function enqueuePoolQuestionPush(questionId: string, userId: string): Promise<void> {
  await requestPoolQuestionPush(questionId, userId, {
    pushEnabled: poolQuestionPushEnabled,
    markRequested: poolQuestionPushRequestAdapter.markPoolQuestionPushRequested.bind(poolQuestionPushRequestAdapter),
    enqueue: (data) => poolQuestionPushQueue.addPushJob(data),
  });
}
