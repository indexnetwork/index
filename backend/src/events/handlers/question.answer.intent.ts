/**
 * Intent-mode answer handler: refines an intent with the user's answer.
 *
 * Appends the answer as a refinement addendum to the intent's description,
 * then enqueues a HyDE regeneration job so the intent gets re-embedded
 * and re-indexed with the new context.
 */

import { log } from '../../lib/log';

const logger = log.service.from('QuestionAnswerIntent');

export interface IntentRefinementDeps {
  getIntent: (intentId: string) => Promise<{
    id: string;
    userId: string;
    description: string;
    status: string;
  } | null>;
  updateIntentDescription: (intentId: string, newDescription: string) => Promise<void>;
  enqueueHydeRegeneration: (data: { intentId: string; userId: string }) => Promise<void>;
}

/**
 * Build a refinement addendum from the answer.
 * Format: "[Refined: <options>. <freeText>]"
 */
function buildRefinementAddendum(selectedOptions: string[], freeText?: string): string {
  const parts = selectedOptions.join('; ');
  const addendum = freeText?.trim() ? `${parts}. ${freeText.trim()}` : parts;
  return `\n\n[Refined: ${addendum}]`;
}

export function enqueueIntentRefinementFactory(deps: IntentRefinementDeps) {
  return async (input: {
    userId: string;
    intentId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }): Promise<void> => {
    const intent = await deps.getIntent(input.intentId);

    if (!intent) {
      logger.warn('Intent not found for refinement', {
        intentId: input.intentId,
        questionId: input.questionId,
      });
      return;
    }

    if (intent.userId !== input.userId) {
      logger.warn('Intent owner mismatch — skipping refinement', {
        intentId: input.intentId,
        intentOwner: intent.userId,
        answerer: input.userId,
      });
      return;
    }

    if (intent.status !== 'active') {
      logger.verbose('Intent is not active — skipping refinement', {
        intentId: input.intentId,
        status: intent.status,
      });
      return;
    }

    const addendum = buildRefinementAddendum(input.selectedOptions, input.freeText);
    const newDescription = intent.description + addendum;

    await deps.updateIntentDescription(input.intentId, newDescription);

    logger.verbose('Intent description updated with answer refinement', {
      intentId: input.intentId,
      questionId: input.questionId,
      addendumLength: addendum.length,
    });

    await deps.enqueueHydeRegeneration({
      intentId: input.intentId,
      userId: input.userId,
    });

    logger.info('Intent refinement enqueued', {
      intentId: input.intentId,
      userId: input.userId,
      questionId: input.questionId,
    });
  };
}
