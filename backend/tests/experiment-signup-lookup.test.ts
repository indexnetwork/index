import '../src/startup.env';

import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { experimentService, SignupNotCompleteError } from '../src/services/experiment.service';
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
      title: `EdgeClaw Lookup Test ${randomUUID().slice(0, 6)}`,
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

describe('experimentService.lookupSignup', () => {
  it('returns user when fully provisioned', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-ok-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const result = await experimentService.lookupSignup(networkId, email);

    expect(result.user.id).toBe(signedUp.user.id);
    expect(result.user.email).toBe(email);
  }, 15_000);

  it('is idempotent: does not rotate the user key', async () => {
    const { networkId } = await setupExperimentNetwork();
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
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-missing-${randomUUID()}@example.com`;

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when user is soft-deleted', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-softdel-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, signedUp.user.id));

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when membership is missing', async () => {
    const { networkId } = await setupExperimentNetwork();
    const { networkId: otherNetworkId } = await setupExperimentNetwork();
    const email = `lookup-nomember-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(otherNetworkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    // User signed up to otherNetworkId, not networkId — has no membership in networkId.
    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when membership is soft-deleted', async () => {
    const { networkId } = await setupExperimentNetwork();
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
    const { networkId } = await setupExperimentNetwork();
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
    const { networkId } = await setupExperimentNetwork();
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
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-norm-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const result = await experimentService.lookupSignup(networkId, `  ${email.toUpperCase()}  `);

    expect(result.user.id).toBe(signedUp.user.id);
  }, 15_000);
});
