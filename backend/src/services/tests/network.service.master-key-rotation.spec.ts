import { config } from 'dotenv';
config({ path: '.env.test' });

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

const sendSpy = mock(async (_args: { to: string; subject: string; html: string; text: string }) => ({ data: null, skipped: false }));
mock.module('../../lib/email/transport.helper', () => ({
  executeSendEmail: sendSpy,
}));

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { hashMasterKey } from '../../lib/experiment/master-key';
import { networkService } from '../network.service';

describe('networkService.rotateExperimentMasterKey', () => {
  let networkId: string;
  let nonExperimentNetworkId: string;
  let ownerId: string;
  let coOwnerId: string;
  let nonOwnerId: string;
  const cleanupNetworkIds: string[] = [];
  const cleanupUserIds: string[] = [];

  beforeAll(async () => {
    const stamp = Date.now();
    const [owner] = await db.insert(schema.users)
      .values({ email: `rotate-owner-${stamp}@test.dev`, name: 'Rotate Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    const [coOwner] = await db.insert(schema.users)
      .values({ email: `rotate-coowner-${stamp}@test.dev`, name: 'Co Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    const [nonOwner] = await db.insert(schema.users)
      .values({ email: `rotate-nonowner-${stamp}@test.dev`, name: 'Non Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = owner.id;
    coOwnerId = coOwner.id;
    nonOwnerId = nonOwner.id;
    cleanupUserIds.push(ownerId, coOwnerId, nonOwnerId);

    const initialHash = await hashMasterKey('initial-plaintext-for-test');
    const [n] = await db.insert(schema.networks)
      .values({
        title: 'Rotate Test Experiment',
        isPersonal: false,
        isExperiment: true,
        experimentMasterKeyHash: initialHash,
        permissions: { joinPolicy: 'invite_only', invitationLink: null, allowGuestVibeCheck: false },
      })
      .returning({ id: schema.networks.id });
    networkId = n.id;
    cleanupNetworkIds.push(networkId);

    await db.insert(schema.networkMembers).values([
      { networkId, userId: ownerId, permissions: ['owner'] },
      { networkId, userId: coOwnerId, permissions: ['owner'] },
      { networkId, userId: nonOwnerId, permissions: ['member'] },
    ]);

    const [nx] = await db.insert(schema.networks)
      .values({ title: 'Rotate Test Non-Experiment', isPersonal: false, isExperiment: false })
      .returning({ id: schema.networks.id });
    nonExperimentNetworkId = nx.id;
    cleanupNetworkIds.push(nonExperimentNetworkId);
    await db.insert(schema.networkMembers).values({ networkId: nonExperimentNetworkId, userId: ownerId, permissions: ['owner'] });
  });

  afterAll(async () => {
    if (cleanupNetworkIds.length > 0) {
      await db.delete(schema.networkMembers).where(inArray(schema.networkMembers.networkId, cleanupNetworkIds));
      await db.delete(schema.networks).where(inArray(schema.networks.id, cleanupNetworkIds));
    }
    if (cleanupUserIds.length > 0) {
      await db.delete(schema.users).where(inArray(schema.users.id, cleanupUserIds));
    }
  });

  test('rotates the hash and returns a fresh plaintext key', async () => {
    sendSpy.mockClear();

    const [before] = await db
      .select({ hash: schema.networks.experimentMasterKeyHash })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId));

    const result = await networkService.rotateExperimentMasterKey(networkId, ownerId);

    expect(result.masterKey).toBeTruthy();
    expect(result.masterKey.length).toBe(64);

    const [after] = await db
      .select({ hash: schema.networks.experimentMasterKeyHash })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId));
    expect(after.hash).not.toBe(before.hash);
    const expectedHash = await hashMasterKey(result.masterKey);
    expect(after.hash).toBe(expectedHash);

    // Drain the fire-and-forget dispatch before the next test mockClears the spy.
    await new Promise((r) => setTimeout(r, 50));
  });

  test('emails every owner of the network', async () => {
    sendSpy.mockClear();
    await networkService.rotateExperimentMasterKey(networkId, ownerId);

    // Email dispatch is fire-and-forget; await a microtask flush.
    await new Promise((r) => setTimeout(r, 50));

    expect(sendSpy.mock.calls.length).toBe(2);
    const recipients = sendSpy.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(recipients).toEqual([
      expect.stringContaining('rotate-coowner'),
      expect.stringContaining('rotate-owner'),
    ]);
  });

  test('throws when the network is not an experiment', async () => {
    await expect(
      networkService.rotateExperimentMasterKey(nonExperimentNetworkId, ownerId),
    ).rejects.toThrow(/not an experiment/i);
  });

  test('throws when the caller is not an owner', async () => {
    await expect(
      networkService.rotateExperimentMasterKey(networkId, nonOwnerId),
    ).rejects.toThrow(/owner/i);
  });
});
