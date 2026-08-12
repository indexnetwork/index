import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadIsolatedTestInventory } from './isolated-test-suite';

const TARGET_ENV = 'API_TEST_ISOLATED_TARGET';
const target = process.env[TARGET_ENV];

if (target !== undefined) {
  const apiRoot = path.resolve(import.meta.dir, '../../..');
  if (
    target.length === 0
    || path.isAbsolute(target)
    || target.includes('\\')
    || path.posix.normalize(target) !== target
    || (!target.startsWith('src/') && !target.startsWith('tests/'))
    || !target.endsWith('.isolated.ts')
  ) {
    throw new Error(`[isolated-tests] Invalid ${TARGET_ENV}.`);
  }

  const inventory = loadIsolatedTestInventory(apiRoot);
  if (!inventory.files.includes(target)) {
    throw new Error(`[isolated-tests] Target is not registered in .test-isolated: ${target}`);
  }

  await import(pathToFileURL(path.resolve(apiRoot, target)).href);
}
