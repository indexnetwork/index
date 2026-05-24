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
   *
   * @param questionId - ID of the question to answer.
   * @param answer     - The user's response data.
   */
  async answer(questionId: string, answer: AdapterQuestionAnswer): Promise<void> {
    logger.verbose('Answering question', { questionId, answeredBy: answer.answeredBy });
    return this.adapter.answer(questionId, answer);
  }

  /**
   * Dismiss a question, setting its status to `dismissed`.
   *
   * @param questionId - ID of the question to dismiss.
   */
  async dismiss(questionId: string): Promise<void> {
    logger.verbose('Dismissing question', { questionId });
    return this.adapter.dismiss(questionId);
  }
}

export const questionService = new QuestionService();
