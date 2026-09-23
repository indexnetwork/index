#!/usr/bin/env bun
import path from 'node:path';
import dotenv from 'dotenv';

import { databaseUrl, openControl, parseReplayLimit, resetReplay, resumeReplay } from '../services/api/src/cli/dev-intents';

const USAGE = 'Use bun run db:dev:resume --confirm [count] or bun run db:dev:reset --confirm.';

function loadDevelopmentDatabaseUrl(): string {
  const envFile = path.resolve(import.meta.dir, '..', '.env.development');
  const loaded = dotenv.config({ path: envFile, override: true });
  if (loaded.error) throw loaded.error;
  return databaseUrl(process.env.DATABASE_URL);
}

function printTarget(connectionString: string): void {
  const target = new URL(connectionString);
  console.log(`[dev-intents] Target: .env.development / ${target.pathname.slice(1)} / ${target.hostname}`);
}

async function resetDevelopmentDatabase(connectionString: string): Promise<void> {
  let closing = false;
  const control = openControl(connectionString, () => {
    if (!closing) console.error('[dev-intents] Control connection closed; any uncommitted cleanup is rolled back.');
  });
  try {
    await resetReplay(control);
    console.log('[dev-intents] Reset complete.');
  } finally {
    closing = true;
    await control.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const [action, confirm, ...extra] = process.argv.slice(2);
  if (confirm !== '--confirm') throw new Error(USAGE);
  if (action === 'reset' && extra.length === 0) {
    const connectionString = loadDevelopmentDatabaseUrl();
    printTarget(connectionString);
    await resetDevelopmentDatabase(connectionString);
  } else if (action === 'resume' && extra.length <= 1) {
    const limit = parseReplayLimit(extra[0]);
    const connectionString = loadDevelopmentDatabaseUrl();
    printTarget(connectionString);
    await resumeReplay(limit);
  } else {
    throw new Error(USAGE);
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error('[dev-intents]', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
