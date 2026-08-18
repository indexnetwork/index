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
 * Delivery follows the edit rule: regenerate in place only while the
 * question-message is still the newest message in the conversation; anything
 * else (user replied since, no prior message, unparseable block) appends a
 * fresh message. The open message is the newest message in the conversation
 * when it is agent-authored and references ≥1 still-parked negotiation. The
 * newest check is re-enforced inside the update statement itself, so a reply
 * racing the update wins and the job falls back to create.
 *
 * Each regeneration also flips the `questionRegenerationPending` signal on
 * the owner's conversation SSE channel — true at enqueue, false when the job
 * finishes — so an open DM shows the indicator and reloads instead of letting
 * the message change silently under the viewer.
 */
import { Job } from 'bullmq';

import { classifyParkedNegotiation, consumeQuestionBlockAnswers, parseQuestionMessage, serializeQuestionMessage } from '@indexnetwork/protocol';
import type { NegotiationAnswerConsumptionPorts, QuestionerEnqueuePayload } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { QueueFactory, useHermeticRedis } from '../lib/bullmq/bullmq';
import { QuestionMessageAuthor } from '../lib/question/question-message.author';
import { QuestionAnswerRouter } from '../lib/question/question-answer.router';
import type { ParkedNegotiationReaderAdapter } from '../adapters/parked-negotiation.reader.adapter';
import type { NegotiatorClientDmRetrieveFn } from '../adapters/negotiator-client-dm.retrieval.adapter';

export const QUEUE_NAME = 'question-message-queue';

export interface QuestionMessageJobData {
  userId: string;
  intentId: string;
}

/** One DM reply to consume against the question-message it answers. */
export interface QuestionAnswerJobData {
  userId: string;
  intentId: string;
  sessionId: string;
  /** The client's reply, verbatim. */
  replyText: string;
  /** Persisted id of the reply message; keys the job's redelivery dedup. */
  replyMessageId: string;
  /** The open question-message the reply answers, captured at reply time. */
  questionMessageId: string;
  /**
   * The question-message's body as delivered. Carried in the payload rather
   * than re-read: the reply answers the message the client saw at reply time,
   * and the edit rule cannot rewrite it afterwards (the reply itself became
   * the newest message), so the captured body stays authoritative.
   */
  questionMessageBody: string;
  /** ISO timestamp of the reply; fixed at enqueue so retries are stable. */
  repliedAt: string;
}

/**
 * Server-owned clarifying follow-up for a reply that tried to answer but
 * could not be routed to any question. Fixed copy, never model text — same
 * rule as the fallback prose above.
 */
export const QUESTION_ANSWER_CLARIFICATION_MESSAGE =
  'I could not confidently match that reply to the questions above. '
  + 'Could you say which question you are answering, or restate the answer together with it?';

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
  /** Newest message in the conversation — the edit rule's anchor read. */
  getNewestMessage(sessionId: string): Promise<{ id: string; role: 'user' | 'assistant' | 'system'; content: string } | null>;
  /**
   * In-place rewrite of the open question-message. Returns false when the
   * data layer's newest-message guard rejected the write (a reply raced the
   * regeneration) and the caller must append a fresh message instead.
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
  clientDm?: NegotiatorClientDmRetrieveFn;
  author?: Pick<QuestionMessageAuthor, 'author'>;
  chatSessions?: QuestionMessageChatSessions;
  /** Signal text for grounding; null when unavailable. */
  getIntentText?: (intentId: string) => Promise<string | null>;
  /** Answer-consumption seams (#1432); production builds them from the adapters. */
  answerPorts?: NegotiationAnswerConsumptionPorts;
  answerRouter?: Pick<QuestionAnswerRouter, 'route'>;
  /** SSE flip for the live `questionRegenerationPending` signal; production publishes to the owner's conversation channel. */
  publishRegenerationEvent?: (userId: string, event: { intentId: string; pending: boolean }) => Promise<void>;
}

export class QuestionMessageQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<QuestionMessageJobData | QuestionAnswerJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('QuestionMessageJob');
  private readonly queueLogger = log.queue.from('QuestionMessageQueue');
  private readonly deps: QuestionMessageQueueDeps | undefined;
  private author: Pick<QuestionMessageAuthor, 'author'> | null;
  private worker: ReturnType<typeof QueueFactory.createWorker<QuestionMessageJobData | QuestionAnswerJobData>> | null = null;

  constructor(deps?: QuestionMessageQueueDeps) {
    this.deps = deps;
    this.author = deps?.author ?? null; // lazy — created on first job
  }

  /**
   * Enqueue a regeneration for one signal's question-message. The singleton
   * job id dedups triggers while a job is queued; completed and failed jobs
   * are removed immediately so the id is reusable for the next park.
   *
   * Also flips the live pending signal on: an open DM shows the regeneration
   * indicator from enqueue, not from the next bootstrap.
   */
  async addRegenerateJob(data: QuestionMessageJobData): Promise<Job<QuestionMessageJobData | QuestionAnswerJobData>> {
    const job = await this.queue.add('regenerate_question_message', data, {
      jobId: questionMessageJobId(data.userId, data.intentId),
      removeOnComplete: true,
      removeOnFail: true,
    });
    await this.publishRegenerationPending(data.userId, data.intentId, true);
    return job;
  }

  /**
   * Enqueue consumption of one DM reply against its open question-message.
   * Runs on THIS queue deliberately: the worker processes one job at a time,
   * so answer consumption is serialized against regeneration under the same
   * `question-message.${userId}.${intentId}` path — an answer and a
   * regeneration for the same signal can never interleave. The job id is the
   * reply message's id, so a redelivered request coalesces instead of
   * consuming the same reply twice.
   */
  addConsumeAnswerJob(data: QuestionAnswerJobData): Promise<Job<QuestionMessageJobData | QuestionAnswerJobData>> {
    return this.queue.add('consume_question_answers', data, {
      jobId: `question-message-answer.${data.replyMessageId}`,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /**
   * True iff the signal's regeneration job is queued or running — the
   * `questionRegenerationPending` loading-state contract with the web steps
   * UI (#1431): while true, the DM shows a pending indicator instead of a
   * half-stale message. Fails open to false; a Redis hiccup must not break
   * session resolution.
   */
  async isRegenerationPending(userId: string, intentId: string): Promise<boolean> {
    try {
      const job = await this.queue.getJob(questionMessageJobId(userId, intentId));
      if (!job) return false;
      const state = await job.getState();
      return state === 'waiting' || state === 'delayed' || state === 'active'
        || state === 'prioritized' || state === 'waiting-children';
    } catch (err) {
      this.queueLogger.warn('Regeneration-pending lookup failed; reporting not pending', {
        userId,
        intentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** Run a job handler (used by the worker and by tests with injected deps). */
  async processJob(name: string, data: QuestionMessageJobData | QuestionAnswerJobData): Promise<void> {
    switch (name) {
      case 'regenerate_question_message':
        await this.handleRegenerate(data as QuestionMessageJobData);
        // Flip the live pending signal off only on success: a throw leaves the
        // job queued for retry, and pending stays true with it. A client stuck
        // on true after a terminal failure recovers on its next bootstrap.
        await this.publishRegenerationPending(data.userId, data.intentId, false);
        break;
      case 'consume_question_answers':
        await this.handleConsumeAnswers(data as QuestionAnswerJobData);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  /** Start the BullMQ worker. Idempotent; call from the protocol server only. */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<QuestionMessageJobData | QuestionAnswerJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<QuestionMessageJobData | QuestionAnswerJobData>(QUEUE_NAME, processor);
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

    // The edit rule: regenerate in place only while the question-message is
    // still the newest message in the conversation; otherwise send a fresh
    // one. Open = newest + agent-authored + references ≥1 still-parked
    // negotiation (the parked set just read IS this user's still-parked side).
    const openMessage = this.findOpenQuestionMessage(
      await chatSessions.getNewestMessage(resolved.session.id),
      parked,
    );
    if (openMessage) {
      const updated = await chatSessions.updateQuestionMessageInPlace({
        userId,
        intentId,
        messageId: openMessage.id,
        content: body,
      });
      if (updated) {
        this.logger.info('question_message_regenerated_in_place', {
          userId,
          intentId,
          sessionId: resolved.session.id,
          messageId: openMessage.id,
          parked: parked.length,
          questions: authored.questions.length,
        });
        return;
      }
      // The data layer's newest guard rejected the write: a reply landed
      // between the anchor read and the update. The reply wins — fall through
      // to a fresh message below it.
      this.logger.info('question_message_update_lost_newest_race', {
        userId,
        intentId,
        sessionId: resolved.session.id,
        messageId: openMessage.id,
      });
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

  /**
   * The open question-message, per the plan's definition: the newest message
   * in the conversation, when it is agent-authored, carries a parseable
   * question block, and that block references at least one negotiation in
   * the current parked set. Anything else — user replied since, plain agent
   * prose, an unparseable block, refs all resolved — is not open, and the
   * regeneration appends instead.
   */
  private findOpenQuestionMessage(
    newest: { id: string; role: 'user' | 'assistant' | 'system'; content: string } | null,
    parked: ReadonlyArray<{ opportunityId: string }>,
  ): { id: string } | null {
    if (!newest || newest.role !== 'assistant') return null;
    const parsed = parseQuestionMessage(newest.content);
    if (!parsed) return null;
    const parkedRefs = new Set(parked.map((negotiation) => negotiation.opportunityId));
    const referencesParked = parsed.block.questions.some((question) =>
      [question.opportunityId, ...(question.alsoUnblocks ?? [])].some((ref) => parkedRefs.has(ref)));
    return referencesParked ? { id: newest.id } : null;
  }

  /**
   * Best-effort flip of the live `questionRegenerationPending` signal on the
   * owner's conversation SSE channel. Never throws — the signal is a UX
   * enhancement over the bootstrap snapshot, and a Redis hiccup must not
   * break the enqueue path or fail a finished job. Skipped entirely under
   * hermetic tests unless a publisher is injected.
   */
  private async publishRegenerationPending(userId: string, intentId: string, pending: boolean): Promise<void> {
    try {
      const publish = this.deps?.publishRegenerationEvent
        ?? (useHermeticRedis()
          ? null
          : (await import('../lib/conversation-events')).publishQuestionRegenerationEvent);
      if (!publish) return;
      await publish(userId, { intentId, pending });
    } catch (err) {
      this.queueLogger.warn('question_regeneration_pending_publish_failed', {
        userId,
        intentId,
        pending,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Consume one DM reply against its question-message: verify the message is
   * still open (≥1 ref still parked on this user's side), route the reply's
   * content onto block refs via the negotiator, and hand the routed answers
   * to the resume seam (#1432). A reply that matches nothing resumes
   * NOTHING — unmatched or empty routing gets a clarifying follow-up in the
   * DM, never a speculative resume.
   */
  private async handleConsumeAnswers(data: QuestionAnswerJobData): Promise<void> {
    const { userId, intentId, sessionId } = data;

    const parsed = parseQuestionMessage(data.questionMessageBody);
    if (!parsed) {
      // Enqueue-time detection parsed this same body; a failure here means a
      // malformed payload, not a malformed message. Nothing to consume.
      this.queueLogger.warn('question_answer_unparseable_block', { userId, intentId, questionMessageId: data.questionMessageId });
      return;
    }
    const block = parsed.block;

    const ports = this.deps?.answerPorts
      ?? (await import('../lib/question/negotiation-answer.ports')).negotiationAnswerConsumptionPorts();

    // Open-message check, re-derived at consumption time: the message is
    // answerable iff at least one referenced negotiation is still parked
    // awaiting THIS user. A block whose parks all resolved since the reply
    // landed is closed — the reply is ordinary conversation, not an answer.
    let hasParkedRef = false;
    for (const question of block.questions) {
      for (const ref of [question.opportunityId, ...(question.alsoUnblocks ?? [])]) {
        const classification = await classifyParkedNegotiation(ports.database, { opportunityId: ref, userId });
        if (classification.kind === 'inflight' || classification.kind === 'post_stall') {
          hasParkedRef = true;
          break;
        }
      }
      if (hasParkedRef) break;
    }
    if (!hasParkedRef) {
      this.logger.info('question_answer_message_closed', { userId, intentId, questionMessageId: data.questionMessageId });
      return;
    }

    // Routing is interpretive (an LLM maps text onto refs) and has no safe
    // fallback; a hard routing failure throws so the queue's retry policy
    // covers a transient model outage.
    const router = this.deps?.answerRouter ?? new QuestionAnswerRouter();
    const routed = await router.route({ block, replyText: data.replyText });
    if (!routed.addressesQuestions) {
      // Ordinary conversation in a DM with an open question-message. The
      // negotiator's chat reply handles it; consumption stays silent.
      this.logger.info('question_answer_not_an_answer', { userId, intentId, questionMessageId: data.questionMessageId });
      return;
    }

    const result = await consumeQuestionBlockAnswers(ports, {
      block,
      userId,
      answers: routed.answers,
      answeredAt: data.repliedAt,
    });
    this.logger.info('question_answer_consumed', {
      userId,
      intentId,
      questionMessageId: data.questionMessageId,
      resumed: result.resumed.length,
      skipped: result.skipped.length,
      unmatched: result.unmatched.length,
      needsClarification: result.needsClarification,
    });

    if (result.needsClarification) {
      const chatSessions = this.deps?.chatSessions ?? (await import('../services/chat.service')).chatSessionService;
      await chatSessions.addMessage({
        sessionId,
        role: 'assistant',
        content: QUESTION_ANSWER_CLARIFICATION_MESSAGE,
      });
    }
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

/** Injectable seams for {@link enqueueQuestionAnswerReply}; production uses the real collaborators. */
export interface QuestionAnswerReplyDetectionDeps {
  getSessionMessages?: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string }>>;
  addConsumeAnswerJob?: (data: QuestionAnswerJobData) => Promise<unknown>;
}

/**
 * Reply detection for the negotiator DM: when a user message lands in a
 * ('negotiator-intent', intentId) session, check whether the conversation has
 * an open question-message — the newest AGENT message, when it carries a
 * parseable question block — and if so enqueue consumption of the reply
 * against it. Runs after the reply is persisted and BEFORE the negotiator's
 * streamed response is, so "newest agent message" is still the message the
 * client was answering. The still-parked half of the open-message predicate
 * is deliberately left to the serialized job: it is authoritative there, and
 * a block whose parks all resolved simply consumes to nothing.
 *
 * Returns whether a consumption job was enqueued. Never throws — reply
 * detection must not break the chat turn.
 */
export async function enqueueQuestionAnswerReply(
  input: {
    userId: string;
    intentId: string;
    sessionId: string;
    replyText: string;
    replyMessageId: string;
  },
  deps?: QuestionAnswerReplyDetectionDeps,
): Promise<boolean> {
  const detectionLogger = log.lib.from('question-answer.reply-detection');
  try {
    const getSessionMessages = deps?.getSessionMessages
      ?? (async (sessionId: string) => (await import('../services/chat.service')).chatSessionService.getSessionMessages(sessionId));
    const messages = await getSessionMessages(input.sessionId);
    const newestAgentMessage = [...messages].reverse().find((message) => message.role === 'assistant');
    if (!newestAgentMessage) return false;
    const parsed = parseQuestionMessage(newestAgentMessage.content);
    if (!parsed) return false;

    const addConsumeAnswerJob = deps?.addConsumeAnswerJob
      ?? ((data: QuestionAnswerJobData) => questionMessageQueue.addConsumeAnswerJob(data));
    await addConsumeAnswerJob({
      userId: input.userId,
      intentId: input.intentId,
      sessionId: input.sessionId,
      replyText: input.replyText,
      replyMessageId: input.replyMessageId,
      questionMessageId: newestAgentMessage.id,
      questionMessageBody: newestAgentMessage.content,
      repliedAt: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    detectionLogger.error('Question-answer reply detection failed; reply not consumed', {
      userId: input.userId,
      intentId: input.intentId,
      sessionId: input.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
