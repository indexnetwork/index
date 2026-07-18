import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(import.meta.dir, '../../../../../../.env.test'), override: true });

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const migrationPath = resolve(
  import.meta.dir,
  '../../../../drizzle/0096_normalize_opportunity_actor_intents.sql',
);
const migrationSql = readFileSync(migrationPath, 'utf8');

let client: ReturnType<typeof postgres>;

beforeAll(() => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for migration behavior tests');
  client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
});

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe('0096 opportunity actor intent normalization', () => {
  it('removes only malformed keys, preserves actor order and untouched rows, and is idempotent', async () => {
    await client.begin(async (sql) => {
      await sql.unsafe(`
        CREATE TEMP TABLE "opportunities" (
          "id" text PRIMARY KEY,
          "actors" jsonb NOT NULL
        ) ON COMMIT DROP
      `);

      const affectedActors = [
        { slot: 'first', intent: ' NULL ', nested: { keep: true } },
        { slot: 'second', untouched: 'value' },
        { slot: 'third', intent: 'undefined', count: 3 },
        { slot: 'fourth', intent: ' intent-1 ', valid: true },
      ];
      const untouchedActors = [
        { slot: 'only', intent: 'intent-2', nested: ['preserve', 2] },
      ];
      await sql`
        INSERT INTO "opportunities" ("id", "actors")
        VALUES
          ('affected', ${sql.json(affectedActors)}),
          ('untouched', ${sql.json(untouchedActors)}),
          ('not-an-array', ${sql.json({ intent: 'null' })})
      `;

      const firstRun = await sql.unsafe(migrationSql);
      expect(firstRun.count).toBe(1);

      const rows = await sql<{ id: string; actors: unknown }[]>`
        SELECT "id", "actors"
        FROM "opportunities"
        ORDER BY "id"
      `;
      const byId = new Map(rows.map((row) => [row.id, row.actors]));
      expect(byId.get('affected')).toEqual([
        { slot: 'first', nested: { keep: true } },
        { slot: 'second', untouched: 'value' },
        { slot: 'third', count: 3 },
        { slot: 'fourth', intent: ' intent-1 ', valid: true },
      ]);
      expect(byId.get('untouched')).toEqual(untouchedActors);
      expect(byId.get('not-an-array')).toEqual({ intent: 'null' });

      const secondRun = await sql.unsafe(migrationSql);
      expect(secondRun.count).toBe(0);
    });
  });
});
