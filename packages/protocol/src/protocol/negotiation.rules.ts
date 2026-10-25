import { z } from 'zod';

import { NEGOTIATION_MAX_TURNS, NEGOTIATION_MESSAGE_LIMIT } from './negotiation.constants.js';
import { NEGOTIATION_GUIDANCE } from './protocol.prompt.js';

export type NegotiationAction = 'propose' | 'counter' | 'accept' | 'decline';
export const negotiationTurnSchema = z.object({
  action: z.enum(['propose', 'counter', 'accept', 'decline']),
  message: z.string().trim().min(1).max(NEGOTIATION_MESSAGE_LIMIT),
});

export type NegotiationOutcome = 'agreed' | 'declined' | 'closed';
export interface NegotiationTurn {
  action: NegotiationAction;
  message: string;
}
export interface NegotiationState {
  initiatorUserId: string;
  responderUserId: string;
  awaitingUserId: string | null;
  outcome: NegotiationOutcome | null;
  settled: boolean;
  /** Both intents are active, assigned to this network, and owned by current members. */
  eligible: boolean;
  turns: { seatUserId: string; action: NegotiationAction; message: string }[];
}
export type NegotiationRejection = 'not_found' | 'not_a_seat' | 'already_settled' | 'intent_inactive'
  | 'not_your_turn' | 'raced' | 'invalid_turn'
  | 'counter_is_first' | 'accept_without_offer' | 'propose_over_offer';
export interface NegotiationOpening {
  userA: string;
  userB: string;
  intentA: string;
  intentB: string;
  eligible: boolean;
}
export type NegotiationOpeningDecision = { awaitingUserId: string; opportunityStatus: 'negotiating' } | null;
export type NegotiationDecision = { ok: false; rejection: NegotiationRejection } | {
  ok: true;
  turnIndex: number;
  awaitingUserId: string | null;
  outcome: 'agreed' | null;
  opportunityStatus: 'negotiating' | 'pending';
  /** Why this turn ended its round, leaving nobody to move until a seat resumes it. */
  roundEnded: 'declined' | 'turn_limit' | null;
};

/**
 * The turns of the round in progress. A round ends at a decline or after
 * {@link NEGOTIATION_MAX_TURNS} turns; neither ends the negotiation, which
 * stays in talks with nobody to move until a seat resumes it, because its
 * owner added context that bears on the pair.
 *
 * @param turns - The whole turn log, oldest first.
 * @returns The turns since the last round ended.
 */
export function currentRound<T extends { action: NegotiationAction }>(turns: T[]): T[] {
  let start = 0;
  turns.forEach((turn, index) => {
    if (turn.action === 'decline' || index + 1 - start >= NEGOTIATION_MAX_TURNS) start = index + 1;
  });
  return turns.slice(start);
}

/** Why a seat may not resume a negotiation: it is not paused between rounds, or it cannot be worked at all. */
export type NegotiationResumeRejection = 'not_found' | 'not_a_seat' | 'already_settled' | 'intent_inactive' | 'not_paused';
export type NegotiationResumeDecision = { ok: false; rejection: NegotiationResumeRejection } | { ok: true; awaitingUserId: string };

/** @param pair - Current membership and intent eligibility. @returns The permitted opening, or null. */
export function decideNegotiationOpening(pair: NegotiationOpening): NegotiationOpeningDecision {
  return pair.eligible && pair.userA !== pair.userB && pair.intentA !== pair.intentB
    ? { awaitingUserId: pair.userA, opportunityStatus: 'negotiating' } : null;
}

/** @param state - Current authoritative state. @param userId - Acting principal. @returns Why no action may be taken. */
export function negotiationBlockedReason(state: NegotiationState, userId: string): NegotiationRejection | null {
  if (userId !== state.initiatorUserId && userId !== state.responderUserId) return 'not_a_seat';
  if (state.settled) return 'already_settled';
  if (!state.eligible) return 'intent_inactive';
  if (state.awaitingUserId !== userId) return 'not_your_turn';
  return null;
}

/** @param state - State locked by the host. @param userId - Acting principal. @param turn - Proposed action. @returns The complete permitted transition or refusal. */
export function decideNegotiationTurn(state: NegotiationState | null, userId: string, turn: NegotiationTurn): NegotiationDecision {
  if (!state) return { ok: false, rejection: 'not_found' };
  const rejection = negotiationBlockedReason(state, userId);
  if (rejection) return { ok: false, rejection };
  const turnIndex = state.turns.length;
  if (!negotiationTurnSchema.safeParse(turn).success) return { ok: false, rejection: 'invalid_turn' };
  const round = currentRound(state.turns);
  if (turn.action === 'counter' && round.length === 0) return { ok: false, rejection: 'counter_is_first' };
  const previous = round[round.length - 1];
  // A counter questions an offer without making one, so only a propose stands
  // to be accepted: answering a counter means proposing again.
  if (turn.action === 'accept' && (!previous || previous.seatUserId === userId || previous.action !== 'propose')) return { ok: false, rejection: 'accept_without_offer' };
  // The other seat's offer is already on the table. Restating it as your own
  // settles nothing and spends a turn, so it is answered rather than repeated.
  if (turn.action === 'propose' && previous && previous.seatUserId !== userId && previous.action === 'propose') return { ok: false, rejection: 'propose_over_offer' };
  // Only agreement settles. A decline or a full round leaves the pair in talks
  // with nobody to move, until a seat resumes it.
  const outcome = turn.action === 'accept' ? 'agreed' : null;
  const roundEnded = outcome ? null : turn.action === 'decline' ? 'declined' : round.length + 1 >= NEGOTIATION_MAX_TURNS ? 'turn_limit' : null;
  return {
    ok: true, turnIndex, outcome, roundEnded,
    awaitingUserId: outcome || roundEnded ? null : userId === state.initiatorUserId ? state.responderUserId : state.initiatorUserId,
    opportunityStatus: outcome ? 'pending' : 'negotiating',
  };
}

/**
 * Whether a seat may resume a negotiation paused between rounds.
 *
 * Resuming is the seat's own call: its owner added context that bears on this
 * pair, so it takes the first turn of a new round. Nothing resumes on its own.
 *
 * @param state - State locked by the host. @param userId - Resuming principal.
 * @returns The seat that takes the turn, or why it may not.
 */
export function decideNegotiationResume(state: NegotiationState | null, userId: string): NegotiationResumeDecision {
  if (!state) return { ok: false, rejection: 'not_found' };
  if (userId !== state.initiatorUserId && userId !== state.responderUserId) return { ok: false, rejection: 'not_a_seat' };
  if (state.settled) return { ok: false, rejection: 'already_settled' };
  if (!state.eligible) return { ok: false, rejection: 'intent_inactive' };
  if (state.awaitingUserId !== null) return { ok: false, rejection: 'not_paused' };
  return { ok: true, awaitingUserId: userId };
}

/** @param state - Current authoritative state. @param userId - Reading principal. @returns Guidance and actions available to that seat now. */
export function observeNegotiation(state: NegotiationState, userId: string) {
  const blockedReason = negotiationBlockedReason(state, userId);
  const round = currentRound(state.turns);
  const previous = round[round.length - 1];
  const availableActions: NegotiationAction[] = blockedReason ? []
    : !previous ? ['propose', 'decline']
      : previous.action === 'propose' ? ['counter', 'accept', 'decline']
        : ['propose', 'counter', 'decline'];
  return {
    guidance: NEGOTIATION_GUIDANCE, availableActions, blockedReason, maxTurns: NEGOTIATION_MAX_TURNS,
    remainingTurns: NEGOTIATION_MAX_TURNS - round.length, messageLimit: NEGOTIATION_MESSAGE_LIMIT,
  };
}
