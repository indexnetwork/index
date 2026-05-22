/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq, and, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import db from '../../lib/drizzle/drizzle';
import {
  users,
  userProfiles,
  userSocials,
  networks,
  networkMembers,
  intents,
  opportunities,
} from '../../schemas/database.schema';
import { ProfileDatabaseAdapter } from '../database.adapter';

const TEST_PREFIX = 'ghost_dedup_spec_' + Date.now() + '_';
const adapter = new ProfileDatabaseAdapter();

interface TestIds {
  realUserId: string;
  ghostAId: string;
  ghostBId: string;
  ghostNoSocialsId: string;
  differentPersonId: string;
  mergeNetworkId: string;
  mergeGhostId: string;
  mergeTargetId: string;
}
let ids: TestIds;

beforeAll(async () => {
  ids = {
    realUserId: uuidv4(),
    ghostAId: uuidv4(),
    ghostBId: uuidv4(),
    ghostNoSocialsId: uuidv4(),
    differentPersonId: uuidv4(),
    mergeNetworkId: uuidv4(),
    mergeGhostId: uuidv4(),
    mergeTargetId: uuidv4(),
  };

  await db.insert(users).values([
    {
      id: ids.realUserId,
      email: TEST_PREFIX + 'real@index.network',
      name: 'Seref Yarar',
      isGhost: false,
      socials: { linkedin: 'serefyarar', github: 'serefyarar', x: 'hyperseref' },
    },
    {
      id: ids.ghostAId,
      email: TEST_PREFIX + 'ghost-a@index.as',
      name: 'Seref Yarar',
      isGhost: true,
      socials: { linkedin: 'serefyarar' },
    },
    {
      id: ids.ghostBId,
      email: TEST_PREFIX + 'ghost-b@gowit.dev',
      name: 'Serafettin Yarar',
      isGhost: true,
      socials: { github: 'serefyarar' },
    },
    {
      id: ids.ghostNoSocialsId,
      email: TEST_PREFIX + 'ghost-nosocials@test.com',
      name: 'Seref Yarar',
      isGhost: true,
      socials: null,
    },
    {
      id: ids.differentPersonId,
      email: TEST_PREFIX + 'different@nato.int',
      name: 'Seref Ozu',
      isGhost: true,
      socials: { linkedin: 'serefozu-b5b87322a' },
    },
    {
      id: ids.mergeTargetId,
      email: TEST_PREFIX + 'merge-target@index.network',
      name: 'Target User',
      isGhost: false,
    },
    {
      id: ids.mergeGhostId,
      email: TEST_PREFIX + 'merge-ghost@other.com',
      name: 'Ghost To Merge',
      isGhost: true,
    },
  ]);

  await db.insert(userSocials).values([
    { userId: ids.realUserId, label: 'linkedin', value: 'serefyarar' },
    { userId: ids.realUserId, label: 'github', value: 'serefyarar' },
    { userId: ids.realUserId, label: 'twitter', value: 'hyperseref' },
    { userId: ids.ghostAId, label: 'linkedin', value: 'serefyarar' },
    { userId: ids.ghostBId, label: 'github', value: 'serefyarar' },
    { userId: ids.differentPersonId, label: 'linkedin', value: 'serefozu-b5b87322a' },
  ]);

  await db.insert(userProfiles).values([
    {
      userId: ids.mergeTargetId,
      identity: { name: 'Target User', bio: 'target bio', location: 'NYC' },
      narrative: { context: 'target context' },
      attributes: { skills: ['a'], interests: ['b'] },
    },
    {
      userId: ids.mergeGhostId,
      identity: { name: 'Ghost', bio: 'ghost bio', location: 'LA' },
      narrative: { context: 'ghost context' },
      attributes: { skills: ['c'], interests: ['d'] },
    },
  ]);

  await db.insert(networks).values({
    id: ids.mergeNetworkId,
    title: TEST_PREFIX + 'Merge Test Network',
  });

  await db.insert(networkMembers).values({
    networkId: ids.mergeNetworkId,
    userId: ids.mergeGhostId,
    permissions: ['contact'],
  });
});

afterAll(async () => {
  const allIds = Object.values(ids).filter(Boolean);
  // Clean up in FK order
  await db.delete(networkMembers).where(
    eq(networkMembers.networkId, ids.mergeNetworkId),
  );
  await db.delete(networks).where(eq(networks.id, ids.mergeNetworkId));
  await db.delete(userProfiles).where(inArray(userProfiles.userId, allIds));
  await db.delete(users).where(inArray(users.id, allIds));
});

describe('ProfileDatabaseAdapter.findDuplicateUser', () => {
  it('matches by LinkedIn handle and prefers real user over ghost', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostAId, [{ id: 'fake-id-1', userId: ids.ghostAId, label: 'linkedin', value: 'serefyarar' }]);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ids.realUserId);
  });

  it('matches by GitHub handle', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostBId, [{ id: 'fake-id-2', userId: ids.ghostBId, label: 'github', value: 'serefyarar' }]);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ids.realUserId);
  });

  it('matches by X handle', async () => {
    const newGhostId = uuidv4();
    await db.insert(users).values({
      id: newGhostId,
      email: TEST_PREFIX + 'ghost-x@test.com',
      name: 'Seref X',
      isGhost: true,
    });
    try {
      const result = await adapter.findDuplicateUser(newGhostId, [{ id: 'fake-id-3', userId: newGhostId, label: 'twitter', value: 'hyperseref' }]);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(ids.realUserId);
    } finally {
      await db.delete(users).where(eq(users.id, newGhostId));
    }
  });

  it('is case-insensitive', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostAId, [{ id: 'fake-id-4', userId: ids.ghostAId, label: 'linkedin', value: 'SerefYarar' }]);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ids.realUserId);
  });

  it('does not match different social handles', async () => {
    const result = await adapter.findDuplicateUser(ids.differentPersonId, [{ id: 'fake-id-5', userId: ids.differentPersonId, label: 'linkedin', value: 'serefozu-b5b87322a' }]);
    expect(result).toBeNull();
  });

  it('returns null when no socials provided', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostNoSocialsId, []);
    expect(result).toBeNull();
  });

  it('excludes soft-deleted users from matching', async () => {
    const deletedId = uuidv4();
    await db.insert(users).values({
      id: deletedId,
      email: TEST_PREFIX + 'deleted@test.com',
      name: 'Deleted User',
      isGhost: true,
      socials: { linkedin: 'deleted-handle-unique' },
      deletedAt: new Date(),
    });
    try {
      const result = await adapter.findDuplicateUser(ids.ghostAId, [{ id: 'fake-id-6', userId: ids.ghostAId, label: 'linkedin', value: 'deleted-handle-unique' }]);
      expect(result).toBeNull();
    } finally {
      await db.delete(users).where(eq(users.id, deletedId));
    }
  });
});

describe('ProfileDatabaseAdapter.mergeGhostUser', () => {
  it('re-points network memberships and soft-deletes ghost', async () => {
    const ghostId = ids.mergeGhostId;
    const targetId = ids.mergeTargetId;
    const networkId = ids.mergeNetworkId;

    await adapter.mergeGhostUser(ghostId, targetId);

    // Ghost should be soft-deleted
    const [ghost] = await db.select({ deletedAt: users.deletedAt })
      .from(users).where(eq(users.id, ghostId));
    expect(ghost.deletedAt).not.toBeNull();

    // Ghost's profile should be deleted
    const ghostProfile = await db.select()
      .from(userProfiles).where(eq(userProfiles.userId, ghostId));
    expect(ghostProfile).toHaveLength(0);

    // Target's profile should still exist
    const targetProfile = await db.select()
      .from(userProfiles).where(eq(userProfiles.userId, targetId));
    expect(targetProfile).toHaveLength(1);

    // Membership should be re-pointed to target
    const membership = await db.select()
      .from(networkMembers)
      .where(and(
        eq(networkMembers.networkId, networkId),
        eq(networkMembers.userId, targetId),
      ));
    expect(membership).toHaveLength(1);
  });

  it('skips memberships where target already belongs to the network', async () => {
    const ghostId = uuidv4();
    const targetId = uuidv4();
    const netId = uuidv4();

    await db.insert(users).values([
      { id: ghostId, email: TEST_PREFIX + 'skip-ghost@test.com', name: 'G', isGhost: true },
      { id: targetId, email: TEST_PREFIX + 'skip-target@test.com', name: 'T', isGhost: false },
    ]);
    await db.insert(userProfiles).values({
      userId: ghostId,
      identity: { name: 'G', bio: '', location: '' },
      narrative: { context: '' },
      attributes: { skills: [], interests: [] },
    });
    await db.insert(networks).values({ id: netId, title: TEST_PREFIX + 'skip-net' });
    await db.insert(networkMembers).values([
      { networkId: netId, userId: ghostId, permissions: ['contact'] },
      { networkId: netId, userId: targetId, permissions: ['owner'] },
    ]);

    try {
      await adapter.mergeGhostUser(ghostId, targetId);

      // Ghost's membership should be soft-deleted (not re-pointed, since target already in network)
      const ghostMembership = await db.select()
        .from(networkMembers)
        .where(and(eq(networkMembers.networkId, netId), eq(networkMembers.userId, ghostId)));
      expect(ghostMembership).toHaveLength(1);
      expect(ghostMembership[0].deletedAt).not.toBeNull();

      // Target's membership should be unchanged
      const targetMembership = await db.select()
        .from(networkMembers)
        .where(and(eq(networkMembers.networkId, netId), eq(networkMembers.userId, targetId)));
      expect(targetMembership).toHaveLength(1);
      expect(targetMembership[0].permissions).toContain('owner');
    } finally {
      await db.delete(networkMembers).where(eq(networkMembers.networkId, netId));
      await db.delete(networks).where(eq(networks.id, netId));
      await db.delete(userProfiles).where(inArray(userProfiles.userId, [ghostId, targetId]));
      await db.delete(users).where(inArray(users.id, [ghostId, targetId]));
    }
  });

  it('re-points intents from ghost to target', async () => {
    const ghostId = uuidv4();
    const targetId = uuidv4();
    const intentId = uuidv4();

    await db.insert(users).values([
      { id: ghostId, email: TEST_PREFIX + 'intent-ghost@test.com', name: 'G', isGhost: true },
      { id: targetId, email: TEST_PREFIX + 'intent-target@test.com', name: 'T', isGhost: false },
    ]);
    await db.insert(userProfiles).values({
      userId: ghostId,
      identity: { name: 'G', bio: '', location: '' },
      narrative: { context: '' },
      attributes: { skills: [], interests: [] },
    });
    await db.insert(intents).values({
      id: intentId,
      userId: ghostId,
      payload: TEST_PREFIX + 'test intent',
    });

    try {
      await adapter.mergeGhostUser(ghostId, targetId);

      const [intent] = await db.select({ userId: intents.userId })
        .from(intents).where(eq(intents.id, intentId));
      expect(intent.userId).toBe(targetId);
    } finally {
      await db.delete(intents).where(eq(intents.id, intentId));
      await db.delete(userProfiles).where(inArray(userProfiles.userId, [ghostId, targetId]));
      await db.delete(users).where(inArray(users.id, [ghostId, targetId]));
    }
  });

  it('re-points opportunity actors JSONB from ghost to target', async () => {
    const ghostId = uuidv4();
    const targetId = uuidv4();
    const netId = uuidv4();
    const oppId = uuidv4();

    await db.insert(users).values([
      { id: ghostId, email: TEST_PREFIX + 'opp-ghost@test.com', name: 'G', isGhost: true },
      { id: targetId, email: TEST_PREFIX + 'opp-target@test.com', name: 'T', isGhost: false },
    ]);
    await db.insert(userProfiles).values({
      userId: ghostId,
      identity: { name: 'G', bio: '', location: '' },
      narrative: { context: '' },
      attributes: { skills: [], interests: [] },
    });
    await db.insert(networks).values({ id: netId, title: TEST_PREFIX + 'opp-net' });
    await db.insert(opportunities).values({
      id: oppId,
      actors: [
        { userId: ghostId, networkId: netId, role: 'seeker' },
        { userId: targetId, networkId: netId, role: 'provider' },
      ],
      detection: { source: 'enrichment', timestamp: new Date().toISOString(), createdBy: ghostId },
      interpretation: { category: 'test', reasoning: 'test', confidence: 0.9 },
      context: { networkId: netId },
      confidence: '0.9',
    });

    try {
      await adapter.mergeGhostUser(ghostId, targetId);

      const [opp] = await db.select({ actors: opportunities.actors, detection: opportunities.detection })
        .from(opportunities).where(eq(opportunities.id, oppId));
      const actors = opp.actors as { userId: string }[];
      const ghostActors = actors.filter(a => a.userId === ghostId);
      expect(ghostActors).toHaveLength(0);
      const targetActors = actors.filter(a => a.userId === targetId);
      expect(targetActors.length).toBeGreaterThanOrEqual(1);

      const detection = opp.detection as { createdBy?: string };
      expect(detection.createdBy).toBe(targetId);
    } finally {
      await db.delete(opportunities).where(eq(opportunities.id, oppId));
      await db.delete(networks).where(eq(networks.id, netId));
      await db.delete(userProfiles).where(inArray(userProfiles.userId, [ghostId, targetId]));
      await db.delete(users).where(inArray(users.id, [ghostId, targetId]));
    }
  });
});
