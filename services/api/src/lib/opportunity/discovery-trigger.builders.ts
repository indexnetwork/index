export type IntentDiscoveryTrigger = {
  userId: string;
  searchQuery: string;
  triggerIntentId: string;
  options: Record<string, never>;
} & (
  | { networkId: string; networkScope?: never }
  | { networkId?: never; networkScope: string[] }
);

export type DiscoveryInvokeOptions = IntentDiscoveryTrigger;

export function buildIntentDiscoveryTrigger(input: {
  userId: string;
  searchQuery: string;
  networkIds: readonly string[];
  triggerIntentId: string;
}): IntentDiscoveryTrigger {
  if (input.networkIds.length === 0) throw new Error('intent trigger requires authorized scope');
  return {
    userId: input.userId,
    searchQuery: input.searchQuery,
    ...(input.networkIds.length === 1
      ? { networkId: input.networkIds[0]! }
      : { networkScope: [...input.networkIds] }),
    triggerIntentId: input.triggerIntentId,
    options: {},
  };
}
