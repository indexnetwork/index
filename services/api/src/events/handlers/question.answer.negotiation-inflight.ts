/**
 * Post-commit inflight continuation dispatcher.
 *
 * The QuestionerAdapter has already locked/revalidated the exact provenance,
 * stored the answer, closed only the stamped input_required task, and won the
 * answer-vs-timeout claim. This handler must never re-resolve a "latest" task
 * or repeat shared mutation; it enqueues the exact durable continuation and
 * records optional private memory. The timer stays armed as recovery.
 */

import { log } from '../../lib/log';

const logger = log.service.from('QuestionAnswerNegotiationInflight');

export interface InflightResumeDeps {
  /** Enqueue the exact durable run-existing continuation. */
  enqueueResume: (input: {
    opportunityId: string;
    userId: string;
    taskId: string;
    settlementId: string;
    recipientIntentId: string;
    networkId: string;
  }) => Promise<void>;
  /** Optional private disclosure-rule memory write. */
  recordDisclosureRule?: (input: {
    userId: string;
    opportunityId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }) => Promise<void>;
}

/** Build the exact post-commit inflight continuation dispatcher. */
export function resumeInflightNegotiationFactory(deps: InflightResumeDeps) {
  return async (input: {
    userId: string;
    opportunityId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
    taskId: string;
    settlementId: string;
    recipientIntentId: string;
    networkId: string;
  }): Promise<void> => {
    // Privacy-minimized consultation funnel telemetry. This handler receives
    // both answers and dismissals after the exact cohort settlement, so it
    // intentionally records only a stable stage and no identifiers or text.
    const stage = input.selectedOptions.length > 0 || Boolean(input.freeText) ? 'answered' : 'dismissed';
    logger.info('negotiation_consultation_policy', { stage });

    // Durable settlement is already committed. Enqueue first; canceling the
    // recovery timer before this acknowledgement would recreate the crash hole.
    await deps.enqueueResume({
      opportunityId: input.opportunityId,
      userId: input.userId,
      taskId: input.taskId,
      settlementId: input.settlementId,
      recipientIntentId: input.recipientIntentId,
      networkId: input.networkId,
    });
    logger.info('negotiation_consultation_policy', { stage: 'resumed' });
    // Keep the original delayed timeout armed as the durable recovery sweep.
    // If the continuation finishes first it observes `completed` and no-ops;
    // if Redis/worker delivery is lost it re-enqueues this same settlement ID.
    if (input.selectedOptions.length > 0 || input.freeText) {
      deps.recordDisclosureRule?.(input).catch((err) => {
        logger.warn('Failed to record disclosure rule from ask_user answer', {
          questionId: input.questionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    logger.info('Authoritatively settled inflight task resumed', {
      negotiationId: input.taskId,
      opportunityId: input.opportunityId,
      questionId: input.questionId,
    });
  };
}
