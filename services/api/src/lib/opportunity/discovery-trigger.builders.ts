export type IntentDiscoveryTrigger = {
  userId: string;
  searchQuery: string;
  operationMode: 'create';
  triggerIntentId: string;
  options: Record<string, never>;
} & (
  | { networkId: string; indexScope?: never }
  | { networkId?: never; indexScope: string[] }
);

export type DiscoveryGraphInvokeOptions = IntentDiscoveryTrigger;

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
    operationMode: 'create',
    ...(input.networkIds.length === 1
      ? { networkId: input.networkIds[0]! }
      : { indexScope: [...input.networkIds] }),
    triggerIntentId: input.triggerIntentId,
    options: {},
  };
}
