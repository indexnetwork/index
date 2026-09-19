import { CandidateDiscovery, type IntentPairEvaluator } from '@indexnetwork/discovery';
import { resolveDiscoveryNetworkScope } from '@indexnetwork/protocol';

import type { TuiPrincipal } from './negotiation.tui';

export const SCENARIO_NETWORK_ID = 'local-simulation';

/**
 * Run production discovery against fictional, active intents in one local network.
 * @param users - Scenario principals; private context is never exposed through discovery.
 * @param evaluator - Scores public intent pairs and network context, never private instructions or briefs.
 * @param isMatchReady - Whether the intent has committed its standing brief.
 * @returns The same exhaustive intent-pair pipeline used by the API, with in-memory data.
 */
export function createScenarioDiscovery(
  users: readonly TuiPrincipal[],
  evaluator: IntentPairEvaluator,
  isMatchReady: (intentId: string) => Promise<boolean>,
): CandidateDiscovery {
  const networkIds = [SCENARIO_NETWORK_ID];
  const assignedNetworks = (intentId: string) => users.some((user) => user.intentId === intentId) ? networkIds : [];
  return new CandidateDiscovery({
    evaluator,
    database: {
      getNetworkMemberships: async (userId) => users.some((user) => user.userId === userId) ? [{ networkId: SCENARIO_NETWORK_ID }] : [],
      getActiveIntents: async (userId) => {
        const owned = users.filter((user) => user.userId === userId);
        const ready = await Promise.all(owned.map(async (user) => ({ user, ready: await isMatchReady(user.intentId) })));
        return ready.filter((entry) => entry.ready).map(({ user }) => ({ id: user.intentId, payload: user.intent }));
      },
      getProfile: async (userId) => {
        const user = users.find((user) => user.userId === userId);
        return user ? { identity: { name: user.name } } : null;
      },
      getNetworkIdsForIntent: async (intentId) => assignedNetworks(intentId),
      getDiscoveryScope: async (input) => resolveDiscoveryNetworkScope({
        userNetworkIds: input.userNetworks, networkId: input.networkId, networkScope: input.networkScope,
        ownsRequestedNetwork: false, triggerIntentNetworkIds: assignedNetworks(input.triggerIntentId!),
      }),
      getNetworkContexts: async (ids) => Object.fromEntries(ids.filter((id) => id === SCENARIO_NETWORK_ID).map((id) => [id, 'Local simulation network'])),
      getActiveNetworkMembershipPairs: async (pairs) => pairs.filter((pair) => pair.networkId === SCENARIO_NETWORK_ID && users.some((user) => user.userId === pair.userId)),
      listIntentCandidates: async ({ excludeUserId, networkIds: requestedNetworks }, options) => {
        options?.signal?.throwIfAborted();
        const peers = users.filter((user) => user.userId !== excludeUserId && requestedNetworks.includes(SCENARIO_NETWORK_ID));
        const ready = await Promise.all(peers.map(async (user) => ({ user, ready: await isMatchReady(user.intentId) })));
        options?.signal?.throwIfAborted();
        return ready.filter((entry) => entry.ready).map(({ user }) => ({
          id: user.intentId, userId: user.userId, networkId: SCENARIO_NETWORK_ID, payload: user.intent,
        }));
      },
    },
  });
}
