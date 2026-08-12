import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { isDedicatedHermesNegotiationAudience, type NegotiationCredentialPrincipal } from './hermes-credential';

export const HERMES_RUN_ID_HEADER = 'x-index-hermes-run-id';
export const HERMES_RUN_CAPABILITY_HEADER = 'x-index-hermes-run-capability';
export const HERMES_RUN_CAPABILITY_TTL_MS = 10 * 60 * 1_000;

export type HermesRunOutcome = 'responded' | 'consulted';

/** Stored only inside task metadata; raw run IDs and capabilities are never persisted. */
export type HermesRunCapabilityBinding = {
  version: 1;
  taskId: string;
  credentialId: string;
  agentId: string;
  setupAttemptId: string;
  runIdDigest: string;
  capabilityDigest: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt?: string;
  completedAt?: string;
  outcome?: HermesRunOutcome;
};

export type HermesRunCapabilityInput = {
  taskId: string;
  runId: string;
  capability: string;
  principal: NegotiationCredentialPrincipal;
  now?: Date;
};

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Stable lookup digest; the raw process run ID never enters task metadata. */
export function digestHermesRunId(runId: string): string {
  return digest(runId);
}

function sameDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function issueHermesRunCapability(input: {
  taskId: string;
  runId: string;
  principal: NegotiationCredentialPrincipal;
  now?: Date;
  ttlMs?: number;
}): { capability: string; binding: HermesRunCapabilityBinding } {
  if (
    !isDedicatedHermesNegotiationAudience(input.principal.audience)
    || !nonempty(input.principal.setupAttemptId)
    || !nonempty(input.runId)
  ) throw new Error('Hermes run capability requires an exact dedicated credential and run ID');

  const now = input.now ?? new Date();
  const capability = randomBytes(32).toString('base64url');
  const ttlMs = input.ttlMs ?? HERMES_RUN_CAPABILITY_TTL_MS;
  return {
    capability,
    binding: {
      version: 1,
      taskId: input.taskId,
      credentialId: input.principal.credentialId,
      agentId: input.principal.agentId,
      setupAttemptId: input.principal.setupAttemptId,
      runIdDigest: digest(input.runId),
      capabilityDigest: digest(capability),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    },
  };
}

export function parseHermesRunCapabilityBinding(value: unknown): HermesRunCapabilityBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const binding = value as Partial<HermesRunCapabilityBinding>;
  if (
    binding.version !== 1
    || !nonempty(binding.taskId)
    || !nonempty(binding.credentialId)
    || !nonempty(binding.agentId)
    || !nonempty(binding.setupAttemptId)
    || !nonempty(binding.runIdDigest)
    || !nonempty(binding.capabilityDigest)
    || !nonempty(binding.issuedAt)
    || !nonempty(binding.expiresAt)
    || (binding.consumedAt !== undefined && !nonempty(binding.consumedAt))
    || (binding.completedAt !== undefined && !nonempty(binding.completedAt))
    || (binding.outcome !== undefined && binding.outcome !== 'responded' && binding.outcome !== 'consulted')
  ) return null;
  return binding as HermesRunCapabilityBinding;
}

export function hermesRunBindingMatchesIdentity(
  binding: HermesRunCapabilityBinding,
  input: Omit<HermesRunCapabilityInput, 'capability' | 'now'>,
): boolean {
  const setupAttemptId = input.principal.setupAttemptId;
  return isDedicatedHermesNegotiationAudience(input.principal.audience)
    && Boolean(setupAttemptId)
    && binding.taskId === input.taskId
    && binding.credentialId === input.principal.credentialId
    && binding.agentId === input.principal.agentId
    && binding.setupAttemptId === setupAttemptId
    && sameDigest(binding.runIdDigest, digest(input.runId));
}

export function verifyHermesRunCapability(
  binding: HermesRunCapabilityBinding,
  input: HermesRunCapabilityInput,
): 'fresh' | 'replay' | 'expired' | 'invalid' {
  const setupAttemptId = input.principal.setupAttemptId;
  if (
    !setupAttemptId
    || !hermesRunBindingMatchesIdentity(binding, input)
    || !sameDigest(binding.capabilityDigest, digest(input.capability))
  ) return 'invalid';

  // Once consumed, the exact secret is useful only for replaying/repairing the
  // already-chosen durable outcome. Do not let TTL expiry make a committed
  // response unrecoverable; fresh mutation authority still expires normally.
  if (binding.consumedAt && binding.outcome) return 'replay';
  const now = input.now ?? new Date();
  if (new Date(binding.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'fresh';
}

/** Read hidden bridge values. They are intentionally absent from every model schema/body. */
export function readHermesRunHeaders(request: Request): { runId: string; capability: string | null } | null {
  const runId = request.headers.get(HERMES_RUN_ID_HEADER)?.trim();
  if (!runId || runId.length > 256) return null;
  const capability = request.headers.get(HERMES_RUN_CAPABILITY_HEADER)?.trim() || null;
  if (capability && capability.length > 256) return null;
  return { runId, capability };
}
