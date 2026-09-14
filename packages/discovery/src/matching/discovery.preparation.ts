import { timed } from '../core/runtime.js';
import type { ActiveIntent } from '../core/types.js';
import type { DiscoveryDeps, DiscoveryState, IndexedIntent, TargetNetwork } from './discovery.state.js';
import { prepLog, resolveLog, scopeLog } from './discovery.trace.js';

/**
 * Node 0: Prep
 * Fetches user's network memberships and validates requirements.
 * Returns empty if user has no network memberships (requirement).
 */
export async function prepNode(state: DiscoveryState, deps: DiscoveryDeps) {
  return timed("OpportunityGraph.prep", async () =>
    (async () => {
        // Use getNetworkMemberships (all memberships) for search scope — NOT getUserNetworkIds
        // (which filters by autoAssign=true and is intended only for intent assignment).
        const memberships = await deps.database.getNetworkMemberships(state.userId);
        const userNetworkIds = memberships.map(m => m.networkId) as string[];
        if (userNetworkIds.length === 0) {
          prepLog.verbose('User has no network memberships - cannot find opportunities');
          return {
            userNetworks: [] as string[],
            sourceProfile: null,
            error: 'You need to join at least one network to find opportunities.',
          };
        }
        const discoveryUserId = state.userId;
        const [intents, profile] = await Promise.all([
          deps.database.getActiveIntents(discoveryUserId),
          deps.database.getProfile(discoveryUserId),
        ]);
        const indexedIntents: IndexedIntent[] = intents.map((intent: ActiveIntent) => ({
          intentId: intent.id,
          payload: intent.payload,
          summary: intent.summary ?? undefined,
          networks: [],
        }));
        const sourceProfile = profile
          ? {
              identity: profile.identity ?? undefined,
              context: profile.context ?? undefined,
            }
          : null;
        return {
          userNetworks: userNetworkIds,
          indexedIntents,
          sourceProfile,
          trace: [{
            node: "prep",
            detail: `${userNetworkIds.length} network(s), ${intents.length} intent(s), ${profile ? 'profile loaded' : 'no profile'}`,
          }],
        };
    })().catch((error) => {
      const errMsg = error instanceof Error ? error.message : String(error);
      prepLog.error('Failed', { error });
      return {
        error: 'Failed to prepare opportunity search. Please try again.',
        trace: [{
          node: "prep_fatal",
          detail: `Prep failed: ${errMsg}`,
          data: { error: errMsg },
        }],
      };
    })
  );
}

/** Trace summary for {@link prepNode}. */
export function prepTraceSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown>;
  if (r?.error) return `error: ${r.error}`;
  const networks = r?.userNetworks as unknown[];
  const intents = r?.indexedIntents as unknown[];
  return networks && intents ? `${networks.length} network(s), ${intents.length} intent(s)` : undefined;
}

/**
 * Node 1: Scope
 * Determines which networks to search within.
 * If networkId provided: searches only that network.
 * Otherwise: searches all the user's networks.
 */
export async function scopeNode(state: DiscoveryState, deps: DiscoveryDeps) {
  return timed("OpportunityGraph.scope", async () => {
    scopeLog.verbose('Determining search scope', {
      requestedNetworkId: state.networkId,
      userNetworksCount: state.userNetworks.length,
    });

    try {
      const scope = await deps.database.getDiscoveryScope({
        userId: state.userId, userNetworks: state.userNetworks,
        networkId: state.networkId, networkScope: state.networkScope,
        triggerIntentId: state.triggerIntentId,
      });
      if (scope.error) return { targetNetworks: [], error: scope.error };
      const targetNetworkIds = scope.networkIds;

      // Fetch network details
      const targetNetworks: TargetNetwork[] = await Promise.all(
        targetNetworkIds.map(async (networkId) => {
          const network = await deps.database.getNetwork(networkId);
          const memberCount = await deps.database.getNetworkMemberCount(networkId);
          return {
            networkId,
            title: network?.title ?? 'Unknown',
            memberCount,
          };
        })
      );

      scopeLog.verbose('Scope determined', {
        targetNetworksCount: targetNetworks.length,
        networks: targetNetworks.map(n => n.title),
      });

      // ── Populate network relevancy scores for dedup tie-breaking ──
      const networkRelevancyScores: Record<string, number> = {};

      if (state.triggerIntentId) {
        // Background path: look up persisted scores from intent_networks
        try {
          const scores = await deps.database.getIntentNetworkScores(state.triggerIntentId);
          for (const { networkId, relevancyScore } of scores) {
            if (relevancyScore != null) {
              networkRelevancyScores[networkId] = relevancyScore;
            }
          }
        } catch (err) {
          scopeLog.warn('Failed to load intent network scores', { triggerIntentId: state.triggerIntentId, error: err });
        }
      }

      const totalMembers = targetNetworks.reduce((sum, i) => sum + i.memberCount, 0);
      return {
        targetNetworks,
        networkRelevancyScores,
        trace: [{
          node: "scope",
          detail: `Searching ${targetNetworks.length} network(s): ${targetNetworks.map(n => `${n.title} (${n.memberCount})`).join(', ')}`,
          data: { totalMembers },
        }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      scopeLog.error('Failed', { error });
      return {
        targetNetworks: [],
        error: 'Failed to determine search scope.',
        trace: [{
          node: "scope_fatal",
          detail: `Scope failed: ${errMsg}`,
          data: { error: errMsg },
        }],
      };
    }
  });
}

/** Trace summary for {@link scopeNode}. */
export function scopeTraceSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown>;
  if (r?.error) return `error: ${r.error}`;
  const networks = r?.targetNetworks as unknown[];
  return networks ? `${networks.length} network(s) in scope` : undefined;
}

/**
 * Node 2: Resolve
 * Resolves trigger intent from triggerIntentId or searchQuery vs indexedIntents;
 * sets discoverySource, resolvedTriggerIntentId, resolvedIntentInNetwork for routing (path A/B/C).
 */
export async function resolveNode(state: DiscoveryState, deps: DiscoveryDeps) {
  return timed("OpportunityGraph.resolve", async () => {
    resolveLog.verbose('Resolving intent and network membership', {
      triggerIntentId: state.triggerIntentId,
      hasSearchQuery: !!state.searchQuery,
      indexedIntentsCount: state.indexedIntents.length,
    });

    const targetNetworkIds = state.targetNetworks.map((t) => t.networkId);

    try {
      let resolvedIntentId: string | undefined;
      if (state.triggerIntentId) {
        const isOwnedActiveIntent = state.indexedIntents.some((intent) =>
          intent.intentId === state.triggerIntentId);
        if (!isOwnedActiveIntent) {
          resolveLog.warn('Trigger intent is not an active intent owned by the discovery user', {
            triggerIntentId: state.triggerIntentId,
            userId: state.userId,
          });
          return {
            resolvedTriggerIntentId: undefined,
            resolvedIntentInNetwork: false,
            discoverySource: 'context' as const,
            error: 'Trigger intent is not available for discovery.',
          };
        }
        const inNetwork = await deps.database.getNetworkIdsForIntent(state.triggerIntentId);
        const inTarget = inNetwork.some((id) => targetNetworkIds.includes(id as string));
        resolvedIntentId = state.triggerIntentId;
        const resolvedIntentInNetwork = inTarget;
        const discoverySource = resolvedIntentInNetwork ? ('intent' as const) : ('context' as const);
        return {
          resolvedTriggerIntentId: resolvedIntentId,
          resolvedIntentInNetwork,
          discoverySource,
        };
      }

      if (state.searchQuery?.trim() && state.indexedIntents.length > 0) {
        const q = state.searchQuery.trim().toLowerCase();
        const matched = state.indexedIntents.find((i) => i.payload?.toLowerCase().includes(q));
        if (matched) {
          resolvedIntentId = matched.intentId;
          const inNetwork = await deps.database.getNetworkIdsForIntent(matched.intentId);
          const resolvedIntentInNetwork = inNetwork.some((id) => targetNetworkIds.includes(id as string));
          const discoverySource = resolvedIntentInNetwork ? ('intent' as const) : ('context' as const);
          return {
            resolvedTriggerIntentId: resolvedIntentId,
            resolvedIntentInNetwork,
            discoverySource,
          };
        }
        resolveLog.warn('No intent matched search query; leaving resolvedIntentId unset', {
          searchQuery: state.searchQuery,
          indexedIntentsCount: state.indexedIntents.length,
        });
      }

      return {
        resolvedTriggerIntentId: undefined,
        resolvedIntentInNetwork: false,
        discoverySource: 'context' as const,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      resolveLog.error('Failed', {
        triggerIntentId: state.triggerIntentId,
        searchQuery: state.searchQuery,
        error: err,
      });
      return {
        resolvedTriggerIntentId: undefined,
        resolvedIntentInNetwork: false,
        discoverySource: 'context' as const,
        error: errMsg || 'Resolve failed',
        trace: [{
          node: "resolve_fatal",
          detail: `Resolve failed: ${errMsg}`,
          data: { error: errMsg },
        }],
      };
    }
  });
}

/** Trace summary for {@link resolveNode}. */
export function resolveTraceSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown>;
  if (r?.error) return `error: ${r.error}`;
  return r?.discoverySource ? `source: ${r.discoverySource}` : undefined;
}
