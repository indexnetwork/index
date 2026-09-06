import { pairKeyOf } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { negotiationDatabaseAdapter, type NegotiationDatabaseAdapter, type NegotiationDetail, type NegotiationTurnAction, type NegotiationView, type OpenedNegotiation, type SubmitTurnRejection } from '../adapters/negotiation.database.adapter';
import { publishNotificationStreamEvent } from '../lib/notification-stream-events';

const logger = log.service.from('NegotiationService');

export type { NegotiationDetail, NegotiationTurnAction, NegotiationView, SubmitTurnRejection };

export interface SubmitTurnFailure {
  rejection: SubmitTurnRejection;
}

/**
 * What came of opening a pair by hand. Everything but `opened` and
 * `already_open` means nothing was written.
 */
export type OpenOutcome =
  | { kind: 'opened'; negotiation: OpenedNegotiation }
  | { kind: 'already_open'; negotiation: OpenedNegotiation }
  | { kind: 'unseated'; intentId: string }
  | { kind: 'same_signal' }
  | { kind: 'same_owner' }
  | { kind: 'not_opened' };

/**
 * The negotiation record, and the turns taken against it.
 *
 * Index is the server for every negotiation: it validates the turn order,
 * appends the turn, applies its effect, and computes the settlement from its
 * own log. Both seats read the same verdict from the same record, so there is
 * nothing to mirror and nothing to verify client-side.
 */
export class NegotiationService {
  constructor(private readonly negotiations: NegotiationDatabaseAdapter = negotiationDatabaseAdapter) {}

  /**
   * The caller's negotiations.
   *
   * @param userId - The seat owner.
   * @param options - Narrow to one signal, or to records still open.
   * @returns One view per negotiation the caller sits in.
   */
  async list(
    userId: string,
    options: { intentId?: string; open?: boolean; counterpartyUserId?: string; limit?: number; offset?: number } = {},
  ): Promise<NegotiationView[]> {
    return this.negotiations.listForUser(userId, options);
  }

  /**
   * One negotiation with its turn log.
   *
   * @param opportunityId - The negotiation's opportunity.
   * @param userId - The caller, who must own one of the two seats.
   * @returns The record as that seat sees it, or null.
   */
  async read(opportunityId: string, userId: string): Promise<NegotiationDetail | null> {
    return this.negotiations.getForUser(opportunityId, userId);
  }

  /**
   * Submit one structured decision.
   *
   * On a non-terminal turn the other seat is told it is their turn. On a
   * terminal one the settlement is written, the opportunity follows it, and
   * both seats are told it ended. An accepted opportunity reaches `pending`,
   * which is what puts it in front of the two humans for consent.
   *
   * @param opportunityId - The negotiation's opportunity.
   * @param callerUserId - The seat submitting.
   * @param turn - The decision and its message.
   * @returns The negotiation as the caller now sees it, or the refusal reason.
   */
  async submitTurn(
    opportunityId: string,
    callerUserId: string,
    turn: { action: NegotiationTurnAction; message: string },
  ): Promise<NegotiationDetail | SubmitTurnFailure> {
    const result = await this.negotiations.submitTurn(opportunityId, callerUserId, turn);
    if (!result.ok) return { rejection: result.rejection };

    const { negotiation, turnIndex, otherSeatUserId, settled } = result;
    const intentIdFor = (userId: string) => userId === negotiation.initiatorUserId
      ? negotiation.initiatorIntentId
      : negotiation.responderIntentId;

    if (settled) {
      await Promise.all([negotiation.initiatorUserId, negotiation.responderUserId].map((seatUserId) =>
        this.notify(seatUserId, {
          type: 'negotiation.settled',
          id: `${opportunityId}:settled`,
          title: 'A negotiation ended',
          body: settled === 'agreed' ? 'Both agents agreed.' : 'One agent declined.',
          data: { opportunityId, intentId: intentIdFor(seatUserId), outcome: settled },
        })));
    } else {
      await this.notify(otherSeatUserId, {
        type: 'negotiation.turn',
        id: `${opportunityId}:${turnIndex + 1}`,
        title: 'Your turn',
        body: 'A negotiation is waiting on your agent.',
        data: { opportunityId, intentId: intentIdFor(otherSeatUserId), turnIndex: turnIndex + 1 },
      });
    }

    return await this.negotiations.getForUser(opportunityId, callerUserId) as NegotiationDetail;
  }

  /**
   * Open a negotiation between two seated signals without asking discovery.
   *
   * Discovery decides both whether a pair is worth opening and which side
   * moves first. This decides neither: the caller names the pair, and the
   * initiator is the side they put first, which is the side that owes the
   * opening turn.
   *
   * Idempotent by pair. A pair discovery reached first comes back as
   * `already_open` with the record it wrote, so a caller opening the same set
   * twice — or racing the discovery run its own signal just triggered — is
   * safe.
   *
   * @param params - The network and the two signals, initiator first.
   * @returns The opened or already-open record, or why it could not open.
   */
  async open(params: {
    networkId: string;
    initiatorIntentId: string;
    responderIntentId: string;
  }): Promise<OpenOutcome> {
    const { networkId, initiatorIntentId, responderIntentId } = params;
    if (initiatorIntentId === responderIntentId) return { kind: 'same_signal' };

    const [initiator, responder] = await Promise.all([
      this.negotiations.seatedIntent(initiatorIntentId, networkId),
      this.negotiations.seatedIntent(responderIntentId, networkId),
    ]);
    if (!initiator) return { kind: 'unseated', intentId: initiatorIntentId };
    if (!responder) return { kind: 'unseated', intentId: responderIntentId };
    if (initiator.userId === responder.userId) return { kind: 'same_owner' };

    const pairKey = pairKeyOf(networkId, initiator.intentId, responder.intentId);
    const [opened] = await this.negotiations.openCounterparties([{
      pairKey,
      networkId,
      intentA: initiator.intentId,
      intentB: responder.intentId,
      userA: initiator.userId,
      userB: responder.userId,
      score: 100,
      reasoning: 'Opened directly by the network owner rather than by discovery, so it carries no compatibility score.',
      evidence: [],
      detection: { source: 'operator_open', createdBy: 'network-owner' },
    }]);
    if (opened) return { kind: 'opened', negotiation: opened };

    // open() reports "already there" and "could not" identically, so the only
    // way to tell them apart is to look.
    const existing = await this.negotiations.findByPairKey(pairKey);
    return existing ? { kind: 'already_open', negotiation: existing } : { kind: 'not_opened' };
  }

  /**
   * Tell a seat its negotiation moved. Delivery failure must not undo a turn
   * that is already recorded, so it is logged and swallowed.
   *
   * @param userId - The seat owner to notify.
   * @param event - The frame to publish on that owner's channel.
   */
  private async notify(userId: string, event: Parameters<typeof publishNotificationStreamEvent>[1]): Promise<void> {
    try {
      await publishNotificationStreamEvent(userId, event);
    } catch (error) {
      logger.error('Failed to publish negotiation event', {
        userId,
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const negotiationService = new NegotiationService();
