import { MATRIX_CHILD_BRANCH_PREFIX } from './discovery-env-matrix.runtime';

const NEON_API_ORIGIN = 'https://console.neon.tech/api/v2';
const BASE_NAME = 'eval-discovery-base';

export type NeonBranch = { id: string; name: string; parentId: string | null; expiresAt: string | null; primary: boolean };
export type NeonEndpoint = { id: string; branchId: string; host: string };

/** Narrow, injectable control-plane port. Database/protocol dependencies must never be imported here. */
export interface NeonControlPlane {
  getBranch(projectId: string, branchId: string): Promise<NeonBranch>;
  listEndpoints(projectId: string, branchId: string): Promise<NeonEndpoint[]>;
}

export type AttestedBase = { projectId: string; branchId: string; endpointId: string; databaseName: 'protocol_eval'; databaseUrl: string };
export type AttestedChild = {
  childKey: string;
  branchId: string;
  endpointId: string;
  databaseName: 'protocol_eval';
  databaseUrl: string;
};
export type AttestedManifest = { version: 1; base: AttestedBase; children: AttestedChild[] };

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
function asString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message);
  return value;
}
function decodeBranch(value: unknown): NeonBranch {
  const record = asRecord(value, 'Neon control-plane returned an invalid branch response');
  const branch = 'branch' in record ? asRecord(record.branch, 'Neon control-plane returned an invalid branch wrapper') : record;
  const primary = branch.primary ?? branch.primary_branch;
  if (typeof primary !== 'boolean') throw new Error('Neon control-plane branch response is missing primary');
  const parent = branch.parent_id;
  const expiry = branch.expires_at;
  if (parent !== null && typeof parent !== 'string') throw new Error('Neon control-plane branch response is missing parent_id');
  if (expiry !== undefined && expiry !== null && typeof expiry !== 'string') throw new Error('Neon control-plane branch response has an invalid expires_at');
  return { id: asString(branch.id, 'Neon control-plane branch response is missing id'), name: asString(branch.name, 'Neon control-plane branch response is missing name'), parentId: parent, expiresAt: typeof expiry === 'string' ? expiry : null, primary };
}
function decodeEndpoints(value: unknown): NeonEndpoint[] {
  const record = Array.isArray(value) ? null : asRecord(value, 'Neon control-plane returned an invalid endpoint response');
  const raw = Array.isArray(value) ? value : record!.endpoints;
  if (!Array.isArray(raw)) throw new Error('Neon control-plane endpoint response is missing endpoints');
  return raw.map((value) => {
    const endpoint = asRecord(value, 'Neon control-plane returned an invalid endpoint');
    const host = endpoint.host ?? endpoint.host_name;
    return { id: asString(endpoint.id, 'Neon control-plane endpoint response is missing id'), branchId: asString(endpoint.branch_id, 'Neon control-plane endpoint response is missing branch_id'), host: asString(host, 'Neon control-plane endpoint response is missing host') };
  });
}

/** Production Neon v2 client. It follows no redirects and never includes credentials in errors. */
export function createNeonControlPlane(apiKey: string, fetchFn: typeof fetch = fetch): NeonControlPlane {
  if (!apiKey) throw new Error('NEON_API_KEY is required for Neon control-plane attestation');
  const request = async (path: string): Promise<unknown> => {
    const response = await fetchFn(`${NEON_API_ORIGIN}${path}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, redirect: 'error' });
    if (!response.ok) throw new Error(`Neon control-plane request failed with status ${response.status}`);
    return response.json();
  };
  return {
    getBranch: async (projectId, branchId) => decodeBranch(await request(`/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`)),
    listEndpoints: async (projectId, branchId) => decodeEndpoints(await request(`/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/endpoints`)),
  };
}

function assertLocalTarget(url: URL): void {
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('Discovery environment matrix target must use postgres');
  if (url.pathname !== '/protocol_eval') throw new Error('Discovery environment matrix target path must be exactly /protocol_eval');
  if (url.port && url.port !== '5432') throw new Error('Discovery environment matrix target port must be exactly 5432');
  if (!url.hostname.endsWith('.neon.tech')) throw new Error('Discovery environment matrix target must use a Neon host');
}

/**
 * Accept precisely Neon's canonical endpoint host or its one pooled counterpart.
 * Exported so `discovery-ab.neon.ts` attests hosts by the same rule rather than
 * keeping a second, looser copy of it.
 */
export function isEndpointHost(urlHost: string, endpointHost: string): boolean {
  const firstDot = endpointHost.indexOf('.');
  if (firstDot <= 0) return false;
  const pooledHost = `${endpointHost.slice(0, firstDot)}-pooler${endpointHost.slice(firstDot)}`;
  return urlHost === endpointHost || urlHost === pooledHost;
}

export function parseAttestedManifest(raw: string | undefined, expectedChildKeys: readonly string[]): AttestedManifest {
  if (!raw) throw new Error('DISCOVERY_ENV_MATRIX_CHILDREN must declare an attested manifest');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('DISCOVERY_ENV_MATRIX_CHILDREN must be valid JSON'); }
  const root = asRecord(parsed, 'DISCOVERY_ENV_MATRIX_CHILDREN must be an object');
  if (root.version !== 1) throw new Error('DISCOVERY_ENV_MATRIX_CHILDREN must use manifest version 1');
  const base = asRecord(root.base, 'DISCOVERY_ENV_MATRIX_CHILDREN must include base');
  const parsedBase: AttestedBase = { projectId: asString(base.projectId, 'Manifest base projectId is required'), branchId: asString(base.branchId, 'Manifest base branchId is required'), endpointId: asString(base.endpointId, 'Manifest base endpointId is required'), databaseName: asString(base.databaseName, 'Manifest base databaseName is required') as 'protocol_eval', databaseUrl: asString(base.databaseUrl, 'Manifest base databaseUrl is required') };
  if (parsedBase.databaseName !== 'protocol_eval') throw new Error('Manifest base databaseName must be protocol_eval');
  assertLocalTarget(new URL(parsedBase.databaseUrl));
  if (!Array.isArray(root.children) || root.children.length !== expectedChildKeys.length) throw new Error('Manifest must contain exactly the expected children');
  const expected = new Set(expectedChildKeys);
  const children = root.children.map((value): AttestedChild => {
    const entry = asRecord(value, 'Manifest child must be an object');
    const child: AttestedChild = { childKey: asString(entry.childKey, 'Manifest childKey is required'), branchId: asString(entry.branchId, 'Manifest child branchId is required'), endpointId: asString(entry.endpointId, 'Manifest child endpointId is required'), databaseName: asString(entry.databaseName, 'Manifest child databaseName is required') as 'protocol_eval', databaseUrl: asString(entry.databaseUrl, 'Manifest child databaseUrl is required') };
    if (!expected.has(child.childKey) || child.databaseName !== 'protocol_eval') throw new Error('Manifest child is not an expected protocol_eval target');
    try { assertLocalTarget(new URL(child.databaseUrl)); } catch (error) { throw error instanceof Error ? error : new Error('Manifest child target is invalid'); }
    return child;
  });
  if (new Set(children.map((child) => child.childKey)).size !== children.length || new Set(children.map((child) => child.branchId)).size !== children.length || new Set(children.map((child) => child.endpointId)).size !== children.length) throw new Error('Manifest children must have unique keys, branches, and endpoints');
  return { version: 1, base: parsedBase, children };
}

export async function attestMatrixTargets(input: { manifest: AttestedManifest; controlPlane: NeonControlPlane; now?: Date }): Promise<AttestedManifest> {
  const { manifest, controlPlane } = input;
  const now = input.now ?? new Date();
  const base = await controlPlane.getBranch(manifest.base.projectId, manifest.base.branchId);
  if (base.id !== manifest.base.branchId || base.name !== BASE_NAME || base.primary) throw new Error('Neon control-plane base branch identity is invalid');
  const baseUrl = new URL(manifest.base.databaseUrl);
  const baseEndpoints = await controlPlane.listEndpoints(manifest.base.projectId, manifest.base.branchId);
  const baseEndpoint = baseEndpoints.find((candidate) => candidate.id === manifest.base.endpointId);
  if (!baseEndpoint || baseEndpoint.branchId !== base.id || !isEndpointHost(baseUrl.hostname, baseEndpoint.host)) throw new Error('Neon control-plane base endpoint host does not match DATABASE_URL');
  for (const child of manifest.children) {
    const url = new URL(child.databaseUrl);
    const branch = await controlPlane.getBranch(manifest.base.projectId, child.branchId);
    if (branch.id !== child.branchId || !branch.name.startsWith(MATRIX_CHILD_BRANCH_PREFIX) || branch.parentId !== base.id || branch.primary || !branch.expiresAt || Number.isNaN(Date.parse(branch.expiresAt)) || Date.parse(branch.expiresAt) <= now.getTime()) throw new Error(`Neon control-plane child ${child.childKey} identity is invalid`);
    const endpoints = await controlPlane.listEndpoints(manifest.base.projectId, child.branchId);
    const endpoint = endpoints.find((candidate) => candidate.id === child.endpointId);
    if (!endpoint || endpoint.branchId !== child.branchId || !isEndpointHost(url.hostname, endpoint.host)) throw new Error(`Neon control-plane child ${child.childKey} endpoint host does not match DATABASE_URL`);
  }
  return manifest;
}
