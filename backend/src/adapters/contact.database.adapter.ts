/**
 * ContactDatabaseAdapter — database interface for ContactService.
 *
 * Intentionally separate from database.adapter.ts so that test files mocking
 * ChatDatabaseAdapter do not interfere with ContactService integration tests.
 */

import { asc, eq, and, inArray, isNull, isNotNull, or, ilike, sql } from 'drizzle-orm';
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

  await db.insert(schema.networks).values({
    id: networkId,
    title: 'My Network',
    prompt: "Personal index containing the owner's imported contacts for network-scoped discovery.",
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

async function getPersonalNetworkId(userId: string): Promise<string | null> {
  const result = await db
    .select({ networkId: schema.personalNetworks.networkId })
    .from(schema.personalNetworks)
    .where(eq(schema.personalNetworks.userId, userId))
    .limit(1);
  return result[0]?.networkId ?? null;
}

export class ContactDatabaseAdapter {
  async getUserByEmail(email: string): Promise<{ id: string; name: string; email: string; isGhost: boolean } | null> {
    const normalized = email.toLowerCase().trim();
    const [row] = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, isGhost: schema.users.isGhost })
      .from(schema.users)
      .where(and(sql`lower(${schema.users.email}) = ${normalized}`, isNull(schema.users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async getUsersByEmails(emails: string[]): Promise<Array<{ id: string; name: string; email: string; isGhost: boolean }>> {
    if (emails.length === 0) return [];
    return db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, isGhost: schema.users.isGhost })
      .from(schema.users)
      .where(and(inArray(schema.users.email, emails), isNull(schema.users.deletedAt)));
  }

  async createGhostUser(data: { name: string; email: string }): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    const email = data.email.toLowerCase().trim();

    const result = await db
      .insert(schema.users)
      .values({ id, name: data.name, email, isGhost: true })
      .onConflictDoUpdate({
        target: schema.users.email,
        set: { name: sql`EXCLUDED."name"`, updatedAt: sql`now()` },
        setWhere: sql`${schema.users.isGhost} = true`,
      })
      .returning({ id: schema.users.id });

    if (result[0]) {
      if (result[0].id === id) {
        await db.insert(schema.userProfiles).values({ userId: id }).onConflictDoNothing();
      }
      return { id: result[0].id };
    }

    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!existing) throw new Error(`Cannot create ghost: email belongs to a deleted user (${email})`);
    return { id: existing.id };
  }

  async createGhostUsersBulk(data: Array<{ name: string; email: string }>): Promise<Array<{ id: string; name: string; email: string }>> {
    if (data.length === 0) return [];

    const usersToInsert = data.map(d => ({
      id: crypto.randomUUID(),
      name: d.name,
      email: d.email.toLowerCase().trim(),
      isGhost: true as const,
    }));

    await db.insert(schema.users).values(usersToInsert).onConflictDoNothing();

    const insertedEmails = new Set(usersToInsert.map(u => u.email));
    const existingAfterInsert = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(and(inArray(schema.users.email, [...insertedEmails]), isNull(schema.users.deletedAt)));

    const emailToId = new Map(existingAfterInsert.map(u => [u.email, u.id]));
    const actuallyCreatedIds = new Set(usersToInsert.filter(u => emailToId.get(u.email) === u.id).map(u => u.id));

    if (actuallyCreatedIds.size > 0) {
      const profilesToInsert = usersToInsert.filter(u => actuallyCreatedIds.has(u.id)).map(u => ({ userId: u.id }));
      await db.insert(schema.userProfiles).values(profilesToInsert).onConflictDoNothing();
    }

    return usersToInsert
      .map(u => { const id = emailToId.get(u.email); return id ? { id, name: u.name, email: u.email } : null; })
      .filter((r): r is { id: string; name: string; email: string } => r !== null);
  }

  async getUser(userId: string): Promise<typeof schema.users.$inferSelect | null> {
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return row ?? null;
  }

  async upsertContactMembership(ownerId: string, contactUserId: string, options: { restore?: boolean } = {}): Promise<void> {
    const personalNetworkId = await ensurePersonalNetwork(ownerId);

    if (options.restore) {
      await db.insert(schema.networkMembers)
        .values({ networkId: personalNetworkId, userId: contactUserId, permissions: ['contact'], autoAssign: false })
        .onConflictDoUpdate({
          target: [schema.networkMembers.networkId, schema.networkMembers.userId],
          set: { deletedAt: null, updatedAt: new Date() },
        });
    } else {
      const [existing] = await db
        .select({ deletedAt: schema.networkMembers.deletedAt })
        .from(schema.networkMembers)
        .where(and(
          eq(schema.networkMembers.networkId, personalNetworkId),
          eq(schema.networkMembers.userId, contactUserId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        ))
        .limit(1);

      if (existing?.deletedAt) return;

      await db.insert(schema.networkMembers)
        .values({ networkId: personalNetworkId, userId: contactUserId, permissions: ['contact'], autoAssign: false })
        .onConflictDoNothing();
    }
  }

  async upsertContactMembershipBulk(ownerId: string, contactUserIds: string[]): Promise<void> {
    if (contactUserIds.length === 0) return;
    const personalNetworkId = await ensurePersonalNetwork(ownerId);

    const softDeleted = new Set(
      (await db
        .select({ userId: schema.networkMembers.userId })
        .from(schema.networkMembers)
        .where(and(
          eq(schema.networkMembers.networkId, personalNetworkId),
          inArray(schema.networkMembers.userId, contactUserIds),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          isNotNull(schema.networkMembers.deletedAt),
        ))
      ).map(r => r.userId)
    );

    const idsToInsert = contactUserIds.filter(id => !softDeleted.has(id));
    if (idsToInsert.length === 0) return;

    await db.insert(schema.networkMembers)
      .values(idsToInsert.map(userId => ({ networkId: personalNetworkId, userId, permissions: ['contact'] as string[], autoAssign: false })))
      .onConflictDoNothing();
  }

  async clearReverseOptOut(ownerId: string, otherUserId: string): Promise<void> {
    const otherPersonalNetworkId = await getPersonalNetworkId(otherUserId);
    if (!otherPersonalNetworkId) return;

    await db.delete(schema.networkMembers)
      .where(and(
        eq(schema.networkMembers.networkId, otherPersonalNetworkId),
        eq(schema.networkMembers.userId, ownerId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        isNotNull(schema.networkMembers.deletedAt),
      ));
  }

  async clearReverseOptOutBulk(ownerId: string, otherUserIds: string[]): Promise<void> {
    if (otherUserIds.length === 0) return;

    const personalIndexRows = await db
      .select({ userId: schema.personalNetworks.userId, networkId: schema.personalNetworks.networkId })
      .from(schema.personalNetworks)
      .where(inArray(schema.personalNetworks.userId, otherUserIds));

    const personalNetworkIds = personalIndexRows.map(r => r.networkId);
    if (personalNetworkIds.length === 0) return;

    await db.delete(schema.networkMembers)
      .where(and(
        inArray(schema.networkMembers.networkId, personalNetworkIds),
        eq(schema.networkMembers.userId, ownerId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        isNotNull(schema.networkMembers.deletedAt),
      ));
  }

  async getContactMembers(ownerId: string): Promise<Array<{
    userId: string;
    user: { id: string; name: string; email: string; avatar: string | null; isGhost: boolean };
  }>> {
    const personalNetworkId = await getPersonalNetworkId(ownerId);
    if (!personalNetworkId) return [];

    const rows = await db
      .select({
        userId: schema.networkMembers.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userAvatar: schema.users.avatar,
        userIsGhost: schema.users.isGhost,
      })
      .from(schema.networkMembers)
      .innerJoin(schema.users, eq(schema.networkMembers.userId, schema.users.id))
      .where(and(
        eq(schema.networkMembers.networkId, personalNetworkId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        isNull(schema.networkMembers.deletedAt),
        isNull(schema.users.deletedAt),
      ));

    return rows.map(row => ({
      userId: row.userId,
      user: { id: row.userId, name: row.userName, email: row.userEmail, avatar: row.userAvatar, isGhost: row.userIsGhost },
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
    isGhost: boolean;
  }>> {
    const personalNetworkId = await getPersonalNetworkId(ownerId);
    if (!personalNetworkId) return [];

    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    const rows = await db
      .select({
        userId: schema.networkMembers.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userAvatar: schema.users.avatar,
        userIsGhost: schema.users.isGhost,
      })
      .from(schema.networkMembers)
      .innerJoin(schema.users, eq(schema.networkMembers.userId, schema.users.id))
      .where(and(
        eq(schema.networkMembers.networkId, personalNetworkId),
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
      isGhost: row.userIsGhost,
    }));
  }

  async hardDeleteContactMembership(ownerId: string, contactUserId: string): Promise<void> {
    const personalNetworkId = await getPersonalNetworkId(ownerId);
    if (!personalNetworkId) return;

    await db.delete(schema.networkMembers)
      .where(and(
        eq(schema.networkMembers.networkId, personalNetworkId),
        eq(schema.networkMembers.userId, contactUserId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
      ));
  }
}
