import { Negotiations, observeNegotiation, type NegotiationTurn } from '@indexnetwork/protocol';

import { emitOpportunityTransitionBestEffort } from '../events/opportunity.event';
import { log } from '../lib/log';
import { negotiationDatabaseAdapter, type NegotiationDatabaseAdapter, type NegotiationDetail as StoredNegotiationDetail, type NegotiationExecution, type NegotiationResumeRejection, type NegotiationScanRecord, type NegotiationTurnAction, type NegotiationView, type SubmitTurnRejection } from '../adapters/negotiation.database.adapter';
import { publishNegotiationChange, publishUserEvent } from '../lib/user-events';

const logger = log.service.from('NegotiationService');

export { negotiationTurnSchema } from '@indexnetwork/protocol';
export type { NegotiationResumeRejection, NegotiationTurnAction, NegotiationView, SubmitTurnRejection };
export type NegotiationDetail = StoredNegotiationDetail & { protocol: NonNullable<Awaited<ReturnType<Negotiations['observe']>>> };

export interface SubmitTurnFailure {
  rejection: SubmitTurnRejection;
}

export interface ResumeFailure {
  rejection: NegotiationResumeRejection;
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
   * @param options - Narrow to one intent, or to records still open.
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
   * On an ordinary turn the other seat is told it is their turn. An accept
   * settles: the opportunity reaches `pending`, which is what puts it in front
   * of the two humans for consent, and both seats are told it ended. A decline
   * or the last turn of a round ends only the round: the pair stays in talks
   * with nobody to move, and both seats are told it paused.
   *
   * @param opportunityId - The negotiation's opportunity.
   * @param callerUserId - The seat submitting.
   * @param turn - The decision and its message.
   * @param execution - Hosted lease or external executor binding checked in the write transaction.
   * @returns The negotiation as the caller now sees it, or the refusal reason.
   */
  async submitTurn(
    opportunityId: string,
    callerUserId: string,
    turn: NegotiationTurn,
    execution?: NegotiationExecution,
  ): Promise<NegotiationDetail | SubmitTurnFailure> {
    const result = await this.capability(execution).execute(opportunityId, callerUserId, turn);
    if (!result.ok) return { rejection: result.rejection };
    if (result.opportunityStatus === 'pending') {
      emitOpportunityTransitionBestEffort({ id: opportunityId, status: result.opportunityStatus });
    }
    const record = (await this.read(opportunityId, callerUserId))!;
    const seats = [{ userId: callerUserId, intentId: record.intentId }, { userId: record.counterparty.userId, intentId: record.counterparty.intentId }];
    await publishNegotiationChange(seats, opportunityId);
    const stopped = result.outcome !== null || result.roundEnded !== null;
    await Promise.all(seats.filter((seat) => stopped || seat.userId !== callerUserId).map((seat) => this.notify(seat.userId, {
      type: result.outcome ? 'negotiation.settled' : 'negotiation.turn',
      id: `${opportunityId}:${result.turnIndex + 1}`,
      title: result.outcome ? 'A negotiation ended' : result.roundEnded ? 'A negotiation paused' : 'Your turn',
      body: result.outcome === 'agreed' ? 'Both agents agreed; owner approval is still required.'
        : result.roundEnded === 'declined' ? 'One agent passed for now. It stays in talks: new context from either owner that bears on this pair can resume it.'
          : result.roundEnded ? 'The round ended without agreement. It stays in talks: new context from either owner that bears on this pair can resume it.'
            : 'A negotiation is waiting on your agent.',
      data: { opportunityId, intentId: seat.intentId, outcome: result.outcome, roundEnded: result.roundEnded, turnIndex: result.turnIndex + 1 },
    })));
    return record;
  }

  /**
   * Take the first turn of a new round on a negotiation paused between rounds.
   *
   * The seat's executor calls this because its owner added context that bears
   * on this pair. The turn it then takes is what tells the other seat; until
   * then both seats only refresh.
   *
   * @param opportunityId - The negotiation's opportunity.
   * @param callerUserId - The seat resuming.
   * @param execution - Hosted lease or external executor binding checked in the write transaction.
   * @returns The negotiation as the caller now sees it, or the refusal reason.
   */
  async resume(opportunityId: string, callerUserId: string, execution?: NegotiationExecution): Promise<NegotiationDetail | ResumeFailure> {
    const result = await this.capability(execution).resume(opportunityId, callerUserId);
    if (!result.ok) return { rejection: result.rejection };
    const record = (await this.read(opportunityId, callerUserId))!;
    await publishNegotiationChange([
      { userId: callerUserId, intentId: record.intentId },
      { userId: record.counterparty.userId, intentId: record.counterparty.intentId },
    ], opportunityId);
    return record;
  }

  /** @param execution - Executor binding fenced inside each write. @returns The protocol capability over this host's records. */
  private capability(execution?: NegotiationExecution): Negotiations {
    return new Negotiations({
      readNegotiationState: (id, userId) => this.negotiations.readNegotiationState(id, userId),
      commitNegotiationTurn: (id, userId, input, decide) => this.negotiations.commitNegotiationTurn(id, userId, input, decide, execution),
      commitNegotiationResume: (id, userId, decide) => this.negotiations.commitNegotiationResume(id, userId, decide, execution),
    });
  }

  /**
   * Tell a seat its negotiation moved. Delivery failure must not undo a turn
   * that is already recorded, so it is logged and swallowed.
   *
   * @param userId - The seat owner to notify.
   * @param event - The frame to publish on that owner's channel.
   */
  private async notify(userId: string, event: Parameters<typeof publishUserEvent>[1]): Promise<void> {
    try {
      await publishUserEvent(userId, event);
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
