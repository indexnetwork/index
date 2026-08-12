#!/usr/bin/env bun
import { isEndpointHost, createNeonControlPlane, type NeonControlPlane } from './discovery-env-matrix.neon';
import { attestWritableQualityBaseTarget, parseQualityBaseRefreshTarget } from './discovery-quality-refresh-target';
import { attestHistoricalQualityTargets, parseHistoricalQualityManifest, type DiscoveryManifestV2 } from './discovery.neon';

const BASE_BRANCH_NAME = 'eval-discovery-base';
const DATABASE_NAME = 'protocol_eval';

export interface DisposableQualityTestTargetProof {
  projectId: string;
  branchId: string;
  endpointId: string;
  databaseName: 'protocol_eval';
  primary: false;
  parentBranchId: string;
}

export interface HistoricalQualityIntegrationTargetsProof {
  projectId: string;
  baseBranchId: string;
  basePrimary: false;
  baseReadReplicaEndpointId: string;
  baseReadReplicaEndpointType: 'read_only';
  refreshEndpointId: string;
  refreshEndpointType: 'read_write';
  childBranchId: string;
  childEndpointId: string;
  childEndpointType: 'read_write';
  databaseName: 'protocol_eval';
}

function parseBoundDatabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Disposable historical quality test target URL is invalid');
  }
  if ((url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
    || url.pathname !== `/${DATABASE_NAME}` || url.search !== '' || url.hash !== ''
    || (url.port !== '' && url.port !== '5432') || !url.hostname.endsWith('.neon.tech')
    || url.username === '' || url.password === '') {
    throw new Error('Disposable historical quality test target URL is outside the strict protocol_eval boundary');
  }
  return url;
}

/**
 * Re-parses and attests the exact selected writable child before a DB-backed
 * quality test may connect. The returned proof contains identifiers only.
 */
export async function proveDisposableQualityTestTarget(input: {
  manifest: DiscoveryManifestV2;
  selectedSide: 'a';
  databaseUrl: string;
  controlPlane: NeonControlPlane;
}): Promise<DisposableQualityTestTargetProof> {
  try {
    if (input.selectedSide !== 'a') throw new Error('selected side');
    const manifest = parseHistoricalQualityManifest(JSON.stringify(input.manifest));
    const target = manifest.targets.find((candidate) => candidate.sideId === input.selectedSide);
    if (!target || input.databaseUrl !== target.databaseUrl) throw new Error('selected URL binding');
    const url = parseBoundDatabaseUrl(input.databaseUrl);

    const base = await input.controlPlane.getBranch(manifest.projectId, manifest.baseBranchId);
    if (base.id !== manifest.baseBranchId || base.name !== BASE_BRANCH_NAME || base.primary) throw new Error('base identity');

    const branch = await input.controlPlane.getBranch(manifest.projectId, target.branchId);
    if (branch.id !== target.branchId || branch.name !== 'eval-ab-a' || branch.primary
      || branch.parentId !== base.id) throw new Error('selected child identity');

    const endpoints = await input.controlPlane.listEndpoints(manifest.projectId, branch.id);
    const endpoint = endpoints.find((candidate) => candidate.id === target.endpointId);
    if (!endpoint || endpoint.branchId !== branch.id || endpoint.type !== 'read_write'
      || !isEndpointHost(url.hostname, endpoint.host)) throw new Error('selected endpoint identity');

    return {
      projectId: manifest.projectId,
      branchId: branch.id,
      endpointId: endpoint.id,
      databaseName: DATABASE_NAME,
      primary: false,
      parentBranchId: base.id,
    };
  } catch {
    throw new Error('Disposable historical quality test target proof failed');
  }
}

/**
 * Proves the complete guarded integration topology before any SQL client may
 * be constructed. It combines exact child binding with strict manifest-v2,
 * protected-base, read-only replica, and separately attested refresh binding.
 * Only control-plane identifiers escape this boundary.
 */
export async function proveHistoricalQualityIntegrationTargets(input: {
  manifestRaw: string | undefined;
  refreshTargetRaw: string | undefined;
  selectedSide: 'a';
  databaseUrl: string;
  controlPlane: NeonControlPlane;
}): Promise<HistoricalQualityIntegrationTargetsProof> {
  try {
    const manifest = parseHistoricalQualityManifest(input.manifestRaw);
    parseBoundDatabaseUrl(manifest.baseReadReplica.databaseUrl);
    const child = await proveDisposableQualityTestTarget({
      manifest,
      selectedSide: input.selectedSide,
      databaseUrl: input.databaseUrl,
      controlPlane: input.controlPlane,
    });
    const refresh = await attestWritableQualityBaseTarget({
      target: parseQualityBaseRefreshTarget(input.refreshTargetRaw),
      controlPlane: input.controlPlane,
    });
    await attestHistoricalQualityTargets({
      manifest,
      writableRefreshTarget: refresh,
      controlPlane: input.controlPlane,
    });
    return {
      projectId: manifest.projectId,
      baseBranchId: manifest.baseBranchId,
      basePrimary: false,
      baseReadReplicaEndpointId: manifest.baseReadReplica.endpointId,
      baseReadReplicaEndpointType: 'read_only',
      refreshEndpointId: refresh.endpointId,
      refreshEndpointType: 'read_write',
      childBranchId: child.branchId,
      childEndpointId: child.endpointId,
      childEndpointType: 'read_write',
      databaseName: DATABASE_NAME,
    };
  } catch {
    throw new Error('Historical quality integration target proof failed');
  }
}

function parseArgs(args: readonly string[]): 'a' {
  if (args.length !== 2 || args[0] !== '--side' || args[1] !== 'a') {
    throw new Error('Usage: discovery-quality-db-target-prove --side a');
  }
  return 'a';
}

export async function main(args: readonly string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.TEST_DATABASE_SAFE !== '1') throw new Error('TEST_DATABASE_SAFE=1 is required');
  if (!env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required');
  if (!env.NEON_API_KEY?.trim()) throw new Error('NEON_API_KEY is required');
  const selectedSide = parseArgs(args);
  const manifest = parseHistoricalQualityManifest(env.DISCOVERY_TARGETS);
  const proof = await proveDisposableQualityTestTarget({
    manifest,
    selectedSide,
    databaseUrl: env.DATABASE_URL,
    controlPlane: createNeonControlPlane(env.NEON_API_KEY),
  });
  console.log(JSON.stringify({
    ...proof,
    endpointType: 'read_write',
    parentBranchName: BASE_BRANCH_NAME,
  }));
}

if (import.meta.main) main().catch(() => {
  console.error('Disposable historical quality test target proof failed');
  process.exitCode = 1;
});
