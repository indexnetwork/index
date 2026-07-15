/**
 * pool_discovery answer reaction (IND-418/419).
 *
 * One deterministic handler owns the full immediate reaction:
 *  1. apply stored assignments to the live pool (Tier 0),
 *  2. append template Beat-1 narration,
 *  3. enqueue one debounced answer-conditioned from-intent run (Tier 1),
 *  4. chain the next eligible stored discriminator for interview cadence.
 *
 * "Both matter" records the answer and chains normally, but produces no
 * adjustments and no Tier-1 run because it expresses no ranking preference.
 */
import { POOL_QUESTION_MIN_VOI, poolQuestionsMode, poolQuestionsRanking } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import type { QuestionerAdapter } from '../../adapters/questioner.adapter';
import { buildPoolQuestion, dedupDiscriminators, persistPoolQuestion } from '../../queues/pool/question.shared';
import { applyPoolAnswer, beatOneMessage, enqueuePoolRerun } from '../../queues/pool/answer.shared';
import type { PoolAnswerOutcome } from '../../queues/pool/answer.shared';

const logger = log.service.from('PoolQuestionAnswer');

export interface HandlePoolAnswerDeps {
  adapter: Pick<QuestionerAdapter, 'getById' | 'persist' | 'listPoolQuestionLabels'>;
  applyAnswer?: typeof applyPoolAnswer;
  narrateBeatOne?: (input: {
    userId: string;
    intentId: string;
    message: string;
    outcome: PoolAnswerOutcome;
  }) => Promise<void>;
  enqueueRerun?: typeof enqueuePoolRerun;
}

/** Factory for the complete `pool_discovery` answer reaction. */
export function handlePoolAnswerFactory(deps: HandlePoolAnswerDeps) {
  return async function handlePoolAnswer(input: {
    userId: string;
    questionId: string;
    intentId: string;
    selectedOptions: string[];
  }): Promise<void> {
    if (poolQuestionsMode() !== 'on') return;

    const answered = await deps.adapter.getById(input.questionId);
    const pool = answered?.detection.pool;
    if (!pool) {
      logger.warn('Answered pool question is missing its server snapshot', {
        questionId: input.questionId,
        intentId: input.intentId,
      });
      return;
    }

    const selectedOption = input.selectedOptions[0] ?? '';
    const outcome = await (deps.applyAnswer ?? applyPoolAnswer)({
      userId: input.userId,
      intentId: input.intentId,
      questionId: input.questionId,
      pool,
      selectedOption,
    });

    if (deps.narrateBeatOne) {
      try {
        await deps.narrateBeatOne({
          userId: input.userId,
          intentId: input.intentId,
          message: beatOneMessage(outcome, poolQuestionsRanking() === 'on'),
          outcome,
        });
      } catch (error) {
        logger.warn('Beat-1 narration failed; continuing answer reaction', {
          questionId: input.questionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // A stale preference still shapes fresh candidates; "Both matter" does not.
    if (outcome.kind !== 'none') {
      try {
        await (deps.enqueueRerun ?? enqueuePoolRerun)({
          userId: input.userId,
          intentId: input.intentId,
        });
      } catch (error) {
        logger.warn('Tier-1 pool re-discovery enqueue failed', {
          questionId: input.questionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (pool.alternates.length === 0) {
      logger.verbose('No alternates to chain', { questionId: input.questionId });
      return;
    }

    const askedLabels = await deps.adapter.listPoolQuestionLabels(input.userId, input.intentId);
    const fresh = dedupDiscriminators(pool.alternates, askedLabels)
      .filter((discriminator) => discriminator.voi >= POOL_QUESTION_MIN_VOI);
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
      ...(pool.intentText ? { intentText: pool.intentText } : {}),
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
