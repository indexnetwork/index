/**
 * Production implementation of `NegotiationAnswerConsumptionPorts` (#1432) —
 * the four seams the resume path needs, each over machinery that already
 * exists:
 *
 * - `database`: the same exact-task reads the negotiation graph resolves
 *   parks with (`ChatDatabaseAdapter` delegates to the conversation adapter).
 * - `settleInflightAnswer`: the row-less DM settle on the QuestionerAdapter —
 *   the answer is stored inline on the questionSettlement, where the
 *   continuation claim's `loadPrivateConsultation` reads it.
 * - `enqueueInflightResume`: the exact settlement-keyed run-existing job the
 *   card answer path enqueues; the queue's deterministic
 *   `negotiation-resume-${settlementId}` job id makes it idempotent.
 * - `recordOpportunityAnswer`: the `metadata.userAnswers` append, deduped by
 *   `questionId` at the adapter.
 * - `enqueueStalledRetry`: a fresh run-existing job with no exact fields.
 *   Over-enqueueing is safe — every retry races the atomic attempt claim
 *   (`createNegotiationTaskForAttempt`) and all but one lose.
 */
import type { NegotiationAnswerConsumptionPorts } from '@indexnetwork/protocol';

import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { questionerAdapter } from '../../adapters/questioner.adapter.instance';
import { negotiationRunExistingQueue } from '../../queues/negotiations/run-existing.queue';

export function negotiationAnswerConsumptionPorts(): NegotiationAnswerConsumptionPorts {
  return {
    database: chatDatabaseAdapter,
    settleInflightAnswer: (input) => questionerAdapter.settleInflightNegotiationAnswerFromDm({
      taskId: input.taskId,
      settlementId: input.settlementId,
      opportunityId: input.opportunityId,
      recipientUserId: input.recipientUserId,
      recipientIntentId: input.recipientIntentId,
      networkId: input.networkId,
      answer: input.answer,
    }),
    enqueueInflightResume: async (input) => {
      await negotiationRunExistingQueue.addJob({
        opportunityId: input.opportunityId,
        userId: input.userId,
        taskId: input.taskId,
        settlementId: input.settlementId,
        recipientIntentId: input.recipientIntentId,
        networkId: input.networkId,
      });
    },
    recordOpportunityAnswer: async ({ opportunityId, answer }) => {
      await questionerAdapter.recordOpportunityUserAnswer(opportunityId, answer);
    },
    enqueueStalledRetry: async ({ opportunityId, userId }) => {
      await negotiationRunExistingQueue.addJob({ opportunityId, userId });
    },
  };
}
