#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { sql } from 'drizzle-orm';
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
      'intent_indexes',
      'opportunities',
      'user_notification_settings',
      'user_profiles',
      'hyde_documents',
      'intents',
      'files',
      'links',
      'index_members',
      'indexes',
      'integrations',
      'users',
    ];

    for (const table of tables) {
      await db.execute(sql.raw(`TRUNCATE TABLE ${table} CASCADE`));
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
