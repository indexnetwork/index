import '../src/startup.env';

import { mock } from 'bun:test';

mock.module('../src/lib/email/transport.helper', () => ({
  executeSendEmail: mock(() => Promise.resolve({ skipped: true, reason: 'mocked in test' })),
}));

import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { networkInvitationService } from '../src/services/network-invitation.service';
import db from '../src/lib/drizzle/drizzle';
import {
  agentPermissions,
  agents,
  apikeys,
  networkMembers,
  networks,
  personalNetworks,
  users,
} from '../src/schemas/database.schema';

const cleanup: Array<() => Promise<void>> = [];

afterAll(async () => {
  mock.restore();
  for (const f of [...cleanup].reverse()) await f();
});

async function setupNetworkAndOwner() {
  const ownerEmail = `owner-${randomUUID()}@example.com`;
  const [owner] = await db
    .insert(users)
    .values({ email: ownerEmail, name: 'Owner', emailVerified: true, isGhost: false })
    .returning({ id: users.id });
  const [network] = await db
    .insert(networks)
    .values({ title: `Net ${randomUUID().slice(0, 6)}`, isExperiment: true, isPersonal: false })
    .returning({ id: networks.id });
  await db
    .insert(networkMembers)
    .values({ networkId: network.id, userId: owner.id, permissions: ['owner'], autoAssign: true });
  cleanup.push(async () => {
    await db.delete(apikeys).where(eq(apikeys.userId, owner.id));
    await db.delete(agentPermissions).where(eq(agentPermissions.userId, owner.id));
    await db.delete(agents).where(eq(agents.ownerId, owner.id));
    await db.delete(networkMembers).where(eq(networkMembers.networkId, network.id));
    await db.delete(networks).where(eq(networks.id, network.id));
    await db.delete(users).where(eq(users.id, owner.id));
  });
  return { ownerId: owner.id, networkId: network.id };
}

describe('networkInvitationService.resendInvite', () => {
  it('rotates the api key when a scoped agent already exists', async () => {
    const { networkId } = await setupNetworkAndOwner();
    const initial = await networkInvitationService.invite({
      networkId,
      email: `member-${randomUUID()}@example.com`,
    });
    expect(initial.agentProvisioned).toBe(true);
    const memberId = initial.user.id;
    cleanup.push(async () => {
      await db.delete(apikeys).where(eq(apikeys.userId, memberId));
      await db.delete(agentPermissions).where(eq(agentPermissions.userId, memberId));
      await db.delete(agents).where(eq(agents.ownerId, memberId));
      await db.delete(networkMembers).where(eq(networkMembers.userId, memberId));
      const pn = await db.select({ networkId: personalNetworks.networkId }).from(personalNetworks).where(eq(personalNetworks.userId, memberId));
      await db.delete(personalNetworks).where(eq(personalNetworks.userId, memberId));
      for (const { networkId: pnId } of pn) {
        await db.delete(networks).where(eq(networks.id, pnId));
      }
      await db.delete(users).where(eq(users.id, memberId));
    });

    const [originalKey] = await db
      .select({ id: apikeys.id, start: apikeys.start })
      .from(apikeys)
      .where(eq(apikeys.userId, memberId));
    expect(originalKey).toBeDefined();

    const result = await networkInvitationService.resendInvite({ networkId, memberId });

    expect(result.rotated).toBe(true);
    expect(result.email).toBeTruthy();
    const after = await db
      .select({ id: apikeys.id, start: apikeys.start })
      .from(apikeys)
      .where(eq(apikeys.userId, memberId));
    expect(after.length).toBe(1);
    expect(after[0].id).not.toBe(originalKey.id);
  });

  it('provisions a fresh agent and key when the member has none', async () => {
    const { networkId } = await setupNetworkAndOwner();
    const memberEmail = `bare-${randomUUID()}@example.com`;
    const [member] = await db
      .insert(users)
      .values({ email: memberEmail, name: 'Bare', emailVerified: true, isGhost: false })
      .returning({ id: users.id });
    await db
      .insert(networkMembers)
      .values({ networkId, userId: member.id, permissions: ['member'], autoAssign: true });
    cleanup.push(async () => {
      await db.delete(apikeys).where(eq(apikeys.userId, member.id));
      await db.delete(agentPermissions).where(eq(agentPermissions.userId, member.id));
      await db.delete(agents).where(eq(agents.ownerId, member.id));
      await db.delete(networkMembers).where(and(
        eq(networkMembers.networkId, networkId),
        eq(networkMembers.userId, member.id),
      ));
      await db.delete(users).where(eq(users.id, member.id));
    });

    const result = await networkInvitationService.resendInvite({
      networkId,
      memberId: member.id,
    });

    expect(result.rotated).toBe(false);
    expect(result.email).toBe(memberEmail);
    const keys = await db
      .select({ id: apikeys.id })
      .from(apikeys)
      .where(eq(apikeys.userId, member.id));
    expect(keys.length).toBe(1);
  });

  it('throws when memberId is not a member of the network', async () => {
    const { networkId } = await setupNetworkAndOwner();
    const fakeId = randomUUID();
    await expect(
      networkInvitationService.resendInvite({ networkId, memberId: fakeId }),
    ).rejects.toThrow('Member not found');
  });
});
