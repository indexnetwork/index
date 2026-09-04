
import postgres from 'postgres';

const DEFAULT_TIMEOUT_MS = 10_000;

export const REQUIRED_TEST_DATABASE_OBJECTS = [
  'public.users',
  'public.networks',
  'public.network_members',
  'public.intents',
  'public.intent_networks',
  'public.intent_proposals',
  'public.opportunities',
  'public.conversations',
  'public.messages',
  'public.negotiations',
  'public.negotiation_turns',
  'public.agents',
  'public.apikey',
  'public.opportunity_outcome_events',
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
 * Database names that mark a database as carrying real user data.
 *
 * `TEST_DATABASE_SAFE=1` alone is a weak barrier: it says the operator believes
 * the target is disposable, but nothing checks that belief. In this project every
 * Neon branch — production, dev and local-dev alike — exposes a `protocol_prod`
 * database holding a copy of real user data, alongside an empty `neondb`. So the
 * database *name*, not the branch, is what distinguishes real data from a
 * disposable target.
 */
const REAL_DATA_DATABASE_NAMES = /^(.*_)?(prod|production)$/i;

/**
 * Extracts the database name from a PostgreSQL URL path.
 *
 * @param parsed - Parsed connection URL.
 * @returns The database name, or an empty string when the path carries none.
 */
function readDatabaseName(parsed: URL): string {
  return decodeURIComponent(parsed.pathname.replace(/^\//, '')).trim();
}

/**
 * Validates the test database URL without exposing credentials in diagnostics.
 *
 * @param value - Candidate PostgreSQL URL.
 * @returns The validated URL.
 * @throws When the URL is missing, malformed, uses a non-PostgreSQL scheme, or
 *   names a database that carries real user data.
 */
export function validateTestDatabaseUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      '[test-db] DATABASE_URL is missing. Configure a disposable test database in the repository-root .env.test.',
    );
  }

  let databaseName: string;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('invalid protocol');
    }
    databaseName = readDatabaseName(parsed);
  } catch {
    throw new Error('[test-db] DATABASE_URL must be a valid postgres:// or postgresql:// URL.');
  }

  // Deliberately fails closed with no override: an escape hatch here would
  // reintroduce exactly the footgun this check exists to remove. Point the suite
  // at a disposable database instead of teaching it to ignore the warning.
  if (REAL_DATA_DATABASE_NAMES.test(databaseName)) {
    throw new Error(
      `[test-db] Refusing to run tests against a database that carries real data: production-like database name ("${databaseName}"). `
      + 'Database-backed tests truncate and rewrite tables. Point DATABASE_URL in the repository-root '
      + '.env.test at a disposable database — for example the empty "neondb" on a Neon dev branch with '
      + 'migrations applied (cd services/api && bun run db:migrate) — never a *_prod/*_production database.',
    );
  }

  return value;
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
