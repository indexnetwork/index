import { afterAll, beforeAll, describe, expect, it as bunIt } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm/sql';
import postgres from 'postgres';

import { assertPreflightPass, formatPreflightReport, type HermesPreflightReport } from '../../../cli/hermes-migration-preflight.contract';
import { runHermesMigrationPreflight } from '../../../cli/hermes-migration-preflight';
import { HERMES_CANONICAL_ACTIONS } from '../../../lib/agent/hermes-capabilities';
import type { DrizzleDB } from '../../../lib/drizzle/drizzle';
import { withMinimumDatabaseTestBudget } from '../../../lib/testing/database-test-budget';
import * as schema from '../../../schemas/database.schema';
import db from '../drizzle';

const it = withMinimumDatabaseTestBudget(bunIt, 170_000);
const fixture = `preflight_${randomUUID().replace(/-/g, '')}`;
const fixtureLike = `${fixture}%`;
const ownerId = `${fixture}_owner`;
const agentId = `${fixture}_agent`;
const pendingAgentId = `${fixture}_pending_agent`;
const revokedAgentId = `${fixture}_revoked_agent`;
const expiredAgentId = `${fixture}_expired_agent`;
const selectedOwnerId = `${fixture}_selected_owner`;
const issuedAt = new Date('2026-08-09T00:00:00.000Z');
const expiresAt = new Date(issuedAt.getTime() + 2_592_000_000);
const THRESHOLDS = { maxLockMs: 5_000, maxTotalMs: 30_000 } as const;

const SELECTED_INDEX_DDL = `
  CREATE UNIQUE INDEX uniq_agents_selected_negotiation_executor
  ON agents USING btree (owner_id)
  WHERE type = 'external' AND handle_negotiations = true AND deleted_at IS NULL
`;
const INSTALLATION_INDEX_DDL = `
  CREATE UNIQUE INDEX uniq_agents_hermes_installation
  ON agents USING btree (owner_id, runtime_kind, installation_id)
  WHERE type = 'external' AND runtime_kind = 'hermes' AND installation_id IS NOT NULL AND deleted_at IS NULL
`;
const EXPIRY_INDEX_DDL = `
  CREATE INDEX hermes_agent_credentials_expiry_idx
  ON hermes_agent_credentials USING btree (expires_at)
`;
const ACTIONS_CONSTRAINT_DDL = `
  ALTER TABLE hermes_agent_credentials
  ADD CONSTRAINT hermes_agent_credentials_actions_check
  CHECK (actions = ARRAY['manage:identity', 'manage:premises', 'manage:intents', 'manage:networks', 'manage:opportunities', 'manage:negotiations']::text[])
`;

async function replaceIndex(name: string, ddl: string): Promise<void> {
  await db.execute(sql.raw(`DROP INDEX IF EXISTS ${name}`));
  await db.execute(sql.raw(ddl));
}

async function replaceActionsConstraint(): Promise<void> {
  await db.execute(sql.raw('ALTER TABLE hermes_agent_credentials DROP CONSTRAINT IF EXISTS hermes_agent_credentials_actions_check'));
  await db.execute(sql.raw(ACTIONS_CONSTRAINT_DDL));
}

async function cleanupAndRestore(): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (operation: () => Promise<unknown>): Promise<void> => {
    try { await operation(); } catch (error) { errors.push(error); }
  };

  // Cleanup failures must not prevent independent schema restoration attempts.
  await attempt(() => db.execute(sql`DELETE FROM apikey WHERE id LIKE ${fixtureLike}`));
  await attempt(() => db.execute(sql`DELETE FROM hermes_agent_credentials WHERE id LIKE ${fixtureLike}`));
  await attempt(() => db.execute(sql`DELETE FROM agents WHERE id LIKE ${fixtureLike}`));
  await attempt(() => db.execute(sql`DELETE FROM users WHERE id LIKE ${fixtureLike}`));
  await attempt(() => replaceIndex('uniq_agents_selected_negotiation_executor', SELECTED_INDEX_DDL));
  await attempt(() => replaceIndex('uniq_agents_hermes_installation', INSTALLATION_INDEX_DDL));
  await attempt(() => replaceIndex('hermes_agent_credentials_expiry_idx', EXPIRY_INDEX_DDL));
  await attempt(replaceActionsConstraint);
  await attempt(async () => {
    const report = await runHermesMigrationPreflight({ database: db, thresholds: THRESHOLDS });
    if (report.missingIndexes !== 0) throw new Error('Hermes preflight schema restoration verification failed');
  });

  if (errors.length > 0) throw new AggregateError(errors, 'Hermes preflight fixture cleanup/restoration failed');
}

async function insertPermission(targetAgentId: string, actions = [...HERMES_CANONICAL_ACTIONS]): Promise<void> {
  await db.insert(schema.agentPermissions).values({
    id: `${fixture}_permission_${randomUUID()}`,
    agentId: targetAgentId,
    userId: ownerId,
    scope: 'global',
    actions,
  });
}

async function timedPreflight(
  database: DrizzleDB = db,
  afterSnapshotEstablished?: () => Promise<void>,
): Promise<HermesPreflightReport> {
  const startedAt = performance.now();
  const report = await runHermesMigrationPreflight({
    database,
    thresholds: THRESHOLDS,
    afterSnapshotEstablished,
  });
  expect(report.lockDurationMs).toBeLessThanOrEqual(THRESHOLDS.maxLockMs);
  expect(performance.now() - startedAt).toBeLessThanOrEqual(THRESHOLDS.maxTotalMs);
  return report;
}

async function timeRelevantMigrationDdl(): Promise<number> {
  class RollbackMigrationFixture extends Error {}
  let durationMs = Number.NaN;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${THRESHOLDS.maxLockMs}ms'`));
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${Math.min(THRESHOLDS.maxLockMs, THRESHOLDS.maxTotalMs)}ms'`));
      await tx.execute(sql.raw('DROP INDEX uniq_agents_hermes_installation'));
      await tx.execute(sql.raw('DROP INDEX uniq_agents_selected_negotiation_executor'));
      const startedAt = performance.now();
      await tx.execute(sql.raw(`
        WITH ranked_selected_executors AS (
          SELECT id, row_number() OVER (
            PARTITION BY owner_id ORDER BY updated_at DESC, created_at DESC, id DESC
          ) AS selection_rank
          FROM agents
          WHERE type = 'external' AND handle_negotiations = true AND deleted_at IS NULL
        )
        UPDATE agents SET handle_negotiations = false, updated_at = now()
        FROM ranked_selected_executors
        WHERE agents.id = ranked_selected_executors.id
          AND ranked_selected_executors.selection_rank > 1
      `));
      await tx.execute(sql.raw(INSTALLATION_INDEX_DDL));
      await tx.execute(sql.raw(SELECTED_INDEX_DDL));
      durationMs = performance.now() - startedAt;
      throw new RollbackMigrationFixture();
    });
  } catch (error) {
    if (!(error instanceof RollbackMigrationFixture)) throw error;
  }
  return durationMs;
}

beforeAll(async () => {
  await cleanupAndRestore();
  await db.insert(schema.users).values([
    { id: ownerId, email: `${fixture}@test.local`, name: 'Synthetic preflight owner' },
    { id: selectedOwnerId, email: `${fixture}_selected@test.local`, name: 'Synthetic selection owner' },
  ]);
  await db.insert(schema.agents).values([
    {
      id: agentId, ownerId, name: 'Synthetic Hermes runtime', type: 'external', status: 'active',
      runtimeKind: 'hermes', installationId: `${fixture}_installation`,
      runtimeSetupAttemptId: `${fixture}_setup`, handleNegotiations: false,
    },
    {
      id: pendingAgentId, ownerId, name: 'Synthetic pending Hermes runtime', type: 'external', status: 'active',
      runtimeKind: 'hermes', installationId: `${fixture}_pending_installation`,
      runtimeSetupAttemptId: `${fixture}_pending_setup`, handleNegotiations: false,
    },
    {
      id: revokedAgentId, ownerId, name: 'Synthetic revoked Hermes runtime', type: 'external', status: 'inactive',
      runtimeKind: 'hermes', installationId: `${fixture}_revoked_installation`,
      runtimeSetupAttemptId: null, handleNegotiations: false,
    },
    {
      id: expiredAgentId, ownerId, name: 'Synthetic expired Hermes runtime', type: 'external', status: 'active',
      runtimeKind: 'hermes', installationId: `${fixture}_expired_installation`,
      runtimeSetupAttemptId: `${fixture}_expired_setup`, handleNegotiations: false,
    },
  ]);
  await db.insert(schema.hermesAgentCredentials).values([
    {
      id: `${fixture}_credential`, secretHash: `${fixture}_non_secret_digest`, ownerId, agentId,
      installationId: `${fixture}_installation`, setupAttemptId: `${fixture}_setup`, audience: 'hermes-agent',
      actions: [...HERMES_CANONICAL_ACTIONS], activationState: 'active', issuedAt, expiresAt, activatedAt: issuedAt,
    },
    {
      id: `${fixture}_pending`, secretHash: `${fixture}_pending_digest`, ownerId, agentId: pendingAgentId,
      installationId: `${fixture}_pending_installation`, setupAttemptId: `${fixture}_pending_setup`, audience: 'hermes-agent',
      actions: [...HERMES_CANONICAL_ACTIONS], activationState: 'pending', issuedAt, expiresAt,
    },
    {
      id: `${fixture}_revoked`, secretHash: `${fixture}_revoked_digest`, ownerId, agentId: revokedAgentId,
      installationId: `${fixture}_revoked_installation`, setupAttemptId: `${fixture}_revoked_setup`, audience: 'hermes-agent',
      actions: [...HERMES_CANONICAL_ACTIONS], activationState: 'revoked', issuedAt, expiresAt, revokedAt: issuedAt,
    },
    {
      id: `${fixture}_expired`, secretHash: `${fixture}_expired_digest`, ownerId, agentId: expiredAgentId,
      installationId: `${fixture}_expired_installation`, setupAttemptId: `${fixture}_expired_setup`, audience: 'hermes-agent',
      actions: [...HERMES_CANONICAL_ACTIONS], activationState: 'active',
      issuedAt: new Date('2026-01-01T00:00:00.000Z'), expiresAt: new Date('2026-01-31T00:00:00.000Z'),
      activatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ]);
  await insertPermission(agentId);
  await insertPermission(expiredAgentId);

  // Relevant pre-0119 shape: 100,000 external agents without Hermes runtime
  // bindings or selected-executor uniqueness, inserted in one bounded statement.
  await db.execute(sql`
    INSERT INTO agents (id, owner_id, name, type, status, handle_negotiations)
    SELECT ${fixture} || '_bulk_' || value::text, ${ownerId}, 'Synthetic pre-migration agent',
      'external', 'active', false
    FROM generate_series(1, 100000) AS value
  `);

  // Every syntactically valid JSON value is migration-safe, not only objects.
  await db.insert(schema.apikeys).values([
    { id: `${fixture}_json_object`, key: `${fixture}_object`, metadata: '{}', enabled: true },
    { id: `${fixture}_json_array`, key: `${fixture}_array`, metadata: '[]', enabled: true },
    { id: `${fixture}_json_number`, key: `${fixture}_number`, metadata: '42', enabled: true },
    { id: `${fixture}_json_string`, key: `${fixture}_string`, metadata: '"scalar"', enabled: true },
    { id: `${fixture}_json_null`, key: `${fixture}_null`, metadata: 'null', enabled: true },
  ]);
});

afterAll(cleanupAndRestore);

describe('Hermes migration preflight on disposable PostgreSQL', () => {
  it('times migration DDL and covers consistency, authority, expiry, drift, and restoration', async () => {
    try {
      const migrationDurationMs = await timeRelevantMigrationDdl();
      expect(migrationDurationMs).toBeGreaterThanOrEqual(0);
      expect(migrationDurationMs).toBeLessThanOrEqual(THRESHOLDS.maxLockMs);
      expect(migrationDurationMs).toBeLessThanOrEqual(THRESHOLDS.maxTotalMs);

      const clean = await timedPreflight();
      expect(clean).toMatchObject({
        invalidLegacyMetadata: 0,
        duplicateSelections: 0,
        invalidDedicatedCredentials: 0,
        expiryMismatches: 0,
        missingIndexes: 0,
      });
      expect(() => assertPreflightPass(clean)).not.toThrow();

      await db.insert(schema.apikeys).values({
        id: `${fixture}_malformed`, key: `${fixture}_malformed_public`, metadata: '{broken', enabled: true,
      });
      const malformed = await timedPreflight();
      expect(malformed.invalidLegacyMetadata).toBe(1);
      expect(() => assertPreflightPass(malformed)).toThrow('invalid legacy API-key metadata');
      expect(formatPreflightReport(malformed)).not.toContain(fixture);
      await db.delete(schema.apikeys).where(sql`${schema.apikeys.id} = ${`${fixture}_malformed`}`);

      await db.update(schema.agents).set({ status: 'inactive' }).where(sql`${schema.agents.id} = ${agentId}`);
      expect((await timedPreflight()).invalidDedicatedCredentials).toBe(1);
      await db.update(schema.agents).set({ status: 'active' }).where(sql`${schema.agents.id} = ${agentId}`);

      await db.update(schema.hermesAgentCredentials).set({ activatedAt: issuedAt })
        .where(sql`${schema.hermesAgentCredentials.id} = ${`${fixture}_pending`}`);
      expect((await timedPreflight()).invalidDedicatedCredentials).toBe(1);
      await db.update(schema.hermesAgentCredentials).set({ activatedAt: null })
        .where(sql`${schema.hermesAgentCredentials.id} = ${`${fixture}_pending`}`);

      await db.delete(schema.agentPermissions).where(sql`${schema.agentPermissions.agentId} = ${agentId}`);
      expect((await timedPreflight()).invalidDedicatedCredentials).toBe(1);
      await insertPermission(agentId);
      await db.update(schema.agentPermissions).set({ userId: selectedOwnerId })
        .where(sql`${schema.agentPermissions.agentId} = ${agentId}`);
      expect((await timedPreflight()).invalidDedicatedCredentials).toBe(1);
      await db.update(schema.agentPermissions).set({ userId: ownerId })
        .where(sql`${schema.agentPermissions.agentId} = ${agentId}`);
      await db.update(schema.agentPermissions).set({ actions: HERMES_CANONICAL_ACTIONS.slice(0, -1) })
        .where(sql`${schema.agentPermissions.agentId} = ${agentId}`);
      expect((await timedPreflight()).invalidDedicatedCredentials).toBe(1);
      await db.update(schema.agentPermissions).set({ actions: [...HERMES_CANONICAL_ACTIONS] })
        .where(sql`${schema.agentPermissions.agentId} = ${agentId}`);

      await insertPermission(pendingAgentId);
      expect((await timedPreflight()).invalidDedicatedCredentials).toBe(1);
      await db.delete(schema.agentPermissions).where(sql`${schema.agentPermissions.agentId} = ${pendingAgentId}`);
      expect((await timedPreflight()).invalidDedicatedCredentials).toBe(0);

      await insertPermission(revokedAgentId);
      expect((await timedPreflight()).invalidDedicatedCredentials).toBe(1);
      await db.delete(schema.agentPermissions).where(sql`${schema.agentPermissions.agentId} = ${revokedAgentId}`);

      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new Error('Guarded database test requires DATABASE_URL');
      const snapshotClient = postgres(databaseUrl, { max: 1, prepare: false });
      const mutationClient = postgres(databaseUrl, { max: 1, prepare: false });
      const snapshotDb = drizzle(snapshotClient, { schema });
      const mutationDb = drizzle(mutationClient, { schema });
      try {
        const [snapshotPid] = await snapshotClient<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        const [mutationPid] = await mutationClient<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        expect(snapshotPid!.pid).not.toBe(mutationPid!.pid);
        const snapshot = await timedPreflight(snapshotDb, async () => {
          await mutationDb.update(schema.hermesAgentCredentials)
            .set({ expiresAt: new Date(expiresAt.getTime() - 3_600_000) })
            .where(sql`${schema.hermesAgentCredentials.id} = ${`${fixture}_credential`}`);
        });
        expect(snapshot.expiryMismatches).toBe(0);
        expect((await timedPreflight()).expiryMismatches).toBe(1);
      } finally {
        await db.update(schema.hermesAgentCredentials).set({ expiresAt })
          .where(sql`${schema.hermesAgentCredentials.id} = ${`${fixture}_credential`}`);
        await Promise.allSettled([snapshotClient.end({ timeout: 5 }), mutationClient.end({ timeout: 5 })]);
      }

      const dstIssuedAt = new Date('2026-03-01T12:00:00.000Z');
      const dstExpiresAt = new Date(dstIssuedAt.getTime() + 2_592_000_000);
      const timezoneClient = postgres(databaseUrl, { max: 1, prepare: false });
      const timezoneDb = drizzle(timezoneClient, { schema });
      try {
        await timezoneClient.unsafe("SET TIME ZONE 'America/Los_Angeles'");
        await db.insert(schema.hermesAgentCredentials).values({
          id: `${fixture}_dst`, secretHash: `${fixture}_dst_digest`, ownerId, agentId: revokedAgentId,
          installationId: `${fixture}_dst_installation`, setupAttemptId: `${fixture}_dst_setup`, audience: 'hermes-agent',
          actions: [...HERMES_CANONICAL_ACTIONS], activationState: 'revoked',
          issuedAt: dstIssuedAt, expiresAt: dstExpiresAt, revokedAt: dstIssuedAt,
        });
        expect((await timedPreflight(timezoneDb)).expiryMismatches).toBe(0);
      } finally {
        await db.delete(schema.hermesAgentCredentials).where(sql`${schema.hermesAgentCredentials.id} = ${`${fixture}_dst`}`);
        await timezoneClient.end({ timeout: 5 });
      }

      await db.execute(sql.raw('DROP INDEX uniq_agents_selected_negotiation_executor'));
      try {
        await db.insert(schema.agents).values([
          { id: `${fixture}_duplicate_a`, ownerId: selectedOwnerId, name: 'Duplicate A', type: 'external', status: 'active', handleNegotiations: true },
          { id: `${fixture}_duplicate_b`, ownerId: selectedOwnerId, name: 'Duplicate B', type: 'external', status: 'active', handleNegotiations: true },
        ]);
        const duplicates = await timedPreflight();
        expect(duplicates.duplicateSelections).toBe(1);
        expect(duplicates.missingIndexes).toBeGreaterThanOrEqual(1);
      } finally {
        await db.delete(schema.agents).where(sql`${schema.agents.ownerId} = ${selectedOwnerId}`);
        await replaceIndex('uniq_agents_selected_negotiation_executor', SELECTED_INDEX_DDL);
      }

      await db.execute(sql.raw('ALTER TABLE hermes_agent_credentials DROP CONSTRAINT hermes_agent_credentials_actions_check'));
      try {
        await db.insert(schema.hermesAgentCredentials).values({
          id: `${fixture}_bad_actions`, secretHash: `${fixture}_bad_actions_digest`, ownerId, agentId: revokedAgentId,
          installationId: `${fixture}_bad_actions_installation`, setupAttemptId: `${fixture}_bad_actions_setup`, audience: 'hermes-agent',
          actions: HERMES_CANONICAL_ACTIONS.slice(0, -1), activationState: 'revoked', issuedAt, expiresAt, revokedAt: issuedAt,
        });
        const invalidActions = await timedPreflight();
        expect(invalidActions.invalidDedicatedCredentials).toBe(1);
        expect(invalidActions.missingIndexes).toBeGreaterThanOrEqual(1);
      } finally {
        await db.delete(schema.hermesAgentCredentials).where(sql`${schema.hermesAgentCredentials.id} = ${`${fixture}_bad_actions`}`);
        await replaceActionsConstraint();
      }

      await db.execute(sql.raw('DROP INDEX hermes_agent_credentials_expiry_idx'));
      await db.execute(sql.raw('CREATE INDEX hermes_agent_credentials_expiry_idx ON hermes_agent_credentials USING btree (issued_at DESC)'));
      try {
        const drifted = await timedPreflight();
        expect(drifted.missingIndexes).toBe(1);
        expect(() => assertPreflightPass(drifted)).toThrow('missing or invalid indexes/constraints');
      } finally {
        await replaceIndex('hermes_agent_credentials_expiry_idx', EXPIRY_INDEX_DDL);
      }

      expect((await timedPreflight()).missingIndexes).toBe(0);
    } finally {
      // Outermost restoration runs even if cleanup/assertions inside a scenario fail.
      await cleanupAndRestore();
    }
  });
});
