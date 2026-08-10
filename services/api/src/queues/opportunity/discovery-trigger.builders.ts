export type IntentDiscoveryTrigger = {
  userId: string;
  searchQuery: string;
  operationMode: 'create';
  triggerIntentId: string;
  options: { initialStatus: 'latent' };
} & (
  | { networkId: string; indexScope?: never }
  | { networkId?: never; indexScope: string[] }
);

export interface EnrichmentDiscoveryTrigger {
  userId: string;
  networkId: string;
  operationMode: 'create';
  options: { initialStatus: 'latent' };
}

export type FromIntentGraphInvokeOptions = IntentDiscoveryTrigger;

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
    options: { initialStatus: 'latent' },
  };
}

export function buildEnrichmentDiscoveryTrigger(input: {
  userId: string;
  networkId: string;
}): EnrichmentDiscoveryTrigger {
  return {
    userId: input.userId,
    networkId: input.networkId,
    operationMode: 'create',
    options: { initialStatus: 'latent' },
  };
}
