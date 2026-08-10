import { isDedicatedHermesNegotiationAudience, type NegotiationCredentialPrincipal } from './hermes-credential';
import { getRequestAuthContext } from '../request-auth-context';
import { readHermesRunHeaders } from './hermes-negotiation-run';

export type AgentPrincipalResolver = (request: Request) => Promise<string | null>;

export type NegotiationPickupPort<Result> = {
  pickup(
    agentId: string,
    ownerId: string,
    principal: NegotiationCredentialPrincipal,
    runId?: string,
  ): Promise<Result | null>;
};

export type NegotiationPickupBoundaryResult<Result> =
  | { kind: 'forbidden' }
  | { kind: 'empty' }
  | { kind: 'authorized'; value: Result };

/**
 * Hermetic controller boundary for negotiation pickup.
 *
 * This seam deliberately has no agent-registry/heartbeat dependency: the only
 * health write belongs to the owner-locked production pickup transaction. A
 * service result can cross the controller boundary only for the exact
 * authenticated agent-bound principal recorded by the auth guard.
 */
export async function pickupNegotiationAtControllerBoundary<Result>(input: {
  request: Request;
  agentId: string;
  ownerId: string;
  resolveAgentPrincipal: AgentPrincipalResolver;
  negotiations: NegotiationPickupPort<Result>;
}): Promise<NegotiationPickupBoundaryResult<Result>> {
  if (await input.resolveAgentPrincipal(input.request) !== input.agentId) {
    return { kind: 'forbidden' };
  }

  const context = getRequestAuthContext(input.request);
  if (
    context?.kind !== 'api_key'
    || context.agentId !== input.agentId
    || !context.credentialId
  ) {
    return { kind: 'forbidden' };
  }

  const principal: NegotiationCredentialPrincipal = {
    credentialId: context.credentialId,
    agentId: context.agentId,
    audience: context.audience ?? null,
    setupAttemptId: context.setupAttemptId ?? null,
    ...(context.installationId ? { installationId: context.installationId } : {}),
    ...(context.actions ? { actions: context.actions } : {}),
  };
  const runHeaders = readHermesRunHeaders(input.request);
  if (isDedicatedHermesNegotiationAudience(principal.audience) && !runHeaders) {
    return { kind: 'forbidden' };
  }
  const result = await input.negotiations.pickup(
    input.agentId,
    input.ownerId,
    principal,
    runHeaders?.runId,
  );
  return result === null ? { kind: 'empty' } : { kind: 'authorized', value: result };
}

/** Preserve the historical test-message ordering: authorize, fetch, heartbeat. */
export async function pickupTestMessageAtControllerBoundary<Result>(input: {
  agentId: string;
  ownerId: string;
  authorize: (agentId: string, ownerId: string) => Promise<unknown>;
  pickup: (agentId: string) => Promise<Result | null>;
  touchLastSeen: (agentId: string) => Promise<void>;
}): Promise<Result | null> {
  await input.authorize(input.agentId, input.ownerId);
  const result = await input.pickup(input.agentId);
  await input.touchLastSeen(input.agentId);
  return result;
}

/** Preserve opportunity ordering: authorize, heartbeat, then reserve work. */
export async function pickupOpportunityAtControllerBoundary<Result>(input: {
  agentId: string;
  ownerId: string;
  authorize: (agentId: string, ownerId: string) => Promise<unknown>;
  touchLastSeen: (agentId: string) => Promise<void>;
  pickup: (agentId: string) => Promise<Result | null>;
}): Promise<Result | null> {
  await input.authorize(input.agentId, input.ownerId);
  await input.touchLastSeen(input.agentId);
  return input.pickup(input.agentId);
}

export type FiniteLimitResult =
  | { kind: 'valid'; value: number | undefined }
  | { kind: 'invalid' };

/** Provider-free parsing seam; range normalization remains service-owned. */
export function parseFiniteLimit(url: string): FiniteLimitResult {
  const limitParam = new URL(url).searchParams.get('limit');
  if (limitParam === null || limitParam === '') return { kind: 'valid', value: undefined };
  const parsed = Number(limitParam);
  return Number.isFinite(parsed)
    ? { kind: 'valid', value: parsed }
    : { kind: 'invalid' };
}
