/**
 * pool_discovery answer reaction — interview-mode chaining (IND-418).
 *
 * When a user answers a pool question while POOL_QUESTIONS_MODE=on, the next
 * eligible discriminator from the answered question's stored alternates is
 * synthesized and persisted immediately (dialogue, not homework). The web
 * client refetches pending questions after answering and renders the chained
 * card behind a typing indicator.
 *
 * Chaining keeps the ≤1-pending invariant by construction: the answered
 * question just left `pending`, and exactly one successor is created. The
 * chain stops when no fresh alternate clears the VoI bar, the user dismisses
 * (dismissals never reach this handler), or the user navigates away (the one
 * pending successor then simply waits within the unattended budget).
 *
 * P3 adds the re-rank + reactive re-discovery reactions on this same arm.
 */
import { POOL_QUESTION_MIN_VOI, poolQuestionsMode } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import type { QuestionerAdapter } from '../../adapters/questioner.adapter';
import { buildPoolQuestion, dedupDiscriminators, persistPoolQuestion } from '../../queues/pool/question.shared';

const logger = log.service.from('PoolQuestionChain');

export interface ChainPoolQuestionDeps {
  adapter: Pick<QuestionerAdapter, 'getById' | 'persist' | 'listPoolQuestionLabels'>;
}

/**
 * Factory for the `chainPoolQuestion` answer-handler dependency.
 */
export function chainPoolQuestionFactory(deps: ChainPoolQuestionDeps) {
  return async function chainPoolQuestion(input: {
    userId: string;
    questionId: string;
    intentId: string;
  }): Promise<void> {
    if (poolQuestionsMode() !== 'on') return;

    const answered = await deps.adapter.getById(input.questionId);
    const pool = answered?.detection.pool;
    if (!pool || pool.alternates.length === 0) {
      logger.verbose('No alternates to chain', { questionId: input.questionId });
      return;
    }

    const askedLabels = await deps.adapter.listPoolQuestionLabels(input.userId, input.intentId);
    const fresh = dedupDiscriminators(pool.alternates, askedLabels)
      .filter((d) => d.voi >= POOL_QUESTION_MIN_VOI);
    if (fresh.length === 0) {
      logger.verbose('No fresh alternate clears the VoI bar', { questionId: input.questionId });
      return;
    }

    const question = buildPoolQuestion({
      userId: input.userId,
      intentId: input.intentId,
      poolSize: pool.poolSize,
      minedAt: pool.minedAt,
      ...(pool.runId ? { runId: pool.runId } : {}),
      discriminators: fresh,
    });
    if (!question) return;

    const id = await persistPoolQuestion(deps.adapter, question, input.userId);
    logger.info('Chained next pool question', {
      answeredQuestionId: input.questionId,
      nextQuestionId: id,
      intentId: input.intentId,
      remainingAlternates: fresh.length - 1,
    });
  };
}
