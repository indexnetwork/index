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
 * Nothing is re-implemented: this resolves the open questions through the SAME
 * call the gate and the orchestrator's context enumeration make
 * (`readOpenQuestionsForIntent`), maps the number the model was shown onto
 * that block's negotiation ref, and enqueues consumption on the same
 * serialized question-message queue with the answer pre-routed. Every resume,
 * settle and retry below that is the #1432 spine, untouched.
 *
 * One call, not one rule written twice — that is load-bearing. On 2026-08-20
 * the model was shown an open question and called this tool with `question: 1`
 * while the host resolved nothing open and answered `no_open_question`, whose
 * copy tells the client "the negotiations moved on". They had not: the task
 * was `input_required` and stayed so for the rest of the window. Since
 * openness is the parked set, `no_open_question` is now reachable only when
 * the parks have genuinely resolved or expired — which is the only state that
 * copy is true of.
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
    // Nothing parked on this user's side for this signal. The only state in
    // which telling the client the negotiations moved on is the truth.
    if (!open || open.questions.length === 0) return { status: 'no_open_question' };
    if (!open.sessionId) {
      // Parked, answerable, but the signal has no DM to consume the reply in —
      // which cannot happen from a tool call made inside that very DM. Report
      // the honest failure rather than the false close-out.
      logger.warn('negotiator_answer_no_session', { userId, intentId: input.intentId });
      return { status: 'error' };
    }

    const question = open.questions.find((candidate) => candidate.position === input.question);
    if (!question) {
      logger.info('negotiator_answer_unknown_question', {
        userId,
        intentId: input.intentId,
        question: input.question,
        open: open.questions.length,
        source: open.source,
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
      source: open.source,
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
