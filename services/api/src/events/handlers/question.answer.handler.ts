/**
 * Answer Reaction Dispatcher — routes answered-question events to mode-specific
 * handlers. Wired into `QuestionEvents.onAnswered` from `main.ts`.
 *
 * Design: Each mode handler enqueues background work into existing queues
 * rather than performing heavy processing inline. Errors are caught and logged
 * so one failing handler doesn't block others.
 *
 * `discovery` and `enrichment` are retired generators: nothing produces them
 * any more, but rows created before their removal stay answerable, so their
 * reactions are retained.
 *
 * Mode reactions:
 * - discovery: no-op (retired; answers enriched chat context via the message path)
 * - enrichment: retired; create a premise from the answer → triggers profile regen
 * - intent:    enqueue intent refinement with the new context
 * - negotiation: no-op after authoritative adapter settlement (uptake private;
 *              ordinary shared context already committed)
 * - negotiation_inflight: after authoritative exact-task settlement, enqueue
 *              the durable run-existing continuation; its timer remains recovery
 * - chat:      resolve the in-memory wait bus so a blocked ask_user_question
 *              tool call resumes the paused chat turn with the answer
 * - pool_discovery: retired generator (rows voided by migration 0133); any
 *              stray answer falls through to the default no-op
 */

import { log } from '../../lib/log';
import type { IntentRefinementResult } from './question.answer.intent';

const logger = log.service.from('QuestionAnswerHandler');

// ─── Types ──────────────────────────────────────────────────────────────────

interface QuestionAnsweredPayload {
  questionId: string;
  userId: string;
  mode: 'discovery' | 'intent' | 'enrichment' | 'negotiation' | 'negotiation_inflight' | 'chat' | 'pool_discovery';
  /** Internal generation purpose; never enters public projections. */
  purpose?: 'uptake' | 'recovery' | 'stalled_followup' | 'inflight_consultation';
  /** Recovery fingerprint rechecked immediately before intent mutation. */
  recoveryIntentFingerprint?: string;
  sourceType: string;
  sourceId: string;
  answer: {
    selectedOptions: string[];
    freeText?: string;
    answeredBy: string;
    answeredAt: string;
  };
  /** DB-claimed exact settlement. Present on every new negotiation-family path. */
  settlement?: {
    authoritative: true;
    purpose: 'uptake' | 'stalled_followup' | 'inflight_consultation';
    taskId?: string;
    settlementId?: string;
    recipientIntentId: string;
    opportunityId: string;
    networkId: string;
    continuationStatus?: 'requested' | 'completed';
    resumeClaimed: boolean;
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
    expectedIntentFingerprint?: string;
  }) => Promise<IntentRefinementResult>;

  /**
   * Resume a negotiation paused on an `ask_user` client consultation:
   * enqueue the exact durable run-existing continuation. The adapter already
   * stored the answer/closed the task; the answer-window timer remains recovery.
   */
  resumeInflightNegotiation: (input: {
    userId: string;
    opportunityId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
    taskId: string;
    settlementId: string;
    recipientIntentId: string;
    networkId: string;
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
          ...(payload.recoveryIntentFingerprint
            ? { expectedIntentFingerprint: payload.recoveryIntentFingerprint }
            : {}),
        });
        break;

      case 'negotiation':
        // Uptake privacy and ordinary shared-metadata writes are both settled
        // under locks at the adapter boundary before this event exists.
        break;

      case 'negotiation_inflight':
        if (
          !payload.settlement?.authoritative
          || !payload.settlement.resumeClaimed
          || !payload.settlement.taskId
          || !payload.settlement.settlementId
        ) break;
        await deps.resumeInflightNegotiation({
          userId,
          opportunityId: payload.settlement.opportunityId,
          questionId,
          selectedOptions: answer.selectedOptions,
          freeText: answer.freeText,
          taskId: payload.settlement.taskId,
          settlementId: payload.settlement.settlementId,
          recipientIntentId: payload.settlement.recipientIntentId,
          networkId: payload.settlement.networkId,
        });
        break;

      case 'chat':
        deps.resolveChatQuestionWait({ questionId, answer });
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
    // The DB settlement is durable and the answer-window timer remains armed.
    // Surface enqueue failures so a caller retry can reconcile immediately;
    // Bull/timeout redelivery remains the process-boundary fallback.
    if (mode === 'negotiation_inflight') throw err;
  }
}
