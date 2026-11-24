/**
 * Negotiations over Nostr (kinds 4641 open, 4642 turn).
 *
 * The Index host opens a negotiation between two intents and sends the
 * opening to both seats. Each turn is signed by the seat (its owner, or an
 * agent the owner attested with NIP-OA) and gift-wrapped to the counterparty
 * and to the host. Turns chain: each names the previous accepted turn (or the
 * opening) in an `e` tag, so a fork shows up as `raced`.
 *
 * {@link NegotiationLedger} replays the transcript through the same rules the
 * Index API enforces (`decideNegotiationTurn`, `decideNegotiationResume`), so
 * the host, either agent, or anyone shown the transcript reaches the same
 * verdict.
 */
import { decideNegotiationResume, decideNegotiationTurn, type NegotiationAction, type NegotiationRejection, type NegotiationState } from '@indexnetwork/protocol/negotiation';
export { NEGOTIATION_MAX_TURNS, NEGOTIATION_MESSAGE_LIMIT } from '@indexnetwork/protocol/negotiation/constants';
import { finalizeEvent, type NostrEvent } from 'nostr-tools/pure';
import { z } from 'zod';

import { principalOf, type AuthTag } from './attestation.js';
import { INTENT_VISIBILITIES } from './intent.js';
import { isHexPubkey } from './keys.js';
import { KIND } from './kinds.js';
import { isValidEvent, tagValue, tagValues, unixNow } from './tags.js';

const pubkey = z.string().refine(isHexPubkey, 'expected a 64-char hex pubkey');

export const negotiationSeatSchema = z.object({
  /** The person this seat acts for. */
  principal: pubkey,
  /** The key the host sends this seat's traffic to: the principal or its agent. */
  negotiator: pubkey,
  intent: z.object({
    address: z.string().min(1),
    /** Null when the counterparty may not read it (incognito). */
    text: z.string().nullable(),
    visibility: z.enum(INTENT_VISIBILITIES),
  }),
});
export type NegotiationSeat = z.infer<typeof negotiationSeatSchema>;

export const negotiationOpenSchema = z.object({
  negotiationId: z.string().uuid(),
  networkId: z.string().min(1),
  /** Initiator first. */
  seats: z.tuple([negotiationSeatSchema, negotiationSeatSchema]),
  maxTurns: z.number().int().positive(),
  messageLimit: z.number().int().positive(),
});
export type NegotiationOpen = z.infer<typeof negotiationOpenSchema>;

export const turnContentSchema = z.object({
  action: z.enum(['propose', 'counter', 'accept', 'decline']),
  message: z.string(),
  clientTurnId: z.string().uuid().optional(),
});
export type TurnContent = z.infer<typeof turnContentSchema>;

/** Build the host's opening. Sign it with the host key and wrap it to both seats' negotiators. */
export function negotiationOpenTemplate(open: NegotiationOpen, createdAt = unixNow()) {
  const value = negotiationOpenSchema.parse(open);
  return {
    kind: KIND.NEGOTIATION_OPEN,
    created_at: createdAt,
    tags: [
      ['negotiation', value.negotiationId],
      ['h', value.networkId],
      ['p', value.seats[0].principal],
      ['p', value.seats[1].principal],
      ['alt', 'Index negotiation opening'],
    ],
    content: JSON.stringify(value),
  };
}

/**
 * Build a turn. `previousId` is the id of the last accepted turn, or of the
 * opening for the first turn.
 */
export function negotiationTurnTemplate(params: {
  negotiationId: string;
  previousId: string;
  counterparty: string;
  turn: TurnContent;
  authTag?: AuthTag;
  createdAt?: number;
}) {
  const tags: string[][] = [
    ['negotiation', params.negotiationId],
    ['e', params.previousId, '', 'reply'],
    ['p', params.counterparty],
    ['alt', `Index negotiation turn: ${params.turn.action}`],
  ];
  if (params.authTag) tags.push([...params.authTag]);
  return {
    kind: KIND.NEGOTIATION_TURN,
    created_at: params.createdAt ?? unixNow(),
    tags,
    content: JSON.stringify(turnContentSchema.parse(params.turn)),
  };
}

/** Sign a turn directly (for agents and tests). */
export function signTurn(params: Parameters<typeof negotiationTurnTemplate>[0], secretKey: Uint8Array): NostrEvent {
  return finalizeEvent(negotiationTurnTemplate(params), secretKey);
}

export type LedgerRejection = NegotiationRejection | 'bad_signature' | 'wrong_negotiation' | 'malformed_turn' | 'not_a_seat_key';

export type LedgerDecision =
  | { ok: false; rejection: LedgerRejection }
  | { ok: true; turnIndex: number; seat: string; action: NegotiationAction; awaiting: string | null; outcome: 'agreed' | null; roundEnded: 'declined' | 'turn_limit' | null; replayed: boolean };

export type OpenParseResult = { ok: true; open: NegotiationOpen; event: NostrEvent } | { ok: false; reason: string };

/** Verify a host-signed opening. */
export function parseNegotiationOpen(event: NostrEvent, hostPubkey: string): OpenParseResult {
  if (event.kind !== KIND.NEGOTIATION_OPEN) return { ok: false, reason: 'not a negotiation opening' };
  if (event.pubkey !== hostPubkey) return { ok: false, reason: 'not signed by the host' };
  if (!isValidEvent(event)) return { ok: false, reason: 'invalid signature' };
  try {
    const open = negotiationOpenSchema.parse(JSON.parse(event.content));
    if (tagValue(event, 'negotiation') !== open.negotiationId) return { ok: false, reason: 'negotiation tag does not match content' };
    if (open.seats[0].principal === open.seats[1].principal) return { ok: false, reason: 'both seats are the same person' };
    return { ok: true, open, event };
  } catch {
    return { ok: false, reason: 'malformed opening' };
  }
}

/**
 * One negotiation's verified transcript and state.
 *
 * Feed it turn events in the order they arrive; it refuses anything the
 * protocol rules refuse and records the rest.
 */
export class NegotiationLedger {
  readonly open: NegotiationOpen;
  readonly openEvent: NostrEvent;
  private readonly state: NegotiationState;
  private readonly accepted: NostrEvent[] = [];
  private readonly byClientTurnId = new Map<string, number>();

  constructor(openEvent: NostrEvent, hostPubkey: string) {
    const parsed = parseNegotiationOpen(openEvent, hostPubkey);
    if (!parsed.ok) throw new Error(`invalid negotiation opening: ${parsed.reason}`);
    this.open = parsed.open;
    this.openEvent = openEvent;
    const [initiator, responder] = parsed.open.seats;
    this.state = {
      initiatorUserId: initiator.principal,
      responderUserId: responder.principal,
      awaitingUserId: initiator.principal,
      outcome: null,
      settled: false,
      eligible: true,
      turns: [],
    };
  }

  get negotiationId(): string { return this.open.negotiationId; }
  get awaiting(): string | null { return this.state.awaitingUserId; }
  get outcome(): 'agreed' | 'declined' | 'closed' | null { return this.state.outcome; }
  get settled(): boolean { return this.state.settled; }
  get turns(): readonly NostrEvent[] { return this.accepted; }
  /** The id the next turn must name as its previous one. */
  get headId(): string { return this.accepted.at(-1)?.id ?? this.openEvent.id; }

  /** @returns The seat (initiator or responder) for a principal, or null. */
  seatOf(principal: string): NegotiationSeat | null {
    return this.open.seats.find((seat) => seat.principal === principal) ?? null;
  }

  /** @returns The other seat. */
  counterpartyOf(principal: string): NegotiationSeat | null {
    const seat = this.seatOf(principal);
    if (!seat) return null;
    return this.open.seats.find((other) => other !== seat) ?? null;
  }

  /** Mark the pair ineligible (an intent was withdrawn or a seat left the network). */
  setEligible(eligible: boolean): void {
    this.state.eligible = eligible;
  }

  /** Verify and apply one turn event. */
  apply(event: NostrEvent): LedgerDecision {
    if (event.kind !== KIND.NEGOTIATION_TURN || !isValidEvent(event)) return { ok: false, rejection: 'bad_signature' };
    if (tagValue(event, 'negotiation') !== this.open.negotiationId) return { ok: false, rejection: 'wrong_negotiation' };
    const resent = this.accepted.findIndex((turn) => turn.id === event.id);
    if (resent !== -1) {
      // The same signed turn sent again (a retry, or a second relay delivering it) is a no-op.
      const turn = this.state.turns[resent]!;
      return { ok: true, turnIndex: resent, seat: turn.seatUserId, action: turn.action, awaiting: this.state.awaitingUserId, outcome: this.state.outcome === 'agreed' ? 'agreed' : null, roundEnded: null, replayed: true };
    }
    let content: TurnContent;
    try {
      content = turnContentSchema.parse(JSON.parse(event.content));
    } catch {
      return { ok: false, rejection: 'malformed_turn' };
    }
    const { principal } = principalOf(event);
    const seat = this.seatOf(principal);
    if (!seat) return { ok: false, rejection: 'not_a_seat' };
    // The seat's owner may always act; an agent only if it is the negotiator the host addressed.
    if (event.pubkey !== seat.principal && event.pubkey !== seat.negotiator) return { ok: false, rejection: 'not_a_seat_key' };

    if (content.clientTurnId) {
      const committed = this.byClientTurnId.get(`${principal}:${content.clientTurnId}`);
      if (committed !== undefined) {
        const turn = this.state.turns[committed]!;
        return { ok: true, turnIndex: committed, seat: principal, action: turn.action, awaiting: this.state.awaitingUserId, outcome: this.state.outcome === 'agreed' ? 'agreed' : null, roundEnded: null, replayed: true };
      }
    }
    const previous = tagValues(event, 'e')[0];
    if (previous !== this.headId) return { ok: false, rejection: 'raced' };

    // A pair paused between rounds resumes when a seat takes a new first turn.
    if (this.state.awaitingUserId === null && !this.state.settled) {
      const resume = decideNegotiationResume(this.state, principal);
      if (!resume.ok) return { ok: false, rejection: resume.rejection === 'not_paused' ? 'not_your_turn' : resume.rejection };
      this.state.awaitingUserId = resume.awaitingUserId;
    }
    const decision = decideNegotiationTurn(this.state, principal, { action: content.action, message: content.message, clientTurnId: content.clientTurnId });
    if (!decision.ok) return decision;
    this.state.turns.push({ seatUserId: principal, action: content.action, message: content.message });
    this.state.awaitingUserId = decision.awaitingUserId;
    if (decision.outcome === 'agreed') {
      this.state.outcome = 'agreed';
      this.state.settled = true;
    }
    this.accepted.push(event);
    if (content.clientTurnId) this.byClientTurnId.set(`${principal}:${content.clientTurnId}`, decision.turnIndex);
    return { ok: true, turnIndex: decision.turnIndex, seat: principal, action: content.action, awaiting: decision.awaitingUserId, outcome: decision.outcome, roundEnded: decision.roundEnded, replayed: false };
  }

  /** The last accepted `propose` the other seat accepted, once agreed. */
  agreedProposal(): { proposer: string; message: string; acceptTurnId: string } | null {
    if (this.state.outcome !== 'agreed') return null;
    const turns = this.state.turns;
    const accept = turns.at(-1);
    const proposal = turns.at(-2);
    if (!accept || !proposal || accept.action !== 'accept' || proposal.action !== 'propose') return null;
    return { proposer: proposal.seatUserId, message: proposal.message, acceptTurnId: this.accepted.at(-1)!.id };
  }
}

/**
 * Replay a whole transcript, as a third party would to check it.
 *
 * @returns The ledger after every turn, and the first refused turn if any.
 */
export function replayNegotiation(openEvent: NostrEvent, turns: NostrEvent[], hostPubkey: string): { ledger: NegotiationLedger; refused: { event: NostrEvent; rejection: LedgerRejection } | null } {
  const ledger = new NegotiationLedger(openEvent, hostPubkey);
  for (const event of turns) {
    const decision = ledger.apply(event);
    if (!decision.ok) return { ledger, refused: { event, rejection: decision.rejection } };
  }
  return { ledger, refused: null };
}
