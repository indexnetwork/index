import { afterAll, beforeAll, beforeEach, describe, expect, it as bunIt } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { executeEmergencyControl, planEmergencyControl } from '../../../cli/hermes-emergency-control';
import { HERMES_CANONICAL_ACTIONS } from '../../agent/hermes-capabilities';
import { withMinimumDatabaseTestBudget } from '../../testing/database-test-budget';
import * as schema from '../../../schemas/database.schema';
import db from '../drizzle';

const it = withMinimumDatabaseTestBudget(bunIt, 60_000);
const fixture = `emergency_${randomUUID().replace(/-/g, '')}`;
const ownerId = `${fixture}_owner`;
const otherOwnerId = `${fixture}_other_owner`;
const firstAgentId = `${fixture}_hermes_a`;
const secondAgentId = `${fixture}_hermes_b`;
const indexAgentId = `${fixture}_index`;
const otherAgentId = `${fixture}_other_agent`;
const issuedAt = new Date('2026-08-09T00:00:00.000Z');
const expiresAt = new Date(issuedAt.getTime() + 2_592_000_000);
const receiptPlanIds = new Set<string>();

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

const permissionIds = [
  `${fixture}_permission_global`, `${fixture}_permission_network`, `${fixture}_permission_other`,
] as const;
const credentialIds = [`${fixture}_credential_a`, `${fixture}_credential_b`] as const;
const agentIds = [firstAgentId, secondAgentId, indexAgentId, otherAgentId] as const;
const userIds = [ownerId, otherOwnerId] as const;

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
      id: `${fixture}_credential_a`, secretHash: `${fixture}_digest_a`, ownerId, agentId: firstAgentId,
      installationId: `${fixture}_install_a`, setupAttemptId: `${fixture}_generation_a`,
      audience: 'hermes-agent', actions: [...HERMES_CANONICAL_ACTIONS], activationState: 'active',
      issuedAt, expiresAt, activatedAt: issuedAt,
    },
    {
      id: `${fixture}_credential_b`, secretHash: `${fixture}_digest_b`, ownerId, agentId: secondAgentId,
      installationId: `${fixture}_install_b`, setupAttemptId: `${fixture}_generation_b`,
      audience: 'hermes-agent', actions: [...HERMES_CANONICAL_ACTIONS], activationState: 'pending',
      issuedAt, expiresAt,
    },
  ]);
  await db.insert(schema.agentPermissions).values([
    {
      id: `${fixture}_permission_global`, agentId: firstAgentId, userId: ownerId,
      scope: 'global', actions: [...HERMES_CANONICAL_ACTIONS],
    },
    {
      id: `${fixture}_permission_network`, agentId: secondAgentId, userId: ownerId,
      scope: 'network', scopeId: `${fixture}_network`, actions: ['manage:negotiations'],
    },
    {
      id: `${fixture}_permission_other`, agentId: otherAgentId, userId: otherOwnerId,
      scope: 'global', actions: ['manage:negotiations', 'unrelated:action'],
    },
  ]);
}

async function rememberPlan(): Promise<Awaited<ReturnType<typeof planEmergencyControl>>> {
  const plan = await planEmergencyControl(db, { audience: 'hermes-agent' });
  receiptPlanIds.add(plan.planId);
  return plan;
}

beforeAll(assertDedicatedAssuranceGuard);
beforeEach(async () => {
  await cleanup();
  await seed();
});
afterAll(cleanup);

describe('Hermes emergency control on dedicated PostgreSQL', () => {
  it('keeps count mismatch mutation-free, executes exactly, and reruns idempotently', async () => {
    const plan = await rememberPlan();
    expect(plan).toMatchObject({ installations: 2, credentials: 2, permissions: 2, owners: 1 });

    await expect(executeEmergencyControl(db, {
      planId: plan.planId, expectedInstallations: plan.installations + 1, confirm: true,
    })).rejects.toThrow('expected count mismatch');
    expect(await db.$count(schema.hermesEmergencyReceipts, eq(schema.hermesEmergencyReceipts.planId, plan.planId))).toBe(0);
    expect(await db.$count(schema.hermesAgentCredentials,
      and(inArray(schema.hermesAgentCredentials.id, credentialIds), inArray(schema.hermesAgentCredentials.activationState, ['pending', 'active'])))).toBe(2);

    const receipt = await executeEmergencyControl(db, {
      planId: plan.planId, expectedInstallations: plan.installations, confirm: true,
    });
    expect(receipt).toMatchObject({
      receiptId: plan.planId, reason: 'executed', selectedPaused: 2,
      credentialsRevoked: 2, permissionsRemoved: 2, installationsDisconnected: 2,
      auditReceipts: 1,
    });
    const serialized = JSON.stringify({ plan, receipt });
    for (const identifier of [ownerId, firstAgentId, `${fixture}_credential_a`, `${fixture}_digest_a`]) {
      expect(serialized).not.toContain(identifier);
    }

    const hermesAgents = await db.select().from(schema.agents)
      .where(inArray(schema.agents.id, [firstAgentId, secondAgentId]));
    expect(hermesAgents.every((row) => row.status === 'inactive'
      && row.handleNegotiations === false && row.runtimeSetupAttemptId === null)).toBe(true);
    const [preservedPermission] = await db.select().from(schema.agentPermissions)
      .where(eq(schema.agentPermissions.id, `${fixture}_permission_global`));
    expect(preservedPermission!.actions).toEqual(HERMES_CANONICAL_ACTIONS.filter((action) => action !== 'manage:negotiations'));
    expect(await db.$count(schema.agentPermissions, eq(schema.agentPermissions.id, `${fixture}_permission_network`))).toBe(0);
    const [unrelatedPermission] = await db.select().from(schema.agentPermissions)
      .where(eq(schema.agentPermissions.id, `${fixture}_permission_other`));
    expect(unrelatedPermission!.actions).toEqual(['manage:negotiations', 'unrelated:action']);
    const [preservedIndex, preservedOther] = await db.select().from(schema.agents)
      .where(inArray(schema.agents.id, [indexAgentId, otherAgentId]));
    expect(preservedIndex).toMatchObject({ status: 'active', type: 'personal' });
    expect(preservedOther).toMatchObject({ status: 'active', runtimeKind: null });

    const rerun = await executeEmergencyControl(db, {
      planId: plan.planId, expectedInstallations: plan.installations, confirm: true,
    });
    expect(rerun).toMatchObject({
      receiptId: receipt.receiptId, reason: 'already-executed', selectedPaused: 0,
      credentialsRevoked: 0, permissionsRemoved: 0, installationsDisconnected: 0,
      auditReceipts: 0,
    });
    expect(await db.$count(schema.hermesEmergencyReceipts, eq(schema.hermesEmergencyReceipts.planId, plan.planId))).toBe(1);
  });

  it('rolls back every mutation when the exact plan snapshot drifts', async () => {
    const plan = await rememberPlan();
    await db.update(schema.agentPermissions).set({
      actions: [...HERMES_CANONICAL_ACTIONS, 'unrelated:preserved'],
    }).where(eq(schema.agentPermissions.id, `${fixture}_permission_global`));

    await expect(executeEmergencyControl(db, {
      planId: plan.planId, expectedInstallations: plan.installations, confirm: true,
    })).rejects.toThrow('plan drift');
    expect(await db.$count(schema.hermesEmergencyReceipts, eq(schema.hermesEmergencyReceipts.planId, plan.planId))).toBe(0);
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, firstAgentId));
    expect(agent).toMatchObject({ status: 'active', handleNegotiations: true, runtimeSetupAttemptId: `${fixture}_generation_a` });
    expect(await db.$count(schema.hermesAgentCredentials,
      and(inArray(schema.hermesAgentCredentials.id, credentialIds), inArray(schema.hermesAgentCredentials.activationState, ['pending', 'active'])))).toBe(2);
  });

  it('serializes concurrent exact executions without double mutation or audit', async () => {
    const plan = await rememberPlan();
    const results = await Promise.all([
      executeEmergencyControl(db, { planId: plan.planId, expectedInstallations: plan.installations, confirm: true }),
      executeEmergencyControl(db, { planId: plan.planId, expectedInstallations: plan.installations, confirm: true }),
    ]);
    expect(results.map((result) => result.reason).sort()).toEqual(['already-executed', 'executed']);
    expect(results.reduce((sum, result) => sum + result.credentialsRevoked, 0)).toBe(2);
    expect(results.reduce((sum, result) => sum + result.permissionsRemoved, 0)).toBe(2);
    expect(results.reduce((sum, result) => sum + result.installationsDisconnected, 0)).toBe(2);
    expect(await db.$count(schema.hermesEmergencyReceipts, eq(schema.hermesEmergencyReceipts.planId, plan.planId))).toBe(1);
  });
});
