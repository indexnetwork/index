import { writeFile } from 'node:fs/promises';

import { acquireHistoricalQualityOperationLease } from '../../discovery-quality-operation-lease';

const rootDirectory = process.env.HISTORICAL_QUALITY_TEST_LEASE_ROOT;
const manifest = process.env.HISTORICAL_QUALITY_TEST_MANIFEST;
const mode = process.env.HISTORICAL_QUALITY_TEST_MODE;
const readyPath = process.env.HISTORICAL_QUALITY_TEST_READY_PATH;
const releasePath = process.env.HISTORICAL_QUALITY_TEST_RELEASE_PATH;

if (!rootDirectory || !manifest || !readyPath || !releasePath || !['hold', 'once', 'crash'].includes(mode ?? '')) {
  process.exit(64);
}

try {
  const lease = await acquireHistoricalQualityOperationLease(manifest, { rootDirectory });
  await writeFile(readyPath, lease.identifier);
  if (mode === 'crash') process.exit(86);
  if (mode === 'once') {
    await lease.release();
    process.exit(0);
  }
  while (!(await Bun.file(releasePath).exists())) await Bun.sleep(5);
  if (!await lease.release()) process.exit(74);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'lease failure');
  process.exit(2);
}
