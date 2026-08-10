#!/usr/bin/env bun
import { chmod, open, readFile, stat, unlink } from 'node:fs/promises';

import { attestHistoricalQualityTargets, parseHistoricalQualityManifest, parseLegacyAbManifest, type DiscoveryManifestV2 } from './discovery.neon';
import { createNeonControlPlane, isEndpointHost, type NeonEndpoint, type NeonReadReplicaControlPlane } from './discovery-env-matrix.neon';

export const READ_REPLICA_CONFIRMATION = 'provision IND-638 base read replica';
const BASE_NAME = 'eval-discovery-base';
const DATABASE_NAME = 'protocol_eval';
const SECURE_MODE = 0o600;

export type QualityReadReplicaControlPlane = NeonReadReplicaControlPlane;

export interface QualityReadReplicaSecureRecord {
  version: 1;
  projectId: string;
  baseBranchId: string;
  endpointId: string;
  endpointHost: string;
  endpointType: 'read_only';
  databaseName: 'protocol_eval';
  proposedManifest?: DiscoveryManifestV2;
}

export interface QualityReadReplicaSecureRecordStore {
  write(path: string, record: QualityReadReplicaSecureRecord, mode: number): Promise<void>;
  read(path: string): Promise<{ value: unknown; mode: number }>;
}

const productionRecordStore: QualityReadReplicaSecureRecordStore = {
  write: async (path, record, mode) => {
    let created = false;
    try {
      const handle = await open(path, 'wx', mode);
      created = true;
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await chmod(path, mode);
    } catch (error) {
      if (created) await unlink(path).catch(() => undefined);
      throw error;
    }
  },
  read: async (path) => {
    const [raw, metadata] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('Historical quality read-replica secure record must be valid JSON');
    }
    return { value, mode: metadata.mode & 0o777 };
  },
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value;
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unrecognized fields`);
  }
}

function parseSecureRecord(value: unknown): QualityReadReplicaSecureRecord {
  const record = asRecord(value, 'Historical quality read-replica secure record');
  const hasManifest = Object.prototype.hasOwnProperty.call(record, 'proposedManifest');
  assertExactKeys(record, [
    'version', 'projectId', 'baseBranchId', 'endpointId', 'endpointHost',
    'endpointType', 'databaseName', ...(hasManifest ? ['proposedManifest'] : []),
  ], 'Historical quality read-replica secure record');
  if (record.version !== 1 || record.endpointType !== 'read_only' || record.databaseName !== DATABASE_NAME) {
    throw new Error('Historical quality read-replica secure record has an invalid fixed contract');
  }
  const proposedManifest = hasManifest
    ? parseHistoricalQualityManifest(JSON.stringify(record.proposedManifest))
    : undefined;
  return {
    version: 1,
    projectId: asString(record.projectId, 'secure record projectId'),
    baseBranchId: asString(record.baseBranchId, 'secure record baseBranchId'),
    endpointId: asString(record.endpointId, 'secure record endpointId'),
    endpointHost: asString(record.endpointHost, 'secure record endpointHost'),
    endpointType: 'read_only',
    databaseName: DATABASE_NAME,
    ...(proposedManifest ? { proposedManifest } : {}),
  };
}

interface ProvisionArgs {
  secureRecord: string;
}

function parseProvisionArgs(args: readonly string[]): ProvisionArgs {
  const expected = new Map<string, string>([
    ['--base-branch-name', BASE_NAME],
    ['--endpoint-type', 'read_only'],
    ['--database-name', DATABASE_NAME],
  ]);
  let secureRecord: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !value || !flag.startsWith('--') || seen.has(flag)) throw new Error('Invalid read-replica provision arguments');
    seen.add(flag);
    if (flag === '--secure-record') secureRecord = asString(value, '--secure-record');
    else if (expected.get(flag) !== value) throw new Error('Read-replica provision arguments do not match the fixed contract');
  }
  if (args.length !== 8 || seen.size !== 4 || !secureRecord || [...expected.keys()].some((flag) => !seen.has(flag))) {
    throw new Error('Read-replica provision requires the exact base, endpoint type, database, and secure record arguments');
  }
  return { secureRecord };
}

function parseAttestArgs(args: readonly string[]): { secureRecord: string } {
  if (args.length !== 2 || args[0] !== '--secure-record') {
    throw new Error('Read-replica attest requires exactly --secure-record <path>');
  }
  return { secureRecord: asString(args[1], '--secure-record') };
}

function safeSummary(record: QualityReadReplicaSecureRecord): string {
  return JSON.stringify({
    projectId: record.projectId,
    branchId: record.baseBranchId,
    endpointId: record.endpointId,
    type: record.endpointType,
    databaseName: record.databaseName,
  });
}

function assertEndpointHost(host: string): void {
  if (!host.endsWith('.neon.tech') || host.includes('/') || host.includes('@')) {
    throw new Error('Historical quality read-replica endpoint host is invalid');
  }
}

function assertReadReplicaEndpoint(endpoint: NeonEndpoint, input: {
  projectId: string;
  baseBranchId: string;
  endpointId?: string;
  endpointHost?: string;
}): void {
  if ((input.endpointId !== undefined && endpoint.id !== input.endpointId)
    || endpoint.branchId !== input.baseBranchId
    || endpoint.type !== 'read_only'
    || (input.endpointHost !== undefined && endpoint.host !== input.endpointHost)) {
    throw new Error('Historical quality read-replica endpoint identity is invalid');
  }
  assertEndpointHost(endpoint.host);
}

async function attestRecordEndpoint(input: {
  record: QualityReadReplicaSecureRecord;
  controlPlane: QualityReadReplicaControlPlane;
}): Promise<void> {
  const { record, controlPlane } = input;
  const branch = await controlPlane.getBranch(record.projectId, record.baseBranchId);
  if (branch.id !== record.baseBranchId || branch.name !== BASE_NAME || branch.primary) {
    throw new Error('Historical quality read-replica base identity is invalid');
  }
  const endpoints = await controlPlane.listEndpoints(record.projectId, record.baseBranchId);
  const endpoint = endpoints.find((candidate) => candidate.id === record.endpointId);
  if (!endpoint) throw new Error('Historical quality read-replica endpoint identity is invalid');
  assertReadReplicaEndpoint(endpoint, record);
}

/** Exact, separately confirmed, control-plane-only read-replica provisioning. */
export async function runQualityReadReplicaProvision(input: {
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  controlPlane?: QualityReadReplicaControlPlane;
  recordStore?: QualityReadReplicaSecureRecordStore;
  log?: (line: string) => void;
}): Promise<QualityReadReplicaSecureRecord> {
  const env = input.env ?? process.env;
  if (env.DISCOVERY_QUALITY_READ_REPLICA_CONFIRM !== READ_REPLICA_CONFIRMATION) {
    throw new Error(`Set DISCOVERY_QUALITY_READ_REPLICA_CONFIRM exactly to "${READ_REPLICA_CONFIRMATION}"`);
  }
  const args = parseProvisionArgs(input.args);
  const legacy = parseLegacyAbManifest(env.DISCOVERY_TARGETS);
  const controlPlane = input.controlPlane ?? createNeonControlPlane(env.NEON_API_KEY ?? '');

  try {
    const base = await controlPlane.getBranch(legacy.projectId, legacy.baseBranchId);
    if (base.id !== legacy.baseBranchId || base.name !== BASE_NAME || base.primary) {
      throw new Error('Historical quality read-replica base identity is invalid');
    }
    const before = await controlPlane.listEndpoints(legacy.projectId, legacy.baseBranchId);
    if (before.some((endpoint) => endpoint.branchId !== legacy.baseBranchId)) {
      throw new Error('Historical quality base endpoint ownership is invalid');
    }
    if (before.some((endpoint) => endpoint.type === 'read_only')) {
      throw new Error('Historical quality base already has a read replica');
    }

    let created: NeonEndpoint;
    try {
      created = await controlPlane.createReadOnlyEndpoint(legacy.projectId, legacy.baseBranchId);
    } catch {
      throw new Error('Historical quality read-replica endpoint creation failed');
    }
    if (legacy.targets.some((target) => target.endpointId === created.id)) {
      throw new Error('Historical quality read-replica endpoint crosses a child endpoint role');
    }
    assertReadReplicaEndpoint(created, { projectId: legacy.projectId, baseBranchId: legacy.baseBranchId });

    const after = await controlPlane.listEndpoints(legacy.projectId, legacy.baseBranchId);
    const reattested = after.find((endpoint) => endpoint.id === created.id);
    if (!reattested) throw new Error('Historical quality read-replica endpoint was not returned by re-attestation');
    assertReadReplicaEndpoint(reattested, {
      projectId: legacy.projectId,
      baseBranchId: legacy.baseBranchId,
      endpointId: created.id,
      endpointHost: created.host,
    });
    if (after.filter((endpoint) => endpoint.type === 'read_only').length !== 1) {
      throw new Error('Historical quality base read-replica cardinality is invalid');
    }

    const record: QualityReadReplicaSecureRecord = {
      version: 1,
      projectId: legacy.projectId,
      baseBranchId: legacy.baseBranchId,
      endpointId: created.id,
      endpointHost: created.host,
      endpointType: 'read_only',
      databaseName: DATABASE_NAME,
    };
    await (input.recordStore ?? productionRecordStore).write(args.secureRecord, record, SECURE_MODE);
    (input.log ?? console.log)(safeSummary(record));
    return record;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Historical quality')) throw error;
    throw new Error('Historical quality read-replica provisioning failed', { cause: error });
  }
}

/** Create-free attestation of the secure endpoint record and optional proposed v2 manifest. */
export async function runQualityReadReplicaAttestation(input: {
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  controlPlane?: QualityReadReplicaControlPlane;
  recordStore?: QualityReadReplicaSecureRecordStore;
  log?: (line: string) => void;
}): Promise<QualityReadReplicaSecureRecord> {
  const env = input.env ?? process.env;
  const args = parseAttestArgs(input.args);
  const stored = await (input.recordStore ?? productionRecordStore).read(args.secureRecord);
  if (stored.mode !== SECURE_MODE) throw new Error('Historical quality read-replica secure record mode must be exactly 0600');
  const record = parseSecureRecord(stored.value);
  const controlPlane = input.controlPlane ?? createNeonControlPlane(env.NEON_API_KEY ?? '');
  try {
    await attestRecordEndpoint({ record, controlPlane });
    if (record.proposedManifest) {
      const manifest = record.proposedManifest;
      if (manifest.projectId !== record.projectId || manifest.baseBranchId !== record.baseBranchId
        || manifest.baseReadReplica.endpointId !== record.endpointId) {
        throw new Error('Historical quality proposed manifest crosses secure-record roles');
      }
      const url = new URL(manifest.baseReadReplica.databaseUrl);
      if (!isEndpointHost(url.hostname, record.endpointHost)) {
        throw new Error('Historical quality proposed manifest crosses secure-record host roles');
      }
      await attestHistoricalQualityTargets({ manifest, controlPlane });
    }
  } catch {
    throw new Error('Historical quality read-replica attestation failed');
  }
  (input.log ?? console.log)(safeSummary(record));
  return record;
}

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === '--provision') await runQualityReadReplicaProvision({ args });
  else if (mode === '--attest') await runQualityReadReplicaAttestation({ args });
  else throw new Error('Historical quality read-replica command mode is required');
}

if (import.meta.main) main().catch(() => {
  console.error('Historical quality read-replica command failed');
  process.exitCode = 1;
});
