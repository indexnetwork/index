import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import postgres from 'postgres';

import { migrateAgentPermissionActions } from '../permission-action-migration';
import { validateTestDatabaseUrl } from '../test-database-readiness';

/**
 * Actual-SQL verification for the durable permission migration (IND-606/607).
 *
 * A pure transform unit spec cannot prove the SQL itself is correct, so this
 * spec runs `0109_migrate_agent_permission_actions.sql` against a real Postgres
 * instance inside a disposable scratch schema (mirrors the API-key migration
 * spec pattern).
 *
 * It is gated on `TEST_DATABASE_SAFE=1` and a disposable `DATABASE_URL`. This
 * gate is intentionally left UNSET in the wave — no disposable database is
 * proven — so this spec is SKIPPED locally and its DB gate is reported as such.
 * Never point it at Neon, dev, shared, staging, or production.
 */
const apiRoot = path.resolve(import.meta.dir, '../../../..');
const migrationSql = readFileSync(
  path.join(apiRoot, 'drizzle/0109_migrate_agent_permission_actions.sql'),
  'utf8',
);

type MigrationClient = ReturnType<typeof postgres>;

interface PermissionRow {
  id: string;
  agent_id: string;
  user_id: string;
  scope: string;
  scope_id: string | null;
  actions: string[];
}

async function withScratchSchema(
  run: (client: MigrationClient) => Promise<void>,
): Promise<void> {
  if (process.env.TEST_DATABASE_SAFE !== '1') {
    throw new Error(
      'Permission-action migration integration tests require TEST_DATABASE_SAFE=1 and a disposable database.',
    );
  }
  const schema = `test_perm_actions_${randomUUID().replaceAll('-', '')}`;
  const client = postgres(validateTestDatabaseUrl(process.env.DATABASE_URL), {
    max: 1,
    prepare: false,
  });

  try {
    await client.unsafe(`CREATE SCHEMA "${schema}"`);
    await client.unsafe(`SET search_path TO "${schema}"`);
    // Standalone shape of agent_permissions; the migration is a pure UPDATE on
    // `actions`, so FKs to agents/users are unnecessary for behavior coverage.
    await client.unsafe(`
      CREATE TABLE "agent_permissions" (
        "id" text PRIMARY KEY,
        "agent_id" text NOT NULL,
        "user_id" text NOT NULL,
        "scope" text NOT NULL DEFAULT 'global',
        "scope_id" text,
        "actions" text[] NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await run(client);
  } finally {
    await client.unsafe('SET search_path TO public').catch(() => undefined);
    await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

async function seed(client: MigrationClient, rows: Omit<PermissionRow, 'id'>[]): Promise<string[]> {
  const ids: string[] = [];
  for (const row of rows) {
    const id = randomUUID();
    ids.push(id);
    await client`
      INSERT INTO "agent_permissions"
        ("id", "agent_id", "user_id", "scope", "scope_id", "actions")
      VALUES (
        ${id}, ${row.agent_id}, ${row.user_id}, ${row.scope}, ${row.scope_id},
        ${client.array(row.actions)}
      )
    `;
  }
  return ids;
}

async function readRows(client: MigrationClient): Promise<Map<string, PermissionRow>> {
  const rows = await client<PermissionRow[]>`
    SELECT "id", "agent_id", "user_id", "scope", "scope_id", "actions"
    FROM "agent_permissions"
  `;
  return new Map(rows.map((row) => [row.id, row]));
}

// Cleanly SKIP (not fail) when the disposable-database gate is absent, so the
// DB gate is reported as skipped rather than red. The withScratchSchema guard
// remains as defense-in-depth if the gate is ever set without a real DB.
describe.skipIf(process.env.TEST_DATABASE_SAFE !== '1')('0109 agent-permission action migration (SQL)', () => {
  it(
    'rewrites affected rows, preserves owner/scope, leaves the control group untouched, and is idempotent',
    async () => {
      await withScratchSchema(async (client) => {
        const [profileId, contactsOnlyId, mixedId, controlId, negOnlyId, unorderedControlId] = await seed(client, [
          // Legacy default pairing: profile + contacts + others.
          {
            agent_id: 'agent-1',
            user_id: 'owner-1',
            scope: 'global',
            scope_id: null,
            actions: ['manage:profile', 'manage:contacts', 'manage:intents', 'manage:networks', 'manage:opportunities'],
          },
          // Contacts-only -> collapses to empty, row preserved.
          {
            agent_id: 'agent-2',
            user_id: 'owner-2',
            scope: 'network',
            scope_id: 'net-1',
            actions: ['manage:contacts'],
          },
          // Profile overlaps an existing premises grant -> dedupe, no broadening.
          {
            agent_id: 'agent-3',
            user_id: 'owner-3',
            scope: 'network',
            scope_id: 'net-2',
            actions: ['manage:premises', 'manage:profile'],
          },
          // Control group: already canonical, must not change at all.
          {
            agent_id: 'agent-4',
            user_id: 'owner-4',
            scope: 'global',
            scope_id: null,
            actions: ['manage:identity', 'manage:premises', 'manage:intents'],
          },
          // Control group: negotiations-only.
          {
            agent_id: 'agent-5',
            user_id: 'owner-5',
            scope: 'network',
            scope_id: 'net-3',
            actions: ['manage:negotiations'],
          },
          // Control group, deliberately NOT in canonical order: the SQL must
          // leave it byte-for-byte unchanged (it does not re-order control rows,
          // even though the pure helper would normalize the order).
          {
            agent_id: 'agent-6',
            user_id: 'owner-6',
            scope: 'global',
            scope_id: null,
            actions: ['manage:networks', 'manage:intents'],
          },
        ]);

        const before = await readRows(client);

        const firstRun = await client.unsafe(migrationSql);
        // Only the three affected rows are updated; the four control rows
        // (including the unordered one) are never touched.
        expect(firstRun.count).toBe(3);

        const after = await readRows(client);

        // Affected rows match the pure transform exactly.
        expect(after.get(profileId)!.actions).toEqual(
          migrateAgentPermissionActions(before.get(profileId)!.actions),
        );
        expect(after.get(profileId)!.actions).toEqual([
          'manage:identity',
          'manage:premises',
          'manage:intents',
          'manage:networks',
          'manage:opportunities',
        ]);
        expect(after.get(contactsOnlyId)!.actions).toEqual([]);
        expect(after.get(mixedId)!.actions).toEqual(['manage:identity', 'manage:premises']);

        // Owner/scope/scopeId preserved on every affected row.
        for (const id of [profileId, contactsOnlyId, mixedId]) {
          const b = before.get(id)!;
          const a = after.get(id)!;
          expect(a.user_id).toBe(b.user_id);
          expect(a.agent_id).toBe(b.agent_id);
          expect(a.scope).toBe(b.scope);
          expect(a.scope_id).toBe(b.scope_id);
        }

        // Control group is byte-for-byte unchanged — including the row whose
        // actions are not in canonical order (the SQL does not normalize it).
        expect(after.get(controlId)!.actions).toEqual(before.get(controlId)!.actions);
        expect(after.get(negOnlyId)!.actions).toEqual(before.get(negOnlyId)!.actions);
        expect(after.get(unorderedControlId)!.actions).toEqual(['manage:networks', 'manage:intents']);

        // No surviving retired action anywhere (postcondition).
        const retired = await client<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS count FROM "agent_permissions"
          WHERE "actions" && ARRAY['manage:profile', 'manage:contacts']::text[]
        `;
        expect(retired[0]!.count).toBe(0);

        // Idempotent: a second run changes nothing.
        const secondRun = await client.unsafe(migrationSql);
        expect(secondRun.count).toBe(0);
        expect(await readRows(client)).toEqual(after);
      });
    },
    30_000,
  );

  it(
    'never drops, duplicates, or reassigns a row',
    async () => {
      await withScratchSchema(async (client) => {
        await seed(client, [
          { agent_id: 'a', user_id: 'u1', scope: 'global', scope_id: null, actions: ['manage:profile'] },
          { agent_id: 'a', user_id: 'u2', scope: 'global', scope_id: null, actions: ['manage:contacts'] },
          { agent_id: 'a', user_id: 'u3', scope: 'global', scope_id: null, actions: ['manage:intents'] },
        ]);
        const before = await client<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "agent_permissions"`;
        await client.unsafe(migrationSql);
        const after = await client<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "agent_permissions"`;
        expect(after[0]!.count).toBe(before[0]!.count);
      });
    },
    30_000,
  );
});
