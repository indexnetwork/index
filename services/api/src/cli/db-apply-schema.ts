#!/usr/bin/env node
/**
 * Apply the initial migration SQL directly using DATABASE_URL from .env.development.
 * Use when drizzle-kit migrate is not applying (e.g. migration table out of sync).
 * Same env as the running app, so tables are created in the correct database.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import postgres from 'postgres';

const MIGRATION_FILE = path.resolve(process.cwd(), 'drizzle/0000_handy_ironclad.sql');

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL is not set in .env.development');
    process.exit(1);
  }

  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error('❌ Migration file not found:', MIGRATION_FILE);
    process.exit(1);
  }

  const raw = fs.readFileSync(MIGRATION_FILE, 'utf-8');
  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  const sql = postgres(connectionString, { prepare: false, max: 1 });

  try {
    console.log('Applying schema from', path.basename(MIGRATION_FILE), `(${statements.length} statements)...`);
    for (let i = 0; i < statements.length; i++) {
      await sql.unsafe(statements[i]!);
    }
    console.log('✅ Schema applied successfully. Restart the protocol server.');
  } catch (error) {
    console.error('❌ Apply failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
