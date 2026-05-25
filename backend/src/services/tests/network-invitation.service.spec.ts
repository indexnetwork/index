import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';

const sendSpy = mock(async (_args: { to: string; subject: string; html: string; text: string }) => ({ data: null, skipped: false }));
mock.module('../../lib/email/transport.helper', () => ({
  executeSendEmail: sendSpy,
}));

afterAll(() => {
  mock.restore();
});

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { networkInvitationService } from '../network-invitation.service';

describe('networkInvitationService.invite', () => {
  let networkId: string;
  const cleanupUserIds: string[] = [];

  beforeAll(async () => {
    const [u] = await db.insert(schema.users)
      .values({ email: `inv-owner-${Date.now()}@test.dev`, name: 'Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    cleanupUserIds.push(u.id);

    const [n] = await db.insert(schema.networks)
      .values({ title: 'Invite Net', isPersonal: false, isExperiment: true })
      .returning({ id: schema.networks.id });
    networkId = n.id;
  });

  afterAll(async () => {
    if (cleanupUserIds.length > 0) {
      // Collect personal network IDs to clean up after users are removed
      const personalNets = await db
        .select({ networkId: schema.personalNetworks.networkId })
        .from(schema.personalNetworks)
        .where(inArray(schema.personalNetworks.userId, cleanupUserIds));
      const personalNetworkIds = personalNets.map((p) => p.networkId);

      // Delete memberships referencing these users (no cascade on user_id FK)
      await db.delete(schema.networkMembers)
        .where(inArray(schema.networkMembers.userId, cleanupUserIds));
      await db.delete(schema.personalNetworks)
        .where(inArray(schema.personalNetworks.userId, cleanupUserIds));
      await db.delete(schema.users).where(inArray(schema.users.id, cleanupUserIds));

      // Now safe to drop the personal networks created during the test
      if (personalNetworkIds.length > 0) {
        await db.delete(schema.networks).where(inArray(schema.networks.id, personalNetworkIds));
      }
    }
    await db.delete(schema.networks).where(eq(schema.networks.id, networkId));
  });

  test('creates user, agent, network-scoped permissions, key, and membership for a new email', async () => {
    sendSpy.mockClear();
    const email = `invitee-${Date.now()}@test.dev`;
    const result = await networkInvitationService.invite({ networkId, email });

    cleanupUserIds.push(result.user.id);

    expect(result.created).toBe(true);
    expect(result.alreadyMember).toBe(false);
    expect(result.agentProvisioned).toBe(true);
    expect(result.apiKey).toBeTruthy();
    expect(result.user.email).toBe(email);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const call = sendSpy.mock.calls[0][0] as unknown as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(call.to).toBe(email);
    expect(call.html).toContain(result.apiKey!);

    const [member] = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .where(and(
        eq(schema.networkMembers.userId, result.user.id),
        eq(schema.networkMembers.networkId, networkId),
      ));
    expect(member).toBeTruthy();

    const perms = await db
      .select({ scope: schema.agentPermissions.scope, scopeId: schema.agentPermissions.scopeId })
      .from(schema.agentPermissions)
      .where(eq(schema.agentPermissions.userId, result.user.id));
    expect(perms.length).toBeGreaterThan(0);
    expect(perms.every((p) => p.scope === 'network' && p.scopeId === networkId)).toBe(true);
  });

  test('existing user without scoped agent (e.g. ghost contact) gets provisioned + emailed', async () => {
    const email = `ghost-${Date.now()}@test.dev`;
    const [existing] = await db.insert(schema.users)
      .values({ email, name: email, emailVerified: true })
      .returning({ id: schema.users.id });
    cleanupUserIds.push(existing.id);

    sendSpy.mockClear();
    const result = await networkInvitationService.invite({ networkId, email });

    expect(result.created).toBe(false);
    expect(result.alreadyMember).toBe(false);
    expect(result.agentProvisioned).toBe(true);
    expect(result.apiKey).toBeTruthy();
    expect(result.user.id).toBe(existing.id);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  test('existing user with scoped agent: no new key, no email, alreadyMember reflects state', async () => {
    const email = `provisioned-${Date.now()}@test.dev`;
    const first = await networkInvitationService.invite({ networkId, email });
    cleanupUserIds.push(first.user.id);

    sendSpy.mockClear();
    const second = await networkInvitationService.invite({ networkId, email });

    expect(second.user.id).toBe(first.user.id);
    expect(second.created).toBe(false);
    expect(second.alreadyMember).toBe(true);
    expect(second.agentProvisioned).toBe(false);
    expect(second.apiKey).toBeNull();
    expect(sendSpy).toHaveBeenCalledTimes(0);
  });
});
