import { log } from '../lib/log';

import { QuestionerAdapter } from '../adapters/questioner.adapter';
import type { AdapterQuestionAnswer, AdapterQuestionFilters, AdapterPersistedQuestion } from '../adapters/questioner.adapter';
import db from '../lib/drizzle/drizzle';

// Re-export adapter types so the controller layer can reference them without
// importing from the adapters directory directly (enforced by layer boundaries).
export type { AdapterQuestionFilters, AdapterPersistedQuestion, AdapterQuestionAnswer };

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
    strategy: _strategy,
    underspecificationType: _underspecificationType,
    ...detection
  } = question.detection;
  if (!_pool && !_strategy && _underspecificationType === undefined) return question;
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
