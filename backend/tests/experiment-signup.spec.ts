import '../src/startup.env';

import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';

import { experimentService } from '../src/services/experiment.service';
import db from '../src/lib/drizzle/drizzle';
import {
  agentPermissions,
  agents,
  apikeys,
  networkMembers,
  networks,
  personalNetworks,
  userProfiles,
  userSocials,
  users,
} from '../src/schemas/database.schema';

const cleanup: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const f of [...cleanup].reverse()) await f();
});

async function setupExperimentNetwork() {
  const [network] = await db
    .insert(networks)
    .values({
      title: `EdgeClaw Test ${randomUUID().slice(0, 6)}`,
      isExperiment: true,
      isPersonal: false,
      experimentMasterKeyHash: 'test-hash-not-verified-at-service-layer',
    })
    .returning({ id: networks.id });

  cleanup.push(async () => {
    await db.delete(networkMembers).where(eq(networkMembers.networkId, network.id));
    await db.delete(networks).where(eq(networks.id, network.id));
  });

  return { networkId: network.id };
}

async function cleanupUser(userId: string) {
  await db.delete(apikeys).where(eq(apikeys.userId, userId));
  await db.delete(agentPermissions).where(eq(agentPermissions.userId, userId));
  await db.delete(agents).where(eq(agents.ownerId, userId));
  await db.delete(networkMembers).where(eq(networkMembers.userId, userId));
  await db.delete(userSocials).where(eq(userSocials.userId, userId));
  await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  const pn = await db
    .select({ networkId: personalNetworks.networkId })
    .from(personalNetworks)
    .where(eq(personalNetworks.userId, userId));
  await db.delete(personalNetworks).where(eq(personalNetworks.userId, userId));
  for (const { networkId: pnId } of pn) {
    await db.delete(networks).where(eq(networks.id, pnId));
  }
  await db.delete(users).where(eq(users.id, userId));
}

describe('experimentService.signup', () => {
  it('creates a new user and returns apiKey + mcpServer with minimal payload', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `minimal-${randomUUID()}@example.com`;

    const result = await experimentService.signup(networkId, { email });

    cleanup.push(() => cleanupUser(result.user.id));

    expect(result.user.email).toBe(email);
    expect(result.apiKey).toBeTruthy();
    expect(result.mcpServer).toMatchObject({
      name: 'index',
      url: expect.stringContaining('/mcp'),
      headers: { 'x-api-key': result.apiKey },
    });
    expect(result.created).toBe(true);
  }, 15_000);

  it('stores name, bio, location, and socials from rich payload', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `rich-${randomUUID()}@example.com`;

    const result = await experimentService.signup(networkId, {
      email,
      name: 'Alice Test',
      bio: 'Independent researcher.',
      location: 'Healdsburg, CA',
      socials: [
        { label: 'telegram', value: '@alice_test' },
        { label: 'twitter',  value: 'alice_test' },
      ],
    });

    cleanup.push(() => cleanupUser(result.user.id));

    const [u] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, result.user.id));
    expect(u.name).toBe('Alice Test');

    const [profile] = await db
      .select({ identity: userProfiles.identity })
      .from(userProfiles)
      .where(eq(userProfiles.userId, result.user.id));
    expect((profile.identity as { bio?: string }).bio).toBe('Independent researcher.');
    expect((profile.identity as { location?: string }).location).toBe('Healdsburg, CA');

    const socials = await db
      .select({ label: userSocials.label, value: userSocials.value })
      .from(userSocials)
      .where(eq(userSocials.userId, result.user.id));
    expect(socials).toContainEqual({ label: 'telegram', value: '@alice_test' });
    expect(socials).toContainEqual({ label: 'twitter',  value: 'alice_test' });
  }, 15_000);

  it('re-signup rotates the key on the SAME agent — no orphan agent records', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `resig-${randomUUID()}@example.com`;

    const first = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(first.user.id));

    const second = await experimentService.signup(networkId, { email });

    expect(second.apiKey).not.toBe(first.apiKey);

    const scopedAgents = await db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(agentPermissions, eq(agentPermissions.agentId, agents.id))
      .where(
        and(
          eq(agentPermissions.userId, first.user.id),
          eq(agentPermissions.scope, 'network'),
          eq(agentPermissions.scopeId, networkId),
          isNull(agents.deletedAt),
        ),
      );
    expect(scopedAgents.length).toBe(1);

    const oldKeyRow = await db
      .select({ id: apikeys.id })
      .from(apikeys)
      .where(and(eq(apikeys.userId, first.user.id), eq(apikeys.start, first.apiKey.slice(0, 4))));
    expect(oldKeyRow.length).toBe(0);
  }, 15_000);

  it('returns created=false for an existing user', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `existing-${randomUUID()}@example.com`;

    const first = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(first.user.id));

    const second = await experimentService.signup(networkId, { email });

    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  }, 15_000);
});
