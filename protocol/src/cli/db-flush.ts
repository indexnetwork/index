#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { performance } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/db';

const DEFAULT_TABLES = [
  'intent_indexes',
  'intent_stakes',
  'index_members',
  'intents',
  'files',
  'user_connection_events',
  'integrations',
  'links',
  'indexes',
  'users',
] as const;

const PROTECTED_TABLES = new Set(['agents']);

type CliOptions = {
  force: boolean;
  json: boolean;
  silent: boolean;
  tables?: string[];
};

type FlushResult = {
  tables: ReadonlyArray<string>;
  durationMs: number;
};

async function flushDatabase(tables: ReadonlyArray<string>): Promise<FlushResult> {
  if (tables.length === 0) {
    return { tables, durationMs: 0 };
  }

  const identifiers = tables.map((table) => sql.identifier(table));
  const truncateStatement = sql`TRUNCATE TABLE ${sql.join(identifiers, sql`, `)} RESTART IDENTITY CASCADE;`;

  const start = performance.now();
  await db.execute(truncateStatement);
  const durationMs = Math.round(performance.now() - start);

  return { tables, durationMs };
}

function resolveTables(optTables: string[] | undefined): ReadonlyArray<string> {
  if (!optTables || optTables.length === 0) return DEFAULT_TABLES;

  const tables = Array.from(new Set(optTables.map((name) => name.trim()).filter(Boolean)));
  const blocked = tables.filter((name) => PROTECTED_TABLES.has(name));

  if (blocked.length > 0) {
    const tableList = blocked.join(', ');
    const descriptor = blocked.length > 1 ? 'tables' : 'table';
    throw new Error(`Protected ${descriptor} cannot be flushed: ${tableList}`);
  }

  return tables;
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('db:flush')
    .description('Truncate application tables and reset identity sequences')
    .option('--force', 'Skip safety check (required to run)')
    .option('--json', 'Output machine-readable JSON (no extra text)')
    .option('--silent', 'Suppress non-error output')
    .option('--tables <names...>', 'Target subset of tables (defaults to all)');

  let opts: CliOptions | undefined;

  try {
    await program.parseAsync(process.argv);
    opts = program.opts<CliOptions>();
    const tables = resolveTables(opts.tables);

    if (!opts.force) {
      const message = 'Add --force to confirm destructive flush operation.';
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: message }));
      } else {
        console.error(message);
      }
      process.exitCode = 1;
      return;
    }

    const result = await flushDatabase(tables);

    if (opts.json) {
      console.log(JSON.stringify({ ok: true, ...result }));
    } else if (!opts.silent) {
      console.log(`Flushed ${result.tables.length} table(s) in ${result.durationMs}ms.`);
      result.tables.forEach((table) => console.log(`- ${table}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : `${error}`;
    try {
      const shouldJson = typeof opts?.json === 'boolean' ? opts.json : false;
      if (shouldJson) {
        console.error(JSON.stringify({ ok: false, error: message }));
      } else {
        console.error(`db:flush error: ${message}`);
      }
    } catch {
      console.error(`db:flush error: ${message}`);
    }
    process.exitCode = 1;
  } finally {
    await closeDb().catch(() => undefined);
  }
}

main();
