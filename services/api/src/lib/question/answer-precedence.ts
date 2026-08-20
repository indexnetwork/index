/**
 * Answer precedence: a free-text reply in a signal's negotiator DM is offered
 * to the answer evaluator BEFORE the chat orchestrator sees it, whenever that
 * DM has an open question.
 *
 * Why it is an order and not a preference. Both consumers of a DM reply
 * already existed: the answer spine (route the reply onto the open question
 * block, resume the parked negotiations) and the chat orchestrator (converse,
 * and edit the signal when the client sharpens it). They ran in the wrong
 * order — the orchestrator streamed first, tools and all, and the answer
 * detection fired only after it had finished. On 2026-08-20 a negotiation
 * parked on "Timing: This week" asked its client, the client replied
 * "This month?" three minutes later, and the orchestrator's signal edit rule
 * consumed it: the intent was rewritten, and the negotiation that asked is
 * still parked. Nothing about that was a bug in either consumer. It was the
 * order.
 *
 * So: while a question is open in this scope, the evaluator gets the reply
 * first, deterministically. Only a reply it DECLINES falls through to the
 * orchestrator, which then behaves exactly as it does today — including the
 * edit rule. With no open question nothing here runs at all.
 *
 * The judgment itself is not rebuilt: `QuestionAnswerRouter` already decides
 * whether text answers an open question and extracts what it answers (#1432).
 * This module owns only the ORDER and the fall-through rule.
 *
 * Fail-open, deliberately. A provider outage must not turn an ordinary
 * conversational turn into a canned refusal, so an evaluator that cannot
 * answer falls through to the orchestrator — which, since #1466, is told an
 * open question exists in this scope and carries the tool to route an answer
 * explicitly. That is the long tail's lane, not a silent loss.
 *
 * What "open" means is NOT this module's judgment and no longer its code. It
 * used to be: the gate anchored on the newest agent message and asked whether
 * that message parsed as a question block. On 2026-08-20, 21:11, that
 * predicate silently closed a question whose task had been `input_required`
 * for fifty-one minutes — an edit-confirmation posted three minutes after the
 * question had made it no longer the newest message — and the client's answer
 * fell through to the orchestrator, which edited the signal from it. The
 * second time that happened in one evening. Openness is now resolved from the
 * PARKED SET by `readOpenQuestionsForIntent`, the same call the
 * `answer_pending_question` host and the orchestrator's context enumeration
 * make, so no two lanes can disagree about what is open.
 */
import type { RoutedAnswer } from '@indexnetwork/protocol';

import type { ParkedNegotiation } from '../../adapters/parked-negotiation.reader.adapter';
import { readOpenQuestionsForIntent } from './open-question-message';
import { QuestionAnswerRouter } from './question-answer.router';
import { log } from '../log';

const logger = log.lib.from('question-answer.precedence');

/**
 * Server-owned acknowledgement for a reply the evaluator took as an answer.
 * Fixed copy, never model text — the same rule the close-out and clarification
 * messages follow. An accepted answer does not reach the orchestrator, so this
 * is what the client sees while the serialized consumption job resumes the
 * negotiations the answer unparks.
 */
export const QUESTION_ANSWER_ACKNOWLEDGEMENT =
  'Got it — I have taken that as your answer and sent it back to the conversations that were waiting on it. '
  + 'I will let you know here when they move.';

/**
 * What the gate decided.
 *
 * - `no_open_question`: nothing is PARKED on this user's side for this signal
 *   (the common case), or openness could not be resolved at all. The
 *   orchestrator path is untouched, byte for byte.
 * - `declined`: a question is open and the evaluator says this reply does not
 *   answer it. Falls through to the orchestrator, edit rule included.
 * - `unavailable`: a question is open and the evaluator could not decide (a
 *   model failure). Falls through, with the open question named in the
 *   orchestrator's context.
 * - `answered`: the reply answers the open question. The orchestrator is
 *   skipped and the routed answers are consumed.
 */
export type AnswerPrecedence =
  | { status: 'no_open_question' }
  | { status: 'declined'; questionMessageId: string }
  | { status: 'unavailable'; questionMessageId: string }
  | {
    status: 'answered';
    /**
     * The delivered question-message's id, or the synthetic id of a derived
     * block (`derivedQuestionMessageId`). Carried through to the
     * consumption job, which uses it for logging only — routing is the refs
     * inside the body.
     */
    questionMessageId: string;
    /**
     * The block body the answer is consumed against: the message as delivered
     * when one renders the park, else the body serialized from the parked set
     * itself. Either way it carries the same negotiation refs, so consumption
     * re-resolves the same parks and settles under the same settlement ids.
     */
    questionMessageBody: string;
    /** The reply routed onto the block's negotiation refs; never empty. */
    routedAnswers: RoutedAnswer[];
  };

/** Injectable seams; production resolves the real collaborators lazily. */
export interface AnswerPrecedenceDeps {
  getSessionMessages?: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string }>>;
  /** This user's parked negotiations on this signal — the openness authority. */
  readParkedNegotiations?: (userId: string, intentId: string) => Promise<ReadonlyArray<ParkedNegotiation>>;
  answerRouter?: Pick<QuestionAnswerRouter, 'route'>;
}

/**
 * Decide, before the orchestrator runs, whether this reply is an answer to the
 * scope's open question.
 *
 * Never throws: every failure resolves to a fall-through status, because the
 * alternative — failing a chat turn — is worse than asking the client again.
 */
export async function evaluateQuestionAnswerPrecedence(
  input: { userId: string; intentId: string; sessionId: string; replyText: string },
  deps?: AnswerPrecedenceDeps,
): Promise<AnswerPrecedence> {
  try {
    if (!input.replyText.trim()) return { status: 'no_open_question' };

    // Openness is the parked set, resolved once, by the same call every other
    // answer lane makes. The parked read is also the cheap short-circuit: an
    // ordinary conversational turn ends here, on one scoped indexed query,
    // without reading a message.
    const open = await readOpenQuestionsForIntent(input.userId, input.intentId, {
      // The session is already resolved for this turn; the resolver must not
      // look it up again, and must anchor on THIS conversation.
      findSession: async () => ({ id: input.sessionId }),
      ...(deps?.getSessionMessages ? { getSessionMessages: deps.getSessionMessages } : {}),
      ...(deps?.readParkedNegotiations ? { readParkedNegotiations: deps.readParkedNegotiations } : {}),
    });
    if (!open) return { status: 'no_open_question' };

    const router = deps?.answerRouter ?? new QuestionAnswerRouter();
    let routed;
    try {
      routed = await router.route({ block: open.block, replyText: input.replyText });
    } catch (err) {
      // The evaluator is the only judge here and it did not answer. Falling
      // through is the honest move: the orchestrator can see the open question
      // and route explicitly, and the client's turn still gets a reply.
      logger.warn('question_answer_precedence_evaluator_unavailable', {
        userId: input.userId,
        intentId: input.intentId,
        questionMessageId: open.messageId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: 'unavailable', questionMessageId: open.messageId };
    }

    // `addressesQuestions` with nothing extracted is not an answer this path
    // can consume — consumption would resume nothing and ask again. It is
    // exactly the oblique case the orchestrator's tool exists for, so it falls
    // through rather than burning the turn on a clarifying follow-up.
    if (!routed.addressesQuestions || routed.answers.length === 0) {
      logger.info('question_answer_precedence_declined', {
        userId: input.userId,
        intentId: input.intentId,
        questionMessageId: open.messageId,
        addressesQuestions: routed.addressesQuestions,
      });
      return { status: 'declined', questionMessageId: open.messageId };
    }

    logger.info('question_answer_precedence_answered', {
      userId: input.userId,
      intentId: input.intentId,
      questionMessageId: open.messageId,
      // Delivered or derived: which one it was says whether the client was
      // answering a message they can see or a park whose rendering never
      // reached them. Both are answers; only one is also a delivery bug.
      source: open.source,
      answers: routed.answers.length,
    });
    return {
      status: 'answered',
      questionMessageId: open.messageId,
      questionMessageBody: open.body,
      routedAnswers: routed.answers,
    };
  } catch (err) {
    logger.error('question_answer_precedence_failed; falling through to the orchestrator', {
      userId: input.userId,
      intentId: input.intentId,
      sessionId: input.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 'no_open_question' };
  }
}
