#!/usr/bin/env node
/**
 * Dev-only wipe of all negotiation + opportunity product data for every user.
 * Also clears discovery-progress, pool/intent questions, and any conversation
 * that has an agent participant (H2A / A2A chat shells).
 * Also resets each intent's negotiation-cycle state (batch id).
 * Keeps intents, users, HyDE, and profile data.
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
    UNION ALL SELECT 'negotiations', count(*)::text FROM negotiations
    UNION ALL SELECT 'negotiation_turns', count(*)::text FROM negotiation_turns
    UNION ALL SELECT 'opportunity_outcome_events', count(*)::text FROM opportunity_outcome_events
    UNION ALL SELECT 'intent_discovery_progress', count(*)::text FROM intent_discovery_progress
    UNION ALL SELECT 'questions_intent', count(*)::text FROM questions WHERE detection->>'mode' = 'intent'
    UNION ALL SELECT 'questions_nego_opp', count(*)::text FROM questions
      WHERE detection->>'mode' IN ('negotiation', 'negotiation_inflight')
         OR detection->'negotiation' IS NOT NULL
         OR detection->>'sourceType' = 'opportunity'
    UNION ALL SELECT 'agent_participant_convs', count(*)::text FROM conversations c
      WHERE EXISTS (
        SELECT 1 FROM conversation_participants p
        WHERE p.conversation_id = c.id AND p.participant_type = 'agent'
      )
  `);
  const counts: Counts = {};
  for (const row of rows) {
    counts[row.t] = Number(row.n);
  }
  return counts;
}

async function clearNegotiationsAndOpportunities(): Promise<Counts> {
  await db.transaction(async (tx) => {
    // Any conversation with an agent participant (H2A personal + leftover A2A)
    await tx.execute(sql`
      DELETE FROM conversations c
      WHERE EXISTS (
        SELECT 1 FROM conversation_participants p
        WHERE p.conversation_id = c.id AND p.participant_type = 'agent'
      )
    `);
    await tx.execute(sql`DELETE FROM opportunity_outcome_events`);
    // negotiations (and their turns) cascade from the opportunity.
    await tx.execute(sql`DELETE FROM opportunities`);
    await tx.execute(sql`DELETE FROM intent_discovery_progress`);
    await tx.execute(sql`
      DELETE FROM questions
      WHERE detection->>'mode' IN (
            'negotiation', 'negotiation_inflight', 'intent'
          )
         OR detection->'negotiation' IS NOT NULL
         OR detection->>'sourceType' = 'opportunity'
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
