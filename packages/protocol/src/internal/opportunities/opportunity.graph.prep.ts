/**
 * Discovery pipeline, stages 0–2: prep, scope, resolve.
 *
 * Each stage is a top-level function taking the graph state and an explicit
 * dependency bag. `opportunity.graph.ts` wires them into the StateGraph.
 */

import type { ActiveIntent, Id } from '../../platform/database.js';
import type { IndexedIntent, TargetNetwork } from './opportunity.state.js';
import { withCallLogging } from '../shared/observability/protocol.logger.js';
import { timed } from '../shared/observability/performance.js';
import { prepLog, scopeLog, resolveLog, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/**
 * Node 0: Prep
 * Fetches user's network memberships and validates requirements.
 * Returns empty if user has no network memberships (requirement).
 */
export async function prepNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  return timed("OpportunityGraph.prep", async () =>
    withCallLogging(
      prepLog,
      'prepNode',
      {
        userId: state.userId,
        hasSearchQuery: !!state.searchQuery,
        requestedNetworkId: state.networkId ?? undefined,
      },
      async () => {
        // Use getNetworkMemberships (all memberships) for search scope — NOT getUserNetworkIds
        // (which filters by autoAssign=true and is intended only for intent assignment).
        const memberships = await deps.database.getNetworkMemberships(state.userId);
        const userNetworkIds = memberships.map(m => m.networkId) as Id<'networks'>[];
        if (userNetworkIds.length === 0) {
          prepLog.verbose('User has no network memberships - cannot find opportunities');
          return {
            userNetworks: [] as Id<'networks'>[],
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
      },
      { context: { userId: state.userId }, logOutput: true }
    ).catch((error) => {
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
export async function scopeNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  return timed("OpportunityGraph.scope", async () => {
    scopeLog.verbose('Determining search scope', {
      requestedNetworkId: state.networkId,
      userNetworksCount: state.userNetworks.length,
    });

    try {
      let targetNetworkIds: Id<'networks'>[];

      if (state.networkId) {
        // Validate user is member or owner of requested network
        const isInScope = state.userNetworks.includes(state.networkId);
        const isOwner = !isInScope && await deps.database.isNetworkOwner(state.networkId, state.userId);
        if (!isInScope && !isOwner) {
          scopeLog.warn('User not member of requested network', {
            networkId: state.networkId,
          });
          return {
            targetNetworks: [],
            error: 'You are not a member of that network.',
          };
        }
        targetNetworkIds = [state.networkId];
      } else if (state.networkScope !== undefined) {
        // Bounded scope (e.g. a network-scoped agent's reachable networks):
        // intersect with the user's actual memberships so discovery never
        // reaches networks outside the agent's bound scope. An explicit
        // empty scope is authoritative and must fail closed.
        const allowed = new Set(state.networkScope);
        targetNetworkIds = state.userNetworks.filter((n) => allowed.has(n));
        scopeLog.verbose('Applied networkScope intersection', {
          networkScopeCount: state.networkScope.length,
          userNetworksCount: state.userNetworks.length,
          targetCount: targetNetworkIds.length,
        });
      } else {
        // Search all the user's networks
        targetNetworkIds = state.userNetworks;
      }

      if (state.triggerIntentId) {
        // A trigger intent is an authoritative discovery boundary, not just
        // ranking context. Recompute the intersection at the graph edge so
        // direct chat/MCP callers cannot bypass DiscoveryQueue admission.
        const assignedNetworkIds = new Set(
          await deps.database.getNetworkIdsForIntent(state.triggerIntentId),
        );
        const activeOwnerNetworkIds = new Set(state.userNetworks);
        targetNetworkIds = targetNetworkIds.filter((networkId) =>
          assignedNetworkIds.has(networkId) && activeOwnerNetworkIds.has(networkId),
        );
        scopeLog.verbose('Applied trigger-intent network intersection', {
          triggerIntentId: state.triggerIntentId,
          assignedCount: assignedNetworkIds.size,
          targetCount: targetNetworkIds.length,
        });
      }

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
export async function resolveNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  return timed("OpportunityGraph.resolve", async () => {
    resolveLog.verbose('Resolving intent and network membership', {
      triggerIntentId: state.triggerIntentId,
      hasSearchQuery: !!state.searchQuery,
      indexedIntentsCount: state.indexedIntents.length,
    });

    const targetNetworkIds = state.targetNetworks.map((t) => t.networkId);

    try {
      let resolvedIntentId: Id<'intents'> | undefined;
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
        const inTarget = inNetwork.some((id) => targetNetworkIds.includes(id as Id<'networks'>));
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
          const resolvedIntentInNetwork = inNetwork.some((id) => targetNetworkIds.includes(id as Id<'networks'>));
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
