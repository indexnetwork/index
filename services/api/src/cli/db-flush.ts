#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', envFile) });

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

function printResult(result: { ok: boolean; error?: string }, opts: GlobalOpts) {
  if (!opts.silent) {
    if (result.ok) {
      console.log('✅ Database flushed successfully');
    } else {
      console.error('❌ Flush failed:', result.error);
    }
  }
}

async function flushDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    const tables = [
      'frame_centroid_snapshots',
      'cross_network_yield_snapshots',
      'frame_drift_observation_runs',
      'intent_networks',
      'artifacts',
      'messages',
      'tasks',
      'conversation_metadata',
      'conversation_participants',
      'conversations',
      'opportunities',
      'user_notification_settings',
      'hyde_documents',
      'intents',
      'files',
      'links',
      'agent_permissions',
      'agent_transports',
      'agents',
      'apikey',
      'network_integrations',
      'network_members',
      'networks',
      'users',
    ];

    for (const table of tables) {
      try {
        await db.execute(sql.raw(`TRUNCATE TABLE ${table} CASCADE`));
      } catch {
        // Table may not exist in this database — skip silently
      }
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const opts = parseArgs();

  if (opts.silent) setLevel('error');

  if (process.env.NODE_ENV === 'production') {
    console.error('❌ db:flush cannot be run in production environment');
    await closeDb();
    process.exit(1);
  }
  if (!opts.confirm) {
    console.log('⚠️  This will permanently delete ALL data from the database.');
    console.log('Use --confirm to skip this warning.');
    await closeDb();
    process.exit(1);
  }

  const result = await flushDatabase();
  printResult(result, opts);

  if (!result.ok) {
    await closeDb();
    process.exit(1);
  }
}

main()
  .then(() => closeDb())
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('db-flush error:', msg);
    await closeDb();
    process.exit(1);
  });
