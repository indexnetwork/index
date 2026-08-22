/**
 * Park-path question enqueue — the composition-site callback injected into
 * the negotiation graph and the external-consultation pause path.
 *
 * Every park producer funnels through here, and since the holistic
 * intent-agent collapse (docs/plans/2026-08-21-holistic-intent-agent.md) a
 * park payload routes to the IntentAgent inbox as a `negotiation_needs_input`
 * event for the parked side's `(recipientUserId, recipientIntentId)` scope.
 * The park + capture + settlement arming upstream are untouched; only the
 * question AUTHORING moved — the agent decides whether to answer from the
 * dossier/conversation or to ask in its own prose. Anything that is not a
 * park payload has no generator behind it any more (the QuestionerAgent
 * retirements) and is dropped with a log.
 */
import type { QuestionerEnqueueFn, QuestionerEnqueuePayload } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { intentAgentQueue } from './intent-agent.queue';
import type { IntentAgentNeedsInputEvent } from '../lib/intent-agent/intent-agent.types';

const logger = log.queue.from('ParkedQuestionEnqueue');

/**
 * The agent event a park payload carries, or null for every payload family
 * that still belongs to the retired QuestionerAgent. Both park families name
 * the parked side as `negotiation.recipient*` — the user whose input is
 * required and the signal whose agent owns the ask.
 */
export function parkedNeedsInputEvent(input: QuestionerEnqueuePayload): IntentAgentNeedsInputEvent | null {
  const isParkFamily =
    (input.mode === 'negotiation_inflight' && input.purpose === 'inflight_consultation')
    || (input.mode === 'negotiation' && input.purpose === 'stalled_followup');
  if (!isParkFamily || !input.negotiation) return null;
  const { recipientUserId, recipientIntentId, opportunityId, taskId } = input.negotiation;
  if (!recipientUserId || !recipientIntentId || !opportunityId) return null;
  return {
    kind: 'negotiation_needs_input',
    userId: recipientUserId,
    intentId: recipientIntentId,
    opportunityId,
    ...(taskId ? { taskId } : {}),
  };
}

/** Injectable seams for {@link routeParkedQuestionEnqueue}; production uses the real collaborators. */
export interface ParkedQuestionRoutingDeps {
  addNeedsInputEvent?: (event: IntentAgentNeedsInputEvent) => Promise<unknown>;
}

/**
 * Trigger hook for the park paths: when the payload is a park, wake the
 * parked side's IntentAgent and report the payload as handled. Everything
 * else returns false.
 *
 * Every park wakes the agent — reachability is not a gate here. Whether the
 * principal will ever read the question is the agent's and the expiry's
 * concern, not the author's.
 */
export async function routeParkedQuestionEnqueue(
  input: QuestionerEnqueuePayload,
  deps?: ParkedQuestionRoutingDeps,
): Promise<boolean> {
  const event = parkedNeedsInputEvent(input);
  if (!event) return false;
  const addNeedsInputEvent = deps?.addNeedsInputEvent
    ?? ((data: IntentAgentNeedsInputEvent) => intentAgentQueue.addNeedsInputEvent(data));
  await addNeedsInputEvent(event);
  logger.info('negotiation_client_question_routed', {
    userId: event.userId,
    intentId: event.intentId,
    opportunityId: event.opportunityId,
    taskId: event.taskId,
    mode: input.mode,
    purpose: input.purpose,
  });
  return true;
}

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
