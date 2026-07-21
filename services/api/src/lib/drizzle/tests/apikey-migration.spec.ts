import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import postgres from 'postgres';

import { validateTestDatabaseUrl } from '../test-database-readiness';

const apiRoot = path.resolve(import.meta.dir, '../../../..');
const originalMigration = readFileSync(
  path.join(apiRoot, 'drizzle/0038_add_apikey_table.sql'),
  'utf8',
);
const repairMigration = readFileSync(
  path.join(apiRoot, 'drizzle/0098_complete_apikey_schema.sql'),
  'utf8',
);
const requiredRepairColumns = [
  'config_id',
  'name',
  'prefix',
  'start',
  'rate_limit_max',
  'rate_limit_time_window',
  'remaining',
  'refill_amount',
  'refill_interval',
  'last_refill_at',
  'last_request',
  'metadata',
  'permissions',
] as const;

type MigrationClient = ReturnType<typeof postgres>;

async function withScratchSchema(
  run: (schema: string, client: MigrationClient) => Promise<void>,
): Promise<void> {
  if (process.env.TEST_DATABASE_SAFE !== '1') {
    throw new Error('API-key migration tests require TEST_DATABASE_SAFE=1.');
  }
  const schema = `test_apikey_${randomUUID().replaceAll('-', '')}`;
  const client = postgres(validateTestDatabaseUrl(process.env.DATABASE_URL), {
    max: 1,
    prepare: false,
  });

  try {
    await client.unsafe(`CREATE SCHEMA "${schema}"`);
    await client.unsafe(`SET search_path TO "${schema}"`);
    await client.unsafe('CREATE TABLE "users" ("id" text PRIMARY KEY NOT NULL)');
    await run(schema, client);
  } finally {
    await client.unsafe('SET search_path TO public').catch(() => undefined);
    await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

async function readColumns(client: MigrationClient, schema: string) {
  return client<Array<{ column_name: string; column_default: string | null; is_nullable: string }>>`
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = 'apikey'
  `;
}

describe.serial('API-key forward migration', () => {
  it(
    'builds the repaired table from the immutable historical migration',
    async () => {
      await withScratchSchema(async (schema, client) => {
        await client.unsafe(originalMigration);
        await client.unsafe(repairMigration);
        const columns = await readColumns(client, schema);
        const names = columns.map((column) => column.column_name);

        for (const column of requiredRepairColumns) expect(names).toContain(column);
        expect(columns.find((column) => column.column_name === 'user_id')?.is_nullable).toBe('YES');
        expect(columns.find((column) => column.column_name === 'config_id')?.column_default).toContain(
          'default',
        );

        await client.unsafe(
          `INSERT INTO "apikey" ("id", "key", "reference_id") VALUES ('reference-only', 'hash', 'agent')`,
        );
      });
    },
    30_000,
  );

  it(
    'upgrades an old 0038 database idempotently without losing rows',
    async () => {
      await withScratchSchema(async (schema, client) => {
        await client.unsafe(originalMigration);
        await client.unsafe(`INSERT INTO "users" ("id") VALUES ('user-1')`);
        await client.unsafe(
          `INSERT INTO "apikey" ("id", "key", "user_id") VALUES ('existing', 'hash', 'user-1')`,
        );

        const before = await readColumns(client, schema);
        expect(before.find((column) => column.column_name === 'user_id')?.is_nullable).toBe('NO');
        expect(before.some((column) => column.column_name === 'config_id')).toBe(false);

        await client.unsafe(repairMigration);
        await client.unsafe(repairMigration);

        const after = await readColumns(client, schema);
        for (const column of requiredRepairColumns) {
          expect(after.some((entry) => entry.column_name === column)).toBe(true);
        }
        expect(after.find((column) => column.column_name === 'user_id')?.is_nullable).toBe('YES');
        const rows = await client<Array<{ config_id: string; user_id: string }>>`
          SELECT config_id, user_id FROM apikey WHERE id = 'existing'
        `;
        expect(rows).toEqual([{ config_id: 'default', user_id: 'user-1' }]);
      });
    },
    30_000,
  );
});

describe('API-key migration history', () => {
  it('keeps 0038 historical and records the forward repair after the current tip', () => {
    expect(originalMigration).toContain('"user_id" text NOT NULL');
    for (const column of requiredRepairColumns) {
      expect(originalMigration).not.toContain(`"${column}"`);
      expect(repairMigration).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`);
    }
    expect(repairMigration).toContain('ALTER COLUMN "user_id" DROP NOT NULL');

    const journal = JSON.parse(
      readFileSync(path.join(apiRoot, 'drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const repair = journal.entries.at(-1);
    expect(repair).toEqual({
      idx: 98,
      version: '7',
      when: 1784452865792,
      tag: '0098_complete_apikey_schema',
      breakpoints: true,
    });
    expect(repair!.when).toBeGreaterThan(journal.entries.at(-2)!.when);
    expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(journal.entries.length);
    expect(new Set(journal.entries.map((entry) => entry.tag)).size).toBe(journal.entries.length);
  });
});
