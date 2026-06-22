#!/usr/bin/env node
/**
 * Expire stale opportunities: transitions opportunities whose expiresAt <= now
 * from non-terminal statuses to 'expired' (skips accepted/rejected/expired).
 *
 * Usage: bun run maintenance:expire-opportunities
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { closeDb } from '../lib/drizzle/drizzle';
import { OpportunityDatabaseAdapter } from '../adapters/opportunity.database.adapter';

async function main() {
  console.log('[expire-opportunities] Starting...');
  const count = await new OpportunityDatabaseAdapter().expireStaleOpportunities();
  console.log(`[expire-opportunities] Expired ${count} opportunit${count === 1 ? 'y' : 'ies'}.`);
  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('[expire-opportunities] Fatal error:', err);
  process.exit(1);
});
