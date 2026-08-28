#!/usr/bin/env node
/**
 * Dev-only wipe of all negotiation + opportunity product data for every user.
 * Also clears discovery-progress, pool/intent questions, intent-agent acts,
 * dossiers, orphan orchestrator conversations, and any conversation that
 * has an agent participant (H2A / A2A chat shells).
 * Also wipes every BullMQ queue in Redis (all `bull:*` keys) and resets each
 * intent's negotiation-cycle state (batch id) plus its round-log events.
 * Keeps intents, users, HyDE, and profile data.
 *
 * Usage:
 *   bun run db:clear-negotiations --confirm
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dir, '../..', '.env.development') });

import { sql } from 'drizzle-orm/sql';

import { getRedisClient } from '../adapters/cache.adapter';
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
    UNION ALL SELECT 'opportunity_outcome_events', count(*)::text FROM opportunity_outcome_events
    UNION ALL SELECT 'agents_with_neg_pickup', count(*)::text FROM agents WHERE last_negotiation_pickup_at IS NOT NULL
    UNION ALL SELECT 'intents_with_batch_state', count(*)::text FROM intents
      WHERE negotiation_batch_id IS NOT NULL
    UNION ALL SELECT 'negotiation_round_log_events', count(*)::text FROM negotiation_round_log_events
    UNION ALL SELECT 'intent_discovery_progress', count(*)::text FROM intent_discovery_progress
    UNION ALL SELECT 'questions_intent', count(*)::text FROM questions WHERE detection->>'mode' = 'intent'
    UNION ALL SELECT 'questions_nego_opp', count(*)::text FROM questions
      WHERE detection->>'mode' IN ('negotiation', 'negotiation_inflight')
         OR detection->'negotiation' IS NOT NULL
         OR detection->>'sourceType' = 'opportunity'
    UNION ALL SELECT 'orchestrator_orphan_convs', count(*)::text FROM conversations c
      WHERE c.persona = 'orchestrator'
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.conversation_id = c.id)
    UNION ALL SELECT 'agent_participant_convs', count(*)::text FROM conversations c
      WHERE EXISTS (
        SELECT 1 FROM conversation_participants p
        WHERE p.conversation_id = c.id AND p.participant_type = 'agent'
      )
    UNION ALL SELECT 'intent_agent_acts', count(*)::text FROM intent_agent_acts
    UNION ALL SELECT 'intent_dossier', count(*)::text FROM intent_dossier
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
    // Orphan orchestrator DMs left after prior task-only deletes
    await tx.execute(sql`
      DELETE FROM conversations c
      WHERE c.persona = 'orchestrator'
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.conversation_id = c.id)
    `);
    // Any conversation with an agent participant (H2A personal + leftover A2A)
    await tx.execute(sql`
      DELETE FROM conversations c
      WHERE EXISTS (
        SELECT 1 FROM conversation_participants p
        WHERE p.conversation_id = c.id AND p.participant_type = 'agent'
      )
    `);
    await tx.execute(sql`DELETE FROM opportunity_outcome_events`);
    await tx.execute(sql`DELETE FROM opportunity_deliveries`);
    await tx.execute(sql`DELETE FROM opportunities`);
    await tx.execute(sql`DELETE FROM negotiator_memories`);
    await tx.execute(sql`DELETE FROM intent_discovery_progress`);
    await tx.execute(sql`DELETE FROM intent_agent_acts`);
    await tx.execute(sql`DELETE FROM intent_dossier`);
    await tx.execute(sql`
      DELETE FROM questions
      WHERE detection->>'mode' IN (
            'negotiation', 'negotiation_inflight', 'intent'
          )
         OR detection->'negotiation' IS NOT NULL
         OR detection->>'sourceType' = 'opportunity'
    `);
    await tx.execute(sql`
      UPDATE agents
      SET last_negotiation_pickup_at = NULL
      WHERE last_negotiation_pickup_at IS NOT NULL
    `);
    // Intents survive the wipe, so their negotiation-cycle state must not:
    // a kept batch id with no matches or tasks behind it renders as a
    // permanently "opening" batch in the UI.
    await tx.execute(sql`
      UPDATE intents SET negotiation_batch_id = NULL WHERE negotiation_batch_id IS NOT NULL
    `);
    await tx.execute(sql`DELETE FROM negotiation_round_log_events`);
  });
  return readCounts();
}

/** Deletes every BullMQ key (`bull:*`) so no queued/delayed/repeating jobs survive the wipe. */
async function clearQueues(): Promise<number> {
  const redis = getRedisClient();
  let deleted = 0;
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'bull:*', 'COUNT', 1000);
    cursor = next;
    if (keys.length > 0) deleted += await redis.del(...keys);
  } while (cursor !== '0');
  await redis.quit();
  return deleted;
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
    console.log('⚠️  This deletes ALL negotiation + opportunity data for every user on .env.development, plus every queued BullMQ job in Redis.');
    console.log('Use --confirm to proceed.');
    await closeDb();
    process.exit(1);
  }

  const before = await readCounts();
  if (!opts.silent) {
    console.log('[db-clear-negotiations] before:', before);
  }

  const after = await clearNegotiationsAndOpportunities();
  const queueKeysDeleted = await clearQueues();
  if (!opts.silent) {
    console.log('[db-clear-negotiations] after:', after);
    console.log('[db-clear-negotiations] queue keys deleted:', queueKeysDeleted);
    console.log('✅ Cleared negotiation + opportunity data and all queued jobs');
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
