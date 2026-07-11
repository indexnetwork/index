/**
 * Negotiation-inflight answer handler (P3.2 resume path): a negotiator paused
 * mid-negotiation with `ask_user` to consult its own client, and the client
 * answered.
 *
 * Flow: store the answer on the opportunity (same channel the resuming
 * negotiator reads via `userAnswers`) → cancel the 24 h answer-window timer →
 * terminally close the paused `input_required` task (the resume session
 * creates a fresh task inheriting seat + protocol version from its metadata)
 * → enqueue the existing `negotiation-run-existing` continuation.
 *
 * When no paused task exists (window already expired and the expiry worker
 * resumed with the conservative default, or the negotiation terminated some
 * other way), the answer is still stored — it enriches any future session —
 * but no resume is enqueued.
 */

import { log } from '../../lib/log';

const logger = log.service.from('QuestionAnswerNegotiationInflight');

export interface InflightResumeDeps {
  /** Store the answer as negotiation context (shared with the `negotiation` mode handler). */
  storeNegotiationContext: (input: {
    userId: string;
    opportunityId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }) => Promise<void>;
  /** Latest negotiation task attached to the opportunity. */
  getNegotiationTaskForOpportunity: (opportunityId: string) => Promise<{
    id: string;
    state: string;
  } | null>;
  /** Cancel the pending ask_user answer-window timer. */
  cancelAskUserExpiry: (negotiationId: string) => Promise<void>;
  /** Terminally transition the paused task. */
  closeTask: (taskId: string, reason: string) => Promise<void>;
  /** Enqueue the run-existing continuation. */
  enqueueResume: (opportunityId: string, userId: string) => Promise<void>;
  /**
   * Optional P5.2 hook: record the client's answer as an immediate
   * `disclosure_rule` negotiator memory (the answer is already a distilled
   * policy). Fire-and-forget — a memory-write failure must never affect the
   * resume. Absent → behaves exactly as before.
   */
  recordDisclosureRule?: (input: {
    userId: string;
    opportunityId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }) => Promise<void>;
}

export function resumeInflightNegotiationFactory(deps: InflightResumeDeps) {
  return async (input: {
    userId: string;
    opportunityId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
  }): Promise<void> => {
    // 1. Store the answer first — even if the resume below short-circuits,
    //    the context enrichment must not be lost.
    await deps.storeNegotiationContext(input);

    // 1b. Memory write path (P5.2): an ask_user answer is already a distilled
    //     disclosure policy — record it immediately, fire-and-forget.
    deps.recordDisclosureRule?.(input).catch((err) => {
      logger.warn('Failed to record disclosure rule from ask_user answer', {
        questionId: input.questionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 2. Find the paused task.
    const task = await deps.getNegotiationTaskForOpportunity(input.opportunityId);
    if (!task || task.state !== 'input_required') {
      logger.info('No paused negotiation task for answered inflight question — answer stored, no resume', {
        opportunityId: input.opportunityId,
        questionId: input.questionId,
        taskState: task?.state ?? 'none',
      });
      return;
    }

    // 3. Cancel the answer-window timer (the client answered in time).
    await deps.cancelAskUserExpiry(task.id).catch((err) => {
      // Non-fatal: a leftover timer no-ops at fire time because the task will
      // no longer be input_required.
      logger.warn('Failed to cancel ask-user expiry timer', {
        negotiationId: task.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 4. Terminally close the paused task so the resume session's init node
    //    sees no lock and creates the continuation task.
    await deps.closeTask(task.id, 'ask_user_answered');

    // 5. Resume.
    await deps.enqueueResume(input.opportunityId, input.userId);

    logger.info('Paused negotiation resumed with client answer', {
      negotiationId: task.id,
      opportunityId: input.opportunityId,
      questionId: input.questionId,
      userId: input.userId,
    });
  };
}
