#!/usr/bin/env node
/**
 * Reset a remote database (e.g. Neon) so migrations can be run from scratch.
 * Drops the public schema and migration history, recreates public, enables pgvector.
 * Use with: bun run maintenance:reset-remote-db
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import postgres from 'postgres';
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

async function resetRemoteDatabase(): Promise<{ ok: boolean; error?: string }> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return { ok: false, error: 'DATABASE_URL is not set' };
  }

  const sql = postgres(connectionString, { prepare: false, max: 1 });

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql.unsafe('DROP SCHEMA public CASCADE');
    await sql.unsafe('CREATE SCHEMA public');
    await sql.unsafe('GRANT ALL ON SCHEMA public TO public');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const opts = parseArgs();

  if (opts.silent) setLevel('error');

  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Remote DB reset cannot be run in production environment');
    process.exit(1);
  }
  if (!opts.confirm) {
    console.log('⚠️  This will DROP the public schema and ALL data on the database.');
    console.log('Use --confirm to proceed.');
    process.exit(1);
  }

  if (!opts.silent) {
    console.log('Resetting remote database (DROP public schema, enable pgvector)...');
  }

  const result = await resetRemoteDatabase();

  if (!opts.silent) {
    if (result.ok) {
      console.log('✅ Remote database reset successfully. Run: bun run db:migrate');
    } else {
      console.error('❌ Reset failed:', result.error);
    }
  }

  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('db-reset-remote error:', msg);
  process.exit(1);
});
