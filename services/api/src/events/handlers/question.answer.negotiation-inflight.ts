/**
 * Post-commit inflight continuation dispatcher.
 *
 * The QuestionerAdapter has already locked/revalidated the exact provenance,
 * stored the answer, closed only the stamped input_required task, and won the
 * answer-vs-timeout claim. This handler must never re-resolve a "latest" task
 * or repeat shared mutation; it only cancels the exact timer, records optional
 * private memory, and enqueues one continuation.
 */

import { log } from '../../lib/log';

const logger = log.service.from('QuestionAnswerNegotiationInflight');

export interface InflightResumeDeps {
  /** Cancel the pending ask_user answer-window timer for the exact task. */
  cancelAskUserExpiry: (negotiationId: string) => Promise<void>;
  /** Enqueue the run-existing continuation. */
  enqueueResume: (opportunityId: string, userId: string) => Promise<void>;
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
  }): Promise<void> => {
    await deps.cancelAskUserExpiry(input.taskId).catch((err) => {
      // Non-fatal: the timer will observe the task is no longer input_required.
      logger.warn('Failed to cancel settled ask-user expiry timer', {
        negotiationId: input.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    deps.recordDisclosureRule?.(input).catch((err) => {
      logger.warn('Failed to record disclosure rule from ask_user answer', {
        questionId: input.questionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    await deps.enqueueResume(input.opportunityId, input.userId);
    logger.info('Authoritatively settled inflight task resumed', {
      negotiationId: input.taskId,
      opportunityId: input.opportunityId,
      questionId: input.questionId,
    });
  };
}
