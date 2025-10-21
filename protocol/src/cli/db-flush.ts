#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { Command } from 'commander';
import { sql } from 'drizzle-orm';
import db, { closeDb } from '../lib/db';
import { setLevel } from '../lib/log';

type GlobalOpts = {
  silent?: boolean;
  confirm?: boolean;
};

function printResult(result: any, opts: GlobalOpts) {
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
      'intent_stakes',
      'intent_indexes', 
      'intents',
      'files',
      'links',
      'user_connection_events',
      'integrations',
      'index_members',
      'indexes',
      'users'
    ];

    for (const table of tables) {
      await db.execute(sql.raw(`TRUNCATE TABLE ${table} CASCADE`));
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('db-flush')
    .description('Flush all data from database tables')
    .option('--silent', 'Suppress non-error output')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (opts: GlobalOpts) => {
      if (opts.silent) setLevel('error');

      // Prevent seeding in production
      if (process.env.NODE_ENV === 'production') {
        console.error('❌ db:seed cannot be run in production environment');
        process.exit(1);
      }
      if (!opts.confirm) {
        console.log('⚠️  This will permanently delete ALL data from the database.');
        console.log('Use --confirm to skip this warning.');
        process.exit(1);
      }

      const result = await flushDatabase();
      printResult(result, opts);
      
      if (!result.ok) {
        process.exit(1);
      }
    });

  program.addHelpText(
    'after',
    '\nExamples:\n  yarn db:flush --confirm\n  yarn db:flush --silent --confirm\n'
  );

  try {
    await program.parseAsync(process.argv);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('db-flush error:', msg);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
