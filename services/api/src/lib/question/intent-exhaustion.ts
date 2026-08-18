/**
 * Own-intent exhaustion predicate (conversational questions,
 * docs/plans/2026-08-18-conversational-questions.md).
 *
 * Exhaustion is a state predicate, not a counter: an intent is exhausted when
 * no negotiation on it is ongoing. "Ongoing" means an agent turn is scheduled
 * or running — exactly the 'negotiating' status. Everything else is
 * not-ongoing by definition:
 *
 * - 'latent' and 'draft' are discovery candidates (pool row, chat-only
 *   surface); no agent turn is scheduled by state alone.
 * - 'pending' awaits owner approval — a human gate, not a running negotiation.
 * - 'stalled' is a post-stall park awaiting the client, or a terminal stall;
 *   either way the agents' turns are over. A parked negotiation must not hold
 *   this user's question-message hostage.
 * - 'accepted' | 'rejected' | 'expired' are terminal.
 *
 * Because it is a predicate over states rather than a count, it survives
 * discovery re-runs and manually created opportunities.
 *
 * Today the predicate gates only logging/telemetry: the exhaustion evaluator
 * enqueues a regeneration on every qualifying transition regardless, and the
 * edit rule coalesces everything into the open message, so the "one coherent
 * grouped message at exhaustion" moment needs no special-case code. The
 * predicate exists as a named function so the concept lives in code.
 */
import type { OpportunityStatus } from '@indexnetwork/protocol';

/** True while an agent turn on the negotiation is scheduled or running. */
export function isOngoingNegotiationStatus(status: OpportunityStatus): boolean {
  return status === 'negotiating';
}

/**
 * True when no negotiation on the intent is ongoing. An intent with no
 * opportunities at all is trivially exhausted.
 */
export function isIntentExhausted(statuses: readonly OpportunityStatus[]): boolean {
  return !statuses.some(isOngoingNegotiationStatus);
}
