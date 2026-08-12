import { constants } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readdir, rename, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import { parseHistoricalQualityManifest } from './discovery.neon';

export const HISTORICAL_QUALITY_OPERATION_LEASE_ROOT = '/tmp';

const LEASE_TOKEN_NAME = 'owner.json';
const ROOT_MODE = 0o1777;
const LOCK_MODE = 0o700;
const TOKEN_MODE = 0o600;

const ROOT_AUTHORITY_BRAND = Symbol('historical-quality-root-authority');

type HistoricalQualityLeaseRootAuthority = Readonly<{
  [ROOT_AUTHORITY_BRAND]: true;
  kind: 'production' | 'test-override';
  rootDirectory: string;
  expectedUid: number;
  expectedGid?: number;
}>;

export interface HistoricalQualityOperationLease {
  readonly identifier: string;
  /** Stable lock directory, not the token file within it. */
  readonly path: string;
  readonly ownerToken: string;
  /** Root authority validated at acquisition and required again at release. */
  readonly rootAuthority: HistoricalQualityLeaseRootAuthority;
  release(): Promise<boolean>;
}

interface HistoricalQualityOperationLeaseTestOptions {
  rootDirectory: string;
}

interface HistoricalQualityOperationLeaseReleaseInput {
  path: string;
  ownerToken: string;
  rootAuthority: HistoricalQualityLeaseRootAuthority;
}

interface HistoricalQualityOperationLeaseReleaseTestHooks {
  /** Narrow race injection used only by the filesystem acceptance tests. */
  beforeRename?: (input: { tombstonePath: string }) => Promise<void>;
}

interface LeaseRootMetadata {
  isDirectory: boolean;
  isSymbolicLink: boolean;
  mode: number;
  uid: number;
  gid: number;
}

function leaseIdentifier(rawManifest: string | undefined): string {
  const manifest = parseHistoricalQualityManifest(rawManifest);
  const sideA = manifest.targets.find((target) => target.sideId === 'a');
  if (!sideA) throw new Error('Historical quality manifest has no side-a lease identity');
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    projectId: manifest.projectId,
    sideABranchId: sideA.branchId,
  })).digest('hex');
}

function leasePath(rawManifest: string | undefined, rootDirectory: string): string {
  return path.join(rootDirectory, `${leaseIdentifier(rawManifest)}.lease`);
}

export function historicalQualityOperationLeasePath(rawManifest: string | undefined): string {
  return leasePath(rawManifest, HISTORICAL_QUALITY_OPERATION_LEASE_ROOT);
}

/** Test-only custom-root path seam; production always uses literal `/tmp`. */
export function historicalQualityOperationLeasePathForTest(
  rawManifest: string | undefined,
  options: HistoricalQualityOperationLeaseTestOptions,
): string {
  return leasePath(rawManifest, options.rootDirectory);
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
}

function isAlreadyExists(error: unknown): boolean {
  return errorCode(error) === 'EEXIST';
}

function sameIdentity(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function exactMode(mode: number, expected: number): boolean {
  return (mode & 0o7777) === expected;
}

function productionRootAuthority(): HistoricalQualityLeaseRootAuthority {
  return Object.freeze({
    [ROOT_AUTHORITY_BRAND]: true as const,
    kind: 'production',
    rootDirectory: HISTORICAL_QUALITY_OPERATION_LEASE_ROOT,
    expectedUid: 0,
    expectedGid: 0,
  });
}

function testOverrideRootAuthority(rootDirectory: string): HistoricalQualityLeaseRootAuthority {
  const currentUid = process.getuid?.();
  if (currentUid === undefined) {
    throw new Error('Historical quality test lease root requires a current POSIX uid');
  }
  return Object.freeze({
    [ROOT_AUTHORITY_BRAND]: true as const,
    kind: 'test-override',
    rootDirectory,
    expectedUid: currentUid,
  });
}

function validateLeaseRootMetadata(authority: HistoricalQualityLeaseRootAuthority, root: LeaseRootMetadata): void {
  if (authority.kind === 'production' && authority.rootDirectory !== HISTORICAL_QUALITY_OPERATION_LEASE_ROOT) {
    throw new Error('Historical quality production lease root must be literal /tmp');
  }
  if (!path.isAbsolute(authority.rootDirectory)
    || !root.isDirectory
    || root.isSymbolicLink
    || !exactMode(root.mode, ROOT_MODE)) {
    throw new Error('Historical quality operation lease root must be an exact non-symlink mode-01777 directory');
  }
  if (root.uid !== authority.expectedUid) {
    throw new Error(authority.kind === 'production'
      ? 'Historical quality production lease root must be root-owned (uid 0)'
      : 'Historical quality test override lease root must be owned by the current uid');
  }
  if (authority.expectedGid !== undefined && root.gid !== authority.expectedGid) {
    throw new Error('Historical quality production lease root must be root-group-owned (gid 0)');
  }
}

async function validateLeaseRoot(authority: HistoricalQualityLeaseRootAuthority): Promise<void> {
  let root;
  try {
    root = await lstat(authority.rootDirectory);
  } catch (error) {
    throw new Error('Historical quality operation lease root is unavailable', { cause: error });
  }
  validateLeaseRootMetadata(authority, {
    isDirectory: root.isDirectory(),
    isSymbolicLink: root.isSymbolicLink(),
    mode: root.mode,
    uid: root.uid,
    gid: root.gid,
  });
}

/** Metadata injection seam proving production authority without modifying `/tmp`. */
export function validateHistoricalQualityLeaseRootMetadataForTest(input: {
  authority: 'production' | 'test-override';
  rootDirectory: string;
  currentUid?: number;
  metadata: LeaseRootMetadata;
}): void {
  const production = input.authority === 'production';
  validateLeaseRootMetadata(Object.freeze({
    [ROOT_AUTHORITY_BRAND]: true as const,
    kind: input.authority,
    rootDirectory: input.rootDirectory,
    expectedUid: production ? 0 : (input.currentUid ?? process.getuid?.() ?? -1),
    ...(production ? { expectedGid: 0 } : {}),
  }), input.metadata);
}

function exactLeaseOwner(raw: string, ownerToken: string, identifier: string): boolean {
  try {
    const record = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return keys.join(',') === 'identifier,ownerToken,pid,version'
      && record.version === 1
      && record.identifier === identifier
      && record.ownerToken === ownerToken
      && typeof record.pid === 'number'
      && Number.isSafeInteger(record.pid)
      && record.pid > 0;
  } catch {
    return false;
  }
}

function identifierFromLeasePath(leasePath: string): string | undefined {
  const match = /^([a-f0-9]{64})\.lease$/.exec(path.basename(leasePath));
  return match?.[1];
}

function tombstonePathFor(leasePath: string, ownerToken: string): string {
  const tokenDigest = createHash('sha256').update(ownerToken).digest('hex');
  return path.join(path.dirname(leasePath), `${path.basename(leasePath)}.tombstone-${tokenDigest}`);
}

async function hasIdentityTombstone(rootDirectory: string, leasePath: string): Promise<boolean> {
  const prefix = `${path.basename(leasePath)}.tombstone-`;
  return (await readdir(rootDirectory)).some((entry) => entry.startsWith(prefix));
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  if (handle) await handle.close().catch(() => undefined);
}

/**
 * Validates the stable directory and its regular no-follow token, atomically
 * moves that exact directory out of the acquisition pathname, and only then
 * deletes token/tombstone contents. Wrong, malformed, replaced, or foreign
 * ownership state remains fail-closed.
 */
export async function releaseHistoricalQualityOperationLease(
  input: HistoricalQualityOperationLeaseReleaseInput,
  testHooks: HistoricalQualityOperationLeaseReleaseTestHooks = {},
): Promise<boolean> {
  const identifier = identifierFromLeasePath(input.path);
  if (!identifier
    || !/^[a-f0-9]{64}$/.test(input.ownerToken)
    || input.rootAuthority[ROOT_AUTHORITY_BRAND] !== true
    || path.dirname(input.path) !== input.rootAuthority.rootDirectory) return false;
  await validateLeaseRoot(input.rootAuthority);

  let stablePathStat;
  try {
    stablePathStat = await lstat(input.path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
  if (!stablePathStat.isDirectory() || stablePathStat.isSymbolicLink() || !exactMode(stablePathStat.mode, LOCK_MODE)) return false;

  let directoryHandle: FileHandle | undefined;
  let tokenHandle: FileHandle | undefined;
  let tokenPathStat;
  try {
    directoryHandle = await open(input.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const directoryHandleStat = await directoryHandle.stat();
    if (!directoryHandleStat.isDirectory() || !exactMode(directoryHandleStat.mode, LOCK_MODE)
      || !sameIdentity(stablePathStat, directoryHandleStat)) return false;

    const tokenPath = path.join(input.path, LEASE_TOKEN_NAME);
    try {
      tokenPathStat = await lstat(tokenPath);
      if (!tokenPathStat.isFile() || tokenPathStat.isSymbolicLink() || !exactMode(tokenPathStat.mode, TOKEN_MODE)) return false;
      tokenHandle = await open(tokenPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ELOOP') return false;
      throw error;
    }
    const tokenHandleStat = await tokenHandle.stat();
    if (!tokenHandleStat.isFile() || !exactMode(tokenHandleStat.mode, TOKEN_MODE)
      || !sameIdentity(tokenPathStat, tokenHandleStat)) return false;
    const raw = await tokenHandle.readFile('utf8');
    if (!exactLeaseOwner(raw, input.ownerToken, identifier)) return false;

    const tombstonePath = tombstonePathFor(input.path, input.ownerToken);
    try {
      await lstat(tombstonePath);
      return false;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    await testHooks.beforeRename?.({ tombstonePath });

    // Revalidate both source and unique destination immediately before rename.
    // Sticky-root permissions prevent a normal different-user contender from
    // replacing the source between this check and the atomic rename.
    let stableBeforeRename;
    try {
      stableBeforeRename = await lstat(input.path);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false;
      throw error;
    }
    if (!stableBeforeRename.isDirectory() || !exactMode(stableBeforeRename.mode, LOCK_MODE)
      || !sameIdentity(stablePathStat, stableBeforeRename)) return false;
    try {
      await lstat(tombstonePath);
      return false;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }

    try {
      await rename(input.path, tombstonePath);
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EEXIST' || errorCode(error) === 'ENOTEMPTY') return false;
      throw error;
    }
    const tombstoneStat = await lstat(tombstonePath);
    if (!tombstoneStat.isDirectory() || !exactMode(tombstoneStat.mode, LOCK_MODE)
      || !sameIdentity(stablePathStat, tombstoneStat)) return false;

    const movedTokenPath = path.join(tombstonePath, LEASE_TOKEN_NAME);
    const movedTokenStat = await lstat(movedTokenPath);
    if (!movedTokenStat.isFile() || !exactMode(movedTokenStat.mode, TOKEN_MODE)
      || !sameIdentity(tokenPathStat, movedTokenStat)) return false;

    await closeQuietly(tokenHandle);
    tokenHandle = undefined;
    await closeQuietly(directoryHandle);
    directoryHandle = undefined;
    await unlink(movedTokenPath);
    await rmdir(tombstonePath);
    return true;
  } finally {
    await closeQuietly(tokenHandle);
    await closeQuietly(directoryHandle);
  }
}

/**
 * Acquires the host-wide lease by atomically creating its identity-hash lock
 * directory. Existing locks and crash-left tombstones are never expired,
 * repaired, replaced, or automatically removed.
 */
async function acquireWithRootAuthority(
  rawManifest: string | undefined,
  rootAuthority: HistoricalQualityLeaseRootAuthority,
): Promise<HistoricalQualityOperationLease> {
  const identifier = leaseIdentifier(rawManifest);
  const rootDirectory = rootAuthority.rootDirectory;
  const leasePath = path.join(rootDirectory, `${identifier}.lease`);
  const ownerToken = randomBytes(32).toString('hex');
  await validateLeaseRoot(rootAuthority);

  if (await hasIdentityTombstone(rootDirectory, leasePath)) {
    throw new Error(`Historical quality operation lease is already held (${identifier})`);
  }
  try {
    await mkdir(leasePath, { mode: LOCK_MODE });
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error(`Historical quality operation lease is already held (${identifier})`, { cause: error });
    }
    throw error;
  }
  await chmod(leasePath, LOCK_MODE);
  const lockStat = await lstat(leasePath);
  if (!lockStat.isDirectory() || lockStat.isSymbolicLink() || !exactMode(lockStat.mode, LOCK_MODE)) {
    throw new Error(`Historical quality operation lease lock is malformed (${identifier})`);
  }
  // This second check closes the rename-to-tombstone/acquire race: if the old
  // owner moved its lock before our mkdir, the tombstone is now visible and the
  // newly created stable directory is deliberately left fail-closed.
  if (await hasIdentityTombstone(rootDirectory, leasePath)) {
    throw new Error(`Historical quality operation lease is already held (${identifier})`);
  }

  const tokenPath = path.join(leasePath, LEASE_TOKEN_NAME);
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      tokenPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      TOKEN_MODE,
    );
    await handle.chmod(TOKEN_MODE);
    await handle.writeFile(`${JSON.stringify({ version: 1, identifier, ownerToken, pid: process.pid })}\n`, 'utf8');
    await handle.sync();
    const tokenStat = await handle.stat();
    if (!tokenStat.isFile() || !exactMode(tokenStat.mode, TOKEN_MODE)) {
      throw new Error(`Historical quality operation lease token is malformed (${identifier})`);
    }
  } finally {
    await closeQuietly(handle);
  }

  return Object.freeze({
    identifier,
    path: leasePath,
    ownerToken,
    rootAuthority,
    release: () => releaseHistoricalQualityOperationLease({ path: leasePath, ownerToken, rootAuthority }),
  });
}

/** Production entry point: no environment or caller-provided root is read. */
export async function acquireHistoricalQualityOperationLease(
  rawManifest: string | undefined,
): Promise<HistoricalQualityOperationLease> {
  return acquireWithRootAuthority(rawManifest, productionRootAuthority());
}

/** Explicit custom-root seam for filesystem tests; the root must be caller-owned. */
export async function acquireHistoricalQualityOperationLeaseForTest(
  rawManifest: string | undefined,
  options: HistoricalQualityOperationLeaseTestOptions,
): Promise<HistoricalQualityOperationLease> {
  return acquireWithRootAuthority(rawManifest, testOverrideRootAuthority(options.rootDirectory));
}
