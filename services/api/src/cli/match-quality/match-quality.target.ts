/**
 * Loads the repository-root `.env.test` and refuses any target that is not
 * disposable local infrastructure. Imported first by the entry point, so it
 * runs before any module opens a database or Redis connection.
 *
 * Only local `index_test` and a local Redis are accepted. Connection URLs are
 * never printed: the target is described by host and database name only.
 */
import path from 'node:path';

import dotenv from 'dotenv';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../../../..');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DATABASE_NAME = 'index_test';

// Variables already set in the shell win, so REDIS_URL can point at a throwaway local instance.
dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env.test') });

/** @throws With the reason, never the URL. */
function requireLocalTarget(): string {
  const failures: string[] = [];
  if (process.env.NODE_ENV !== 'test') failures.push('NODE_ENV must be test');
  if (process.env.TEST_DATABASE_SAFE !== '1') failures.push('TEST_DATABASE_SAFE must be 1');
  if (!process.env.OPENROUTER_API_KEY) failures.push('OPENROUTER_API_KEY is missing');

  const database = parse(process.env.DATABASE_URL);
  const databaseName = database ? decodeURIComponent(database.pathname.replace(/^\//, '')) : '';
  if (!database || !LOCAL_HOSTS.has(database.hostname) || databaseName !== DATABASE_NAME) {
    failures.push(`DATABASE_URL must name local ${DATABASE_NAME}`);
  }
  const redis = parse(process.env.REDIS_URL);
  if (!redis || !LOCAL_HOSTS.has(redis.hostname) || process.env.REDIS_HOST) {
    failures.push('REDIS_URL must name a local Redis (for example redis://127.0.0.1:6399) and REDIS_HOST must be unset');
  }
  if (failures.length) throw new Error(`Refusing to run the match-quality evaluator: ${failures.join('; ')}.`);

  return `Local Postgres / ${DATABASE_NAME} (${database!.hostname}:${database!.port || '5432'}); Redis ${redis!.hostname}:${redis!.port || '6379'}`;
}

function parse(value: string | undefined): URL | null {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

/** The sanitized target this process writes to. */
export const TARGET = requireLocalTarget();

/** Where generated admission logs and reports go: the git-ignored `ignored/` folder. */
export const OUTPUT_ROOT = path.join(REPOSITORY_ROOT, 'ignored', 'match-quality');
