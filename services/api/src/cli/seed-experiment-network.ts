#!/usr/bin/env node
/**
 * Seed an experiment network with headless historical-figure personas.
 *
 * Reuses the same persona fixtures as `db-seed` (Tesla, Curie, Darwin, …) and
 * provisions them as full Index Network users — network membership and intents
 * — but without minting per-user agents or API keys. They are pure record-only
 * stand-ins: when an opportunity dispatches to one, no personal agent is online
 * and the system negotiator runs inline (the existing `last_seen_at` fallback
 * path).
 *
 * Idempotent: re-running skips memberships that already exist, and skips
 * intents whose description already exists for that user.
 *
 * Production safety (all three checks must pass):
 *   1. NODE_ENV !== 'production'
 *   2. DATABASE_URL contains no known production Neon markers
 *   3. The target network is fully configured for experiment mode
 *      (`isExperiment=true` AND `experimentMasterKeyHash IS NOT NULL`)
 *
 * Usage:
 *   bun run maintenance:seed-experiment-network -- --confirm
 *   bun run maintenance:seed-experiment-network -- --network=<uuid> --personas=20 --confirm
 */
import dotenv from 'dotenv';
import path from 'path';
import { and, eq, isNull, sql } from 'drizzle-orm';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import db, { closeDb } from '../lib/drizzle/drizzle';
import { ensurePersonalNetwork } from '../adapters/database.adapter';
import { intents, networkMembers, networks, users, userSocials } from '../schemas/database.schema';
import { intentService } from '../services/intent.service';

import { TESTER_PERSONAS, TESTER_PERSONAS_MAX } from './test-data';
import type { TesterPersona } from './test-data';

const EDGE_CITY_NETWORK_ID = 'fee18edc-1e60-4b13-b8c8-20e6f6ed1acb';

/** Substrings that uniquely identify the Protocol production Neon endpoints. */
const PROD_DB_MARKERS = ['shiny-cloud', 'br-fragrant-brook'];

interface CliOpts {
  networkId: string;
  personas: number;
  confirm: boolean;
}

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);

  const networkArg = args.find((a) => a.startsWith('--network='));
  const networkId = networkArg ? networkArg.split('=')[1] : EDGE_CITY_NETWORK_ID;

  let personas = TESTER_PERSONAS_MAX;
  const personasArg = args.find((a) => a.startsWith('--personas='));
  if (personasArg) {
    const value = parseInt(personasArg.split('=')[1], 10);
    if (!Number.isNaN(value)) {
      personas = Math.max(0, Math.min(TESTER_PERSONAS_MAX, value));
    }
  }

  return {
    networkId,
    personas,
    confirm: args.includes('--confirm'),
  };
}

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error('error: refuses to run with NODE_ENV=production');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL ?? '';
  for (const marker of PROD_DB_MARKERS) {
    if (url.includes(marker)) {
      console.error(`error: DATABASE_URL contains production marker "${marker}" — aborting`);
      process.exit(1);
    }
  }
}

async function assertExperimentNetwork(networkId: string): Promise<void> {
  const [row] = await db
    .select({
      id: networks.id,
      title: networks.title,
      isExperiment: networks.isExperiment,
      experimentMasterKeyHash: networks.experimentMasterKeyHash,
      deletedAt: networks.deletedAt,
    })
    .from(networks)
    .where(eq(networks.id, networkId))
    .limit(1);

  if (!row) {
    console.error(`error: network ${networkId} not found`);
    process.exit(1);
  }
  if (row.deletedAt) {
    console.error(`error: network ${networkId} is soft-deleted`);
    process.exit(1);
  }
  if (!row.isExperiment || !row.experimentMasterKeyHash) {
    console.error(
      `error: network ${networkId} ("${row.title}") is not a fully configured experiment network ` +
        `(requires isExperiment=true AND experimentMasterKeyHash set)`,
    );
    process.exit(1);
  }
  console.log(`target network: ${row.title} (${networkId})`);
}

async function ensureUser(persona: TesterPersona): Promise<{ id: string; created: boolean }> {
  const email = persona.email.toLowerCase().trim();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)))
    .limit(1);
  if (existing) return { id: existing.id, created: false };

  const [created] = await db
    .insert(users)
    .values({
      email,
      name: persona.name,
      intro: `Test account for ${persona.name}`,
      onboarding: { completedAt: new Date().toISOString() },
    })
    .returning({ id: users.id });

  const userId = created!.id;

  const socialRows: { userId: string; label: string; value: string }[] = [];
  if (persona.linkedin) socialRows.push({ userId, label: 'linkedin', value: persona.linkedin });
  if (persona.github) socialRows.push({ userId, label: 'github', value: persona.github });
  if (persona.x) socialRows.push({ userId, label: 'twitter', value: persona.x });
  if (persona.website) socialRows.push({ userId, label: 'custom', value: persona.website });
  if (socialRows.length > 0) {
    await db.insert(userSocials).values(socialRows);
  }

  return { id: userId, created: true };
}

async function joinNetwork(userId: string, networkId: string): Promise<boolean> {
  const inserted = await db
    .insert(networkMembers)
    .values({
      networkId,
      userId,
      permissions: ['member'],
      prompt: null,
      autoAssign: true,
    })
    .onConflictDoNothing()
    .returning({ userId: networkMembers.userId });
  return inserted.length > 0;
}

async function intentExists(userId: string, description: string): Promise<boolean> {
  const [row] = await db
    .select({ id: intents.id })
    .from(intents)
    .where(
      and(
        eq(intents.userId, userId),
        eq(intents.payload, description),
        isNull(intents.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

interface RunStats {
  usersCreated: number;
  usersReused: number;
  membershipsAdded: number;
  membershipsExisting: number;
  intentsCreated: number;
  intentsSkipped: number;
  intentsFailed: number;
}

async function run(): Promise<void> {
  const opts = parseArgs();

  if (!opts.confirm) {
    console.log('Refusing to run without --confirm.');
    console.log('Usage: bun run maintenance:seed-experiment-network -- [--network=<uuid>] [--personas=<N>] --confirm');
    process.exit(1);
  }

  assertNotProduction();

  console.log(`db: ${process.env.DATABASE_URL?.replace(/:[^@:]+@/, ':***@') ?? '<unset>'}`);
  await assertExperimentNetwork(opts.networkId);

  const slice = TESTER_PERSONAS.slice(0, opts.personas);
  console.log(`personas: ${slice.length}/${TESTER_PERSONAS_MAX}`);
  console.log('');

  const stats: RunStats = {
    usersCreated: 0,
    usersReused: 0,
    membershipsAdded: 0,
    membershipsExisting: 0,
    intentsCreated: 0,
    intentsSkipped: 0,
    intentsFailed: 0,
  };

  const personaUsers: { id: string }[] = [];

  for (let i = 0; i < slice.length; i++) {
    const persona = slice[i];
    const tag = `[${i + 1}/${slice.length}] ${persona.name}`;

    const { id, created } = await ensureUser(persona);
    personaUsers.push({ id });
    if (created) stats.usersCreated++;
    else stats.usersReused++;

    await ensurePersonalNetwork(id);

    const added = await joinNetwork(id, opts.networkId);
    if (added) stats.membershipsAdded++;
    else stats.membershipsExisting++;

    console.log(`${tag} — user ${created ? 'created' : 'reused'}, ${added ? 'joined' : 'already in'} network`);
  }

  console.log('');
  console.log('Creating intents (skip if same description already exists)...');
  for (let i = 0; i < slice.length; i++) {
    const persona = slice[i];
    const userId = personaUsers[i].id;
    for (const intentText of persona.intents) {
      if (await intentExists(userId, intentText)) {
        stats.intentsSkipped++;
        continue;
      }
      try {
        await intentService.createIntentForSeed(userId, intentText);
        stats.intentsCreated++;
      } catch (err) {
        stats.intentsFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  intent failed for ${persona.name}: ${msg.slice(0, 100)}`);
      }
    }
  }

  console.log('');
  console.log('Summary');
  console.log('-------');
  console.log(`  users:        ${stats.usersCreated} created, ${stats.usersReused} reused`);
  console.log(`  memberships:  ${stats.membershipsAdded} joined, ${stats.membershipsExisting} already members`);
  console.log(`  intents:      ${stats.intentsCreated} created, ${stats.intentsSkipped} skipped${stats.intentsFailed > 0 ? `, ${stats.intentsFailed} failed` : ''}`);
}

run()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('seed-experiment-network error:', msg);
    await closeDb();
    process.exit(1);
  });
