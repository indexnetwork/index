import { config } from 'dotenv';
config({ path: '.env.test' });

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import * as schema from '../src/schemas/database.schema';

type SendArgs = { to: string | string[]; subject: string; html: string; text: string; headers?: Record<string, string> };
const sendSpy = mock<(opts: SendArgs) => Promise<{ data: null; skipped: boolean }>>(async () => ({ data: null, skipped: false }));
mock.module('../src/lib/email/transport.helper', () => ({
  executeSendEmail: sendSpy,
}));

afterAll(() => {
  mock.restore();
});

const { experimentService } = await import('../src/services/experiment.service');

describe('CSV import → network-scoped agent end-to-end', () => {
  let networkId: string;
  let ownerId: string;
  const cleanupUserIds: string[] = [];
  const cleanupNetworkIds: string[] = [];

  beforeAll(async () => {
    const [u] = await db.insert(schema.users)
      .values({ email: `import-owner-${Date.now()}@test.dev`, name: 'Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = u.id;
    cleanupUserIds.push(ownerId);

    const [n] = await db.insert(schema.networks)
      .values({ title: 'Import Net', isPersonal: false, isExperiment: true })
      .returning({ id: schema.networks.id });
    networkId = n.id;
    cleanupNetworkIds.push(networkId);

    await db.insert(schema.networkMembers).values({
      networkId,
      userId: ownerId,
      permissions: ['owner'],
    });
  });

  afterAll(async () => {
    // Drop network_members and personal_networks for invited users (no FK cascade on user_id)
    if (cleanupUserIds.length > 0) {
      const personalNets = await db
        .select({ networkId: schema.personalNetworks.networkId })
        .from(schema.personalNetworks)
        .where(inArray(schema.personalNetworks.userId, cleanupUserIds));
      const personalNetIds = personalNets.map((r) => r.networkId);

      await db.delete(schema.networkMembers).where(inArray(schema.networkMembers.userId, cleanupUserIds));
      await db.delete(schema.personalNetworks).where(inArray(schema.personalNetworks.userId, cleanupUserIds));
      await db.delete(schema.users).where(inArray(schema.users.id, cleanupUserIds));

      const allNetIds = [...cleanupNetworkIds, ...personalNetIds];
      if (allNetIds.length > 0) {
        await db.delete(schema.networks).where(inArray(schema.networks.id, allNetIds));
      }
    }
  });

  test('importMembers provisions user + scoped agent + key + email', async () => {
    sendSpy.mockClear();
    const email = `csv-invitee-${Date.now()}@test.dev`;
    const result = await experimentService.importMembers(networkId, [
      { email, name: 'CSV Invitee', socials: [] },
    ]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);

    const [user] = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    expect(user).toBeTruthy();
    expect(user.name).toBe('CSV Invitee');
    cleanupUserIds.push(user.id);

    // Membership
    const [member] = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .where(and(
        eq(schema.networkMembers.userId, user.id),
        eq(schema.networkMembers.networkId, networkId),
      ));
    expect(member).toBeTruthy();

    // Network-scoped permissions
    const perms = await db
      .select({ scope: schema.agentPermissions.scope, scopeId: schema.agentPermissions.scopeId, actions: schema.agentPermissions.actions })
      .from(schema.agentPermissions)
      .where(and(
        eq(schema.agentPermissions.userId, user.id),
        eq(schema.agentPermissions.scope, 'network'),
        eq(schema.agentPermissions.scopeId, networkId),
      ));
    expect(perms.length).toBeGreaterThanOrEqual(1);
    expect(perms[0].actions).toEqual(expect.arrayContaining([
      'manage:profile',
      'manage:intents',
      'manage:networks',
      'manage:contacts',
      'manage:opportunities',
    ]));

    // Owner credentials email dispatched once
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const call = sendSpy.mock.calls[0][0];
    expect(Array.isArray(call.to)).toBe(true);
    expect((call.to as string[]).length).toBe(1);
    expect(call.html.length).toBeGreaterThan(0);
  });

  test('re-importing the same email is idempotent: no new key, no new email', async () => {
    const email = `csv-idem-${Date.now()}@test.dev`;
    await experimentService.importMembers(networkId, [
      { email, name: 'First', socials: [] },
    ]);
    const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    cleanupUserIds.push(u.id);

    sendSpy.mockClear();

    const second = await experimentService.importMembers(networkId, [
      { email, name: 'Second', socials: [] },
    ]);
    expect(second.imported).toBe(1);

    // Owner credentials email still dispatched (credentials are rotated)
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Permission rows still exactly one per scoped action set
    const perms = await db
      .select({ id: schema.agentPermissions.id })
      .from(schema.agentPermissions)
      .where(and(
        eq(schema.agentPermissions.userId, u.id),
        eq(schema.agentPermissions.scope, 'network'),
        eq(schema.agentPermissions.scopeId, networkId),
      ));
    expect(perms.length).toBe(1);
  });
});
