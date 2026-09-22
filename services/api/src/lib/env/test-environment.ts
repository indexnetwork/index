import { config, type DotenvConfigOutput } from 'dotenv';

interface EnvironmentMap {
  [key: string]: string | undefined;
}

interface EnvironmentLoadOptions {
  requestedNodeEnv: string | undefined;
  testEnvPath: string;
  developmentEnvPath: string;
  environment?: EnvironmentMap;
  load?: (options: { path: string; override: boolean }) => DotenvConfigOutput;
}

export interface LoadedEnvironment {
  envFile: string;
  testMode: boolean;
}

const RESERVED_TEST_ENV_KEYS = [
  'API_TEST_DATABASE_READY',
  'API_TEST_HERMES_ASSURANCE_QUIET',
  'API_TEST_ISOLATED_CHILD',
  'API_TEST_ISOLATED_ONLY',
  'API_TEST_ISOLATED_TARGET',
  'API_TEST_PARENT_PID',
  'API_TEST_REQUIRE_DATABASE',
] as const;

/**
 * Loads the selected environment file while preserving fail-closed test mode.
 *
 * Test mode is latched before dotenv runs. A test file may omit `NODE_ENV` or
 * set it to `test`, but it cannot downgrade the process to another mode.
 * Local development values override inherited variables; deployments preserve
 * their platform-injected environment.
 *
 * @param options - Environment paths and injectable state/loader for tests.
 * @returns The selected file and whether test mode was latched.
 * @throws When a test invocation declares a conflicting `NODE_ENV` value.
 */
export function loadEnvironmentWithTestLock(options: EnvironmentLoadOptions): LoadedEnvironment {
  const environment = options.environment ?? process.env;
  const testMode = options.requestedNodeEnv === 'test';
  const envFile = testMode ? options.testEnvPath : options.developmentEnvPath;
  const load = options.load ?? config;
  const developmentMode = !testMode && options.requestedNodeEnv !== 'production' &&
    !environment.RAILWAY_ENVIRONMENT && !environment.RAILWAY_ENVIRONMENT_NAME;
  const preservedReservedValues = Object.fromEntries(
    RESERVED_TEST_ENV_KEYS.map((key) => [key, environment[key]]),
  ) as Record<(typeof RESERVED_TEST_ENV_KEYS)[number], string | undefined>;
  const result = load({ path: envFile, override: testMode || developmentMode });

  if (testMode) {
    // Restore latched test mode and parent-owned orchestration markers before
    // validating any safety/runtime behavior.
    environment.NODE_ENV = 'test';
    const declaredReservedKey = RESERVED_TEST_ENV_KEYS.find(
      (key) => result.parsed?.[key] !== undefined,
    );
    for (const key of RESERVED_TEST_ENV_KEYS) {
      const preservedValue = preservedReservedValues[key];
      if (preservedValue === undefined) delete environment[key];
      else environment[key] = preservedValue;
    }
    if (declaredReservedKey) {
      throw new Error(
        `[test-env] ${envFile} may not declare reserved variable ${declaredReservedKey}.`,
      );
    }
    const declaredNodeEnv = result.parsed?.NODE_ENV?.trim();
    if (declaredNodeEnv && declaredNodeEnv !== 'test') {
      throw new Error(
        `[test-env] Refusing to continue: ${envFile} declares NODE_ENV=${declaredNodeEnv}. Remove it or set NODE_ENV=test.`,
      );
    }
  }

  return { envFile, testMode };
}

/**
 * Enforces the explicit disposable-database marker for test migrations.
 *
 * @param testMode - Whether test mode was latched before dotenv loading.
 * @param safeMarker - Explicit disposable-database acknowledgement.
 * @throws When a test migration lacks the safety marker.
 */
export function requireSafeTestMigration(testMode: boolean, safeMarker: string | undefined): void {
  if (testMode && safeMarker !== '1') {
    throw new Error(
      'Refusing test migrations because TEST_DATABASE_SAFE=1 is not set. Configure a dedicated disposable test database.',
    );
  }
}
