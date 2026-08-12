#!/usr/bin/env bun
import { sql, type SQL } from 'drizzle-orm/sql';

import db, { closeDb, type DrizzleDB } from '../lib/drizzle/drizzle';
import { runHermesPreflightMain } from './hermes-migration-preflight.main';
import type { HermesPreflightCheckReport, HermesPreflightThresholds } from './hermes-migration-preflight.contract';

type Transaction = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];
type CountRow = { count: number };
type IndexRow = {
  name: string;
  tableName: string;
  valid: boolean;
  ready: boolean;
  definition: string;
};
type ConstraintRow = {
  name: string;
  tableName: string;
  type: string;
  valid: boolean;
  definition: string;
};
type ExpectedIndex = Pick<IndexRow, 'name' | 'tableName' | 'definition'>;
type ExpectedConstraint = Omit<ConstraintRow, 'valid'>;

const EXPECTED_INDEXES: readonly ExpectedIndex[] = [
  {
    name: 'uniq_agents_hermes_installation',
    tableName: 'agents',
    definition: "CREATE UNIQUE INDEX uniq_agents_hermes_installation ON public.agents USING btree (owner_id, runtime_kind, installation_id) WHERE ((type = 'external'::agent_type) AND (runtime_kind = 'hermes'::text) AND (installation_id IS NOT NULL) AND (deleted_at IS NULL))",
  },
  {
    name: 'uniq_agents_selected_negotiation_executor',
    tableName: 'agents',
    definition: "CREATE UNIQUE INDEX uniq_agents_selected_negotiation_executor ON public.agents USING btree (owner_id) WHERE ((type = 'external'::agent_type) AND (handle_negotiations = true) AND (deleted_at IS NULL))",
  },
  {
    name: 'hermes_agent_credentials_secret_hash_unique',
    tableName: 'hermes_agent_credentials',
    definition: 'CREATE UNIQUE INDEX hermes_agent_credentials_secret_hash_unique ON public.hermes_agent_credentials USING btree (secret_hash)',
  },
  {
    name: 'hermes_agent_credentials_live_installation_unique',
    tableName: 'hermes_agent_credentials',
    definition: "CREATE UNIQUE INDEX hermes_agent_credentials_live_installation_unique ON public.hermes_agent_credentials USING btree (owner_id, installation_id) WHERE (activation_state = ANY (ARRAY['pending'::text, 'active'::text]))",
  },
  {
    name: 'hermes_agent_credentials_live_generation_unique',
    tableName: 'hermes_agent_credentials',
    definition: "CREATE UNIQUE INDEX hermes_agent_credentials_live_generation_unique ON public.hermes_agent_credentials USING btree (agent_id, setup_attempt_id) WHERE (activation_state = ANY (ARRAY['pending'::text, 'active'::text]))",
  },
  {
    name: 'hermes_agent_credentials_expiry_idx',
    tableName: 'hermes_agent_credentials',
    definition: 'CREATE INDEX hermes_agent_credentials_expiry_idx ON public.hermes_agent_credentials USING btree (expires_at)',
  },
];

const EXPECTED_CONSTRAINTS: readonly ExpectedConstraint[] = [
  {
    name: 'hermes_agent_credentials_pkey', tableName: 'hermes_agent_credentials', type: 'p',
    definition: 'PRIMARY KEY (id)',
  },
  {
    name: 'hermes_agent_credentials_owner_id_users_id_fk', tableName: 'hermes_agent_credentials', type: 'f',
    definition: 'FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE',
  },
  {
    name: 'hermes_agent_credentials_agent_id_agents_id_fk', tableName: 'hermes_agent_credentials', type: 'f',
    definition: 'FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE',
  },
  {
    name: 'hermes_agent_credentials_audience_check', tableName: 'hermes_agent_credentials', type: 'c',
    definition: "CHECK ((audience = 'hermes-agent'::text))",
  },
  {
    name: 'hermes_agent_credentials_actions_check', tableName: 'hermes_agent_credentials', type: 'c',
    definition: "CHECK ((actions = ARRAY['manage:identity'::text, 'manage:premises'::text, 'manage:intents'::text, 'manage:networks'::text, 'manage:opportunities'::text, 'manage:negotiations'::text]))",
  },
  {
    name: 'hermes_agent_credentials_state_check', tableName: 'hermes_agent_credentials', type: 'c',
    definition: "CHECK ((activation_state = ANY (ARRAY['pending'::text, 'active'::text, 'revoked'::text])))",
  },
  {
    name: 'hermes_agent_credentials_expiry_check', tableName: 'hermes_agent_credentials', type: 'c',
    definition: 'CHECK ((expires_at > issued_at))',
  },
];

/** Remove only display-level quoting, public qualification, and whitespace. */
function canonicalSql(value: string): string {
  return value.toLowerCase()
    .replace(/"/g, '')
    .replace(/public\./g, '')
    .replace(/\s/g, '');
}

function boundedMilliseconds(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`);
  return Math.max(1, Math.ceil(value));
}

async function count(tx: Transaction, query: SQL, beforeQuery: () => Promise<void>): Promise<number> {
  await beforeQuery();
  const rows = await tx.execute(query) as unknown as CountRow[];
  return Number(rows[0]?.count ?? 0);
}

async function countInvalidSchemaObjects(tx: Transaction, beforeQuery: () => Promise<void>): Promise<number> {
  await beforeQuery();
  const indexes = await tx.execute(sql<IndexRow>`
    SELECT
      index_class.relname AS name,
      table_class.relname AS "tableName",
      index_catalog.indisvalid AS "valid",
      index_catalog.indisready AS "ready",
      pg_get_indexdef(index_catalog.indexrelid) AS "definition"
    FROM pg_index index_catalog
    JOIN pg_class index_class ON index_class.oid = index_catalog.indexrelid
    JOIN pg_class table_class ON table_class.oid = index_catalog.indrelid
    JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
    WHERE namespace.nspname = 'public'
      AND index_class.relname IN (${sql.join(EXPECTED_INDEXES.map((index) => sql`${index.name}`), sql`, `)})
  `) as unknown as IndexRow[];

  await beforeQuery();
  const constraints = await tx.execute(sql<ConstraintRow>`
    SELECT
      constraint_catalog.conname AS name,
      table_class.relname AS "tableName",
      constraint_catalog.contype AS "type",
      constraint_catalog.convalidated AS "valid",
      pg_get_constraintdef(constraint_catalog.oid, false) AS "definition"
    FROM pg_constraint constraint_catalog
    JOIN pg_class table_class ON table_class.oid = constraint_catalog.conrelid
    JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
    WHERE namespace.nspname = 'public'
      AND constraint_catalog.conname IN (${sql.join(EXPECTED_CONSTRAINTS.map((constraint) => sql`${constraint.name}`), sql`, `)})
  `) as unknown as ConstraintRow[];

  const invalidIndexes = EXPECTED_INDEXES.filter((expected) => {
    const actual = indexes.find((index) => index.name === expected.name);
    return !actual
      || actual.tableName !== expected.tableName
      || !actual.valid
      || !actual.ready
      || canonicalSql(actual.definition) !== canonicalSql(expected.definition);
  }).length;

  const invalidConstraints = EXPECTED_CONSTRAINTS.filter((expected) => {
    const actual = constraints.find((constraint) => constraint.name === expected.name);
    return !actual
      || actual.tableName !== expected.tableName
      || actual.type !== expected.type
      || !actual.valid
      || canonicalSql(actual.definition) !== canonicalSql(expected.definition);
  }).length;

  return invalidIndexes + invalidConstraints;
}

/**
 * Run catalog and table reads under one bounded, consistent, read-only snapshot.
 * `lockDurationMs` measures ACCESS SHARE acquisition plus the full period those
 * locks protect all checks; transaction completion releases them immediately.
 */
export async function runHermesMigrationPreflight(input: {
  database: DrizzleDB;
  thresholds: HermesPreflightThresholds;
  monotonicNow?: () => number;
  checkedAt?: () => Date;
  afterSnapshotEstablished?: () => Promise<void>;
}): Promise<HermesPreflightCheckReport> {
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const checkedAt = input.checkedAt ?? (() => new Date());
  const lockTimeoutMs = boundedMilliseconds(input.thresholds.maxLockMs, 'maxLockMs');
  const totalTimeoutMs = boundedMilliseconds(input.thresholds.maxTotalMs, 'maxTotalMs');
  const statementTimeoutMs = Math.min(lockTimeoutMs, totalTimeoutMs);

  return input.database.transaction(async (tx) => {
    // This must remain the first transaction command: every subsequent read is
    // from one immutable snapshot, including catalog and data classifications.
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`));
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`));

    const lockStartedAt = monotonicNow();
    const deadline = lockStartedAt + statementTimeoutMs;
    const beforeQuery = async (): Promise<void> => {
      const remainingMs = Math.ceil(deadline - monotonicNow());
      if (remainingMs <= 0) throw new Error('Hermes migration preflight transaction duration exceeded');
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${remainingMs}ms'`));
    };
    await tx.execute(sql`LOCK TABLE apikey, agents, hermes_agent_credentials, agent_permissions IN ACCESS SHARE MODE`);

    const invalidLegacyMetadata = await count(tx, sql`
      SELECT count(*)::int AS count
      FROM apikey
      WHERE metadata IS NOT NULL
        AND NOT pg_input_is_valid(metadata, 'jsonb')
    `, beforeQuery);
    await input.afterSnapshotEstablished?.();

    const duplicateSelections = await count(tx, sql`
      SELECT coalesce(sum(selected_count - 1), 0)::int AS count
      FROM (
        SELECT count(*)::int AS selected_count
        FROM agents
        WHERE type = 'external' AND handle_negotiations = true AND deleted_at IS NULL
        GROUP BY owner_id
        HAVING count(*) > 1
      ) duplicates
    `, beforeQuery);
    const invalidDedicatedCredentials = await count(tx, sql`
      SELECT count(*)::int AS count
      FROM hermes_agent_credentials credential
      LEFT JOIN agents agent ON agent.id = credential.agent_id
      WHERE credential.audience IS DISTINCT FROM 'hermes-agent'
        OR credential.actions IS DISTINCT FROM ARRAY['manage:identity', 'manage:premises', 'manage:intents', 'manage:networks', 'manage:opportunities', 'manage:negotiations']::text[]
        OR credential.owner_id = '' OR credential.agent_id = ''
        OR credential.installation_id = '' OR credential.setup_attempt_id = ''
        OR CASE credential.activation_state
          WHEN 'pending' THEN credential.activated_at IS NOT NULL OR credential.revoked_at IS NOT NULL
          WHEN 'active' THEN credential.activated_at IS NULL OR credential.revoked_at IS NOT NULL
          WHEN 'revoked' THEN credential.revoked_at IS NULL
          ELSE true
        END
        OR (credential.activation_state IN ('pending', 'active') AND (
          agent.id IS NULL OR agent.owner_id IS DISTINCT FROM credential.owner_id
          OR agent.type IS DISTINCT FROM 'external' OR agent.status IS DISTINCT FROM 'active'
          OR agent.runtime_kind IS DISTINCT FROM 'hermes'
          OR agent.installation_id IS DISTINCT FROM credential.installation_id
          OR agent.runtime_setup_attempt_id IS DISTINCT FROM credential.setup_attempt_id
          OR agent.deleted_at IS NOT NULL
        ))
        OR (credential.activation_state = 'pending' AND EXISTS (
          SELECT 1 FROM agent_permissions permission
          WHERE permission.agent_id = credential.agent_id
        ))
        OR (credential.activation_state = 'active' AND (
          1 <> (
            SELECT count(*) FROM agent_permissions permission
            WHERE permission.agent_id = credential.agent_id
              AND permission.user_id = credential.owner_id
              AND permission.scope = 'global'
              AND permission.scope_id IS NULL
              AND permission.actions = credential.actions
          )
          OR EXISTS (
            SELECT 1 FROM agent_permissions permission
            WHERE permission.agent_id = credential.agent_id
              AND (
                permission.user_id IS DISTINCT FROM credential.owner_id
                OR permission.scope IS DISTINCT FROM 'global'
                OR permission.scope_id IS NOT NULL
                OR permission.actions IS DISTINCT FROM credential.actions
              )
          )
        ))
        OR (credential.activation_state = 'revoked'
          AND NOT EXISTS (
            SELECT 1 FROM hermes_agent_credentials active_peer
            WHERE active_peer.agent_id = credential.agent_id
              AND active_peer.activation_state = 'active'
          )
          AND EXISTS (
            SELECT 1 FROM agent_permissions permission
            WHERE permission.agent_id = credential.agent_id
          ))
    `, beforeQuery);
    const expiryMismatches = await count(tx, sql`
      SELECT count(*)::int AS count
      FROM hermes_agent_credentials
      WHERE extract(epoch FROM (expires_at - issued_at)) <> 2592000
    `, beforeQuery);
    const missingIndexes = await countInvalidSchemaObjects(tx, beforeQuery);
    const lockDurationMs = Math.max(0, monotonicNow() - lockStartedAt);

    return {
      invalidLegacyMetadata,
      duplicateSelections,
      invalidDedicatedCredentials,
      expiryMismatches,
      missingIndexes,
      lockDurationMs,
      checkedAt: checkedAt().toISOString(),
    };
  });
}

if (import.meta.main) {
  runHermesPreflightMain({
    args: process.argv.slice(2),
    run: (thresholds) => runHermesMigrationPreflight({ database: db, thresholds }),
  }).then(closeDb).catch(async (error: unknown) => {
    // Fixed failure text only: database/provider errors can contain credentials.
    console.error(error instanceof Error && error.message.startsWith('Hermes migration preflight failed:')
      ? error.message
      : 'Hermes migration preflight failed safely.');
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
}
