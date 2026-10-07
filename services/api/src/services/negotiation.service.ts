import { Negotiations, observeNegotiation, type NegotiationTurn } from '@indexnetwork/protocol';

import { emitOpportunityTransitionBestEffort } from '../events/opportunity.event';
import { negotiationDatabaseAdapter, type AppliedNegotiationDecision, type NegotiationDatabaseAdapter, type NegotiationDetail as StoredNegotiationDetail, type NegotiationExecution, type NegotiationScanRecord, type NegotiationSeat, type NegotiationTurnAction, type NegotiationView, type OwedNotification, type SubmitTurnRejection } from '../adapters/negotiation.database.adapter';
import { publishUserEvent } from '../lib/user-events';

/** Most pending notifications one relay claim takes. */
const DELIVERY_BATCH = 100;
/** How long a claim holds before another relay pass may take its rows again. */
const DELIVERY_LEASE_MS = 30_000;

export { negotiationTurnSchema } from '@indexnetwork/protocol';
export type { NegotiationTurnAction, NegotiationView, SubmitTurnRejection };
export type NegotiationDetail = StoredNegotiationDetail & { protocol: NonNullable<Awaited<ReturnType<Negotiations['observe']>>> };

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
   * Discover changes without loading negotiation details.
   *
   * @param userId - The seat owner.
   * @param intentId - The intent bound to the agent session.
   * @returns Negotiation IDs, change versions, and current eligibility.
   */
  async scan(userId: string, intentId: string): Promise<NegotiationScanRecord[]> {
    return this.negotiations.scanForIntent(userId, intentId);
  }

  /**
   * One negotiation with its turn log.
   *
   * @param opportunityId - The negotiation's opportunity.
   * @param userId - The caller, who must own one of the two seats.
   * @returns The record as that seat sees it, or null.
   */
  async read(opportunityId: string, userId: string): Promise<NegotiationDetail | null> {
    const stored = await this.negotiations.getForUser(opportunityId, userId);
    if (!stored) return null;
    const { state, ...record } = stored;
    return { ...record, protocol: observeNegotiation(state, userId) };
  }

  /**
   * Submit one structured decision.
   *
   * The turn, its effect, and the notifications it owes commit together: on a
   * non-terminal turn the other seat is owed `negotiation.turn`; on a terminal
   * one the settlement is written, the opportunity follows it, and both seats
   * are owed `negotiation.settled`. Both seats are always owed
   * `negotiation.changed`. Success means the turn and those obligations are
   * durable, not that they reached Redis: {@link deliverOwedNotifications}
   * publishes them. An accepted opportunity reaches `pending`, which is what
   * puts it in front of the two humans for consent.
   *
   * @param opportunityId - The negotiation's opportunity.
   * @param callerUserId - The seat submitting.
   * @param turn - The decision, its message, and the turn count it was reasoned over.
   * @param execution - Hosted lease or external executor binding checked in the write transaction.
   * @returns The negotiation as the caller now sees it, or the refusal reason.
   */
  async submitTurn(
    opportunityId: string,
    callerUserId: string,
    turn: NegotiationTurn,
    execution?: NegotiationExecution,
  ): Promise<NegotiationDetail | SubmitTurnFailure> {
    const capability = new Negotiations({
      readNegotiationState: (id, userId) => this.negotiations.readNegotiationState(id, userId),
      commitNegotiationTurn: (id, userId, input, decide) => this.negotiations.commitNegotiationTurn(
        id, userId, input, decide, (decision, seats) => turnNotifications(opportunityId, callerUserId, decision, seats), execution,
      ),
    });
    const result = await capability.execute(opportunityId, callerUserId, turn);
    if (!result.ok) return { rejection: result.rejection };
    if (result.opportunityStatus === 'pending' || result.opportunityStatus === 'rejected') {
      emitOpportunityTransitionBestEffort({ id: opportunityId, status: result.opportunityStatus });
    }
    return (await this.read(opportunityId, callerUserId))!;
  }

  /**
   * Publish every pending turn notification to its recipient's stream.
   *
   * Each row is claimed under a lease and deleted only after Redis confirmed
   * the append under that same claim. A failed append stops the pass and
   * leaves the rest claimed until the lease expires, when the next pass takes
   * them again. A crash between append and delete publishes the frame again
   * with the same notification id.
   *
   * @returns How many notifications this pass delivered.
   * @throws When Redis or the database fails; undelivered rows stay pending.
   */
  async deliverOwedNotifications(): Promise<number> {
    let delivered = 0;
    for (;;) {
      const { claimToken, notifications } = await this.negotiations.claimNotifications(DELIVERY_BATCH, DELIVERY_LEASE_MS);
      for (const notification of notifications) {
        await publishUserEvent(notification.recipientUserId, notification.frame);
        if (await this.negotiations.completeNotification(notification.id, claimToken)) delivered++;
      }
      if (notifications.length < DELIVERY_BATCH) return delivered;
    }
  }
}

/**
 * What one applied turn owes each seat. A turn or settlement frame carries
 * the turn count it leaves behind as `turnIndex`, the index of the turn now
 * owed, so a consumer can ignore one a later turn has overtaken.
 *
 * @param opportunityId - The negotiation's opportunity.
 * @param callerUserId - The seat that took the turn.
 * @param decision - The applied transition.
 * @param seats - Both seats with their intents.
 * @returns The frames to record with the turn.
 */
function turnNotifications(
  opportunityId: string,
  callerUserId: string,
  decision: AppliedNegotiationDecision,
  seats: NegotiationSeat[],
): OwedNotification[] {
  const turnCount = decision.turnIndex + 1;
  const ended = decision.outcome !== null || decision.blockedReason !== null;
  const changed = seats.map((seat): OwedNotification => ({
    recipientUserId: seat.userId,
    frame: { type: 'negotiation.changed', id: crypto.randomUUID(), title: '', body: '', data: { intentId: seat.intentId, opportunityId } },
  }));
  const moved = seats.filter((seat) => ended || seat.userId !== callerUserId).map((seat): OwedNotification => ({
    recipientUserId: seat.userId,
    frame: {
      type: decision.outcome ? 'negotiation.settled' : 'negotiation.turn',
      id: `${opportunityId}:${turnCount}`,
      title: decision.outcome ? 'A negotiation ended' : decision.blockedReason ? 'A negotiation paused' : 'Your turn',
      body: decision.outcome === 'agreed' ? 'Both agents agreed; owner approval is still required.'
        : decision.outcome === 'declined' ? 'One agent declined.'
          : decision.blockedReason ? 'The turn limit was reached without deciding an outcome.' : 'A negotiation is waiting on your agent.',
      data: { opportunityId, intentId: seat.intentId, outcome: decision.outcome, blockedReason: decision.blockedReason, turnIndex: turnCount },
    },
  }));
  return [...changed, ...moved];
}

export const negotiationService = new NegotiationService();
