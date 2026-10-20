import { and, eq, isNull, sql } from 'drizzle-orm/sql';

import db from '../drizzle/drizzle';
import * as schema from '../../schemas/database.schema';

import { briefedOnLocalDate, type MorningClaim, type MorningOwner } from './morning';

/** Members of this network get neither the morning wake nor its email. */
const NO_MORNING_NETWORK = '1d50525b-bfbd-46d2-bc63-c853006aaea5';

/** @returns Owners who left the seat to Index. */
export async function listHostedOwners(): Promise<MorningOwner[]> {
  return db.select({
    id: schema.users.id,
    timezone: schema.users.timezone,
    lastMorningBriefAt: schema.users.lastMorningBriefAt,
  }).from(schema.users).where(and(
    isNull(schema.users.deletedAt),
    sql`not exists (
      select 1 from ${schema.agents}
      where ${schema.agents.ownerId} = ${schema.users.id}
        and ${schema.agents.type} = 'external'
        and ${schema.agents.handleNegotiations} = true
        and ${schema.agents.deletedAt} is null
    )`,
    sql`not exists (
      select 1 from ${schema.userNotificationSettings}
      where ${schema.userNotificationSettings.userId} = ${schema.users.id}
        and coalesce(${schema.userNotificationSettings.preferences}->>'morningBrief', 'true') = 'false'
    )`,
    sql`not exists (
      select 1 from ${schema.networkMembers}
      where ${schema.networkMembers.userId} = ${schema.users.id}
        and ${schema.networkMembers.networkId} = ${NO_MORNING_NETWORK}
        and ${schema.networkMembers.deletedAt} is null
    )`,
  ));
}

/**
 * Claim today's pass. Two processes ticking together still run someone once.
 *
 * @returns The previous stamp, or null when today was already claimed.
 */
export async function claimMorningBrief(userId: string, now: Date, timeZone: string): Promise<MorningClaim | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ at: schema.users.lastMorningBriefAt })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for('update');
    if (!row || briefedOnLocalDate(row.at, now, timeZone)) return null;
    await tx.update(schema.users).set({ lastMorningBriefAt: now }).where(eq(schema.users.id, userId));
    return { previous: row.at };
  });
}

/** Half an hour lets the morning's negotiators and summary wake finish first. */
const EMAIL_DELAY_MINUTES = 30;

export interface MorningEmailClaim {
  id: string;
  email: string;
  name: string;
  /** The window starts at the previous email, or at this morning when there was none. */
  since: Date;
  off: boolean;
}

/**
 * Claim every morning whose email is due. Each morning is claimed once, also
 * across replicas, whether or not an email follows.
 */
export async function claimMorningEmails(now: Date): Promise<MorningEmailClaim[]> {
  const cutoff = new Date(now.getTime() - EMAIL_DELAY_MINUTES * 60_000).toISOString();
  const rows = await db.execute(sql`
    WITH due AS (
      SELECT u.id, coalesce(u.last_morning_email_at, u.last_morning_brief_at) AS since
      FROM ${schema.users} u
      WHERE u.deleted_at IS NULL
        AND u.last_morning_brief_at < ${cutoff}::timestamp
        AND (u.last_morning_email_at IS NULL OR u.last_morning_email_at < u.last_morning_brief_at)
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${schema.users} u SET last_morning_email_at = ${now.toISOString()}::timestamp
    FROM due
    WHERE u.id = due.id
    RETURNING u.id, u.email, u.name, due.since AT TIME ZONE 'UTC' AS since,
      (
        EXISTS (
          SELECT 1 FROM ${schema.userNotificationSettings} s
          WHERE s.user_id = u.id AND s.preferences->>'morningBrief' = 'false'
        )
        OR EXISTS (
          SELECT 1 FROM ${schema.networkMembers} m
          WHERE m.user_id = u.id AND m.network_id = ${NO_MORNING_NETWORK} AND m.deleted_at IS NULL
        )
      ) AS off
  `) as unknown as Array<{ id: string; email: string; name: string; since: Date | string; off: boolean }>;
  return rows.map((row) => ({ ...row, since: new Date(row.since) }));
}

export interface MorningOwed {
  /** People the owner's agent negotiated with since `since`. */
  talked: number;
  /** Agreed by both agents and still waiting on the owner. `fresh` arrived since `since`. */
  waiting: { opportunityId: string; userId: string; name: string; context: string | null; fresh: boolean }[];
  /** The agent's latest summary per intent since `since`. */
  notes: { text: string; intentId: string }[];
  questions: { text: string; intentId: string }[];
}

/** What the owner's agent has to tell them since `since`. */
export async function owedForEmail(userId: string, since: Date): Promise<MorningOwed> {
  const after = sql`${since.toISOString()}::timestamptz`;
  const dmPair = `agent-dm:${userId}`;
  const [{ talked }] = await db.execute(sql`
    SELECT count(DISTINCT CASE WHEN n.initiator_user_id = ${userId} THEN n.responder_user_id ELSE n.initiator_user_id END)::int AS talked
    FROM ${schema.negotiations} n
    WHERE ${userId} IN (n.initiator_user_id, n.responder_user_id) AND n.updated_at > ${after}
  `) as unknown as [{ talked: number }];
  const waiting = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (other.id) o.id AS "opportunityId", other.id AS "userId", other.name, i.payload AS context, o.updated_at > ${after} AS fresh, o.updated_at
      FROM ${schema.opportunities} o
      CROSS JOIN LATERAL jsonb_array_elements(o.actors) peer
      INNER JOIN ${schema.users} other ON other.id = peer->>'userId'
      LEFT JOIN ${schema.intents} i ON i.id = peer->>'intent'
      WHERE o.status = 'pending'
        AND o.actors @> ${JSON.stringify([{ userId }])}::jsonb
        AND peer->>'userId' <> ${userId}
        AND NOT EXISTS (
          SELECT 1 FROM ${schema.opportunityEvents} e
          WHERE e.opportunity_id = o.id AND e.type = 'committed' AND e.actor_user_id = ${userId}
        )
      ORDER BY other.id, o.updated_at DESC
    ) latest ORDER BY updated_at DESC
  `) as unknown as MorningOwed['waiting'];
  const notes = await db.execute(sql`
    SELECT DISTINCT ON (m.metadata->>'intentId') m.parts->0->>'text' AS text, m.metadata->>'intentId' AS "intentId"
    FROM ${schema.messages} m
    INNER JOIN ${schema.conversations} dm ON dm.id = m.conversation_id
    WHERE dm.dm_pair = ${dmPair}
      AND m.created_at > ${after}
      AND m.metadata->'principalMessage'->>'summary' = 'true'
    ORDER BY m.metadata->>'intentId', m.created_at DESC
  `) as unknown as MorningOwed['notes'];
  const questions = await db.execute(sql`
    SELECT asked.parts->0->>'text' AS text, asked.metadata->>'intentId' AS "intentId"
    FROM ${schema.messages} asked
    INNER JOIN ${schema.conversations} dm ON dm.id = asked.conversation_id
    WHERE dm.dm_pair = ${dmPair}
      AND asked.created_at > ${after}
      AND asked.metadata->'principalMessage'->>'kind' = 'question'
      AND NOT EXISTS (
        SELECT 1 FROM ${schema.messages} retired
        WHERE retired.conversation_id = asked.conversation_id
          AND retired.metadata->'principalMessage'->>'kind' IN ('answer', 'expire')
          AND retired.metadata->'principalMessage'->>'questionId' = asked.metadata->'principalMessage'->>'questionId'
      )
    ORDER BY asked.created_at
  `) as unknown as MorningOwed['questions'];
  return { talked, waiting: [...waiting], notes: [...notes], questions: [...questions] };
}

/** @returns Intents that belong to a network. */
export async function networkedIntentIds(userId: string): Promise<Set<string>> {
  const rows = await db.select({ id: schema.intentNetworks.intentId })
    .from(schema.intentNetworks)
    .innerJoin(schema.intents, eq(schema.intents.id, schema.intentNetworks.intentId))
    .where(eq(schema.intents.userId, userId));
  return new Set(rows.map((row) => row.id));
}
