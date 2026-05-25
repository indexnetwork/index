/**
 * Answer Reaction Dispatcher — routes answered-question events to mode-specific
 * handlers. Wired into `QuestionEvents.onAnswered` from `main.ts`.
 *
 * Design: Each mode handler enqueues background work into existing queues
 * rather than performing heavy processing inline. Errors are caught and logged
 * so one failing handler doesn't block others.
 *
 * Mode reactions:
 * - discovery: no-op (answers enrich chat context via the message path)
 * - profile:   create a premise from the answer → triggers profile regen
 * - intent:    enqueue intent refinement with the new context
 * - negotiation: store answer as context for the next negotiation turn
 */

import { log } from '../../lib/log';

const logger = log.service.from('QuestionAnswerHandler');

// ─── Types ──────────────────────────────────────────────────────────────────

interface QuestionAnsweredPayload {
  questionId: string;
  userId: string;
  mode: 'discovery' | 'intent' | 'profile' | 'negotiation';
  sourceType: string;
  sourceId: string;
  answer: {
    selectedOptions: string[];
    freeText?: string;
    answeredBy: string;
    answeredAt: string;
  };
}

export interface QuestionAnswerHandlerDeps {
  /** Create a premise from a profile-mode answer (enqueues profile regen via PremiseEvents). */
  createPremiseFromAnswer: (input: {
    userId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
    sourceId: string;
  }) => Promise<void>;

  /** Enqueue an intent refinement job with the answer as additional context. */
  enqueueIntentRefinement: (input: {
    userId: string;
    intentId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }) => Promise<void>;

  /** Store the answer as negotiation context for the next turn. */
  storeNegotiationContext: (input: {
    userId: string;
    opportunityId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }) => Promise<void>;
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function handleQuestionAnswered(
  payload: QuestionAnsweredPayload,
  deps: QuestionAnswerHandlerDeps,
): Promise<void> {
  const { mode, questionId, userId, sourceId, answer } = payload;

  logger.verbose('Dispatching answer reaction', { questionId, userId, mode, sourceType: payload.sourceType });

  try {
    switch (mode) {
      case 'discovery':
        // No-op: discovery answers already enrich chat context via the
        // message path. If the user answered via the Pending Questions UI
        // (not inline chat), the answer is stored in the question record
        // and will be picked up by the next ChatContextDigest read.
        break;

      case 'profile':
        await deps.createPremiseFromAnswer({
          userId,
          questionId,
          selectedOptions: answer.selectedOptions,
          freeText: answer.freeText,
          sourceId,
        });
        break;

      case 'intent':
        await deps.enqueueIntentRefinement({
          userId,
          intentId: sourceId,
          questionId,
          selectedOptions: answer.selectedOptions,
          freeText: answer.freeText,
        });
        break;

      case 'negotiation':
        await deps.storeNegotiationContext({
          userId,
          opportunityId: sourceId,
          questionId,
          selectedOptions: answer.selectedOptions,
          freeText: answer.freeText,
        });
        break;

      default:
        logger.warn('Unknown question mode — no reaction handler', { mode, questionId });
    }
  } catch (err) {
    logger.error('Answer reaction handler failed', {
      mode,
      questionId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
