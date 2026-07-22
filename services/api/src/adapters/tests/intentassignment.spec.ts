import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm/sql';

import { IntentDatabaseAdapter } from '../intent.database.adapter';
import db from '../../lib/drizzle/drizzle';
import { intentNetworks, intents, networkMembers, networks, users } from '../../schemas/database.schema';

setDefaultTimeout(30_000);

const adapter = new IntentDatabaseAdapter();
const userIds: string[] = [];
const networkIds: string[] = [];
const intentIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const [user] = await db.insert(users).values({
    email: `intent-assignment-${label}-${crypto.randomUUID()}@test.dev`,
    name: `Intent Assignment ${label}`,
    emailVerified: true,
  }).returning({ id: users.id });
  userIds.push(user.id);
  return user.id;
}

async function createFixture(options: {
  permission?: 'owner' | 'member' | 'admin' | 'contact' | null;
  membershipDeleted?: boolean;
  networkDeleted?: boolean;
  intentArchived?: boolean;
} = {}) {
  const userId = await createUser('owner');
  const [network] = await db.insert(networks).values({
    title: `Atomic Assignment ${crypto.randomUUID()}`,
    deletedAt: options.networkDeleted ? new Date() : null,
  }).returning({ id: networks.id });
  networkIds.push(network.id);

  if (options.permission !== null) {
    await db.insert(networkMembers).values({
      networkId: network.id,
      userId,
      permissions: [options.permission ?? 'member'],
      deletedAt: options.membershipDeleted ? new Date() : null,
    });
  }

  const [intent] = await db.insert(intents).values({
    userId,
    payload: 'Find collaborators for an atomic assignment test',
    archivedAt: options.intentArchived ? new Date() : null,
  }).returning({ id: intents.id });
  intentIds.push(intent.id);
  return { userId, networkId: network.id, intentId: intent.id };
}

const metadata = {
  resourceType: 'intent' as const,
  mode: 'automatic' as const,
  scope: 'network' as const,
  policy: 'unified-threshold-v1' as const,
  threshold: 0.7,
  promptPresence: 'both' as const,
  finalScore: 0.82,
  assigned: true,
  source: 'adapter-test',
};

afterEach(async () => {
  if (intentIds.length > 0) {
    await db.delete(intentNetworks).where(inArray(intentNetworks.intentId, intentIds));
    await db.delete(intents).where(inArray(intents.id, intentIds));
  }
  if (networkIds.length > 0) {
    await db.delete(networkMembers).where(inArray(networkMembers.networkId, networkIds));
    await db.delete(networks).where(inArray(networks.id, networkIds));
  }
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
  intentIds.length = 0;
  networkIds.length = 0;
  userIds.length = 0;
});

describe('IntentDatabaseAdapter atomic intent-network assignment', () => {
  test.each(['owner', 'member', 'admin'] as const)('assigns for current %s membership and preserves decision data', async (permission) => {
    const fixture = await createFixture({ permission });

    await expect(adapter.assignIntentToNetworkIfMember(
      fixture.userId,
      fixture.intentId,
      fixture.networkId,
      0.82,
      metadata,
    )).resolves.toEqual({ kind: 'assigned' });

    const [row] = await db.select().from(intentNetworks).where(and(
      eq(intentNetworks.intentId, fixture.intentId),
      eq(intentNetworks.networkId, fixture.networkId),
    ));
    expect(Number(row.relevancyScore)).toBe(0.82);
    expect(row.assignmentMetadata).toEqual(metadata);
  });

  test('returns already_assigned without overwriting the original score or metadata', async () => {
    const fixture = await createFixture();
    await adapter.assignIntentToNetworkIfMember(fixture.userId, fixture.intentId, fixture.networkId, 0.82, metadata);

    const result = await adapter.assignIntentToNetworkIfMember(
      fixture.userId,
      fixture.intentId,
      fixture.networkId,
      0.1,
      { ...metadata, finalScore: 0.1 },
    );

    expect(result).toEqual({ kind: 'already_assigned' });
    const [row] = await db.select().from(intentNetworks).where(and(
      eq(intentNetworks.intentId, fixture.intentId),
      eq(intentNetworks.networkId, fixture.networkId),
    ));
    expect(Number(row.relevancyScore)).toBe(0.82);
    expect(row.assignmentMetadata).toEqual(metadata);
  });

  test.each([
    ['missing membership', { permission: null }],
    ['non-accepted contact membership', { permission: 'contact' as const }],
    ['soft-deleted membership', { membershipDeleted: true }],
    ['soft-deleted network', { networkDeleted: true }],
  ])('fails closed for %s', async (_label, options) => {
    const fixture = await createFixture(options);
    await expect(adapter.assignIntentToNetworkIfMember(
      fixture.userId,
      fixture.intentId,
      fixture.networkId,
      0.82,
      metadata,
    )).resolves.toEqual({ kind: 'membership_required' });
    expect(await db.select().from(intentNetworks).where(eq(intentNetworks.intentId, fixture.intentId))).toHaveLength(0);
  });

  test('fails closed for a wrong owner or archived intent', async () => {
    const fixture = await createFixture();
    const otherUserId = await createUser('other');
    await expect(adapter.assignIntentToNetworkIfMember(
      otherUserId,
      fixture.intentId,
      fixture.networkId,
      0.82,
      metadata,
    )).resolves.toEqual({ kind: 'intent_not_owned_or_not_found' });

    await db.update(intents).set({ archivedAt: new Date() }).where(eq(intents.id, fixture.intentId));
    await expect(adapter.assignIntentToNetworkIfMember(
      fixture.userId,
      fixture.intentId,
      fixture.networkId,
      0.82,
      metadata,
    )).resolves.toEqual({ kind: 'intent_not_owned_or_not_found' });
  });

  test('fails closed when membership revocation commits while the final write waits', async () => {
    const fixture = await createFixture();
    let releaseRevocation: (() => void) | undefined;
    let reportLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseRevocation = resolve; });

    const revocation = db.transaction(async (tx) => {
      await tx.select({ userId: networkMembers.userId })
        .from(networkMembers)
        .where(and(
          eq(networkMembers.networkId, fixture.networkId),
          eq(networkMembers.userId, fixture.userId),
        ))
        .for('update');
      reportLocked?.();
      await release;
      await tx.update(networkMembers)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(networkMembers.networkId, fixture.networkId),
          eq(networkMembers.userId, fixture.userId),
        ));
    });

    await locked;
    const assignment = adapter.assignIntentToNetworkIfMember(
      fixture.userId,
      fixture.intentId,
      fixture.networkId,
      0.82,
      metadata,
    );
    await Bun.sleep(50);
    releaseRevocation?.();
    await revocation;

    await expect(assignment).resolves.toEqual({ kind: 'membership_required' });
    expect(await db.select().from(intentNetworks).where(eq(intentNetworks.intentId, fixture.intentId))).toHaveLength(0);
  });
});
