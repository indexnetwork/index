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
 *
 * Because that reset *is* the compensating control, it must be provably aimed
 * and provably complete: `resetAbBranch` accepts only an `AttestedAbManifest`
 * (a brand no caller can forge, so the wrong call order does not compile) and
 * resolves only once every restore operation Neon reported has reached
 * `finished` on the control plane.
 */
import { isEndpointHost, type NeonControlPlane } from './discovery-env-matrix.neon';

const NEON_API_ORIGIN = 'https://console.neon.tech/api/v2';
const BASE_NAME = 'eval-discovery-base';
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;

export const AB_BRANCH_NAMES = { a: 'eval-ab-a', b: 'eval-ab-b' } as const;

export interface AbTarget { sideId: 'a' | 'b'; branchId: string; endpointId: string; databaseUrl: string }
export interface LegacyAbManifest { projectId: string; baseBranchId: string; targets: readonly [AbTarget, AbTarget] }
/** Backwards-compatible name retained for every existing A/B caller. */
export type AbManifest = LegacyAbManifest;
export interface DiscoveryManifestV2 {
  version: 2;
  projectId: string;
  baseBranchId: string;
  baseReadReplica: { endpointId: string; databaseUrl: string };
  targets: readonly [AbTarget, AbTarget];
}
export type DiscoveryManifest = LegacyAbManifest | DiscoveryManifestV2;

export interface QualityBaseRefreshTargetV2 {
  version: 2;
  projectId: string;
  branchId: string;
  endpointId: string;
  databaseName: 'protocol_eval';
  databaseUrl: string;
}

declare const WRITABLE_REFRESH_ATTESTED: unique symbol;
export type AttestedWritableQualityBaseTarget = QualityBaseRefreshTargetV2 & {
  endpointType: 'read_write';
  branchName: 'eval-discovery-base';
  primary: false;
  readonly [WRITABLE_REFRESH_ATTESTED]: true;
};

/**
 * Module-private brand. It is `declare`d, so it exists only in the type system
 * and only this module can produce a value carrying it: `attestAbTargets` is the
 * sole way to obtain an `AttestedAbManifest`.
 */
declare const ATTESTED: unique symbol;

/**
 * An `AbManifest` whose branch identities were checked against the control
 * plane. `resetAbBranch` takes nothing else, so a hand-built (or merely parsed)
 * manifest cannot reach the one mutating call: the mistake is a compile error
 * rather than a convention. The runtime membership check is kept as well.
 */
export type AttestedAbManifest = AbManifest & { readonly [ATTESTED]: true };

declare const QUALITY_ATTESTED: unique symbol;
export type AttestedHistoricalQualityManifest = DiscoveryManifestV2 & { readonly [QUALITY_ATTESTED]: true };

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Discovery manifest ${field} must be a non-empty string`);
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

/**
 * The same target shape the matrix bootstrap accepts, checked by the same rules
 * as `assertLocalTarget` in `discovery-env-matrix.neon.ts`: a postgres URL on a
 * Neon host, whose database is exactly `protocol_eval` and whose port, if given,
 * is exactly 5432. Neon's canonical and `-pooler` URLs both use 5432, so pinning
 * the port rejects nothing legitimate; pinning the database name is what keeps a
 * side from being pointed at some other database on a Neon host.
 */
function assertNeonPostgresUrl(value: string, field: string): void {
  const url = parseUrl(value);
  if (!url || (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') || !url.hostname.endsWith('.neon.tech')) {
    throw new Error(`Discovery manifest ${field} must be a postgres URL on a Neon host`);
  }
  if (url.pathname !== '/protocol_eval') {
    throw new Error(`Discovery manifest ${field} database must be exactly protocol_eval`);
  }
  if (url.port && url.port !== '5432') {
    throw new Error(`Discovery manifest ${field} port must be exactly 5432`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Discovery manifest ${label} must contain exactly the documented fields`);
  }
}

function parseTarget(value: unknown, index: number, strict = false): AbTarget {
  const entry = asRecord(value, `Discovery manifest target ${index} must be an object`);
  if (strict) assertExactKeys(entry, ['sideId', 'branchId', 'endpointId', 'databaseUrl'], `target ${index}`);
  const sideId = entry.sideId;
  if (sideId !== 'a' && sideId !== 'b') throw new Error(`Discovery manifest target ${index} sideId must be "a" or "b"`);
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
function parseJsonManifest(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw.trim() === '') throw new Error('Discovery manifest is required');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Discovery manifest must be valid JSON');
  }
  return asRecord(parsed, 'Discovery manifest must be an object');
}

function assertPairwiseDistinctRoleIds(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error('Discovery manifest project, branch, and endpoint role identifiers must be pairwise distinct');
  }
}

function parseTargets(root: Record<string, unknown>, baseBranchId: string, strict: boolean): readonly [AbTarget, AbTarget] {
  if (!Array.isArray(root.targets) || root.targets.length !== 2) {
    throw new Error('Discovery manifest must name exactly two sides');
  }
  const targets = root.targets.map((value, index) => parseTarget(value, index, strict));
  const sideA = targets.find((target) => target.sideId === 'a');
  const sideB = targets.find((target) => target.sideId === 'b');
  if (!sideA || !sideB) throw new Error('Discovery manifest must name one side a and one side b');
  if (sideA.branchId === sideB.branchId || sideA.endpointId === sideB.endpointId) {
    throw new Error('Discovery manifest sides must name distinct branches and endpoints');
  }
  if (sideA.branchId === baseBranchId || sideB.branchId === baseBranchId) {
    throw new Error('Discovery manifest sides must not name the base branch');
  }
  return [sideA, sideB];
}

/**
 * Parses legacy/unversioned A/B input. A strict v2 document is accepted by
 * projecting only its two durable child targets, so existing A/B execution
 * never receives the read-replica URL.
 */
export function parseLegacyAbManifest(raw: string | undefined): LegacyAbManifest {
  const root = parseJsonManifest(raw);
  if (root.version === 2) {
    const quality = parseHistoricalQualityManifest(raw);
    return { projectId: quality.projectId, baseBranchId: quality.baseBranchId, targets: quality.targets };
  }
  const projectId = asString(root.projectId, 'projectId');
  const baseBranchId = asString(root.baseBranchId, 'baseBranchId');
  return { projectId, baseBranchId, targets: parseTargets(root, baseBranchId, false) };
}

/** Backwards-compatible parser export used by legacy callers. */
export function parseAbManifest(raw: string | undefined): AbManifest {
  return parseLegacyAbManifest(raw);
}

/** Parses the exact historical-quality v2 declaration, rejecting all extras. */
export function parseHistoricalQualityManifest(raw: string | undefined): DiscoveryManifestV2 {
  const root = parseJsonManifest(raw);
  assertExactKeys(root, ['version', 'projectId', 'baseBranchId', 'baseReadReplica', 'targets'], 'v2 root');
  if (root.version !== 2) throw new Error('Historical quality discovery manifest must use version 2');
  const projectId = asString(root.projectId, 'projectId');
  const baseBranchId = asString(root.baseBranchId, 'baseBranchId');
  const replica = asRecord(root.baseReadReplica, 'Discovery manifest baseReadReplica must be an object');
  assertExactKeys(replica, ['endpointId', 'databaseUrl'], 'baseReadReplica');
  const baseReadReplica = {
    endpointId: asString(replica.endpointId, 'baseReadReplica endpointId'),
    databaseUrl: asString(replica.databaseUrl, 'baseReadReplica databaseUrl'),
  };
  assertNeonPostgresUrl(baseReadReplica.databaseUrl, 'baseReadReplica databaseUrl');
  const targets = parseTargets(root, baseBranchId, true);
  assertPairwiseDistinctRoleIds([
    projectId,
    baseBranchId,
    baseReadReplica.endpointId,
    ...targets.flatMap((target) => [target.branchId, target.endpointId]),
  ]);
  const urls = [baseReadReplica.databaseUrl, ...targets.map((target) => target.databaseUrl)];
  if (new Set(urls).size !== urls.length) {
    throw new Error('Discovery manifest endpoint URL roles must be distinct');
  }
  return { version: 2, projectId, baseBranchId, baseReadReplica, targets };
}

/**
 * Strict quality attestation: one read-only endpoint on the exact protected
 * base plus two read-write endpoints on the exact durable child branches.
 * Provider/control-plane errors are collapsed so response bodies and URL
 * credentials never enter an operator-visible error.
 */
export async function attestHistoricalQualityTargets(input: {
  manifest: DiscoveryManifestV2;
  writableRefreshTarget: AttestedWritableQualityBaseTarget;
  controlPlane: NeonControlPlane;
}): Promise<AttestedHistoricalQualityManifest> {
  try {
    const { manifest, writableRefreshTarget: refresh, controlPlane } = input;
    if (refresh.projectId !== manifest.projectId || refresh.branchId !== manifest.baseBranchId
      || refresh.databaseName !== 'protocol_eval' || refresh.endpointType !== 'read_write'
      || refresh.branchName !== BASE_NAME || refresh.primary !== false) throw new Error('refresh binding');
    assertPairwiseDistinctRoleIds([
      manifest.projectId,
      manifest.baseBranchId,
      manifest.baseReadReplica.endpointId,
      refresh.endpointId,
      ...manifest.targets.flatMap((target) => [target.branchId, target.endpointId]),
    ]);
    if ([manifest.baseReadReplica.databaseUrl, ...manifest.targets.map((target) => target.databaseUrl)].includes(refresh.databaseUrl)) {
      throw new Error('refresh URL crossing');
    }

    const base = await controlPlane.getBranch(manifest.projectId, manifest.baseBranchId);
    if (base.id !== manifest.baseBranchId || base.name !== BASE_NAME || base.primary) throw new Error('base');
    const baseUrl = parseUrl(manifest.baseReadReplica.databaseUrl);
    const refreshUrl = parseUrl(refresh.databaseUrl);
    const baseEndpoints = await controlPlane.listEndpoints(manifest.projectId, manifest.baseBranchId);
    const replica = baseEndpoints.find((candidate) => candidate.id === manifest.baseReadReplica.endpointId);
    const refreshEndpoint = baseEndpoints.find((candidate) => candidate.id === refresh.endpointId);
    if (!baseUrl || !replica || replica.branchId !== base.id || replica.type !== 'read_only'
      || !isEndpointHost(baseUrl.hostname, replica.host)) throw new Error('replica');
    if (!refreshUrl || !refreshEndpoint || refreshEndpoint.branchId !== base.id || refreshEndpoint.type !== 'read_write'
      || !isEndpointHost(refreshUrl.hostname, refreshEndpoint.host) || refreshEndpoint.host === replica.host) throw new Error('refresh');
    const childEndpointIds = new Set(manifest.targets.map((target) => target.endpointId));
    if (baseEndpoints.some((endpoint) => childEndpointIds.has(endpoint.id))) throw new Error('base/child endpoint crossing');
    const endpointHosts = new Set([replica.host, refreshEndpoint.host]);

    for (const target of manifest.targets) {
      if (target.branchId === base.id || target.endpointId === replica.id || target.endpointId === refreshEndpoint.id) throw new Error('crossed role');
      const branch = await controlPlane.getBranch(manifest.projectId, target.branchId);
      if (branch.id !== target.branchId || branch.name !== AB_BRANCH_NAMES[target.sideId]
        || branch.parentId !== base.id || branch.primary) throw new Error('child branch');
      const url = parseUrl(target.databaseUrl);
      const endpoints = await controlPlane.listEndpoints(manifest.projectId, target.branchId);
      const endpoint = endpoints.find((candidate) => candidate.id === target.endpointId);
      if (!url || !endpoint || endpoint.branchId !== branch.id || endpoint.type !== 'read_write'
        || !isEndpointHost(url.hostname, endpoint.host) || endpointHosts.has(endpoint.host)) throw new Error('child endpoint');
      endpointHosts.add(endpoint.host);
    }
    return manifest as AttestedHistoricalQualityManifest;
  } catch {
    throw new Error('Historical quality discovery targets failed control-plane attestation');
  }
}

/**
 * Verifies both sides are the designated A/B branches, parented on the protected
 * base. Durability replaces the matrix's expiry check (see the module note); the
 * name check is exact rather than a prefix.
 */
export async function attestAbTargets(input: { manifest: AbManifest; controlPlane: NeonControlPlane }): Promise<AttestedAbManifest> {
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
  // The only place the brand is applied: every identity above was checked.
  return manifest as AttestedAbManifest;
}

/** Neon's `OperationStatus` enum. Anything else is treated as unrecognized. */
const OPERATION_STATUSES = ['scheduling', 'running', 'finished', 'failed', 'error', 'cancelling', 'cancelled', 'skipped'] as const;
type OperationStatus = (typeof OPERATION_STATUSES)[number];
/** States that may still become terminal; every other state is terminal. */
const PENDING_STATUSES: ReadonlySet<OperationStatus> = new Set<OperationStatus>(['scheduling', 'running', 'cancelling']);
/**
 * Terminal states that mean the step did not fail.
 *
 * `skipped` is here because restore replies with the whole operation chain, not
 * just the restore: Neon schedules compute suspend/start alongside it and
 * reports `skipped` for a step it did not need to perform (a compute that was
 * already suspended, say). That is a successful reset, so treating it as fatal
 * would abort a run whose branches were in fact reset correctly — and print a
 * warning saying the branches may have been overwritten and it cannot say
 * which, which would be false. `failed`, `error` and `cancelled` stay fatal.
 */
const SUCCESS_STATUSES: ReadonlySet<OperationStatus> = new Set<OperationStatus>(['finished', 'skipped']);

function isOperationStatus(value: unknown): value is OperationStatus {
  return typeof value === 'string' && (OPERATION_STATUSES as readonly string[]).includes(value);
}

/** Reads JSON without letting a parse failure put body text into the error. */
async function readJson(response: Response, context: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`Neon control-plane ${context} response was not valid JSON`);
  }
}

/**
 * Restore replies with `BranchOperations` — the restore plus whatever compute
 * operations Neon schedules alongside it — and the operation ids are the only
 * thing taken from the body, and they are never echoed anywhere.
 */
function readOperationIds(body: unknown): string[] {
  const root = asRecord(body, 'Neon control-plane restore response is not an object');
  const operations = root.operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('Neon control-plane restore response did not report any operations');
  }
  return operations.map((value) => {
    const operation = asRecord(value, 'Neon control-plane restore response operation is not an object');
    if (typeof operation.id !== 'string' || operation.id.length === 0) {
      throw new Error('Neon control-plane restore response operation is missing id');
    }
    return operation.id;
  });
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

async function readOperationStatus(input: {
  projectId: string; operationId: string; apiKey: string; send: typeof fetch;
}): Promise<OperationStatus> {
  const response = await input.send(
    `${NEON_API_ORIGIN}/projects/${encodeURIComponent(input.projectId)}/operations/${encodeURIComponent(input.operationId)}`,
    { method: 'GET', headers: { Authorization: `Bearer ${input.apiKey}`, Accept: 'application/json' }, redirect: 'error' },
  );
  if (!response.ok) throw new Error(`Neon control-plane operation poll failed with status ${response.status}`);
  const root = asRecord(await readJson(response, 'operation'), 'Neon control-plane operation response is not an object');
  const operation = 'operation' in root ? asRecord(root.operation, 'Neon control-plane operation response wrapper is invalid') : root;
  // Only the enumerated state is reported; an unrecognized value is not echoed.
  if (!isOperationStatus(operation.status)) throw new Error('Neon control-plane operation response has an unrecognized status');
  return operation.status;
}

/**
 * Restore is asynchronous: Neon interrupts existing connections and the branch
 * is only overwritten when the operation finishes. Resolving on the 2xx alone
 * would let a caller connect mid-restore, or read the previous run's rows, and
 * would report success for an operation that later fails.
 */
async function awaitOperations(input: {
  projectId: string; operationIds: readonly string[]; apiKey: string; send: typeof fetch;
  pollIntervalMs: number; pollTimeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.pollTimeoutMs;
  for (const operationId of input.operationIds) {
    for (;;) {
      const status = await readOperationStatus({ projectId: input.projectId, operationId, apiKey: input.apiKey, send: input.send });
      if (SUCCESS_STATUSES.has(status)) break;
      if (!PENDING_STATUSES.has(status)) throw new Error(`Neon control-plane reset operation ended with status ${status}`);
      if (Date.now() >= deadline) {
        throw new Error(`Neon control-plane reset did not finish within ${input.pollTimeoutMs}ms`);
      }
      await delay(input.pollIntervalMs);
    }
  }
}

/**
 * Resets one attested A/B branch to the head of the attested base. The only
 * mutating call this harness makes.
 *
 * Neon v2 has no `reset_to_parent` operation: the current spec exposes
 * `POST /projects/{project_id}/branches/{branch_id}/restore`
 * (`restoreProjectBranch`), which restores to the head of `source_branch_id`
 * when no LSN or timestamp is given.
 *
 * The manifest must be an `AttestedAbManifest`: the branch is proven to be a
 * designated A/B branch by construction, not by call order. It resolves only
 * after every reported operation is terminal and not a failure (`finished`, or
 * `skipped` for a step Neon did not need to perform), so nothing connects to a
 * branch that is still being overwritten. Poll interval and timeout are
 * injectable so tests do not sleep.
 */
export async function resetAbBranch(input: {
  manifest: AttestedAbManifest; branchId: string; apiKey: string; fetchImpl?: typeof fetch;
  pollIntervalMs?: number; pollTimeoutMs?: number;
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
  const operationIds = readOperationIds(await readJson(response, 'restore'));
  await awaitOperations({
    projectId: manifest.projectId,
    operationIds,
    apiKey,
    send,
    pollIntervalMs: input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs: input.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
  });
}
