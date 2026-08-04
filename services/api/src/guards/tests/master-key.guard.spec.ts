import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm/sql';

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { generateMasterKey } from '../../lib/experiment/master-key';
import { withMinimumDatabaseHookBudget } from '../../lib/testing/database-test-budget';
import { MasterKeyGuard } from '../master-key.guard';

const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 30_000);
const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

describe('MasterKeyGuard after rotation', () => {
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
        masterKeyHash: initialHash,
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
    const before = await MasterKeyGuard(
      new Request(`http://localhost/networks/${networkId}/signup`, {
        method: 'POST',
        headers: { 'x-api-key': originalKey },
      }),
      { id: networkId },
    );
    expect(before.id).toBe(networkId);

    // Rotate directly in the fixture: networkService.rotateMasterKey is Task 4's
    // rename and the old rotateExperimentMasterKey references dropped columns.
    const rotated = await generateMasterKey();
    const newKey = rotated.key;
    await db.update(schema.networks)
      .set({ masterKeyHash: rotated.hash })
      .where(eq(schema.networks.id, networkId));

    const after = await MasterKeyGuard(
      new Request(`http://localhost/networks/${networkId}/signup`, {
        method: 'POST',
        headers: { 'x-api-key': newKey },
      }),
      { id: networkId },
    );
    expect(after.id).toBe(networkId);

    let rejected: Response | null = null;
    try {
      await MasterKeyGuard(
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
