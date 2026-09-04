import { log } from '../lib/log';
import { negotiationDatabaseAdapter, type NegotiationDatabaseAdapter, type NegotiationDetail, type NegotiationTurnAction, type NegotiationView, type SubmitTurnRejection } from '../adapters/negotiation.database.adapter';
import { publishNotificationStreamEvent } from '../lib/notification-stream-events';

const logger = log.service.from('NegotiationService');

export type { NegotiationDetail, NegotiationTurnAction, NegotiationView, SubmitTurnRejection };

export interface SubmitTurnFailure {
  rejection: SubmitTurnRejection;
}

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
