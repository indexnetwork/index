#!/usr/bin/env node
/**
 * Backfill CLI: generate the missing **global** `user_context` row (networkId = null)
 * for every user, synthesized from their ACTIVE premises. The global row is the
 * profile-replacing identity projection (WS7 of the `user_profiles` removal epic,
 * IND-360) and must exist before the WS6 surface cutover, otherwise legacy users
 * read blank.
 *
 * Two legacy populations are migrated in a single resumable pass:
 *   1. Users WITH active premises but no global `user_context` row — synthesize the
 *      global context directly via {@link ensureGlobalUserContext} (no HyDE; the
 *      global row is intentionally excluded from context-to-intent discovery).
 *   2. Users with NO active premises but a legacy `user_profiles` row — decompose the
 *      profile text into premises first (same path as `decompose-profiles` / WS2),
 *      then synthesize the global context. Disable with `--no-decompose`.
 *
 * Idempotent + resumable: users that already have a global row are excluded by the
 * candidate query, so re-running only processes what's left. Runs entirely
 * in-process — no Redis worker required.
 *
 * Requires LLM/embedding env vars (OPENROUTER_API_KEY + embedding config), since
 * context synthesis and premise creation run in-process.
 *
 * Safety: defaults to the **development** environment. Targeting production requires
 * explicitly setting `NODE_ENV=production` (no accidental prod writes from an unset env).
 *
 * Usage:
 *   bun run maintenance:backfill-global-user-contexts [--limit N] [--dry-run] [--no-decompose]
 */
import dotenv from 'dotenv';
import path from 'path';

// Safe default: development unless NODE_ENV is *explicitly* production.
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { sql } from 'drizzle-orm';
import { PremiseDecomposer, PremiseGraphFactory } from '@indexnetwork/protocol';
import type { PremiseGraphDatabase } from '@indexnetwork/protocol';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ensureGlobalUserContext } from '../lib/usercontext/global-context';

/** Enrichment-path confidence — mirrors decompose-profiles (derived from profile text, not explicit). */
const ENRICHMENT_CONFIDENCE = 0.85;

interface ProfileIdentity { name: string; bio: string; location: string }
interface ProfileNarrative { context: string }
interface ProfileAttributes { interests: string[]; skills: string[] }

type CandidateRow = {
  user_id: string;
  email: string;
  premise_count: number;
  identity: ProfileIdentity | null;
  narrative: ProfileNarrative | null;
  attributes: ProfileAttributes | null;
};

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { limit: number | null; dryRun: boolean; decompose: boolean } {
  const args = process.argv.slice(2);

  let limit: number | null = null;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1) {
    limit = Number(args[limitIdx + 1]);
  } else {
    const eqArg = args.find((a) => a.startsWith('--limit='));
    if (eqArg) limit = Number(eqArg.split('=')[1]);
  }
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    console.error('--limit must be a positive integer');
    process.exit(1);
  }

  return {
    limit,
    dryRun: args.includes('--dry-run'),
    decompose: !args.includes('--no-decompose'),
  };
}

// ---------------------------------------------------------------------------
// Profile text builder (mirrors decompose-profiles.buildProfileText)
// ---------------------------------------------------------------------------

/**
 * Assembles a text blob from legacy profile fields, skipping empty values.
 * @returns A newline-joined text suitable for premise decomposition, or '' when empty.
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

const main = async (): Promise<void> => {
  const { limit, dryRun, decompose } = parseArgs();
  console.log(
    `backfill-global-user-contexts: env=${envFile} limit=${limit ?? 'none'} dry-run=${dryRun} decompose=${decompose}`,
  );

  // Idempotent candidate set: live, non-ghost users WITHOUT a global context row
  // (networkId IS NULL). Ordered by premise count so the cheap, high-signal users
  // (already have premises) go first.
  const candidates = await db.execute<CandidateRow>(sql`
    SELECT
      u.id AS user_id,
      u.email,
      (
        SELECT count(*)::int FROM premises p
        WHERE p.user_id = u.id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
      ) AS premise_count,
      up.identity,
      up.narrative,
      up.attributes
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE u.deleted_at IS NULL
      AND u.is_ghost = false
      AND NOT EXISTS (
        SELECT 1 FROM user_contexts uc
        WHERE uc.user_id = u.id AND uc.network_id IS NULL
      )
    ORDER BY premise_count DESC
    ${limit !== null ? sql`LIMIT ${limit}` : sql``}
  `);

  console.log(`Users without a global user_context: ${candidates.length}`);
  if (candidates.length === 0) return;

  if (dryRun) {
    let withPremises = 0;
    let needDecompose = 0;
    let noData = 0;
    for (const c of candidates) {
      if (c.premise_count > 0) withPremises++;
      else if (buildProfileText(c.identity, c.narrative, c.attributes).trim()) needDecompose++;
      else noData++;
    }
    console.log(`  [dry-run] ${withPremises} have active premises -> generate global context directly`);
    console.log(`  [dry-run] ${needDecompose} have no premises but legacy profile text -> decompose first${decompose ? '' : ' (SKIPPED: --no-decompose)'}`);
    console.log(`  [dry-run] ${noData} have no premises and no profile text -> skipped (nothing to synthesize)`);
    return;
  }

  const database = new ChatDatabaseAdapter();
  const embedder = new EmbedderAdapter();
  const decomposer = new PremiseDecomposer();
  const premiseGraph = new PremiseGraphFactory(
    database as unknown as PremiseGraphDatabase,
    embedder,
  ).createGraph();

  let generated = 0;
  let decomposedUsers = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, c] of candidates.entries()) {
    const label = `[${i + 1}/${candidates.length}] ${c.email}`;
    try {
      // Population 2: no premises yet — decompose the legacy profile into premises first.
      if (c.premise_count === 0) {
        if (!decompose) {
          skipped++;
          console.log(`  ${label} — no premises, --no-decompose -> skipped`);
          continue;
        }
        const profileText = buildProfileText(c.identity, c.narrative, c.attributes);
        if (!profileText.trim()) {
          skipped++;
          console.log(`  ${label} — no premises, no profile text -> skipped`);
          continue;
        }

        const result = await decomposer.invoke(profileText);
        let created = 0;
        for (const p of result.premises) {
          // Mirror decompose-profiles / decomposePremisesNode: contextual premises
          // carry an LLM-inferred validity window and are volatile; assertive don't expire.
          const isContextual = p.tier === 'contextual';
          const validUntil = isContextual && p.validityDays
            ? new Date(Date.now() + p.validityDays * 24 * 60 * 60 * 1000).toISOString()
            : undefined;
          const premiseResult = await premiseGraph.invoke({
            userId: c.user_id,
            assertionText: p.text,
            tier: p.tier as 'assertive' | 'contextual',
            volatile: isContextual,
            ...(validUntil ? { validUntil } : {}),
            provenanceSource: 'enrichment' as const,
            provenanceConfidence: ENRICHMENT_CONFIDENCE,
          });
          if (premiseResult.premise) created++;
        }
        decomposedUsers++;
        console.log(`  ${label} — decomposed legacy profile -> ${created} premise(s)`);
        if (created === 0) {
          skipped++;
          console.log(`  ${label} — no premises created -> skipped global context`);
          continue;
        }
      }

      // Both populations: synthesize + upsert the global context from ACTIVE premises.
      // ensureGlobalUserContext is idempotent and swallows errors (returns ''), so an
      // empty result here means generation failed or there were no usable premises.
      const text = await ensureGlobalUserContext(c.user_id);
      if (text) {
        generated++;
        console.log(`  ${label} — global context generated (${text.length} chars)`);
      } else {
        failed++;
        console.error(`  ${label} — FAILED: empty global context (no usable premises or generation error)`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : `${err}`;
      console.error(`  ${label} — FAILED: ${msg}`);
    }
  }

  console.log(
    `\nDone. ${generated} global context(s) generated (${decomposedUsers} required profile decomposition first), ${skipped} skipped, ${failed} failed.`,
  );
  if (failed > 0) process.exitCode = 1;
};

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : `${err}`;
    console.error('backfill-global-user-contexts failed:', msg);
    await closeDb().catch(() => {});
    process.exit(1);
  });
