import { afterAll, beforeAll, describe, expect, it as bunIt } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';

import { HermesRuntimeTelemetryDatabaseAdapter } from '../../../adapters/hermes-runtime-telemetry.database.adapter';
import { HERMES_CANONICAL_ACTIONS } from '../../agent/hermes-capabilities';
import { withMinimumDatabaseTestBudget } from '../../testing/database-test-budget';
import * as schema from '../../../schemas/database.schema';
import db from '../drizzle';

const it = withMinimumDatabaseTestBudget(bunIt, 60_000);
const fixture = `telemetry_${randomUUID().replace(/-/g, '')}`;
const ownerId = `${fixture}_owner`;
const agentIds = ['near', 'expired', 'far', 'pending', 'revoked'].map((suffix) => `${fixture}_agent_${suffix}`);
const credentialIds = agentIds.map((_, index) => `${fixture}_credential_${index}`);
const now = new Date('2026-08-09T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
let dedicatedGuardEstablished = false;

function assertDedicatedAssuranceGuard(): void {
  if (process.env.TEST_DATABASE_SAFE !== '1') {
    throw new Error('Hermes telemetry database suite requires TEST_DATABASE_SAFE=1');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Hermes telemetry database suite requires DATABASE_URL');
  let databaseName = '';
  try {
    databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    // Fail with the fixed message below; never include a credential-bearing URL.
  }
  if (databaseName !== 'hermes_assurance') {
    throw new Error('Hermes telemetry database suite requires the exact hermes_assurance database');
  }
}

async function cleanup(): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  await attempt(() => db.delete(schema.hermesAgentCredentials)
    .where(inArray(schema.hermesAgentCredentials.id, credentialIds)));
  await attempt(() => db.delete(schema.agents).where(inArray(schema.agents.id, agentIds)));
  await attempt(() => db.delete(schema.users).where(inArray(schema.users.id, [ownerId])));
  await attempt(async () => {
    const counts = await Promise.all([
      db.$count(schema.hermesAgentCredentials, inArray(schema.hermesAgentCredentials.id, credentialIds)),
      db.$count(schema.agents, inArray(schema.agents.id, agentIds)),
      db.$count(schema.users, inArray(schema.users.id, [ownerId])),
    ]);
    if (counts.some((count) => Number(count) !== 0)) {
      throw new Error('Hermes telemetry fixture rows remain');
    }
  });
  if (errors.length > 0) throw new AggregateError(errors, 'Hermes telemetry fixture cleanup failed');
}

beforeAll(async () => {
  assertDedicatedAssuranceGuard();
  dedicatedGuardEstablished = true;
  await cleanup();
  await db.insert(schema.users).values({
    id: ownerId,
    email: `${fixture}@test.local`,
    name: 'Hermes telemetry fixture owner',
  });
  await db.insert(schema.agents).values(agentIds.map((id, index) => ({
    id,
    ownerId,
    name: `Hermes telemetry fixture ${index}`,
    type: 'external' as const,
    status: 'active' as const,
    runtimeKind: 'hermes',
    installationId: `${fixture}_installation_${index}`,
    runtimeSetupAttemptId: `${fixture}_generation_${index}`,
    handleNegotiations: false,
  })));

  const expiries = [
    new Date(now.getTime() + DAY_MS),
    new Date(now.getTime() - DAY_MS),
    new Date(now.getTime() + 11 * DAY_MS),
    new Date(now.getTime() - DAY_MS),
    new Date(now.getTime() - DAY_MS),
  ];
  const states = ['active', 'active', 'active', 'pending', 'revoked'] as const;
  await db.insert(schema.hermesAgentCredentials).values(credentialIds.map((id, index) => ({
    id,
    secretHash: `${fixture}_nonsecret_fixture_digest_${index}`,
    ownerId,
    agentId: agentIds[index]!,
    installationId: `${fixture}_installation_${index}`,
    setupAttemptId: `${fixture}_generation_${index}`,
    audience: 'hermes-agent',
    actions: [...HERMES_CANONICAL_ACTIONS],
    activationState: states[index]!,
    issuedAt: new Date(expiries[index]!.getTime() - 30 * DAY_MS),
    expiresAt: expiries[index]!,
    activatedAt: states[index] === 'active' ? new Date(expiries[index]!.getTime() - 29 * DAY_MS) : null,
    revokedAt: states[index] === 'revoked' ? new Date(expiries[index]!.getTime() - DAY_MS) : null,
  })));
});

afterAll(async () => {
  if (dedicatedGuardEstablished) await cleanup();
});

describe('Hermes runtime telemetry aggregate against PostgreSQL', () => {
  it('counts only active near-expiry and expired credentials through the production adapter', async () => {
    const adapter = new HermesRuntimeTelemetryDatabaseAdapter(db);
    await expect(adapter.countActiveCredentialExpiryHealth({
      now,
      nearExpiryCutoff: new Date(now.getTime() + 7 * DAY_MS),
    })).resolves.toEqual({ nearExpiry: 1, expired: 1 });
  });
});
