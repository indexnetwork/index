import { createHash, randomBytes } from 'node:crypto';
import { chmod, open, mkdir, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { parseHistoricalQualityManifest } from './discovery.neon';

export const HISTORICAL_QUALITY_OPERATION_LEASE_ROOT = path.join(
  homedir(),
  '.indexnetwork',
  'historical-quality-leases',
);

export interface HistoricalQualityOperationLease {
  readonly identifier: string;
  readonly path: string;
  readonly ownerToken: string;
  release(): Promise<boolean>;
}

interface HistoricalQualityOperationLeaseOptions {
  rootDirectory?: string;
}

interface HistoricalQualityOperationLeaseReleaseInput {
  path: string;
  ownerToken: string;
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

export function historicalQualityOperationLeasePath(
  rawManifest: string | undefined,
  options: HistoricalQualityOperationLeaseOptions = {},
): string {
  const identifier = leaseIdentifier(rawManifest);
  return path.join(options.rootDirectory ?? HISTORICAL_QUALITY_OPERATION_LEASE_ROOT, `${identifier}.lease`);
}

function isAlreadyExists(error: unknown): boolean {
  return error !== null && typeof error === 'object' && Reflect.get(error, 'code') === 'EEXIST';
}

function exactLeaseOwner(raw: string, ownerToken: string): boolean {
  try {
    const record = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return keys.join(',') === 'identifier,ownerToken,pid,version'
      && record.version === 1
      && typeof record.identifier === 'string'
      && /^[a-f0-9]{64}$/.test(record.identifier)
      && record.ownerToken === ownerToken
      && typeof record.pid === 'number'
      && Number.isSafeInteger(record.pid)
      && record.pid > 0;
  } catch {
    return false;
  }
}

/**
 * Removes a lease only when its complete mode-0600 record still contains the
 * caller's random ownership token. Missing, malformed, or foreign records stay
 * fail-closed.
 */
export async function releaseHistoricalQualityOperationLease(
  input: HistoricalQualityOperationLeaseReleaseInput,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(input.path, 'utf8');
  } catch (error) {
    if (error !== null && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return false;
    throw error;
  }
  if (!exactLeaseOwner(raw, input.ownerToken)) return false;
  try {
    await unlink(input.path);
    return true;
  } catch (error) {
    if (error !== null && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Acquires the single-host historical-quality lease with an atomic exclusive
 * create. Existing and crash-left files are never expired or removed.
 */
export async function acquireHistoricalQualityOperationLease(
  rawManifest: string | undefined,
  options: HistoricalQualityOperationLeaseOptions = {},
): Promise<HistoricalQualityOperationLease> {
  const identifier = leaseIdentifier(rawManifest);
  const rootDirectory = options.rootDirectory ?? HISTORICAL_QUALITY_OPERATION_LEASE_ROOT;
  const leasePath = path.join(rootDirectory, `${identifier}.lease`);
  const ownerToken = randomBytes(32).toString('hex');
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
  await chmod(rootDirectory, 0o700);

  let handle;
  try {
    handle = await open(leasePath, 'wx', 0o600);
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error(`Historical quality operation lease is already held (${identifier})`, { cause: error });
    }
    throw error;
  }

  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify({ version: 1, identifier, ownerToken, pid: process.pid })}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  return Object.freeze({
    identifier,
    path: leasePath,
    ownerToken,
    release: () => releaseHistoricalQualityOperationLease({ path: leasePath, ownerToken }),
  });
}
