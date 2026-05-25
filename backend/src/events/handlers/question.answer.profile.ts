/**
 * Profile-mode answer handler: creates a premise from the user's answer.
 *
 * The answer text (selectedOptions + optional freeText) becomes the premise
 * assertion. Creating a premise fires PremiseEvents.onCreated, which triggers
 * profile regeneration automatically via the premise queue.
 */

import { log } from '../../lib/log';

const logger = log.service.from('QuestionAnswerProfile');

export interface PremiseCreatorDeps {
  createPremise: (input: {
    userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    validity: { volatile: boolean };
    embedding?: number[];
  }) => Promise<{ id: string }>;
  embedText: (text: string) => Promise<number[]>;
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
  }): Promise<void> => {
    const assertionText = buildAssertionText(input.selectedOptions, input.freeText);

    if (!assertionText) {
      logger.warn('Empty answer content — skipping premise creation', {
        questionId: input.questionId,
        userId: input.userId,
      });
      return;
    }

    logger.verbose('Creating premise from profile answer', {
      userId: input.userId,
      questionId: input.questionId,
      assertionLength: assertionText.length,
    });

    let embedding: number[] | undefined;
    try {
      embedding = await deps.embedText(assertionText);
    } catch (err) {
      logger.warn('Failed to embed premise text — creating without embedding', {
        questionId: input.questionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const premise = await deps.createPremise({
      userId: input.userId,
      assertion: {
        text: assertionText,
        tier: 'contextual',
      },
      provenance: {
        source: 'explicit',
        sourceId: input.questionId,
        confidence: 0.9,
        timestamp: new Date().toISOString(),
      },
      validity: { volatile: false },
      ...(embedding ? { embedding } : {}),
    });

    deps.emitPremiseCreated(premise.id, input.userId);

    logger.info('Premise created from profile answer', {
      premiseId: premise.id,
      userId: input.userId,
      questionId: input.questionId,
    });
  };
}
