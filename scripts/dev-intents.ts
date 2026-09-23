#!/usr/bin/env bun
import path from 'node:path';
import dotenv from 'dotenv';

import { databaseUrl, openControl, resetReplay, resumeReplay } from '../services/api/src/cli/dev-intents';

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
  if (!['resume', 'reset'].includes(action) || confirm !== '--confirm' || extra.length) {
    throw new Error('Use bun run db:dev:resume --confirm or bun run db:dev:reset --confirm.');
  }

  const connectionString = loadDevelopmentDatabaseUrl();
  printTarget(connectionString);
  if (action === 'reset') await resetDevelopmentDatabase(connectionString);
  else await resumeReplay();
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error('[dev-intents]', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
