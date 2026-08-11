import { afterAll, beforeAll, describe, expect, it as bunIt } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm/sql';

import { assertPreflightPass, formatPreflightReport, type HermesPreflightReport } from '../../../cli/hermes-migration-preflight.contract';
import { runHermesMigrationPreflight } from '../../../cli/hermes-migration-preflight';
import { HERMES_CANONICAL_ACTIONS } from '../../../lib/agent/hermes-capabilities';
import { withMinimumDatabaseTestBudget } from '../../../lib/testing/database-test-budget';
import * as schema from '../../../schemas/database.schema';
import db from '../drizzle';

const it = withMinimumDatabaseTestBudget(bunIt, 150_000);
const fixture = `preflight_${randomUUID().replaceAll('-', '')}`;
const fixtureLike = `${fixture}%`;
const ownerId = `${fixture}_owner`;
const agentId = `${fixture}_agent`;
const selectedOwnerId = `${fixture}_selected_owner`;
const issuedAt = new Date('2026-08-09T00:00:00.000Z');
const expiresAt = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
const MAX_LOCK_MS = 5_000;
const MAX_TOTAL_MS = 30_000;

async function restoreIndexesAndConstraint(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_agents_selected_negotiation_executor
      ON agents USING btree (owner_id)
      WHERE type = 'external' AND handle_negotiations = true AND deleted_at IS NULL
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS hermes_agent_credentials_expiry_idx
      ON hermes_agent_credentials USING btree (expires_at)
  `));
  const constraints = await db.execute(sql<{ present: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'hermes_agent_credentials_actions_check'
        AND conrelid = 'hermes_agent_credentials'::regclass
    ) AS present
  `);
  if (!constraints[0]?.present) {
    await db.execute(sql.raw(`
      ALTER TABLE hermes_agent_credentials
      ADD CONSTRAINT hermes_agent_credentials_actions_check
      CHECK (actions = ARRAY['manage:identity', 'manage:premises', 'manage:intents', 'manage:networks', 'manage:opportunities', 'manage:negotiations']::text[])
    `));
  }
}

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM apikey WHERE id LIKE ${fixtureLike}`);
  await db.execute(sql`DELETE FROM users WHERE id LIKE ${fixtureLike}`);
  await restoreIndexesAndConstraint();
}

async function timedPreflight(): Promise<HermesPreflightReport> {
  const startedAt = performance.now();
  const report = await runHermesMigrationPreflight({ database: db });
  const totalDurationMs = performance.now() - startedAt;
  expect(report.lockDurationMs).toBeLessThanOrEqual(MAX_LOCK_MS);
  expect(totalDurationMs).toBeLessThanOrEqual(MAX_TOTAL_MS);
  return report;
}

beforeAll(async () => {
  await cleanup();
  await db.execute(sql`
    INSERT INTO users (id, email, name)
    VALUES
      (${ownerId}, ${`${fixture}@test.local`}, 'Synthetic preflight owner'),
      (${selectedOwnerId}, ${`${fixture}_selected@test.local`}, 'Synthetic selection owner')
  `);
  await db.execute(sql`
    INSERT INTO agents (
      id, owner_id, name, type, status, runtime_kind, installation_id,
      runtime_setup_attempt_id, handle_negotiations
    ) VALUES (
      ${agentId}, ${ownerId}, 'Synthetic Hermes runtime', 'external', 'active', 'hermes',
      ${`${fixture}_installation`}, ${`${fixture}_setup`}, false
    )
  `);
  await db.insert(schema.hermesAgentCredentials).values({
    id: `${fixture}_credential`,
    secretHash: `${fixture}_non_secret_digest`,
    ownerId,
    agentId,
    installationId: `${fixture}_installation`,
    setupAttemptId: `${fixture}_setup`,
    audience: 'hermes-agent',
    actions: [...HERMES_CANONICAL_ACTIONS],
    activationState: 'active',
    issuedAt,
    expiresAt,
    activatedAt: issuedAt,
  });

  // One set-based statement keeps the 100,000-row production-size fixture well
  // below the isolated workflow timeout. Values are synthetic and non-secret.
  await db.execute(sql`
    INSERT INTO apikey (id, key, metadata, enabled)
    SELECT
      ${fixture} || '_legacy_' || value::text,
      ${fixture} || '_public_' || value::text,
      '{"client":"synthetic"}',
      true
    FROM generate_series(1, 100000) AS value
  `);
});

afterAll(cleanup);

describe('Hermes migration preflight on disposable PostgreSQL', () => {
  it('covers a production-sized clean fixture and every fail-closed classification', async () => {
    const clean = await timedPreflight();
    expect(clean).toMatchObject({
      invalidLegacyMetadata: 0,
      duplicateSelections: 0,
      invalidDedicatedCredentials: 0,
      expiryMismatches: 0,
      missingIndexes: 0,
    });
    expect(() => assertPreflightPass(clean)).not.toThrow();

    await db.execute(sql`
      INSERT INTO apikey (id, key, metadata, enabled)
      VALUES (${`${fixture}_malformed`}, ${`${fixture}_malformed_public`}, '{broken', true)
    `);
    const malformed = await timedPreflight();
    expect(malformed.invalidLegacyMetadata).toBe(1);
    expect(() => assertPreflightPass(malformed)).toThrow('invalid legacy API-key metadata');
    expect(formatPreflightReport(malformed)).not.toContain(fixture);
    await db.execute(sql`DELETE FROM apikey WHERE id = ${`${fixture}_malformed`}`);

    await db.insert(schema.hermesAgentCredentials).values({
      id: `${fixture}_bad_state`,
      secretHash: `${fixture}_bad_state_digest`,
      ownerId,
      agentId,
      installationId: `${fixture}_bad_state_installation`,
      setupAttemptId: `${fixture}_bad_state_setup`,
      audience: 'hermes-agent',
      actions: [...HERMES_CANONICAL_ACTIONS],
      activationState: 'pending',
      issuedAt,
      expiresAt,
      activatedAt: issuedAt,
    });
    const invalidState = await timedPreflight();
    expect(invalidState.invalidDedicatedCredentials).toBe(1);
    expect(() => assertPreflightPass(invalidState)).toThrow('invalid dedicated credentials');
    await db.execute(sql`DELETE FROM hermes_agent_credentials WHERE id = ${`${fixture}_bad_state`}`);

    await db.insert(schema.hermesAgentCredentials).values({
      id: `${fixture}_bad_expiry`,
      secretHash: `${fixture}_bad_expiry_digest`,
      ownerId,
      agentId,
      installationId: `${fixture}_bad_expiry_installation`,
      setupAttemptId: `${fixture}_bad_expiry_setup`,
      audience: 'hermes-agent',
      actions: [...HERMES_CANONICAL_ACTIONS],
      activationState: 'revoked',
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 29 * 24 * 60 * 60 * 1000),
      revokedAt: issuedAt,
    });
    const expiryMismatch = await timedPreflight();
    expect(expiryMismatch.expiryMismatches).toBe(1);
    expect(() => assertPreflightPass(expiryMismatch)).toThrow('credential expiry mismatches');
    await db.execute(sql`DELETE FROM hermes_agent_credentials WHERE id = ${`${fixture}_bad_expiry`}`);

    await db.execute(sql.raw('DROP INDEX uniq_agents_selected_negotiation_executor'));
    try {
      await db.execute(sql`
        INSERT INTO agents (id, owner_id, name, type, status, handle_negotiations)
        VALUES
          (${`${fixture}_duplicate_a`}, ${selectedOwnerId}, 'Synthetic duplicate A', 'external', 'active', true),
          (${`${fixture}_duplicate_b`}, ${selectedOwnerId}, 'Synthetic duplicate B', 'external', 'active', true)
      `);
      const duplicates = await timedPreflight();
      expect(duplicates.duplicateSelections).toBe(1);
      expect(duplicates.missingIndexes).toBeGreaterThanOrEqual(1);
      expect(() => assertPreflightPass(duplicates)).toThrow('duplicate selected executors');
    } finally {
      await db.execute(sql`DELETE FROM agents WHERE owner_id = ${selectedOwnerId}`);
      await restoreIndexesAndConstraint();
    }

    await db.execute(sql.raw('ALTER TABLE hermes_agent_credentials DROP CONSTRAINT hermes_agent_credentials_actions_check'));
    try {
      await db.insert(schema.hermesAgentCredentials).values({
        id: `${fixture}_bad_actions`,
        secretHash: `${fixture}_bad_actions_digest`,
        ownerId,
        agentId,
        installationId: `${fixture}_bad_actions_installation`,
        setupAttemptId: `${fixture}_bad_actions_setup`,
        audience: 'hermes-agent',
        actions: HERMES_CANONICAL_ACTIONS.slice(0, -1),
        activationState: 'revoked',
        issuedAt,
        expiresAt,
        revokedAt: issuedAt,
      });
      const invalidActions = await timedPreflight();
      expect(invalidActions.invalidDedicatedCredentials).toBe(1);
      expect(invalidActions.missingIndexes).toBeGreaterThanOrEqual(1);
    } finally {
      await db.execute(sql`DELETE FROM hermes_agent_credentials WHERE id = ${`${fixture}_bad_actions`}`);
      await restoreIndexesAndConstraint();
    }

    await db.execute(sql.raw('DROP INDEX hermes_agent_credentials_expiry_idx'));
    try {
      const missingIndex = await timedPreflight();
      expect(missingIndex.missingIndexes).toBe(1);
      expect(() => assertPreflightPass(missingIndex)).toThrow('missing or invalid indexes/constraints');
    } finally {
      await restoreIndexesAndConstraint();
    }

    const restored = await timedPreflight();
    expect(restored.missingIndexes).toBe(0);
    expect(() => assertPreflightPass(restored)).not.toThrow();
  });
});
