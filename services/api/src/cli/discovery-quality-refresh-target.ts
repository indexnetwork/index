#!/usr/bin/env bun
import { z } from 'zod';

import { createNeonControlPlane, isEndpointHost, type NeonControlPlane } from './discovery-env-matrix.neon';
import type { AttestedWritableQualityBaseTarget, QualityBaseRefreshTargetV2 } from './discovery.neon';

export type { AttestedWritableQualityBaseTarget, QualityBaseRefreshTargetV2 } from './discovery.neon';

const nonBlank = z.string().trim().min(1);
const targetSchema = z.object({
  version: z.literal(2),
  projectId: nonBlank,
  branchId: nonBlank,
  endpointId: nonBlank,
  databaseName: z.literal('protocol_eval'),
  databaseUrl: nonBlank,
}).strict();

function assertTargetUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DISCOVERY_QUALITY_BASE_REFRESH_TARGET databaseUrl must be a valid URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('Historical quality refresh target must use postgres');
  if (url.pathname !== '/protocol_eval') throw new Error('Historical quality refresh target path must be exactly /protocol_eval');
  if (url.port && url.port !== '5432') throw new Error('Historical quality refresh target port must be exactly 5432');
  if (!url.hostname.endsWith('.neon.tech')) throw new Error('Historical quality refresh target must use a Neon host');
}

/** Strictly parses the one writable protected-base target declaration. */
export function parseQualityBaseRefreshTarget(raw: string | undefined): QualityBaseRefreshTargetV2 {
  if (!raw) throw new Error('DISCOVERY_QUALITY_BASE_REFRESH_TARGET must declare a v2 target');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('DISCOVERY_QUALITY_BASE_REFRESH_TARGET must be valid JSON');
  }
  const target = targetSchema.parse(json);
  assertTargetUrl(target.databaseUrl);
  return target;
}

/** Attests the exact non-primary protected base and its read-write endpoint. */
export async function attestWritableQualityBaseTarget(input: {
  target: QualityBaseRefreshTargetV2;
  controlPlane: NeonControlPlane;
}): Promise<AttestedWritableQualityBaseTarget> {
  const { target, controlPlane } = input;
  let branch: Awaited<ReturnType<NeonControlPlane['getBranch']>>;
  let endpoints: Awaited<ReturnType<NeonControlPlane['listEndpoints']>>;
  try {
    branch = await controlPlane.getBranch(target.projectId, target.branchId);
    endpoints = await controlPlane.listEndpoints(target.projectId, target.branchId);
  } catch {
    throw new Error('Historical quality writable refresh control-plane attestation failed');
  }
  if (branch.id !== target.branchId || branch.name !== 'eval-discovery-base' || branch.primary !== false) {
    throw new Error('Historical quality writable refresh branch identity is invalid');
  }
  const endpoint = endpoints.find((candidate) => candidate.id === target.endpointId);
  const url = new URL(target.databaseUrl);
  if (!endpoint || endpoint.branchId !== target.branchId || !isEndpointHost(url.hostname, endpoint.host)) {
    throw new Error('Historical quality writable refresh endpoint identity is invalid');
  }
  if (endpoint.type !== 'read_write') throw new Error('Historical quality writable refresh endpoint must be read_write');
  return {
    ...target,
    endpointType: 'read_write',
    branchName: 'eval-discovery-base',
    primary: false,
  } as AttestedWritableQualityBaseTarget;
}

export async function runQualityBaseRefreshTargetAttestation(input: {
  env?: NodeJS.ProcessEnv;
  controlPlane?: NeonControlPlane;
  log?: (line: string) => void;
}): Promise<AttestedWritableQualityBaseTarget> {
  const env = input.env ?? process.env;
  const target = parseQualityBaseRefreshTarget(env.DISCOVERY_QUALITY_BASE_REFRESH_TARGET);
  const controlPlane = input.controlPlane ?? createNeonControlPlane(env.NEON_API_KEY ?? '');
  const attested = await attestWritableQualityBaseTarget({ target, controlPlane });
  (input.log ?? console.log)('Historical quality base writable refresh target attested.');
  return attested;
}

if (import.meta.main) runQualityBaseRefreshTargetAttestation({}).catch(() => {
  console.error('Historical quality base writable refresh target attestation failed');
  process.exitCode = 1;
});
