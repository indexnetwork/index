import { z } from 'zod';

import { NEGOTIATION_MAX_TURNS, NEGOTIATION_MESSAGE_LIMIT } from './negotiation.constants.js';
import { NEGOTIATION_GUIDANCE } from './protocol.prompt.js';

export type NegotiationAction = 'propose' | 'counter' | 'accept' | 'decline';
export const negotiationTurnSchema = z.object({
  action: z.enum(['propose', 'counter', 'accept', 'decline']),
  message: z.string().trim().min(1).max(NEGOTIATION_MESSAGE_LIMIT),
  expectedTurnCount: z.number().int().nonnegative(),
});

export type NegotiationOutcome = 'agreed' | 'declined' | 'closed';
export interface NegotiationTurn {
  action: NegotiationAction;
  message: string;
  /** The log length the participant used to make this decision. */
  expectedTurnCount: number;
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
export type NegotiationRejection = 'not_found' | 'not_a_seat' | 'already_settled' | 'signal_inactive'
  | 'turn_limit' | 'not_your_turn' | 'raced' | 'invalid_turn' | 'propose_not_first'
  | 'counter_is_first' | 'accept_without_offer';
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
  outcome: 'agreed' | 'declined' | null;
  opportunityStatus: 'negotiating' | 'pending' | 'rejected';
  blockedReason: 'turn_limit' | null;
};

/** @param pair - Current membership and intent eligibility. @returns The permitted opening, or null. */
export function decideNegotiationOpening(pair: NegotiationOpening): NegotiationOpeningDecision {
  return pair.eligible && pair.userA !== pair.userB && pair.intentA !== pair.intentB
    ? { awaitingUserId: pair.userA, opportunityStatus: 'negotiating' } : null;
}

/** @param state - Current authoritative state. @param userId - Acting principal. @returns Why no action may be taken. */
export function negotiationBlockedReason(state: NegotiationState, userId: string): NegotiationRejection | null {
  if (userId !== state.initiatorUserId && userId !== state.responderUserId) return 'not_a_seat';
  if (state.settled) return 'already_settled';
  if (!state.eligible) return 'signal_inactive';
  if (state.turns.length >= NEGOTIATION_MAX_TURNS) return 'turn_limit';
  if (state.awaitingUserId !== userId) return 'not_your_turn';
  return null;
}

/** @param state - State locked by the host. @param userId - Acting principal. @param turn - Proposed action. @returns The complete permitted transition or refusal. */
export function decideNegotiationTurn(state: NegotiationState | null, userId: string, turn: NegotiationTurn): NegotiationDecision {
  if (!state) return { ok: false, rejection: 'not_found' };
  const rejection = negotiationBlockedReason(state, userId);
  if (rejection) return { ok: false, rejection };
  const turnIndex = state.turns.length;
  if (turn.expectedTurnCount !== turnIndex) return { ok: false, rejection: 'raced' };
  if (!negotiationTurnSchema.safeParse(turn).success) return { ok: false, rejection: 'invalid_turn' };
  if (turn.action === 'propose' && turnIndex !== 0) return { ok: false, rejection: 'propose_not_first' };
  if (turn.action === 'counter' && turnIndex === 0) return { ok: false, rejection: 'counter_is_first' };
  const previous = state.turns[state.turns.length - 1];
  if (turn.action === 'accept' && (!previous || previous.seatUserId === userId || !['propose', 'counter'].includes(previous.action))) return { ok: false, rejection: 'accept_without_offer' };
  const outcome = turn.action === 'accept' ? 'agreed' : turn.action === 'decline' ? 'declined' : null;
  const blockedReason = !outcome && turnIndex + 1 >= NEGOTIATION_MAX_TURNS ? 'turn_limit' : null;
  return {
    ok: true, turnIndex, outcome, blockedReason,
    awaitingUserId: outcome || blockedReason ? null : userId === state.initiatorUserId ? state.responderUserId : state.initiatorUserId,
    opportunityStatus: outcome === 'agreed' ? 'pending' : outcome === 'declined' ? 'rejected' : 'negotiating',
  };
}

/** @param state - Current authoritative state. @param userId - Reading principal. @returns Guidance and actions available to that seat now. */
export function observeNegotiation(state: NegotiationState, userId: string) {
  const blockedReason = negotiationBlockedReason(state, userId);
  const availableActions: NegotiationAction[] = blockedReason ? [] : state.turns.length ? ['counter', 'accept', 'decline'] : ['propose', 'decline'];
  return { guidance: NEGOTIATION_GUIDANCE, availableActions, blockedReason, maxTurns: NEGOTIATION_MAX_TURNS, messageLimit: NEGOTIATION_MESSAGE_LIMIT };
}
