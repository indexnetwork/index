import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import * as schema from '../src/schemas/database.schema';

type SendArgs = { to: string | string[]; subject: string; html: string; text: string; headers?: Record<string, string> };
const sendSpy = mock<(opts: SendArgs) => Promise<{ data: null; skipped: boolean }>>(async () => ({ data: null, skipped: false }));
mock.module('../src/lib/email/transport.helper', () => ({
  executeSendEmail: sendSpy,
}));

const enrichBulkSpy = mock<(items: Array<{ userId: string; networkId?: string; reason?: string }>) => Promise<unknown[]>>(async () => []);
const enrichSingleSpy = mock<(data: { userId: string; networkId?: string; reason?: string }) => Promise<unknown>>(async () => ({}));

afterAll(() => {
  mock.restore();
});

const { ExperimentService } = await import('../src/services/experiment.service');
const experimentService = new ExperimentService({
  addEnrichUserJobBulk: enrichBulkSpy,
  addEnrichUserJob: enrichSingleSpy,
});

function databaseTest(
  name: string,
  callback: () => Promise<void>,
  requestedTimeout = 45_000,
): void {
  test(name, callback, Math.max(requestedTimeout, 45_000));
}

describe('CSV import → network-scoped agent end-to-end', () => {
  let networkId: string;
  let ownerId: string;
  let ownerEmail: string;
  const cleanupUserIds: string[] = [];
  const cleanupNetworkIds: string[] = [];

  beforeAll(async () => {
    ownerEmail = `import-owner-${Date.now()}@test.dev`;
    const [u] = await db.insert(schema.users)
      .values({ email: ownerEmail, name: 'Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = u.id;
    cleanupUserIds.push(ownerId);

    const [n] = await db.insert(schema.networks)
      .values({ title: 'Import Net', isPersonal: false })
      .returning({ id: schema.networks.id });
    networkId = n.id;
    cleanupNetworkIds.push(networkId);

    await db.insert(schema.networkMembers).values({
      networkId,
      userId: ownerId,
      permissions: ['owner'],
    });
  }, 30_000);

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
  }, 60_000);

  databaseTest('importMembers provisions user + scoped agent + key + email', async () => {
    sendSpy.mockClear();
    const email = `csv-invitee-${Date.now()}@test.dev`;
    const result = await experimentService.importMembers(networkId, [
      { email, name: 'CSV Invitee', socials: [] },
    ]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);

    const [user] = await db
      .select({ id: schema.users.id, name: schema.users.name, onboarding: schema.users.onboarding })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    cleanupUserIds.push(user.id);
    expect(user).toBeTruthy();
    expect(user.name).toBe('CSV Invitee');
    expect(user.onboarding?.profileSeeds?.[0]?.name).toBe('CSV Invitee');

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
      'manage:identity',
      'manage:premises',
      'manage:intents',
      'manage:networks',
      'manage:opportunities',
    ]));

    // Owner credentials email dispatched once to the owner
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const call = sendSpy.mock.calls[0][0];
    expect(Array.isArray(call.to)).toBe(true);
    expect((call.to as string[])).toContain(ownerEmail);
    expect(call.html.length).toBeGreaterThan(0);
  });

  databaseTest('re-importing the same email is idempotent: no new key, no new email', async () => {
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
  }, 15000);

  databaseTest('importMembers persists CSV profile fields and stages their onboarding provenance', async () => {
    const email = `csv-profile-${Date.now()}@test.dev`;
    await experimentService.importMembers(networkId, [
      { email, name: 'Profile Test', bio: 'AI researcher at MIT', location: 'Cambridge, MA', socials: [{ label: 'linkedin', value: 'https://linkedin.com/in/profile-test' }] },
    ]);

    const [user] = await db
      .select({ id: schema.users.id, intro: schema.users.intro, location: schema.users.location, onboarding: schema.users.onboarding })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    cleanupUserIds.push(user.id);

    expect(user.intro).toBe('AI researcher at MIT');
    expect(user.location).toBe('Cambridge, MA');
    const seed = user.onboarding?.profileSeeds?.[0];
    expect(seed).toMatchObject({
      source: 'experiment_csv_import',
      networkId,
      name: 'Profile Test',
      bio: 'AI researcher at MIT',
      location: 'Cambridge, MA',
    });
    expect(seed?.socials).toEqual([{ label: 'linkedin', value: 'https://linkedin.com/in/profile-test' }]);
  });

  databaseTest('importMembers leaves onboarding incomplete for imported users', async () => {
    const email = `csv-onboard-${Date.now()}@test.dev`;
    await experimentService.importMembers(networkId, [
      { email, name: 'Onboard Test', socials: [] },
    ]);

    const [user] = await db
      .select({ id: schema.users.id, onboarding: schema.users.onboarding })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    cleanupUserIds.push(user.id);

    expect(user.onboarding?.completedAt).toBeUndefined();
  });

  databaseTest('importMembers preserves existing onboarding fields without setting completedAt', async () => {
    const email = `csv-onboard-preserve-${Date.now()}@test.dev`;

    // Pre-create user with existing onboarding state
    const [preUser] = await db.insert(schema.users)
      .values({
        email,
        name: 'Pre-existing',
        emailVerified: true,
        onboarding: { flow: 2, currentStep: 'connections' },
      })
      .returning({ id: schema.users.id });
    cleanupUserIds.push(preUser.id);

    await experimentService.importMembers(networkId, [
      { email, name: 'Pre-existing', socials: [] },
    ]);

    const [user] = await db
      .select({ onboarding: schema.users.onboarding })
      .from(schema.users)
      .where(eq(schema.users.id, preUser.id));

    expect(user.onboarding!.completedAt).toBeUndefined();
    expect(user.onboarding!.flow).toBe(2);
    expect(user.onboarding!.currentStep).toBe('connections');
  });

  databaseTest('importMembers does not overwrite existing completedAt', async () => {
    const email = `csv-keep-completed-${Date.now()}@test.dev`;
    const originalCompletedAt = '2025-01-15T00:00:00.000Z';

    const [preUser] = await db.insert(schema.users)
      .values({
        email,
        name: 'Already Onboarded',
        emailVerified: true,
        onboarding: { completedAt: originalCompletedAt, flow: 1 },
      })
      .returning({ id: schema.users.id });
    cleanupUserIds.push(preUser.id);

    await experimentService.importMembers(networkId, [
      { email, name: 'Already Onboarded', socials: [] },
    ]);

    const [user] = await db
      .select({ onboarding: schema.users.onboarding })
      .from(schema.users)
      .where(eq(schema.users.id, preUser.id));

    expect(user.onboarding!.completedAt).toBe(originalCompletedAt);
    expect(user.onboarding!.flow).toBe(1);
  });

  databaseTest('importMembers enqueues profile enrichment for imported users', async () => {
    enrichBulkSpy.mockClear();
    const email = `csv-enrich-${Date.now()}@test.dev`;
    await experimentService.importMembers(networkId, [
      { email, name: 'Enrich Test', bio: 'Engineer', socials: [] },
    ]);

    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    cleanupUserIds.push(user.id);

    expect(enrichBulkSpy).toHaveBeenCalledTimes(1);
    const call = enrichBulkSpy.mock.calls[0][0];
    expect(call).toEqual([{ userId: user.id, networkId, reason: 'experiment_import' }]);
  });

  databaseTest('importMembers deduplicates enrichment jobs for repeated emails', async () => {
    enrichBulkSpy.mockClear();
    const email = `csv-dedup-${Date.now()}@test.dev`;
    await experimentService.importMembers(networkId, [
      { email, name: 'Dedup A', socials: [] },
      { email, name: 'Dedup B', socials: [] },
    ]);

    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    cleanupUserIds.push(user.id);

    expect(enrichBulkSpy).toHaveBeenCalledTimes(1);
    const call = enrichBulkSpy.mock.calls[0][0];
    expect(call).toHaveLength(1);
    expect(call[0]).toEqual({ userId: user.id, networkId, reason: 'experiment_import' });
  });

  databaseTest('importMembers forces consent-safe permissions on the network', async () => {
    // Network starts with non-consent-safe permissions and an invitation link
    // that must survive the forcing.
    const [permNet] = await db.insert(schema.networks)
      .values({
        title: 'Import Perms Net',
        isPersonal: false,
        permissions: {
          joinPolicy: 'anyone',
          invitationLink: { code: 'keepme' },
          allowGuestVibeCheck: true,
          profileEnrichment: 'auto',
        },
      })
      .returning({ id: schema.networks.id });
    cleanupNetworkIds.push(permNet.id);
    await db.insert(schema.networkMembers).values({
      networkId: permNet.id,
      userId: ownerId,
      permissions: ['owner'],
    });

    const email = `csv-perms-${Date.now()}@test.dev`;
    const result = await experimentService.importMembers(permNet.id, [
      { email, name: 'Perms Test', socials: [] },
    ]);
    expect(result.imported).toBe(1);

    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    cleanupUserIds.push(user.id);

    const [net] = await db
      .select({ permissions: schema.networks.permissions })
      .from(schema.networks)
      .where(eq(schema.networks.id, permNet.id));
    expect(net.permissions.allowGuestVibeCheck).toBe(false);
    expect(net.permissions.profileEnrichment).toBe('consent_required');
    // joinPolicy and invitationLink are preserved by the spread-merge
    expect(net.permissions.joinPolicy).toBe('anyone');
    expect(net.permissions.invitationLink).toEqual({ code: 'keepme' });
  });

  databaseTest('signup leaves onboarding incomplete for new users', async () => {
    enrichSingleSpy.mockClear();
    const email = `signup-onboard-${Date.now()}@test.dev`;
    const result = await experimentService.signup(networkId, {
      email,
      name: 'Signup Onboard',
    });
    cleanupUserIds.push(result.user.id);

    const [user] = await db
      .select({ onboarding: schema.users.onboarding })
      .from(schema.users)
      .where(eq(schema.users.id, result.user.id));

    expect(user.onboarding?.completedAt).toBeUndefined();
  });

  databaseTest('signup does not overwrite existing completedAt on re-signup', async () => {
    const email = `signup-keep-${Date.now()}@test.dev`;
    const originalCompletedAt = '2025-06-01T00:00:00.000Z';

    // First signup to provision the user
    const first = await experimentService.signup(networkId, { email, name: 'Re-Signup' });
    cleanupUserIds.push(first.user.id);

    // Manually set a known completedAt
    await db.update(schema.users)
      .set({ onboarding: { completedAt: originalCompletedAt, flow: 3 } })
      .where(eq(schema.users.id, first.user.id));

    // Second signup for the same user
    await experimentService.signup(networkId, { email, name: 'Re-Signup' });

    const [user] = await db
      .select({ onboarding: schema.users.onboarding })
      .from(schema.users)
      .where(eq(schema.users.id, first.user.id));

    expect(user.onboarding!.completedAt).toBe(originalCompletedAt);
    expect(user.onboarding!.flow).toBe(3);
  });

  databaseTest('signup persists rich profile fields, stages provenance, and enqueues enrichment', async () => {
    enrichSingleSpy.mockClear();
    const email = `signup-enrich-${Date.now()}@test.dev`;
    const result = await experimentService.signup(networkId, {
      email,
      name: 'Signup Enrich',
      bio: 'ML researcher',
      location: 'Oakland',
      socials: [{ label: 'github', value: 'signup-enrich' }],
    });
    cleanupUserIds.push(result.user.id);

    const [user] = await db
      .select({ name: schema.users.name, intro: schema.users.intro, location: schema.users.location, onboarding: schema.users.onboarding })
      .from(schema.users)
      .where(eq(schema.users.id, result.user.id));
    expect(user.name).toBe('Signup Enrich');
    expect(user.intro).toBe('ML researcher');
    expect(user.location).toBe('Oakland');
    expect(user.onboarding?.profileSeeds?.[0]).toMatchObject({
      source: 'experiment_signup',
      networkId,
      name: 'Signup Enrich',
      bio: 'ML researcher',
      location: 'Oakland',
      socials: [{ label: 'github', value: 'signup-enrich' }],
    });

    expect(enrichSingleSpy).toHaveBeenCalledTimes(1);
    const call = enrichSingleSpy.mock.calls[0][0];
    expect(call).toEqual({ userId: result.user.id, networkId, reason: 'experiment_signup' });
  });
});
