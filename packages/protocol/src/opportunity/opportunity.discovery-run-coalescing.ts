type DiscoveryRunScope = {
  scopeType?: string;
  scopeId?: string;
};

type DiscoveryCoalescingRequest = {
  continueFrom?: string;
  searchQuery?: string;
  networkId?: string;
  intentId?: string;
  targetUserId?: string;
  introTargetUserId?: string;
  partyUserIds?: string[];
  entities?: Array<{ userId: string; networkId: string }>;
  hint?: string;
};

type ActiveDiscoveryRunForCoalescing = {
  id: string;
  status: string;
  input: DiscoveryCoalescingRequest;
  context: DiscoveryRunScope;
};

/**
 * Finds an active MCP discovery run that describes the same user request and
 * resolved scope boundary. The identity is deliberately normalized so harmless
 * formatting differences share one expensive graph execution, while distinct
 * hints, opaque continuation tokens, entity networks, and scopes remain
 * independent runs.
 */
export function findCoalescedDiscoveryRun(
  input: DiscoveryCoalescingRequest,
  context: DiscoveryRunScope,
  activeRuns: readonly ActiveDiscoveryRunForCoalescing[],
): ActiveDiscoveryRunForCoalescing | undefined {
  const signature = discoveryRunSignature(input, context);
  return activeRuns.find(
    (run) => discoveryRunSignature(run.input, run.context) === signature,
  );
}

function discoveryRunSignature(
  input: DiscoveryCoalescingRequest,
  scope: DiscoveryRunScope,
): string {
  const text = (value?: string) => (value ?? "").trim().toLowerCase();
  const id = (value?: string) => (value ?? "").trim();
  const entities = [...(input.entities ?? [])]
    .map((entity) => JSON.stringify([id(entity.networkId), id(entity.userId)]))
    .sort();
  return JSON.stringify({
    searchQuery: text(input.searchQuery),
    networkId: id(input.networkId),
    intentId: id(input.intentId),
    targetUserId: id(input.targetUserId),
    introTargetUserId: id(input.introTargetUserId),
    continueFrom: id(input.continueFrom),
    hint: text(input.hint),
    partyUserIds: [...(input.partyUserIds ?? [])].map((value) => value.trim()).sort(),
    entities,
    scope: {
      scopeType: id(scope.scopeType),
      scopeId: id(scope.scopeId),
    },
  });
}
