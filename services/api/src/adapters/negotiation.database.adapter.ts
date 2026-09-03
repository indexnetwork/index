/**
 * The negotiation record: two seats, a turn log, whose turn it is, and a
 * settlement.
 *
 * Index is the server for every negotiation. Both seats read the same rows and
 * append against them; there is no wire between agents and nothing to mirror.
 */
import { and, asc, count, db, desc, eq, inArray, intents, isNull, negotiations, negotiationTurns, opportunities, or, users } from './database.shared';

export type NegotiationTurnAction = 'propose' | 'counter' | 'accept' | 'decline';
export type NegotiationOutcome = 'agreed' | 'declined' | 'closed';

type NegotiationRow = typeof negotiations.$inferSelect;

export interface NegotiationTurnRecord {
  turnIndex: number;
  seatUserId: string;
  action: NegotiationTurnAction;
  message: string;
  createdAt: Date;
}

/** A negotiation as one seat sees it: its own side, and what crosses from the other. */
export interface NegotiationView {
  id: string;
  opportunityId: string;
  intentId: string;
  awaitingUserId: string | null;
  outcome: NegotiationOutcome | null;
  settledAt: Date | null;
  turnCount: number;
  createdAt: Date;
  updatedAt: Date;
  counterparty: {
    userId: string;
    name: string | null;
    avatar: string | null;
    /** The counterparty's intent statement. The only thing of theirs that crosses. */
    statement: string;
  };
}

export interface NegotiationDetail extends NegotiationView {
  turns: NegotiationTurnRecord[];
}

/** Why a turn was refused. The service maps these onto status codes. */
export type SubmitTurnRejection =
  | 'not_found'
  | 'not_a_seat'
  | 'already_settled'
  | 'not_your_turn'
  | 'propose_not_first'
  | 'counter_is_first'
  | 'accept_without_offer'
  | 'raced';

export type SubmitTurnResult =
  | { ok: true; negotiation: NegotiationRow; turnIndex: number; otherSeatUserId: string; settled: NegotiationOutcome | null }
  | { ok: false; rejection: SubmitTurnRejection };

/** Postgres unique-violation. A second turn at the same index is a lost race, not an error. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/**
 * Persistence for negotiation records and their turn logs.
 */
export class NegotiationDatabaseAdapter {
  /**
   * The caller's negotiations, newest first.
   *
   * @param userId - The seat owner.
   * @param options - Narrow to one signal, or to records still open.
   * @returns One view per negotiation the caller sits in.
   */
  async listForUser(
    userId: string,
    options: { intentId?: string; open?: boolean; counterpartyUserId?: string; limit?: number; offset?: number } = {},
  ): Promise<NegotiationView[]> {
    const conditions = [
      or(eq(negotiations.initiatorUserId, userId), eq(negotiations.responderUserId, userId)),
    ];
    if (options.intentId) {
      conditions.push(or(
        eq(negotiations.initiatorIntentId, options.intentId),
        eq(negotiations.responderIntentId, options.intentId),
      ));
    }
    if (options.counterpartyUserId) {
      conditions.push(or(
        eq(negotiations.initiatorUserId, options.counterpartyUserId),
        eq(negotiations.responderUserId, options.counterpartyUserId),
      ));
    }
    if (options.open) conditions.push(isNull(negotiations.settledAt));

    let query = db.select().from(negotiations)
      .where(and(...conditions))
      .orderBy(desc(negotiations.updatedAt))
      .$dynamic();
    if (options.limit !== undefined) query = query.limit(options.limit);
    if (options.offset !== undefined) query = query.offset(options.offset);

    return this.toViews(await query, userId);
  }

  /**
   * One negotiation with its full turn log.
   *
   * @param opportunityId - The opportunity this negotiation belongs to.
   * @param userId - The caller, who must own one of the two seats.
   * @returns The record as that seat sees it, or null when absent or not theirs.
   */
  async getForUser(opportunityId: string, userId: string): Promise<NegotiationDetail | null> {
    const [row] = await db.select().from(negotiations)
      .where(eq(negotiations.opportunityId, opportunityId)).limit(1);
    if (!row) return null;
    if (row.initiatorUserId !== userId && row.responderUserId !== userId) return null;

    const [view] = await this.toViews([row], userId);
    if (!view) return null;

    const turns = await db.select().from(negotiationTurns)
      .where(eq(negotiationTurns.negotiationId, row.id))
      .orderBy(asc(negotiationTurns.turnIndex));

    return {
      ...view,
      turns: turns.map((turn) => ({
        turnIndex: turn.turnIndex,
        seatUserId: turn.seatUserId,
        action: turn.action,
        message: turn.message,
        createdAt: turn.createdAt,
      })),
    };
  }

  /**
   * Append one turn and apply its effect, in a single transaction.
   *
   * Turn order is validated against the log read inside the transaction, and
   * the unique index on `(negotiation_id, turn_index)` settles any race that
   * slips past it: the loser sees a unique violation and is told to re-read.
   *
   * @param opportunityId - The negotiation's opportunity.
   * @param callerUserId - The seat submitting.
   * @param turn - The decision and its message.
   * @returns The applied turn, or the reason it was refused.
   */
  async submitTurn(
    opportunityId: string,
    callerUserId: string,
    turn: { action: NegotiationTurnAction; message: string },
  ): Promise<SubmitTurnResult> {
    try {
      return await db.transaction(async (tx) => {
        const [negotiation] = await tx.select().from(negotiations)
          .where(eq(negotiations.opportunityId, opportunityId)).limit(1);
        if (!negotiation) return { ok: false, rejection: 'not_found' } as const;

        const isInitiator = negotiation.initiatorUserId === callerUserId;
        const isResponder = negotiation.responderUserId === callerUserId;
        if (!isInitiator && !isResponder) return { ok: false, rejection: 'not_a_seat' } as const;
        if (negotiation.settledAt) return { ok: false, rejection: 'already_settled' } as const;
        if (negotiation.awaitingUserId !== callerUserId) return { ok: false, rejection: 'not_your_turn' } as const;

        const priorTurns = await tx.select().from(negotiationTurns)
          .where(eq(negotiationTurns.negotiationId, negotiation.id))
          .orderBy(asc(negotiationTurns.turnIndex));
        const turnIndex = priorTurns.length;
        const previous = priorTurns[turnIndex - 1];

        // `propose` is the screening turn and only exists at the head of the
        // log; every later non-terminal turn is a `counter`.
        if (turn.action === 'propose' && turnIndex !== 0) return { ok: false, rejection: 'propose_not_first' } as const;
        if (turn.action === 'counter' && turnIndex === 0) return { ok: false, rejection: 'counter_is_first' } as const;
        if (turn.action === 'accept' && (!previous || previous.seatUserId === callerUserId)) {
          return { ok: false, rejection: 'accept_without_offer' } as const;
        }

        await tx.insert(negotiationTurns).values({
          negotiationId: negotiation.id,
          turnIndex,
          seatUserId: callerUserId,
          action: turn.action,
          message: turn.message,
        });

        const otherSeatUserId = isInitiator ? negotiation.responderUserId : negotiation.initiatorUserId;
        const settled: NegotiationOutcome | null =
          turn.action === 'accept' ? 'agreed'
            : turn.action === 'decline' ? 'declined'
              : null;

        const [updated] = await tx.update(negotiations)
          .set(settled
            ? { outcome: settled, settledAt: new Date(), awaitingUserId: null, updatedAt: new Date() }
            : { awaitingUserId: otherSeatUserId, updatedAt: new Date() })
          .where(eq(negotiations.id, negotiation.id))
          .returning();

        if (settled) {
          await tx.update(opportunities)
            .set({ status: settled === 'agreed' ? 'pending' : 'rejected', updatedAt: new Date() })
            .where(eq(opportunities.id, opportunityId));
        }

        return { ok: true, negotiation: updated ?? negotiation, turnIndex, otherSeatUserId, settled } as const;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, rejection: 'raced' };
      throw error;
    }
  }

  /**
   * The turn log behind one opportunity, projected onto the reading seat.
   *
   * This is the protocol's `NegotiationContextDatabase`: what the card
   * presenter reads to explain why an opportunity surfaced.
   *
   * @param opportunityId - The opportunity being presented.
   * @param viewerUserId - Who the card is for.
   * @returns The outcome and turns, or null when the viewer holds no seat.
   */
  async readNegotiationContext(
    opportunityId: string,
    viewerUserId: string,
  ): Promise<{ outcome: NegotiationOutcome | null; turns: Array<{ action: NegotiationTurnAction; message: string; own: boolean }> } | null> {
    const [negotiation] = await db.select().from(negotiations)
      .where(eq(negotiations.opportunityId, opportunityId)).limit(1);
    if (!negotiation) return null;
    if (negotiation.initiatorUserId !== viewerUserId && negotiation.responderUserId !== viewerUserId) return null;

    const turns = await db.select().from(negotiationTurns)
      .where(eq(negotiationTurns.negotiationId, negotiation.id))
      .orderBy(asc(negotiationTurns.turnIndex));

    return {
      outcome: negotiation.outcome,
      turns: turns.map((turn) => ({
        action: turn.action,
        message: turn.message,
        own: turn.seatUserId === viewerUserId,
      })),
    };
  }

  /**
   * Close the negotiations attached to these opportunities.
   *
   * Index closes a negotiation itself when consent, an archive, or expiry ends
   * the opportunity underneath it. No seat declines anything; the next read
   * shows it closed.
   *
   * @param opportunityIds - Opportunities whose negotiations should close.
   */
  async closeForOpportunities(opportunityIds: string[]): Promise<void> {
    if (opportunityIds.length === 0) return;
    await db.update(negotiations)
      .set({ outcome: 'closed', settledAt: new Date(), awaitingUserId: null, updatedAt: new Date() })
      .where(and(
        inArray(negotiations.opportunityId, opportunityIds),
        isNull(negotiations.settledAt),
      ));
  }

  /** Resolve each row into the shape its reader's seat is allowed to see. */
  private async toViews(rows: NegotiationRow[], userId: string): Promise<NegotiationView[]> {
    if (rows.length === 0) return [];

    const counterpartOf = (row: NegotiationRow) => row.initiatorUserId === userId
      ? { userId: row.responderUserId, intentId: row.responderIntentId, ownIntentId: row.initiatorIntentId }
      : { userId: row.initiatorUserId, intentId: row.initiatorIntentId, ownIntentId: row.responderIntentId };

    const counterparts = rows.map(counterpartOf);
    const [people, statements, turnCounts] = await Promise.all([
      db.select({ id: users.id, name: users.name, avatar: users.avatar }).from(users)
        .where(inArray(users.id, [...new Set(counterparts.map((c) => c.userId))])),
      db.select({ id: intents.id, payload: intents.payload, summary: intents.summary }).from(intents)
        .where(inArray(intents.id, [...new Set(counterparts.map((c) => c.intentId))])),
      db.select({ negotiationId: negotiationTurns.negotiationId, count: count() })
        .from(negotiationTurns)
        .where(inArray(negotiationTurns.negotiationId, rows.map((row) => row.id)))
        .groupBy(negotiationTurns.negotiationId),
    ]);
    const personById = new Map(people.map((row) => [row.id, row]));
    const statementById = new Map(statements.map((row) => [row.id, row.summary ?? row.payload]));
    const turnCountById = new Map(turnCounts.map((row) => [row.negotiationId, row.count]));

    return rows.map((row) => {
      const counterpart = counterpartOf(row);
      const person = personById.get(counterpart.userId);
      return {
        id: row.id,
        opportunityId: row.opportunityId,
        intentId: counterpart.ownIntentId,
        awaitingUserId: row.awaitingUserId,
        outcome: row.outcome,
        settledAt: row.settledAt,
        turnCount: turnCountById.get(row.id) ?? 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        counterparty: {
          userId: counterpart.userId,
          name: person?.name ?? null,
          avatar: person?.avatar ?? null,
          statement: statementById.get(counterpart.intentId) ?? '',
        },
      };
    });
  }
}

export const negotiationDatabaseAdapter = new NegotiationDatabaseAdapter();
