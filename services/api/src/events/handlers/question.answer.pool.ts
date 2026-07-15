/**
 * pool_discovery answer reaction (IND-418/419).
 *
 * One deterministic handler owns the full immediate reaction:
 *  1. apply stored assignments to the live pool (Tier 0),
 *  2. append template Beat-1 narration,
 *  3. enqueue one debounced answer-conditioned from-intent run (Tier 1),
 *  4. chain the next eligible stored discriminator for interview cadence.
 *
 * "Both matter" alone records the answer and chains normally without
 * adjustments or Tier-1; substantive free text may still refine and rerun.
 */
import { BOTH_MATTER_LABEL, POOL_QUESTION_MIN_VOI, poolQuestionsMode, poolQuestionsRanking } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { buildFullIntentText, buildIntentSnippet, computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import type { QuestionerAdapter } from '../../adapters/questioner.adapter';
import { buildPoolQuestion, dedupDiscriminators, persistPoolQuestion } from '../../queues/pool/question.shared';
import { applyPoolAnswer, beatOneMessage, enqueuePoolRerun } from '../../queues/pool/answer.shared';
import type { PoolAnswerOutcome, PoolLifecycleAdmission } from '../../queues/pool/answer.shared';
import type { IntentRefinementResult } from './question.answer.intent';

const logger = log.service.from('PoolQuestionAnswer');

export interface HandlePoolAnswerDeps {
  adapter: Pick<QuestionerAdapter, 'getById' | 'persist' | 'listPoolQuestionLabels' | 'updateAnsweredPoolIntentFingerprint'>;
  applyAnswer?: typeof applyPoolAnswer;
  narrateBeatOne?: (input: {
    userId: string;
    intentId: string;
    message: string;
    outcome: PoolAnswerOutcome;
  }) => Promise<void>;
  enqueueRerun?: typeof enqueuePoolRerun;
  /** Canonical intent-graph refinement callback shared with intent-mode answers. */
  refineIntent: (input: {
    userId: string;
    intentId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }) => Promise<IntentRefinementResult>;
  /** Lifecycle admission check performed after Tier 0 and before new work. */
  getIntentAdmission: (userId: string, intentId: string) => Promise<PoolLifecycleAdmission>;
}

/** Factory for the complete `pool_discovery` answer reaction. */
export function handlePoolAnswerFactory(deps: HandlePoolAnswerDeps) {
  return async function handlePoolAnswer(input: {
    userId: string;
    questionId: string;
    intentId: string;
    selectedOptions: string[];
    freeText?: string;
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

    let admission: PoolLifecycleAdmission = 'unavailable';
    try {
      admission = await deps.getIntentAdmission(input.userId, input.intentId);
    } catch (error) {
      logger.warn('Intent lifecycle lookup failed; skipping new pool work', {
        questionId: input.questionId,
        intentId: input.intentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (deps.narrateBeatOne) {
      try {
        await deps.narrateBeatOne({
          userId: input.userId,
          intentId: input.intentId,
          message: beatOneMessage(outcome, poolQuestionsRanking() === 'on', admission),
          outcome,
        });
      } catch (error) {
        logger.warn('Beat-1 narration failed; continuing answer reaction', {
          questionId: input.questionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Existing questions stay answerable and Tier 0 remains valid while paused,
    // but no Tier-1 discovery or chained question may start.
    if (admission !== 'active') {
      logger.info('Intent paused or unavailable; skipped Tier-1 and question chaining', {
        questionId: input.questionId,
        intentId: input.intentId,
        admission,
      });
      return;
    }

    let currentIntentFingerprint = pool.intentFingerprint;
    let currentIntentText = pool.intentText;
    let refinementApplied = false;
    const substantiveSelection = input.selectedOptions.some(
      (option) => option.trim().length > 0 && option !== BOTH_MATTER_LABEL,
    );
    const shouldRefine = substantiveSelection || Boolean(input.freeText?.trim());
    if (shouldRefine) {
      try {
        const refinement = await deps.refineIntent({
          userId: input.userId,
          intentId: input.intentId,
          questionId: input.questionId,
          selectedOptions: input.selectedOptions,
          ...(input.freeText !== undefined ? { freeText: input.freeText } : {}),
        });
        refinementApplied = refinement.applied;
        if (refinement.applied) {
          const fullIntentText = buildFullIntentText(refinement.payload, refinement.summary);
          currentIntentFingerprint = computeIntentFingerprint(refinement.payload, refinement.summary);
          currentIntentText = buildIntentSnippet(fullIntentText);
          try {
            const stamped = await deps.adapter.updateAnsweredPoolIntentFingerprint(
              input.questionId,
              input.userId,
              currentIntentFingerprint,
            );
            if (!stamped) {
              logger.warn('Post-refinement pool fingerprint was not persisted', {
                questionId: input.questionId,
                intentId: input.intentId,
              });
            }
          } catch (error) {
            logger.warn('Post-refinement pool fingerprint persistence failed; continuing answer reaction', {
              questionId: input.questionId,
              intentId: input.intentId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        logger.warn('Pool answer intent refinement failed; continuing answer reaction', {
          questionId: input.questionId,
          intentId: input.intentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // A local preference or an applied free-text refinement shapes fresh candidates.
    if (outcome.kind !== 'none' || refinementApplied) {
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

    const askedLabels = await deps.adapter.listPoolQuestionLabels(input.userId, input.intentId, {
      currentIntentFingerprint,
      currentIntentText,
    });
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
      ...(currentIntentText ? { intentText: currentIntentText } : {}),
      ...(currentIntentFingerprint ? { intentFingerprint: currentIntentFingerprint } : {}),
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
