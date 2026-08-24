#!/usr/bin/env node
/**
 * Dev-only wipe of all negotiation + opportunity product data for every user.
 * Keeps intents, users, chat conversations, HyDE, and profile data.
 *
 * Usage:
 *   bun run db:clear-negotiations --confirm
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dir, '../..', '.env.development') });

import { sql } from 'drizzle-orm/sql';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { setLevel } from '../lib/log';

type GlobalOpts = {
  silent?: boolean;
  confirm?: boolean;
};

function parseArgs(): GlobalOpts {
  const args = process.argv.slice(2);
  return {
    silent: args.includes('--silent'),
    confirm: args.includes('--confirm'),
  };
}

type Counts = Record<string, number>;

async function readCounts(): Promise<Counts> {
  const rows = await db.execute<{ t: string; n: string }>(sql`
    SELECT 'opportunities' AS t, count(*)::text AS n FROM opportunities
    UNION ALL SELECT 'tasks_negotiation', count(*)::text FROM tasks WHERE metadata->>'type' = 'negotiation'
    UNION ALL SELECT 'artifacts', count(*)::text FROM artifacts
    UNION ALL SELECT 'negotiator_memories', count(*)::text FROM negotiator_memories
    UNION ALL SELECT 'opportunity_deliveries', count(*)::text FROM opportunity_deliveries
    UNION ALL SELECT 'opportunity_discovery_runs', count(*)::text FROM opportunity_discovery_runs
    UNION ALL SELECT 'opportunity_outcome_events', count(*)::text FROM opportunity_outcome_events
    UNION ALL SELECT 'connect_links', count(*)::text FROM connect_links
    UNION ALL SELECT 'agents_with_neg_pickup', count(*)::text FROM agents WHERE last_negotiation_pickup_at IS NOT NULL
  `);
  const counts: Counts = {};
  for (const row of rows) {
    counts[row.t] = Number(row.n);
  }
  return counts;
}

async function clearNegotiationsAndOpportunities(): Promise<Counts> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM conversations
      WHERE id IN (
        SELECT DISTINCT conversation_id FROM tasks WHERE metadata->>'type' = 'negotiation'
      )
    `);
    await tx.execute(sql`
      DELETE FROM tasks WHERE metadata->>'type' = 'negotiation'
    `);
    await tx.execute(sql`DELETE FROM opportunity_outcome_events`);
    await tx.execute(sql`DELETE FROM opportunity_discovery_runs`);
    await tx.execute(sql`DELETE FROM opportunity_deliveries`);
    await tx.execute(sql`DELETE FROM connect_links`);
    await tx.execute(sql`DELETE FROM opportunities`);
    await tx.execute(sql`DELETE FROM negotiator_memories`);
    await tx.execute(sql`
      DELETE FROM questions
      WHERE detection->>'mode' IN ('negotiation', 'negotiation_inflight')
         OR detection->'negotiation' IS NOT NULL
         OR detection->>'sourceType' = 'opportunity'
    `);
    await tx.execute(sql`
      UPDATE agents
      SET last_negotiation_pickup_at = NULL
      WHERE last_negotiation_pickup_at IS NOT NULL
    `);
  });
  return readCounts();
}

async function main(): Promise<void> {
  const opts = parseArgs();
  if (opts.silent) setLevel('error');

  if (process.env.NODE_ENV === 'production') {
    console.error('❌ db:clear-negotiations cannot be run in production');
    await closeDb();
    process.exit(1);
  }

  if (!opts.confirm) {
    console.log('⚠️  This deletes ALL negotiation + opportunity data for every user on .env.development.');
    console.log('Use --confirm to proceed.');
    await closeDb();
    process.exit(1);
  }

  const before = await readCounts();
  if (!opts.silent) {
    console.log('[db-clear-negotiations] before:', before);
  }

  const after = await clearNegotiationsAndOpportunities();
  if (!opts.silent) {
    console.log('[db-clear-negotiations] after:', after);
    console.log('✅ Cleared negotiation + opportunity data');
  }
}

main()
  .then(() => closeDb())
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('db-clear-negotiations error:', msg);
    await closeDb();
    process.exit(1);
  });
