#!/usr/bin/env node
/**
 * Incident backfill CLI: convert approved onboarding profiles into premises.
 *
 * Strict by default: targets only non-ghost members of one network who have a
 * saved profile, zero active premises, completed onboarding, and at least one
 * recorded data-use consent grant. Use --dry-run first.
 *
 * Usage:
 *   bun run maintenance:backfill-approved-profile-premises -- --network <networkId> [--limit=N] [--dry-run]
 *
 * Escape hatches are intentionally explicit:
 *   --allow-incomplete-onboarding
 *   --allow-missing-consent
 */
import dotenv from 'dotenv';
import path from 'path';

import type { PremiseGraphDatabase } from '@indexnetwork/protocol';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const { and, eq, isNull, sql } = await import('drizzle-orm');
const { PremiseDecomposer, PremiseGraphFactory } = await import('@indexnetwork/protocol');
const { default: db, closeDb } = await import('../lib/drizzle/drizzle');
const { networkMembers, premises, userProfiles, users } = await import('../schemas/database.schema');
const { ChatDatabaseAdapter } = await import('../adapters/database.adapter');
const { EmbedderAdapter } = await import('../adapters/embedder.adapter');
const { premiseQueue } = await import('../queues/premise.queue');

const DEFAULT_LIMIT = 100;
const BACKFILL_CONFIDENCE = 0.9;

interface ProfileIdentity { name: string; bio: string; location: string }
interface ProfileNarrative { context: string }
interface ProfileAttributes { interests: string[]; skills: string[] }

interface Args {
  networkId: string;
  limit: number;
  dryRun: boolean;
  requireConsent: boolean;
  requireOnboardingComplete: boolean;
}

function argValue(args: string[], name: string): string | undefined {
  const exact = args.find((a) => a.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const networkId = argValue(args, '--network') ?? argValue(args, '--network-id') ?? '';
  const limitValue = Number.parseInt(argValue(args, '--limit') ?? '', 10);

  if (!networkId) {
    console.error('Usage: bun run maintenance:backfill-approved-profile-premises -- --network <networkId> [--limit=N] [--dry-run]');
    process.exit(1);
  }

  return {
    networkId,
    limit: Number.isFinite(limitValue) && limitValue > 0 ? limitValue : DEFAULT_LIMIT,
    dryRun: args.includes('--dry-run'),
    requireConsent: !args.includes('--allow-missing-consent'),
    requireOnboardingComplete: !args.includes('--allow-incomplete-onboarding'),
  };
}

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

async function main(): Promise<void> {
  const args = parseArgs();
  console.log([
    'backfill-approved-profile-premises',
    `network=${args.networkId}`,
    `limit=${args.limit}`,
    `dryRun=${args.dryRun}`,
    `requireConsent=${args.requireConsent}`,
    `requireOnboardingComplete=${args.requireOnboardingComplete}`,
  ].join(' '));

  const conditions = [
    eq(networkMembers.networkId, args.networkId),
    isNull(networkMembers.deletedAt),
    isNull(users.deletedAt),
    eq(users.isGhost, false),
    isNull(premises.id),
  ];

  if (args.requireOnboardingComplete) {
    conditions.push(sql`${users.onboarding}->>'completedAt' IS NOT NULL`);
  }

  if (args.requireConsent) {
    conditions.push(sql`(
      ${users.onboarding}#>>'{privacy,edgeosImport,granted}' = 'true'
      OR ${users.onboarding}#>>'{privacy,publicProfileLookup,granted}' = 'true'
    )`);
  }

  const rows = await db
    .select({
      userId: userProfiles.userId,
      email: users.email,
      name: users.name,
      identity: userProfiles.identity,
      narrative: userProfiles.narrative,
      attributes: userProfiles.attributes,
    })
    .from(userProfiles)
    .innerJoin(users, eq(users.id, userProfiles.userId))
    .innerJoin(networkMembers, eq(networkMembers.userId, userProfiles.userId))
    .leftJoin(
      premises,
      and(
        eq(premises.userId, userProfiles.userId),
        eq(premises.status, 'ACTIVE'),
        isNull(premises.deletedAt),
      ),
    )
    .where(and(...conditions))
    .limit(args.limit);

  if (rows.length === 0) {
    console.log('No matching users with approved profiles missing active premises.');
    return;
  }

  console.log(`Found ${rows.length} matching user(s).`);

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
      console.log(`  [${row.email}] Empty profile — skipping`);
      continue;
    }

    console.log(`  [${row.email}] Decomposing approved profile (${text.length} chars)...`);
    const result = await decomposer.invoke(text);
    console.log(`  [${row.email}] Extracted ${result.premises.length} premise(s)`);

    if (args.dryRun) {
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
          tier: p.tier,
          provenanceSource: 'onboarding' as const,
          provenanceConfidence: BACKFILL_CONFIDENCE,
        });
        if (premiseResult.premise) created++;
        else if (premiseResult.error) {
          console.warn(`    Failed: ${p.text.substring(0, 60)} — ${premiseResult.error}`);
        }
      } catch (err) {
        console.warn(`    Error: ${p.text.substring(0, 60)} — ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log(`  [${row.email}] Created ${created}/${result.premises.length} premises`);
    if (created > 0) {
      await premiseQueue.addProfileRegenJob({ userId: row.userId, trigger: 'premise_created' });
    }

    totalUsers++;
    totalPremises += created;
  }

  console.log(`Done. Processed ${totalUsers} user(s), created ${totalPremises} premise(s).`);
}

main()
  .then(async () => {
    await Promise.all([closeDb(), premiseQueue.queue.close()]);
  })
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('backfill-approved-profile-premises error:', msg);
    await Promise.all([
      closeDb().catch(() => {}),
      premiseQueue.queue.close().catch(() => {}),
    ]);
    process.exit(1);
  });
