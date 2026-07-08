/**
 * Intent-mode answer handler: refines an intent with the user's answer.
 *
 * Rewrites the intent's description via an LLM so the answer is incorporated
 * naturally (no mechanical "[Refined: ...]" markers — IND-393), then enqueues
 * a HyDE regeneration job so the intent gets re-embedded and re-indexed with
 * the new context.
 *
 * When the LLM rewrite fails (timeout, malformed output, guardrail rejection)
 * the handler falls back to appending the raw answer text as a plain
 * paragraph — still marker-free — so the refinement context is never lost.
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
  /** Fetch the clarifying question's prompt text for LLM context. Null when unavailable. */
  getQuestionPrompt: (questionId: string) => Promise<string | null>;
  /**
   * LLM rewrite of the description incorporating the answer naturally.
   * Returns null on any failure — the handler then falls back to a plain append.
   */
  refineDescription: (input: {
    currentDescription: string;
    question?: string;
    selectedOptions: string[];
    freeText?: string;
  }) => Promise<string | null>;
  updateIntentDescription: (intentId: string, newDescription: string) => Promise<void>;
  enqueueHydeRegeneration: (data: { intentId: string; userId: string }) => Promise<void>;
}

/**
 * Fallback when the LLM rewrite fails: append the answer as a plain paragraph
 * (no "[Refined: ...]" wrapper) so the context still lands in the description
 * and the HyDE re-embedding sees it.
 */
function buildFallbackDescription(
  currentDescription: string,
  selectedOptions: string[],
  freeText?: string,
): string {
  const parts = selectedOptions.join('; ');
  const trimmed = freeText?.trim();
  const addendum = parts && trimmed ? `${parts}. ${trimmed}` : (trimmed || parts);
  return `${currentDescription}\n\n${addendum}`;
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

    const hasContent = input.selectedOptions.length > 0 || !!input.freeText?.trim();
    if (!hasContent) {
      logger.warn('Empty answer content — skipping intent refinement', {
        intentId: input.intentId,
        questionId: input.questionId,
      });
      return;
    }

    const questionPrompt = await deps.getQuestionPrompt(input.questionId);

    const refined = await deps.refineDescription({
      currentDescription: intent.description,
      question: questionPrompt ?? undefined,
      selectedOptions: input.selectedOptions,
      freeText: input.freeText,
    });

    const newDescription = refined
      ?? buildFallbackDescription(intent.description, input.selectedOptions, input.freeText);

    if (!refined) {
      logger.warn('LLM refinement unavailable — falling back to plain append', {
        intentId: input.intentId,
        questionId: input.questionId,
      });
    }

    await deps.updateIntentDescription(input.intentId, newDescription);

    logger.verbose('Intent description updated with answer refinement', {
      intentId: input.intentId,
      questionId: input.questionId,
      refinedByLlm: !!refined,
      descriptionLength: newDescription.length,
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
