// The hermetic negotiation-pickup controller boundary
// (`pickupNegotiationAtControllerBoundary`, `NegotiationPickupPort`,
// `NegotiationPickupBoundaryResult`) was retired whole-cloth by the
// negotiation-graph rewrite (#1494, docs/plans/2026-08-23-personal-agent-
// and-negotiation-graphs.md): a negotiation can no longer be claimed under
// the new working-only lifecycle, so the pickup route behind this seam is
// deleted (agent.controller.ts).

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
