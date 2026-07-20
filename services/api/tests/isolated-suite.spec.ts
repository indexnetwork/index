import { test } from 'bun:test';
import path from 'node:path';

import { ISOLATED_SUITE_TIMEOUT_MS, runIsolatedTestSuite } from '../src/lib/testing/isolated-test-runner';

const isolatedOnly = process.env.API_TEST_ISOLATED_ONLY === '1';

test.skipIf(!isolatedOnly)(
  'executes every isolated manifest entry in a fresh Bun subprocess',
  async () => {
    await runIsolatedTestSuite(path.resolve(import.meta.dir, '..'));
  },
  ISOLATED_SUITE_TIMEOUT_MS,
);
