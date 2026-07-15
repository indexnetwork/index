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
 * - negotiation_inflight: store answer, cancel the 24h answer-window timer,
 *              close the paused input_required task, resume the negotiation
 *              via the run-existing continuation (P3.2 ask_user loop)
 * - chat:      resolve the in-memory wait bus so a blocked ask_user_question
 *              tool call resumes the paused chat turn with the answer
 * - pool_discovery: deterministically re-rank the live pool, narrate the
 *              delta, enqueue answer-conditioned re-discovery, and chain the
 *              next stored discriminator (IND-418/419)
 */

import { log } from '../../lib/log';
import type { IntentRefinementResult } from './question.answer.intent';

const logger = log.service.from('QuestionAnswerHandler');

// ─── Types ──────────────────────────────────────────────────────────────────

interface QuestionAnsweredPayload {
  questionId: string;
  userId: string;
  mode: 'discovery' | 'intent' | 'enrichment' | 'negotiation' | 'negotiation_inflight' | 'chat' | 'pool_discovery';
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
  }) => Promise<IntentRefinementResult>;

  /** Store the answer as negotiation context for the next turn. */
  storeNegotiationContext: (input: {
    userId: string;
    opportunityId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }) => Promise<void>;

  /**
   * Resume a negotiation paused on an `ask_user` client consultation:
   * store the answer, cancel the answer-window timer, close the paused
   * task, and enqueue the run-existing continuation.
   */
  resumeInflightNegotiation: (input: {
    userId: string;
    opportunityId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }) => Promise<void>;

  /**
   * Resolve a chat turn blocked on this question (ask_user_question wait bus).
   * No-op when no turn is waiting — the answer stays on the question row and
   * the frontend feeds it back into the conversation as a new turn.
   */
  resolveChatQuestionWait: (input: {
    questionId: string;
    answer: QuestionAnsweredPayload['answer'];
  }) => void;

  /** Complete pool_discovery answer reaction (Tier 0 + Tier 1 + chaining). */
  handlePoolAnswer: (input: {
    userId: string;
    questionId: string;
    intentId: string;
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

      case 'enrichment':
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

      case 'negotiation_inflight':
        await deps.resumeInflightNegotiation({
          userId,
          opportunityId: sourceId,
          questionId,
          selectedOptions: answer.selectedOptions,
          freeText: answer.freeText,
        });
        break;

      case 'chat':
        deps.resolveChatQuestionWait({ questionId, answer });
        break;

      case 'pool_discovery':
        await deps.handlePoolAnswer({
          userId,
          questionId,
          intentId: sourceId,
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
