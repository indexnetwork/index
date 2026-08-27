#!/usr/bin/env node
/**
 * Read-only anonymized export of matching data for a network (default: Edge Esmeralda).
 *
 * Usage:
 *   RESEARCH_HMAC_SECRET=... DATABASE_URL=... bun ./src/cli/export-research-dump.ts --confirm --out /path
 *   Optional: --network <id|key|title>
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', envFile) });

import { mkdir, writeFile } from 'node:fs/promises';

import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm/sql';
import postgres from 'postgres';

import * as schema from '../schemas/database.schema';
import { buildDictionary, buildMetrics, renderDatasetCard, transformIntents, transformNegotiations, transformOpportunities, transformUsers, type RawArtifact, type RawIntent, type RawNegotiationMessage, type RawNegotiationTask, type RawOpportunity, type RawSocial, type RawUser } from './research-export/transform';

function inList(ids: string[]) {
  return sql`(${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
}

interface Args {
  confirm: boolean;
  out: string | null;
  network: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { confirm: false, out: null, network: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--confirm') args.confirm = true;
    else if (token === '--out') args.out = argv[++i] ?? null;
    else if (token === '--network') args.network = argv[++i] ?? null;
  }
  return args;
}

async function writeJsonl(file: string, rows: object[]): Promise<void> {
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  await writeFile(file, body ? `${body}\n` : '');
}

type ExportDb = ReturnType<typeof drizzle<typeof schema>>;

async function resolveNetwork(db: ExportDb, query: string | null) {
  const rows = query
    ? await db
        .select({ id: schema.networks.id, title: schema.networks.title, key: schema.networks.key })
        .from(schema.networks)
        .where(and(
          isNull(schema.networks.deletedAt),
          or(
            eq(schema.networks.id, query),
            eq(schema.networks.key, query),
            sql`lower(${schema.networks.title}) = lower(${query})`,
          ),
        ))
    : await db
        .select({ id: schema.networks.id, title: schema.networks.title, key: schema.networks.key })
        .from(schema.networks)
        .where(and(
          isNull(schema.networks.deletedAt),
          sql`(lower(${schema.networks.title}) like '%edge esmeralda%' or lower(${schema.networks.title}) like '%edge city%' or lower(coalesce(${schema.networks.key}, '')) like '%esmeralda%')`,
        ));
  if (rows.length === 0) throw new Error(query ? `No network matched ${query}` : 'No Edge Esmeralda network found');
  if (rows.length > 1) {
    throw new Error(`Multiple networks matched; pass --network with an exact id/key/title: ${rows.map((row) => `${row.title} (${row.id})`).join('; ')}`);
  }
  return rows[0];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const secret = process.env.RESEARCH_HMAC_SECRET;
  if (!args.confirm) {
    console.error('Refusing to export without --confirm');
    process.exit(1);
  }
  if (!args.out) {
    console.error('Missing --out <dir>');
    process.exit(1);
  }
  if (!secret) {
    console.error('RESEARCH_HMAC_SECRET is required');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  try {
    await client`SET default_transaction_read_only = on`;
  const network = await resolveNetwork(db, args.network);
  console.log(`[export-research-dump] Network ${network.title}`);

  const memberships = await db
    .select({ userId: schema.networkMembers.userId })
    .from(schema.networkMembers)
    .where(eq(schema.networkMembers.networkId, network.id));
  const memberIds = [...new Set(memberships.map((row) => row.userId))];
  if (memberIds.length === 0) throw new Error('Network has no members');

  const users = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      key: schema.users.key,
      intro: schema.users.intro,
      onboarding: schema.users.onboarding,
      createdAt: schema.users.createdAt,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, memberIds)) as RawUser[];

  const socials = await db
    .select({ userId: schema.userSocials.userId, value: schema.userSocials.value })
    .from(schema.userSocials)
    .where(inArray(schema.userSocials.userId, memberIds)) as RawSocial[];

  const notificationRows = await db
    .select({ preferences: schema.userNotificationSettings.preferences })
    .from(schema.userNotificationSettings)
    .where(inArray(schema.userNotificationSettings.userId, memberIds));
  const telegramChatIds = notificationRows
    .map((row) => row.preferences?.telegram?.chatId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const assignedIntentIds = await db
    .select({ intentId: schema.intentNetworks.intentId })
    .from(schema.intentNetworks)
    .where(eq(schema.intentNetworks.networkId, network.id));

  const intents = await db
    .select({
      id: schema.intents.id,
      userId: schema.intents.userId,
      payload: schema.intents.payload,
      summary: schema.intents.summary,
      status: schema.intents.status,
      isIncognito: schema.intents.isIncognito,
      createdAt: schema.intents.createdAt,
      updatedAt: schema.intents.updatedAt,
      archivedAt: schema.intents.archivedAt,
    })
    .from(schema.intents)
    .where(or(
      inArray(schema.intents.userId, memberIds),
      assignedIntentIds.length > 0 ? inArray(schema.intents.id, assignedIntentIds.map((row) => row.intentId)) : sql`1 = 0`,
    )) as RawIntent[];

  const opportunityRows = await db
    .select({
      id: schema.opportunities.id,
      detection: schema.opportunities.detection,
      actors: schema.opportunities.actors,
      interpretation: schema.opportunities.interpretation,
      context: schema.opportunities.context,
      confidence: schema.opportunities.confidence,
      status: schema.opportunities.status,
      acceptedBy: schema.opportunities.acceptedBy,
      createdAt: schema.opportunities.createdAt,
      updatedAt: schema.opportunities.updatedAt,
      expiresAt: schema.opportunities.expiresAt,
    })
    .from(schema.opportunities)
    .where(sql`
      ${schema.opportunities.context}->>'networkId' = ${network.id}
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(${schema.opportunities.actors}) AS actor
        WHERE actor->>'networkId' = ${network.id}
           OR actor->>'userId' IN ${inList(memberIds)}
      )
    `) as RawOpportunity[];

  const taskRows = await db
    .select({
      id: schema.tasks.id,
      conversationId: schema.tasks.conversationId,
      state: schema.tasks.state,
      createdAt: schema.tasks.createdAt,
      metadata: schema.tasks.metadata,
    })
    .from(schema.tasks)
    .where(sql`
      ${schema.tasks.metadata}->>'type' = 'negotiation'
      AND (
        ${schema.tasks.metadata}->>'networkId' = ${network.id}
        OR ${schema.tasks.metadata}->>'sourceUserId' IN ${inList(memberIds)}
        OR ${schema.tasks.metadata}->>'candidateUserId' IN ${inList(memberIds)}
      )
    `);

  const tasks: RawNegotiationTask[] = taskRows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    state: row.state,
    createdAt: row.createdAt,
    metadata: (row.metadata ?? {}) as RawNegotiationTask['metadata'],
  }));
  const taskIds = tasks.map((task) => task.id);

  const messages: RawNegotiationMessage[] = taskIds.length === 0
    ? []
    : await db
        .select({
          taskId: schema.messages.taskId,
          senderId: schema.messages.senderId,
          parts: schema.messages.parts,
          createdAt: schema.messages.createdAt,
          id: schema.messages.id,
        })
        .from(schema.messages)
        .where(inArray(schema.messages.taskId, taskIds))
        .then((rows) => rows.filter((row): row is RawNegotiationMessage => typeof row.taskId === 'string'));

  const artifacts: RawArtifact[] = taskIds.length === 0
    ? []
    : await db
        .select({
          taskId: schema.artifacts.taskId,
          name: schema.artifacts.name,
          parts: schema.artifacts.parts,
        })
        .from(schema.artifacts)
        .where(and(
          inArray(schema.artifacts.taskId, taskIds),
          eq(schema.artifacts.name, 'negotiation-outcome'),
        ));

  const terms = buildDictionary({ users, socials, telegramChatIds });
  const outUsers = transformUsers(secret, users);
  const outIntents = transformIntents(secret, intents, terms);
  const outOpportunities = transformOpportunities(secret, opportunityRows, terms);
  const outNegotiations = transformNegotiations(secret, tasks, messages, artifacts, terms);
  const metrics = buildMetrics({
    networkTitle: network.title,
    networkIdKind: 'network',
    networkRawId: network.id,
    secret,
    users: outUsers,
    intents: outIntents,
    opportunities: outOpportunities,
    negotiations: outNegotiations,
  });

  await mkdir(args.out, { recursive: true });
  await writeJsonl(path.join(args.out, 'users.jsonl'), outUsers);
  await writeJsonl(path.join(args.out, 'intents.jsonl'), outIntents);
  await writeJsonl(path.join(args.out, 'opportunities.jsonl'), outOpportunities);
  await writeJsonl(path.join(args.out, 'negotiations.jsonl'), outNegotiations);
  await writeFile(path.join(args.out, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  await writeFile(path.join(args.out, 'DATASET.md'), renderDatasetCard(metrics));

  console.log(`[export-research-dump] Wrote ${args.out}`);
  console.log(JSON.stringify({
    users: metrics.users,
    intents: metrics.intents,
    opportunities: metrics.opportunities,
    opportunities_by_status: metrics.opportunities_by_status,
    negotiations: metrics.negotiations,
    negotiations_screened_out: metrics.negotiations_screened_out,
  }));
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[export-research-dump] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
