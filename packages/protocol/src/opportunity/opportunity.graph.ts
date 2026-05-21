/**
 * Opportunity Graph: Linear Multi-Step Workflow for Opportunity Discovery
 *
 * Architecture: Follows intent graph pattern with Annotation-based state.
 * Flow: Prep → Scope → Discovery → Evaluation → Ranking → Persist → END
 *
 * Key Constraints:
 * - Opportunities only between intents sharing the same index
 * - Both intents must have hyde documents for semantic matching
 * - Non-indexed intents cannot participate in discovery
 *
 * Constructor injects Database, Embedder, and compiled HyDE graph.
 */

import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import type { Id } from '../shared/interfaces/database.interface.js';
import type { DebugMetaAgent } from '../chat/chat-streaming.types.js';
import {
  OpportunityGraphState,
  type IndexedIntent,
  type SourceProfileData,
  type TargetNetwork,
  type CandidateMatch,
  type EvaluatedCandidate,
  type EvaluatedOpportunity,
  type EvaluatedOpportunityActor,
} from './opportunity.state.js';
import { resolveInitialStatus } from './opportunity.state.js';
import {
  OpportunityEvaluator,
  type CandidateProfile,
  type EvaluatedOpportunityWithActors,
  type EvaluatorEntity,
  type EvaluatorInput,
} from './opportunity.evaluator.js';
import type { OpportunityGraphDatabase } from '../shared/interfaces/database.interface.js';
import { IntentIndexer } from '../intent/intent.indexer.js';
import { getModelName } from '../shared/agent/model.config.js';
import { validateOpportunityActors } from './opportunity.utils.js';

/** Optional evaluator for testing (avoids LLM calls). */
export type OpportunityEvaluatorLike = {
  invoke?: (
    sourceProfileContext: string,
    candidates: CandidateProfile[],
    options: { minScore?: number }
  ) => Promise<Array<{
    sourceId: string;
    candidateId: string;
    score: number;
    reasoning: string;
    valencyRole: 'Agent' | 'Patient' | 'Peer';
  }>>;
  invokeEntityBundle?: (input: EvaluatorInput, options: { minScore?: number }) => Promise<Array<{
    reasoning: string;
    score: number;
    actors: Array<{ userId: string; role: 'agent' | 'patient' | 'peer'; intentId?: string | null }>;
  }>>;
};
import type { Embedder, LensEmbedding } from '../shared/interfaces/embedder.interface.js';
import type {
  CreateOpportunityData,
  Opportunity,
  OpportunityActor,
  ActiveIntent,
} from '../shared/interfaces/database.interface.js';
import { persistOpportunities } from './opportunity.persist.js';
import { INTRODUCER_DISCOVERY_SOURCE } from './opportunity.introducer.js';
import { negotiateCandidates, type NegotiationCandidate, type OnNegotiationResolved } from "../negotiation/negotiation.graph.js";
import { AMBIENT_PARK_WINDOW_MS } from "../negotiation/negotiation.tools.js";
import {
  buildDiscoverySummary,
  toDiscoveryNegotiation,
  type NegotiationResolution,
} from "./negotiation-summary.builder.js";
import type { NegotiationGraphLike } from "../negotiation/negotiation.state.js";
import type { AgentDispatcher } from "../shared/interfaces/agent-dispatcher.interface.js";
import { protocolLogger, withCallLogging } from '../shared/observability/protocol.logger.js';
import { timed } from '../shared/observability/performance.js';
import { requestContext } from "../shared/observability/request-context.js";

const logger = protocolLogger('OpportunityGraph');

/** Time window for persist-node dedup. Parallel jobs arrive within seconds; 10 min catches those while allowing new opportunities for long-connected pairs. */
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

/** Input shape for the HyDE graph invoke call (query-based embedding). */
export interface HydeGeneratorInvokeInput {
  sourceType: 'query';
  sourceText: string;
  forceRegenerate?: boolean;
  profileContext?: string;
}

/** Optional notifier for opportunity send; when omitted, the real queue is used via dynamic import. */
export type QueueOpportunityNotificationFn = (
  opportunityId: string,
  recipientId: string,
  priority: 'immediate' | 'high' | 'low'
) => Promise<unknown>;

/**
 * Builds a compact text summary of the discoverer's profile and active intents
 * for use as profileContext in HyDE generation.
 * @param profile - The discoverer's profile data (identity, attributes)
 * @param intents - The discoverer's indexed intents (capped at 5)
 * @returns A context string, or undefined if no meaningful data is available
 */
export function buildDiscovererContext(
  profile: SourceProfileData | null | undefined,
  intents: IndexedIntent[] | undefined
): string | undefined {
  const lines: string[] = [];

  if (profile) {
    const identity = profile.identity;
    const attrs = profile.attributes;
    if (identity?.name || identity?.bio) {
      lines.push(`Profile: ${[identity.name, identity.bio].filter(Boolean).join(', ')}`);
    }
    if (identity?.location) {
      lines.push(`Location: ${identity.location}`);
    }
    if (attrs?.skills?.length) {
      lines.push(`Skills: ${attrs.skills.join(', ')}`);
    }
    if (attrs?.interests?.length) {
      lines.push(`Interests: ${attrs.interests.join(', ')}`);
    }
  }

  if (intents?.length) {
    // indexedIntents preserves DB order from getActiveIntents (newest first),
    // so slice(0, 5) is deterministic without an explicit sort.
    const capped = intents.slice(0, 5);
    lines.push('');
    lines.push('Active intents:');
    for (const intent of capped) {
      lines.push(`- ${intent.payload}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Factory class to build and compile the Opportunity Graph.
 * Uses dependency injection for testability.
 */
export class OpportunityGraphFactory {
  constructor(
    private database: OpportunityGraphDatabase,
    private embedder: Embedder,
    private hydeGenerator: {
      invoke: (input: HydeGeneratorInvokeInput) => Promise<{
        hydeEmbeddings: Record<string, number[]>;
        lenses?: Array<{ label: string; corpus: 'profiles' | 'intents' }>;
        hydeDocuments?: Record<string, { hydeText?: string; lens?: string }>;
      }>;
    },
    private optionalEvaluator?: OpportunityEvaluatorLike,
    private queueNotification?: QueueOpportunityNotificationFn,
    private negotiationGraph?: NegotiationGraphLike,
    /**
     * Used on the chat path to decide whether to wait for the user's personal
     * agent (long timeout) or fall back to the system agent immediately
     * (short timeout). Without it, the chat path always uses a short timeout.
     */
    private agentDispatcher?: Pick<AgentDispatcher, 'hasPersonalAgent'>,
    /**
     * Callback to enqueue a negotiate_existing job for an opportunity.
     * When provided, negotiate_existing mode uses this to queue follow-up
     * negotiations after introducer approval.
     */
    private queueNegotiateExisting?: (opportunityId: string, userId: string) => Promise<void>,
  ) {}

  public createGraph() {
    const evaluatorAgent = this.optionalEvaluator ?? new OpportunityEvaluator();

    // ═══════════════════════════════════════════════════════════════
    // NODE DEFINITIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Wraps a graph node function to emit agent_start/agent_end trace events
     * at its boundaries so the frontend TRACE panel shows real-time progress.
     * @param traceName - Kebab-case agent name (e.g. "opportunity-prep")
     * @param nodeFn - The original node function
     * @param summaryFn - Optional function to derive a summary string from the node result
     */
    function withNodeTrace<S, R>(
      traceName: string,
      nodeFn: (state: S) => Promise<R>,
      summaryFn?: (result: R) => string | undefined,
    ): (state: S) => Promise<R> {
      return async (state: S) => {
        const traceEmitter = requestContext.getStore()?.traceEmitter;
        const nodeStart = Date.now();
        traceEmitter?.({ type: "agent_start", name: traceName });
        try {
          const result = await nodeFn(state);
          const durationMs = Date.now() - nodeStart;
          const summary = summaryFn?.(result) ?? undefined;
          traceEmitter?.({ type: "agent_end", name: traceName, durationMs, summary });
          return result;
        } catch (err) {
          const durationMs = Date.now() - nodeStart;
          const errMsg = err instanceof Error ? err.message : String(err);
          traceEmitter?.({ type: "agent_end", name: traceName, durationMs, summary: `error: ${errMsg}` });
          throw err;
        }
      };
    }

    /**
     * Node 0: Prep
     * Fetches user's index memberships and validates requirements.
     * Returns empty if user has no index memberships (requirement).
     */
    const prepNode = withNodeTrace(
      "opportunity-prep",
      async (state: typeof OpportunityGraphState.State) =>
      timed("OpportunityGraph.prep", async () =>
        withCallLogging(
          logger,
          '[Graph:Prep] prepNode',
          {
            userId: state.userId,
            hasSearchQuery: !!state.searchQuery,
            requestedIndexId: state.networkId ?? undefined,
          },
          async () => {
            // Use getNetworkMemberships (all memberships) for search scope — NOT getUserIndexIds
            // (which filters by autoAssign=true and is intended only for intent assignment).
            const memberships = await this.database.getNetworkMemberships(state.userId);
            const userNetworkIds = memberships.map(m => m.networkId) as Id<'networks'>[];
            if (userNetworkIds.length === 0) {
              logger.verbose('[Graph:Prep] User has no network memberships - cannot find opportunities');
              return {
                userNetworks: [] as Id<'networks'>[],
                sourceProfile: null,
                error: 'You need to join at least one network to find opportunities.',
              };
            }
            const discoveryUserId = state.onBehalfOfUserId ?? state.userId;
            const [intents, profile] = await Promise.all([
              this.database.getActiveIntents(discoveryUserId),
              this.database.getProfile(discoveryUserId),
            ]);
            const indexedIntents: IndexedIntent[] = intents.map((intent: ActiveIntent) => ({
              intentId: intent.id,
              payload: intent.payload,
              summary: intent.summary ?? undefined,
              indexes: [],
            }));
            const sourceProfile = profile
              ? {
                  embedding: profile.embedding ?? null,
                  identity: profile.identity ?? undefined,
                  narrative: profile.narrative ?? undefined,
                  attributes: profile.attributes ?? undefined,
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
          logger.error('[Graph:Prep] Failed', { error });
          return {
            error: 'Failed to prepare opportunity search. Please try again.',
            trace: [{
              node: "prep_fatal",
              detail: `Prep failed: ${errMsg}`,
              data: { error: errMsg },
            }],
          };
        })
      ),
      (result) => {
        const r = result as Record<string, unknown>;
        if (r?.error) return `error: ${r.error}`;
        const indexes = r?.userNetworks as unknown[];
        const intents = r?.indexedIntents as unknown[];
        return indexes && intents ? `${indexes.length} index(es), ${intents.length} intent(s)` : undefined;
      },
    );

    /**
     * Node 1: Scope
     * Determines which indexes to search within.
     * If networkId provided: searches only that index.
     * Otherwise: searches all user's indexes.
     */
    const scopeNode = withNodeTrace(
      "opportunity-scope",
      async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.scope", async () => {
        logger.verbose('[Graph:Scope] Determining search scope', {
          requestedIndexId: state.networkId,
          userNetworksCount: state.userNetworks.length,
        });

        try {
          let targetIndexIds: Id<'networks'>[];

          if (state.networkId) {
            // Validate user is member or owner of requested network
            const isInScope = state.userNetworks.includes(state.networkId);
            const isOwner = !isInScope && await this.database.isIndexOwner(state.networkId, state.userId);
            if (!isInScope && !isOwner) {
              logger.warn('[Graph:Scope] User not member of requested network', {
                networkId: state.networkId,
              });
              return {
                targetNetworks: [],
                error: 'You are not a member of that network.',
              };
            }
            targetIndexIds = [state.networkId];
          } else {
            // Search all user's indexes
            targetIndexIds = state.userNetworks;
          }

          // Fetch index details
          const targetNetworks: TargetNetwork[] = await Promise.all(
            targetIndexIds.map(async (networkId) => {
              const index = await this.database.getNetwork(networkId);
              const memberCount = await this.database.getNetworkMemberCount(networkId);
              return {
                networkId,
                title: index?.title ?? 'Unknown',
                memberCount,
              };
            })
          );

          logger.verbose('[Graph:Scope] Scope determined', {
            targetIndexesCount: targetNetworks.length,
            indexes: targetNetworks.map(i => i.title),
          });

          // ── Populate index relevancy scores for dedup tie-breaking ──
          let indexRelevancyScores: Record<string, number> = {};

          if (state.triggerIntentId) {
            // Background path: look up persisted scores from intent_indexes
            try {
              const scores = await this.database.getIntentIndexScores(state.triggerIntentId);
              for (const { networkId, relevancyScore } of scores) {
                if (relevancyScore != null) {
                  indexRelevancyScores[networkId] = relevancyScore;
                }
              }
            } catch (err) {
              logger.warn('[Graph:Scope] Failed to load intent index scores', { triggerIntentId: state.triggerIntentId, error: err });
            }
          } else if (state.searchQuery?.trim()) {
            // Chat path: score query against target indexes in parallel
            try {
              const indexer = new IntentIndexer();
              const scopeAgentTimings: DebugMetaAgent[] = [];
              const scorableIndexes = targetNetworks.filter(ti => ti.title !== 'Unknown');
              const scoringPromises = scorableIndexes.map(async (ti) => {
                const ctx = await this.database.getNetworkMemberContext(ti.networkId, state.userId);
                if (!ctx?.indexPrompt?.trim() && !ctx?.memberPrompt?.trim()) {
                  return { networkId: ti.networkId, score: 1.0 };
                }
                const _indexerStart = Date.now();
                const traceEmitter = requestContext.getStore()?.traceEmitter;
                traceEmitter?.({ type: "agent_start", name: "intent-indexer" });
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
                  traceEmitter?.({ type: "agent_end", name: "intent-indexer", durationMs: _indexerDuration, summary: `Scored index ${ti.networkId}` });
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
              logger.warn('[Graph:Scope] Failed to score query against indexes', { error: err });
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
          logger.error('[Graph:Scope] Failed', { error });
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
    },
      (result) => {
        const r = result as Record<string, unknown>;
        if (r?.error) return `error: ${r.error}`;
        const indexes = r?.targetNetworks as unknown[];
        return indexes ? `${indexes.length} index(es) in scope` : undefined;
      },
    );

    /**
     * Node 2: Resolve
     * Resolves trigger intent from triggerIntentId or searchQuery vs indexedIntents;
     * sets discoverySource, resolvedTriggerIntentId, resolvedIntentInIndex for routing (path A/B/C).
     */
    const resolveNode = withNodeTrace(
      "opportunity-resolve",
      async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.resolve", async () => {
        logger.verbose('[Graph:Resolve] Resolving intent and index membership', {
          triggerIntentId: state.triggerIntentId,
          hasSearchQuery: !!state.searchQuery,
          indexedIntentsCount: state.indexedIntents.length,
        });

        const targetIndexIds = state.targetNetworks.map((t) => t.networkId);

        try {
          let resolvedIntentId: Id<'intents'> | undefined;
          if (state.triggerIntentId) {
            const inNetwork = await this.database.getNetworkIdsForIntent(state.triggerIntentId);
            const inTarget = inNetwork.some((id) => targetIndexIds.includes(id as Id<'networks'>));
            resolvedIntentId = state.triggerIntentId;
            const resolvedIntentInIndex = inTarget;
            const discoverySource = resolvedIntentInIndex ? ('intent' as const) : ('profile' as const);
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
              const inNetwork = await this.database.getNetworkIdsForIntent(matched.intentId);
              const resolvedIntentInIndex = inNetwork.some((id) => targetIndexIds.includes(id as Id<'networks'>));
              const discoverySource = resolvedIntentInIndex ? ('intent' as const) : ('profile' as const);
              return {
                resolvedTriggerIntentId: resolvedIntentId,
                resolvedIntentInIndex,
                discoverySource,
              };
            }
            logger.warn('[Graph:Resolve] No intent matched search query; leaving resolvedIntentId unset', {
              searchQuery: state.searchQuery,
              indexedIntentsCount: state.indexedIntents.length,
            });
          }

          return {
            resolvedTriggerIntentId: undefined,
            resolvedIntentInIndex: false,
            discoverySource: 'profile' as const,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('[Graph:Resolve] Failed', {
            triggerIntentId: state.triggerIntentId,
            searchQuery: state.searchQuery,
            error: err,
          });
          return {
            resolvedTriggerIntentId: undefined,
            resolvedIntentInIndex: false,
            discoverySource: 'profile' as const,
            error: errMsg || 'Resolve failed',
            trace: [{
              node: "resolve_fatal",
              detail: `Resolve failed: ${errMsg}`,
              data: { error: errMsg },
            }],
          };
        }
      });
    },
      (result) => {
        const r = result as Record<string, unknown>;
        if (r?.error) return `error: ${r.error}`;
        return r?.discoverySource ? `source: ${r.discoverySource}` : undefined;
      },
    );

    /**
     * Node 3: Discovery
     * Generates HyDE embeddings and performs semantic search (path A), or profile-as-source search (path B/C).
     */
    const discoveryNode = withNodeTrace(
      "opportunity-discovery",
      async (state: typeof OpportunityGraphState.State) => {
      const self = this;
      return timed("OpportunityGraph.discovery", async () => {
        const startTime = Date.now();
        const discoveryUserId = state.onBehalfOfUserId ?? state.userId;

        /** Filter candidates to targetUserId when set (direct-connection mode). */
        const filterByTarget = (candidates: CandidateMatch[]): CandidateMatch[] => {
          if (!state.targetUserId) return candidates;
          const filtered = candidates.filter(c => c.candidateUserId === state.targetUserId);
          logger.verbose('[Graph:Discovery] targetUserId filter applied', {
            targetUserId: state.targetUserId,
            before: candidates.length,
            after: filtered.length,
          });
          return filtered;
        };

        // Shared variable to capture lens input data from runQueryHydeDiscovery or intent path
        let discoveryLensInput: { profileContext: string | undefined; model: string } | undefined;
        // Shared variable to capture HyDE output (lenses + documents) for trace entries
        let discoveryHydeOutput: { lenses: Array<{ label: string; corpus: string }>; hydeDocuments: Record<string, { hydeText?: string }> } | undefined;

        logger.verbose('[Graph:Discovery] Starting semantic search', {
          targetIndexesCount: state.targetNetworks.length,
          discoverySource: state.discoverySource,
          searchQueryPreview: state.searchQuery?.trim().slice(0, 60) ?? '(none)',
        });

        try {
          if (state.targetNetworks.length === 0) {
            logger.warn('[Graph:Discovery] No target indexes for search');
            return { candidates: [] };
          }

          // ── Direct-connection fast path ──
          // When targetUserId is set (user @-mentioned someone), bypass vector search
          // and construct candidates directly from shared indexes.
          if (state.targetUserId) {
            if (state.targetUserId === discoveryUserId) {
              logger.warn('[Graph:Discovery] Direct-connection target matches discoverer; skipping self-match', {
                targetUserId: state.targetUserId,
              });
              return {
                candidates: [],
                trace: [{
                  node: "discovery",
                  detail: "Direct connection skipped: target user is discoverer",
                  data: { targetUserId: state.targetUserId },
                }],
              };
            }
            logger.verbose('[Graph:Discovery] Direct-connection mode — bypassing vector search', {
              targetUserId: state.targetUserId,
            });
            const targetMemberships = await this.database.getNetworkMemberships(state.targetUserId);
            const targetUserIndexIds = targetMemberships.map(m => m.networkId);
            const sharedIndexIds = state.targetNetworks
              .filter(ti => targetUserIndexIds.includes(ti.networkId))
              .map(ti => ti.networkId);

            if (sharedIndexIds.length === 0) {
              logger.warn('[Graph:Discovery] Target user shares no indexes with discoverer', {
                targetUserId: state.targetUserId,
                discovererIndexes: state.targetNetworks.map(ti => ti.networkId),
              });
              return {
                candidates: [],
                trace: [{
                  node: "discovery",
                  detail: `Direct connection: target user shares no indexes`,
                  data: { targetUserId: state.targetUserId },
                }],
              };
            }

            // Fetch target user's active intents to build intent-level candidates
            const targetIntents = await this.database.getActiveIntents(state.targetUserId);
            const directCandidates: CandidateMatch[] = [];

            if (targetIntents.length > 0) {
              // Build one candidate per intent per shared index it belongs to
              for (const intent of targetIntents) {
                const intentNetworkIds = await this.database.getNetworkIdsForIntent(intent.id);
                const overlapping = sharedIndexIds.filter(id => intentNetworkIds.includes(id));
                for (const networkId of overlapping) {
                  directCandidates.push({
                    candidateUserId: state.targetUserId,
                    candidateIntentId: intent.id as Id<'intents'>,
                    networkId,
                    similarity: 1.0,
                    lens: 'explicit_mention',
                    candidatePayload: intent.payload,
                    candidateSummary: intent.summary ?? undefined,
                    discoverySource: 'query',
                  });
                }
              }
            }

            // Always add a profile-level candidate (so evaluation runs even without intents)
            if (directCandidates.length === 0) {
              directCandidates.push({
                candidateUserId: state.targetUserId,
                candidateIntentId: undefined,
                networkId: sharedIndexIds[0] as Id<'networks'>,
                similarity: 1.0,
                lens: 'explicit_mention',
                candidatePayload: '',
                candidateSummary: undefined,
                discoverySource: 'query',
              });
            }

            logger.verbose('[Graph:Discovery] Direct candidates constructed', {
              count: directCandidates.length,
              sharedIndexes: sharedIndexIds.length,
              targetIntents: targetIntents.length,
            });

            return {
              candidates: directCandidates,
              trace: [{
                node: "discovery",
                detail: `Direct connection → ${directCandidates.length} candidate(s) from ${sharedIndexIds.length} shared index(es)`,
                data: {
                  targetUserId: state.targetUserId,
                  candidateCount: directCandidates.length,
                  sharedIndexes: sharedIndexIds.length,
                  durationMs: Date.now() - startTime,
                },
              }],
            };
          }

          // Search limits - fixed values for candidate retrieval
          // (The options.limit controls final output, not search pool)
          const limitPerStrategy = 30;
          const perIndexLimit = 80;
          // Similarity threshold for recall (0.30 = 30% similarity)
          const minScore = 0.3;

          if (state.discoverySource === 'profile') {
            const embedding = state.sourceProfile?.embedding ?? null;
            const vector = Array.isArray(embedding) && embedding.length > 0 && typeof embedding[0] === 'number'
              ? (embedding as number[])
              : Array.isArray(embedding) && Array.isArray(embedding[0])
                ? (embedding[0] as number[])
                : null;

            // ALWAYS run query-based HyDE when we have a search query (e.g., "looking for investors")
            // This ensures we use the right strategies (investor, mentor, etc.) not just mirror
            if (state.searchQuery?.trim()) {
              logger.verbose('[Graph:Discovery] Profile source with searchQuery → running query HyDE path for broader search', {
                searchQuery: state.searchQuery.trim().substring(0, 80),
                hasProfileVector: !!vector,
              });
              const queryCandidates = await runQueryHydeDiscovery();
              logger.verbose('[Graph:Discovery] Query HyDE path complete', { candidatesFound: queryCandidates.length });
              
              // Build trace entries for this path
              const traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> = [];

              // Lens input trace (captured from runQueryHydeDiscovery)
              if (discoveryLensInput) {
                traceEntries.push({
                  node: "lens_input",
                  detail: "Profile context for lens inference",
                  data: discoveryLensInput,
                });
              }

              // Lens output and HyDE document traces (captured from runQueryHydeDiscovery)
              if (discoveryHydeOutput) {
                if (discoveryHydeOutput.lenses.length > 0) {
                  traceEntries.push({
                    node: "lens_output",
                    detail: `Inferred ${discoveryHydeOutput.lenses.length} lens(es): ${discoveryHydeOutput.lenses.map(l => l.label).join(', ')}`,
                    data: { lenses: discoveryHydeOutput.lenses, model: getModelName("lensInferrer") },
                  });
                }
                for (const [lens, doc] of Object.entries(discoveryHydeOutput.hydeDocuments)) {
                  if (doc?.hydeText) {
                    traceEntries.push({
                      node: "hyde_query",
                      detail: `[${lens}] "${doc.hydeText.slice(0, 120)}${doc.hydeText.length > 120 ? '...' : ''}"`,
                      data: { lens, hydeTextPreview: doc.hydeText.slice(0, 300) + (doc.hydeText.length > 300 ? '...' : '') },
                    });
                  }
                }
              }

              // Compute per-lens stats from deduped candidates
              const lensStats: Record<string, { count: number; avgSimilarity: number }> = {};
              for (const c of queryCandidates) {
                const s = c.lens || 'unknown';
                if (!lensStats[s]) lensStats[s] = { count: 0, avgSimilarity: 0 };
                lensStats[s].count++;
                lensStats[s].avgSimilarity += c.similarity;
              }
              for (const s of Object.values(lensStats)) {
                s.avgSimilarity = s.count > 0 ? Math.round((s.avgSimilarity / s.count) * 1000) / 1000 : 0;
              }

              traceEntries.push({
                node: "discovery",
                detail: `HyDE search → ${queryCandidates.length} candidate(s) from query path`,
                data: {
                  candidateCount: queryCandidates.length,
                  byLens: lensStats,
                  searchQuery: state.searchQuery?.trim().slice(0, 80),
                  durationMs: Date.now() - startTime,
                  model: getModelName("hydeGenerator"),
                },
              });
              
              // If we also have a profile vector, merge with profile-based results
              if (vector && vector.length > 0) {
                const profileCandidates: CandidateMatch[] = [];
                for (const targetIndex of state.targetNetworks) {
                  const results = await this.embedder.searchWithProfileEmbedding(vector, {
                    indexScope: [targetIndex.networkId],
                    excludeUserId: discoveryUserId,
                    limitPerStrategy: Math.floor(limitPerStrategy / 2),
                    limit: Math.floor(perIndexLimit / 2),
                    minScore,
                  });
                  for (const result of results) {
                    profileCandidates.push({
                      candidateUserId: result.userId as Id<'users'>,
                      candidateIntentId: result.type === 'intent' ? result.id as Id<'intents'> : undefined,
                      networkId: targetIndex.networkId,
                      similarity: result.score,
                      lens: result.matchedVia,
                      candidatePayload: '',
                      candidateSummary: undefined,
                      discoverySource: 'profile-similarity' as const,
                    });
                  }
                }
                // Merge and dedupe - keep both intent and profile candidates per user
                const byKey = new Map<string, CandidateMatch>();
                for (const c of [...queryCandidates, ...profileCandidates]) {
                  const key = `${c.candidateUserId}:${c.networkId}:${c.candidateIntentId ?? 'profile'}:${c.discoverySource ?? 'unknown'}`;
                  if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
                    byKey.set(key, c);
                  }
                }
                const merged = Array.from(byKey.values());
                logger.verbose('[Graph:Discovery] Merged HyDE + profile candidates', { 
                  hydeCandidates: queryCandidates.length, 
                  profileCandidates: profileCandidates.length,
                  merged: merged.length 
                });
                
                traceEntries.push({
                  node: "discovery",
                  detail: `+ Profile search → ${profileCandidates.length} additional, merged to ${merged.length}`,
                  data: {
                    profileCandidates: profileCandidates.length,
                    merged: merged.length,
                  },
                });
                
                return { candidates: filterByTarget(merged), trace: traceEntries };
              }

              return { candidates: filterByTarget(queryCandidates), trace: traceEntries };
            }

            // No search query - use profile embedding directly (mirror-only)
            if (!vector || vector.length === 0) {
              return { candidates: [] };
            }
            const allCandidates: CandidateMatch[] = [];
            for (const targetIndex of state.targetNetworks) {
              const results = await this.embedder.searchWithProfileEmbedding(vector, {
                indexScope: [targetIndex.networkId],
                excludeUserId: discoveryUserId,
                limitPerStrategy,
                limit: perIndexLimit,
                minScore,
              });
              for (const result of results) {
                if (result.type === 'intent') {
                  allCandidates.push({
                    candidateUserId: result.userId as Id<'users'>,
                    candidateIntentId: result.id as Id<'intents'>,
                    networkId: targetIndex.networkId,
                    similarity: result.score,
                    lens: result.matchedVia,
                    candidatePayload: '',
                    candidateSummary: undefined,
                    discoverySource: 'profile-similarity' as const,
                  });
                } else {
                  allCandidates.push({
                    candidateUserId: result.userId as Id<'users'>,
                    networkId: targetIndex.networkId,
                    similarity: result.score,
                    lens: result.matchedVia,
                    candidatePayload: '',
                    candidateSummary: undefined,
                    discoverySource: 'profile-similarity' as const,
                  });
                }
              }
            }
            const byUserAndIndex = new Map<string, CandidateMatch>();
            for (const c of allCandidates) {
              const key = `${c.candidateUserId}:${c.networkId}:${c.candidateIntentId ?? 'profile'}`;
              if (!byUserAndIndex.has(key) || c.similarity > (byUserAndIndex.get(key)?.similarity ?? 0)) {
                byUserAndIndex.set(key, c);
              }
            }
            const candidates = Array.from(byUserAndIndex.values());
            logger.verbose('[Graph:Discovery] Profile-as-source discovery complete', { candidatesFound: candidates.length });

            // Build trace with individual candidate similarity scores
            const traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> = [];

            // Show what the profile search is based on
            const profileBio = state.sourceProfile?.identity?.bio;
            const profileContext = state.sourceProfile?.narrative?.context;
            const profileSummary = profileBio || profileContext || '(profile embedding)';

            // Compute per-lens stats from deduped candidates
            const lensStats: Record<string, { count: number; avgSimilarity: number }> = {};
            for (const c of candidates) {
              const s = c.lens || 'unknown';
              if (!lensStats[s]) lensStats[s] = { count: 0, avgSimilarity: 0 };
              lensStats[s].count++;
              lensStats[s].avgSimilarity += c.similarity;
            }
            for (const s of Object.values(lensStats)) {
              s.avgSimilarity = s.count > 0 ? Math.round((s.avgSimilarity / s.count) * 1000) / 1000 : 0;
            }

            traceEntries.push({
              node: "discovery",
              detail: `Profile-based search → ${candidates.length} candidate(s)`,
              data: {
                source: "profile",
                candidateCount: candidates.length,
                byLens: lensStats,
                durationMs: Date.now() - startTime,
              },
            });

            traceEntries.push({
              node: "search_query",
              detail: `Searching for matches to: "${profileSummary.slice(0, 150)}${profileSummary.length > 150 ? '...' : ''}"`,
              data: {
                type: "profile_embedding",
                bio: profileBio,
                context: profileContext,
              },
            });

            // Add top candidates with similarity scores
            const sortedCandidates = [...candidates].sort((a, b) => b.similarity - a.similarity).slice(0, 10);
            for (const c of sortedCandidates) {
              traceEntries.push({
                node: "match",
                detail: `Similarity ${Math.round(c.similarity * 100)}% via ${c.lens}`,
                data: {
                  userId: c.candidateUserId,
                  similarity: Math.round(c.similarity * 100),
                  lens: c.lens,
                  hasIntent: !!c.candidateIntentId,
                },
              });
            }

            return {
              candidates: filterByTarget(candidates),
              trace: traceEntries,
            };
          }

          async function runQueryHydeDiscovery(): Promise<CandidateMatch[]> {
            const searchText = state.searchQuery?.trim() ?? '';
            if (!searchText) return [];
            logger.verbose('[Graph:Discovery] runQueryHydeDiscovery start', { searchText: searchText.slice(0, 80) });
            const discovererContext = buildDiscovererContext(state.sourceProfile, state.indexedIntents);
            discoveryLensInput = {
              profileContext: discovererContext,
              model: getModelName("lensInferrer"),
            };
            const hydeResult = await self.hydeGenerator.invoke({
              sourceType: 'query',
              sourceText: searchText,
              forceRegenerate: false,
              profileContext: discovererContext,
            });
            const hydeEmbeddings = hydeResult.hydeEmbeddings as Record<string, number[]>;
            const lenses = hydeResult.lenses ?? [];
            discoveryHydeOutput = {
              lenses: lenses as Array<{ label: string; corpus: string }>,
              hydeDocuments: (hydeResult.hydeDocuments ?? {}) as Record<string, { hydeText?: string }>,
            };
            const embeddingKeys = hydeEmbeddings ? Object.keys(hydeEmbeddings) : [];
            logger.verbose('[Graph:Discovery] HyDE generator result', {
              lensCount: embeddingKeys.length,
              lenses: embeddingKeys,
            });
            if (!hydeEmbeddings || Object.keys(hydeEmbeddings).length === 0) return [];
            const lensMap = new Map(lenses.map(l => [l.label, l]));
            const lensEmbeddings: LensEmbedding[] = [];
            for (const [label, emb] of Object.entries(hydeEmbeddings)) {
              if (emb?.length) {
                const lens = lensMap.get(label);
                lensEmbeddings.push({ lens: label, corpus: lens?.corpus ?? 'profiles', embedding: emb });
              }
            }
            const all: CandidateMatch[] = [];
            await Promise.all(
              state.targetNetworks.map(async (targetIndex) => {
                const results = await self.embedder.searchWithHydeEmbeddings(lensEmbeddings, {
                  indexScope: [targetIndex.networkId],
                  excludeUserId: discoveryUserId,
                  limitPerStrategy,
                  limit: perIndexLimit,
                  minScore,
                });
                for (const r of results.filter((x) => x.type === 'intent')) {
                  all.push({
                    candidateUserId: r.userId as Id<'users'>,
                    candidateIntentId: r.id as Id<'intents'>,
                    networkId: targetIndex.networkId,
                    similarity: r.score,
                    lens: r.matchedVia,
                    candidatePayload: '',
                    candidateSummary: undefined,
                    discoverySource: 'query' as const,
                  });
                }
                for (const r of results.filter((x) => x.type === 'profile')) {
                  all.push({
                    candidateUserId: r.userId as Id<'users'>,
                    networkId: targetIndex.networkId,
                    similarity: r.score,
                    lens: r.matchedVia,
                    candidatePayload: '',
                    candidateSummary: undefined,
                    discoverySource: 'query' as const,
                  });
                }
              })
            );
            const profileCount = all.filter((c) => !c.candidateIntentId).length;
            const intentCount = all.filter((c) => c.candidateIntentId).length;
            logger.verbose('[Graph:Discovery] searchWithHydeEmbeddings raw results', {
              total: all.length,
              fromProfile: profileCount,
              fromIntent: intentCount,
            });
            const byKey = new Map<string, CandidateMatch>();
            for (const c of all) {
              // Dedup by candidateUserId + intent (or profile), NOT by indexId.
              // Including indexId caused the same user to appear once per index they belong to.
              const key = `${c.candidateUserId}:${c.candidateIntentId ?? 'profile'}`;
              if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
                byKey.set(key, c);
              }
            }
            return Array.from(byKey.values());
          }

          const resolvedIntent = state.resolvedTriggerIntentId
            ? state.indexedIntents.find((i) => i.intentId === state.resolvedTriggerIntentId)
            : state.indexedIntents[0];
          const searchText = state.searchQuery ?? resolvedIntent?.payload ?? '';
          if (!searchText) {
            logger.warn('[Graph:Discovery] No search text available for intent path');
            return { candidates: [] };
          }

          const discovererContext = buildDiscovererContext(state.sourceProfile, state.indexedIntents);
          discoveryLensInput = {
            profileContext: discovererContext,
            model: getModelName("lensInferrer"),
          };
          const hydeResult = await this.hydeGenerator.invoke({
            sourceType: 'query',
            sourceText: searchText,
            forceRegenerate: false,
            profileContext: discovererContext,
          });
          const hydeEmbeddings = hydeResult.hydeEmbeddings as Record<string, number[]>;
          const lenses = hydeResult.lenses ?? [];
          if (!hydeEmbeddings || Object.keys(hydeEmbeddings).length === 0) {
            return { hydeEmbeddings: {} as Record<string, number[]>, candidates: [] };
          }
          const lensMap = new Map(lenses.map(l => [l.label, l]));
          const lensEmbeddings: LensEmbedding[] = [];
          for (const [label, emb] of Object.entries(hydeEmbeddings)) {
            if (emb?.length) {
              const lens = lensMap.get(label);
              lensEmbeddings.push({ lens: label, corpus: lens?.corpus ?? 'profiles', embedding: emb });
            }
          }
          const allCandidates: CandidateMatch[] = [];
          await Promise.all(
            state.targetNetworks.map(async (targetIndex) => {
              const results = await this.embedder.searchWithHydeEmbeddings(lensEmbeddings, {
                indexScope: [targetIndex.networkId],
                excludeUserId: discoveryUserId,
                limitPerStrategy,
                limit: perIndexLimit,
                minScore,
              });
              for (const result of results.filter((r) => r.type === 'intent')) {
                allCandidates.push({
                  candidateUserId: result.userId as Id<'users'>,
                  candidateIntentId: result.id as Id<'intents'>,
                  networkId: targetIndex.networkId,
                  similarity: result.score,
                  lens: result.matchedVia,
                  candidatePayload: '',
                  candidateSummary: undefined,
                  discoverySource: 'query' as const,
                });
              }
              for (const result of results.filter((r) => r.type === 'profile')) {
                allCandidates.push({
                  candidateUserId: result.userId as Id<'users'>,
                  networkId: targetIndex.networkId,
                  similarity: result.score,
                  lens: result.matchedVia,
                  candidatePayload: '',
                  candidateSummary: undefined,
                  discoverySource: 'query' as const,
                });
              }
            })
          );
          const byUserAndIndex = new Map<string, CandidateMatch>();
          for (const c of allCandidates) {
            const key = `${c.candidateUserId}:${c.networkId}:${c.candidateIntentId ?? 'profile'}`;
            if (!byUserAndIndex.has(key) || c.similarity > (byUserAndIndex.get(key)?.similarity ?? 0)) {
              byUserAndIndex.set(key, c);
            }
          }
          const candidates = Array.from(byUserAndIndex.values());
          logger.verbose('[Graph:Discovery] Intent-path discovery complete', { candidatesFound: candidates.length });
          const usedLenses = Object.keys(hydeEmbeddings);

          // Build trace with individual candidate similarity scores
          const traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> = [];

          // Lens input trace
          if (discoveryLensInput) {
            traceEntries.push({
              node: "lens_input",
              detail: "Profile context for lens inference",
              data: discoveryLensInput,
            });
          }

          // Lens output trace
          if (lenses.length > 0) {
            traceEntries.push({
              node: "lens_output",
              detail: `Inferred ${lenses.length} lens(es): ${lenses.map(l => l.label).join(', ')}`,
              data: { lenses, model: getModelName("lensInferrer") },
            });
          }

          // Compute per-lens stats from deduped candidates
          const lensStats: Record<string, { count: number; avgSimilarity: number }> = {};
          for (const c of candidates) {
            const s = c.lens || 'unknown';
            if (!lensStats[s]) lensStats[s] = { count: 0, avgSimilarity: 0 };
            lensStats[s].count++;
            lensStats[s].avgSimilarity += c.similarity;
          }
          for (const s of Object.values(lensStats)) {
            s.avgSimilarity = s.count > 0 ? Math.round((s.avgSimilarity / s.count) * 1000) / 1000 : 0;
          }

          traceEntries.push({
            node: "discovery",
            detail: `Query: "${searchText.slice(0, 50)}${searchText.length > 50 ? '...' : ''}" → ${candidates.length} candidate(s)`,
            data: {
              query: searchText.slice(0, 100),
              lenses: usedLenses,
              candidateCount: candidates.length,
              byLens: lensStats,
              durationMs: Date.now() - startTime,
              model: getModelName("hydeGenerator"),
            },
          });

          // Show the HyDE-generated hypothetical documents used for search
          const hydeDocuments = hydeResult.hydeDocuments;
          if (hydeDocuments) {
            for (const [lens, doc] of Object.entries(hydeDocuments)) {
              if (doc?.hydeText) {
                traceEntries.push({
                  node: "hyde_query",
                  detail: `[${lens}] "${doc.hydeText.slice(0, 120)}${doc.hydeText.length > 120 ? '...' : ''}"`,
                  data: {
                    lens,
                    hydeTextPreview: doc.hydeText.slice(0, 160) + (doc.hydeText.length > 160 ? '...' : ''),
                  },
                });
              }
            }
          }

          // Add top candidates with similarity scores
          const sortedCandidates = [...candidates].sort((a, b) => b.similarity - a.similarity).slice(0, 10);
          for (const c of sortedCandidates) {
            traceEntries.push({
              node: "match",
              detail: `Similarity ${Math.round(c.similarity * 100)}% via ${c.lens}`,
              data: {
                userId: c.candidateUserId,
                similarity: Math.round(c.similarity * 100),
                lens: c.lens,
                hasIntent: !!c.candidateIntentId,
              },
            });
          }

          return {
            hydeEmbeddings: hydeEmbeddings as Record<string, number[]>,
            candidates: filterByTarget(candidates),
            trace: traceEntries,
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error('[Graph:Discovery] Failed', { error });
          return {
            candidates: [],
            error: 'Failed to search for candidates.',
            trace: [{
              node: "discovery_fatal",
              detail: `Discovery failed: ${errMsg}`,
              data: { error: errMsg },
            }],
          };
        }
      });
    },
      (result) => {
        const r = result as Record<string, unknown>;
        if (r?.error) return `error: ${r.error}`;
        const candidates = r?.candidates as unknown[];
        return candidates ? `Found ${candidates.length} candidate(s)` : undefined;
      },
    );

    /**
     * Node 3: Evaluation (Entity bundle)
     * Builds entity bundle from source + candidates, invokes entity-bundle evaluator, maps to EvaluatedOpportunity with networkId from entities.
     */
    const evaluationNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.evaluation", async () => {
        const startTime = Date.now();
        logger.verbose('[Graph:Evaluation] Starting evaluation', {
          candidatesCount: state.candidates.length,
        });

        if (state.candidates.length === 0) {
          logger.verbose('[Graph:Evaluation] No candidates to evaluate');
          return { evaluatedOpportunities: [], agentTimings: [] };
        }

        // Batch candidates to avoid timeout - evaluate top 25 per batch, store remaining
        const EVAL_BATCH_SIZE = 25;
        const sortedCandidates = [...state.candidates]
          .sort((a, b) => b.similarity - a.similarity);

        // Dedup by userId — when same similarity, prefer index with highest relevancyScore
        const bestByUser = new Map<string, CandidateMatch>();
        for (const c of sortedCandidates) {
          const existing = bestByUser.get(c.candidateUserId);
          if (!existing) {
            bestByUser.set(c.candidateUserId, c);
          } else if (c.similarity > existing.similarity) {
            bestByUser.set(c.candidateUserId, c);
          } else if (c.similarity === existing.similarity) {
            // Tie-break: prefer index with higher relevancy score
            const cScore = state.indexRelevancyScores[c.networkId] ?? 0;
            const existingScore = state.indexRelevancyScores[existing.networkId] ?? 0;
            if (cScore > existingScore) {
              bestByUser.set(c.candidateUserId, c);
            }
          }
        }
        const dedupedCandidates = Array.from(bestByUser.values());
        // Re-sort by similarity descending (Map iteration order doesn't guarantee sort)
        dedupedCandidates.sort((a, b) => b.similarity - a.similarity);

        if (dedupedCandidates.length < sortedCandidates.length) {
          logger.info("[Graph:Evaluation] Deduped candidates by userId", {
            before: sortedCandidates.length,
            after: dedupedCandidates.length,
            removed: sortedCandidates.length - dedupedCandidates.length,
          });
        }

        const batchToEvaluate = dedupedCandidates.slice(0, EVAL_BATCH_SIZE);
        const remaining = dedupedCandidates.slice(EVAL_BATCH_SIZE);

        // Early termination: if search was query-driven and no query-sourced candidates remain,
        // clear remaining to prevent pointless pagination through profile-similarity leftovers
        const isQueryDriven = !!state.searchQuery?.trim();
        const queryRemaining = remaining.filter(
          (c) => c.discoverySource === 'query' || c.discoverySource == null,
        );
        const effectiveRemaining =
          isQueryDriven && queryRemaining.length === 0 ? [] : remaining;

        if (isQueryDriven && remaining.length > 0 && queryRemaining.length === 0) {
          logger.info(
            "[Graph:Evaluation] Early termination: no query-sourced candidates remain",
            {
              droppedProfileCandidates: remaining.length,
            },
          );
        }

        if (effectiveRemaining.length > 0) {
          logger.verbose('[Graph:Evaluation] Batched candidates for evaluation', {
            evaluating: batchToEvaluate.length,
            remaining: effectiveRemaining.length,
            total: sortedCandidates.length,
          });
        }

        const agentTimingsAccum: DebugMetaAgent[] = [];

        try {
          const discoveryUserId = state.onBehalfOfUserId ?? state.userId;
          const sourceProfile = await this.database.getProfile(discoveryUserId);
          const sourceEntity: EvaluatorEntity = {
            userId: discoveryUserId,
            profile: {
              name: sourceProfile?.identity?.name,
              bio: sourceProfile?.identity?.bio,
              location: sourceProfile?.identity?.location,
              interests: sourceProfile?.attributes?.interests,
              skills: sourceProfile?.attributes?.skills,
              context: sourceProfile?.narrative?.context,
            },
            intents: state.indexedIntents.slice(0, 5).map((i) => ({
              intentId: i.intentId,
              payload: i.payload,
              summary: i.summary,
            })),
            networkId: '' as Id<'networks'>,  // Placeholder — overwritten per-pairing below
            ragScore: undefined,
            matchedVia: undefined,
          };

          const candidateEntities: EvaluatorEntity[] = await Promise.all(
            batchToEvaluate.map(async (c) => {
              const profile = await this.database.getProfile(c.candidateUserId);
              let intentPayload = c.candidatePayload;
              let intentSummary = c.candidateSummary;
              if (c.candidateIntentId != null && (!intentPayload || intentPayload === '')) {
                const intent = await this.database.getIntent(c.candidateIntentId);
                if (intent) {
                  intentPayload = intent.payload;
                  intentSummary = intent.summary ?? undefined;
                }
              }
              return {
                userId: c.candidateUserId,
                profile: {
                  name: profile?.identity?.name,
                  bio: profile?.identity?.bio,
                  location: profile?.identity?.location,
                  interests: profile?.attributes?.interests,
                  skills: profile?.attributes?.skills,
                  context: profile?.narrative?.context,
                },
                intents:
                  c.candidateIntentId != null
                    ? [{ intentId: c.candidateIntentId, payload: intentPayload ?? '', summary: intentSummary }]
                    : undefined,
                networkId: c.networkId,
                ragScore: c.similarity * 100,
                matchedVia: c.lens,
              };
            })
          );

          const userIdToIndexId = new Map<string, Id<'networks'>>();
          for (const e of candidateEntities) {
            if (!userIdToIndexId.has(e.userId)) userIdToIndexId.set(e.userId, e.networkId as Id<'networks'>);
          }

          // Lower default threshold to 50 for better recall
          const minScore = state.options.minScore ?? 50;

          const evaluator = typeof (evaluatorAgent as OpportunityEvaluator).invokeEntityBundle === 'function'
            ? (evaluatorAgent as OpportunityEvaluator)
            : new OpportunityEvaluator();

          const runParallel = process.env.RUN_OPPORTUNITY_EVAL_IN_PARALLEL === 'true';

          // Declare trace entries early so both parallel and serial paths can push error entries
          const traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> = [];
          const parallelErrors: Array<{ candidateUserId: string; candidateName: string; error: string; durationMs: number }> = [];

          let pairwiseOpportunities: Array<{ reasoning: string; score: number; actors: Array<{ userId: string; role: 'agent' | 'patient' | 'peer'; intentId?: string | null }> }>;

          if (runParallel) {
            // Experimental: one LLM call per candidate, all fired in parallel
            logger.verbose('[Graph:Evaluation] Running parallel evaluation', { candidates: candidateEntities.length });
            const parallelResults = await Promise.all(
              candidateEntities.map((candidateEntity) => {
                const input: EvaluatorInput = {
                  discovererId: discoveryUserId,
                  entities: [sourceEntity, candidateEntity],
                  existingOpportunities: state.options.existingOpportunities,
                  ...(state.searchQuery?.trim() ? { discoveryQuery: state.searchQuery.trim() } : {}),
                };
                const _evalStart = Date.now();
                const _traceEmitter = requestContext.getStore()?.traceEmitter;
                _traceEmitter?.({ type: "agent_start", name: "opportunity-evaluator" });
                const _candidateName = candidateEntity.profile?.name ?? "Unknown";
                return evaluator.invokeEntityBundle(input, { minScore, returnAll: true })
                  .then((res) => {
                    const _evalDuration = Date.now() - _evalStart;
                    agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalDuration });
                    const _topScore = res.length > 0 ? Math.max(...res.map(r => r.score)) : -1;
                    const _summary = _topScore < 0 ? `${_candidateName}: no match` : `${_candidateName}: ${_topScore}`;
                    _traceEmitter?.({ type: "agent_end", name: "opportunity-evaluator", durationMs: _evalDuration, summary: _summary });
                    return res;
                  })
                  .catch((err) => {
                    const _evalDuration = Date.now() - _evalStart;
                    const _errMsg = err instanceof Error ? err.message : String(err);
                    agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalDuration });
                    _traceEmitter?.({ type: "agent_end", name: "opportunity-evaluator", durationMs: _evalDuration, summary: `${_candidateName}: error — ${_errMsg}` });
                    logger.warn('[Graph:Evaluation] Parallel eval failed for candidate', {
                      candidateUserId: candidateEntity.userId,
                      error: err,
                    });
                    parallelErrors.push({
                      candidateUserId: candidateEntity.userId,
                      candidateName: _candidateName,
                      error: _errMsg,
                      durationMs: _evalDuration,
                    });
                    return [] as Array<{ reasoning: string; score: number; actors: Array<{ userId: string; role: 'agent' | 'patient' | 'peer'; intentId?: string | null }> }>;
                  });
              })
            );
            // Each call is already pairwise (source + 1 candidate) — flatten directly
            pairwiseOpportunities = parallelResults.flat();

            // Record trace entries for candidates that failed during parallel evaluation
            if (parallelErrors.length > 0) {
              traceEntries.push({
                node: "evaluation_errors",
                detail: `${parallelErrors.length}/${candidateEntities.length} candidate evaluation(s) failed`,
                data: {
                  failedCount: parallelErrors.length,
                  totalCandidates: candidateEntities.length,
                  errors: parallelErrors.map(e => ({
                    candidateUserId: e.candidateUserId,
                    candidateName: e.candidateName,
                    error: e.error,
                    durationMs: e.durationMs,
                  })),
                },
              });
            }
          } else {
            // Default: single bundled LLM call with all candidates
            const entities: EvaluatorEntity[] = [sourceEntity, ...candidateEntities];
            const input: EvaluatorInput = {
              discovererId: discoveryUserId,
              entities,
              existingOpportunities: state.options.existingOpportunities,
              ...(state.searchQuery?.trim() ? { discoveryQuery: state.searchQuery.trim() } : {}),
            };
            // Get ALL scored results for tracing (returnAll: true), filter for persistence later
            const _evalStart = Date.now();
            const _traceEmitterSerial = requestContext.getStore()?.traceEmitter;
            _traceEmitterSerial?.({ type: "agent_start", name: "opportunity-evaluator" });
            let opportunitiesWithActors: EvaluatedOpportunityWithActors[];
            try {
              opportunitiesWithActors = await evaluator.invokeEntityBundle(input, { minScore, returnAll: true });
              const _evalDuration = Date.now() - _evalStart;
              agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalDuration });
              _traceEmitterSerial?.({ type: "agent_end", name: "opportunity-evaluator", durationMs: _evalDuration, summary: `Evaluated ${candidateEntities.length} candidate(s)` });
            } catch (serialErr) {
              const _evalDuration = Date.now() - _evalStart;
              const _errMsg = serialErr instanceof Error ? serialErr.message : String(serialErr);
              agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalDuration });
              _traceEmitterSerial?.({ type: "agent_end", name: "opportunity-evaluator", durationMs: _evalDuration, summary: `error — ${_errMsg}` });
              throw serialErr; // Re-throw for the outer catch to handle
            }

            // Split multi-actor evaluator results into pairwise (viewer + candidate).
            // Each persisted discovery opportunity should have exactly 2 actors.
            // When splitting, build per-candidate reasoning from entity data because
            // the shared reasoning typically describes only one candidate.
            pairwiseOpportunities = [];
            for (const op of opportunitiesWithActors) {
              const pairwiseSourceId = state.onBehalfOfUserId ?? state.userId;
              const nonViewerActors = op.actors.filter(a => a.userId !== pairwiseSourceId);
              if (nonViewerActors.length <= 1) {
                pairwiseOpportunities.push(op);
              } else {
                logger.warn('[Graph:Evaluation] Splitting multi-actor opportunity; LLM returned bundled actors instead of one-per-candidate', {
                  actorCount: nonViewerActors.length,
                  userIds: nonViewerActors.map(a => a.userId),
                });
                const viewerActor = op.actors.find(a => a.userId === pairwiseSourceId);
                for (const candidate of nonViewerActors) {
                  const entity = candidateEntities.find(e => e.userId === candidate.userId);
                  const candidateName = entity?.profile?.name ?? '';
                  const reasoningLower = op.reasoning.toLowerCase();
                  const mentionsCandidate =
                    candidateName !== '' &&
                    reasoningLower.includes(candidateName.toLowerCase());
                  const mentionsOtherCandidate = nonViewerActors
                    .filter((actor) => actor.userId !== candidate.userId)
                    .map((actor) =>
                      candidateEntities.find((e) => e.userId === actor.userId)?.profile?.name?.toLowerCase()
                    )
                    .some((name) => name != null && reasoningLower.includes(name));
                  let reasoning: string;
                  if (mentionsCandidate && !mentionsOtherCandidate) {
                    reasoning = op.reasoning;
                  } else if (entity?.profile) {
                    const p = entity.profile;
                    const parts = [p.name, p.bio].filter(Boolean);
                    if (p.skills?.length) parts.push(`Skills: ${p.skills.join(', ')}`);
                    if (p.interests?.length) parts.push(`Interests: ${p.interests.join(', ')}`);
                    reasoning = parts.join('. ') || op.reasoning;
                  } else {
                    reasoning = op.reasoning;
                  }
                  pairwiseOpportunities.push({
                    reasoning,
                    score: op.score,
                    actors: [
                      viewerActor ?? { userId: pairwiseSourceId, role: 'patient' as const, intentId: null },
                      candidate,
                    ],
                  });
                }
              }
            }
          }

          const evaluatedOpportunities: EvaluatedOpportunity[] = pairwiseOpportunities.map((op) => ({
            reasoning: op.reasoning,
            score: op.score,
            actors: op.actors.map((a) => {
              const isSource = a.userId === discoveryUserId;
              if (isSource) {
                // Source actor inherits the counterpart's networkId (shared match context)
                const counterpart = op.actors.find((other) => other.userId !== a.userId);
                const counterpartIndexId = counterpart
                  ? userIdToIndexId.get(counterpart.userId) ?? (candidateEntities.find((e) => e.userId === counterpart.userId)?.networkId as Id<'networks'>)
                  : undefined;
                return {
                  userId: a.userId as Id<'users'>,
                  role: a.role,
                  intentId: a.intentId as Id<'intents'> | undefined,
                  networkId: counterpartIndexId ?? userIdToIndexId.get(a.userId) ?? ('' as Id<'networks'>),
                };
              }
              return {
                userId: a.userId as Id<'users'>,
                role: a.role,
                intentId: a.intentId as Id<'intents'> | undefined,
                networkId: userIdToIndexId.get(a.userId) ?? (candidateEntities.find((e) => e.userId === a.userId)?.networkId as Id<'networks'>),
              };
            }),
          }));

          const passed = evaluatedOpportunities.filter((o) => o.score >= minScore);
          logger.verbose('[Graph:Evaluation] Evaluation complete', {
            evaluatedCount: evaluatedOpportunities.length,
            passed: passed.length,
          });

          // Build detailed trace entries for each evaluated candidate

          // Threshold filter trace: how many candidates in this batch were above/below similarity threshold
          const aboveThreshold = batchToEvaluate.filter(c => c.similarity >= 0.40).length;
          const belowThreshold = batchToEvaluate.length - aboveThreshold;
          traceEntries.push({
            node: "threshold_filter",
            detail: `${aboveThreshold} above 0.40, ${belowThreshold} below (batch of ${batchToEvaluate.length})`,
            data: {
              aboveThreshold,
              belowThreshold,
              minScore: 0.40,
              batchSize: batchToEvaluate.length,
            },
          });

          // Create a map of evaluated candidates by userId for quick lookup.
          // Use discoveryUserId (which accounts for onBehalfOfUserId in introducer flow)
          // rather than state.userId (which is the introducer, not present in pairwise actors).
          const evaluatedByUserId = new Map<string, { score: number; reasoning: string }>();
          for (const opp of evaluatedOpportunities) {
            const candidateActor = opp.actors.find(a => a.userId !== discoveryUserId);
            if (candidateActor) {
              evaluatedByUserId.set(candidateActor.userId, { score: opp.score, reasoning: opp.reasoning });
            }
          }

          // Summary entry
          traceEntries.push({
            node: "evaluation",
            detail: `Evaluated ${candidateEntities.length} candidate(s) → ${passed.length} passed (min score ${minScore})`,
            data: {
              inputCandidates: batchToEvaluate.length,
              returnedFromEvaluator: evaluatedOpportunities.length,
              passedCount: passed.length,
              minScore,
              remaining: effectiveRemaining.length,
              batchNumber: 1,
              durationMs: Date.now() - startTime,
              model: getModelName("opportunityEvaluator"),
            },
          });

          // Individual candidate entries - show ALL candidates that went to evaluator
          for (const entity of candidateEntities) {
            const candidateName = entity.profile?.name || entity.userId.slice(0, 8);
            const candidateBio = entity.profile?.bio;
            const evaluated = evaluatedByUserId.get(entity.userId);
            const score = evaluated?.score;
            const reasoning = evaluated?.reasoning;
            const didPass = score !== undefined && score >= minScore;
            const status = score !== undefined 
              ? (didPass ? '✓ passed' : `✗ score ${score}`) 
              : '✗ not scored';
            
            traceEntries.push({
              node: "candidate",
              detail: `${candidateName}: ${status}`,
              data: {
                userId: entity.userId,
                name: candidateName,
                bio: candidateBio,
                score: score,
                passed: didPass,
                reasoning: reasoning || 'No evaluation returned for this candidate',
                matchedVia: entity.matchedVia,
                ragScore: entity.ragScore,
                model: getModelName("opportunityEvaluator"),
                intents: entity.intents?.map((i: { intentId?: string; payload?: string; summary?: string }) => ({
                  intentId: i.intentId,
                  summary: (i.summary || i.payload || '').slice(0, 100),
                })),
                profile: entity.profile ? {
                  name: entity.profile.name,
                  location: entity.profile.location,
                } : undefined,
              },
            });
          }

          // Only pass opportunities that passed the threshold to downstream nodes
          const passedOpportunities = evaluatedOpportunities.filter((o) => o.score >= minScore);

          return {
            evaluatedOpportunities: passedOpportunities,
            remainingCandidates: effectiveRemaining,
            trace: traceEntries,
            agentTimings: agentTimingsAccum,
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error('[Graph:Evaluation] Failed', { error });
          return {
            evaluatedOpportunities: [],
            error: 'Failed to evaluate candidates.',
            trace: [{
              node: "evaluation_fatal",
              detail: `Evaluation failed: ${errMsg}`,
              data: {
                error: errMsg,
                candidateCount: state.candidates?.length ?? 0,
                durationMs: Date.now() - startTime,
              },
            }],
            agentTimings: agentTimingsAccum,
          };
        }
      });
    };

    /**
     * Node 3b: Negotiate (post-persist)
     * Runs bilateral negotiation per persisted opportunity, passing opportunityId so the
     * negotiation graph's finalize node updates each opportunity's status:
     *   accept → 'pending'  (sender notification follows the pending → notification path)
     *   reject → 'rejected'
     *   timeout/turn_cap → 'stalled'
     * Status updates land in the DB; in-memory state.opportunities is not mutated.
     */
    const NEGOTIATE_TIMER_SENTINEL = Symbol('negotiate-timer-sentinel');
    const negotiateNode = async (state: typeof OpportunityGraphState.State) => {
      if (!this.negotiationGraph) return {};
      if (!state.opportunities || state.opportunities.length === 0) return {};

      const traceEmitter = requestContext.getStore()?.traceEmitter;
      const graphStart = Date.now();
      traceEmitter?.({ type: "graph_start", name: "Negotiation graph" });

      try {
        // Use the same discoveryUserId pattern as evaluationNode
        const discoveryUserId = (state.onBehalfOfUserId ?? state.userId) as string;

        const sourceAccount = await this.database.getUser(discoveryUserId).catch(() => null);

        const sourceUser = {
          id: discoveryUserId,
          intents: state.indexedIntents?.slice(0, 5).map(i => ({
            id: i.intentId as string,
            title: i.summary ?? '',
            description: i.payload ?? '',
            confidence: 1,
          })) ?? [],
          profile: {
            name: state.sourceProfile?.identity?.name ?? sourceAccount?.name,
            bio: state.sourceProfile?.identity?.bio ?? sourceAccount?.intro ?? undefined,
            location: state.sourceProfile?.identity?.location ?? sourceAccount?.location ?? undefined,
            skills: state.sourceProfile?.attributes?.skills,
            interests: state.sourceProfile?.attributes?.interests,
          },
        };

        // Build candidates from persisted opportunities. Each opportunity carries its DB id
        // so the negotiation graph's finalize node can update its status from the outcome.
        logger.verbose('[Graph:Negotiate] Building candidates from opportunities', {
          opportunityCount: state.opportunities.length,
          discoveryUserId,
        });

        const candidateEntries = state.opportunities
          .map(opp => {
            // Skip opportunities where any introducer exists but has not yet approved.
            const introducerActors = (opp.actors as OpportunityActor[])
              .filter(a => a.role === 'introducer');
            if (introducerActors.length > 0 && !introducerActors.every(a => a.approved === true)) {
              logger.verbose('[Graph:Negotiate] Skipping opportunity: introducer not approved', {
                opportunityId: opp.id,
                introducerCount: introducerActors.length,
                approvedCount: introducerActors.filter(a => a.approved === true).length,
              });
              return null;
            }

            const candidateActor = (opp.actors as Array<{ userId: string; role?: string; networkId?: string; intentId?: string }>)
              .find(a => a.userId !== discoveryUserId);
            if (!candidateActor) {
              logger.verbose('[Graph:Negotiate] Skipping opportunity: no candidateActor found', {
                opportunityId: opp.id,
                discoveryUserId,
                actors: (opp.actors as OpportunityActor[])?.map(a => ({ userId: a.userId, role: a.role })) ?? [],
              });
              return null;
            }
            return { opp, candidateActor };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null);

        logger.verbose('[Graph:Negotiate] Candidate filtering complete', {
          inputOpportunities: state.opportunities.length,
          outputCandidates: candidateEntries.length,
        });

        const candidates: NegotiationCandidate[] = await Promise.all(
          candidateEntries.map(async ({ opp, candidateActor }) => {
            const userId = candidateActor.userId as string;
            const [profile, user, activeIntents, intent] = await Promise.all([
              this.database.getProfile(userId).catch(() => null),
              this.database.getUser(userId).catch(() => null),
              this.database.getActiveIntents(userId).catch(() => []),
              candidateActor.intentId
                ? this.database.getIntent(candidateActor.intentId as string).catch(() => null)
                : null,
            ]);

            const toNegIntent = (ai: { id?: string | null; summary?: string | null; payload?: string | null }) => ({
              id: (ai.id ?? candidateActor.intentId) as string,
              title: ai.summary ?? '',
              description: ai.payload ?? '',
              confidence: 1,
            });
            const triggerInActive = activeIntents.some(ai => ai.id === candidateActor.intentId);
            const triggerFallback = !triggerInActive && intent ? [toNegIntent(intent)] : [];
            const candidateIntents = [
              ...triggerFallback,
              ...activeIntents.filter(ai => ai.id === candidateActor.intentId).map(toNegIntent),
              ...activeIntents.filter(ai => ai.id !== candidateActor.intentId).map(toNegIntent),
            ].slice(0, 5);

            return {
              userId,
              opportunityId: opp.id as string,
              reasoning: (opp.interpretation as { reasoning?: string } | null)?.reasoning ?? '',
              valencyRole: candidateActor.role ?? 'peer',
              networkId: candidateActor.networkId as string,
              ...(state.searchQuery?.trim() && { discoveryQuery: state.searchQuery.trim() }),
              candidateUser: {
                id: userId,
                intents: candidateIntents,
                profile: {
                  name: profile?.identity?.name ?? user?.name,
                  bio: profile?.identity?.bio ?? user?.intro ?? undefined,
                  location: profile?.identity?.location ?? user?.location ?? undefined,
                  skills: profile?.attributes?.skills,
                  interests: profile?.attributes?.interests,
                },
              },
            };
          }),
        );

        const isChatPath = !!state.options?.conversationId;
        const maxTurns = isChatPath ? 4 : 6;

        // Fetch per-candidate index context (group by networkId to avoid duplicate lookups)
        const uniqueIndexIds = [...new Set(candidates.map(c => c.networkId).filter((id): id is string => !!id))];
        const indexContextMap = new Map<string, string>();
        await Promise.all(
          uniqueIndexIds.map(async (networkId) => {
            const ctx = await this.database.getNetworkMemberContext(networkId, discoveryUserId).catch(() => null);
            const prompt = [ctx?.indexPrompt, ctx?.memberPrompt]
              .filter((v): v is string => !!v?.trim())
              .join('\n\n');
            if (prompt) indexContextMap.set(networkId, prompt);
          }),
        );

        // Decide turn timeout.
        //   - Background/queue path (no conversationId): always the park-window
        //     budget (AMBIENT_PARK_WINDOW_MS, 5 min). Turns park in
        //     `waiting_for_agent` and are picked up via polling; the dispatcher
        //     additionally short-circuits to the system agent when no personal
        //     agent has a fresh heartbeat (see AgentDispatcherImpl).
        //   - Chat path with a personal agent authorized: use the same park-window
        //     so the dispatcher parks the turn and the user's personal agent can
        //     pick it up via polling.
        //   - Chat path with no personal agent: use a short timeout (30s) so the
        //     system `Index Negotiator` kicks in without stalling the chat.
        // Check the personal agent per unique candidate network so cross-network
        // chat runs don't get a single authorized agent deciding the timeout for
        // every candidate. Only use the long (polling) timeout when a personal
        // agent is authorized on ALL candidate networks; otherwise fall back to
        // the short timeout so chats don't stall on a network where only the
        // system negotiator is allowed.
        const hasPersonalAgent = isChatPath && this.agentDispatcher
          ? (uniqueIndexIds.length > 0
              ? (await Promise.all(
                  uniqueIndexIds.map((networkId) =>
                    this.agentDispatcher!.hasPersonalAgent(
                      discoveryUserId,
                      { action: 'manage:negotiations', scopeType: 'network', scopeId: networkId },
                    ).catch(() => false),
                  ),
                )).every(Boolean)
              : false)
          : false;
        // Orchestrator (chat-driven a2h) fan-out uses a tight 60s park window —
        // the user is watching the stream, so we cannot afford the 5-min ambient
        // budget. Ambient keeps its heartbeat-aware long/short split.
        const ORCHESTRATOR_PARK_WINDOW_MS = 60_000;
        const isOrchestrator = state.trigger === 'orchestrator';
        const useLongTimeout = !isChatPath || hasPersonalAgent;
        const timeoutMs = isOrchestrator
          ? ORCHESTRATOR_PARK_WINDOW_MS
          : useLongTimeout ? AMBIENT_PARK_WINDOW_MS : 30_000;

        logger.info('negotiateNode timeout decision', {
          discoveryUserId,
          trigger: state.trigger,
          isChatPath,
          isOrchestrator,
          hasDispatcher: !!this.agentDispatcher,
          hasPersonalAgent,
          useLongTimeout,
          timeoutMs,
          candidateCount: candidates.length,
        });

        // Per-candidate hook — always-on. Accumulates negotiation resolutions
        // for discovery question generation. Additionally, for the orchestrator
        // trigger: flips the opp from 'pending' to 'draft' and pushes an
        // `opportunity_draft_ready` event so the frontend can render it
        // inline as soon as it resolves, rather than waiting for the full
        // fan-out. Abort (e.g. user closed the chat) suppresses both the
        // status flip and the event — the in-flight negotiation finishes
        // naturally but its card never reaches the user.
        // Build a stable order index so that resolutions accumulated via the
        // per-candidate async hook can be re-sorted to candidate-list order
        // before being handed to buildQuestionPrompt. Without this the LLM
        // sees negotiations in completion-time order (non-deterministic).
        const candidateOrderById = new Map<string, number>();
        candidates.forEach((c, i) => candidateOrderById.set(c.userId, i));

        const resolutions: Array<NegotiationResolution & { __order: number }> = [];

        const onCandidateResolved: OnNegotiationResolved = async ({ candidate, accepted, turns, outcome }) => {
          resolutions.push({
            __order: candidateOrderById.get(candidate.userId) ?? Number.MAX_SAFE_INTEGER,
            candidateUserId: candidate.userId,
            counterpartyHint: (() => {
              const bio = candidate.candidateUser.profile?.bio?.trim();
              if (bio) return bio;
              return (candidate.candidateUser.profile?.interests ?? []).join(", ");
            })(),
            indexContext: candidate.networkId
              ? indexContextMap.get(candidate.networkId) ?? ""
              : "",
            turns,
            outcome,
          });

          if (state.trigger !== 'orchestrator') return;
          // ─── orchestrator streaming body ───
          const abortSignal = requestContext.getStore()?.abortSignal;
          if (abortSignal?.aborted) return;
          if (!accepted || !candidate.opportunityId) return;

          // Only emit after a successful status flip — the frontend keys
          // cards off `opportunity.status === 'draft'`, so emitting a row
          // with its pre-flip status would render inconsistently. If the
          // flip fails we log and drop the event; the negotiation result
          // is still captured in acceptedResults for the final summary.
          const updated = await this.database
            .updateOpportunityStatus(candidate.opportunityId, 'draft')
            .catch((err) => {
              logger.warn('[Graph:Negotiate] failed to flip opp to draft; suppressing draft-ready event', {
                opportunityId: candidate.opportunityId,
                error: err,
              });
              return null;
            });
          if (!updated || abortSignal?.aborted) return;

          traceEmitter?.({
            type: 'opportunity_draft_ready',
            opportunityId: candidate.opportunityId,
            opportunity: updated,
            counterparty: {
              userId: candidate.candidateUser.id,
              ...(candidate.candidateUser.profile?.name
                ? { name: candidate.candidateUser.profile.name }
                : {}),
            },
          });
        };

        const negotiationWork = negotiateCandidates(
          this.negotiationGraph, sourceUser, candidates,
          { networkId: '', prompt: '' }, // base context, overridden per-candidate below
          { maxTurns, traceEmitter: traceEmitter ?? undefined,
            indexContextOverrides: indexContextMap,
            timeoutMs,
            trigger: state.trigger === 'orchestrator' ? 'orchestrator' : 'ambient',
            onCandidateResolved },
        );

        // MCP-only: race the whole negotiate phase against a budget. When the
        // timer wins we return early with a `timed_out` trace; the unresolved
        // promise keeps running in the Bun event loop and each candidate's
        // finalize node updates its opp status in the DB. We deliberately do
        // NOT await it, NOT abort it, and NOT mutate state.opportunities —
        // the MCP tool handler refreshes statuses from the DB before
        // responding. Bounded blast radius: at most ~20 s of background work
        // per request; orphans heal via maintenance scripts or IND-279 when
        // it lands.
        const budgetMs = state.options.negotiateTimeoutMs;
        let acceptedResults: Awaited<typeof negotiationWork>;
        if (budgetMs !== undefined) {
          let timerId: ReturnType<typeof setTimeout> | undefined;
          const timerWork = new Promise<typeof NEGOTIATE_TIMER_SENTINEL>((resolve) => {
            timerId = setTimeout(() => resolve(NEGOTIATE_TIMER_SENTINEL), budgetMs);
          });
          // try/finally ensures the timer is cleared on every exit path —
          // sentinel-win, work-win, AND `negotiationWork` rejection. Without
          // this, a rejected negotiation would leave the timer pending and
          // keep the event loop alive until `budgetMs` elapses.
          let raced: typeof NEGOTIATE_TIMER_SENTINEL | Awaited<typeof negotiationWork>;
          try {
            raced = await Promise.race([negotiationWork, timerWork]);
          } finally {
            if (timerId !== undefined) clearTimeout(timerId);
          }
          if (raced === NEGOTIATE_TIMER_SENTINEL) {
            // Floating promise is intentional — see comment above.
            void negotiationWork.catch((err) => {
              logger.warn('[Graph:Negotiate] background negotiation failed after timer fired', { error: err });
            });
            logger.warn('[Graph:Negotiate] timed out — returning partial results to caller', {
              discoveryUserId,
              candidateCount: candidates.length,
              negotiateTimeoutMs: budgetMs,
            });
            traceEmitter?.({ type: "graph_end", name: "Negotiation graph", durationMs: Date.now() - graphStart });
            const orderedResolutionsPartial = [...resolutions]
              .sort((a, b) => a.__order - b.__order)
              .map(({ __order: _o, ...r }) => r as NegotiationResolution);
            const discoveryNegotiationsPartial = orderedResolutionsPartial.map(toDiscoveryNegotiation);
            const discoverySummaryPartial = buildDiscoverySummary(orderedResolutionsPartial);
            return {
              trace: [{
                node: 'negotiate',
                detail: 'timed_out',
                data: {
                  negotiateTimeoutMs: budgetMs,
                  candidateCount: candidates.length,
                  durationMs: Date.now() - graphStart,
                },
              }],
              discoveryNegotiations: discoveryNegotiationsPartial,
              discoverySummary: discoverySummaryPartial,
            };
          }
          acceptedResults = raced;
        } else {
          acceptedResults = await negotiationWork;
        }

        // No filtering: every candidate's outcome (accept/reject/stalled) was applied to its
        // opportunity row by the negotiation graph's finalize node via the opportunityId we
        // passed. state.opportunities stays as it was at persist time; DB has the new statuses.
        const acceptedUserIds = new Set(acceptedResults.map(r => r.userId));
        const negotiationDurationMs = Date.now() - graphStart;

        const candidateTraceEntries = candidates.map(c => {
          const accepted = acceptedUserIds.has(c.userId);
          const result = accepted ? acceptedResults.find(r => r.userId === c.userId) : null;
          const name = c.candidateUser.profile?.name ?? c.userId;
          const outcome = accepted ? 'accepted' : 'rejected_or_stalled';
          return {
            node: 'negotiate_candidate',
            detail: `${name}: ${outcome}`,
            data: {
              userId: c.userId,
              opportunityId: c.opportunityId,
              name,
              outcome,
              turns: result?.turnCount ?? 0,
            },
          };
        });

        const acceptedCount = acceptedResults.length;
        const otherCount = candidates.length - acceptedCount;
        const negotiateTrace = [
          {
            node: 'negotiate',
            detail: `${candidates.length} candidate(s) -> ${acceptedCount} accepted, ${otherCount} rejected/stalled`,
            data: {
              durationMs: negotiationDurationMs,
              candidateCount: candidates.length,
              acceptedCount,
              otherCount,
            },
          },
          ...candidateTraceEntries,
        ];

        traceEmitter?.({ type: "graph_end", name: "Negotiation graph", durationMs: Date.now() - graphStart });
        const orderedResolutions = [...resolutions]
          .sort((a, b) => a.__order - b.__order)
          .map(({ __order: _o, ...r }) => r as NegotiationResolution);
        const discoveryNegotiations = orderedResolutions.map(toDiscoveryNegotiation);
        const discoverySummary = buildDiscoverySummary(orderedResolutions);
        return {
          trace: negotiateTrace,
          discoveryNegotiations,
          discoverySummary,
        };
      } catch (err) {
        logger.error("[Graph:Negotiate] Negotiation stage failed", { error: err });
        traceEmitter?.({ type: "graph_end", name: "Negotiation graph", durationMs: Date.now() - graphStart });
        return {
          trace: [{
            node: 'negotiate',
            detail: 'Negotiation failed',
            data: { durationMs: Date.now() - graphStart, error: true },
          }],
          discoveryNegotiations: [],
          discoverySummary: buildDiscoverySummary([]),
        };
      }
    };

    /**
     * Node 4: Ranking
     * Sorts evaluated opportunities by score, applies limit, dedupes by actor-set hash.
     */
    const rankingNode = withNodeTrace(
      "opportunity-ranking",
      async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.ranking", async () => {
        logger.verbose('[Graph:Ranking] Starting ranking', {
          evaluatedCount: state.evaluatedOpportunities.length,
        });

        try {
          const sorted = [...state.evaluatedOpportunities].sort((a, b) => b.score - a.score);
          const limit = state.options.limit ?? 20;
          const ranked = sorted.slice(0, limit);

          const actorSetKey = (opp: EvaluatedOpportunity) =>
            opp.actors
              .map((a) => `${a.userId}:${a.networkId}`)
              .sort()
              .join('|');
          const seen = new Set<string>();
          const deduplicated = ranked.filter((opp) => {
            const key = actorSetKey(opp);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          logger.verbose('[Graph:Ranking] Ranking complete', {
            sorted: sorted.length,
            afterLimit: ranked.length,
            afterDedup: deduplicated.length,
          });
          return { evaluatedOpportunities: deduplicated };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error('[Graph:Ranking] Failed', { error });
          return {
            evaluatedOpportunities: [],
            error: 'Failed to rank opportunities.',
            trace: [{
              node: "ranking_fatal",
              detail: `Ranking failed: ${errMsg}`,
              data: { error: errMsg },
            }],
          };
        }
      });
    },
      (result) => {
        const r = result as Record<string, unknown>;
        if (r?.error) return `error: ${r.error}`;
        const opps = r?.evaluatedOpportunities as unknown[];
        return opps ? `Ranked ${opps.length} opportunity(ies)` : undefined;
      },
    );

    /**
     * Node: intro_validation (create_introduction path)
     * Validates index scope, membership for introducer and all party users, and no existing opportunity.
     */
    const introValidationNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.introValidation", async () => {
        logger.verbose('[Graph:IntroValidation] Starting', {
          userId: state.userId,
          networkId: state.networkId,
          entitiesCount: state.introductionEntities?.length ?? 0,
        });

        try {
          const entities = state.introductionEntities ?? [];
          const primaryNetworkId = (state.networkId ?? entities[0]?.networkId) as Id<'networks'> | undefined;
          const partyUserIds = [...new Set(entities.map((e) => e.userId).filter((id) => id !== state.userId))];

          if (!primaryNetworkId || partyUserIds.length < 1) {
            return {
              error: 'Introduction requires networkId and at least two entities (introducer + one counterpart).',
            };
          }

          if (state.requiredNetworkId && primaryNetworkId !== state.requiredNetworkId) {
            return {
              error: 'This chat is scoped to a different community. You can only introduce members of the current community.',
            };
          }

          const [introducerIsMember, introducerIsOwner] = await Promise.all([
            this.database.isNetworkMember(primaryNetworkId, state.userId),
            this.database.isIndexOwner(primaryNetworkId, state.userId),
          ]);
          if (!introducerIsMember && !introducerIsOwner) {
            return {
              error: 'One or more users are not members of the specified community. You can only introduce members who share a network.',
            };
          }
          const partyInScope = await Promise.all(
            partyUserIds.map(async (userId) => {
              const [isMember, isOwner] = await Promise.all([
                this.database.isNetworkMember(primaryNetworkId, userId),
                this.database.isIndexOwner(primaryNetworkId, userId),
              ]);
              return isMember || isOwner;
            }),
          );
          const allPartyMembers = partyInScope.every(Boolean);
          if (!allPartyMembers) {
            return {
              error: 'One or more users are not members of the specified community. You can only introduce members who share a network.',
            };
          }

          const exists = await this.database.opportunityExistsBetweenActors(partyUserIds, primaryNetworkId);
          if (exists) {
            return { error: 'An opportunity already exists between these people.' };
          }

          logger.verbose('[Graph:IntroValidation] Validation passed');
          return {};
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('[Graph:IntroValidation] Failed', {
            userId: state.userId,
            networkId: state.networkId,
            error: err,
          });
          return {
            error: 'Introduction validation failed.',
            trace: [{
              node: "intro_validation_fatal",
              detail: `IntroValidation failed: ${errMsg}`,
              data: { error: errMsg },
            }],
          };
        }
      });
    };

    /**
     * Build fallback reasoning and actors when evaluator returns empty or throws.
     */
    function buildIntroFallback(
      entities: EvaluatorEntity[],
      state: typeof OpportunityGraphState.State,
      primaryNetworkId: Id<'networks'>,
      introducerName?: string
    ): { reasoning: string; score: number; actors: EvaluatedOpportunityActor[] } {
      const reasoning =
        `${introducerName ?? 'A member'} believes these people should connect.` +
        (state.introductionHint ? ` Context: ${state.introductionHint}` : '');
      const score = 70;
      const partyUserIds = entities.map((e) => e.userId).filter((id) => id !== state.userId);
      const actors: EvaluatedOpportunityActor[] = partyUserIds.map((uid) => ({
        userId: uid as Id<'users'>,
        role: 'peer' as const,
        networkId: primaryNetworkId,
      }));
      return { reasoning, score, actors };
    }

    /**
     * Node: intro_evaluation (create_introduction path)
     * Runs entity-bundle evaluator and sets evaluatedOpportunities (one) + introductionContext.
     */
    const introEvaluationNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.introEvaluation", async () => {
        logger.verbose('[Graph:IntroEvaluation] Starting', { userId: state.userId });

        if (state.error) {
          return { evaluatedOpportunities: [], agentTimings: [] };
        }

        const entities = state.introductionEntities ?? [];
        const primaryNetworkId = (state.networkId ?? entities[0]?.networkId) as Id<'networks'> | undefined;
        if (!primaryNetworkId || entities.length < 2) {
          return { evaluatedOpportunities: [], error: 'Missing entities or network for introduction.', agentTimings: [] };
        }

        const agentTimingsAccum: DebugMetaAgent[] = [];
        let introducerName: string | undefined;
        let reasoning: string;
        let score: number;
        let actors: EvaluatedOpportunityActor[] = [];

        const _traceEmitterIntro = requestContext.getStore()?.traceEmitter;
        let _introEvalStarted = false;
        let _evalStart = Date.now();
        try {
          const introducerUser = await this.database.getUser(state.userId);
          introducerName = introducerUser?.name ?? undefined;
          const input: EvaluatorInput = {
            discovererId: state.userId,
            entities,
            introductionMode: true,
            introducerName,
            introductionHint: state.introductionHint ?? undefined,
          };

          _evalStart = Date.now();
          _traceEmitterIntro?.({ type: "agent_start", name: "intro-evaluator" });
          _introEvalStarted = true;
          const evaluated = await (evaluatorAgent as OpportunityEvaluator).invokeEntityBundle(input, { minScore: 0 });
          const _introDuration = Date.now() - _evalStart;
          agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _introDuration });
          _traceEmitterIntro?.({ type: "agent_end", name: "intro-evaluator", durationMs: _introDuration, summary: "Evaluated introduction" });
          if (evaluated.length > 0) {
            const best = evaluated[0];
            reasoning = best.reasoning;
            score = best.score;
            actors = best.actors.map((a) => ({
              userId: a.userId as Id<'users'>,
              role: a.role,
              intentId: a.intentId ?? undefined,
              networkId: primaryNetworkId,
            }));
          } else {
            const fallback = buildIntroFallback(entities, state, primaryNetworkId, introducerName);
            reasoning = fallback.reasoning;
            score = fallback.score;
            actors = fallback.actors;
          }
        } catch (evalErr) {
          const errMsg = evalErr instanceof Error ? evalErr.message : String(evalErr);
          // Close the intro-evaluator span if it was started before the error
          if (_introEvalStarted) {
            const _introErrDuration = Date.now() - _evalStart;
            _traceEmitterIntro?.({ type: "agent_end", name: "intro-evaluator", durationMs: _introErrDuration, summary: `error — ${errMsg}` });
            agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _introErrDuration });
          }
          logger.warn('[Graph:IntroEvaluation] Evaluator or getUser failed, using fallback', { error: evalErr });
          const fallback = buildIntroFallback(entities, state, primaryNetworkId, introducerName);
          reasoning = fallback.reasoning;
          score = fallback.score;
          actors = fallback.actors;
          return {
            evaluatedOpportunities: [{ actors, score, reasoning }],
            introductionContext: { createdByName: introducerName },
            options: { ...state.options, initialStatus: state.options.initialStatus ?? 'latent' },
            agentTimings: agentTimingsAccum,
            trace: [{
              node: "intro_evaluation_fatal",
              detail: `IntroEvaluation failed (using fallback): ${errMsg}`,
              data: { error: errMsg },
            }],
          };
        }

        const evaluatedOpportunity: EvaluatedOpportunity = {
          actors,
          score,
          reasoning,
        };

        return {
          evaluatedOpportunities: [evaluatedOpportunity],
          introductionContext: { createdByName: introducerName },
          options: { ...state.options, initialStatus: state.options.initialStatus ?? 'latent' },
          agentTimings: agentTimingsAccum,
        };
      });
    };

    /**
     * Node 5: Persist
     * Creates opportunities from evaluator-proposed actors (networkId, userId, role, optional intent).
     */
    const persistNode = withNodeTrace(
      "opportunity-persist",
      async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.persist", async () => {
        const startTime = Date.now();
        const initialStatus = resolveInitialStatus(state.trigger, state.options.initialStatus);
        logger.verbose('[Graph:Persist] Starting persistence (dedup-v2)', {
          opportunitiesToCreate: state.evaluatedOpportunities.length,
          trigger: state.trigger,
          initialStatus,
        });

        if (state.evaluatedOpportunities.length === 0) {
          logger.verbose('[Graph:Persist] No opportunities to persist');
          return { opportunities: [] };
        }

        try {
          const itemsToPersist: CreateOpportunityData[] = [];
          const reactivatedOpportunities: Opportunity[] = [];
          const existingBetweenActors: Array<{
            candidateUserId: Id<'users'>;
            networkId: Id<'networks'>;
            existingOpportunityId?: Id<'opportunities'>;
            existingStatus?: string;
          }> = [];
          const now = new Date().toISOString();
          // Only skip 'draft' (chat-only) opportunities during dedup.
          // 'latent' must NOT be skipped — background discovery creates latent opportunities,
          // and excluding them causes the same user pair to get duplicate opportunities
          // when multiple intents trigger separate discovery jobs (IND-166).
          const DEDUP_SKIP_STATUSES: Array<'draft'> = ['draft'];

          const introducerUserForOnBehalf = state.onBehalfOfUserId
            ? await this.database.getUser(state.userId)
            : null;

          // Orchestrator-only: collect already-accepted pairs so Task 7's
          // discover_opportunities tool can tell the LLM "these pairs are
          // already connected, surface the existing chat rather than
          // creating a new draft". Runs in parallel across unique
          // counterparties (a single evaluator pass can return multiple
          // opps per counterparty; we only hit the DB once per pair).
          // Failures are swallowed — the per-pair query is best-effort.
          const dedupAlreadyAccepted: Array<{ opportunityId: string; counterpartyUserId: string }> = [];
          if (state.trigger === 'orchestrator') {
            // Use the same viewer-resolution as evaluation/negotiate/persist
            // on-behalf branches so an introducer-driven orchestrator run
            // queries accepted opps between the *target* user and the
            // counterparty, not between the introducer and the counterparty.
            const dedupUserId = (state.onBehalfOfUserId ?? state.userId) as string;
            const uniqueCounterparts = new Set<string>();
            for (const evaluated of state.evaluatedOpportunities) {
              const candidateUserId = evaluated.actors.find(a => a.userId !== dedupUserId)?.userId;
              if (candidateUserId) uniqueCounterparts.add(candidateUserId);
            }
            const lookups = await Promise.all(
              [...uniqueCounterparts].map(async (counterpartyUserId) => {
                const accepted = await this.database
                  .findOpportunitiesByActors([dedupUserId, counterpartyUserId], { includeIntroducers: true, statuses: ['accepted'] })
                  .catch((err: unknown) => {
                    logger.warn('[Graph:Persist] findOpportunitiesByActors (sibling-accept) failed', {
                      userId: dedupUserId,
                      counterpartyUserId,
                      error: err,
                    });
                    return [] as Awaited<ReturnType<typeof this.database.findOpportunitiesByActors>>;
                  });
                return accepted.map((opp: { id: string }) => ({ opportunityId: opp.id, counterpartyUserId }));
              }),
            );
            dedupAlreadyAccepted.push(...lookups.flat());
          }

          for (const evaluated of state.evaluatedOpportunities) {
            const indexIdForActors = state.networkId ?? evaluated.actors[0]?.networkId;
            let actors: OpportunityActor[];
            let data: CreateOpportunityData;

            logger.verbose('[Graph:Persist:PathSelect]', {
              isIntroduction: !!state.introductionContext,
              stateUserId: state.userId,
              stateIndexId: state.networkId,
              evaluatedActorUserIds: evaluated.actors.map(a => a.userId),
            });

            if (state.introductionContext) {
              if (indexIdForActors === undefined) {
                logger.warn('[Graph:Persist] Introduction path missing networkId; skipping opportunity', {
                  userId: state.userId,
                  actorsCount: evaluated.actors.length,
                });
                continue;
              }
              // Introduction path: manual detection, introducer actor, curator_judgment signal.
              const evaluatorActors: OpportunityActor[] = evaluated.actors.map((a: EvaluatedOpportunityActor) => ({
                networkId: a.networkId ?? indexIdForActors,
                userId: a.userId,
                role: a.role,
                ...(a.intentId ? { intent: a.intentId } : {}),
              }));
              const viewerAlreadyInActors = evaluatorActors.some(a => a.userId === state.userId);
              actors = viewerAlreadyInActors
                ? evaluatorActors
                : [
                    ...evaluatorActors,
                    { networkId: indexIdForActors, userId: state.userId, role: 'introducer' as const, approved: false },
                  ];
              data = {
                detection: {
                  source: 'manual',
                  createdBy: state.userId,
                  createdByName: state.introductionContext.createdByName,
                  timestamp: now,
                },
                actors,
                interpretation: {
                  category: 'collaboration',
                  reasoning: evaluated.reasoning,
                  confidence: evaluated.score / 100,
                  signals: [
                    {
                      type: 'curator_judgment',
                      weight: 1,
                      detail: `Introduction by ${state.introductionContext.createdByName ?? 'a member'} via chat`,
                    },
                  ],
                },
                context: {
                  networkId: state.networkId ?? indexIdForActors,
                  ...(state.options.conversationId ? { conversationId: state.options.conversationId } : {}),
                },
                confidence: String(evaluated.score / 100),
                status: initialStatus,
              };
            } else if (state.onBehalfOfUserId) {
              if (indexIdForActors === undefined) {
                logger.warn('[Graph:Persist] Introducer discovery path missing networkId; skipping opportunity', {
                  userId: state.userId,
                  actorsCount: evaluated.actors.length,
                });
                continue;
              }
              // Introducer discovery path: introducer is state.userId, target is onBehalfOfUserId.
              const evaluatorActors: OpportunityActor[] = evaluated.actors.map((a: EvaluatedOpportunityActor) => ({
                networkId: a.networkId ?? indexIdForActors,
                userId: a.userId,
                role: a.role,
                ...(a.intentId ? { intent: a.intentId } : {}),
              }));
              const viewerAlreadyInActors = evaluatorActors.some(a => a.userId === state.userId);
              actors = viewerAlreadyInActors
                ? evaluatorActors
                : [
                    ...evaluatorActors,
                    { networkId: indexIdForActors!, userId: state.userId, role: 'introducer' as const, approved: false },
                  ];

              const candidateUserId = evaluated.actors.find((a) => a.userId !== state.onBehalfOfUserId)?.userId;
              const overlapping = candidateUserId
                ? await this.database.findOpportunitiesByActors(
                    [state.onBehalfOfUserId as Id<'users'>, candidateUserId as Id<'users'>],
                    { excludeStatuses: DEDUP_SKIP_STATUSES },
                  )
                : [];
              if (overlapping.length > 0) {
                const existing = overlapping[0];
                const isRecent = new Date(existing.createdAt).getTime() > Date.now() - DEDUP_WINDOW_MS;
                const sameIntroducer = existing.actors?.some(
                  (actor) => actor.role === 'introducer' && actor.userId === state.userId,
                );

                if (existing.status === 'expired' || existing.status === 'stalled') {
                  // Reactivate expired or stalled opportunities (only if same introducer for expired).
                  // A different introducer creating for an expired pair falls through to new creation —
                  // the prior expiry belongs to the original introducer, not this one.
                  // Stalled opportunities are reactivated regardless of age: a stalled negotiation
                  // is still in-flight for this pair, so we resume it rather than create a parallel one.
                  if (existing.status === 'stalled' || sameIntroducer) {
                    // Introduction path always targets 'draft' (chat-only surface) rather than using
                    // initialStatus, because introductions are always chat-initiated, not background-discovered.
                    const reactivated = await this.database.updateOpportunityStatus(existing.id, 'draft');
                    if (reactivated) {
                      logger.verbose('[Graph:Persist] Reactivated opportunity (introduction path)', {
                        opportunityId: existing.id,
                        candidateUserId,
                        previousStatus: existing.status,
                      });
                      reactivatedOpportunities.push(reactivated);
                    }
                    continue;
                  }
                } else if (existing.status === 'latent') {
                  // Upgrade latent to draft for introduction path
                  const upgraded = await this.database.updateOpportunityStatus(existing.id, 'draft');
                  if (upgraded) {
                    logger.verbose('[Graph:Persist] Upgraded latent opportunity to draft (introduction path)', {
                      opportunityId: existing.id,
                      candidateUserId,
                    });
                    reactivatedOpportunities.push(upgraded);
                  }
                  continue;
                } else if (isRecent && candidateUserId) {
                  // Time-gated skip: only skip if opportunity was created within DEDUP_WINDOW_MS
                  existingBetweenActors.push({
                    candidateUserId: candidateUserId as Id<'users'>,
                    networkId: (state.networkId ?? indexIdForActors ?? '') as Id<'networks'>,
                    existingOpportunityId: existing.id as Id<'opportunities'>,
                    existingStatus: existing.status,
                  });
                  logger.verbose('[Graph:Persist] Skipping recent duplicate (introduction path)', {
                    candidateUserId,
                    existingStatus: existing.status,
                    existingOpportunityId: existing.id,
                  });
                  continue;
                }
                // Else: existing opportunity is old enough, allow new opportunity creation
                logger.verbose('[Graph:Persist] Allowing new opportunity; existing is outside dedup window (introduction path)', {
                  candidateUserId,
                  existingStatus: existing.status,
                  existingOpportunityId: existing.id,
                });
              }

              data = {
                detection: {
                  source: INTRODUCER_DISCOVERY_SOURCE,
                  createdBy: state.userId,
                  createdByName: introducerUserForOnBehalf?.name ?? undefined,
                  timestamp: now,
                },
                actors,
                interpretation: {
                  category: 'collaboration',
                  reasoning: evaluated.reasoning,
                  confidence: evaluated.score / 100,
                  signals: [{
                    type: 'curator_judgment',
                    weight: 1,
                    detail: `Introducer discovery for ${introducerUserForOnBehalf?.name ?? 'a member'} via background maintenance`,
                  }],
                },
                context: {
                  networkId: state.networkId ?? indexIdForActors,
                  ...(state.options.conversationId ? { conversationId: state.options.conversationId } : {}),
                },
                confidence: String(evaluated.score / 100),
                status: initialStatus,
              };
            } else {
              // Discovery path: opportunity_graph source, no introducer, lifecycle guard for agent/patient.
              const evaluatorActors: OpportunityActor[] = evaluated.actors.map((a: EvaluatedOpportunityActor) => ({
                networkId: a.networkId ?? indexIdForActors,
                userId: a.userId,
                role: a.role,
                ...(a.intentId ? { intent: a.intentId } : {}),
              }));
              actors = evaluatorActors;

              const hasIntroducerActor = actors.some(a => a.role === 'introducer');
              if (!hasIntroducerActor) {
                const discovererIdx = actors.findIndex(a => a.userId === state.userId);
                if (discovererIdx >= 0 && actors[discovererIdx].role === 'agent') {
                  const counterpartIdx = actors.findIndex(
                    (a, i) => i !== discovererIdx && a.role === 'patient'
                  );
                  actors[discovererIdx] = { ...actors[discovererIdx], role: 'patient' };
                  if (counterpartIdx >= 0) {
                    actors[counterpartIdx] = { ...actors[counterpartIdx], role: 'agent' };
                  }
                  logger.verbose('[Graph:Persist] Swapped discoverer from agent to patient for lifecycle visibility', {
                    discovererId: state.userId,
                  });
                }
              }

              // Index-agnostic dedup: find ANY existing opportunity between these users,
              // regardless of which index it was created in or whether context.networkId is set.
              const candidateUserId = evaluated.actors.find((a) => a.userId !== state.userId)?.userId;
              logger.verbose('[Graph:Persist:Dedup] Checking overlapping opportunities', {
                stateUserId: state.userId,
                candidateUserId: candidateUserId ?? 'NONE',
                evaluatedActors: evaluated.actors.map(a => ({ userId: a.userId, role: a.role })),
              });
              const overlapping = candidateUserId
                ? await this.database.findOpportunitiesByActors(
                    [state.userId as Id<'users'>, candidateUserId as Id<'users'>],
                    { excludeStatuses: DEDUP_SKIP_STATUSES },
                  )
                : [];
              logger.verbose('[Graph:Persist:Dedup] findOpportunitiesByActors result', {
                count: overlapping.length,
                results: overlapping.map(o => ({ id: o.id, status: o.status, actors: o.actors?.map((a: OpportunityActor) => ({ userId: a.userId, role: a.role })) })),
              });

              if (overlapping.length > 0) {
                const existing = overlapping[0];
                const existingIndexId = (existing.context?.networkId ?? state.networkId ?? state.userNetworks?.[0] ?? '') as Id<'networks'>;
                const isRecent = new Date(existing.createdAt).getTime() > Date.now() - DEDUP_WINDOW_MS;

                if (existing.status === 'expired' || existing.status === 'stalled') {
                  // Reactivate expired or stalled opportunities.
                  // Stalled opportunities are reactivated regardless of age: a stalled negotiation
                  // is still in-flight for this pair, so we resume it rather than create a parallel one.
                  const reactivated = await this.database.updateOpportunityStatus(existing.id, initialStatus);
                  if (reactivated) {
                    logger.verbose('[Graph:Persist] Reactivated opportunity', {
                      opportunityId: existing.id,
                      candidateUserId,
                      previousStatus: existing.status,
                      newStatus: initialStatus,
                    });
                    reactivatedOpportunities.push(reactivated);
                  }
                  continue;
                } else if (existing.status === 'latent' && initialStatus !== 'latent') {
                  // Upgrade latent (background-discovered) to the higher-priority status (e.g. pending)
                  const upgraded = await this.database.updateOpportunityStatus(existing.id, initialStatus);
                  if (upgraded) {
                    logger.verbose('[Graph:Persist] Upgraded latent opportunity to higher-priority status', {
                      opportunityId: existing.id,
                      candidateUserId,
                      previousStatus: 'latent',
                      newStatus: initialStatus,
                    });
                    reactivatedOpportunities.push(upgraded);
                  }
                  continue;
                } else if (isRecent && candidateUserId) {
                  // Time-gated skip: only skip if opportunity was created within DEDUP_WINDOW_MS
                  // This prevents parallel job duplicates while allowing new discoveries for long-connected pairs
                  existingBetweenActors.push({
                    candidateUserId: candidateUserId as Id<'users'>,
                    networkId: existingIndexId,
                    existingOpportunityId: existing.id as Id<'opportunities'>,
                    existingStatus: existing.status,
                  });
                  logger.verbose('[Graph:Persist] Skipping recent duplicate; opportunity created within dedup window', {
                    candidateUserId,
                    existingStatus: existing.status,
                    existingOpportunityId: existing.id,
                    createdAt: existing.createdAt,
                  });
                  continue;
                }
                // Else: existing opportunity is old enough (>10 min), allow new opportunity creation
                logger.verbose('[Graph:Persist] Allowing new opportunity; existing is outside dedup window', {
                  candidateUserId,
                  existingStatus: existing.status,
                  existingOpportunityId: existing.id,
                  createdAt: existing.createdAt,
                });
              }

              data = {
                detection: {
                  source: 'opportunity_graph',
                  createdBy: 'agent-opportunity-finder',
                  ...(state.discoverySource === 'intent' && state.resolvedTriggerIntentId
                    ? { triggeredBy: state.resolvedTriggerIntentId }
                    : {}),
                  timestamp: now,
                },
                actors,
                interpretation: {
                  category: 'collaboration',
                  reasoning: evaluated.reasoning,
                  confidence: evaluated.score / 100,
                  signals: [
                    {
                      type: evaluated.actors.some((a) => a.intentId) ? 'intent_match' : 'profile_match',
                      weight: evaluated.score / 100,
                      detail: 'Entity-bundle evaluator',
                    },
                  ],
                },
                context: {
                  ...(state.networkId ? { networkId: state.networkId } : {}),
                  ...(state.options.conversationId ? { conversationId: state.options.conversationId } : {}),
                },
                confidence: String(evaluated.score / 100),
                status: initialStatus,
              };
            }

            try {
              validateOpportunityActors(data.actors);
            } catch (err) {
              logger.warn('[Graph:Persist] Skipping opportunity with invalid actors', {
                error: err instanceof Error ? err.message : String(err),
                opportunityReasoning: evaluated.reasoning?.slice(0, 80),
              });
              continue;
            }

            itemsToPersist.push(data);
          }

          const { created: createdList } = await persistOpportunities({
            database: this.database,
            embedder: this.embedder,
            items: itemsToPersist,
          });

          const allOpportunities = [...reactivatedOpportunities, ...createdList];

          logger.verbose('[Graph:Persist] Persistence complete', {
            created: createdList.length,
            reactivated: reactivatedOpportunities.length,
            existingBetweenActorsCount: existingBetweenActors.length,
            status: initialStatus,
          });
          return {
            opportunities: allOpportunities,
            existingBetweenActors,
            dedupAlreadyAccepted,
            trace: [{
              node: "persist",
              detail: `Created ${createdList.length}, reactivated ${reactivatedOpportunities.length}, ${existingBetweenActors.length} existing skipped, ${dedupAlreadyAccepted.length} already-accepted pair(s)`,
              data: {
                created: createdList.length,
                reactivated: reactivatedOpportunities.length,
                existingSkipped: existingBetweenActors.length,
                alreadyAccepted: dedupAlreadyAccepted.length,
                totalOutput: allOpportunities.length,
                durationMs: Date.now() - startTime,
              },
            }],
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error('[Graph:Persist] Failed', { error });
          return {
            opportunities: [],
            existingBetweenActors: [],
            error: 'Failed to persist opportunities.',
            trace: [{
              node: "persist_fatal",
              detail: `Persist failed: ${errMsg}`,
              data: { error: errMsg },
            }],
          };
        }
      });
    },
      (result) => {
        const r = result as Record<string, unknown>;
        if (r?.error) return `error: ${r.error}`;
        const opps = r?.opportunities as unknown[];
        return opps ? `Persisted ${opps.length} opportunity(ies)` : undefined;
      },
    );

    // ═══════════════════════════════════════════════════════════════
    // CRUD NODES (read, update, delete, send)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Read Node: List opportunities for the user, optionally filtered by networkId.
     * Fast path — no LLM calls.
     */
    const readNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.read", async () => {
        logger.verbose('[Graph:Read] Listing opportunities', {
          userId: state.userId,
          networkId: state.networkId,
        });

        try {
          let indexIdFilter: string | undefined;
          if (state.networkId) {
            const [isMember, isOwner] = await Promise.all([
              this.database.isNetworkMember(state.networkId, state.userId),
              this.database.isIndexOwner(state.networkId, state.userId),
            ]);
            if (!isMember && !isOwner) {
              return {
                readResult: { count: 0, opportunities: [], message: 'Network not found or you are not a member.' },
              };
            }
            indexIdFilter = state.networkId;
          }

          const rawList = await this.database.getOpportunitiesForUser(state.userId, {
            limit: 30,
            ...(indexIdFilter ? { networkId: indexIdFilter } : {}),
          });
          const list = rawList.filter((opp) => opp.status !== 'expired');

          if (list.length === 0) {
            return {
              readResult: {
                count: 0,
                message: 'You have no opportunities yet. Use discover_opportunities to search for connections.',
                opportunities: [],
              },
            };
          }

          // Dedupe by counterpart set (same people = one row) so chat does not show "You and X" per index
          const counterpartKey = (opp: (typeof list)[number]) =>
            opp.actors
              .filter((a: OpportunityActor) => a.userId !== state.userId && a.role !== 'introducer')
              .map((a: OpportunityActor) => a.userId)
              .sort()
              .join(',');
          const byKey = new Map<string, (typeof list)[number]>();
          for (const opp of list) {
            const key = counterpartKey(opp);
            const existing = byKey.get(key);
            const conf = Number(opp.interpretation?.confidence ?? opp.confidence ?? 0);
            const existingConf = existing ? Number(existing.interpretation?.confidence ?? existing.confidence ?? 0) : 0;
            const oppTime = opp.updatedAt instanceof Date ? opp.updatedAt.getTime() : new Date(opp.updatedAt).getTime();
            const existingTime = existing
              ? (existing.updatedAt instanceof Date ? existing.updatedAt.getTime() : new Date(existing.updatedAt).getTime())
              : 0;
            if (!existing || conf > existingConf || (conf === existingConf && oppTime > existingTime)) {
              byKey.set(key, opp);
            }
          }
          const dedupedList = [...byKey.values()];

          const sourceLabel: Record<string, string> = {
            chat: 'Suggested in chat',
            opportunity_graph: 'System match',
            manual: 'Manual',
            cron: 'Scheduled',
            member_added: 'Member added',
            introducer_discovery: 'Suggested by contact',
          };

          const enriched = await Promise.all(
            dedupedList.map(async (opp) => {
              // "Other parties" = all actors who are not the current user (exclude introducer for suggestedBy).
              // Opportunity graph persists roles as 'agent'|'patient'|'peer'; manual/createManual use 'party'.
              const otherParties = opp.actors.filter((a: OpportunityActor) => a.userId !== state.userId && a.role !== 'introducer');
              const introducer = opp.actors.find((a: OpportunityActor) => a.role === 'introducer');
              const partyIds = otherParties.map((a: OpportunityActor) => a.userId);
              const idsToResolve = introducer ? [...partyIds, introducer.userId] : partyIds;
              // Use the counterpart's (non-viewer) networkId — it reflects where the match was found.
              // actors[0] is typically the viewer with an arbitrary first-target-index value.
              const counterpartActor = opp.actors.find((a: OpportunityActor) => a.userId !== state.userId);
              const actorIndexId = counterpartActor?.networkId ?? opp.actors[0]?.networkId;
              const [indexRecord, ...profileAndUserPairs] = await Promise.all([
                actorIndexId ? this.database.getNetwork(actorIndexId) : Promise.resolve(null),
                ...idsToResolve.map(async (uid: string) => {
                  const [profile, user] = await Promise.all([
                    this.database.getProfile(uid),
                    this.database.getUser(uid),
                  ]);
                  return (profile?.identity?.name ?? user?.name ?? 'Unknown') as string;
                }),
              ]);
              const connectedWith = profileAndUserPairs.slice(0, partyIds.length);
              const suggestedBy = introducer ? profileAndUserPairs[partyIds.length] ?? null : null;
              const category = opp.interpretation?.category ?? 'connection';
              const confidence = opp.interpretation?.confidence ?? (opp.confidence ? Number(opp.confidence) : null);
              const source = opp.detection?.source ? (sourceLabel[opp.detection.source] ?? opp.detection.source) : null;
              return {
                id: opp.id,
                indexName: indexRecord?.title ?? (actorIndexId ?? ''),
                connectedWith,
                suggestedBy,
                reasoning: opp.interpretation?.reasoning ?? 'Connection opportunity',
                status: opp.status,
                category,
                confidence: confidence != null ? confidence : null,
                source,
              };
            })
          );

          return {
            readResult: {
              count: enriched.length,
              message: `You have ${enriched.length} opportunity(ies).`,
              opportunities: enriched,
            },
          };
        } catch (err) {
          logger.error('[Graph:Read] Failed', { error: err });
          return {
            readResult: { count: 0, opportunities: [], message: 'Failed to list opportunities.' },
          };
        }
      });
    };

    /**
     * Update Node: Change opportunity status (accept, reject, etc.).
     * For 'accepted', enforces the self-accept guard: the caller's actor entry
     * must not already have `actedAt` set — i.e. the caller has not yet been
     * the one to advance this opportunity's state. Stamps `actedAt` on accept
     * atomically with the status change via `stampOpportunityActorAction`.
     */
    const updateNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.update", async () => {
        logger.verbose('[Graph:Update] Updating opportunity status', {
          userId: state.userId,
          opportunityId: state.opportunityId,
          newStatus: state.newStatus,
        });

        try {
          if (!state.opportunityId) {
            return { mutationResult: { success: false, error: 'opportunityId is required.' } };
          }
          if (!state.newStatus || !['accepted', 'rejected', 'expired'].includes(state.newStatus)) {
            return { mutationResult: { success: false, error: 'newStatus must be one of: accepted, rejected, expired.' } };
          }

          const opp = await this.database.getOpportunity(state.opportunityId);
          if (!opp) {
            return { mutationResult: { success: false, error: 'Opportunity not found.' } };
          }
          const callerActor = opp.actors.find((a: OpportunityActor) => a.userId === state.userId);
          if (!callerActor) {
            return { mutationResult: { success: false, error: 'You are not part of this opportunity.' } };
          }

          // Self-accept guard: only applies to the 'accepted' transition. Reject/expire
          // remain available to all actors regardless of prior actedAt.
          if (state.newStatus === 'accepted' && callerActor.actedAt) {
            return {
              mutationResult: {
                success: false,
                error: 'You have already acted on this opportunity. The other party must accept.',
              },
            };
          }

          let conversationId: string | undefined;
          if (state.newStatus === 'accepted') {
            const counterpart = opp.actors.find(
              (a: OpportunityActor) => a.userId !== state.userId && a.role !== 'introducer'
            );
            if (counterpart) {
              const dm = await this.database.getOrCreateDM(state.userId, counterpart.userId);
              conversationId = dm.id;
            }
          }

          if (state.newStatus === 'accepted') {
            await this.database.stampOpportunityActorAction(
              state.opportunityId,
              state.userId,
              'accepted',
              state.userId,
            );
          } else {
            // Reject/expire do not stamp actedAt on the caller; they are
            // terminal flips, not commit signals. Keep the legacy path.
            await this.database.updateOpportunityStatus(
              state.opportunityId,
              state.newStatus as 'rejected' | 'expired',
            );
          }

          return {
            mutationResult: {
              success: true,
              opportunityId: state.opportunityId,
              message: `Opportunity status updated to ${state.newStatus}.`,
              ...(conversationId && { conversationId }),
            },
          };
        } catch (err) {
          logger.error('[Graph:Update] Failed', { error: err });
          return { mutationResult: { success: false, error: 'Failed to update opportunity.' } };
        }
      });
    };

    /**
     * Delete Node: Expire/archive an opportunity.
     */
    const deleteNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.delete", async () => {
        logger.verbose('[Graph:Delete] Expiring opportunity', {
          userId: state.userId,
          opportunityId: state.opportunityId,
        });

        try {
          if (!state.opportunityId) {
            return { mutationResult: { success: false, error: 'opportunityId is required.' } };
          }

          const opp = await this.database.getOpportunity(state.opportunityId);
          if (!opp) {
            return { mutationResult: { success: false, error: 'Opportunity not found.' } };
          }
          const isActor = opp.actors.some((a: OpportunityActor) => a.userId === state.userId);
          if (!isActor) {
            return { mutationResult: { success: false, error: 'You are not part of this opportunity.' } };
          }

          await this.database.updateOpportunityStatus(state.opportunityId, 'expired');

          return {
            mutationResult: {
              success: true,
              opportunityId: state.opportunityId,
              message: 'Opportunity archived (expired).',
            },
          };
        } catch (err) {
          logger.error('[Graph:Delete] Failed', { error: err });
          return { mutationResult: { success: false, error: 'Failed to delete opportunity.' } };
        }
      });
    };

    /**
     * Send Node: Promote latent or draft opportunity to pending + queue notification.
     */
    const sendNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.send", async () => {
        logger.verbose('[Graph:Send] Sending opportunity', {
          userId: state.userId,
          opportunityId: state.opportunityId,
        });

        try {
          if (!state.opportunityId) {
            return { mutationResult: { success: false, error: 'opportunityId is required.' } };
          }

          const opp = await this.database.getOpportunity(state.opportunityId);
          if (!opp) {
            return { mutationResult: { success: false, error: 'Opportunity not found.' } };
          }
          const canSendStatus = opp.status === 'latent' || opp.status === 'draft';
          if (!canSendStatus) {
            return {
              mutationResult: {
                success: false,
                error: `Opportunity is already ${opp.status}; only latent or draft opportunities can be sent.`,
              },
            };
          }
          const senderActor = opp.actors.find((a: OpportunityActor) => a.userId === state.userId);
          const hasIntroducer = opp.actors.some((a: OpportunityActor) => a.role === 'introducer');
          const canSend =
            senderActor?.role === 'introducer' ||
            senderActor?.role === 'peer' ||
            (senderActor?.role === 'patient' && !hasIntroducer) ||
            (senderActor?.role === 'party' && !hasIntroducer);
          if (!senderActor) {
            return { mutationResult: { success: false, error: 'You are not part of this opportunity.' } };
          }
          if (!canSend) {
            return { mutationResult: { success: false, error: 'You cannot send this opportunity.' } };
          }

          await this.database.stampOpportunityActorAction(
            state.opportunityId,
            state.userId,
            'pending',
          );

          // Notify only the role that becomes visible at the next tier
          let recipients: OpportunityActor[];
          if (senderActor.role === 'introducer') {
            recipients = opp.actors.filter((a: OpportunityActor) => a.role === 'patient' || a.role === 'party');
          } else if (senderActor.role === 'peer') {
            recipients = opp.actors.filter((a: OpportunityActor) => a.role === 'peer' && a.userId !== state.userId);
          } else {
            recipients = opp.actors.filter((a: OpportunityActor) => a.role === 'agent');
          }

          // queueNotification is injected via constructor; if not provided, notifications are skipped.
          const notifier: QueueOpportunityNotificationFn | undefined = this.queueNotification;
          if (notifier) {
            for (const recipient of recipients) {
              await notifier(opp.id, recipient.userId, 'high');
            }
          }

          const recipientIds = recipients.map((a: OpportunityActor) => a.userId);
          return {
            mutationResult: {
              success: true,
              opportunityId: opp.id,
              notified: recipientIds,
              message: 'Opportunity sent. The other person has been notified.',
            },
          };
        } catch (err) {
          logger.error('[Graph:Send] Failed', { error: err });
          return { mutationResult: { success: false, error: 'Failed to send opportunity.' } };
        }
      });
    };

    /**
     * Negotiate Existing Node: Load an existing opportunity by ID and run bilateral negotiation.
     * Used after introducer approval to trigger the normal negotiation flow for a latent opportunity.
     */
    const negotiateExistingNode = async (state: typeof OpportunityGraphState.State) => {
      if (!state.opportunityId) return {};
      if (!this.negotiationGraph) {
        logger.warn('[Graph:NegotiateExisting] No negotiationGraph wired; skipping', {
          opportunityId: state.opportunityId,
        });
        return {};
      }

      try {
        const opp = await this.database.getOpportunity(state.opportunityId as string);
        if (!opp) {
          logger.warn('[Graph:NegotiateExisting] Opportunity not found', { opportunityId: state.opportunityId });
          return {};
        }

        const actors = opp.actors as OpportunityActor[];
        const nonIntroducerActors = actors.filter(a => a.role !== 'introducer');

        // Find the sourceActor: non-introducer with role patient or party, fallback to first non-introducer
        const sourceActor = nonIntroducerActors.find(a => a.role === 'patient' || a.role === 'party')
          ?? nonIntroducerActors[0];
        if (!sourceActor) {
          logger.warn('[Graph:NegotiateExisting] No source actor found', { opportunityId: state.opportunityId });
          return {};
        }

        // Find the candidateActor: non-introducer that is NOT the sourceActor
        const candidateActor = nonIntroducerActors.find(a => a.userId !== sourceActor.userId);
        if (!candidateActor) {
          logger.warn('[Graph:NegotiateExisting] No candidate actor found', { opportunityId: state.opportunityId });
          return {};
        }

        // Load user data for both actors in parallel
        const [sourceUserAccount, sourceProfile, sourceIntents, candidateAccount, candidateProfile, candidateIntents] =
          await Promise.all([
            this.database.getUser(sourceActor.userId).catch(() => null),
            this.database.getProfile(sourceActor.userId).catch(() => null),
            this.database.getActiveIntents(sourceActor.userId).catch(() => [] as ActiveIntent[]),
            this.database.getUser(candidateActor.userId).catch(() => null),
            this.database.getProfile(candidateActor.userId).catch(() => null),
            this.database.getActiveIntents(candidateActor.userId).catch(() => [] as ActiveIntent[]),
          ]);

        const toNegIntent = (ai: ActiveIntent) => ({
          id: ai.id as string,
          title: ai.summary ?? '',
          description: ai.payload ?? '',
          confidence: 1,
        });

        const sourceUser = {
          id: sourceActor.userId,
          intents: sourceIntents.slice(0, 5).map(toNegIntent),
          profile: {
            name: sourceProfile?.identity?.name ?? sourceUserAccount?.name,
            bio: sourceProfile?.identity?.bio ?? sourceUserAccount?.intro ?? undefined,
            location: sourceProfile?.identity?.location ?? sourceUserAccount?.location ?? undefined,
            skills: sourceProfile?.attributes?.skills,
            interests: sourceProfile?.attributes?.interests,
          },
        };

        const candidateIntentsForNeg = candidateIntents.slice(0, 5).map(toNegIntent);

        const candidate: NegotiationCandidate = {
          userId: candidateActor.userId,
          opportunityId: opp.id as string,
          reasoning: (opp.interpretation as { reasoning?: string } | null)?.reasoning ?? '',
          valencyRole: candidateActor.role ?? 'peer',
          networkId: (candidateActor as { networkId?: string }).networkId as string,
          candidateUser: {
            id: candidateActor.userId,
            intents: candidateIntentsForNeg,
            profile: {
              name: candidateProfile?.identity?.name ?? candidateAccount?.name,
              bio: candidateProfile?.identity?.bio ?? candidateAccount?.intro ?? undefined,
              location: candidateProfile?.identity?.location ?? candidateAccount?.location ?? undefined,
              skills: candidateProfile?.attributes?.skills,
              interests: candidateProfile?.attributes?.interests,
            },
          },
        };

        // Load index context for the candidate's network
        const indexContextMap = new Map<string, string>();
        if (candidate.networkId) {
          const ctx = await this.database.getNetworkMemberContext(candidate.networkId, sourceActor.userId).catch(() => null);
          const prompt = [ctx?.indexPrompt, ctx?.memberPrompt]
            .filter((v): v is string => !!v?.trim())
            .join('\n\n');
          if (prompt) indexContextMap.set(candidate.networkId, prompt);
        }

        const acceptedResults = await negotiateCandidates(
          this.negotiationGraph, sourceUser, [candidate],
          { networkId: '', prompt: '' },
          {
            maxTurns: 6,
            indexContextOverrides: indexContextMap,
            timeoutMs: AMBIENT_PARK_WINDOW_MS,
            trigger: 'ambient',
          },
        );

        // Send notifications to non-introducer actors if negotiation was accepted
        if (acceptedResults.length > 0 && this.queueNotification) {
          for (const actor of nonIntroducerActors) {
            await this.queueNotification(opp.id, actor.userId, 'high').catch((err) => {
              logger.warn('[Graph:NegotiateExisting] Failed to queue notification', { actorId: actor.userId, error: err });
            });
          }
        }

        logger.info('[Graph:NegotiateExisting] Negotiation complete', {
          opportunityId: opp.id,
          accepted: acceptedResults.length > 0,
        });
      } catch (err) {
        logger.error('[Graph:NegotiateExisting] Failed', { opportunityId: state.opportunityId, error: err });
        return { error: `Failed to load opportunity: ${err instanceof Error ? err.message : String(err)}` };
      }

      return {};
    };

    /**
     * Node: Approve Introduction
     * Called by the introducer to approve a latent introducer-pattern opportunity.
     * Sets approved=true on the introducer actor (status stays latent), then
     * enqueues a negotiate_existing job so the parties negotiate normally.
     */
    const approveIntroductionNode = async (state: typeof OpportunityGraphState.State) => {
      const { opportunityId, userId } = state;
      if (!opportunityId) {
        return { mutationResult: { success: false, error: 'opportunityId required for approve_introduction' } };
      }

      let opp;
      try {
        opp = await this.database.getOpportunity(opportunityId as string);
      } catch (err) {
        return { mutationResult: { success: false, error: `Failed to load opportunity: ${err instanceof Error ? err.message : String(err)}` } };
      }
      if (!opp) {
        return { mutationResult: { success: false, error: 'Opportunity not found' } };
      }

      const introducerActor = (opp.actors as OpportunityActor[])
        .find(a => a.role === 'introducer' && a.userId === userId);
      if (!introducerActor) {
        return { mutationResult: { success: false, error: 'You are not the introducer for this opportunity' } };
      }
      if (introducerActor.approved === true) {
        return { mutationResult: { success: false, error: 'Introduction already approved' } };
      }

      const updated = await this.database.updateOpportunityActorApproval(opportunityId as string, userId as string, true);
      if (!updated) {
        return { mutationResult: { success: false, error: 'Failed to update approval' } };
      }

      if (this.queueNegotiateExisting) {
        await this.queueNegotiateExisting(opportunityId as string, userId as string);
      }

      return { mutationResult: { success: true, opportunityId } };
    };

    // ═══════════════════════════════════════════════════════════════
    // CONDITIONAL ROUTING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Router: Decides which path based on operationMode.
     */
    const routeByMode = (state: typeof OpportunityGraphState.State): string => {
      const mode = state.operationMode ?? 'create';
      if (mode === 'read') return 'read';
      if (mode === 'update') return 'update';
      if (mode === 'delete') return 'delete_opp';
      if (mode === 'send') return 'send';
      if (mode === 'create_introduction') return 'intro_validation';
      if (mode === 'negotiate_existing') return 'negotiate_existing';
      if (mode === 'approve_introduction') return 'approve_introduction';
      // 'create' is the default discovery pipeline
      return 'prep';
    };

    /**
     * After prep: check if user has indexed intents.
     * Early exit if none (cannot find opportunities).
     */
    const shouldContinueAfterPrep = (state: typeof OpportunityGraphState.State): string => {
      if (state.error) {
        logger.verbose('[Graph:Routing] Error in prep - ending early');
        return END;
      }
      // Continuation mode: skip scope/resolve/discovery, go straight to evaluation
      if (state.operationMode === 'continue_discovery') {
        logger.verbose('[Graph:Routing] Continue discovery → skipping to evaluation', {
          candidatesLoaded: state.candidates.length,
        });
        return 'evaluation';
      }
      logger.verbose('[Graph:Routing] Continuing to scope');
      return 'scope';
    };

    /**
     * After scope: check if we have target indexes.
     */
    const shouldContinueAfterScope = (state: typeof OpportunityGraphState.State): string => {
      if (state.error || state.targetNetworks.length === 0) {
        logger.verbose('[Graph:Routing] No target indexes - ending early');
        return END;
      }
      logger.verbose('[Graph:Routing] Continuing to resolve');
      return 'resolve';
    };

    /**
     * After discovery: if create-intent signal was set, end so tool can return it; else continue to evaluation.
     */
    const shouldContinueAfterDiscovery = (state: typeof OpportunityGraphState.State): string => {
      if (state.createIntentSuggested) {
        logger.verbose('[Graph:Routing] Create-intent suggested - ending for tool signal');
        return END;
      }
      return 'evaluation';
    };

    /**
     * After intro_validation: if validation set state.error, end early; else continue to intro_evaluation.
     */
    const routeAfterIntroValidation = (state: typeof OpportunityGraphState.State): string => {
      if (state.error) {
        logger.verbose('[Graph:Routing] Intro validation error - ending early');
        return END;
      }
      return 'intro_evaluation';
    };

    // ═══════════════════════════════════════════════════════════════
    // GRAPH ASSEMBLY
    // ═══════════════════════════════════════════════════════════════

    const workflow = new StateGraph(OpportunityGraphState)
      // Add all nodes
      .addNode('prep', prepNode)
      .addNode('scope', scopeNode)
      .addNode('resolve', resolveNode)
      .addNode('discovery', discoveryNode)
      .addNode('evaluation', evaluationNode)
      .addNode('ranking', rankingNode)
      .addNode('intro_validation', introValidationNode)
      .addNode('intro_evaluation', introEvaluationNode)
      .addNode('persist', persistNode)
      // CRUD nodes
      .addNode('read', readNode)
      .addNode('update', updateNode)
      .addNode('delete_opp', deleteNode)
      .addNode('send', sendNode)
      .addNode('negotiate_existing', negotiateExistingNode)
      .addNode('approve_introduction', approveIntroductionNode)

      // Route by operation mode from START
      .addConditionalEdges(START, routeByMode, {
        prep: 'prep',
        intro_validation: 'intro_validation',
        read: 'read',
        update: 'update',
        delete_opp: 'delete_opp',
        send: 'send',
        negotiate_existing: 'negotiate_existing',
        approve_introduction: 'approve_introduction',
      })

      // Introduction path: validation -> evaluation -> persist (or END on validation error)
      .addConditionalEdges('intro_validation', routeAfterIntroValidation, {
        intro_evaluation: 'intro_evaluation',
        [END]: END,
      })
      .addEdge('intro_evaluation', 'persist')

      // CRUD fast paths -> END
      .addEdge('read', END)
      .addEdge('update', END)
      .addEdge('delete_opp', END)
      .addEdge('send', END)
      .addEdge('negotiate_existing', END)
      .addEdge('approve_introduction', END)

      // Conditional routing: early exit if no indexed intents
      .addConditionalEdges('prep', shouldContinueAfterPrep, {
        scope: 'scope',
        evaluation: 'evaluation',
        [END]: END,
      })

      // Conditional routing: early exit if no target indexes
      .addConditionalEdges('scope', shouldContinueAfterScope, {
        resolve: 'resolve',
        [END]: END,
      })
      .addEdge('resolve', 'discovery')

      .addConditionalEdges('discovery', shouldContinueAfterDiscovery, {
        evaluation: 'evaluation',
        [END]: END,
      })

      // Discovery → Ranking → Persist → Negotiate (post-persist).
      // Negotiation runs against persisted opportunities so each negotiation receives the
      // opportunity's id and its outcome flips status (pending|stalled|rejected) via the
      // negotiation graph's finalize node. Skipped for continue_discovery and when no
      // negotiation graph or no opportunities were persisted (negotiateNode returns early).
      .addNode('negotiate', negotiateNode)
      .addEdge('evaluation', 'ranking')
      .addEdge('ranking', 'persist')
      .addConditionalEdges('persist', (state) => {
        if (state.operationMode === 'continue_discovery') return END;
        if (!this.negotiationGraph) return END;
        if (!state.opportunities || state.opportunities.length === 0) return END;
        return 'negotiate';
      }, {
        negotiate: 'negotiate',
        [END]: END,
      })
      .addEdge('negotiate', END);

    return workflow.compile();
  }
}
