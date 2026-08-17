/**
 * ContactDatabaseAdapter — database interface for ContactService.
 *
 * Intentionally separate from database.adapter.ts so that test files mocking
 * ChatDatabaseAdapter do not interfere with ContactService integration tests.
 */

import { asc, eq, and, inArray, isNull, isNotNull, or, ilike, sql } from 'drizzle-orm/sql';
import * as schema from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';

async function ensurePersonalNetwork(userId: string): Promise<string> {
  const existing = await db
    .select({ networkId: schema.personalNetworks.networkId })
    .from(schema.personalNetworks)
    .where(eq(schema.personalNetworks.userId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0].networkId;

  const networkId = crypto.randomUUID();

  // Personal networks are prompt-less by default so the assignment policy treats
  // them as "no filtration" (score 1.0) — every one of the owner's intents lands
  // in their own personal network. The owner may later set a prompt to curate it.
  await db.insert(schema.networks).values({
    id: networkId,
    title: 'My Network',
    isPersonal: true,
  }).onConflictDoNothing();

  await db.insert(schema.personalNetworks).values({ userId, networkId }).onConflictDoNothing();

  await db.insert(schema.networkMembers).values({
    networkId,
    userId,
    permissions: ['owner'],
    autoAssign: true,
  }).onConflictDoNothing();

  const persisted = await db
    .select({ networkId: schema.personalNetworks.networkId })
    .from(schema.personalNetworks)
    .where(eq(schema.personalNetworks.userId, userId))
    .limit(1);

  return persisted[0]?.networkId ?? networkId;
}

async function getPersonalIndexId(userId: string): Promise<string | null> {
  const result = await db
    .select({ networkId: schema.personalNetworks.networkId })
    .from(schema.personalNetworks)
    .where(eq(schema.personalNetworks.userId, userId))
    .limit(1);
  return result[0]?.networkId ?? null;
}

export class ContactDatabaseAdapter {




  async getUser(userId: string): Promise<typeof schema.users.$inferSelect | null> {
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return row ?? null;
  }





  async getContactMembers(ownerId: string): Promise<Array<{
    userId: string;
    user: { id: string; name: string; email: string; avatar: string | null };
  }>> {
    const personalIndexId = await getPersonalIndexId(ownerId);
    if (!personalIndexId) return [];

    const rows = await db
      .select({
        userId: schema.networkMembers.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userAvatar: schema.users.avatar,
      })
      .from(schema.networkMembers)
      .innerJoin(schema.users, eq(schema.networkMembers.userId, schema.users.id))
      .where(and(
        eq(schema.networkMembers.networkId, personalIndexId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        isNull(schema.networkMembers.deletedAt),
        isNull(schema.users.deletedAt),
      ));

    return rows.map(row => ({
      userId: row.userId,
      user: { id: row.userId, name: row.userName, email: row.userEmail, avatar: row.userAvatar },
    }));
  }

  async searchContactMembers(
    ownerId: string,
    q: string,
    limit: number,
  ): Promise<Array<{
    contactId: string;
    name: string;
    email: string;
    avatar: string | null;
  }>> {
    const personalIndexId = await getPersonalIndexId(ownerId);
    if (!personalIndexId) return [];

    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    const rows = await db
      .select({
        userId: schema.networkMembers.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userAvatar: schema.users.avatar,
      })
      .from(schema.networkMembers)
      .innerJoin(schema.users, eq(schema.networkMembers.userId, schema.users.id))
      .where(and(
        eq(schema.networkMembers.networkId, personalIndexId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        isNull(schema.networkMembers.deletedAt),
        isNull(schema.users.deletedAt),
        or(ilike(schema.users.name, pattern), ilike(schema.users.email, pattern)),
      ))
      .orderBy(asc(schema.users.name), asc(schema.users.email))
      .limit(limit);

    return rows.map((row) => ({
      contactId: row.userId,
      name: row.userName,
      email: row.userEmail,
      avatar: row.userAvatar,
    }));
  }

  async hardDeleteContactMembership(ownerId: string, contactUserId: string): Promise<void> {
    const personalIndexId = await getPersonalIndexId(ownerId);
    if (!personalIndexId) return;

    await db.delete(schema.networkMembers)
      .where(and(
        eq(schema.networkMembers.networkId, personalIndexId),
        eq(schema.networkMembers.userId, contactUserId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
      ));
  }
}
