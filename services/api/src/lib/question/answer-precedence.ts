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
 */
import { classifyParkedNegotiation, parseQuestionMessage } from '@indexnetwork/protocol';
import type { NegotiationAnswerConsumptionPorts, QuestionBlock, RoutedAnswer } from '@indexnetwork/protocol';

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
 * - `no_open_question`: nothing is open in this scope (the common case). The
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
    questionMessageId: string;
    /** The block body as delivered — the message the client was answering. */
    questionMessageBody: string;
    /** The reply routed onto the block's negotiation refs; never empty. */
    routedAnswers: RoutedAnswer[];
  };

/** Injectable seams; production resolves the real collaborators lazily. */
export interface AnswerPrecedenceDeps {
  getSessionMessages?: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string }>>;
  answerPorts?: NegotiationAnswerConsumptionPorts;
  answerRouter?: Pick<QuestionAnswerRouter, 'route'>;
}

/**
 * The open question-message of a negotiator DM: the newest AGENT message,
 * when it carries a parseable question block. The still-parked half of the
 * predicate is checked separately below — it costs negotiation reads, and the
 * cheap half rules out every ordinary conversation first.
 */
function openQuestionMessage(
  messages: Array<{ id: string; role: string; content: string }>,
): { id: string; content: string; block: QuestionBlock } | null {
  const newestAgentMessage = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!newestAgentMessage) return null;
  const parsed = parseQuestionMessage(newestAgentMessage.content);
  if (!parsed) return null;
  return { id: newestAgentMessage.id, content: newestAgentMessage.content, block: parsed.block };
}

/**
 * True while at least one negotiation the block references is still parked on
 * THIS user's side. A block whose parks all resolved is closed: its questions
 * are no longer answerable, so a reply to it is ordinary conversation and the
 * gate must not stand in the orchestrator's way.
 */
async function referencesStillParked(
  ports: NegotiationAnswerConsumptionPorts,
  block: QuestionBlock,
  userId: string,
): Promise<boolean> {
  for (const question of block.questions) {
    for (const ref of [question.opportunityId, ...(question.alsoUnblocks ?? [])]) {
      const classification = await classifyParkedNegotiation(ports.database, { opportunityId: ref, userId });
      if (classification.kind === 'inflight' || classification.kind === 'post_stall') return true;
    }
  }
  return false;
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

    const getSessionMessages = deps?.getSessionMessages
      ?? (async (sessionId: string) => (await import('../../services/chat.service')).chatSessionService.getSessionMessages(sessionId));
    const open = openQuestionMessage(await getSessionMessages(input.sessionId));
    if (!open) return { status: 'no_open_question' };

    const ports = deps?.answerPorts
      ?? (await import('./negotiation-answer.ports')).negotiationAnswerConsumptionPorts();
    if (!await referencesStillParked(ports, open.block, input.userId)) {
      logger.info('question_answer_precedence_message_closed', {
        userId: input.userId,
        intentId: input.intentId,
        questionMessageId: open.id,
      });
      return { status: 'no_open_question' };
    }

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
        questionMessageId: open.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: 'unavailable', questionMessageId: open.id };
    }

    // `addressesQuestions` with nothing extracted is not an answer this path
    // can consume — consumption would resume nothing and ask again. It is
    // exactly the oblique case the orchestrator's tool exists for, so it falls
    // through rather than burning the turn on a clarifying follow-up.
    if (!routed.addressesQuestions || routed.answers.length === 0) {
      logger.info('question_answer_precedence_declined', {
        userId: input.userId,
        intentId: input.intentId,
        questionMessageId: open.id,
        addressesQuestions: routed.addressesQuestions,
      });
      return { status: 'declined', questionMessageId: open.id };
    }

    logger.info('question_answer_precedence_answered', {
      userId: input.userId,
      intentId: input.intentId,
      questionMessageId: open.id,
      answers: routed.answers.length,
    });
    return {
      status: 'answered',
      questionMessageId: open.id,
      questionMessageBody: open.content,
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
