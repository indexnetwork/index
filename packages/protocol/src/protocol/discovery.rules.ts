/** Network scope remains a protocol rule; matchmaking receives the host-authorized result. */
export function resolveDiscoveryNetworkScope(input: {
  userNetworkIds: string[];
  networkId?: string;
  networkScope?: string[];
  ownsRequestedNetwork: boolean;
  triggerIntentNetworkIds?: string[];
}): { networkIds: string[]; error?: string } {
  let networkIds: string[];
  if (input.networkId) {
    if (!input.userNetworkIds.includes(input.networkId) && !input.ownsRequestedNetwork) {
      return { networkIds: [], error: 'You are not a member of that network.' };
    }
    networkIds = [input.networkId];
  } else if (input.networkScope !== undefined) {
    const allowed = new Set(input.networkScope);
    networkIds = input.userNetworkIds.filter(id => allowed.has(id));
  } else {
    networkIds = input.userNetworkIds;
  }
  if (input.triggerIntentNetworkIds !== undefined) {
    const assigned = new Set(input.triggerIntentNetworkIds);
    const memberships = new Set(input.userNetworkIds);
    networkIds = networkIds.filter(id => assigned.has(id) && memberships.has(id));
  }
  return { networkIds };
}

/** Only permission-enabled network metadata may frame a discovery explanation. */
export function renderDiscoveryNetworkContext(network: {
  title: string;
  prompt?: string | null;
  permissions?: { contextInjection?: { discovery?: boolean } } | null;
}): string | undefined {
  if (network.permissions?.contextInjection?.discovery === false) return undefined;
  return [`## ${network.title}`, ...(network.prompt ? ['', network.prompt] : [])].join('\n');
}
