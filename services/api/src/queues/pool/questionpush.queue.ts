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

/** Minimal retry payload; all authoritative content is re-read after claim. */
export interface PoolQuestionPushJobData {
  questionId: string;
  userId: string;
}

interface PoolQuestionPushQueueDeps {
  questioner?: Pick<QuestionerAdapter, 'claimPoolQuestionPush' | 'markPoolQuestionPushFailed'>;
  negotiatorAvailable?: (userId: string) => Promise<boolean>;
  resolveSession?: typeof chatSessionService.resolveNegotiatorSession;
  deliver?: typeof conversationDatabaseAdapter.deliverClaimedPoolQuestionPush;
  pushEnabled?: () => boolean;
}

/** Deterministic BullMQ ID. BullMQ custom IDs must not contain colons. */
export function poolQuestionPushJobId(questionId: string): string {
  return `pool-question-push-${questionId}`;
}

/**
 * Retryable worker for claim + deterministic stable-DM delivery.
 * Claims happen only inside the worker, so an enqueue failure consumes no
 * recipient budget. Settled jobs are removed so the same ID can be re-added.
 */
export class PoolQuestionPushQueue {
  readonly queue = QueueFactory.createQueue<PoolQuestionPushJobData>(POOL_QUESTION_PUSH_QUEUE_NAME);

  private readonly logger = log.queue.from('PoolQuestionPushQueue');
  private readonly questioner: Pick<QuestionerAdapter, 'claimPoolQuestionPush' | 'markPoolQuestionPushFailed'>;
  private readonly negotiatorAvailable: (userId: string) => Promise<boolean>;
  private readonly resolveSession: typeof chatSessionService.resolveNegotiatorSession;
  private readonly deliver: typeof conversationDatabaseAdapter.deliverClaimedPoolQuestionPush;
  private readonly pushEnabled: () => boolean;
  private worker: ReturnType<typeof QueueFactory.createWorker<PoolQuestionPushJobData>> | null = null;

  constructor(deps?: PoolQuestionPushQueueDeps) {
    this.questioner = deps?.questioner ?? new QuestionerAdapter(db);
    this.negotiatorAvailable = deps?.negotiatorAvailable ?? (async (userId) => {
      if (!isNegotiatorChatEnabled()) return false;
      return Boolean(await agentService.getNegotiatorAgent(userId));
    });
    this.resolveSession = deps?.resolveSession ?? chatSessionService.resolveNegotiatorSession.bind(chatSessionService);
    this.deliver = deps?.deliver ?? conversationDatabaseAdapter.deliverClaimedPoolQuestionPush.bind(conversationDatabaseAdapter);
    this.pushEnabled = deps?.pushEnabled ?? (() => (
      poolQuestionsPushMode() === 'on' && poolQuestionsMode() === 'on'
    ));
  }

  /** Enqueue one deterministic delivery attempt. */
  addPushJob(data: PoolQuestionPushJobData): Promise<Job<PoolQuestionPushJobData>> {
    return this.queue.add('deliver_pool_question', data, {
      jobId: poolQuestionPushJobId(data.questionId),
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /** Process one job; exposed for focused hermetic tests. */
  async processJob(data: PoolQuestionPushJobData): Promise<void> {
    if (!this.pushEnabled()) return;
    if (!await this.negotiatorAvailable(data.userId)) return;

    const claim = await this.questioner.claimPoolQuestionPush(data.questionId, data.userId);
    if (claim.kind !== 'claimed') return;

    const resolved = await this.resolveSession(data.userId, 'Personal Agent');
    if ('error' in resolved) throw new Error(resolved.error);

    const messageText = buildPoolQuestionPushMessage({
      intentId: claim.intentId,
      intentTitle: claim.intentTitle,
      questionPrompt: claim.questionPrompt,
    });
    await this.deliver({
      questionId: claim.questionId,
      recipientId: claim.recipientId,
      intentId: claim.intentId,
      cycleKey: claim.cycleKey,
      conversationId: resolved.session.id,
      messageText,
    });
  }

  /** Start the worker once. */
  startWorker(): void {
    if (this.worker) return;
    this.worker = QueueFactory.createWorker<PoolQuestionPushJobData>(
      POOL_QUESTION_PUSH_QUEUE_NAME,
      async (job) => {
        try {
          await this.processJob(job.data);
        } catch (error) {
          const attempts = job.opts.attempts ?? 1;
          if (job.attemptsMade + 1 >= attempts) {
            await this.questioner.markPoolQuestionPushFailed(
              job.data.questionId,
              job.data.userId,
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

/** Runtime singleton used by both pool-question producers. */
export const poolQuestionPushQueue = new PoolQuestionPushQueue();

/** Post-persist callback injected into the shared pool-question choke point. */
export async function enqueuePoolQuestionPush(questionId: string, userId: string): Promise<void> {
  await poolQuestionPushQueue.addPushJob({ questionId, userId });
}
