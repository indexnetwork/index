#!/usr/bin/env bun
import { sql, type SQL } from 'drizzle-orm/sql';

import db, { closeDb, type DrizzleDB } from '../lib/drizzle/drizzle';
import { runHermesPreflightMain } from './hermes-migration-preflight.main';
import type { HermesPreflightReport } from './hermes-migration-preflight.contract';

type Transaction = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];
type CountRow = { count: number };
type IndexRow = {
  name: string;
  tableName: string;
  unique: boolean;
  valid: boolean;
  ready: boolean;
  method: string;
  columns: string[];
  predicate: string | null;
};
type ConstraintRow = {
  name: string;
  tableName: string;
  type: string;
  valid: boolean;
  definition: string;
};

const EXPECTED_INDEXES: readonly Omit<IndexRow, 'valid' | 'ready'>[] = [
  {
    name: 'uniq_agents_hermes_installation', tableName: 'agents', unique: true, method: 'btree',
    columns: ['owner_id', 'runtime_kind', 'installation_id'],
    predicate: "type='external'andruntime_kind='hermes'andinstallation_idisnotnullanddeleted_atisnull",
  },
  {
    name: 'uniq_agents_selected_negotiation_executor', tableName: 'agents', unique: true, method: 'btree',
    columns: ['owner_id'], predicate: "type='external'andhandle_negotiations=trueanddeleted_atisnull",
  },
  {
    name: 'hermes_agent_credentials_secret_hash_unique', tableName: 'hermes_agent_credentials', unique: true,
    method: 'btree', columns: ['secret_hash'], predicate: null,
  },
  {
    name: 'hermes_agent_credentials_live_installation_unique', tableName: 'hermes_agent_credentials', unique: true,
    method: 'btree', columns: ['owner_id', 'installation_id'],
    predicate: "activation_state=anyarray['pending','active']",
  },
  {
    name: 'hermes_agent_credentials_live_generation_unique', tableName: 'hermes_agent_credentials', unique: true,
    method: 'btree', columns: ['agent_id', 'setup_attempt_id'],
    predicate: "activation_state=anyarray['pending','active']",
  },
  {
    name: 'hermes_agent_credentials_expiry_idx', tableName: 'hermes_agent_credentials', unique: false,
    method: 'btree', columns: ['expires_at'], predicate: null,
  },
];

const EXPECTED_CONSTRAINTS: readonly Omit<ConstraintRow, 'valid'>[] = [
  {
    name: 'hermes_agent_credentials_pkey', tableName: 'hermes_agent_credentials', type: 'p',
    definition: 'primarykeyid',
  },
  {
    name: 'hermes_agent_credentials_owner_id_users_id_fk', tableName: 'hermes_agent_credentials', type: 'f',
    definition: 'foreignkeyowner_idreferencesusersidondeletecascade',
  },
  {
    name: 'hermes_agent_credentials_agent_id_agents_id_fk', tableName: 'hermes_agent_credentials', type: 'f',
    definition: 'foreignkeyagent_idreferencesagentsidondeletecascade',
  },
  {
    name: 'hermes_agent_credentials_audience_check', tableName: 'hermes_agent_credentials', type: 'c',
    definition: "audience='hermes-agent'",
  },
  {
    name: 'hermes_agent_credentials_actions_check', tableName: 'hermes_agent_credentials', type: 'c',
    definition: "actions=array['manage:identity','manage:premises','manage:intents','manage:networks','manage:opportunities','manage:negotiations']",
  },
  {
    name: 'hermes_agent_credentials_state_check', tableName: 'hermes_agent_credentials', type: 'c',
    definition: "activation_state=anyarray['pending','active','revoked']",
  },
  {
    name: 'hermes_agent_credentials_expiry_check', tableName: 'hermes_agent_credentials', type: 'c',
    definition: 'expires_at>issued_at',
  },
];

/** Reduce PostgreSQL's display-only casts/qualification while preserving the exact expression. */
function canonicalSql(value: string | null): string | null {
  if (value === null) return null;
  return value.toLowerCase()
    .replace(/"/g, '')
    .replace(/public\./g, '')
    .replace(/::[a-z_][a-z0-9_]*(?:\[\])?/g, '')
    .replace(/\bcheck\b/g, '')
    .replace(/[()\s]/g, '');
}

async function count(tx: Transaction, query: SQL): Promise<number> {
  const rows = await tx.execute(query) as unknown as CountRow[];
  return Number(rows[0]?.count ?? 0);
}

async function countInvalidSchemaObjects(tx: Transaction): Promise<number> {
  const indexes = await tx.execute(sql<IndexRow>`
    SELECT
      index_class.relname AS name,
      table_class.relname AS "tableName",
      index_catalog.indisunique AS "unique",
      index_catalog.indisvalid AS "valid",
      index_catalog.indisready AS "ready",
      access_method.amname AS "method",
      array_agg(attribute.attname ORDER BY key.ordinality) AS "columns",
      pg_get_expr(index_catalog.indpred, index_catalog.indrelid) AS "predicate"
    FROM pg_index index_catalog
    JOIN pg_class index_class ON index_class.oid = index_catalog.indexrelid
    JOIN pg_class table_class ON table_class.oid = index_catalog.indrelid
    JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
    JOIN pg_am access_method ON access_method.oid = index_class.relam
    JOIN LATERAL unnest(index_catalog.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinality) ON true
    JOIN pg_attribute attribute ON attribute.attrelid = table_class.oid AND attribute.attnum = key.attnum
    WHERE namespace.nspname = 'public'
      AND index_class.relname IN (${sql.join(EXPECTED_INDEXES.map((index) => sql`${index.name}`), sql`, `)})
    GROUP BY index_class.relname, table_class.relname, index_catalog.indisunique,
      index_catalog.indisvalid, index_catalog.indisready, access_method.amname,
      index_catalog.indpred, index_catalog.indrelid
  `) as unknown as IndexRow[];

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
      || actual.unique !== expected.unique
      || !actual.valid
      || !actual.ready
      || actual.method !== expected.method
      || actual.columns.join(',') !== expected.columns.join(',')
      || canonicalSql(actual.predicate) !== expected.predicate;
  }).length;

  const invalidConstraints = EXPECTED_CONSTRAINTS.filter((expected) => {
    const actual = constraints.find((constraint) => constraint.name === expected.name);
    return !actual
      || actual.tableName !== expected.tableName
      || actual.type !== expected.type
      || !actual.valid
      || canonicalSql(actual.definition) !== expected.definition;
  }).length;

  return invalidIndexes + invalidConstraints;
}

/**
 * Run only catalog and table reads under one read-only transaction. The legacy
 * metadata column is confirmed as `text` in `database.schema.ts` and migration
 * 0098; pg_input_is_valid classifies it before the guarded CASE can cast it.
 */
export async function runHermesMigrationPreflight(input: {
  database: DrizzleDB;
  monotonicNow?: () => number;
  checkedAt?: () => Date;
}): Promise<HermesPreflightReport> {
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const checkedAt = input.checkedAt ?? (() => new Date());

  return input.database.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const lockStartedAt = monotonicNow();
    await tx.execute(sql`LOCK TABLE apikey, agents, hermes_agent_credentials IN ACCESS SHARE MODE`);
    const lockDurationMs = Math.max(0, monotonicNow() - lockStartedAt);

    const invalidLegacyMetadata = await count(tx, sql`
      SELECT count(*)::int AS count
      FROM apikey
      WHERE metadata IS NOT NULL
        AND CASE
          WHEN pg_input_is_valid(metadata, 'jsonb')
            THEN jsonb_typeof(metadata::jsonb) <> 'object'
          ELSE true
        END
    `);
    const duplicateSelections = await count(tx, sql`
      SELECT coalesce(sum(selected_count - 1), 0)::int AS count
      FROM (
        SELECT count(*)::int AS selected_count
        FROM agents
        WHERE type = 'external' AND handle_negotiations = true AND deleted_at IS NULL
        GROUP BY owner_id
        HAVING count(*) > 1
      ) duplicates
    `);
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
          OR agent.type IS DISTINCT FROM 'external' OR agent.runtime_kind IS DISTINCT FROM 'hermes'
          OR agent.installation_id IS DISTINCT FROM credential.installation_id
          OR agent.runtime_setup_attempt_id IS DISTINCT FROM credential.setup_attempt_id
          OR agent.deleted_at IS NOT NULL
        ))
    `);
    const expiryMismatches = await count(tx, sql`
      SELECT count(*)::int AS count
      FROM hermes_agent_credentials
      WHERE expires_at <> issued_at + interval '30 days'
    `);
    const missingIndexes = await countInvalidSchemaObjects(tx);

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
    run: () => runHermesMigrationPreflight({ database: db }),
  }).then(closeDb).catch(async (error: unknown) => {
    // Fixed failure text only: database/provider errors can contain credentials.
    console.error(error instanceof Error && error.message.startsWith('Hermes migration preflight failed:')
      ? error.message
      : 'Hermes migration preflight failed safely.');
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
}
