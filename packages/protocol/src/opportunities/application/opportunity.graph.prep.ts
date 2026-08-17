/**
 * Discovery pipeline, stages 0–2: prep, scope, resolve.
 *
 * Each stage is a top-level function taking the graph state and an explicit
 * dependency bag. `opportunity.graph.ts` wires them into the StateGraph.
 */

import type { ActiveIntent, Id } from '../../shared/interfaces/database.interface.js';
import type { DebugMetaAgent } from '../../agents/index.js';
import type { IndexedIntent, TargetNetwork } from '../domain/opportunity.state.js';
import { IntentIndexer } from '../../intents/index.js';
import { withCallLogging } from '../../shared/observability/protocol.logger.js';
import { timed } from '../../shared/observability/performance.js';
import { requestContext } from '../../shared/observability/request-context.js';
import { discoveryProfileMatchingEnabled, discoveryProfileSource } from '../discovery.env.js';
import { prepLog, scopeLog, resolveLog, type OpportunityGraphDeps, type OpportunityState } from './opportunity.graph.shared.js';

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
        requestedIndexId: state.networkId ?? undefined,
      },
      async () => {
        // Use getNetworkMemberships (all memberships) for search scope — NOT getUserIndexIds
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
        const discoveryUserId = state.onBehalfOfUserId ?? state.userId;
        const [intents, profile] = await Promise.all([
          deps.database.getActiveIntents(discoveryUserId),
          deps.database.getProfile(discoveryUserId),
        ]);
        const indexedIntents: IndexedIntent[] = intents.map((intent: ActiveIntent) => ({
          intentId: intent.id,
          payload: intent.payload,
          summary: intent.summary ?? undefined,
          indexes: [],
        }));
        const sourceProfile = profile
          ? {
              identity: profile.identity ?? undefined,
              context: profile.context ?? undefined,
            }
          : null;
        // Source premises are loaded after scope is resolved so premise discovery
        // only uses premises assigned to the target network(s), and only up to
        // DISCOVERY_SOURCE_PREMISE_LIMIT. Loading all premises here caused
        // BACKEND-5: thousands of parallel vector searches for premise-rich users.
        const sourcePremises: Array<{ premiseId: Id<'premises'>; embedding: number[] }> = [];
        const profileEnabled = discoveryProfileMatchingEnabled();
        // Context-backed discovery is exclusively the user_context profile-source
        // strategy. Premise mode must not load contexts or emit context-to-intent
        // evidence merely because intent matching is also enabled.
        const userContextProfileEnabled = profileEnabled && discoveryProfileSource() === 'user_context';
        const contextToIntentEnabled = userContextProfileEnabled && process.env.DISCOVERY_CONTEXT_TO_INTENT !== '0';
        const contextToContextEnabled = userContextProfileEnabled;
        const rawContexts = (contextToIntentEnabled || contextToContextEnabled) && typeof deps.database.getUserContexts === 'function'
          ? await deps.database.getUserContexts(discoveryUserId)
          : [];
        const sourceContexts = rawContexts
          // The global row (networkId: null) is excluded here — it is not in
          // userNetworkIds — so context-to-intent discovery stays network-scoped.
          .filter((c: { id: string; networkId: string | null; embedding: number[] | null }) => c.embedding && c.embedding.length > 0 && c.networkId !== null && userNetworkIds.includes(c.networkId as Id<'networks'>))
          .map((c: { id: string; networkId: string | null; text: string; embedding: number[] | null }) => ({
            contextId: c.id,
            networkId: c.networkId as Id<'networks'>,
            text: c.text,
            embedding: c.embedding!,
          }));
        return {
          userNetworks: userNetworkIds,
          indexedIntents,
          sourceProfile,
          sourcePremises,
          sourceContexts,
          trace: [{
            node: "prep",
            detail: `${userNetworkIds.length} network(s), ${intents.length} intent(s), premise discovery deferred, ${sourceContexts.length} context(s), ${profile ? 'profile loaded' : 'no profile'}`,
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
  const indexes = r?.userNetworks as unknown[];
  const intents = r?.indexedIntents as unknown[];
  return indexes && intents ? `${indexes.length} index(es), ${intents.length} intent(s)` : undefined;
}

/**
 * Node 1: Scope
 * Determines which indexes to search within.
 * If networkId provided: searches only that index.
 * Otherwise: searches all user's indexes.
 */
export async function scopeNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  return timed("OpportunityGraph.scope", async () => {
    scopeLog.verbose('Determining search scope', {
      requestedIndexId: state.networkId,
      userNetworksCount: state.userNetworks.length,
    });

    try {
      let targetIndexIds: Id<'networks'>[];

      if (state.networkId) {
        // Validate user is member or owner of requested network
        const isInScope = state.userNetworks.includes(state.networkId);
        const isOwner = !isInScope && await deps.database.isIndexOwner(state.networkId, state.userId);
        if (!isInScope && !isOwner) {
          scopeLog.warn('User not member of requested network', {
            networkId: state.networkId,
          });
          return {
            targetNetworks: [],
            error: 'You are not a member of that network.',
          };
        }
        targetIndexIds = [state.networkId];
      } else if (state.indexScope !== undefined) {
        // Bounded scope (e.g. a network-scoped agent's reachable networks):
        // intersect with the user's actual memberships so discovery never
        // reaches networks outside the agent's bound scope. An explicit
        // empty scope is authoritative and must fail closed.
        const allowed = new Set(state.indexScope);
        targetIndexIds = state.userNetworks.filter((n) => allowed.has(n));
        scopeLog.verbose('Applied indexScope intersection', {
          indexScopeCount: state.indexScope.length,
          userNetworksCount: state.userNetworks.length,
          targetCount: targetIndexIds.length,
        });
      } else {
        // Search all user's indexes
        targetIndexIds = state.userNetworks;
      }

      if (state.triggerIntentId) {
        // A trigger intent is an authoritative discovery boundary, not just
        // ranking context. Recompute the intersection at the graph edge so
        // direct chat/MCP callers cannot bypass FromIntentQueue admission.
        const assignedNetworkIds = new Set(
          await deps.database.getNetworkIdsForIntent(state.triggerIntentId),
        );
        const activeOwnerNetworkIds = new Set(state.userNetworks);
        targetIndexIds = targetIndexIds.filter((networkId) =>
          assignedNetworkIds.has(networkId) && activeOwnerNetworkIds.has(networkId),
        );
        scopeLog.verbose('Applied trigger-intent network intersection', {
          triggerIntentId: state.triggerIntentId,
          assignedCount: assignedNetworkIds.size,
          targetCount: targetIndexIds.length,
        });
      }

      // Fetch index details
      const targetNetworks: TargetNetwork[] = await Promise.all(
        targetIndexIds.map(async (networkId) => {
          const index = await deps.database.getNetwork(networkId);
          const memberCount = await deps.database.getNetworkMemberCount(networkId);
          return {
            networkId,
            title: index?.title ?? 'Unknown',
            memberCount,
          };
        })
      );

      scopeLog.verbose('Scope determined', {
        targetIndexesCount: targetNetworks.length,
        indexes: targetNetworks.map(i => i.title),
      });

      // ── Populate index relevancy scores for dedup tie-breaking ──
      const indexRelevancyScores: Record<string, number> = {};

      if (state.triggerIntentId) {
        // Background path: look up persisted scores from intent_indexes
        try {
          const scores = await deps.database.getIntentIndexScores(state.triggerIntentId);
          for (const { networkId, relevancyScore } of scores) {
            if (relevancyScore != null) {
              indexRelevancyScores[networkId] = relevancyScore;
            }
          }
        } catch (err) {
          scopeLog.warn('Failed to load intent index scores', { triggerIntentId: state.triggerIntentId, error: err });
        }
      } else if (state.searchQuery?.trim()) {
        // Chat path: score query against target indexes in parallel
        try {
          const indexer = new IntentIndexer();
          const scopeAgentTimings: DebugMetaAgent[] = [];
          const scorableIndexes = targetNetworks.filter(ti => ti.title !== 'Unknown');
          const scoringPromises = scorableIndexes.map(async (ti) => {
            const ctx = await deps.database.getNetworkMemberContext(ti.networkId, state.userId);
            if (!ctx?.indexPrompt?.trim() && !ctx?.memberPrompt?.trim()) {
              return { networkId: ti.networkId, score: 1.0 };
            }
            const _indexerStart = Date.now();
            const traceEmitter = requestContext.getStore()?.traceEmitter;
            traceEmitter?.({ type: "agent_start", name: "intent-networker" });
            let result: Awaited<ReturnType<typeof indexer.invoke>> | null = null;
            try {
              result = await indexer.invoke(
                state.searchQuery!,
                ctx?.indexPrompt ?? null,
                ctx?.memberPrompt ?? null,
              );
            } catch {
              return { networkId: ti.networkId, score: 1.0 };
            } finally {
              const _indexerDuration = Date.now() - _indexerStart;
              traceEmitter?.({ type: "agent_end", name: "intent-networker", durationMs: _indexerDuration, summary: `Scored index ${ti.networkId}` });
              scopeAgentTimings.push({ name: 'intent.indexer', durationMs: _indexerDuration });
            }
            if (!result) return { networkId: ti.networkId, score: 1.0 };
            const score = ctx?.indexPrompt && ctx?.memberPrompt
              ? result.indexScore * 0.6 + result.memberScore * 0.4
              : ctx?.indexPrompt ? result.indexScore : result.memberScore;
            return { networkId: ti.networkId, score };
          });
          const results = await Promise.all(scoringPromises);
          for (const { networkId, score } of results) {
            indexRelevancyScores[networkId] = score;
          }
          // Accumulate indexer timings into graph state
          if (scopeAgentTimings.length > 0) {
            return {
              targetNetworks,
              indexRelevancyScores,
              agentTimings: scopeAgentTimings,
              trace: [{
                node: "scope",
                detail: `Searching ${targetNetworks.length} index(es): ${targetNetworks.map(i => `${i.title} (${i.memberCount})`).join(', ')}`,
                data: { totalMembers: targetNetworks.reduce((sum, i) => sum + i.memberCount, 0) },
              }],
            };
          }
        } catch (err) {
          scopeLog.warn('Failed to score query against indexes', { error: err });
        }
      }

      const totalMembers = targetNetworks.reduce((sum, i) => sum + i.memberCount, 0);
      return {
        targetNetworks,
        indexRelevancyScores,
        trace: [{
          node: "scope",
          detail: `Searching ${targetNetworks.length} index(es): ${targetNetworks.map(i => `${i.title} (${i.memberCount})`).join(', ')}`,
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
  const indexes = r?.targetNetworks as unknown[];
  return indexes ? `${indexes.length} index(es) in scope` : undefined;
}

/**
 * Node 2: Resolve
 * Resolves trigger intent from triggerIntentId or searchQuery vs indexedIntents;
 * sets discoverySource, resolvedTriggerIntentId, resolvedIntentInIndex for routing (path A/B/C).
 */
export async function resolveNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  return timed("OpportunityGraph.resolve", async () => {
    resolveLog.verbose('Resolving intent and network membership', {
      triggerIntentId: state.triggerIntentId,
      hasSearchQuery: !!state.searchQuery,
      indexedIntentsCount: state.indexedIntents.length,
    });

    const targetIndexIds = state.targetNetworks.map((t) => t.networkId);

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
            resolvedIntentInIndex: false,
            discoverySource: 'context' as const,
            error: 'Trigger intent is not available for discovery.',
          };
        }
        const inNetwork = await deps.database.getNetworkIdsForIntent(state.triggerIntentId);
        const inTarget = inNetwork.some((id) => targetIndexIds.includes(id as Id<'networks'>));
        resolvedIntentId = state.triggerIntentId;
        const resolvedIntentInIndex = inTarget;
        const discoverySource = resolvedIntentInIndex ? ('intent' as const) : ('context' as const);
        return {
          resolvedTriggerIntentId: resolvedIntentId,
          resolvedIntentInIndex,
          discoverySource,
        };
      }

      if (state.searchQuery?.trim() && state.indexedIntents.length > 0) {
        const q = state.searchQuery.trim().toLowerCase();
        const matched = state.indexedIntents.find((i) => i.payload?.toLowerCase().includes(q));
        if (matched) {
          resolvedIntentId = matched.intentId;
          const inNetwork = await deps.database.getNetworkIdsForIntent(matched.intentId);
          const resolvedIntentInIndex = inNetwork.some((id) => targetIndexIds.includes(id as Id<'networks'>));
          const discoverySource = resolvedIntentInIndex ? ('intent' as const) : ('context' as const);
          return {
            resolvedTriggerIntentId: resolvedIntentId,
            resolvedIntentInIndex,
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
        resolvedIntentInIndex: false,
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
        resolvedIntentInIndex: false,
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
