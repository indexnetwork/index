import { log } from '../lib/log';

import { QuestionerAdapter } from '../adapters/questioner.adapter';
import type { AdapterQuestionAnswer, AdapterQuestionFilters, AdapterPersistedQuestion, AdapterQuestionMode, PendingQuestionCounts, PendingQuestionsByIntentOptions } from '../adapters/questioner.adapter';
import db from '../lib/drizzle/drizzle';

// Re-export adapter types so the controller layer can reference them without
// importing from the adapters directory directly (enforced by layer boundaries).
export type {
  AdapterQuestionFilters,
  AdapterPersistedQuestion,
  AdapterQuestionAnswer,
  PendingQuestionCounts,
  PendingQuestionsByIntentOptions,
};

const NETWORK_SCOPED_PENDING_MODES: AdapterQuestionMode[] = ['enrichment', 'intent', 'discovery'];

/**
 * Return the complete pending-question visibility clamp for a network-scoped agent.
 * Negotiation-family questions can contain cross-network context and remain hidden.
 *
 * @param networkId - Agent-bound network id.
 * @returns Recipient-network and allowed-mode filters shared by list and bulk count reads.
 */
export function networkScopedPendingQuestionFilters(
  networkId: string,
): PendingQuestionsByIntentOptions {
  return { networkId, modes: [...NETWORK_SCOPED_PENDING_MODES] };
}

const logger = log.service.from('QuestionService');

/**
 * QuestionService — business logic layer for the question lifecycle.
 *
 * Wraps QuestionerAdapter to expose pending-question retrieval and
 * answer/dismiss mutations through a service boundary, keeping
 * controllers free of adapter dependencies.
 */
/**
 * Removes server-only detection fields before a question leaves the API.
 * `detection.pool` carries pool_discovery candidate assignments + chain
 * alternates (IND-418); strategy and QUD type are generation/debug metadata
 * rather than client rendering contracts (IND-425).
 */
export function stripInternalDetection(question: AdapterPersistedQuestion): AdapterPersistedQuestion {
  const {
    pool: _pool,
    purpose: _purpose,
    strategy: _strategy,
    underspecificationType: _underspecificationType,
    pushRequestedAt: _pushRequestedAt,
    pushRecoveryAttemptedAt: _pushRecoveryAttemptedAt,
    pushRequestStatus: _pushRequestStatus,
    pushRequestReason: _pushRequestReason,
    pushRequestSuppressedAt: _pushRequestSuppressedAt,
    push: _push,
    pushedAt: _pushedAt,
    ...detection
  } = question.detection;
  if (
    !_pool
    && !_purpose
    && !_strategy
    && _underspecificationType === undefined
    && !_pushRequestedAt
    && !_pushRecoveryAttemptedAt
    && !_pushRequestStatus
    && !_pushRequestReason
    && !_pushRequestSuppressedAt
    && !_push
    && !_pushedAt
  ) return question;
  return { ...question, detection };
}

export class QuestionService {
  private readonly adapter: QuestionerAdapter;

  constructor(adapter?: QuestionerAdapter) {
    this.adapter = adapter ?? new QuestionerAdapter(db);
  }

  /**
   * Find pending questions for a given user, optionally filtered by detection
   * mode, source type, source id, or selected-intent scope. Intent scope returns
   * direct intent questions plus negotiation questions whose source opportunity
   * belongs to that intent for the same viewer.
   *
   * @param userId  - The user to find pending questions for.
   * @param filters - Optional narrowing filters.
   * @returns Pending questions ordered by creation time (oldest first).
   */
  async findPending(
    userId: string,
    filters?: AdapterQuestionFilters,
  ): Promise<AdapterPersistedQuestion[]> {
    logger.verbose('Finding pending questions', { userId, filters });
    const rows = await this.adapter.findPending(userId, filters);
    return rows.map(stripInternalDetection);
  }

  /**
   * Return canonical split counts for global and Personal Agent surfaces.
   *
   * @param userId - Authenticated recipient.
   * @returns Global, delivered-pool, and summed Personal Agent counts.
   */
  async countPending(userId: string): Promise<PendingQuestionCounts> {
    return this.adapter.countPending(userId);
  }

  /**
   * Count canonical pending questions for multiple owned intents without N+1 reads.
   *
   * @param userId - Authenticated recipient and intent owner.
   * @param intentIds - Intent ids on the current page.
   * @param options - Optional network ownership clamp for a scoped agent.
   * @returns Pending counts keyed by intent id.
   */
  async countPendingByIntent(
    userId: string,
    intentIds: string[],
    options?: PendingQuestionsByIntentOptions,
  ): Promise<Map<string, number>> {
    return this.adapter.countPendingByIntent(userId, intentIds, options);
  }

  /**
   * Record an answer for a question, setting its status to `answered`.
   * Only succeeds if the user is an actor on the question.
   *
   * @param questionId - ID of the question to answer.
   * @param userId     - Authenticated user; must be an actor on the question.
   * @param answer     - The user's response data.
   * @returns `true` if the question was answered, `false` if not found, not pending, or unauthorized.
   */
  async answer(questionId: string, userId: string, answer: AdapterQuestionAnswer): Promise<boolean> {
    logger.verbose('Answering question', { questionId, answeredBy: answer.answeredBy });
    return this.adapter.answer(questionId, userId, answer);
  }

  /**
   * Dismiss a question, setting its status to `dismissed`.
   * Only succeeds if the user is an actor on the question.
   *
   * @param questionId - ID of the question to dismiss.
   * @param userId     - Authenticated user; must be an actor on the question.
   * @returns `true` if the question was dismissed, `false` if not found, not pending, or unauthorized.
   */
  async dismiss(questionId: string, userId: string): Promise<boolean> {
    logger.verbose('Dismissing question', { questionId, userId });
    return this.adapter.dismiss(questionId, userId);
  }
}

export const questionService = new QuestionService();
