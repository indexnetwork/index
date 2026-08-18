/**
 * Park-path question enqueue — the composition-site callback injected into
 * the negotiation graph and the external-consultation pause path.
 *
 * The QuestionerAgent, its queue, and the QUESTIONER_ENABLED master switch
 * are retired (docs/plans/2026-08-18-conversational-questions.md,
 * "Retirements"). The parked negotiation is the only durable record of an
 * information need: a park payload routes to the question-message
 * regeneration job for the parked side's `(recipientUserId,
 * recipientIntentId)` scope, unconditionally. Anything that is not a park
 * payload has no generator behind it any more and is dropped with a log —
 * the retired families cannot re-enter through a stale composition site.
 */
import type { QuestionerEnqueueFn, QuestionerEnqueuePayload } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { routeParkedQuestionEnqueue } from './question-message.queue';

const logger = log.queue.from('ParkedQuestionEnqueue');

/** Route one park payload; drop and log anything else. Exported for tests. */
export async function enqueueParkedQuestion(input: QuestionerEnqueuePayload): Promise<void> {
  if (await routeParkedQuestionEnqueue(input)) return;
  logger.warn('Dropped non-park question payload (retired generator family)', {
    mode: (input as { mode?: string }).mode,
    purpose: (input as { purpose?: string }).purpose,
    userId: (input as { userId?: string }).userId,
    sourceId: (input as { sourceId?: string }).sourceId,
  });
}

/**
 * The park-path enqueue callback for graph/tool composition sites. Always
 * defined — the master switch is retired and the park routing ships on.
 */
export function parkedQuestionEnqueue(): QuestionerEnqueueFn {
  return enqueueParkedQuestion;
}
