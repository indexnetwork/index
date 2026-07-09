/**
 * Bun test preload script — runs before any test module is evaluated.
 *
 * Loads the repo-root `.env.test` (see root .env.example). Ensure it has a
 * valid DATABASE_URL (copy from the root `.env.development` if it points at a
 * stale branch). Legacy per-spec `config({ path: '.env.test' })` calls are
 * harmless no-ops now that no `.env.test` exists in the package directory.
 */
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(import.meta.dir, '../../../.env.test'), override: true });

// The contacts/ghost-user feature is disabled-when-unset in production. Default
// it ON for the test suite so existing contact specs exercise the happy path;
// specs that assert the disabled behaviour override this locally with 'false'.
process.env.CONTACTS_ENABLED = process.env.CONTACTS_ENABLED ?? 'true';
