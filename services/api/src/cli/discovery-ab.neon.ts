/**
 * Attestation and reset for the two durable A/B branches.
 *
 * `discovery-env-matrix.neon.ts` is deliberately read-only. Reset is the one
 * write this harness needs, so it lives here, refuses any branch outside the
 * attested manifest, and never surfaces a response body: control-plane
 * responses can carry credentials, and a `DATABASE_URL` carries a password —
 * only status codes and field names are ever put into an error.
 *
 * Deliberate deviation from `attestMatrixTargets`: matrix children must carry a
 * future `expiresAt` because they are ephemeral. The A/B branches are durable by
 * design, so expiry is not required; the safety property is preserved
 * differently — the name check is *exact* rather than a prefix, and the branches
 * are reset from base before every run, so they never accumulate state worth
 * protecting. Every other check (non-primary, parent is the attested base,
 * endpoint host matches the URL) is kept unchanged.
 */
import { isEndpointHost, type NeonControlPlane } from './discovery-env-matrix.neon';

const NEON_API_ORIGIN = 'https://console.neon.tech/api/v2';
const BASE_NAME = 'eval-discovery-base';

export const AB_BRANCH_NAMES = { a: 'eval-ab-a', b: 'eval-ab-b' } as const;

export interface AbTarget { sideId: 'a' | 'b'; branchId: string; endpointId: string; databaseUrl: string }
export interface AbManifest { projectId: string; baseBranchId: string; targets: readonly [AbTarget, AbTarget] }

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Discovery A/B manifest ${field} must be a non-empty string`);
  }
  return value;
}

/** Parses a URL without letting the input (which carries a password) into the error. */
function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The same target shape the matrix bootstrap accepts: a Neon-hosted postgres URL. */
function assertNeonPostgresUrl(value: string, field: string): void {
  const url = parseUrl(value);
  if (!url || (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') || !url.hostname.endsWith('.neon.tech')) {
    throw new Error(`Discovery A/B manifest ${field} must be a postgres URL on a Neon host`);
  }
}

function parseTarget(value: unknown, index: number): AbTarget {
  const entry = asRecord(value, `Discovery A/B manifest target ${index} must be an object`);
  const sideId = entry.sideId;
  if (sideId !== 'a' && sideId !== 'b') throw new Error(`Discovery A/B manifest target ${index} sideId must be "a" or "b"`);
  const target: AbTarget = {
    sideId,
    branchId: asString(entry.branchId, `target ${index} branchId`),
    endpointId: asString(entry.endpointId, `target ${index} endpointId`),
    databaseUrl: asString(entry.databaseUrl, `target ${index} databaseUrl`),
  };
  assertNeonPostgresUrl(target.databaseUrl, `target ${index} databaseUrl`);
  return target;
}

/**
 * Decodes the operator-supplied manifest. Every field is type-checked rather
 * than cast: a JSON value of the wrong type (a number where a branch id is
 * expected) would otherwise surface as an unhelpful `TypeError` deep inside the
 * control-plane call, or worse, be sent to Neon as-is.
 *
 * The two sides are returned in canonical order (a, then b) so callers can index
 * them without re-sorting.
 */
export function parseAbManifest(raw: string | undefined): AbManifest {
  if (raw === undefined || raw.trim() === '') throw new Error('Discovery A/B manifest is required');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Discovery A/B manifest must be valid JSON');
  }
  const root = asRecord(parsed, 'Discovery A/B manifest must be an object');
  const projectId = asString(root.projectId, 'projectId');
  const baseBranchId = asString(root.baseBranchId, 'baseBranchId');
  if (!Array.isArray(root.targets) || root.targets.length !== 2) {
    throw new Error('Discovery A/B manifest must name exactly two sides');
  }
  const targets = root.targets.map(parseTarget);
  const sideA = targets.find((target) => target.sideId === 'a');
  const sideB = targets.find((target) => target.sideId === 'b');
  if (!sideA || !sideB) throw new Error('Discovery A/B manifest must name one side a and one side b');
  if (sideA.branchId === sideB.branchId || sideA.endpointId === sideB.endpointId) {
    throw new Error('Discovery A/B manifest sides must name distinct branches and endpoints');
  }
  if (sideA.branchId === baseBranchId || sideB.branchId === baseBranchId) {
    throw new Error('Discovery A/B manifest sides must not name the base branch');
  }
  return { projectId, baseBranchId, targets: [sideA, sideB] };
}

/**
 * Verifies both sides are the designated A/B branches, parented on the protected
 * base. Durability replaces the matrix's expiry check (see the module note); the
 * name check is exact rather than a prefix.
 */
export async function attestAbTargets(input: { manifest: AbManifest; controlPlane: NeonControlPlane }): Promise<AbManifest> {
  const { manifest, controlPlane } = input;
  const base = await controlPlane.getBranch(manifest.projectId, manifest.baseBranchId);
  if (base.id !== manifest.baseBranchId || base.name !== BASE_NAME || base.primary) {
    throw new Error('Neon control-plane base branch identity is invalid');
  }
  for (const target of manifest.targets) {
    const branch = await controlPlane.getBranch(manifest.projectId, target.branchId);
    if (branch.id !== target.branchId || branch.name !== AB_BRANCH_NAMES[target.sideId]
      || branch.parentId !== base.id || branch.primary) {
      throw new Error(`Neon control-plane side ${target.sideId} identity is invalid`);
    }
    // Parsed defensively: a URL failure must not put the password into the error.
    const url = parseUrl(target.databaseUrl);
    const endpoints = await controlPlane.listEndpoints(manifest.projectId, target.branchId);
    const endpoint = endpoints.find((candidate) => candidate.id === target.endpointId);
    if (!url || !endpoint || endpoint.branchId !== target.branchId || !isEndpointHost(url.hostname, endpoint.host)) {
      throw new Error(`Neon control-plane side ${target.sideId} endpoint host does not match DATABASE_URL`);
    }
  }
  return manifest;
}

/**
 * Resets one attested A/B branch to the head of the attested base. The only
 * mutating call this harness makes.
 *
 * Neon v2 has no `reset_to_parent` operation: the current spec exposes
 * `POST /projects/{project_id}/branches/{branch_id}/restore`
 * (`restoreProjectBranch`), which restores to the head of `source_branch_id`
 * when no LSN or timestamp is given.
 */
export async function resetAbBranch(input: {
  manifest: AbManifest; branchId: string; apiKey: string; fetchImpl?: typeof fetch;
}): Promise<void> {
  const { manifest, branchId, apiKey } = input;
  if (!manifest.targets.some((target) => target.branchId === branchId)) {
    throw new Error(`${branchId} is not a designated A/B branch; refusing to reset it`);
  }
  const send = input.fetchImpl ?? fetch;
  const response = await send(
    `${NEON_API_ORIGIN}/projects/${encodeURIComponent(manifest.projectId)}/branches/${encodeURIComponent(branchId)}/restore`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_branch_id: manifest.baseBranchId }),
      redirect: 'error',
    },
  );
  // The body may echo credentials; only the status is safe to report.
  if (!response.ok) throw new Error(`Neon control-plane reset failed with status ${response.status}`);
}
