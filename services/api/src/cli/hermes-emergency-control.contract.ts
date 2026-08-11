import { createHash } from 'node:crypto';

export const HERMES_EMERGENCY_AUDIENCE = 'hermes-agent' as const;
export const HERMES_EMERGENCY_ACTION = 'manage:negotiations' as const;
export const HERMES_EMERGENCY_PLAN_PREFIX = 'hecp_' as const;

export type HermesEmergencyAudience = typeof HERMES_EMERGENCY_AUDIENCE;

export interface EmergencySnapshotAgent {
  id: string;
  ownerId: string;
  installationId: string;
  status: string;
  handleNegotiations: boolean;
  setupAttemptId: string | null;
}

export interface EmergencySnapshotCredential {
  id: string;
  ownerId: string;
  agentId: string;
  installationId: string;
  setupAttemptId: string;
  activationState: 'pending' | 'active';
  actions: string[];
}

export interface EmergencySnapshotPermission {
  id: string;
  agentId: string;
  ownerId: string;
  userId: string;
  scope: string;
  scopeId: string | null;
  actions: string[];
}

export interface EmergencySnapshot {
  agents: EmergencySnapshotAgent[];
  credentials: EmergencySnapshotCredential[];
  permissions: EmergencySnapshotPermission[];
}

export interface EmergencyPlan {
  planId: string;
  audience: HermesEmergencyAudience;
  installations: number;
  credentials: number;
  permissions: number;
  owners: number;
  reason: 'dry-run';
}

export interface EmergencyReceipt {
  planId: string;
  receiptId: string;
  audience: HermesEmergencyAudience;
  installations: number;
  credentials: number;
  permissions: number;
  owners: number;
  selectedPaused: number;
  credentialsRevoked: number;
  permissionsRemoved: number;
  installationsDisconnected: number;
  auditReceipts: 0 | 1;
  reason: 'executed' | 'already-executed';
}

export function assertEmergencyAudience(audience: string): asserts audience is HermesEmergencyAudience {
  if (audience !== HERMES_EMERGENCY_AUDIENCE) {
    throw new Error('audience must be exactly hermes-agent');
  }
}

export function assertEmergencyPlanId(planId: string): void {
  if (!/^hecp_[A-Za-z0-9_-]{43}$/.test(planId)) throw new Error('planId must be an opaque Hermes emergency plan ID');
}

function compareByIdentity(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id, 'en');
}

/**
 * Build a stable digest projection. Identifiers are used only inside the digest
 * boundary and are never returned or logged. Dedicated credential hashes and
 * secrets are deliberately absent from the snapshot type.
 */
export function createEmergencyPlan(snapshot: EmergencySnapshot, audience: string): EmergencyPlan {
  assertEmergencyAudience(audience);
  const agents = [...snapshot.agents].sort(compareByIdentity).map((row) => ({
    id: row.id,
    ownerId: row.ownerId,
    installationId: row.installationId,
    status: row.status,
    handleNegotiations: row.handleNegotiations,
    setupAttemptId: row.setupAttemptId,
  }));
  const credentials = [...snapshot.credentials].sort(compareByIdentity).map((row) => ({
    id: row.id,
    ownerId: row.ownerId,
    agentId: row.agentId,
    installationId: row.installationId,
    setupAttemptId: row.setupAttemptId,
    activationState: row.activationState,
    actions: [...row.actions],
  }));
  const permissions = [...snapshot.permissions].sort(compareByIdentity).map((row) => ({
    id: row.id,
    agentId: row.agentId,
    ownerId: row.ownerId,
    userId: row.userId,
    scope: row.scope,
    scopeId: row.scopeId,
    actions: [...row.actions],
  }));
  const owners = new Set([
    ...agents.map((row) => row.ownerId),
    ...credentials.map((row) => row.ownerId),
    ...permissions.map((row) => row.ownerId),
  ]);
  const digest = createHash('sha256').update(JSON.stringify({
    version: 1,
    audience,
    agents,
    credentials,
    permissions,
  })).digest('base64url');

  return {
    planId: `${HERMES_EMERGENCY_PLAN_PREFIX}${digest}`,
    audience,
    installations: agents.length,
    credentials: credentials.length,
    permissions: permissions.length,
    owners: owners.size,
    reason: 'dry-run',
  };
}

function assertCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid emergency control output');
}

function assertDuration(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error('invalid emergency control output');
}

export type EmergencyCommandOutput = (EmergencyPlan | EmergencyReceipt) & { durationMs: number };

/** Reconstruct the approved low-cardinality output so extra runtime fields cannot escape. */
export function formatEmergencyOutput(output: EmergencyCommandOutput): string {
  assertEmergencyAudience(output.audience);
  assertEmergencyPlanId(output.planId);
  assertDuration(output.durationMs);
  for (const value of [output.installations, output.credentials, output.permissions, output.owners]) assertCount(value);

  if (output.reason === 'dry-run') {
    return JSON.stringify({
      planId: output.planId,
      audience: output.audience,
      installations: output.installations,
      credentials: output.credentials,
      permissions: output.permissions,
      owners: output.owners,
      reason: output.reason,
      durationMs: output.durationMs,
    });
  }

  assertEmergencyPlanId(output.receiptId);
  for (const value of [
    output.selectedPaused,
    output.credentialsRevoked,
    output.permissionsRemoved,
    output.installationsDisconnected,
    output.auditReceipts,
  ]) assertCount(value);
  return JSON.stringify({
    planId: output.planId,
    receiptId: output.receiptId,
    audience: output.audience,
    installations: output.installations,
    credentials: output.credentials,
    permissions: output.permissions,
    owners: output.owners,
    selectedPaused: output.selectedPaused,
    credentialsRevoked: output.credentialsRevoked,
    permissionsRemoved: output.permissionsRemoved,
    installationsDisconnected: output.installationsDisconnected,
    auditReceipts: output.auditReceipts,
    reason: output.reason,
    durationMs: output.durationMs,
  });
}
