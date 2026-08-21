/**
 * Question-message close-out queue.
 *
 * What remains of the conversational-questions delivery spine
 * (docs/plans/2026-08-18-conversational-questions.md) after the holistic
 * intent-agent collapse (docs/plans/2026-08-21-holistic-intent-agent.md):
 * question-message AUTHORING is retired — the IntentAgent asks in its own
 * prose, as plain chat messages — and DM answers flow through the agent, so
 * this queue no longer regenerates blocks or consumes replies. What it still
 * owns is the LEGACY tail: a question-message delivered before the collapse
 * whose parked set has since emptied is rewritten to fixed closed prose, so
 * no stale block lingers as an open ask. The exhaustion evaluator's
 * transition hook is the only producer.
 *
 * Close-out keeps the singleton per-scope job id and the edit rule's guarded
 * update seam: it only ever rewrites a message that is still the newest in
 * its conversation, and a reply racing it wins.
 */
import { Job } from 'bullmq';

import { parseQuestionMessage } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import type { ParkedNegotiationReaderAdapter } from '../adapters/parked-negotiation.reader.adapter';

export const QUEUE_NAME = 'question-message-queue';

export interface QuestionMessageJobData {
  userId: string;
  intentId: string;
}

/**
 * Server-owned close-out prose for an open question-message whose parked set
 * emptied — the questions were answered, withdrawn, or expired while the
 * message sat there. Fixed copy, never model text.
 */
export const QUESTION_MESSAGE_CLOSED_BODY =
  'Those questions are settled — the negotiations they were holding up have '
  + 'moved on, so there is nothing here for you to answer right now.';

/**
 * Singleton job id per scope: while a close-out is queued for a signal,
 * further triggers coalesce into it. Dashes only — BullMQ reserves colons
 * for Redis key namespacing.
 */
export function questionMessageJobId(userId: string, intentId: string): string {
  return `question-message.${userId}.${intentId}`;
}

/**
 * Structural slice of ChatSessionService the close-out needs. `find`, never
 * `resolve`: a close-out only ever rewrites a message that is already there,
 * so it must not conjure a conversation for a signal whose parks resolved
 * before the job ran.
 */
export interface QuestionMessageChatSessions {
  findNegotiatorIntentSession(userId: string, intentId: string): Promise<{ id: string } | null>;
  /** Newest message in the conversation — the edit rule's anchor read. */
  getNewestMessage(sessionId: string): Promise<{ id: string; role: 'user' | 'assistant' | 'system'; content: string } | null>;
  /**
   * In-place rewrite of the open question-message. Returns false when the
   * data layer's newest-message guard rejected the write (a reply raced the
   * close-out) and the message is left exactly as it is.
   */
  updateQuestionMessageInPlace(params: {
    userId: string;
    intentId: string;
    messageId: string;
    content: string;
  }): Promise<boolean>;
}

/** Optional deps for testing; production resolves the real collaborators lazily. */
export interface QuestionMessageQueueDeps {
  parkedSet?: Pick<ParkedNegotiationReaderAdapter, 'readParkedNegotiations'>;
  chatSessions?: QuestionMessageChatSessions;
}

export class QuestionMessageQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<QuestionMessageJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('QuestionMessageJob');
  private readonly queueLogger = log.queue.from('QuestionMessageQueue');
  private readonly deps: QuestionMessageQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<QuestionMessageJobData>> | null = null;

  constructor(deps?: QuestionMessageQueueDeps) {
    this.deps = deps;
  }

  /**
   * Enqueue a close-out check for one signal's legacy question-message. The
   * singleton job id dedups triggers while a job is queued; completed and
   * failed jobs are removed immediately so the id is reusable.
   */
  addCloseOutJob(data: QuestionMessageJobData): Promise<Job<QuestionMessageJobData>> {
    return this.queue.add('close_out_question_message', data, {
      jobId: questionMessageJobId(data.userId, data.intentId),
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /** Run a job handler (used by the worker and by tests with injected deps). */
  async processJob(name: string, data: QuestionMessageJobData): Promise<void> {
    switch (name) {
      // 'regenerate_question_message': jobs enqueued by the pre-collapse
      // deploy may still sit in Redis under the old name; a close-out check
      // is the only thing left to do with them.
      case 'close_out_question_message':
      case 'regenerate_question_message': {
        await this.handleCloseOut(data);
        break;
      }
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  /** Start the BullMQ worker. Idempotent; call from the protocol server only. */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<QuestionMessageJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<QuestionMessageJobData>(QUEUE_NAME, processor);
  }

  /** Close the worker and queue connections (graceful shutdown). */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleCloseOut(data: QuestionMessageJobData): Promise<void> {
    const { userId, intentId } = data;

    const parkedSet = this.deps?.parkedSet ?? (await import('../adapters/parked-negotiation.reader.adapter')).parkedNegotiationReaderAdapter;
    const parked = await parkedSet.readParkedNegotiations(userId, intentId);
    if (parked.length > 0) {
      // Something is still parked, so a legacy block still references a live
      // ask — leave it. Authoring is retired; the agent owns everything new.
      this.logger.info('question_message_close_out_still_parked', { userId, intentId, parked: parked.length });
      return;
    }
    await this.closeOutOpenQuestionMessage(userId, intentId);
  }

  /**
   * Close out an open legacy question-message: rewrite it to prose with no
   * block, through the same guarded update seam the edit rule used. Silent by
   * policy — nothing is being asked — and bounded by the newest-message rule:
   * if the client replied since, the reply wins and the message is left
   * exactly as it is (its block simply stops being open, because none of its
   * refs is parked any more).
   *
   * Never throws: there is no delivery to retry for, and a failed tidy-up
   * must not fail the job.
   */
  private async closeOutOpenQuestionMessage(userId: string, intentId: string): Promise<void> {
    try {
      const chatSessions = this.deps?.chatSessions ?? (await import('../services/chat.service')).chatSessionService;
      const session = await chatSessions.findNegotiatorIntentSession(userId, intentId);
      if (!session) return;

      const newest = await chatSessions.getNewestMessage(session.id);
      // With an empty parked set no block can reference a parked negotiation,
      // so "newest, agent-authored, parseable block" IS the message to close.
      if (!newest || newest.role !== 'assistant' || !parseQuestionMessage(newest.content)) return;

      const updated = await chatSessions.updateQuestionMessageInPlace({
        userId,
        intentId,
        messageId: newest.id,
        content: QUESTION_MESSAGE_CLOSED_BODY,
      });
      this.logger.info(updated ? 'question_message_closed_out' : 'question_message_close_out_lost_newest_race', {
        userId,
        intentId,
        sessionId: session.id,
        messageId: newest.id,
      });
    } catch (err) {
      this.logger.warn('question_message_close_out_failed', {
        userId,
        intentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Singleton question-message queue. Use for adding jobs and starting the worker. */
export const questionMessageQueue = new QuestionMessageQueue();
