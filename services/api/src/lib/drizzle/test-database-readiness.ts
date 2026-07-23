import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import postgres from 'postgres';

const DEFAULT_TIMEOUT_MS = 10_000;

const TEST_OPTIONS_WITH_VALUES = new Set([
  '--timeout',
  '--rerun-each',
  '--retry',
  '--seed',
  '--coverage-reporter',
  '--coverage-dir',
  '--bail',
  '--reporter',
  '--reporter-outfile',
  '--max-concurrency',
  '--parallel',
  '--parallel-delay',
  '--preload',
  '--config',
]);

const PARTIAL_TEST_OPTIONS = [
  '--watch',
  '--watcher',
  '--hot',
  '--only',
  '--test-name-pattern',
  '-t',
  '--path-ignore-patterns',
  '--changed',
  '--shard',
] as const;

export const REQUIRED_TEST_DATABASE_OBJECTS = [
  'public.users',
  'public.networks',
  'public.network_members',
  'public.intents',
  'public.intent_networks',
  'public.opportunities',
  'public.questions',
  'public.conversations',
  'public.messages',
  'public.tasks',
  'public.agents',
  'public.apikey',
  'public.negotiator_memories',
  'public.opportunity_outcome_events',
  'public.questions_recovery_recipient_intent_fingerprint_uniq',
  'public.questions_negotiation_provenance_uniq',
  'public.questions_pool_push_recipient_intent_cycle_uniq',
] as const;

export const REQUIRED_TEST_DATABASE_COLUMNS = [
  ['apikey', 'config_id'],
  ['apikey', 'name'],
  ['apikey', 'prefix'],
  ['apikey', 'start'],
  ['apikey', 'rate_limit_max'],
  ['apikey', 'rate_limit_time_window'],
  ['apikey', 'remaining'],
  ['apikey', 'refill_amount'],
  ['apikey', 'refill_interval'],
  ['apikey', 'last_refill_at'],
  ['apikey', 'last_request'],
  ['apikey', 'metadata'],
  ['apikey', 'permissions'],
] as const;

export const REQUIRED_TEST_DATABASE_NULLABLE_COLUMNS = [
  ['apikey', 'user_id'],
] as const;

interface TestDatabaseClient {
  unsafe(query: string): Promise<ReadonlyArray<Record<string, unknown>>>;
  end(options?: { timeout?: number }): Promise<unknown>;
}

type CreateTestDatabaseClient = (url: string) => TestDatabaseClient;

export interface TestDatabaseReadinessOptions {
  databaseUrl?: string;
  safeMarker?: string;
  timeoutMs?: number;
  createClient?: CreateTestDatabaseClient;
}


/**
 * Validates the test database URL without exposing credentials in diagnostics.
 *
 * @param value - Candidate PostgreSQL URL.
 * @returns The validated URL.
 * @throws When the URL is missing, malformed, or uses a non-PostgreSQL scheme.
 */
export function validateTestDatabaseUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      '[test-db] DATABASE_URL is missing. Configure a disposable test database in the repository-root .env.test.',
    );
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new Error('[test-db] DATABASE_URL must be a valid postgres:// or postgresql:// URL.');
  }

  return value;
}

/**
 * Reads the operating system's original command line before Bun rewrites its
 * JavaScript argv to the first discovered test file.
 *
 * @returns Original process arguments, or Bun's rewritten argv as a safe fallback.
 */
export function readOriginalProcessArgv(): string[] {
  try {
    if (process.platform === 'linux') {
      return readFileSync('/proc/self/cmdline')
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
    }

    if (process.platform === 'darwin') {
      const command = execFileSync(
        '/bin/ps',
        ['-ww', '-p', String(process.pid), '-o', 'command='],
        { encoding: 'utf8' },
      ).trim();
      if (command) return command.split(/\s+/);
    }
  } catch {
    // Fall back to Bun.argv. A rewritten targeted-looking argv fails closed and
    // defers readiness to real Drizzle imports rather than assuming a full run.
  }

  return [...Bun.argv];
}

/**
 * Decides whether the preload must validate the database before loading any specs.
 * Targeted hermetic specs may skip the preload probe; importing the real Drizzle
 * singleton still performs the same check.
 *
 * @param argv - Original operating-system process arguments.
 * @param env - Environment variables controlling full-suite execution.
 * @param _discoverableFiles - Retained for call-site compatibility.
 * @returns True for bare/full-suite test invocations.
 */
export function shouldRequireTestDatabase(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  _discoverableFiles: readonly string[] = [],
): boolean {
  if (env.API_TEST_REQUIRE_DATABASE === '1') return true;

  const testCommandIndex = argv.findIndex((arg) => arg === 'test');
  if (testCommandIndex === -1) {
    // Bun's fallback argv contains only the executable for a true bare run.
    return argv.length <= 1;
  }

  const testArgs = argv.slice(testCommandIndex + 1);
  for (let index = 0; index < testArgs.length; index += 1) {
    const arg = testArgs[index];

    if (PARTIAL_TEST_OPTIONS.some((option) => arg === option || arg.startsWith(`${option}=`))) {
      return false;
    }

    if (TEST_OPTIONS_WITH_VALUES.has(arg)) {
      index += 1;
      continue;
    }

    if (arg.startsWith('-')) continue;

    // Any positional argument is a file/directory pattern, hence targeted.
    return false;
  }

  return true;
}

/**
 * Identifies an isolated child whose parent already completed readiness.
 *
 * All internal markers plus the live parent PID are required so direct
 * targeted tests continue to fail closed when they import real Drizzle.
 *
 * @param env - Child-process environment.
 * @param parentPid - Actual operating-system parent process ID.
 * @returns Whether the parent readiness result may be reused.
 */
export function hasParentTestDatabaseReadiness(
  env: Readonly<Record<string, string | undefined>>,
  parentPid = process.ppid,
): boolean {
  return env.API_TEST_ISOLATED_CHILD === '1'
    && env.API_TEST_DATABASE_READY === '1'
    && env.API_TEST_PARENT_PID === String(parentPid);
}

/**
 * Performs a bounded connectivity and schema probe against a disposable test DB.
 *
 * @param options - Injectable URL/client settings for hermetic tests.
 * @throws A credential-free diagnostic when configuration, connectivity, or schema is invalid.
 */
export async function checkTestDatabaseReadiness(
  options: TestDatabaseReadinessOptions = {},
): Promise<void> {
  if ((options.safeMarker ?? process.env.TEST_DATABASE_SAFE) !== '1') {
    throw new Error(
      '[test-db] Refusing database-backed tests because TEST_DATABASE_SAFE=1 is not set. Use a dedicated disposable database; never a shared or production database.',
    );
  }

  const databaseUrl = validateTestDatabaseUrl(options.databaseUrl ?? process.env.DATABASE_URL);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const createClient = options.createClient ?? createDefaultClient;
  const client = createClient(databaseUrl);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const probe = client.unsafe(buildSchemaProbeQuery());
    const timedProbe = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('probe timeout')), timeoutMs);
    });
    const rows = await Promise.race([probe, timedProbe]);
    const missing = readMissingObjects(rows);

    if (missing.length > 0) {
      throw new Error(
        `[test-db] Test database schema is not current. Missing: ${missing.join(', ')}. Run "bun run db:migrate:test" from services/api.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[test-db]')) throw error;
    throw new Error(
      `[test-db] Test database is unreachable within ${timeoutMs}ms. Check DATABASE_URL and the disposable database status.`,
      { cause: error },
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

/**
 * Runs the readiness check once per Bun process.
 *
 * @returns The shared readiness promise.
 */
export function ensureTestDatabaseReady(): Promise<void> {
  const sharedProcess = process as typeof process & {
    __indexTestDatabaseReadiness?: Promise<void>;
  };
  sharedProcess.__indexTestDatabaseReadiness ??= checkTestDatabaseReadiness();
  return sharedProcess.__indexTestDatabaseReadiness;
}

function createDefaultClient(url: string): TestDatabaseClient {
  return postgres(url, {
    connect_timeout: Math.ceil(DEFAULT_TIMEOUT_MS / 1_000),
    max: 1,
    prepare: false,
  }) as unknown as TestDatabaseClient;
}

function buildSchemaProbeQuery(): string {
  const objectEntries = REQUIRED_TEST_DATABASE_OBJECTS.map(
    (name) => `CASE WHEN to_regclass('${name}') IS NULL THEN '${name}' END`,
  );
  const columnEntries = REQUIRED_TEST_DATABASE_COLUMNS.map(
    ([table, column]) => `CASE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'
    ) THEN 'public.${table}.${column}' END`,
  );
  const nullableColumnEntries = REQUIRED_TEST_DATABASE_NULLABLE_COLUMNS.map(
    ([table, column]) => `CASE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'
        AND is_nullable = 'YES'
    ) THEN 'public.${table}.${column} (must be nullable)' END`,
  );
  return `SELECT ARRAY_REMOVE(ARRAY[${[
    ...objectEntries,
    ...columnEntries,
    ...nullableColumnEntries,
  ].join(',')}], NULL) AS missing`;
}

function readMissingObjects(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const missing = rows[0]?.missing;
  if (!Array.isArray(missing)) {
    throw new Error('invalid schema probe response');
  }
  return missing.filter((value): value is string => typeof value === 'string');
}
