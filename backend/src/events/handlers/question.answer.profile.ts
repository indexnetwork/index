/**
 * Profile-mode answer handler: creates a premise from the user's answer through
 * the shared PremiseGraph lifecycle.
 *
 * The graph performs analysis, embedding, network assignment, and persistence.
 * This handler emits PremiseEvents.onCreated after the graph returns so the
 * existing profile-regeneration cascade remains unchanged.
 */

import { log } from '../../lib/log';

const logger = log.service.from('QuestionAnswerProfile');

export interface PremiseLifecycleResult {
  premise?: { id: string };
  error?: string;
}

export interface PremiseCreatorDeps {
  runPremiseLifecycle: (input: {
    userId: string;
    assertionText: string;
    tier: 'assertive' | 'contextual';
    volatile: boolean;
    provenanceSource: 'explicit' | 'enrichment' | 'integration' | 'onboarding';
    provenanceSourceId?: string;
    provenanceConfidence: number;
    networkScopeId?: string;
  }) => Promise<PremiseLifecycleResult>;
  emitPremiseCreated: (premiseId: string, userId: string) => void;
}

/**
 * Build the assertion text from the answer components.
 * Joins selected options with "; " and appends freeText if present.
 */
function buildAssertionText(selectedOptions: string[], freeText?: string): string {
  const base = selectedOptions.join('; ');
  const trimmed = freeText?.trim();
  if (base && trimmed) return `${base}. ${trimmed}`;
  return trimmed || base;
}

export function createPremiseFromAnswerFactory(deps: PremiseCreatorDeps) {
  return async (input: {
    userId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
    sourceId: string;
    networkScopeId?: string;
  }): Promise<void> => {
    const assertionText = buildAssertionText(input.selectedOptions, input.freeText);

    if (!assertionText) {
      logger.warn('Empty answer content — skipping premise creation', {
        questionId: input.questionId,
        userId: input.userId,
      });
      return;
    }

    logger.verbose('Creating premise from profile answer through premise lifecycle', {
      userId: input.userId,
      questionId: input.questionId,
      assertionLength: assertionText.length,
    });

    const result = await deps.runPremiseLifecycle({
      userId: input.userId,
      assertionText,
      tier: 'contextual',
      volatile: false,
      provenanceSource: 'explicit',
      provenanceSourceId: input.questionId,
      provenanceConfidence: 0.9,
      ...(input.networkScopeId ? { networkScopeId: input.networkScopeId } : {}),
    });

    if (!result.premise) {
      logger.warn('Premise lifecycle did not create a premise from profile answer', {
        questionId: input.questionId,
        userId: input.userId,
        error: result.error,
      });
      return;
    }

    deps.emitPremiseCreated(result.premise.id, input.userId);

    logger.info('Premise created from profile answer', {
      premiseId: result.premise.id,
      userId: input.userId,
      questionId: input.questionId,
    });
  };
}
