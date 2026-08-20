/**
 * Host bridge behind the negotiator persona's `answer_pending_question` tool
 * (#1466) — the long-tail lane of answer routing.
 *
 * The deterministic lane is upstream and does not involve a model with tools:
 * while a signal's DM has an open question, a free-text reply is offered to
 * the answer evaluator BEFORE the orchestrator runs, and an accepted answer
 * never reaches it (`answer-precedence.ts`). What arrives here is what the
 * evaluator declined — an oblique answer, a late one, or one folded into a
 * message that is also doing something else — plus the case where the
 * evaluator itself was unavailable.
 *
 * Nothing is re-implemented: this resolves the same open question-message the
 * gate anchors on, maps the number the model was shown onto that block's
 * negotiation ref, and enqueues consumption on the same serialized
 * question-message queue with the answer pre-routed. Every resume, settle and
 * retry below that is the #1432 spine, untouched.
 *
 * The tool never sees or emits an id. It is given positions, it returns
 * positions, and this module owns the mapping — the same rule that keeps the
 * answer router from minting a ref that would resume the wrong negotiation.
 */
import { readOpenQuestionsForIntent } from './open-question-message';
import type { OpenQuestionsForIntentDeps } from './open-question-message';
import { enqueueQuestionAnswerReply } from '../../queues/question-message.queue';
import { log } from '../log';

const logger = log.lib.from('negotiator-answer.host');

/** Mirrors the protocol's `NegotiatorAnswerRoutingResult`; structural by design. */
export type NegotiatorAnswerRoutingResult =
  | { status: 'routed'; label: string }
  | { status: 'no_open_question' }
  | { status: 'unknown_question'; open: number }
  | { status: 'error' };

/** Injectable seams; production resolves the real collaborators. */
export interface NegotiatorAnswerHostDeps extends OpenQuestionsForIntentDeps {
  enqueueAnswer?: typeof enqueueQuestionAnswerReply;
}

/**
 * Route one answer the orchestrator extracted onto the open question it names.
 *
 * Never throws — a tool that throws costs the client their turn, and the
 * honest failure the model is told to report is strictly better than that.
 */
export async function answerOpenQuestion(
  userId: string,
  input: { intentId: string; question: number; answer: string },
  deps?: NegotiatorAnswerHostDeps,
): Promise<NegotiatorAnswerRoutingResult> {
  try {
    const answerText = input.answer.trim();
    if (!answerText) return { status: 'error' };

    const open = await readOpenQuestionsForIntent(userId, input.intentId, deps);
    if (!open || open.questions.length === 0) return { status: 'no_open_question' };

    const question = open.questions.find((candidate) => candidate.position === input.question);
    if (!question) {
      logger.info('negotiator_answer_unknown_question', {
        userId,
        intentId: input.intentId,
        question: input.question,
        open: open.questions.length,
      });
      return { status: 'unknown_question', open: open.questions.length };
    }

    const enqueueAnswer = deps?.enqueueAnswer ?? enqueueQuestionAnswerReply;
    const enqueued = await enqueueAnswer({
      userId,
      intentId: input.intentId,
      sessionId: open.sessionId,
      replyText: answerText,
      // No persisted reply id here: the tool fires mid-turn, before the
      // client's message has one. Keying on the negotiation instead makes two
      // tool calls for the same question in one turn coalesce, which is the
      // only duplication this path can produce — and everything below the
      // enqueue is settlement-keyed and idempotent anyway.
      replyMessageId: `tool-answer.${question.opportunityId}`,
      precedence: {
        questionMessageId: open.messageId,
        questionMessageBody: open.body,
        routedAnswers: [{ ref: question.opportunityId, answerText }],
      },
    });
    if (!enqueued) return { status: 'error' };

    logger.info('negotiator_answer_routed', {
      userId,
      intentId: input.intentId,
      questionMessageId: open.messageId,
      opportunityId: question.opportunityId,
    });
    return { status: 'routed', label: question.label };
  } catch (err) {
    logger.error('negotiator_answer_route_failed', {
      userId,
      intentId: input.intentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 'error' };
  }
}

/** The host object the composition root injects into the negotiator toolset. */
export const negotiatorAnswerToolsHost = {
  answerOpenQuestion: (
    userId: string,
    input: { intentId: string; question: number; answer: string },
  ) => answerOpenQuestion(userId, input),
};
