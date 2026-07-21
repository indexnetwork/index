/**
 * Bun test preload script — runs before any test module is evaluated.
 *
 * Loads the repo-root `.env.test` (see root .env.example) as the authoritative
 * test environment. Full-suite invocations validate the disposable test
 * database before Bun imports any specs; targeted specs defer the same check to
 * imports of the real Drizzle singleton so hermetic module-mock tests stay DB-free.
 */
import { afterAll } from 'bun:test';
import path from 'node:path';

import { ensureTestDatabaseReady, readOriginalProcessArgv, shouldRequireTestDatabase } from './lib/drizzle/test-database-readiness';
import { latchTestInvocationNodeEnv, loadEnvironmentWithTestLock, requireTestMode } from './lib/env/test-environment';
import { ISOLATED_SUITE_TIMEOUT_MS, runIsolatedTestSuite } from './lib/testing/isolated-test-runner';
import { assertNoDiscoverableModuleMocks, listDiscoverableTestFiles, loadIsolatedTestInventory } from './lib/testing/isolated-test-suite';

const rootDirectory = path.resolve(import.meta.dir, '../../..');
const loadedEnvironment = loadEnvironmentWithTestLock({
  requestedNodeEnv: latchTestInvocationNodeEnv(process.env.NODE_ENV),
  testEnvPath: path.join(rootDirectory, '.env.test'),
  developmentEnvPath: path.join(rootDirectory, '.env.development'),
});
requireTestMode(loadedEnvironment);

const apiRoot = path.resolve(import.meta.dir, '..');
const isolatedChild = process.env.API_TEST_ISOLATED_CHILD === '1';
const discoverableFiles = isolatedChild
  ? []
  : listDiscoverableTestFiles(apiRoot).map((file) => path.join(apiRoot, file));
const fullSuite = shouldRequireTestDatabase(readOriginalProcessArgv(), process.env, discoverableFiles);
if (!isolatedChild) {
  loadIsolatedTestInventory(apiRoot);
  assertNoDiscoverableModuleMocks(apiRoot);
}

// The contacts/ghost-user feature is disabled-when-unset in production. Default
// it ON for the test suite so existing contact specs exercise the happy path;
// specs that assert the disabled behaviour override this locally with 'false'.
process.env.CONTACTS_ENABLED = process.env.CONTACTS_ENABLED ?? 'true';

if (fullSuite) {
  await ensureTestDatabaseReady();
  afterAll(
    async () => {
      const { closeDb } = await import('./lib/drizzle/drizzle');
      await closeDb();
      await runIsolatedTestSuite(apiRoot);
    },
    ISOLATED_SUITE_TIMEOUT_MS,
  );
}
