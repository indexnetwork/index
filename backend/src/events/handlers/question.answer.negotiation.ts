/**
 * Negotiation-mode answer handler: stores the answer as additional context
 * on the opportunity record.
 *
 * The next `respond_to_negotiation` call picks up `metadata.userAnswers`
 * and feeds it into the negotiation agent's reasoning.
 */

import { log } from '../../lib/log';

const logger = log.service.from('QuestionAnswerNegotiation');

/** Statuses where a negotiation is still active and context can be enriched. */
const NEGOTIABLE_STATUSES = new Set(['draft', 'pending', 'negotiating', 'latent']);

interface UserAnswer {
  questionId: string;
  selectedOptions: string[];
  freeText?: string;
  answeredAt: string;
}

export interface NegotiationContextDeps {
  getOpportunity: (opportunityId: string) => Promise<{
    id: string;
    status: string;
    metadata: Record<string, unknown>;
  } | null>;
  updateOpportunityMetadata: (
    opportunityId: string,
    metadata: Record<string, unknown>,
  ) => Promise<void>;
}

export function storeNegotiationContextFactory(deps: NegotiationContextDeps) {
  return async (input: {
    userId: string;
    opportunityId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }): Promise<void> => {
    const opportunity = await deps.getOpportunity(input.opportunityId);

    if (!opportunity) {
      logger.warn('Opportunity not found for negotiation context', {
        opportunityId: input.opportunityId,
        questionId: input.questionId,
      });
      return;
    }

    if (!NEGOTIABLE_STATUSES.has(opportunity.status)) {
      logger.verbose('Opportunity is not in a negotiable status — skipping', {
        opportunityId: input.opportunityId,
        status: opportunity.status,
      });
      return;
    }

    const existingAnswers = Array.isArray(opportunity.metadata?.userAnswers)
      ? (opportunity.metadata.userAnswers as UserAnswer[])
      : [];

    const newAnswer: UserAnswer = {
      questionId: input.questionId,
      selectedOptions: input.selectedOptions,
      freeText: input.freeText,
      answeredAt: new Date().toISOString(),
    };

    const updatedMetadata = {
      ...opportunity.metadata,
      userAnswers: [...existingAnswers, newAnswer],
    };

    await deps.updateOpportunityMetadata(input.opportunityId, updatedMetadata);

    logger.info('Negotiation context enriched with answer', {
      opportunityId: input.opportunityId,
      questionId: input.questionId,
      userId: input.userId,
      totalAnswers: updatedMetadata.userAnswers.length,
    });
  };
}
