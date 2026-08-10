#!/usr/bin/env bun
import { randomUUID } from 'node:crypto';
import { chmod, open, readFile, rename, stat, unlink } from 'node:fs/promises';

import { attestHistoricalQualityTargets, parseHistoricalQualityManifest, parseLegacyAbManifest, type DiscoveryManifestV2 } from './discovery.neon';
import { createNeonControlPlane, isEndpointHost, type NeonEndpoint, type NeonEndpointType, type NeonReadReplicaControlPlane } from './discovery-env-matrix.neon';
import { attestWritableQualityBaseTarget, parseQualityBaseRefreshTarget } from './discovery-quality-refresh-target';

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
  endpointType: NeonEndpointType;
  databaseName: 'protocol_eval';
  status: 'attested' | 'recovery_required';
  proposedManifest?: DiscoveryManifestV2;
}

export interface QualityReadReplicaCreateUncertainRecord {
  version: 1;
  projectId: string;
  baseBranchId: string;
  endpointType: 'read_only';
  databaseName: 'protocol_eval';
  status: 'create_uncertain';
}

type StoredQualityReadReplicaRecord = QualityReadReplicaSecureRecord | QualityReadReplicaCreateUncertainRecord;

export interface QualityReadReplicaSecureRecordReservation {
  writeCreateUncertain(record: QualityReadReplicaCreateUncertainRecord): Promise<void>;
  writeRecovery(record: QualityReadReplicaSecureRecord): Promise<void>;
  commit(record: QualityReadReplicaSecureRecord): Promise<void>;
  abandon(): Promise<void>;
}

export interface QualityReadReplicaSecureRecordStore {
  reserve(path: string, mode: number): Promise<QualityReadReplicaSecureRecordReservation>;
  read(path: string): Promise<{ value: unknown; mode: number }>;
}

async function replaceFileContents(handle: Awaited<ReturnType<typeof open>>, contents: string): Promise<void> {
  const bytes = Buffer.from(contents, 'utf8');
  await handle.truncate(0);
  await handle.write(bytes, 0, bytes.length, 0);
  await handle.sync();
}

async function writeRecord(handle: Awaited<ReturnType<typeof open>>, record: StoredQualityReadReplicaRecord): Promise<void> {
  await replaceFileContents(handle, `${JSON.stringify(record, null, 2)}\n`);
}

const productionRecordStore: QualityReadReplicaSecureRecordStore = {
  reserve: async (path, mode) => {
    const handle = await open(path, 'wx', mode);
    try {
      await replaceFileContents(handle, `${JSON.stringify({ status: 'reserved' })}\n`);
      await chmod(path, mode);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
      throw error;
    }
    let closed = false;
    const close = async (): Promise<void> => {
      if (!closed) {
        closed = true;
        await handle.close();
      }
    };
    return {
      writeCreateUncertain: async (record) => {
        await writeRecord(handle, record);
        await chmod(path, mode);
      },
      writeRecovery: async (record) => {
        await writeRecord(handle, record);
        await chmod(path, mode);
      },
      commit: async (record) => {
        const temporaryPath = `${path}.complete-${randomUUID()}`;
        try {
          const temporary = await open(temporaryPath, 'wx', mode);
          try {
            await writeRecord(temporary, record);
          } finally {
            await temporary.close();
          }
          await chmod(temporaryPath, mode);
          await rename(temporaryPath, path);
          await close();
        } catch (error) {
          await unlink(temporaryPath).catch(() => undefined);
          await close().catch(() => undefined);
          throw error;
        }
      },
      abandon: async () => {
        await close();
        await unlink(path).catch(() => undefined);
      },
    };
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

function parseSecureRecord(value: unknown): StoredQualityReadReplicaRecord {
  const record = asRecord(value, 'Historical quality read-replica secure record');
  if (record.status === 'create_uncertain') {
    assertExactKeys(record, [
      'version', 'projectId', 'baseBranchId', 'endpointType', 'databaseName', 'status',
    ], 'Historical quality read-replica uncertain record');
    if (record.version !== 1 || record.endpointType !== 'read_only' || record.databaseName !== DATABASE_NAME) {
      throw new Error('Historical quality read-replica uncertain record has an invalid fixed contract');
    }
    return {
      version: 1,
      projectId: asString(record.projectId, 'uncertain record projectId'),
      baseBranchId: asString(record.baseBranchId, 'uncertain record baseBranchId'),
      endpointType: 'read_only',
      databaseName: DATABASE_NAME,
      status: 'create_uncertain',
    };
  }
  const hasManifest = Object.prototype.hasOwnProperty.call(record, 'proposedManifest');
  assertExactKeys(record, [
    'version', 'projectId', 'baseBranchId', 'endpointId', 'endpointHost',
    'endpointType', 'databaseName', 'status', ...(hasManifest ? ['proposedManifest'] : []),
  ], 'Historical quality read-replica secure record');
  if (record.version !== 1 || (record.endpointType !== 'read_only' && record.endpointType !== 'read_write')
    || record.databaseName !== DATABASE_NAME || (record.status !== 'attested' && record.status !== 'recovery_required')) {
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
    endpointType: record.endpointType,
    databaseName: DATABASE_NAME,
    status: record.status,
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

function assertLegacyRefreshBinding(input: {
  legacy: ReturnType<typeof parseLegacyAbManifest>;
  refresh: Awaited<ReturnType<typeof attestWritableQualityBaseTarget>>;
  replicaEndpointId?: string;
}): void {
  const { legacy, refresh } = input;
  if (refresh.projectId !== legacy.projectId || refresh.branchId !== legacy.baseBranchId
    || refresh.endpointType !== 'read_write' || refresh.databaseName !== DATABASE_NAME) {
    throw new Error('Historical quality writable refresh target does not bind to the discovery base');
  }
  const roleIds = [
    legacy.projectId,
    legacy.baseBranchId,
    refresh.endpointId,
    ...(input.replicaEndpointId ? [input.replicaEndpointId] : []),
    ...legacy.targets.flatMap((target) => [target.branchId, target.endpointId]),
  ];
  if (new Set(roleIds).size !== roleIds.length) {
    throw new Error('Historical quality read-replica roles must be pairwise distinct');
  }
}

function recoveryRecord(input: {
  legacy: ReturnType<typeof parseLegacyAbManifest>;
  endpoint: NeonEndpoint;
}): QualityReadReplicaSecureRecord {
  return {
    version: 1,
    projectId: input.legacy.projectId,
    baseBranchId: input.legacy.baseBranchId,
    endpointId: input.endpoint.id,
    endpointHost: input.endpoint.host,
    endpointType: input.endpoint.type,
    databaseName: DATABASE_NAME,
    status: 'recovery_required',
  };
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
  let reservation: QualityReadReplicaSecureRecordReservation | undefined;
  let createInvocationBegan = false;
  try {
    const args = parseProvisionArgs(input.args);
    const legacy = parseLegacyAbManifest(env.DISCOVERY_TARGETS);
    const refreshTarget = parseQualityBaseRefreshTarget(env.DISCOVERY_QUALITY_BASE_REFRESH_TARGET);
    const controlPlane = input.controlPlane ?? createNeonControlPlane(env.NEON_API_KEY ?? '');
    const refresh = await attestWritableQualityBaseTarget({ target: refreshTarget, controlPlane });
    assertLegacyRefreshBinding({ legacy, refresh });

    reservation = await (input.recordStore ?? productionRecordStore).reserve(args.secureRecord, SECURE_MODE);
    const before = await controlPlane.listEndpoints(legacy.projectId, legacy.baseBranchId);
    const exactRefresh = before.find((endpoint) => endpoint.id === refresh.endpointId);
    const refreshUrl = new URL(refresh.databaseUrl);
    if (!exactRefresh || exactRefresh.branchId !== legacy.baseBranchId || exactRefresh.type !== 'read_write'
      || !isEndpointHost(refreshUrl.hostname, exactRefresh.host)) throw new Error('refresh changed before create');
    if (before.some((endpoint) => endpoint.branchId !== legacy.baseBranchId)) throw new Error('base endpoint ownership');
    if (before.some((endpoint) => endpoint.type === 'read_only')) throw new Error('read replica already exists');

    await reservation.writeCreateUncertain({
      version: 1,
      projectId: legacy.projectId,
      baseBranchId: legacy.baseBranchId,
      endpointType: 'read_only',
      databaseName: DATABASE_NAME,
      status: 'create_uncertain',
    });
    createInvocationBegan = true;
    const created = await controlPlane.createReadOnlyEndpoint(legacy.projectId, legacy.baseBranchId);
    await reservation.writeRecovery(recoveryRecord({ legacy, endpoint: created }));
    assertLegacyRefreshBinding({ legacy, refresh, replicaEndpointId: created.id });
    assertReadReplicaEndpoint(created, { projectId: legacy.projectId, baseBranchId: legacy.baseBranchId });

    const after = await controlPlane.listEndpoints(legacy.projectId, legacy.baseBranchId);
    const reattested = after.find((endpoint) => endpoint.id === created!.id);
    if (!reattested) throw new Error('created endpoint missing from re-attestation');
    assertReadReplicaEndpoint(reattested, {
      projectId: legacy.projectId,
      baseBranchId: legacy.baseBranchId,
      endpointId: created.id,
      endpointHost: created.host,
    });
    if (after.filter((endpoint) => endpoint.type === 'read_only').length !== 1) throw new Error('read-replica cardinality');
    const refreshAfter = after.find((endpoint) => endpoint.id === refresh.endpointId);
    if (!refreshAfter || refreshAfter.branchId !== legacy.baseBranchId || refreshAfter.type !== 'read_write'
      || !isEndpointHost(refreshUrl.hostname, refreshAfter.host)) throw new Error('refresh changed after create');

    const record: QualityReadReplicaSecureRecord = {
      ...recoveryRecord({ legacy, endpoint: created }),
      endpointType: 'read_only',
      status: 'attested',
    };
    await reservation.commit(record);
    (input.log ?? console.log)(safeSummary(record));
    return record;
  } catch {
    if (reservation && !createInvocationBegan) await reservation.abandon().catch(() => undefined);
    throw new Error('Historical quality read-replica provisioning failed');
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
  const record = await (async (): Promise<StoredQualityReadReplicaRecord> => {
    try {
      const args = parseAttestArgs(input.args);
      const stored = await (input.recordStore ?? productionRecordStore).read(args.secureRecord);
      if (stored.mode !== SECURE_MODE) throw new Error('record mode');
      return parseSecureRecord(stored.value);
    } catch {
      throw new Error('Historical quality read-replica attestation failed');
    }
  })();
  if (record.status === 'create_uncertain') {
    throw new Error('Historical quality read-replica creation is uncertain and requires explicit operator resolution');
  }
  try {
    if (record.status !== 'attested' || record.endpointType !== 'read_only') throw new Error('record status');
    const legacy = parseLegacyAbManifest(env.DISCOVERY_TARGETS);
    const refreshTarget = parseQualityBaseRefreshTarget(env.DISCOVERY_QUALITY_BASE_REFRESH_TARGET);
    const controlPlane = input.controlPlane ?? createNeonControlPlane(env.NEON_API_KEY ?? '');
    const refresh = await attestWritableQualityBaseTarget({ target: refreshTarget, controlPlane });
    assertLegacyRefreshBinding({ legacy, refresh, replicaEndpointId: record.endpointId });
    if (record.projectId !== legacy.projectId || record.baseBranchId !== legacy.baseBranchId) throw new Error('record binding');

    if (record.proposedManifest) {
      const manifest = record.proposedManifest;
      if (manifest.projectId !== record.projectId || manifest.baseBranchId !== record.baseBranchId
        || manifest.baseReadReplica.endpointId !== record.endpointId) throw new Error('manifest binding');
      const url = new URL(manifest.baseReadReplica.databaseUrl);
      if (!isEndpointHost(url.hostname, record.endpointHost)) throw new Error('manifest host');
      await attestHistoricalQualityTargets({ manifest, writableRefreshTarget: refresh, controlPlane });
    } else {
      await attestRecordEndpoint({ record, controlPlane });
    }
    (input.log ?? console.log)(safeSummary(record));
    return record;
  } catch {
    throw new Error('Historical quality read-replica attestation failed');
  }
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
