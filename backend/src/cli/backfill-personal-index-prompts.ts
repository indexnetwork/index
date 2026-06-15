#!/usr/bin/env node
/**
 * Backfill CLI: heal personal indexes after removing the hidden boilerplate prompt.
 *
 * Two idempotent steps:
 *   1. Clear the system boilerplate prompt from personal indexes (only the exact
 *      boilerplate string — any user-authored prompt is preserved).
 *   2. Assign every active intent to its owner's personal index (relevancy 1.0)
 *      when that personal index is now prompt-less and the intent isn't already
 *      a member. Prompt-less personal index == "no filtration" == holds everything.
 *
 * Dry-run by default: pass --apply to write. Defaults to .env.development unless
 * NODE_ENV=production (mirrors the other maintenance scripts).
 *
 * Usage:
 *   NODE_ENV=development bun run maintenance:backfill-personal-index-prompts          # dry-run
 *   NODE_ENV=development bun run maintenance:backfill-personal-index-prompts -- --apply
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';

const BOILERPLATE = "Personal index containing the owner's imported contacts for network-scoped discovery.";

async function main() {
  const apply = process.argv.slice(2).includes('--apply');
  const mode = apply ? 'APPLY' : 'DRY-RUN';
  console.log(`\n[backfill-personal-index-prompts] mode=${mode} env=${envFile}\n`);

  // --- Report: current state -------------------------------------------------
  // postgres-js drizzle: db.execute returns an array-like RowList (no .rows).
  const boilerplateRows = await db.execute(sql`
    select count(*)::int as count
    from networks
    where is_personal = true and deleted_at is null and prompt = ${BOILERPLATE}
  `);
  const boilerplateCount = Number((boilerplateRows[0] as { count: number | string })?.count ?? 0);

  const orphanRows = await db.execute(sql`
    select count(*)::int as count
    from intents i
    join personal_networks pn on pn.user_id = i.user_id
    join networks n on n.id = pn.network_id and n.deleted_at is null
    where i.archived_at is null
      and (n.prompt is null or n.prompt = ${BOILERPLATE})
      and not exists (
        select 1 from intent_networks inn
        where inn.intent_id = i.id and inn.network_id = pn.network_id
      )
  `);
  const orphanCount = Number((orphanRows[0] as { count: number | string })?.count ?? 0);

  console.log(`Personal indexes with boilerplate prompt to clear: ${boilerplateCount}`);
  console.log(`Active intents missing from their personal index to heal: ${orphanCount}`);

  if (!apply) {
    console.log('\nDry-run only — re-run with --apply to write changes.\n');
    return;
  }

  // --- Step 1: clear the boilerplate prompt ----------------------------------
  const cleared = await db.execute(sql`
    update networks set prompt = null, updated_at = now()
    where is_personal = true and deleted_at is null and prompt = ${BOILERPLATE}
    returning id
  `);
  console.log(`Step 1: cleared boilerplate prompt on ${(cleared as unknown[]).length} personal indexes.`);

  // --- Step 2: assign missing active intents to their personal index ---------
  // Runs AFTER step 1 so n.prompt is null for indexes we just cleared; any
  // user-authored prompt remains non-null and is intentionally skipped.
  const healed = await db.execute(sql`
    insert into intent_networks (intent_id, network_id, relevancy_score, assignment_metadata)
    select i.id, pn.network_id, '1', null
    from intents i
    join personal_networks pn on pn.user_id = i.user_id
    join networks n on n.id = pn.network_id and n.deleted_at is null
    where i.archived_at is null
      and n.prompt is null
      and not exists (
        select 1 from intent_networks inn
        where inn.intent_id = i.id and inn.network_id = pn.network_id
      )
    on conflict (intent_id, network_id) do nothing
    returning intent_id
  `);
  console.log(`Step 2: assigned ${(healed as unknown[]).length} intents to their personal index.\n`);
}

main()
  .catch((err) => {
    console.error('[backfill-personal-index-prompts] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
