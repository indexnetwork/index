/**
 * The negotiation record: two seats, a turn log, whose turn it is, and a
 * settlement.
 *
 * Index is the server for every negotiation. Both seats read the same rows and
 * append against them; there is no wire between agents and nothing to mirror.
 */
import { activeIntentLifecycleWhere, and, asc, count, db, desc, eq, inArray, intentNetworks, intents, isNull, logger, negotiations, negotiationTurns, networkMembers, opportunities, or, schema, sql, users } from './database.shared';

import { AgentSessionDatabaseAdapter, type AgentExecution } from './agent-session.database.adapter';

import { publishUserEvent } from '../lib/user-events';
import { RuntimeConflictError } from '../lib/agent/runtime-errors';

export type NegotiationExecution = AgentExecution | { userId: string; agentId: string };

export type NegotiationTurnAction = 'propose' | 'counter' | 'accept' | 'decline';
export type NegotiationOutcome = 'agreed' | 'declined' | 'closed';

/**
 * API-local structural twin of protocol's `CreateIntentCounterpartyData`.
 * Adapters must not import protocol interfaces; TypeScript verifies
 * compatibility where the opportunity port is composed.
 */
export interface IntentCounterpartyPair {
  pairKey: string;
  networkId: string;
  intentA: string;
  intentB: string;
  userA: string;
  userB: string;
  score: number;
  reasoning: string;
  evidence: unknown[];
  /**
   * Provenance for the opportunity. Discovery leaves this unset and gets its
   * own stamp; a pair opened by hand says so, so the two are distinguishable
   * afterwards.
   */
  detection?: { source: string; createdBy: string };
}

/** A signal eligible to hold a seat in a negotiation, with its owner. */
export interface SeatedIntent {
  intentId: string;
  userId: string;
}

/** API-local structural twin of protocol's `OpenedNegotiation`. */
export interface OpenedNegotiation {
  opportunityId: string;
  negotiationId: string;
  initiatorUserId: string;
  initiatorIntentId: string;
}

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
    intentId: string;
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

/** Change detection without loading counterparties or turn logs. */
export interface NegotiationScanRecord {
  opportunityId: string;
  version: string;
  eligible: boolean;
}

/** Structural host contracts; protocol supplies all policy callbacks. */
export interface NegotiationState {
  initiatorUserId: string;
  responderUserId: string;
  awaitingUserId: string | null;
  outcome: NegotiationOutcome | null;
  settled: boolean;
  /** Both intents are active, assigned to this network, and owned by current members. */
  eligible: boolean;
  turns: { seatUserId: string; action: NegotiationTurnAction; message: string }[];
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

export interface NegotiationTurnInput { action: NegotiationTurnAction; message: string; expectedTurnCount: number }
export type SubmitTurnRejection = NegotiationRejection;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Postgres unique-violation. A second turn at the same index is a lost race, not an error. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/**
 * A signal still worth negotiating over: not paused, not removed. Null status
 * is legacy-active, matching `activeIntentLifecycleWhere` elsewhere.
 *
 * A negotiation needs both sides live to be workable, so this gates on the pair
 * rather than on the caller's own signal.
 *
 * @returns A Drizzle predicate over the `intents` table.
 */
function liveIntentWhere() {
  return and(
    isNull(intents.archivedAt),
    or(isNull(intents.status), eq(intents.status, 'ACTIVE')),
  );
}

/**
 * Tell each initiator that discovery gave one of its signals something to work.
 *
 * One frame per signal rather than per negotiation: an agent woken by this
 * re-reads its open negotiations anyway, so a frame per pair would be a burst
 * that buys nothing.
 *
 * Runs after each pair's transaction has committed, and swallows delivery
 * failures: an unannounced negotiation is still an opened one.
 *
 * @param opened - The negotiations this run newly opened.
 */
async function announceOpened(opened: OpenedNegotiation[]): Promise<void> {
  const counts = new Map<string, { userId: string; intentId: string; count: number }>();
  for (const item of opened) {
    const key = `${item.initiatorUserId}\u0000${item.initiatorIntentId}`;
    const group = counts.get(key);
    if (group) group.count += 1;
    else counts.set(key, { userId: item.initiatorUserId, intentId: item.initiatorIntentId, count: 1 });
  }

  for (const { userId, intentId, count: opportunityCount } of counts.values()) {
    try {
      await publishUserEvent(userId, {
        type: 'negotiation.opened',
        id: `${intentId}:opened:${Date.now()}`,
        title: 'Your turn',
        body: opportunityCount === 1
          ? 'A negotiation opened for your signal and is waiting on you.'
          : `${opportunityCount} negotiations opened for your signal and are waiting on you.`,
        data: { intentId, count: opportunityCount },
      });
    } catch (error: unknown) {
      logger.error('Failed to publish opened negotiations event', {
        intentId,
        count: opportunityCount,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Persistence for negotiation records and their turn logs.
 */
export class NegotiationDatabaseAdapter {
  /**
   * Turn every pair discovery scored into an opportunity with a negotiation
   * beside it, and report the ones newly opened.
   *
   * NEVER THROWS PER PAIR. One pair that cannot be opened — a revoked
   * membership, a lost race — must not cost the rest of the run its results,
   * so each is its own transaction and a failure is skipped rather than
   * raised.
   *
   * @param pairs - The scored pairs to open.
   * @returns One entry per pair that became a new opportunity.
   */
  async openCounterparties(pairs: IntentCounterpartyPair[], decide: (pair: NegotiationOpening) => NegotiationOpeningDecision): Promise<OpenedNegotiation[]> {
    const opened: OpenedNegotiation[] = [];
    for (const pair of pairs) {
      const result = await this.open(pair, decide);
      if (result) opened.push(result);
    }
    await announceOpened(opened);
    return opened;
  }

  /**
   * Resolve a signal that may hold a seat in a negotiation on this network:
   * unarchived, still discoverable, and shared into the network.
   *
   * @param intentId - The signal to seat.
   * @param networkId - The network the negotiation would sit in.
   * @returns The signal with its owner, or null when it is not seated there.
   */
  async seatedIntent(intentId: string, networkId: string): Promise<SeatedIntent | null> {
    const [row] = await db
      .select({ intentId: intents.id, userId: intents.userId })
      .from(intents)
      .innerJoin(intentNetworks, eq(intentNetworks.intentId, intents.id))
      .where(and(
        eq(intents.id, intentId),
        eq(intentNetworks.networkId, networkId),
        isNull(intents.archivedAt),
        activeIntentLifecycleWhere(),
      ))
      .limit(1);
    return row ?? null;
  }

  /**
   * The negotiation already open between a pair, if one is.
   *
   * `open()` reports "already open" and "could not open" the same way, as
   * null. This is how a caller tells them apart.
   *
   * @param pairKey - The pair's canonical key.
   * @returns The open record, or null when the pair has none.
   */
  async findByPairKey(pairKey: string): Promise<OpenedNegotiation | null> {
    const [row] = await db
      .select({
        opportunityId: negotiations.opportunityId,
        negotiationId: negotiations.id,
        initiatorUserId: negotiations.initiatorUserId,
        initiatorIntentId: negotiations.initiatorIntentId,
      })
      .from(negotiations)
      .where(eq(negotiations.pairKey, pairKey))
      .limit(1);
    return row ?? null;
  }

  /**
   * Open one pair.
   *
   * The advisory lock is on the PAIR. Both principals' discovery runs can reach
   * this at the same moment; the second one through must find the first one's
   * negotiation rather than write a second opportunity between the same two
   * intents. The unique index on `pair_key` is the backstop.
   *
   * The initiator is side A — whichever side's run got here first. It owes the
   * first turn, and that turn is the decision to pursue or drop.
   *
   * @param pair - The scored pair to materialize.
   * @returns The opened negotiation, or null when it was already open or could not be opened.
   */
  private async open(pair: IntentCounterpartyPair, decide: (pair: NegotiationOpening) => NegotiationOpeningDecision): Promise<OpenedNegotiation | null> {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`opportunity-pair:${pair.pairKey}`}, 0)
          )
        `);

        const [existing] = await tx.select({ id: negotiations.id }).from(negotiations)
          .where(eq(negotiations.pairKey, pair.pairKey)).limit(1);
        if (existing) return null;

        const seats = await tx.select({ id: intents.id, userId: intents.userId }).from(intents)
          .innerJoin(intentNetworks, and(eq(intentNetworks.intentId, intents.id), eq(intentNetworks.networkId, pair.networkId)))
          .innerJoin(networkMembers, and(eq(networkMembers.userId, intents.userId), eq(networkMembers.networkId, pair.networkId)))
          .where(and(inArray(intents.id, [pair.intentA, pair.intentB]), liveIntentWhere()))
          .orderBy(asc(intents.id)).for('share');
        const decision = decide({ ...pair, eligible:
          seats.some((seat) => seat.id === pair.intentA && seat.userId === pair.userA)
          && seats.some((seat) => seat.id === pair.intentB && seat.userId === pair.userB) });
        if (!decision) return null;

        const [row] = await tx.insert(opportunities).values({
          detection: {
            source: pair.detection?.source ?? 'opportunity_graph',
            createdBy: pair.detection?.createdBy ?? 'agent-opportunity-finder',
            triggeredBy: pair.intentA,
            timestamp: new Date().toISOString(),
          },
          actors: [
            { networkId: pair.networkId, userId: pair.userA, role: 'party', intent: pair.intentA },
            { networkId: pair.networkId, userId: pair.userB, role: 'party', intent: pair.intentB },
          ],
          interpretation: {
            category: 'collaboration',
            reasoning: pair.reasoning,
            confidence: pair.score / 100,
            signals: [{ type: 'intent_match', weight: pair.score / 100, detail: 'Match explainer' }],
          },
          context: { networkId: pair.networkId },
          confidence: String(pair.score / 100),
          // Born negotiating. There is no pre-kickoff state any more: the row
          // exists because someone is opening it right now.
          status: decision.opportunityStatus,
          updatedAt: new Date(),
          metadata: { evidence: pair.evidence ?? [] },
        } as never).returning();
        if (!row) return null;

        const [negotiation] = await tx.insert(negotiations).values({
          pairKey: pair.pairKey,
          opportunityId: row.id,
          initiatorUserId: pair.userA,
          initiatorIntentId: pair.intentA,
          responderUserId: pair.userB,
          responderIntentId: pair.intentB,
          awaitingUserId: decision.awaitingUserId,
          updatedAt: new Date(),
        }).returning();
        if (!negotiation) return null;

        return {
          opportunityId: row.id,
          negotiationId: negotiation.id,
          initiatorUserId: pair.userA,
          initiatorIntentId: pair.intentA,
        };
      });
    } catch {
      return null;
    }
  }

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
    if (options.open) {
      conditions.push(isNull(negotiations.settledAt));
      // Open means workable. A paused or removed signal on either side owes
      // nobody a turn, so it drops out of the queue without settling the
      // record — resuming the signal brings it back.
      conditions.push(inArray(
        negotiations.initiatorIntentId,
        db.select({ id: intents.id }).from(intents).where(liveIntentWhere()),
      ));
      conditions.push(inArray(
        negotiations.responderIntentId,
        db.select({ id: intents.id }).from(intents).where(liveIntentWhere()),
      ));
    }

    let query = db.select().from(negotiations)
      .where(and(...conditions))
      .orderBy(desc(negotiations.updatedAt))
      .$dynamic();
    if (options.limit !== undefined) query = query.limit(options.limit);
    if (options.offset !== undefined) query = query.offset(options.offset);

    return this.toViews(await query, userId);
  }

  /**
   * Scan one intent's negotiations, including eligibility changes outside the negotiation row.
   *
   * @param userId - The seat owner.
   * @param intentId - The intent bound to the agent session.
   * @returns IDs, precise database change versions, and current eligibility.
   */
  async scanForIntent(userId: string, intentId: string): Promise<NegotiationScanRecord[]> {
    const networkId = sql<string>`nullif(${opportunities.context}->>'networkId', '')`;
    // Match state(): both live intents must still belong to their seats and be
    // assigned to the opportunity's network with a membership for each owner.
    const eligibleSeats = [
      { intentId: negotiations.initiatorIntentId, userId: negotiations.initiatorUserId },
      { intentId: negotiations.responderIntentId, userId: negotiations.responderUserId },
    ].map((seat) => sql<boolean>`exists (${db.select({ id: intents.id }).from(intents)
      .innerJoin(intentNetworks, and(eq(intentNetworks.intentId, intents.id), eq(intentNetworks.networkId, networkId)))
      .innerJoin(networkMembers, and(eq(networkMembers.userId, intents.userId), eq(networkMembers.networkId, networkId)))
      .where(and(eq(intents.id, seat.intentId), eq(intents.userId, seat.userId), liveIntentWhere()))})`);

    return db.select({
      opportunityId: negotiations.opportunityId,
      // Keep Postgres timestamp precision rather than truncating it to JavaScript milliseconds.
      version: sql<string>`${negotiations.updatedAt}::text`,
      eligible: sql<boolean>`${and(eq(opportunities.status, 'negotiating'), ...eligibleSeats)}`,
    }).from(negotiations)
      .innerJoin(opportunities, eq(opportunities.id, negotiations.opportunityId))
      .where(or(
        and(eq(negotiations.initiatorUserId, userId), eq(negotiations.initiatorIntentId, intentId)),
        and(eq(negotiations.responderUserId, userId), eq(negotiations.responderIntentId, intentId)),
      ))
      .orderBy(desc(negotiations.updatedAt));
  }

  /**
   * One negotiation with its full turn log.
   *
   * @param opportunityId - The opportunity this negotiation belongs to.
   * @param userId - The caller, who must own one of the two seats.
   * @returns The record as that seat sees it, or null when absent or not theirs.
   */
  async getForUser(opportunityId: string, userId: string): Promise<(NegotiationDetail & { state: NegotiationState }) | null> {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(negotiations)
        .where(eq(negotiations.opportunityId, opportunityId)).limit(1).for('share');
      if (!row || (row.initiatorUserId !== userId && row.responderUserId !== userId)) return null;
      const [view] = await this.toViews([row], userId, tx);
      if (!view) return null;
      const turns = await tx.select().from(negotiationTurns).where(eq(negotiationTurns.negotiationId, row.id))
        .orderBy(asc(negotiationTurns.turnIndex));
      return { ...view, turnCount: turns.length, turns, state: await this.state(tx, row) };
    });
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
   * @param execution - Hosted lease or external executor binding to fence before applying a decision.
   * @returns The applied turn, or the reason it was refused.
   */
  async commitNegotiationTurn(
    opportunityId: string,
    callerUserId: string,
    turn: NegotiationTurnInput,
    decide: (state: NegotiationState | null) => NegotiationDecision,
    execution?: NegotiationExecution,
  ): Promise<NegotiationDecision> {
    try {
      return await db.transaction(async (tx) => {
        if (execution) {
          if (execution.userId !== callerUserId) throw new Error('Execution belongs to another principal.');
          if ('agentId' in execution) {
            // Share the selection transaction's owner lock: handover and an
            // external turn cannot both commit using the old executor binding.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${callerUserId}`}, 0))`);
            const [selected] = await tx.select({ id: schema.agents.id }).from(schema.agents).where(and(
              eq(schema.agents.id, execution.agentId), eq(schema.agents.ownerId, callerUserId),
              eq(schema.agents.type, 'external'), eq(schema.agents.status, 'active'),
              eq(schema.agents.handleNegotiations, true), isNull(schema.agents.deletedAt),
            ));
            if (!selected) throw new RuntimeConflictError();
          } else {
            await AgentSessionDatabaseAdapter.assertOwner(tx, execution);
          }
        }
        const [negotiation] = await tx.select().from(negotiations)
          .where(eq(negotiations.opportunityId, opportunityId)).limit(1).for('update');
        if (execution && 'intentId' in execution && negotiation && (negotiation.initiatorUserId === callerUserId ? negotiation.initiatorIntentId : negotiation.responderIntentId) !== execution.intentId) throw new Error('Execution belongs to another intent.');
        const state = negotiation ? await this.state(tx, negotiation, true) : null;
        const decision = decide(state);
        if (!decision.ok || !negotiation) return decision;
        await tx.insert(negotiationTurns).values({
          negotiationId: negotiation.id, turnIndex: decision.turnIndex,
          seatUserId: callerUserId, action: turn.action, message: turn.message.trim(),
        });
        const now = new Date();
        await tx.update(negotiations).set({
          awaitingUserId: decision.awaitingUserId, outcome: decision.outcome,
          settledAt: decision.outcome ? now : null, updatedAt: now,
        }).where(eq(negotiations.id, negotiation.id));
        await tx.update(opportunities).set({ status: decision.opportunityStatus, updatedAt: now })
          .where(eq(opportunities.id, opportunityId));
        return decision;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, rejection: 'raced' };
      throw error;
    }
  }

  /** @param opportunityId - Match identity. @param userId - Reading seat. @returns Current facts for protocol observation. */
  async readNegotiationState(opportunityId: string, userId: string): Promise<NegotiationState | null> {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(negotiations).where(eq(negotiations.opportunityId, opportunityId)).limit(1);
      if (!row || (row.initiatorUserId !== userId && row.responderUserId !== userId)) return null;
      return this.state(tx, row);
    });
  }

  private async state(tx: Transaction, row: NegotiationRow, lock = false): Promise<NegotiationState> {
    const [opportunity] = await tx.select({ context: opportunities.context, status: opportunities.status }).from(opportunities)
      .where(eq(opportunities.id, row.opportunityId));
    const networkId = (opportunity?.context as { networkId?: string } | null)?.networkId;
    let eligible = false;
    if (networkId) {
      let query = tx.select({ id: intents.id, userId: intents.userId }).from(intents)
        .innerJoin(intentNetworks, and(eq(intentNetworks.intentId, intents.id), eq(intentNetworks.networkId, networkId)))
        .innerJoin(networkMembers, and(eq(networkMembers.userId, intents.userId), eq(networkMembers.networkId, networkId)))
        .where(and(inArray(intents.id, [row.initiatorIntentId, row.responderIntentId]), liveIntentWhere()))
        .orderBy(asc(intents.id)).$dynamic();
      if (lock) query = query.for('share');
      const seats = await query;
      eligible = opportunity?.status === 'negotiating'
        && seats.some((seat) => seat.id === row.initiatorIntentId && seat.userId === row.initiatorUserId)
        && seats.some((seat) => seat.id === row.responderIntentId && seat.userId === row.responderUserId);
    }
    const turns = await tx.select().from(negotiationTurns).where(eq(negotiationTurns.negotiationId, row.id)).orderBy(asc(negotiationTurns.turnIndex));
    return { initiatorUserId: row.initiatorUserId, responderUserId: row.responderUserId,
      awaitingUserId: row.awaitingUserId, outcome: row.outcome, settled: row.settledAt !== null, eligible, turns };
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
  private async toViews(rows: NegotiationRow[], userId: string, connection: typeof db | Transaction = db): Promise<NegotiationView[]> {
    if (rows.length === 0) return [];

    const counterpartOf = (row: NegotiationRow) => row.initiatorUserId === userId
      ? { userId: row.responderUserId, intentId: row.responderIntentId, ownIntentId: row.initiatorIntentId }
      : { userId: row.initiatorUserId, intentId: row.initiatorIntentId, ownIntentId: row.responderIntentId };

    const counterparts = rows.map(counterpartOf);
    const [people, statements, turnCounts] = await Promise.all([
      connection.select({ id: users.id, name: users.name, avatar: users.avatar }).from(users)
        .where(inArray(users.id, [...new Set(counterparts.map((c) => c.userId))])),
      connection.select({ id: intents.id, payload: intents.payload, summary: intents.summary }).from(intents)
        .where(inArray(intents.id, [...new Set(counterparts.map((c) => c.intentId))])),
      connection.select({ negotiationId: negotiationTurns.negotiationId, count: count() })
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
          intentId: counterpart.intentId,
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
