import '../src/startup.env';

import { afterAll as bunAfterAll, describe, expect, it as bunIt, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { ExperimentService, SignupNotCompleteError } from '../src/services/experiment.service';
import db from '../src/lib/drizzle/drizzle';
import { agentPermissions, agents, apikeys, networkMembers, networks, personalNetworks, userSocials, users } from '../src/schemas/database.schema';
import { generateMasterKey } from '../src/lib/experiment/master-key';
import { NetworkController } from '../src/controllers/network.controller';
import { withMinimumDatabaseHookBudget, withMinimumDatabaseTestBudget } from '../src/lib/testing/database-test-budget';

const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 120_000);
const it = withMinimumDatabaseTestBudget(bunIt, 30_000);
const experimentService = new ExperimentService({
  addEnrichUserJob: mock(async () => ({})),
  addEnrichUserJobBulk: mock(async () => []),
});

const cleanup: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const f of [...cleanup].reverse()) await f();
}, 60_000);

async function setupMasterKeyNetwork() {
  const [network] = await db
    .insert(networks)
    .values({
      title: `Master-Key Lookup Test ${randomUUID().slice(0, 6)}`,
      isPersonal: false,
      masterKeyHash: 'test-hash-not-verified-at-service-layer',
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

describe('experimentService.lookupSignup', () => {
  it('returns user when fully provisioned', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `lookup-ok-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const result = await experimentService.lookupSignup(networkId, email);

    expect(result.user.id).toBe(signedUp.user.id);
    expect(result.user.email).toBe(email);
  }, 15_000);

  it('is idempotent: does not rotate the user key', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `lookup-idem-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const before = await db
      .select({ id: apikeys.id, createdAt: apikeys.createdAt })
      .from(apikeys)
      .where(eq(apikeys.userId, signedUp.user.id));

    await experimentService.lookupSignup(networkId, email);
    await experimentService.lookupSignup(networkId, email);
    await experimentService.lookupSignup(networkId, email);

    const after = await db
      .select({ id: apikeys.id, createdAt: apikeys.createdAt })
      .from(apikeys)
      .where(eq(apikeys.userId, signedUp.user.id));

    expect(after.length).toBe(before.length);
    expect(after.map(r => r.id).sort()).toEqual(before.map(r => r.id).sort());
  }, 15_000);

  it('throws SignupNotCompleteError when email is unknown', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `lookup-missing-${randomUUID()}@example.com`;

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when user is soft-deleted', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `lookup-softdel-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, signedUp.user.id));

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when membership is missing', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const { networkId: otherNetworkId } = await setupMasterKeyNetwork();
    const email = `lookup-nomember-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(otherNetworkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    // User signed up to otherNetworkId, not networkId — has no membership in networkId.
    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when membership is soft-deleted', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `lookup-memsoftdel-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    await db
      .update(networkMembers)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(networkMembers.networkId, networkId),
        eq(networkMembers.userId, signedUp.user.id),
      ));

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when scoped agent is missing', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `lookup-noagent-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    // Drop the scoped agent permission so the membership exists but no scoped agent does.
    await db
      .delete(agentPermissions)
      .where(and(
        eq(agentPermissions.userId, signedUp.user.id),
        eq(agentPermissions.scope, 'network'),
        eq(agentPermissions.scopeId, networkId),
      ));

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when scoped agent is soft-deleted', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `lookup-agentsoftdel-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    // Soft-delete the agent linked to the permission row.
    await db
      .update(agents)
      .set({ deletedAt: new Date() })
      .where(eq(agents.ownerId, signedUp.user.id));

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('normalizes the email (case + whitespace) before lookup', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const email = `lookup-norm-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const result = await experimentService.lookupSignup(networkId, `  ${email.toUpperCase()}  `);

    expect(result.user.id).toBe(signedUp.user.id);
  }, 15_000);

  it('finds user via case-insensitive email lookup (legacy mixed-case rows)', async () => {
    const { networkId } = await setupMasterKeyNetwork();
    const localPart = `lookup-legacy-${randomUUID()}`;
    const lowercaseEmail = `${localPart}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email: lowercaseEmail });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    // Simulate a legacy row written before email normalization existed: the
    // user is stored with mixed-case email but everything else (membership,
    // scoped agent) is unchanged.
    const mixedCaseEmail = `${localPart}@EXAMPLE.com`;
    await db.update(users).set({ email: mixedCaseEmail }).where(eq(users.id, signedUp.user.id));

    const result = await experimentService.lookupSignup(networkId, lowercaseEmail);

    expect(result.user.id).toBe(signedUp.user.id);
    expect(result.user.email).toBe(mixedCaseEmail);
  }, 15_000);
});

async function setupMasterKeyNetworkWithKey() {
  const { key, hash } = await generateMasterKey();

  const [network] = await db
    .insert(networks)
    .values({
      title: `Master-Key Lookup HTTP ${randomUUID().slice(0, 6)}`,
      isPersonal: false,
      masterKeyHash: hash,
    })
    .returning({ id: networks.id });

  cleanup.push(async () => {
    await db.delete(networkMembers).where(eq(networkMembers.networkId, network.id));
    await db.delete(networks).where(eq(networks.id, network.id));
  });

  return { networkId: network.id, masterKey: key };
}

function buildLookupRequest(networkId: string, masterKey: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (masterKey !== null) headers['x-api-key'] = masterKey;
  return new Request(`http://localhost/api/networks/${networkId}/signup/lookup`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('NetworkController.signupLookup', () => {
  const controller = new NetworkController();

  it('returns 200 with the user when fully provisioned', async () => {
    const { networkId, masterKey } = await setupMasterKeyNetworkWithKey();
    const email = `http-ok-${randomUUID()}@example.com`;
    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, { email }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { user: { id: string; email: string } };
    expect(body.user.id).toBe(signedUp.user.id);
    expect(body.user.email).toBe(email);
  }, 15_000);

  it('returns 409 when the email is unknown', async () => {
    const { networkId, masterKey } = await setupMasterKeyNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, { email: `missing-${randomUUID()}@example.com` }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('User has not completed signup for this network');
  }, 15_000);

  it('returns 409 when membership is missing in this network', async () => {
    const { networkId, masterKey } = await setupMasterKeyNetworkWithKey();
    const { networkId: otherNetworkId } = await setupMasterKeyNetworkWithKey();
    const email = `http-othermember-${randomUUID()}@example.com`;
    const signedUp = await experimentService.signup(otherNetworkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, { email }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(409);
  }, 15_000);

  it('normalizes the email (case + whitespace) at the controller boundary', async () => {
    const { networkId, masterKey } = await setupMasterKeyNetworkWithKey();
    const email = `http-norm-${randomUUID()}@example.com`;
    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, { email: `  ${email.toUpperCase()}  ` }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { user: { id: string; email: string } };
    expect(body.user.id).toBe(signedUp.user.id);
  }, 15_000);

  it('returns 400 when email is whitespace-only', async () => {
    const { networkId, masterKey } = await setupMasterKeyNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, { email: '   ' }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('email is required');
  }, 15_000);

  it('returns 400 when body is missing email', async () => {
    const { networkId, masterKey } = await setupMasterKeyNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, {}),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('email is required');
  }, 15_000);

  it('returns 400 when email is malformed', async () => {
    const { networkId, masterKey } = await setupMasterKeyNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, { email: 'not-an-email' }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Invalid email format');
  }, 15_000);

  it('returns 400 when body is unparseable JSON', async () => {
    const { networkId, masterKey } = await setupMasterKeyNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, 'not-json'),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(400);
  }, 15_000);

  it('returns 401 when x-api-key header is missing', async () => {
    const { networkId } = await setupMasterKeyNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, null, { email: `noauth-${randomUUID()}@example.com` }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(401);
  }, 15_000);

  it('returns 403 when master key is wrong', async () => {
    const { networkId } = await setupMasterKeyNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, 'wrong-key-' + randomUUID(), { email: `badauth-${randomUUID()}@example.com` }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(403);
  }, 15_000);

  it('returns 403 when the network has no master key', async () => {
    const [plain] = await db
      .insert(networks)
      .values({
        title: `Plain network ${randomUUID().slice(0, 6)}`,
        isPersonal: false,
      })
      .returning({ id: networks.id });
    cleanup.push(() => db.delete(networks).where(eq(networks.id, plain.id)).then(() => undefined));

    const { masterKey } = await setupMasterKeyNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(plain.id, masterKey, { email: `plain-${randomUUID()}@example.com` }),
      null,
      { id: plain.id },
    );

    expect(res.status).toBe(403);
  }, 15_000);
});
