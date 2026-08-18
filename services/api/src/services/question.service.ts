import { log } from '../lib/log';

import type { QuestionerAdapter } from '../adapters/questioner.adapter';

const logger = log.service.from('QuestionService');

/**
 * QuestionService — leftover-row settlement for the retired card questions.
 *
 * The card generators, the Questions page, and the answer/dismiss tools are
 * retired (conversational-questions plan, "Retirements"); questions are
 * conversation now. What remains is the transition-window contract: a stale
 * client contacting a leftover row must not error and must never reach a
 * retired reaction handler, so any contact simply voids the row with the
 * auditable `retired_mode` marker. The questions table itself drops in a
 * separate migration once nothing reads it.
 */
export class QuestionService {
  private adapter: QuestionerAdapter | null;

  constructor(adapter?: QuestionerAdapter) {
    this.adapter = adapter ?? null;
  }

  private async getAdapter(): Promise<QuestionerAdapter> {
    this.adapter ??= (await import('../adapters/questioner.adapter.instance')).questionerAdapter;
    return this.adapter;
  }

  /**
   * Void a leftover card question on contact (answer or dismiss alike).
   *
   * @returns `voided` when this call dismissed a pending row, `settled` when
   *   it was already answered/dismissed, `not_found` otherwise.
   */
  async voidLeftoverQuestion(
    questionId: string,
    userId: string,
  ): Promise<'voided' | 'settled' | 'not_found'> {
    logger.verbose('Voiding leftover question on contact', { questionId, userId });
    return (await this.getAdapter()).voidLeftoverQuestion(questionId, userId);
  }
}

export const questionService = new QuestionService();
