import '../src/startup.env';

import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

import { ExperimentService } from '../src/services/experiment.service';
import { AuthGuard } from '../src/guards/auth.guard';
import db from '../src/lib/drizzle/drizzle';
import { agentPermissions, agents, networkMembers, networks, personalNetworks, users } from '../src/schemas/database.schema';

const experimentService = new ExperimentService();

const fixtureUserIds = new Set<string>();
const fixtureNetworkIds = new Set<string>();

async function cleanupFixtures(): Promise<void> {
  const userIds = [...fixtureUserIds];
  const networkIds = [...fixtureNetworkIds];
  const personal = userIds.length > 0
    ? await db.select({ networkId: personalNetworks.networkId })
      .from(personalNetworks)
      .where(inArray(personalNetworks.userId, userIds))
    : [];
  const allNetworkIds = [...new Set([...networkIds, ...personal.map((row) => row.networkId)])];

  if (userIds.length > 0 || allNetworkIds.length > 0) {
    const conditions = [];
    if (userIds.length > 0) conditions.push(inArray(networkMembers.userId, userIds));
    if (allNetworkIds.length > 0) conditions.push(inArray(networkMembers.networkId, allNetworkIds));
    await db.delete(networkMembers).where(conditions.length === 1 ? conditions[0] : or(...conditions));
  }
  if (userIds.length > 0) {
    await db.delete(personalNetworks).where(inArray(personalNetworks.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  if (allNetworkIds.length > 0) await db.delete(networks).where(inArray(networks.id, allNetworkIds));

  fixtureUserIds.clear();
  fixtureNetworkIds.clear();
}

afterAll(cleanupFixtures, 30_000);

async function setupMasterKeyNetwork(): Promise<{ networkId: string }> {
  const [network] = await db
    .insert(networks)
    .values({
      title: `Master-Key Signup Test ${randomUUID().slice(0, 6)}`,
      isPersonal: false,
      masterKeyHash: 'test-hash-not-verified-at-service-layer',
    })
    .returning({ id: networks.id });
  fixtureNetworkIds.add(network.id);
  return { networkId: network.id };
}

describe('experimentService.signup', () => {
  it('creates a new user and returns apiKey + mcpServer with minimal payload', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `minimal-${randomUUID()}@example.com`;

    const result = await experimentService.signup(networkId, { email });
    fixtureUserIds.add(result.user.id);

    expect(result.user.email).toBe(email);
    expect(result.apiKey).toBeTruthy();
    expect(result.mcpServer).toMatchObject({
      name: 'index',
      url: expect.stringContaining('/mcp'),
      headers: { 'x-api-key': result.apiKey },
    });
    expect(result.created).toBe(true);
  }, 15_000);

  it('stages name, bio, location, and socials from rich payload for onboarding', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `rich-${randomUUID()}@example.com`;

    const result = await experimentService.signup(networkId, {
      email,
      name: 'Alice Test',
      bio: 'Independent researcher.',
      location: 'Healdsburg, CA',
      socials: [
        { label: 'telegram', value: '@alice_test' },
        { label: 'twitter', value: 'alice_test' },
      ],
    });
    fixtureUserIds.add(result.user.id);

    const [user] = await db
      .select({ name: users.name, onboarding: users.onboarding })
      .from(users)
      .where(eq(users.id, result.user.id));
    expect(user.name).toBe('Alice Test');
    expect(user.onboarding.profileSeeds?.find(
      (item) => item.networkId === networkId && item.source === 'experiment_signup',
    )).toMatchObject({
      name: 'Alice Test',
      bio: 'Independent researcher.',
      location: 'Healdsburg, CA',
      socials: [
        { label: 'telegram', value: '@alice_test' },
        { label: 'twitter', value: 'alice_test' },
      ],
    });
  }, 15_000);

  it('re-signup mints a new key on the same agent without revoking the old key', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `resig-${randomUUID()}@example.com`;

    const first = await experimentService.signup(networkId, { email });
    fixtureUserIds.add(first.user.id);
    const second = await experimentService.signup(networkId, { email });

    expect(second.apiKey).not.toBe(first.apiKey);

    const scopedAgents = await db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(agentPermissions, eq(agentPermissions.agentId, agents.id))
      .where(and(
        eq(agentPermissions.userId, first.user.id),
        eq(agentPermissions.scope, 'network'),
        eq(agentPermissions.scopeId, networkId),
        isNull(agents.deletedAt),
      ));
    expect(scopedAgents).toHaveLength(1);

    const firstAuth = await AuthGuard(new Request('http://localhost/test', {
      headers: { 'x-api-key': first.apiKey },
    }));
    const secondAuth = await AuthGuard(new Request('http://localhost/test', {
      headers: { 'x-api-key': second.apiKey },
    }));
    expect(firstAuth.id).toBe(first.user.id);
    expect(secondAuth.id).toBe(first.user.id);
  }, 15_000);

  it('returns created=false for an existing user', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `existing-${randomUUID()}@example.com`;

    const first = await experimentService.signup(networkId, { email });
    fixtureUserIds.add(first.user.id);
    const second = await experimentService.signup(networkId, { email });

    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  }, 15_000);
});
