/**
 * Bun test preload script — runs before any test module is evaluated.
 *
 * All test files load `.env.test` with `override: true`. Ensure your
 * `.env.test` has a valid DATABASE_URL (copy from `.env.development`
 * if it points at a stale branch).
 */
import { config } from 'dotenv';

config({ path: '.env.test', override: true });
