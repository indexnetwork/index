import { config } from 'dotenv';
config({ path: '.env.test' });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { generateMasterKey } from '../../lib/experiment/master-key';
import { ExperimentMasterKeyGuard } from '../experiment.guard';
import { networkService } from '../../services/network.service';

describe('ExperimentMasterKeyGuard after rotation', () => {
  let networkId: string;
  let ownerId: string;
  let originalKey: string;
  const cleanupUserIds: string[] = [];
  const cleanupNetworkIds: string[] = [];

  beforeAll(async () => {
    const stamp = Date.now();
    const generated = await generateMasterKey();
    originalKey = generated.key;

    const [owner] = await db.insert(schema.users)
      .values({ email: `guard-rot-${stamp}@test.dev`, name: 'Guard Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = owner.id;
    cleanupUserIds.push(ownerId);

    const initialHash = generated.hash;
    const [n] = await db.insert(schema.networks)
      .values({
        title: 'Guard Rotation Test',
        isPersonal: false,
        isExperiment: true,
        experimentMasterKeyHash: initialHash,
        permissions: { joinPolicy: 'invite_only', invitationLink: null, allowGuestVibeCheck: false },
      })
      .returning({ id: schema.networks.id });
    networkId = n.id;
    cleanupNetworkIds.push(networkId);
    await db.insert(schema.networkMembers).values({ networkId, userId: ownerId, permissions: ['owner'] });
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

  test('original key validates before rotation, new key validates after, old key is rejected after', async () => {
    const before = await ExperimentMasterKeyGuard(
      new Request(`http://localhost/networks/${networkId}/signup`, {
        method: 'POST',
        headers: { 'x-api-key': originalKey },
      }),
      { id: networkId },
    );
    expect(before.id).toBe(networkId);

    const { masterKey: newKey } = await networkService.rotateExperimentMasterKey(networkId, ownerId);

    const after = await ExperimentMasterKeyGuard(
      new Request(`http://localhost/networks/${networkId}/signup`, {
        method: 'POST',
        headers: { 'x-api-key': newKey },
      }),
      { id: networkId },
    );
    expect(after.id).toBe(networkId);

    let rejected: Response | null = null;
    try {
      await ExperimentMasterKeyGuard(
        new Request(`http://localhost/networks/${networkId}/signup`, {
          method: 'POST',
          headers: { 'x-api-key': originalKey },
        }),
        { id: networkId },
      );
    } catch (err) {
      if (err instanceof Response) rejected = err;
    }
    expect(rejected).not.toBeNull();
    expect(rejected!.status).toBe(403);
  });
});
