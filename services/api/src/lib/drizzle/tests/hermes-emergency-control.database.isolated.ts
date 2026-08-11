import { afterAll, beforeAll, beforeEach, describe, expect, it as bunIt } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { executeEmergencyControl, executeEmergencyControlWithTestHooks, planEmergencyControl, planEmergencyControlWithTestHooks } from '../../../cli/hermes-emergency-control';
import { HERMES_CANONICAL_ACTIONS } from '../../agent/hermes-capabilities';
import { withMinimumDatabaseTestBudget } from '../../testing/database-test-budget';
import * as schema from '../../../schemas/database.schema';
import db from '../drizzle';

const it = withMinimumDatabaseTestBudget(bunIt, 90_000);
const fixture = `emergency_${randomUUID().replace(/-/g, '')}`;
const ownerId = `${fixture}_owner`;
const otherOwnerId = `${fixture}_other_owner`;
const firstAgentId = `${fixture}_hermes_a`;
const secondAgentId = `${fixture}_hermes_b`;
const inactiveAgentId = `${fixture}_hermes_inactive`;
const indexAgentId = `${fixture}_index`;
const otherAgentId = `${fixture}_other_agent`;
const issuedAt = new Date('2026-08-09T00:00:00.000Z');
const expiresAt = new Date(issuedAt.getTime() + 2_592_000_000);
const receiptPlanIds = new Set<string>();

const permissionIds = [
  `${fixture}_permission_canonical`,
  `${fixture}_permission_only_negotiation`,
  `${fixture}_permission_mixed`,
  `${fixture}_permission_empty`,
  `${fixture}_permission_unrelated_hermes`,
  `${fixture}_permission_other_agent`,
  `${fixture}_permission_concurrent_insert`,
] as const;
const credentialIds = [
  `${fixture}_credential_a`, `${fixture}_credential_b`, `${fixture}_credential_revoked`,
] as const;
const agentIds = [firstAgentId, secondAgentId, inactiveAgentId, indexAgentId, otherAgentId] as const;
const userIds = [ownerId, otherOwnerId] as const;

function assertDedicatedAssuranceGuard(): void {
  if (process.env.TEST_DATABASE_SAFE !== '1') throw new Error('Hermes emergency suite requires TEST_DATABASE_SAFE=1');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Hermes emergency suite requires DATABASE_URL');
  let databaseName = '';
  try { databaseName = new URL(databaseUrl).pathname.replace(/^\//, ''); } catch { /* fail below */ }
  if (databaseName !== 'hermes_assurance') {
    throw new Error('Hermes emergency suite requires the exact hermes_assurance database');
  }
}

async function cleanup(): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (operation: () => Promise<unknown>): Promise<void> => {
    try { await operation(); } catch (error) { errors.push(error); }
  };
  const trackedPlans = [...receiptPlanIds];
  if (trackedPlans.length > 0) {
    await attempt(() => db.delete(schema.hermesEmergencyReceipts)
      .where(inArray(schema.hermesEmergencyReceipts.planId, trackedPlans)));
  }
  await attempt(() => db.delete(schema.agentPermissions).where(inArray(schema.agentPermissions.id, permissionIds)));
  await attempt(() => db.delete(schema.hermesAgentCredentials).where(inArray(schema.hermesAgentCredentials.id, credentialIds)));
  await attempt(() => db.delete(schema.agents).where(inArray(schema.agents.id, agentIds)));
  await attempt(() => db.delete(schema.users).where(inArray(schema.users.id, userIds)));
  await attempt(async () => {
    const counts = await Promise.all([
      trackedPlans.length > 0
        ? db.$count(schema.hermesEmergencyReceipts, inArray(schema.hermesEmergencyReceipts.planId, trackedPlans))
        : Promise.resolve(0),
      db.$count(schema.agentPermissions, inArray(schema.agentPermissions.id, permissionIds)),
      db.$count(schema.hermesAgentCredentials, inArray(schema.hermesAgentCredentials.id, credentialIds)),
      db.$count(schema.agents, inArray(schema.agents.id, agentIds)),
      db.$count(schema.users, inArray(schema.users.id, userIds)),
    ]);
    if (counts.some((count) => Number(count) !== 0)) throw new Error('Hermes emergency fixture rows remain');
  });
  receiptPlanIds.clear();
  if (errors.length > 0) throw new AggregateError(errors, 'Hermes emergency fixture cleanup failed');
}

async function seed(): Promise<void> {
  await db.insert(schema.users).values([
    { id: ownerId, email: `${fixture}@test.local`, name: 'Emergency fixture owner' },
    { id: otherOwnerId, email: `${fixture}_other@test.local`, name: 'Emergency fixture other owner' },
  ]);
  await db.insert(schema.agents).values([
    {
      id: firstAgentId, ownerId, name: 'Hermes A', type: 'external', status: 'active',
      runtimeKind: 'hermes', installationId: `${fixture}_install_a`,
      runtimeSetupAttemptId: `${fixture}_generation_a`, handleNegotiations: true,
    },
    {
      id: secondAgentId, ownerId, name: 'Hermes B', type: 'external', status: 'active',
      runtimeKind: 'hermes', installationId: `${fixture}_install_b`,
      runtimeSetupAttemptId: `${fixture}_generation_b`, handleNegotiations: false,
    },
    {
      id: inactiveAgentId, ownerId, name: 'Inactive Hermes', type: 'external', status: 'inactive',
      runtimeKind: 'hermes', installationId: `${fixture}_install_inactive`,
      runtimeSetupAttemptId: null, handleNegotiations: false,
    },
    {
      id: indexAgentId, ownerId, name: 'Index personal runtime', type: 'personal', status: 'active',
      handleNegotiations: false,
    },
    {
      id: otherAgentId, ownerId: otherOwnerId, name: 'Unrelated external runtime', type: 'external', status: 'active',
      handleNegotiations: false,
    },
  ]);
  await db.insert(schema.hermesAgentCredentials).values([
    {
      id: credentialIds[0], secretHash: `${fixture}_digest_a`, ownerId, agentId: firstAgentId,
      installationId: `${fixture}_install_a`, setupAttemptId: `${fixture}_generation_a`,
      audience: 'hermes-agent', actions: [...HERMES_CANONICAL_ACTIONS], activationState: 'active',
      issuedAt, expiresAt, activatedAt: issuedAt,
    },
    {
      id: credentialIds[1], secretHash: `${fixture}_digest_b`, ownerId, agentId: secondAgentId,
      installationId: `${fixture}_install_b`, setupAttemptId: `${fixture}_generation_b`,
      audience: 'hermes-agent', actions: [...HERMES_CANONICAL_ACTIONS], activationState: 'pending',
      issuedAt, expiresAt,
    },
    {
      id: credentialIds[2], secretHash: `${fixture}_digest_revoked`, ownerId, agentId: inactiveAgentId,
      installationId: `${fixture}_install_inactive`, setupAttemptId: `${fixture}_generation_revoked`,
      audience: 'hermes-agent', actions: [...HERMES_CANONICAL_ACTIONS], activationState: 'revoked',
      issuedAt, expiresAt, revokedAt: issuedAt,
    },
  ]);
  await db.insert(schema.agentPermissions).values([
    {
      id: permissionIds[0], agentId: firstAgentId, userId: ownerId,
      scope: 'global', actions: [...HERMES_CANONICAL_ACTIONS],
    },
    {
      id: permissionIds[1], agentId: secondAgentId, userId: ownerId,
      scope: 'network', scopeId: `${fixture}_network_only`, actions: ['manage:negotiations'],
    },
    {
      id: permissionIds[2], agentId: secondAgentId, userId: ownerId,
      scope: 'network', scopeId: `${fixture}_network_mixed`, actions: ['unrelated:mixed', 'manage:negotiations'],
    },
    {
      id: permissionIds[3], agentId: inactiveAgentId, userId: ownerId,
      scope: 'network', scopeId: `${fixture}_network_empty`, actions: [],
    },
    {
      id: permissionIds[4], agentId: inactiveAgentId, userId: ownerId,
      scope: 'network', scopeId: `${fixture}_network_unrelated`, actions: ['unrelated:keep'],
    },
    {
      id: permissionIds[5], agentId: otherAgentId, userId: otherOwnerId,
      scope: 'global', actions: ['manage:negotiations', 'unrelated:other'],
    },
  ]);
}

async function rememberPlan(): Promise<Awaited<ReturnType<typeof planEmergencyControl>>> {
  const plan = await planEmergencyControl(db, { audience: 'hermes-agent' });
  receiptPlanIds.add(plan.planId);
  return plan;
}

async function assertOriginalMutationState(): Promise<void> {
  const agents = await db.select().from(schema.agents).where(inArray(schema.agents.id, [firstAgentId, secondAgentId]));
  expect(agents).toHaveLength(2);
  expect(agents.every((row) => row.status === 'active' && row.runtimeSetupAttemptId !== null)).toBe(true);
  expect(agents.find((row) => row.id === firstAgentId)!.handleNegotiations).toBe(true);
  expect(await db.$count(schema.hermesAgentCredentials,
    and(inArray(schema.hermesAgentCredentials.id, credentialIds), inArray(schema.hermesAgentCredentials.activationState, ['pending', 'active'])))).toBe(2);
  const permissionRows = await db.select().from(schema.agentPermissions)
    .where(inArray(schema.agentPermissions.id, permissionIds.slice(0, 6)));
  expect(permissionRows).toHaveLength(6);
  expect(permissionRows.find((row) => row.id === permissionIds[0])!.actions).toEqual([...HERMES_CANONICAL_ACTIONS]);
  expect(permissionRows.find((row) => row.id === permissionIds[1])!.actions).toEqual(['manage:negotiations']);
  expect(permissionRows.find((row) => row.id === permissionIds[2])!.actions).toEqual(['unrelated:mixed', 'manage:negotiations']);
  expect(permissionRows.find((row) => row.id === permissionIds[3])!.actions).toEqual([]);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeAll(assertDedicatedAssuranceGuard);
beforeEach(async () => {
  await cleanup();
  await seed();
});
afterAll(cleanup);

describe('Hermes emergency control on dedicated PostgreSQL', () => {
  it('mutates only locked-snapshot permissions and preserves empty/unrelated rows', async () => {
    const plan = await rememberPlan();
    expect(plan).toMatchObject({ installations: 2, credentials: 2, permissions: 3, owners: 1 });

    const receipt = await executeEmergencyControl(db, {
      planId: plan.planId, expectedInstallations: plan.installations, confirm: true,
    });
    expect(receipt).toMatchObject({
      reason: 'executed', selectedPaused: 2, credentialsRevoked: 2,
      permissionsRemoved: 3, installationsDisconnected: 2, auditReceipts: 1,
    });

    const permissions = await db.select().from(schema.agentPermissions)
      .where(inArray(schema.agentPermissions.id, permissionIds.slice(0, 6)));
    expect(permissions.find((row) => row.id === permissionIds[0])!.actions)
      .toEqual(HERMES_CANONICAL_ACTIONS.filter((action) => action !== 'manage:negotiations'));
    expect(permissions.some((row) => row.id === permissionIds[1])).toBe(false);
    expect(permissions.find((row) => row.id === permissionIds[2])!.actions).toEqual(['unrelated:mixed']);
    expect(permissions.find((row) => row.id === permissionIds[3])!.actions).toEqual([]);
    expect(permissions.find((row) => row.id === permissionIds[4])!.actions).toEqual(['unrelated:keep']);
    expect(permissions.find((row) => row.id === permissionIds[5])!.actions)
      .toEqual(['manage:negotiations', 'unrelated:other']);

    const [inactiveAgent] = await db.select().from(schema.agents).where(eq(schema.agents.id, inactiveAgentId));
    expect(inactiveAgent).toMatchObject({ status: 'inactive', runtimeSetupAttemptId: null });
    const [alreadyRevoked] = await db.select().from(schema.hermesAgentCredentials)
      .where(eq(schema.hermesAgentCredentials.id, credentialIds[2]));
    expect(alreadyRevoked).toMatchObject({ activationState: 'revoked', revokedAt: issuedAt });
  });

  it('keeps count mismatch mutation-free and exact rerun idempotent', async () => {
    const plan = await rememberPlan();
    await expect(executeEmergencyControl(db, {
      planId: plan.planId, expectedInstallations: plan.installations + 1, confirm: true,
    })).rejects.toThrow('expected count mismatch');
    await assertOriginalMutationState();
    expect(await db.$count(schema.hermesEmergencyReceipts, eq(schema.hermesEmergencyReceipts.planId, plan.planId))).toBe(0);

    const receipt = await executeEmergencyControl(db, {
      planId: plan.planId, expectedInstallations: plan.installations, confirm: true,
    });
    const rerun = await executeEmergencyControl(db, {
      planId: plan.planId, expectedInstallations: plan.installations, confirm: true,
    });
    expect(rerun).toMatchObject({
      receiptId: receipt.receiptId, reason: 'already-executed', selectedPaused: 0,
      credentialsRevoked: 0, permissionsRemoved: 0, installationsDisconnected: 0, auditReceipts: 0,
    });
    expect(await db.$count(schema.hermesEmergencyReceipts, eq(schema.hermesEmergencyReceipts.planId, plan.planId))).toBe(1);
  });

  it('serializes concurrent same-plan execution to one exact receipt and mutation count', async () => {
    const plan = await rememberPlan();
    const results = await Promise.all([
      executeEmergencyControl(db, { planId: plan.planId, expectedInstallations: plan.installations, confirm: true }),
      executeEmergencyControl(db, { planId: plan.planId, expectedInstallations: plan.installations, confirm: true }),
    ]);
    expect(results.map((result) => result.reason).sort()).toEqual(['already-executed', 'executed']);
    expect(results.reduce((sum, result) => sum + result.credentialsRevoked, 0)).toBe(2);
    expect(results.reduce((sum, result) => sum + result.permissionsRemoved, 0)).toBe(3);
    expect(results.reduce((sum, result) => sum + result.installationsDisconnected, 0)).toBe(2);
    expect(results.reduce((sum, result) => sum + result.auditReceipts, 0)).toBe(1);
    expect(await db.$count(schema.hermesEmergencyReceipts, eq(schema.hermesEmergencyReceipts.planId, plan.planId))).toBe(1);
  });

  it('returns a concurrent pre-execution plan as the stable executed snapshot and exposes a new current plan', async () => {
    const initial = await rememberPlan();
    const snapshotRead = deferred();
    const releasePlan = deferred();
    const racingPlanPromise = planEmergencyControlWithTestHooks(db, { audience: 'hermes-agent' }, {
      afterPlanSnapshot: async () => {
        snapshotRead.resolve();
        await releasePlan.promise;
      },
    });
    await snapshotRead.promise;
    const executed = await executeEmergencyControl(db, {
      planId: initial.planId, expectedInstallations: initial.installations, confirm: true,
    });
    releasePlan.resolve();
    const racingPlan = await racingPlanPromise;
    expect(racingPlan).toEqual(initial);
    const rerun = await executeEmergencyControl(db, {
      planId: racingPlan.planId, expectedInstallations: racingPlan.installations, confirm: true,
    });
    expect(rerun).toMatchObject({ reason: 'already-executed', receiptId: executed.receiptId });

    const current = await rememberPlan();
    expect(current.planId).not.toBe(initial.planId);
    expect(current).toMatchObject({ installations: 0, credentials: 0, permissions: 0, owners: 0 });
    const currentReceipt = await executeEmergencyControl(db, {
      planId: current.planId, expectedInstallations: current.installations, confirm: true,
    });
    expect(currentReceipt).toMatchObject({
      reason: 'executed', installationsDisconnected: 0, credentialsRevoked: 0,
      permissionsRemoved: 0, auditReceipts: 1,
    });
    expect(await db.$count(schema.hermesEmergencyReceipts,
      inArray(schema.hermesEmergencyReceipts.planId, [initial.planId, current.planId]))).toBe(2);
  });

  it('rejects an insertion committed after preliminary planning and accepts the new current plan', async () => {
    const stale = await rememberPlan();
    await expect(executeEmergencyControlWithTestHooks(db, {
      planId: stale.planId, expectedInstallations: stale.installations, confirm: true,
    }, {
      afterPreliminaryPlan: async () => {
        await db.insert(schema.agentPermissions).values({
          id: permissionIds[6], agentId: firstAgentId, userId: ownerId,
          scope: 'network', scopeId: `${fixture}_network_inserted`, actions: ['manage:negotiations'],
        });
      },
    })).rejects.toThrow('plan drift');
    await assertOriginalMutationState();
    expect(await db.$count(schema.hermesEmergencyReceipts, eq(schema.hermesEmergencyReceipts.planId, stale.planId))).toBe(0);

    const current = await rememberPlan();
    expect(current.planId).not.toBe(stale.planId);
    expect(current.permissions).toBe(4);
    const receipt = await executeEmergencyControl(db, {
      planId: current.planId, expectedInstallations: current.installations, confirm: true,
    });
    expect(receipt.permissionsRemoved).toBe(4);
  });

  it('rejects a deletion committed after preliminary planning without partial emergency mutation', async () => {
    const stale = await rememberPlan();
    await expect(executeEmergencyControlWithTestHooks(db, {
      planId: stale.planId, expectedInstallations: stale.installations, confirm: true,
    }, {
      afterPreliminaryPlan: async () => {
        await db.delete(schema.agentPermissions).where(eq(schema.agentPermissions.id, permissionIds[2]));
      },
    })).rejects.toThrow('plan drift');
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, firstAgentId));
    expect(agent).toMatchObject({
      status: 'active', handleNegotiations: true, runtimeSetupAttemptId: `${fixture}_generation_a`,
    });
    expect(await db.$count(schema.hermesAgentCredentials,
      and(inArray(schema.hermesAgentCredentials.id, credentialIds), inArray(schema.hermesAgentCredentials.activationState, ['pending', 'active'])))).toBe(2);
    expect(await db.$count(schema.hermesEmergencyReceipts, eq(schema.hermesEmergencyReceipts.planId, stale.planId))).toBe(0);
  });

  it('rolls back agents, credentials, permissions, and receipt on an injected post-mutation failure', async () => {
    const plan = await rememberPlan();
    const injected = new Error('test-only injected post-mutation failure');
    let caught: unknown;
    try {
      await executeEmergencyControlWithTestHooks(db, {
        planId: plan.planId, expectedInstallations: plan.installations, confirm: true,
      }, {
        afterMutations: async () => { throw injected; },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(injected);
    await assertOriginalMutationState();
    expect(await db.$count(schema.hermesEmergencyReceipts, eq(schema.hermesEmergencyReceipts.planId, plan.planId))).toBe(0);
  });
});
