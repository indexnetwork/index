/**
 * The outcome export the research side scores arms with: one row per
 * opportunity involving an enrolled resident, joinable on opportunity id.
 * Carries no identities beyond the opportunity id itself; the lab maps ids to
 * its opaque refs on its side.
 *
 * Schema caveat (by design): a negotiation `declined` outcome is never written
 * today — a decline ends a round, not the negotiation — so terminal outcomes
 * here are `agreed`, `closed`, or null while still in talks.
 */

import { and, count, eq, gte, inArray, or, sql } from 'drizzle-orm';

import db from '../drizzle/drizzle';
import { moralmodArms, negotiations, negotiationTurns, opportunityEvents } from '../../schemas/database.schema';
import { EXPOSURE_EVENT_TYPE } from './exposure';

export interface OutcomeRow {
  opportunityId: string;
  outcome: 'agreed' | 'declined' | 'closed' | null;
  settledAt: string | null;
  turnCount: number;
  /** Arms of the enrolled seat(s), keyed by nothing — at most two entries, order meaningless. */
  enrolledArms: string[];
  principalDecisions: { actor: 'enrolled' | 'counterpart'; type: 'committed' | 'declined'; at: string }[];
  exposures: number;
}

/** @param experimentId - The study. @param since - Only negotiations updated at or after this instant. */
export async function outcomeExport(experimentId: string, since?: Date): Promise<OutcomeRow[]> {
  const enrolled = await db.select({ userId: moralmodArms.userId, arm: moralmodArms.arm })
    .from(moralmodArms).where(eq(moralmodArms.experimentId, experimentId));
  if (!enrolled.length) return [];
  const enrolledIds = enrolled.map((row) => row.userId);
  const armByUser = new Map(enrolled.map((row) => [row.userId, row.arm]));

  const records = await db.select({
    id: negotiations.id,
    opportunityId: negotiations.opportunityId,
    initiatorUserId: negotiations.initiatorUserId,
    responderUserId: negotiations.responderUserId,
    outcome: negotiations.outcome,
    settledAt: negotiations.settledAt,
  }).from(negotiations).where(and(
    or(inArray(negotiations.initiatorUserId, enrolledIds), inArray(negotiations.responderUserId, enrolledIds)),
    ...(since ? [gte(negotiations.updatedAt, since)] : []),
  ));
  if (!records.length) return [];

  const negotiationIds = records.map((record) => record.id);
  const opportunityIds = records.map((record) => record.opportunityId);
  const turnCounts = await db.select({ negotiationId: negotiationTurns.negotiationId, turns: count() })
    .from(negotiationTurns).where(inArray(negotiationTurns.negotiationId, negotiationIds))
    .groupBy(negotiationTurns.negotiationId);
  const turnsByNegotiation = new Map(turnCounts.map((row) => [row.negotiationId, row.turns]));

  const events = await db.select({
    opportunityId: opportunityEvents.opportunityId,
    type: opportunityEvents.type,
    actorUserId: opportunityEvents.actorUserId,
    at: opportunityEvents.at,
  }).from(opportunityEvents).where(and(
    inArray(opportunityEvents.opportunityId, opportunityIds),
    inArray(opportunityEvents.type, ['committed', 'declined', EXPOSURE_EVENT_TYPE]),
  )).orderBy(sql`${opportunityEvents.at} asc`);

  const byOpportunity = new Map<string, typeof events>();
  for (const event of events) {
    const bucket = byOpportunity.get(event.opportunityId) ?? [];
    bucket.push(event);
    byOpportunity.set(event.opportunityId, bucket);
  }

  return records.map((record) => {
    const bucket = byOpportunity.get(record.opportunityId) ?? [];
    return {
      opportunityId: record.opportunityId,
      outcome: record.outcome,
      settledAt: record.settledAt?.toISOString() ?? null,
      turnCount: turnsByNegotiation.get(record.id) ?? 0,
      enrolledArms: [record.initiatorUserId, record.responderUserId]
        .map((userId) => armByUser.get(userId)).filter((arm): arm is NonNullable<typeof arm> => !!arm),
      principalDecisions: bucket
        .filter((event) => event.type === 'committed' || event.type === 'declined')
        .map((event) => ({
          actor: (event.actorUserId && armByUser.has(event.actorUserId) ? 'enrolled' : 'counterpart') as 'enrolled' | 'counterpart',
          type: event.type as 'committed' | 'declined',
          at: event.at.toISOString(),
        })),
      exposures: bucket.filter((event) => event.type === EXPOSURE_EVENT_TYPE).length,
    };
  });
}
