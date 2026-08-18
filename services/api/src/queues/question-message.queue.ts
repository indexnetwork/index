/**
 * Question-message regeneration queue (conversational-questions delivery
 * spine, docs/plans/2026-08-18-conversational-questions.md).
 *
 * All question-message work for one signal funnels through one singleton job
 * keyed `question-message.${userId}.${intentId}`, so two negotiations parking
 * at the same moment cannot race to write the message. The job is a pure
 * regeneration: read the parked set, author the message via the negotiator
 * (grounded in the parked transcripts and the signal's client-DM excerpt),
 * serialize the question block, deliver into the signal's A2H DM — the
 * conversation keyed ('negotiator-intent', intentId). An empty parked set
 * means there is nothing to say and the job is done.
 *
 * This queue also owns the trigger routing: the payloads with which the park
 * paths used to enqueue the QuestionerAgent (`negotiation_inflight` consults
 * and `stalled_followup` post-stall parks) are re-routed here by the
 * questioner enqueue wrappers. The old generator's machinery stays; only
 * these two payload families stop reaching it (retirements are a later
 * phase).
 *
 * Create-only for now: a regeneration always appends a fresh message. The
 * edit rule (update the newest message in place) is the next change, so a
 * second park while a message is already open produces a second message —
 * known and accepted.
 */
import { Job } from 'bullmq';

import { serializeQuestionMessage } from '@indexnetwork/protocol';
import type { QuestionerEnqueuePayload } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { QuestionMessageAuthor } from '../lib/question/question-message.author';
import type { ParkedNegotiationReaderAdapter } from '../adapters/parked-negotiation.reader.adapter';
import type { NegotiatorClientDmRetrieveFn } from '../adapters/negotiator-client-dm.retrieval.adapter';

export const QUEUE_NAME = 'question-message-queue';

export interface QuestionMessageJobData {
  userId: string;
  intentId: string;
}

/**
 * Singleton job id per scope: while a regeneration is queued for a signal,
 * further triggers coalesce into it instead of racing it. Dashes only —
 * BullMQ reserves colons for Redis key namespacing.
 */
export function questionMessageJobId(userId: string, intentId: string): string {
  return `question-message.${userId}.${intentId}`;
}

/**
 * Structural slice of ChatSessionService: resolve-or-create the signal's
 * negotiator DM, then append into it. Kept structural so tests can stub it
 * without the full service type.
 */
export interface QuestionMessageChatSessions {
  resolveNegotiatorIntentSession(userId: string, intentId: string): Promise<
    | { session: { id: string } }
    | { error: string; status: 400 | 403 | 404 | 500 }
  >;
  addMessage(params: { sessionId: string; role: 'user' | 'assistant' | 'system'; content: string }): Promise<string>;
}

/** Optional deps for testing; production resolves the real collaborators lazily. */
export interface QuestionMessageQueueDeps {
  parkedSet?: Pick<ParkedNegotiationReaderAdapter, 'readParkedNegotiations'>;
  clientDm?: NegotiatorClientDmRetrieveFn;
  author?: Pick<QuestionMessageAuthor, 'author'>;
  chatSessions?: QuestionMessageChatSessions;
  /** Signal text for grounding; null when unavailable. */
  getIntentText?: (intentId: string) => Promise<string | null>;
}

export class QuestionMessageQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<QuestionMessageJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('QuestionMessageJob');
  private readonly queueLogger = log.queue.from('QuestionMessageQueue');
  private readonly deps: QuestionMessageQueueDeps | undefined;
  private author: Pick<QuestionMessageAuthor, 'author'> | null;
  private worker: ReturnType<typeof QueueFactory.createWorker<QuestionMessageJobData>> | null = null;

  constructor(deps?: QuestionMessageQueueDeps) {
    this.deps = deps;
    this.author = deps?.author ?? null; // lazy — created on first job
  }

  /**
   * Enqueue a regeneration for one signal's question-message. The singleton
   * job id dedups triggers while a job is queued; completed and failed jobs
   * are removed immediately so the id is reusable for the next park.
   */
  addRegenerateJob(data: QuestionMessageJobData): Promise<Job<QuestionMessageJobData>> {
    return this.queue.add('regenerate_question_message', data, {
      jobId: questionMessageJobId(data.userId, data.intentId),
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /** Run a job handler (used by the worker and by tests with injected deps). */
  async processJob(name: string, data: QuestionMessageJobData): Promise<void> {
    switch (name) {
      case 'regenerate_question_message':
        await this.handleRegenerate(data);
        break;
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

  private async handleRegenerate(data: QuestionMessageJobData): Promise<void> {
    const { userId, intentId } = data;

    const parkedSet = this.deps?.parkedSet ?? (await import('../adapters/parked-negotiation.reader.adapter')).parkedNegotiationReaderAdapter;
    const parked = await parkedSet.readParkedNegotiations(userId, intentId);
    if (parked.length === 0) {
      // Normal, not exceptional: the trigger may have raced an unpark, or the
      // stall it fired for was terminal (no gap).
      this.logger.info('question_message_empty_parked_set', { userId, intentId });
      return;
    }

    const clientDmRetrieve = this.deps?.clientDm
      ?? (await import('../adapters/negotiator-client-dm.retrieval.adapter')).negotiatorClientDmRetrieve();
    const clientDm = await clientDmRetrieve({ userId, intentId });

    const getIntentText = this.deps?.getIntentText ?? (async (id: string) => {
      const { chatDatabaseAdapter } = await import('../adapters/database.adapter');
      const intent = await chatDatabaseAdapter.getIntentForIndexing(id);
      return intent?.payload ?? null;
    });
    const signalText = await getIntentText(intentId).catch(() => null);

    const author = this.getAuthor();
    const authored = await author.author({
      ...(signalText ? { signalText } : {}),
      parked,
      clientDm,
    });
    if (!authored) {
      this.logger.warn('question_message_nothing_renderable', { userId, intentId, parked: parked.length });
      return;
    }

    const body = serializeQuestionMessage(authored.prose, { version: 1, questions: authored.questions });

    const chatSessions = this.deps?.chatSessions ?? (await import('../services/chat.service')).chatSessionService;
    const resolved = await chatSessions.resolveNegotiatorIntentSession(userId, intentId);
    if ('error' in resolved) {
      // 400/403/404 are permanent for this scope (archived or foreign
      // intent): suppress rather than retry, mirroring the pool push queue.
      if (resolved.status === 500) {
        throw new Error(`Negotiator session resolution failed: ${resolved.error}`);
      }
      this.logger.warn('question_message_session_unavailable', {
        userId,
        intentId,
        status: resolved.status,
        error: resolved.error,
      });
      return;
    }

    await chatSessions.addMessage({
      sessionId: resolved.session.id,
      role: 'assistant',
      content: body,
    });
    this.logger.info('question_message_delivered', {
      userId,
      intentId,
      sessionId: resolved.session.id,
      parked: parked.length,
      questions: authored.questions.length,
    });
  }

  private getAuthor(): Pick<QuestionMessageAuthor, 'author'> {
    if (!this.author) this.author = new QuestionMessageAuthor();
    return this.author;
  }
}

/** Singleton question-message queue. Use for adding jobs and starting the worker. */
export const questionMessageQueue = new QuestionMessageQueue();

/**
 * The regeneration target carried by a park-path questioner payload, or null
 * for every payload family that still belongs to the QuestionerAgent.
 * Both park families name the parked side as `negotiation.recipient*` — the
 * user whose input is required and the signal whose DM carries the question.
 */
export function parkedQuestionMessageTarget(input: QuestionerEnqueuePayload): QuestionMessageJobData | null {
  const isParkFamily =
    (input.mode === 'negotiation_inflight' && input.purpose === 'inflight_consultation')
    || (input.mode === 'negotiation' && input.purpose === 'stalled_followup');
  if (!isParkFamily || !input.negotiation) return null;
  const { recipientUserId, recipientIntentId } = input.negotiation;
  if (!recipientUserId || !recipientIntentId) return null;
  return { userId: recipientUserId, intentId: recipientIntentId };
}

/**
 * Trigger hook for the park paths: when the payload is one a park used to
 * hand the QuestionerAgent, enqueue the regeneration job for the parked
 * side's scope instead and report the payload as handled. Everything else
 * returns false and flows to the questioner unchanged.
 */
export async function routeParkedQuestionEnqueue(input: QuestionerEnqueuePayload): Promise<boolean> {
  const target = parkedQuestionMessageTarget(input);
  if (!target) return false;
  await questionMessageQueue.addRegenerateJob(target);
  return true;
}
