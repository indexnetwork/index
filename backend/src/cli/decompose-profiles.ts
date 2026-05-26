#!/usr/bin/env node
/**
 * Backfill CLI: decompose existing user profiles into atomic premises.
 * Finds users with profiles but no active premises, uses the PremiseDecomposer
 * to extract atomic statements, and creates each via the premise graph.
 *
 * Usage: bun run maintenance:decompose-profiles [--limit=N] [--dry-run]
 * Default limit: 100.
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, eq, isNull } from 'drizzle-orm';
import { PremiseDecomposer, PremiseGraphFactory } from '@indexnetwork/protocol';
import type { PremiseGraphDatabase } from '@indexnetwork/protocol';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { premises, userProfiles, users } from '../schemas/database.schema';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { premiseQueue } from '../queues/premise.queue';

const DEFAULT_LIMIT = 100;

/** Enrichment-path confidence — lower than explicit (1.0) since these are derived from profile text. */
const ENRICHMENT_CONFIDENCE = 0.85;

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { limit: number; dryRun: boolean } {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const dryRun = args.includes('--dry-run');

  let limit = DEFAULT_LIMIT;
  if (limitArg) {
    const val = parseInt(limitArg.split('=')[1], 10);
    if (!Number.isNaN(val) && val > 0) limit = val;
  }

  return { limit, dryRun };
}

// ---------------------------------------------------------------------------
// Inline profile field types (mirroring the schema's json columns)
// ---------------------------------------------------------------------------

interface ProfileIdentity { name: string; bio: string; location: string }
interface ProfileNarrative { context: string }
interface ProfileAttributes { interests: string[]; skills: string[] }

// ---------------------------------------------------------------------------
// Profile text builder
// ---------------------------------------------------------------------------

/**
 * Assembles a text blob from profile fields, skipping empty values.
 * @param identity - The user's identity data (name, bio, location).
 * @param narrative - The user's narrative context.
 * @param attributes - The user's skills and interests.
 * @returns A newline-joined text suitable for premise decomposition.
 */
function buildProfileText(
  identity: ProfileIdentity | null,
  narrative: ProfileNarrative | null,
  attributes: ProfileAttributes | null,
): string {
  const lines: string[] = [];
  if (identity?.name) lines.push(`My name is ${identity.name}.`);
  if (identity?.location) lines.push(`I am based in ${identity.location}.`);
  if (identity?.bio) lines.push(identity.bio);
  if (narrative?.context) lines.push(narrative.context);
  if (attributes?.skills?.length) lines.push(`My skills include ${attributes.skills.join(', ')}.`);
  if (attributes?.interests?.length) lines.push(`My interests include ${attributes.interests.join(', ')}.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { limit, dryRun } = parseArgs();

  console.log(`decompose-profiles: limit=${limit} dry-run=${dryRun}`);

  // Users with profiles but zero active premises (exclude ghost + soft-deleted)
  const rows = await db
    .select({
      userId: userProfiles.userId,
      identity: userProfiles.identity,
      narrative: userProfiles.narrative,
      attributes: userProfiles.attributes,
    })
    .from(userProfiles)
    .innerJoin(users, eq(users.id, userProfiles.userId))
    .leftJoin(
      premises,
      and(eq(premises.userId, userProfiles.userId), eq(premises.status, 'ACTIVE')),
    )
    .where(and(
      isNull(premises.id),
      isNull(users.deletedAt),
      eq(users.isGhost, false),
    ))
    .limit(limit);

  if (rows.length === 0) {
    console.log('No users with profiles missing active premises.');
    return;
  }

  console.log(`Found ${rows.length} user(s) to process.\n`);

  const database = new ChatDatabaseAdapter();
  const embedder = new EmbedderAdapter();
  const decomposer = new PremiseDecomposer();
  const premiseGraph = new PremiseGraphFactory(
    database as unknown as PremiseGraphDatabase,
    embedder,
  ).createGraph();

  let totalUsers = 0;
  let totalPremises = 0;

  for (const row of rows) {
    const text = buildProfileText(
      row.identity as ProfileIdentity | null,
      row.narrative as ProfileNarrative | null,
      row.attributes as ProfileAttributes | null,
    );

    if (!text.trim()) {
      console.log(`  [${row.userId}] Empty profile — skipping`);
      continue;
    }

    console.log(`  [${row.userId}] Decomposing profile (${text.length} chars)...`);
    const result = await decomposer.invoke(text);
    console.log(`  [${row.userId}] Extracted ${result.premises.length} premise(s)`);

    if (dryRun) {
      for (const p of result.premises) {
        console.log(`    - [${p.tier}] ${p.text}`);
      }
      totalUsers++;
      continue;
    }

    let created = 0;
    for (const p of result.premises) {
      try {
        const premiseResult = await premiseGraph.invoke({
          userId: row.userId,
          assertionText: p.text,
          tier: p.tier as 'assertive' | 'contextual',
          provenanceSource: 'enrichment' as const,
          provenanceConfidence: ENRICHMENT_CONFIDENCE,
        });
        if (premiseResult.premise) created++;
        else if (premiseResult.error) {
          console.warn(`    Failed: ${p.text.substring(0, 60)} — ${premiseResult.error}`);
        }
      } catch (err) {
        console.warn(`    Error: ${p.text.substring(0, 60)} — ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log(`  [${row.userId}] Created ${created}/${result.premises.length} premises`);

    // Enqueue profile regen (deduplicated by userId)
    await premiseQueue.addProfileRegenJob({ userId: row.userId, trigger: 'premise_created' });

    totalUsers++;
    totalPremises += created;
  }

  console.log(`\nDone. Processed ${totalUsers} user(s), created ${totalPremises} premise(s).`);
}

main()
  .then(async () => {
    await Promise.all([closeDb(), premiseQueue.queue.close()]);
  })
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('decompose-profiles error:', msg);
    await Promise.all([
      closeDb().catch(() => {}),
      premiseQueue.queue.close().catch(() => {}),
    ]);
    process.exit(1);
  });
