import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { experimentService } from '../src/services/experiment.service';
import { AuthController } from '../src/controllers/auth.controller';
import { AuthOrApiKeyGuard } from '../src/guards/auth.guard';
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
      title: `Auth Me API Key Test ${randomUUID().slice(0, 6)}`,
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

describe('AuthController.me() — API key support (Phase 1 guard swap)', () => {
  let controller: AuthController;
  let testUserId: string;
  let testApiKey: string;

  beforeAll(async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `auth-me-apikey-${randomUUID()}@test.example.com`;
    const result = await experimentService.signup(networkId, { email });
    testUserId = result.user.id;
    testApiKey = result.apiKey;
    cleanup.push(() => cleanupUser(testUserId));
    controller = new AuthController();
  });

  it('returns user identity and socials when called with a valid API key', async () => {
    const user = await AuthOrApiKeyGuard(
      new Request('http://localhost/api/auth/me', { headers: { 'x-api-key': testApiKey } }),
    );

    const response = await controller.me(
      new Request('http://localhost/api/auth/me'),
      user,
    );

    expect(response.status).toBe(200);
    const json = await response.json() as {
      user: { id: string; email: string | null; name: string; socials: unknown[] };
    };
    expect(json.user.id).toBe(testUserId);
    expect(json.user.email).toBeTruthy();
    expect(Array.isArray(json.user.socials)).toBe(true);
  }, 10000);

  it('two different API keys resolve to two different users — no cross-resolution', async () => {
    const { networkId: netId2 } = await setupExperimentNetwork();
    const email2 = `auth-me-apikey-other-${randomUUID()}@test.example.com`;
    const result2 = await experimentService.signup(netId2, { email: email2 });
    cleanup.push(() => cleanupUser(result2.user.id));

    const user1 = await AuthOrApiKeyGuard(
      new Request('http://localhost/api/auth/me', { headers: { 'x-api-key': testApiKey } }),
    );
    const user2 = await AuthOrApiKeyGuard(
      new Request('http://localhost/api/auth/me', { headers: { 'x-api-key': result2.apiKey } }),
    );

    expect(user1.id).toBe(testUserId);
    expect(user2.id).toBe(result2.user.id);
    expect(user1.id).not.toBe(user2.id);
  }, 10000);

  it('throws when an invalid API key is supplied', async () => {
    await expect(
      AuthOrApiKeyGuard(
        new Request('http://localhost/api/auth/me', { headers: { 'x-api-key': 'invalid-key-xyz' } }),
      ),
    ).rejects.toThrow();
  });

  it('throws when no authentication is provided', async () => {
    await expect(
      AuthOrApiKeyGuard(new Request('http://localhost/api/auth/me')),
    ).rejects.toThrow();
  });
});
