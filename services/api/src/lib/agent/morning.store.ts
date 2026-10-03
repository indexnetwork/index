import { and, eq, isNull, sql } from 'drizzle-orm/sql';

import db from '../drizzle/drizzle';
import * as schema from '../../schemas/database.schema';

import { briefedOnLocalDate, type MorningClaim, type MorningOwner } from './morning';

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

/** @returns Signals that belong to a network. */
export async function networkedIntentIds(userId: string): Promise<Set<string>> {
  const rows = await db.select({ id: schema.intentNetworks.intentId })
    .from(schema.intentNetworks)
    .innerJoin(schema.intents, eq(schema.intents.id, schema.intentNetworks.intentId))
    .where(eq(schema.intents.userId, userId));
  return new Set(rows.map((row) => row.id));
}
