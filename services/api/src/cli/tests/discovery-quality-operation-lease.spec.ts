import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { HISTORICAL_QUALITY_OPERATION_LEASE_ROOT, acquireHistoricalQualityOperationLeaseForTest, historicalQualityOperationLeasePath, historicalQualityOperationLeasePathForTest, releaseHistoricalQualityOperationLease, validateHistoricalQualityLeaseRootMetadataForTest } from '../discovery-quality-operation-lease';

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
  const chmodResult = Bun.spawnSync(['chmod', '1777', directory]);
  if (chmodResult.exitCode !== 0) throw new Error('test chmod failed');
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
  rootDirectory?: string;
  manifest: string;
  mode: 'hold' | 'once' | 'crash';
  readyPath: string;
  releasePath: string;
  home?: string;
  temporaryEnvironment?: Readonly<Record<'TMPDIR' | 'TMP' | 'TEMP', string>>;
}) {
  return Bun.spawn({
    cmd: [process.execPath, new URL('./fixtures/historical-quality-lease-process.ts', import.meta.url).pathname],
    env: {
      ...(input.rootDirectory === undefined ? {} : { HISTORICAL_QUALITY_TEST_LEASE_ROOT: input.rootDirectory }),
      ...(input.home === undefined ? {} : { HOME: input.home }),
      ...input.temporaryEnvironment,
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
  it('pins the production host-wide root to literal root-owned /tmp', async () => {
    expect(HISTORICAL_QUALITY_OPERATION_LEASE_ROOT).toBe('/tmp');
    expect(historicalQualityOperationLeasePath(manifest())).toStartWith('/tmp/');
    const root = await lstat(HISTORICAL_QUALITY_OPERATION_LEASE_ROOT);
    expect(root.isDirectory()).toBeTrue();
    expect(root.isSymbolicLink()).toBeFalse();
    expect(root.mode & 0o7777).toBe(0o1777);
    expect(root.uid).toBe(0);
    expect(root.gid).toBe(0);
  });

  it('rejects a user-owned sticky root under injected production authority', () => {
    expect(() => validateHistoricalQualityLeaseRootMetadataForTest({
      authority: 'production',
      rootDirectory: '/tmp',
      metadata: {
        isDirectory: true,
        isSymbolicLink: false,
        mode: 0o41777,
        uid: 1234,
        gid: 1234,
      },
    })).toThrow(/root-owned|uid 0/i);
  });

  it('rejects a test override not owned by the injected current uid', () => {
    expect(() => validateHistoricalQualityLeaseRootMetadataForTest({
      authority: 'test-override',
      rootDirectory: '/test-only-root',
      currentUid: 1234,
      metadata: {
        isDirectory: true,
        isSymbolicLink: false,
        mode: 0o41777,
        uid: 4321,
        gid: 4321,
      },
    })).toThrow(/owned by the current uid/i);
  });

  it('validates a sticky mode-01777 root and creates a mode-0700 lock directory with mode-0600 regular token', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'historical-quality-root-parent-'));
    temporaryDirectories.push(parent);
    const rootDirectory = path.join(parent, 'shared');
    await mkdir(rootDirectory);
    expect(Bun.spawnSync(['chmod', '1777', rootDirectory]).exitCode).toBe(0);
    const rawManifest = manifest();
    const lease = await acquireHistoricalQualityOperationLeaseForTest(rawManifest, { rootDirectory });
    const tokenPath = path.join(lease.path, 'owner.json');
    const contents = await readFile(tokenPath, 'utf8');
    const record = JSON.parse(contents) as Record<string, unknown>;

    const overrideRoot = await lstat(rootDirectory);
    expect(overrideRoot.mode & 0o7777).toBe(0o1777);
    expect(overrideRoot.uid).toBe(process.getuid());
    expect((await lstat(lease.path)).isDirectory()).toBeTrue();
    expect((await lstat(lease.path)).mode & 0o777).toBe(0o700);
    expect((await lstat(tokenPath)).isFile()).toBeTrue();
    expect((await lstat(tokenPath)).mode & 0o777).toBe(0o600);
    expect(record).toEqual({ version: 1, identifier: lease.identifier, ownerToken: lease.ownerToken, pid: process.pid });
    expect(lease.ownerToken).toMatch(/^[a-f0-9]{64}$/);
    for (const forbidden of ['replica-secret', 'side-a-secret', 'side-b-secret', 'postgresql://', 'project-id', 'side-a-branch-id']) {
      expect(contents).not.toContain(forbidden);
    }

    await expect(releaseHistoricalQualityOperationLease({ ...lease, ownerToken: 'f'.repeat(64) })).resolves.toBeFalse();
    expect(existsSync(lease.path)).toBeTrue();
    await expect(releaseHistoricalQualityOperationLease(lease)).resolves.toBeTrue();
    expect(existsSync(lease.path)).toBeFalse();
  });

  it('forces mode 0600 even under a restrictive caller umask', async () => {
    const rootDirectory = await temporaryRoot('mode');
    const previousUmask = process.umask(0o777);
    let lease: Awaited<ReturnType<typeof acquireHistoricalQualityOperationLeaseForTest>> | undefined;
    try {
      lease = await acquireHistoricalQualityOperationLeaseForTest(manifest(), { rootDirectory });
    } finally {
      process.umask(previousUmask);
    }
    expect((await stat(lease!.path)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(lease!.path, 'owner.json'))).mode & 0o777).toBe(0o600);
    await lease!.release();
  });

  it('keys only strict manifest-v2 project and side-a branch identity', async () => {
    const rootDirectory = await temporaryRoot('identity');
    const original = manifest();
    const changedSecrets = original
      .replace('replica-secret', 'other-replica-secret')
      .replace('side-a-secret', 'other-side-a-secret')
      .replace('side-b-secret', 'other-side-b-secret');
    const originalPath = historicalQualityOperationLeasePathForTest(original, { rootDirectory });

    expect(historicalQualityOperationLeasePathForTest(changedSecrets, { rootDirectory })).toBe(originalPath);
    expect(historicalQualityOperationLeasePathForTest(manifest({ projectId: 'other-project-id' }), { rootDirectory })).not.toBe(originalPath);
    expect(historicalQualityOperationLeasePathForTest(manifest({ sideABranchId: 'other-side-a-branch-id' }), { rootDirectory })).not.toBe(originalPath);
    expect(() => historicalQualityOperationLeasePathForTest(JSON.stringify({ projectId: 'project-id', targets: [] }), { rootDirectory }))
      .toThrow(/version 2|documented fields/);
  });

  it('uses an opaque fixed-root path even when strict v2 identifiers contain traversal text', async () => {
    const rootDirectory = await temporaryRoot('traversal');
    const rawManifest = manifest({ projectId: '../../project-secret', sideABranchId: '../side-a-secret' });
    const leasePath = historicalQualityOperationLeasePathForTest(rawManifest, { rootDirectory });

    expect(path.dirname(leasePath)).toBe(rootDirectory);
    expect(path.basename(leasePath)).toMatch(/^[a-f0-9]{64}\.lease$/);
    expect(leasePath).not.toContain('project-secret');
    expect(leasePath).not.toContain('side-a-secret');
    const lease = await acquireHistoricalQualityOperationLeaseForTest(rawManifest, { rootDirectory });
    expect(await readFile(path.join(lease.path, 'owner.json'), 'utf8')).not.toMatch(/project-secret|side-a-secret|postgresql:/);
    await lease.release();
  });

  it('contends in literal /tmp across fresh processes with different HOME and temp variables', async () => {
    const controlDirectory = await temporaryRoot('different-homes');
    const uniqueManifest = manifest({ projectId: `different-homes-${path.basename(controlDirectory)}` });
    const readyPath = path.join(controlDirectory, 'first.ready');
    const releasePath = path.join(controlDirectory, 'first.release');
    const first = spawnLeaseProcess({
      manifest: uniqueManifest,
      mode: 'hold',
      readyPath,
      releasePath,
      home: path.join(controlDirectory, 'home-one'),
      temporaryEnvironment: {
        TMPDIR: path.join(controlDirectory, 'tmpdir-one'),
        TMP: path.join(controlDirectory, 'tmp-one'),
        TEMP: path.join(controlDirectory, 'temp-one'),
      },
    });
    await waitForFile(readyPath);
    const second = spawnLeaseProcess({
      manifest: uniqueManifest,
      mode: 'once',
      readyPath: path.join(controlDirectory, 'second.ready'),
      releasePath: path.join(controlDirectory, 'second.release'),
      home: path.join(controlDirectory, 'home-two'),
      temporaryEnvironment: {
        TMPDIR: path.join(controlDirectory, 'tmpdir-two'),
        TMP: path.join(controlDirectory, 'tmp-two'),
        TEMP: path.join(controlDirectory, 'temp-two'),
      },
    });
    expect(await second.exited).toBe(2);
    expect(await new Response(second.stderr).text()).toMatch(/already held/);
    await writeFile(releasePath, 'release');
    expect(await first.exited).toBe(0);
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
    const third = await acquireHistoricalQualityOperationLeaseForTest(manifest(), { rootDirectory });
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

    const leasePath = historicalQualityOperationLeasePathForTest(manifest(), { rootDirectory });
    const staleContents = await readFile(path.join(leasePath, 'owner.json'), 'utf8');
    await expect(acquireHistoricalQualityOperationLeaseForTest(manifest(), { rootDirectory })).rejects.toThrow(/already held/);
    expect(await readFile(path.join(leasePath, 'owner.json'), 'utf8')).toBe(staleContents);
  });

  it('fails closed for malformed or symlink roots and existing lock path types', async () => {
    const parent = await temporaryRoot('attacks');
    const malformedRoot = path.join(parent, 'malformed-root');
    await mkdir(malformedRoot, { mode: 0o755 });
    await expect(acquireHistoricalQualityOperationLeaseForTest(manifest(), { rootDirectory: malformedRoot })).rejects.toThrow(/root/i);

    const realRoot = path.join(parent, 'real-root');
    await mkdir(realRoot);
    expect(Bun.spawnSync(['chmod', '1777', realRoot]).exitCode).toBe(0);
    const linkedRoot = path.join(parent, 'linked-root');
    await symlink(realRoot, linkedRoot);
    await expect(acquireHistoricalQualityOperationLeaseForTest(manifest(), { rootDirectory: linkedRoot })).rejects.toThrow(/root/i);

    const lockPath = historicalQualityOperationLeasePathForTest(manifest(), { rootDirectory: realRoot });
    await symlink(path.join(parent, 'missing-target'), lockPath);
    await expect(acquireHistoricalQualityOperationLeaseForTest(manifest(), { rootDirectory: realRoot })).rejects.toThrow(/already held|lock/i);
    expect((await lstat(lockPath)).isSymbolicLink()).toBeTrue();
  });

  it('fails closed when the token is a symlink, malformed, or has unsafe permissions', async () => {
    for (const attack of ['symlink', 'malformed', 'mode'] as const) {
      const rootDirectory = await temporaryRoot(`token-${attack}`);
      const lease = await acquireHistoricalQualityOperationLeaseForTest(manifest(), { rootDirectory });
      const tokenPath = path.join(lease.path, 'owner.json');
      if (attack === 'symlink') {
        const target = path.join(rootDirectory, 'foreign-token');
        await writeFile(target, JSON.stringify({ ownerToken: lease.ownerToken }));
        await rm(tokenPath);
        await symlink(target, tokenPath);
      } else if (attack === 'malformed') {
        await writeFile(tokenPath, '{not-json');
      } else {
        await chmod(tokenPath, 0o644);
      }
      await expect(lease.release()).resolves.toBeFalse();
      expect(existsSync(lease.path)).toBeTrue();
    }
  });

  it('never deletes a replacement stable directory inserted before rename', async () => {
    const rootDirectory = await temporaryRoot('replacement-race');
    const lease = await acquireHistoricalQualityOperationLeaseForTest(manifest(), { rootDirectory });
    const displacedPath = `${lease.path}.displaced`;
    let replacementTokenPath = '';

    const released = await releaseHistoricalQualityOperationLease(lease, {
      beforeRename: async () => {
        await rename(lease.path, displacedPath);
        await mkdir(lease.path, { mode: 0o700 });
        replacementTokenPath = path.join(lease.path, 'owner.json');
        await writeFile(replacementTokenPath, 'replacement', { mode: 0o600 });
      },
    });

    expect(released).toBeFalse();
    expect(await readFile(replacementTokenPath, 'utf8')).toBe('replacement');
    expect(existsSync(displacedPath)).toBeTrue();
  });

  it('fails closed when the unique tombstone is inserted before rename', async () => {
    const rootDirectory = await temporaryRoot('rename-race');
    const lease = await acquireHistoricalQualityOperationLeaseForTest(manifest(), { rootDirectory });
    let racedTombstone = '';
    const released = await releaseHistoricalQualityOperationLease(lease, {
      beforeRename: async ({ tombstonePath }) => {
        racedTombstone = tombstonePath;
        await mkdir(tombstonePath, { mode: 0o700 });
      },
    });
    expect(released).toBeFalse();
    expect(existsSync(lease.path)).toBeTrue();
    expect(existsSync(racedTombstone)).toBeTrue();
  });
});
