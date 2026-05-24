import { log } from '../lib/log';

import { QuestionerAdapter } from '../adapters/questioner.adapter';
import type {
  AdapterQuestionAnswer,
  AdapterQuestionFilters,
  AdapterPersistedQuestion,
} from '../adapters/questioner.adapter';
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
export class QuestionService {
  private readonly adapter: QuestionerAdapter;

  constructor(adapter?: QuestionerAdapter) {
    this.adapter = adapter ?? new QuestionerAdapter(db);
  }

  /**
   * Find pending questions for a given user, optionally filtered by
   * detection mode, source type, or source id.
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
    return this.adapter.findPending(userId, filters);
  }

  /**
   * Record an answer for a question, setting its status to `answered`.
   * Only succeeds if the user is an actor on the question.
   *
   * @param questionId - ID of the question to answer.
   * @param userId     - Authenticated user; must be an actor on the question.
   * @param answer     - The user's response data.
   * @returns `true` if the question was answered, `false` if not found or unauthorized.
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
   * @returns `true` if the question was dismissed, `false` if not found or unauthorized.
   */
  async dismiss(questionId: string, userId: string): Promise<boolean> {
    logger.verbose('Dismissing question', { questionId, userId });
    return this.adapter.dismiss(questionId, userId);
  }
}

export const questionService = new QuestionService();
