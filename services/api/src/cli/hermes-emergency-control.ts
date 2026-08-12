#!/usr/bin/env bun
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { sql, type SQL } from 'drizzle-orm/sql';

import type { DrizzleDB } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { assertEmergencyAudience, assertEmergencyPlanId, createEmergencyPlan, HERMES_EMERGENCY_ACTION, HERMES_EMERGENCY_AUDIENCE, type EmergencyPlan, type EmergencyReceipt, type EmergencySnapshot, type HermesEmergencyAudience } from './hermes-emergency-control.contract';
import { runHermesEmergencyMain } from './hermes-emergency-control.main';

type Transaction = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];
type ReturningId = { id: string };

export function emergencyOwnerLockQuery(ownerId: string): SQL {
  return sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${ownerId}`}::text, 0))`;
}

export function emergencyExecutionLockQuery(planId: string): SQL {
  return sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hermes-emergency-control:${planId}`}::text, 0))`;
}

function permissionTargetList(permissionIds: readonly string[]): SQL {
  if (permissionIds.length === 0) throw new Error('permission target IDs required');
  const sortedIds = [...permissionIds].sort((left, right) => left.localeCompare(right, 'en'));
  return sql.join(sortedIds.map((id) => sql`${id}::text`), sql`, `);
}

/** Delete only locked-snapshot targets whose negotiation-action removal makes them empty. */
export function emergencyEmptyTargetPermissionDeleteQuery(permissionIds: readonly string[]): SQL {
  const targets = permissionTargetList(permissionIds);
  return sql`
    DELETE FROM agent_permissions
    WHERE id IN (${targets})
      AND ${HERMES_EMERGENCY_ACTION}::text = ANY(actions)
      AND cardinality(array_remove(actions, ${HERMES_EMERGENCY_ACTION}::text)) = 0
    RETURNING id
  `;
}

/** Remove the action from surviving locked-snapshot targets, preserving every unrelated action. */
export function emergencyPermissionUpdateQuery(permissionIds: readonly string[]): SQL {
  const targets = permissionTargetList(permissionIds);
  return sql`
    UPDATE agent_permissions
    SET actions = array_remove(actions, ${HERMES_EMERGENCY_ACTION}::text)
    WHERE id IN (${targets})
      AND ${HERMES_EMERGENCY_ACTION}::text = ANY(actions)
    RETURNING id
  `;
}

async function readEmergencySnapshot(database: DrizzleDB | Transaction): Promise<EmergencySnapshot> {
  const agents = await database.select({
    id: schema.agents.id,
    ownerId: schema.agents.ownerId,
    installationId: schema.agents.installationId,
    status: schema.agents.status,
    handleNegotiations: schema.agents.handleNegotiations,
    setupAttemptId: schema.agents.runtimeSetupAttemptId,
  }).from(schema.agents).where(and(
    eq(schema.agents.type, 'external'),
    eq(schema.agents.runtimeKind, 'hermes'),
    isNotNull(schema.agents.installationId),
    isNull(schema.agents.deletedAt),
    or(
      ne(schema.agents.status, 'inactive'),
      eq(schema.agents.handleNegotiations, true),
      isNotNull(schema.agents.runtimeSetupAttemptId),
    ),
  ));

  const credentials = await database.select({
    id: schema.hermesAgentCredentials.id,
    ownerId: schema.hermesAgentCredentials.ownerId,
    agentId: schema.hermesAgentCredentials.agentId,
    installationId: schema.hermesAgentCredentials.installationId,
    setupAttemptId: schema.hermesAgentCredentials.setupAttemptId,
    activationState: schema.hermesAgentCredentials.activationState,
    actions: schema.hermesAgentCredentials.actions,
  }).from(schema.hermesAgentCredentials).where(and(
    eq(schema.hermesAgentCredentials.audience, HERMES_EMERGENCY_AUDIENCE),
    inArray(schema.hermesAgentCredentials.activationState, ['pending', 'active']),
  ));

  const permissions = await database.select({
    id: schema.agentPermissions.id,
    agentId: schema.agentPermissions.agentId,
    ownerId: schema.agents.ownerId,
    userId: schema.agentPermissions.userId,
    scope: schema.agentPermissions.scope,
    scopeId: schema.agentPermissions.scopeId,
    actions: schema.agentPermissions.actions,
  }).from(schema.agentPermissions)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.agentPermissions.agentId))
    .where(and(
      eq(schema.agents.type, 'external'),
      eq(schema.agents.runtimeKind, 'hermes'),
      sql`${HERMES_EMERGENCY_ACTION}::text = ANY(${schema.agentPermissions.actions})`,
    ));

  return {
    agents: agents.map((row) => ({ ...row, installationId: row.installationId! })),
    credentials: credentials.map((row) => {
      if (row.activationState !== 'pending' && row.activationState !== 'active') {
        throw new Error('invalid emergency credential state');
      }
      return { ...row, activationState: row.activationState };
    }),
    permissions,
  };
}

function snapshotOwnerIds(snapshot: EmergencySnapshot): string[] {
  return [...new Set([
    ...snapshot.agents.map((row) => row.ownerId),
    ...snapshot.credentials.map((row) => row.ownerId),
    ...snapshot.permissions.map((row) => row.ownerId),
  ])].sort((left, right) => left.localeCompare(right, 'en'));
}

interface EmergencyControlTestHooks {
  afterPlanSnapshot?: () => Promise<void>;
  afterPreliminaryPlan?: () => Promise<void>;
  afterMutations?: () => Promise<void>;
}

function assertTestHooksAllowed(): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('emergency control test hooks require NODE_ENV=test');
}

async function planEmergencyControlInternal(
  database: DrizzleDB,
  input: { audience: string },
  testHooks: Pick<EmergencyControlTestHooks, 'afterPlanSnapshot'>,
): Promise<EmergencyPlan> {
  assertEmergencyAudience(input.audience);
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    const snapshot = await readEmergencySnapshot(tx);
    await testHooks.afterPlanSnapshot?.();
    return createEmergencyPlan(snapshot, input.audience);
  });
}

export function planEmergencyControl(
  database: DrizzleDB,
  input: { audience: string },
): Promise<EmergencyPlan> {
  return planEmergencyControlInternal(database, input, {});
}

/** Test-only concurrency seam; impossible to invoke unless Bun is in test mode. */
export function planEmergencyControlWithTestHooks(
  database: DrizzleDB,
  input: { audience: string },
  testHooks: Pick<EmergencyControlTestHooks, 'afterPlanSnapshot'>,
): Promise<EmergencyPlan> {
  assertTestHooksAllowed();
  return planEmergencyControlInternal(database, input, testHooks);
}

function executedReceipt(row: typeof schema.hermesEmergencyReceipts.$inferSelect): EmergencyReceipt {
  return {
    planId: row.planId,
    receiptId: row.planId,
    audience: HERMES_EMERGENCY_AUDIENCE,
    installations: row.installations,
    credentials: row.credentials,
    permissions: row.permissions,
    owners: row.owners,
    selectedPaused: 0,
    credentialsRevoked: 0,
    permissionsRemoved: 0,
    installationsDisconnected: 0,
    auditReceipts: 0,
    reason: 'already-executed',
  };
}

async function executeEmergencyControlInternal(
  database: DrizzleDB,
  input: { planId: string; expectedInstallations: number; confirm: boolean },
  testHooks: Pick<EmergencyControlTestHooks, 'afterPreliminaryPlan' | 'afterMutations'>,
): Promise<EmergencyReceipt> {
  if (input.confirm !== true) throw new Error('confirmation required');
  assertEmergencyPlanId(input.planId);
  if (!Number.isSafeInteger(input.expectedInstallations) || input.expectedInstallations < 0) {
    throw new Error('expected count mismatch');
  }

  return database.transaction(async (tx) => {
    await tx.execute(emergencyExecutionLockQuery(input.planId));
    const [prior] = await tx.select().from(schema.hermesEmergencyReceipts)
      .where(eq(schema.hermesEmergencyReceipts.planId, input.planId)).limit(1);
    if (prior) {
      if (prior.installations !== input.expectedInstallations) throw new Error('expected count mismatch');
      return executedReceipt(prior);
    }

    const preliminarySnapshot = await readEmergencySnapshot(tx);
    const preliminaryPlan = createEmergencyPlan(preliminarySnapshot, HERMES_EMERGENCY_AUDIENCE);
    if (preliminaryPlan.installations !== input.expectedInstallations) throw new Error('expected count mismatch');
    if (preliminaryPlan.planId !== input.planId) throw new Error('plan drift');
    await testHooks.afterPreliminaryPlan?.();

    for (const ownerId of snapshotOwnerIds(preliminarySnapshot)) {
      await tx.execute(emergencyOwnerLockQuery(ownerId));
    }
    // Owner locks serialize every existing runtime lifecycle. These fixed table
    // locks close the remaining new-owner insertion window until commit.
    await tx.execute(sql.raw(`
      LOCK TABLE agents, hermes_agent_credentials, agent_permissions,
        hermes_emergency_receipts IN SHARE ROW EXCLUSIVE MODE
    `));

    const lockedSnapshot = await readEmergencySnapshot(tx);
    const lockedPlan = createEmergencyPlan(lockedSnapshot, HERMES_EMERGENCY_AUDIENCE);
    if (lockedPlan.installations !== input.expectedInstallations) throw new Error('expected count mismatch');
    if (lockedPlan.planId !== input.planId) throw new Error('plan drift');

    const now = new Date();
    const disconnected = await tx.update(schema.agents).set({
      status: 'inactive',
      handleNegotiations: false,
      runtimeSetupAttemptId: null,
      updatedAt: now,
    }).where(and(
      eq(schema.agents.type, 'external'),
      eq(schema.agents.runtimeKind, 'hermes'),
      isNotNull(schema.agents.installationId),
      isNull(schema.agents.deletedAt),
      or(
        ne(schema.agents.status, 'inactive'),
        eq(schema.agents.handleNegotiations, true),
        isNotNull(schema.agents.runtimeSetupAttemptId),
      ),
    )).returning({ id: schema.agents.id });
    if (disconnected.length !== lockedPlan.installations) throw new Error('plan drift');

    const revoked = await tx.update(schema.hermesAgentCredentials).set({
      activationState: 'revoked',
      revokedAt: now,
    }).where(and(
      eq(schema.hermesAgentCredentials.audience, HERMES_EMERGENCY_AUDIENCE),
      inArray(schema.hermesAgentCredentials.activationState, ['pending', 'active']),
    )).returning({ id: schema.hermesAgentCredentials.id });
    if (revoked.length !== lockedPlan.credentials) throw new Error('plan drift');

    const permissionIds = lockedSnapshot.permissions.map((permission) => permission.id);
    let permissionsRemoved = 0;
    if (permissionIds.length > 0) {
      const deletedPermissions = await tx.execute(
        emergencyEmptyTargetPermissionDeleteQuery(permissionIds),
      ) as unknown as ReturningId[];
      const updatedPermissions = await tx.execute(
        emergencyPermissionUpdateQuery(permissionIds),
      ) as unknown as ReturningId[];
      permissionsRemoved = deletedPermissions.length + updatedPermissions.length;
      if (permissionsRemoved !== lockedPlan.permissions) throw new Error('plan drift');
    }
    await testHooks.afterMutations?.();

    const [audit] = await tx.insert(schema.hermesEmergencyReceipts).values({
      planId: lockedPlan.planId,
      audience: HERMES_EMERGENCY_AUDIENCE,
      installations: lockedPlan.installations,
      credentials: lockedPlan.credentials,
      permissions: lockedPlan.permissions,
      owners: lockedPlan.owners,
      selectedPaused: disconnected.length,
      credentialsRevoked: revoked.length,
      permissionsRemoved,
      installationsDisconnected: disconnected.length,
      resultReason: 'executed',
      createdAt: now,
    }).onConflictDoNothing().returning({ planId: schema.hermesEmergencyReceipts.planId });
    if (!audit) throw new Error('audit receipt conflict');

    return {
      planId: lockedPlan.planId,
      receiptId: lockedPlan.planId,
      audience: HERMES_EMERGENCY_AUDIENCE,
      installations: lockedPlan.installations,
      credentials: lockedPlan.credentials,
      permissions: lockedPlan.permissions,
      owners: lockedPlan.owners,
      selectedPaused: disconnected.length,
      credentialsRevoked: revoked.length,
      permissionsRemoved,
      installationsDisconnected: disconnected.length,
      auditReceipts: 1,
      reason: 'executed',
    };
  });
}

export function executeEmergencyControl(
  database: DrizzleDB,
  input: { planId: string; expectedInstallations: number; confirm: boolean },
): Promise<EmergencyReceipt> {
  return executeEmergencyControlInternal(database, input, {});
}

/** Test-only concurrency/fault seam; impossible to invoke unless Bun is in test mode. */
export function executeEmergencyControlWithTestHooks(
  database: DrizzleDB,
  input: { planId: string; expectedInstallations: number; confirm: boolean },
  testHooks: Pick<EmergencyControlTestHooks, 'afterPreliminaryPlan' | 'afterMutations'>,
): Promise<EmergencyReceipt> {
  assertTestHooksAllowed();
  return executeEmergencyControlInternal(database, input, testHooks);
}

if (import.meta.main) {
  let databaseModule: Promise<typeof import('../lib/drizzle/drizzle')> | undefined;
  const loadDatabase = (): Promise<typeof import('../lib/drizzle/drizzle')> => {
    databaseModule ??= import('../lib/drizzle/drizzle');
    return databaseModule;
  };
  const closeDatabase = async (): Promise<void> => {
    if (databaseModule) await (await databaseModule).closeDb().catch(() => undefined);
  };

  runHermesEmergencyMain({
    args: process.argv.slice(2),
    plan: async (audience: HermesEmergencyAudience) => {
      const { default: database } = await loadDatabase();
      return planEmergencyControl(database, { audience });
    },
    execute: async ({ planId, expectedInstallations, confirm }) => {
      const { default: database } = await loadDatabase();
      return executeEmergencyControl(database, { planId, expectedInstallations, confirm });
    },
  }).then(closeDatabase).catch(async (error: unknown) => {
    const stableMessages = new Set([
      'audience must be exactly hermes-agent',
      'confirmation required',
      'expected count mismatch',
      'plan drift',
    ]);
    const message = error instanceof Error && stableMessages.has(error.message)
      ? error.message
      : 'Hermes emergency control failed safely.';
    console.error(message);
    await closeDatabase();
    process.exit(1);
  });
}
