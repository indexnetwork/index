import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import postgres from 'postgres';

import { validateTestDatabaseUrl } from '../test-database-readiness';

const apiRoot = path.resolve(import.meta.dir, '../../../..');
const migrationSql = readFileSync(
  path.join(apiRoot, 'drizzle/0141_normalize_negotiation_v2.sql'),
  'utf8',
);

type MigrationClient = ReturnType<typeof postgres>;

async function withScratchSchema(run: (client: MigrationClient) => Promise<void>): Promise<void> {
  const schema = `test_negotiation_v2_${randomUUID().replaceAll('-', '')}`;
  const client = postgres(validateTestDatabaseUrl(process.env.DATABASE_URL), {
    max: 1,
    prepare: false,
  });
  try {
    await client.unsafe(`CREATE SCHEMA "${schema}"`);
    await client.unsafe(`SET search_path TO "${schema}"`);
    await client.unsafe(`
      CREATE TABLE "tasks" (
        "id" text PRIMARY KEY,
        "metadata" jsonb NOT NULL
      );
      CREATE TABLE "messages" (
        "id" text PRIMARY KEY,
        "task_id" text NOT NULL REFERENCES "tasks"("id"),
        "sender_id" text NOT NULL,
        "parts" jsonb NOT NULL
      );
    `);
    await run(client);
  } finally {
    await client.unsafe('SET search_path TO public').catch(() => undefined);
    await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

async function taskMetadata(client: MigrationClient, id: string): Promise<Record<string, unknown>> {
  const rows = await client<Array<{ metadata: Record<string, unknown> }>>`
    SELECT "metadata" FROM "tasks" WHERE "id" = ${id}
  `;
  return rows[0]!.metadata;
}

async function action(client: MigrationClient, id: string): Promise<string> {
  const rows = await client<Array<{ action: string }>>`
    SELECT "parts"->0->'data'->>'action' AS action FROM "messages" WHERE "id" = ${id}
  `;
  return rows[0]!.action;
}

/**
 * Actual SQL coverage for 0141. It runs only when the explicit disposable-DB
 * gate is enabled; the scratch schema is dropped on every path.
 */
describe.skipIf(process.env.TEST_DATABASE_SAFE !== '1')('0141 negotiation v2 normalization (SQL)', () => {
  it('normalizes both seats, removes the marker only afterward, and is idempotent', async () => {
    await withScratchSchema(async (client) => {
      const taskId = 'task-safe';
      const metadata = {
        type: 'negotiation',
        protocolVersion: 'v1',
        sourceUserId: 'source',
        initiatorUserId: 'initiator',
        candidateUserId: 'candidate',
      };
      await client`
        INSERT INTO "tasks" ("id", "metadata") VALUES (${taskId}, ${client.json(metadata)})
      `;
      const rows = [
        ['message-propose', 'initiator', 'propose'],
        ['message-reject-initiator', 'initiator', 'reject'],
        ['message-reject-counterparty', 'candidate', 'reject'],
      ] as const;
      for (const [id, senderId, oldAction] of rows) {
        await client`
          INSERT INTO "messages" ("id", "task_id", "sender_id", "parts")
          VALUES (${id}, ${taskId}, ${senderId}, ${client.json([{ kind: 'data', data: { action: oldAction } }])})
        `;
      }

      await client.unsafe(migrationSql);
      expect(await action(client, 'message-propose')).toBe('outreach');
      expect(await action(client, 'message-reject-initiator')).toBe('withdraw');
      expect(await action(client, 'message-reject-counterparty')).toBe('decline');
      expect(taskMetadata(client, taskId)).resolves.not.toHaveProperty('protocolVersion');

      const afterFirstRun = await client<Array<{ id: string; metadata: unknown }>>`
        SELECT "id", "metadata" FROM "tasks" ORDER BY "id"
      `;
      const actionsAfterFirstRun = await client<Array<{ id: string; parts: unknown }>>`
        SELECT "id", "parts" FROM "messages" ORDER BY "id"
      `;
      await client.unsafe(migrationSql);
      expect(await client<Array<{ id: string; metadata: unknown }>>`
        SELECT "id", "metadata" FROM "tasks" ORDER BY "id"
      `).toEqual(afterFirstRun);
      expect(await client<Array<{ id: string; parts: unknown }>>`
        SELECT "id", "parts" FROM "messages" ORDER BY "id"
      `).toEqual(actionsAfterFirstRun);
    });
  }, 30_000);

  it('fails closed when a reject sender cannot be assigned a durable seat', async () => {
    await withScratchSchema(async (client) => {
      await client`
        INSERT INTO "tasks" ("id", "metadata") VALUES (
          'task-unsafe',
          ${client.json({ type: 'negotiation', protocolVersion: 'v1', sourceUserId: 'source', candidateUserId: 'candidate' })}
        )
      `;
      await client`
        INSERT INTO "messages" ("id", "task_id", "sender_id", "parts") VALUES (
          'message-unsafe', 'task-unsafe', 'unknown',
          ${client.json([{ kind: 'data', data: { action: 'reject' } }])}
        )
      `;
      // Execute the deliberately failing migration in an explicit transaction;
      // this also proves that the error leaves no partial normalization behind.
      await expect(client.begin((transaction) => transaction.unsafe(migrationSql)))
        .rejects.toThrow('Cannot normalize');
      expect(await action(client, 'message-unsafe')).toBe('reject');
      await expect(taskMetadata(client, 'task-unsafe')).resolves.toHaveProperty('protocolVersion', 'v1');
    });
  }, 30_000);
});
