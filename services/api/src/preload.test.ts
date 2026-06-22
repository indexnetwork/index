/**
 * Bun test preload script — runs before any test module is evaluated.
 *
 * All test files load `.env.test` with `override: true`. Ensure your
 * `.env.test` has a valid DATABASE_URL (copy from `.env.development`
 * if it points at a stale branch).
 */
import { config } from 'dotenv';

config({ path: '.env.test', override: true });

// The contacts/ghost-user feature is disabled-when-unset in production. Default
// it ON for the test suite so existing contact specs exercise the happy path;
// specs that assert the disabled behaviour override this locally with 'false'.
process.env.CONTACTS_ENABLED = process.env.CONTACTS_ENABLED ?? 'true';
