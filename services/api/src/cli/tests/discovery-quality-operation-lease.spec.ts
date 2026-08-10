import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { acquireHistoricalQualityOperationLease, historicalQualityOperationLeasePath, releaseHistoricalQualityOperationLease } from '../discovery-quality-operation-lease';

const temporaryDirectories: string[] = [];

function manifest(overrides: { projectId?: string; sideABranchId?: string } = {}): string {
  return JSON.stringify({
    version: 2,
    projectId: overrides.projectId ?? 'project-id',
    baseBranchId: 'base-branch-id',
    baseReadReplica: {
      endpointId: 'replica-endpoint-id',
      databaseUrl: 'postgresql://replica:replica-secret@replica.neon.tech/protocol_eval',
    },
    targets: [
      {
        sideId: 'a',
        branchId: overrides.sideABranchId ?? 'side-a-branch-id',
        endpointId: 'side-a-endpoint-id',
        databaseUrl: 'postgresql://sidea:side-a-secret@side-a.neon.tech/protocol_eval',
      },
      {
        sideId: 'b',
        branchId: 'side-b-branch-id',
        endpointId: 'side-b-endpoint-id',
        databaseUrl: 'postgresql://sideb:side-b-secret@side-b.neon.tech/protocol_eval',
      },
    ],
  });
}

async function temporaryRoot(label: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), `historical-quality-lease-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

async function waitForFile(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(filePath)) return;
    await Bun.sleep(5);
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}`);
}

function spawnLeaseProcess(input: {
  rootDirectory: string;
  manifest: string;
  mode: 'hold' | 'once' | 'crash';
  readyPath: string;
  releasePath: string;
}) {
  return Bun.spawn({
    cmd: [process.execPath, new URL('./fixtures/historical-quality-lease-process.ts', import.meta.url).pathname],
    env: {
      HISTORICAL_QUALITY_TEST_LEASE_ROOT: input.rootDirectory,
      HISTORICAL_QUALITY_TEST_MANIFEST: input.manifest,
      HISTORICAL_QUALITY_TEST_MODE: input.mode,
      HISTORICAL_QUALITY_TEST_READY_PATH: input.readyPath,
      HISTORICAL_QUALITY_TEST_RELEASE_PATH: input.releasePath,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('historical quality filesystem operation lease', () => {
  it('creates a mode-0600 identifier-only lease and releases only its own random token', async () => {
    const rootDirectory = await temporaryRoot('ownership');
    const rawManifest = manifest();
    const lease = await acquireHistoricalQualityOperationLease(rawManifest, { rootDirectory });
    const contents = await readFile(lease.path, 'utf8');
    const record = JSON.parse(contents) as Record<string, unknown>;

    expect((await stat(lease.path)).mode & 0o777).toBe(0o600);
    expect(record).toEqual({
      version: 1,
      identifier: lease.identifier,
      ownerToken: lease.ownerToken,
      pid: process.pid,
    });
    expect(lease.ownerToken).toMatch(/^[a-f0-9]{64}$/);
    for (const forbidden of ['replica-secret', 'side-a-secret', 'side-b-secret', 'postgresql://', 'project-id', 'side-a-branch-id']) {
      expect(contents).not.toContain(forbidden);
    }

    await expect(releaseHistoricalQualityOperationLease({ path: lease.path, ownerToken: 'f'.repeat(64) })).resolves.toBeFalse();
    expect(existsSync(lease.path)).toBeTrue();
    await expect(lease.release()).resolves.toBeTrue();
    expect(existsSync(lease.path)).toBeFalse();
  });

  it('forces mode 0600 even under a restrictive caller umask', async () => {
    const rootDirectory = await temporaryRoot('mode');
    const previousUmask = process.umask(0o777);
    let lease: Awaited<ReturnType<typeof acquireHistoricalQualityOperationLease>> | undefined;
    try {
      lease = await acquireHistoricalQualityOperationLease(manifest(), { rootDirectory });
    } finally {
      process.umask(previousUmask);
    }
    expect((await stat(lease!.path)).mode & 0o777).toBe(0o600);
    await lease!.release();
  });

  it('keys only strict manifest-v2 project and side-a branch identity', async () => {
    const rootDirectory = await temporaryRoot('identity');
    const original = manifest();
    const changedSecrets = original
      .replace('replica-secret', 'other-replica-secret')
      .replace('side-a-secret', 'other-side-a-secret')
      .replace('side-b-secret', 'other-side-b-secret');
    const originalPath = historicalQualityOperationLeasePath(original, { rootDirectory });

    expect(historicalQualityOperationLeasePath(changedSecrets, { rootDirectory })).toBe(originalPath);
    expect(historicalQualityOperationLeasePath(manifest({ projectId: 'other-project-id' }), { rootDirectory })).not.toBe(originalPath);
    expect(historicalQualityOperationLeasePath(manifest({ sideABranchId: 'other-side-a-branch-id' }), { rootDirectory })).not.toBe(originalPath);
    expect(() => historicalQualityOperationLeasePath(JSON.stringify({ projectId: 'project-id', targets: [] }), { rootDirectory }))
      .toThrow(/version 2|documented fields/);
  });

  it('uses an opaque fixed-root path even when strict v2 identifiers contain traversal text', async () => {
    const rootDirectory = await temporaryRoot('traversal');
    const rawManifest = manifest({ projectId: '../../project-secret', sideABranchId: '../side-a-secret' });
    const leasePath = historicalQualityOperationLeasePath(rawManifest, { rootDirectory });

    expect(path.dirname(leasePath)).toBe(rootDirectory);
    expect(path.basename(leasePath)).toMatch(/^[a-f0-9]{64}\.lease$/);
    expect(leasePath).not.toContain('project-secret');
    expect(leasePath).not.toContain('side-a-secret');
    const lease = await acquireHistoricalQualityOperationLease(rawManifest, { rootDirectory });
    expect(await readFile(lease.path, 'utf8')).not.toMatch(/project-secret|side-a-secret|postgresql:/);
    await lease.release();
  });

  it('atomically refuses a concurrent second process until the owner releases', async () => {
    const rootDirectory = await temporaryRoot('process-contention');
    const readyPath = path.join(rootDirectory, 'first.ready');
    const releasePath = path.join(rootDirectory, 'first.release');
    const first = spawnLeaseProcess({ rootDirectory, manifest: manifest(), mode: 'hold', readyPath, releasePath });
    await waitForFile(readyPath);

    const second = spawnLeaseProcess({
      rootDirectory,
      manifest: manifest(),
      mode: 'once',
      readyPath: path.join(rootDirectory, 'second.ready'),
      releasePath: path.join(rootDirectory, 'second.release'),
    });
    expect(await second.exited).toBe(2);
    expect(await new Response(second.stderr).text()).toMatch(/already held/);

    await writeFile(releasePath, 'release');
    expect(await first.exited).toBe(0);
    const third = await acquireHistoricalQualityOperationLease(manifest(), { rootDirectory });
    await expect(third.release()).resolves.toBeTrue();
  });

  it('leaves a crashed lease stale and refuses every later process without automatic deletion', async () => {
    const rootDirectory = await temporaryRoot('crash-stale');
    const readyPath = path.join(rootDirectory, 'crashed.ready');
    const crashed = spawnLeaseProcess({
      rootDirectory,
      manifest: manifest(),
      mode: 'crash',
      readyPath,
      releasePath: path.join(rootDirectory, 'unused.release'),
    });
    expect(await crashed.exited).toBe(86);
    await waitForFile(readyPath);

    const leasePath = historicalQualityOperationLeasePath(manifest(), { rootDirectory });
    const staleContents = await readFile(leasePath, 'utf8');
    await expect(acquireHistoricalQualityOperationLease(manifest(), { rootDirectory })).rejects.toThrow(/already held/);
    expect(await readFile(leasePath, 'utf8')).toBe(staleContents);
  });
});
