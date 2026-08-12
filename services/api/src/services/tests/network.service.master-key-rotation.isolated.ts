import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm/sql';

const sendSpy = mock(async (_args: { to: string; subject: string; html: string; text: string }) => ({ data: null, skipped: false }));
mock.module('../../lib/email/transport.helper', () => ({
  executeSendEmail: sendSpy,
}));

afterAll(() => {
  mock.restore();
});

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { hashMasterKey } from '../../lib/experiment/master-key';
import { networkService } from '../network.service';

function databaseTest(name: string, callback: () => Promise<void>): void {
  test(name, callback, 30_000);
}

describe('networkService.rotateMasterKey', () => {
  let networkId: string;
  let noMasterKeyNetworkId: string;
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
        title: 'Rotate Test Master Key',
        isPersonal: false,
        masterKeyHash: initialHash,
        permissions: { joinPolicy: 'invite_only', invitationLink: null },
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
      .values({ title: 'Rotate Test No Master Key', isPersonal: false })
      .returning({ id: schema.networks.id });
    noMasterKeyNetworkId = nx.id;
    cleanupNetworkIds.push(noMasterKeyNetworkId);
    await db.insert(schema.networkMembers).values({ networkId: noMasterKeyNetworkId, userId: ownerId, permissions: ['owner'] });
  }, 30_000);

  afterAll(async () => {
    if (cleanupNetworkIds.length > 0) {
      await db.delete(schema.networkMembers).where(inArray(schema.networkMembers.networkId, cleanupNetworkIds));
      await db.delete(schema.networks).where(inArray(schema.networks.id, cleanupNetworkIds));
    }
    if (cleanupUserIds.length > 0) {
      await db.delete(schema.users).where(inArray(schema.users.id, cleanupUserIds));
    }
  }, 45_000);

  databaseTest('rotates the hash and returns a fresh plaintext key', async () => {
    sendSpy.mockClear();

    const [before] = await db
      .select({ hash: schema.networks.masterKeyHash })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId));

    const result = await networkService.rotateMasterKey(networkId, ownerId);

    expect(result.masterKey).toBeTruthy();
    expect(result.masterKey.length).toBe(64);

    const [after] = await db
      .select({ hash: schema.networks.masterKeyHash })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId));
    expect(after.hash).not.toBe(before.hash);
    const expectedHash = await hashMasterKey(result.masterKey);
    expect(after.hash).toBe(expectedHash);

    // Drain the fire-and-forget dispatch before the next test mockClears the spy.
    await new Promise((r) => setTimeout(r, 50));
  });

  databaseTest('emails every owner of the network', async () => {
    sendSpy.mockClear();
    await networkService.rotateMasterKey(networkId, ownerId);

    // Email dispatch is fire-and-forget; await a microtask flush.
    await new Promise((r) => setTimeout(r, 50));

    expect(sendSpy.mock.calls.length).toBe(2);
    const recipients = sendSpy.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(recipients).toEqual([
      expect.stringContaining('rotate-coowner'),
      expect.stringContaining('rotate-owner'),
    ]);
  });

  databaseTest('throws when the network has no master key', async () => {
    await expect(
      networkService.rotateMasterKey(noMasterKeyNetworkId, ownerId),
    ).rejects.toThrow(/no master key/i);
  });

  databaseTest('throws when the caller is not an owner', async () => {
    await expect(
      networkService.rotateMasterKey(networkId, nonOwnerId),
    ).rejects.toThrow(/owner/i);
  });
});
