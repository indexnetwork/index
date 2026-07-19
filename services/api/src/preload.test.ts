/**
 * Bun test preload script — runs before any test module is evaluated.
 *
 * Loads the repo-root `.env.test` (see root .env.example) as the authoritative
 * test environment. Full-suite invocations validate the disposable test
 * database before Bun imports any specs; targeted specs defer the same check to
 * imports of the real Drizzle singleton so hermetic module-mock tests stay DB-free.
 */
import { config } from 'dotenv';
import path from 'node:path';

import { ensureTestDatabaseReady, shouldRequireTestDatabase } from './lib/drizzle/test-database-readiness';

config({ path: path.resolve(import.meta.dir, '../../../.env.test'), override: true });

// The contacts/ghost-user feature is disabled-when-unset in production. Default
// it ON for the test suite so existing contact specs exercise the happy path;
// specs that assert the disabled behaviour override this locally with 'false'.
process.env.CONTACTS_ENABLED = process.env.CONTACTS_ENABLED ?? 'true';

if (shouldRequireTestDatabase(Bun.argv, process.env)) {
  await ensureTestDatabaseReady();
}
