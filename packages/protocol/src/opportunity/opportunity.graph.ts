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
import type { Id, NegotiationContinuationReceipt } from '../shared/interfaces/database.interface.js';
import type { DebugMetaAgent } from '../chat/chat-streaming.types.js';
import { OpportunityGraphState, type IndexedIntent, type SourceProfileData, type TargetNetwork, type CandidateMatch, type EvaluatedCandidate, type EvaluatedOpportunity, type EvaluatedOpportunityActor } from './opportunity.state.js';
import { resolveInitialStatus } from './opportunity.state.js';
import { OpportunityEvaluator, type CandidateProfile, type EvaluatedOpportunityWithActors, type EvaluatorEntity, type EvaluatorInput } from './opportunity.evaluator.js';
import type { OpportunityGraphDatabase } from '../shared/interfaces/database.interface.js';
import { IntentIndexer } from '../intent/intent.indexer.js';
import { getModelName } from '../shared/agent/model.config.js';
import { selectHydeDocumentsForGeneration } from '../shared/hyde/hyde.documents.js';
import { getHydeGenerationMode } from '../shared/hyde/hyde.env.js';
import { validateOpportunityActors } from './opportunity.utils.js';
import { safeFallbackSummary } from './opportunity.safe-presentation.js';
import { hasUnsupportedOpportunityClaim } from './opportunity.claim-safety.js';

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
    actors: Array<{ userId: string; role: 'agent' | 'patient' | 'peer'; intentId?: string | null; evidenceKey?: string | null }>;
  }>>;
};
import type { Embedder, LensEmbedding } from '../shared/interfaces/embedder.interface.js';
import type { ActiveIntent, CreateOpportunityData, Opportunity, OpportunityActor, OpportunityNetworkEligibility, OpportunityStatus } from '../shared/interfaces/database.interface.js';
import { persistOpportunities } from './opportunity.persist.js';
import { INTRODUCER_DISCOVERY_SOURCE } from './opportunity.introducer.js';
import { negotiateCandidates, type NegotiationCandidate, type OnNegotiationResolved } from "../negotiation/negotiation.graph.js";
import { ASK_USER_LOCK_SLACK_MS, askUserAnswerWindowMs } from "../negotiation/negotiation.protocol.js";
import { AMBIENT_PARK_WINDOW_MS } from "../negotiation/negotiation.tools.js";
import { buildDiscoverySummary, toDiscoveryNegotiation, type NegotiationResolution } from "./negotiation-summary.builder.js";
import type { NegotiationGraphLike, UserNegotiationContext } from "../negotiation/negotiation.state.js";
import type { AgentDispatcher } from "../shared/interfaces/agent-dispatcher.interface.js";
import { protocolLogger, withCallLogging } from '../shared/observability/protocol.logger.js';
import { timed } from '../shared/observability/performance.js';
import { renderNetworkContext } from '../shared/network/metadata.renderer.js';
import { requestContext } from "../shared/observability/request-context.js";
import type { OpportunityEvidence } from '../shared/schemas/network-assignment.schema.js';
import { mergeOpportunityEvidence, withCandidateEvidence, withMatchedStrategies } from './opportunity.evidence.js';
import { normalizeOpportunityActorIntent, resolveOpportunityActorIntent } from './opportunity.actor.js';

const logger = protocolLogger('OpportunityGraph');
const prepLog = protocolLogger('OpportunityGraph:Prep');
const scopeLog = protocolLogger('OpportunityGraph:Scope');
const resolveLog = protocolLogger('OpportunityGraph:Resolve');
const discoveryLog = protocolLogger('OpportunityGraph:Discovery');
const evaluationLog = protocolLogger('OpportunityGraph:Evaluation');
const negotiateLog = protocolLogger('OpportunityGraph:Negotiate');
const rankingLog = protocolLogger('OpportunityGraph:Ranking');
const introValidationLog = protocolLogger('OpportunityGraph:IntroValidation');
const introEvaluationLog = protocolLogger('OpportunityGraph:IntroEvaluation');
const persistLog = protocolLogger('OpportunityGraph:Persist');
const persistPathLog = protocolLogger('OpportunityGraph:Persist:PathSelect');
const persistDedupLog = protocolLogger('OpportunityGraph:Persist:Dedup');
const readLog = protocolLogger('OpportunityGraph:Read');
const updateLog = protocolLogger('OpportunityGraph:Update');
const deleteLog = protocolLogger('OpportunityGraph:Delete');
const sendLog = protocolLogger('OpportunityGraph:Send');
const negotiateExistingLog = protocolLogger('OpportunityGraph:NegotiateExisting');
const routingLog = protocolLogger('OpportunityGraph:Routing');

/** Time window for persist-node dedup. Suppresses a second opportunity with the same person while a recent one (within 30 days) is still in flight, so a person is not re-surfaced multiple times within a month (EDG-23). */
const DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * IND-567: Cool-down window (ms) for cross-query rejection suppression.
 * Candidates with a recently rejected or stalled opportunity within this window
 * receive a similarity penalty during evaluation ranking. Default 7 days.
 * Override with DISCOVERY_REJECTION_COOLDOWN_DAYS (positive float).
 */
const DEFAULT_REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
function getRejectionCooldownMs(): number {
  const raw = process.env.DISCOVERY_REJECTION_COOLDOWN_DAYS;
  if (!raw) return DEFAULT_REJECTION_COOLDOWN_MS;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 24 * 60 * 60 * 1000) : DEFAULT_REJECTION_COOLDOWN_MS;
}

/**
 * Similarity multiplier applied to candidates that fall within the rejection
 * cool-down window (IND-567). 0.5 halves their ranking score, typically
 * pushing them below the evaluation-batch cut while leaving a soft trace in
 * the trace log rather than silently dropping them.
 */
const REJECTION_COOLDOWN_SIMILARITY_PENALTY = 0.5;
const NEGOTIATION_INTENT_LIMIT = 5;
const ACTIVE_NEGOTIATION_TASK_STATES = new Set([
  'submitted',
  'working',
  'input_required',
  'waiting_for_agent',
  'claimed',
]);

function isActiveNegotiationTaskFresh(task: { state: string; updatedAt: Date }): boolean {
  if (!ACTIVE_NEGOTIATION_TASK_STATES.has(task.state)) return false;
  const freshnessMs = task.state === 'input_required'
    ? askUserAnswerWindowMs() + ASK_USER_LOCK_SLACK_MS
    : 5 * 60 * 1000;
  return Date.now() - new Date(task.updatedAt).getTime() < freshnessMs;
}

function triggerForOwner(opportunity: Opportunity, ownerUserId: string): string | undefined {
  return opportunity.detection.triggeredBy
    ?? opportunity.actors.find((actor) => actor.userId === ownerUserId)?.intent;
}

function belongsToOwnedIntent(
  opportunity: Opportunity,
  ownerUserId: string,
  triggerIntentId: string,
): boolean {
  return opportunity.detection.triggeredBy === triggerIntentId
    || opportunity.actors.some((actor) =>
      actor.userId === ownerUserId && actor.intent === triggerIntentId);
}

interface NegotiationIntentSource {
  id?: string | null;
  summary?: string | null;
  payload?: string | null;
}

/** Put an opportunity actor's exact intent first, then fill the bounded context without duplicates. */
export function buildPrioritizedNegotiationIntents(
  activeIntents: readonly NegotiationIntentSource[],
  exactIntentId?: string | null,
  fallbackIntent?: NegotiationIntentSource | null,
): UserNegotiationContext['intents'] {
  const exactId = typeof exactIntentId === 'string' && exactIntentId.trim().length > 0
    ? exactIntentId
    : null;
  const exactActive = exactId
    ? activeIntents.find((intent) => intent.id === exactId)
    : undefined;
  const ordered = [
    ...(exactActive ? [exactActive] : []),
    ...(!exactActive && fallbackIntent?.id === exactId ? [fallbackIntent] : []),
    ...activeIntents,
  ];
  const seen = new Set<string>();
  const intents: UserNegotiationContext['intents'] = [];

  for (const intent of ordered) {
    if (typeof intent.id !== 'string' || intent.id.trim().length === 0 || seen.has(intent.id)) continue;
    seen.add(intent.id);
    intents.push({
      id: intent.id,
      title: intent.summary ?? '',
      description: intent.payload ?? '',
      confidence: 1,
    });
    if (intents.length === NEGOTIATION_INTENT_LIMIT) break;
  }

  return intents;
}

/** Default cap for source premises used by premise-to-premise discovery. Prevents BACKEND-5-style fan-out. */
const DEFAULT_SOURCE_PREMISE_DISCOVERY_LIMIT = 40;

function networkMembershipPairKey(userId: string, networkId: string): string {
  return `${userId}\u0000${networkId}`;
}

/** Per-source cap for candidate premise matches. */
const PREMISE_MATCH_LIMIT_PER_SOURCE = 20;

/** Resolve the source premise discovery cap from env, preserving 0 as an explicit disable switch. */
function getSourcePremiseDiscoveryLimit(): number {
  const raw = process.env.DISCOVERY_SOURCE_PREMISE_LIMIT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_SOURCE_PREMISE_DISCOVERY_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SOURCE_PREMISE_DISCOVERY_LIMIT;
}

function buildEvaluatorEvidenceKey(candidate: CandidateMatch): string {
  return [
    candidate.candidateUserId,
    candidate.networkId,
    candidate.candidateIntentId ?? candidate.candidatePremiseId ?? candidate.sourceContextId ?? 'profile',
  ].join(':');
}

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

/** Input for the host-side newborn pool-preference stamper (IND-420 P4b). */
export interface StampNewbornOpportunitiesInput {
  ownerUserId: string;
  intentId: string;
  items: CreateOpportunityData[];
}

/**
 * Optional host callback that stamps call-local create items before INSERT.
 * It must preserve array length/order and may only enrich metadata/signals.
 */
export type StampNewbornOpportunitiesFn = (
  input: StampNewbornOpportunitiesInput,
) => Promise<CreateOpportunityData[]>;

function copyCreateOpportunityData(item: CreateOpportunityData): CreateOpportunityData {
  return {
    ...item,
    detection: { ...item.detection },
    actors: item.actors.map((actor) => ({ ...actor })),
    interpretation: {
      ...item.interpretation,
      signals: item.interpretation.signals?.map((signal) => ({ ...signal })),
    },
    context: { ...item.context },
    metadata: item.metadata ? { ...item.metadata } : item.metadata,
  };
}

/** Fields a stamper is not allowed to change; also protects candidate order. */
function newbornItemIdentity(item: CreateOpportunityData): string {
  return JSON.stringify({
    detection: item.detection,
    actors: item.actors,
    interpretation: {
      category: item.interpretation.category,
      reasoning: item.interpretation.reasoning,
      confidence: item.interpretation.confidence,
    },
    context: item.context,
    confidence: item.confidence,
    status: item.status,
    expiresAt: item.expiresAt?.toISOString(),
  });
}

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
    if (identity?.name || identity?.bio) {
      lines.push(`Profile: ${[identity.name, identity.bio].filter(Boolean).join(', ')}`);
    }
    if (identity?.location) {
      lines.push(`Location: ${identity.location}`);
    }
    if (profile.context) {
      lines.push(`Context: ${profile.context}`);
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
 * Build a networkContexts map for the evaluator from a set of entities.
 * Fetches network data, checks permissions.contextInjection.discovery,
 * and renders context for eligible networks.
 */
async function buildNetworkContexts(
  entities: EvaluatorEntity[],
  database: Pick<OpportunityGraphDatabase, 'getNetwork'>,
): Promise<Record<string, string>> {
  const networkIds = [...new Set(entities.map((e) => e.networkId))];
  const networks = await Promise.all(networkIds.map((nid) => database.getNetwork(nid).then((n) => ({ nid, n }))));
  const contexts: Record<string, string> = {};
  for (const { nid, n: network } of networks) {
    if (!network) continue;
    const perms = (network.permissions ?? {}) as Record<string, unknown>;
    const injection = perms.contextInjection as { discovery?: boolean } | undefined;
    if (injection?.discovery === false) continue;
    contexts[nid] = renderNetworkContext({
      type: network.type ?? 'community',
      title: network.title,
      prompt: network.prompt,
      metadata: network.metadata ?? {},
    });
  }
  return contexts;
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
        lenses?: Array<{ label: string; corpus: 'profiles' | 'intents' | 'premises' }>;
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
    private agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>,
    /**
     * Callback to enqueue a negotiate_existing job for an opportunity.
     * When provided, negotiate_existing mode uses this to queue follow-up
     * negotiations after introducer approval.
     */
    private queueNegotiateExisting?: (opportunityId: string, userId: string) => Promise<void>,
    /** Host-side P4b stamper. Omitted by manual/introducer/enrichment roots. */
    private stampNewbornOpportunities?: StampNewbornOpportunitiesFn,
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
     * Fetches user's network memberships and validates requirements.
     * Returns empty if user has no network memberships (requirement).
     */
    const prepNode = withNodeTrace(
      "opportunity-prep",
      async (state: typeof OpportunityGraphState.State) =>
      timed("OpportunityGraph.prep", async () =>
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
            const memberships = await this.database.getNetworkMemberships(state.userId);
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
                  identity: profile.identity ?? undefined,
                  context: profile.context ?? undefined,
                }
              : null;
            // Source premises are loaded after scope is resolved so premise discovery
            // only uses premises assigned to the target network(s), and only up to
            // DISCOVERY_SOURCE_PREMISE_LIMIT. Loading all premises here caused
            // BACKEND-5: thousands of parallel vector searches for premise-rich users.
            const sourcePremises: Array<{ premiseId: Id<'premises'>; embedding: number[] }> = [];
            const contextToIntentEnabled = process.env.DISCOVERY_CONTEXT_TO_INTENT !== '0';
            const rawContexts = contextToIntentEnabled && typeof this.database.getUserContexts === 'function'
              ? await this.database.getUserContexts(discoveryUserId)
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
        scopeLog.verbose('Determining search scope', {
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
              await this.database.getNetworkIdsForIntent(state.triggerIntentId),
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
              const index = await this.database.getNetwork(networkId);
              const memberCount = await this.database.getNetworkMemberCount(networkId);
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
              const scores = await this.database.getIntentIndexScores(state.triggerIntentId);
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
                const ctx = await this.database.getNetworkMemberContext(ti.networkId, state.userId);
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
            const inNetwork = await this.database.getNetworkIdsForIntent(state.triggerIntentId);
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
              const inNetwork = await this.database.getNetworkIdsForIntent(matched.intentId);
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
    },
      (result) => {
        const r = result as Record<string, unknown>;
        if (r?.error) return `error: ${r.error}`;
        return r?.discoverySource ? `source: ${r.discoverySource}` : undefined;
      },
    );

    /**
     * Node 3: Discovery
     * Generates HyDE embeddings and performs semantic search.
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
          discoveryLog.verbose('targetUserId filter applied', {
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

        discoveryLog.verbose('Starting semantic search', {
          targetIndexesCount: state.targetNetworks.length,
          discoverySource: state.discoverySource,
          searchQueryPreview: state.searchQuery?.trim().slice(0, 60) ?? '(none)',
        });

        try {
          if (state.targetNetworks.length === 0) {
            discoveryLog.warn('No target indexes for search');
            return { candidates: [] };
          }

          // ── Direct-connection fast path ──
          // When targetUserId is set (user @-mentioned someone), bypass vector search
          // and construct candidates directly from shared networks.
          if (state.targetUserId) {
            if (state.targetUserId === discoveryUserId) {
              discoveryLog.warn('Direct-connection target matches discoverer; skipping self-match', {
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
            discoveryLog.verbose('Direct-connection mode — bypassing vector search', {
              targetUserId: state.targetUserId,
            });
            const targetMemberships = await this.database.getNetworkMemberships(state.targetUserId);
            const targetUserIndexIds = targetMemberships.map(m => m.networkId);
            const sharedIndexIds = state.targetNetworks
              .filter(ti => targetUserIndexIds.includes(ti.networkId))
              .map(ti => ti.networkId);

            if (sharedIndexIds.length === 0) {
              discoveryLog.warn('Target user shares no indexes with discoverer', {
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
              // Build one candidate per intent per shared network it belongs to
              for (const intent of targetIntents) {
                const intentNetworkIds = await this.database.getNetworkIdsForIntent(intent.id);
                const overlapping = sharedIndexIds.filter(id => intentNetworkIds.includes(id));
                for (const networkId of overlapping) {
                  directCandidates.push(withCandidateEvidence({
                    candidateUserId: state.targetUserId,
                    candidateIntentId: intent.id as Id<'intents'>,
                    networkId,
                    similarity: 1.0,
                    lens: 'explicit_mention',
                    candidatePayload: intent.payload,
                    candidateSummary: intent.summary ?? undefined,
                    discoverySource: 'query',
                  }));
                }
              }
            }

            // Always add a profile-level candidate (so evaluation runs even without intents)
            if (directCandidates.length === 0) {
              directCandidates.push(withCandidateEvidence({
                candidateUserId: state.targetUserId,
                networkId: sharedIndexIds[0] as Id<'networks'>,
                similarity: 1.0,
                lens: 'explicit_mention',
                candidatePayload: '',
                candidateSummary: undefined,
                discoverySource: 'query',
              }));
            }

            discoveryLog.verbose('Direct candidates constructed', {
              count: directCandidates.length,
              sharedIndexes: sharedIndexIds.length,
              targetIntents: targetIntents.length,
            });

            return {
              candidates: directCandidates,
              trace: [{
                node: "discovery",
                detail: `Direct connection → ${directCandidates.length} candidate(s) from ${sharedIndexIds.length} shared network(es)`,
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

          if (state.discoverySource === 'context') {
            // Context discovery: HyDE (when search query exists) + premise-to-premise.
            if (state.searchQuery?.trim()) {
              discoveryLog.verbose('Context source with searchQuery → running query HyDE + premise paths', {
                searchQuery: state.searchQuery.trim().substring(0, 80),
              });
              const queryCandidates = await runQueryHydeDiscovery();
              discoveryLog.verbose('Query HyDE path complete', { candidatesFound: queryCandidates.length });

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

              const [premiseCands, contextCands] = await Promise.all([
                runPremiseDiscovery(),
                runContextToIntentDiscovery(),
              ]);
              const withPremisesAndContext = mergeStrategyCandidates(queryCandidates, premiseCands, contextCands);
              if (premiseCands.length > 0) {
                traceEntries.push({ node: "strategy", detail: `premise-to-premise → ${premiseCands.length} candidate(s)` });
              }
              if (contextCands.length > 0) {
                traceEntries.push({ node: "strategy", detail: `context-to-intent → ${contextCands.length} candidate(s)` });
              }
              return { candidates: filterByTarget(withPremisesAndContext), trace: traceEntries };
            }

            // No search query — premise-to-premise + context-to-intent discovery
            const [premiseCands, contextCands] = await Promise.all([
              runPremiseDiscovery(),
              runContextToIntentDiscovery(),
            ]);
            if (premiseCands.length > 0 || contextCands.length > 0) {
              const merged = mergeStrategyCandidates(premiseCands, contextCands);
              const traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> = [];
              if (premiseCands.length > 0) {
                traceEntries.push({ node: "strategy", detail: `premise-to-premise → ${premiseCands.length} candidate(s)` });
              }
              if (contextCands.length > 0) {
                traceEntries.push({ node: "strategy", detail: `context-to-intent → ${contextCands.length} candidate(s)` });
              }
              traceEntries.push({
                node: "discovery",
                detail: `${[premiseCands.length > 0 && 'premise-to-premise', contextCands.length > 0 && 'context-to-intent'].filter(Boolean).length} strategies → ${premiseCands.length + contextCands.length} raw, ${merged.length} after dedup`,
              });
              return { candidates: filterByTarget(merged), trace: traceEntries };
            }
            return { candidates: [] };
          }

          async function runQueryHydeDiscovery(): Promise<CandidateMatch[]> {
            const searchText = state.searchQuery?.trim() ?? '';
            if (!searchText) return [];
            discoveryLog.verbose('runQueryHydeDiscovery start', { searchText: searchText.slice(0, 80) });
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
            discoveryLog.verbose('HyDE generator result', {
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
                  all.push(withCandidateEvidence({
                    candidateUserId: r.userId as Id<'users'>,
                    candidateIntentId: r.id as Id<'intents'>,
                    networkId: targetIndex.networkId,
                    similarity: r.score,
                    lens: r.matchedVia,
                    candidatePayload: '',
                    candidateSummary: undefined,
                    discoverySource: 'query' as const,
                  }));
                }
                for (const r of results.filter((x) => x.type === 'premise')) {
                  all.push(withCandidateEvidence({
                    candidateUserId: r.userId as Id<'users'>,
                    candidatePremiseId: r.id as Id<'premises'>,
                    networkId: targetIndex.networkId,
                    similarity: r.score,
                    lens: r.matchedVia,
                    candidatePayload: '',
                    candidateSummary: undefined,
                    discoverySource: 'query' as const,
                  }));
                }
              })
            );
            const intentCount = all.filter((c) => c.candidateIntentId).length;
            const premiseCount = all.filter((c) => c.candidatePremiseId).length;
            discoveryLog.verbose('searchWithHydeEmbeddings raw results', {
              total: all.length,
              fromIntent: intentCount,
              fromPremise: premiseCount,
            });
            const byKey = new Map<string, CandidateMatch>();
            for (const c of all) {
              // Dedup by candidateUserId + entity (intent or premise), NOT by indexId.
              // Including indexId caused the same user to appear once per index they belong to.
              const entityKey = c.candidateIntentId ? `intent:${c.candidateIntentId}` : `premise:${c.candidatePremiseId}`;
              const key = `${c.candidateUserId}:${entityKey}`;
              if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
                byKey.set(key, c);
              }
            }
            return Array.from(byKey.values());
          }

          /**
           * Premise-to-premise discovery (path D).
           * Searches for other users' premises similar to the discoverer's premises,
           * scoped to target networks. Additive — merges into existing candidates.
           */
          async function runPremiseDiscovery(): Promise<CandidateMatch[]> {
            const targetNetworkIds = state.targetNetworks.map(t => t.networkId);
            if (targetNetworkIds.length === 0) return [];

            const sourceLimit = getSourcePremiseDiscoveryLimit();
            if (sourceLimit === 0) {
              discoveryLog.verbose('runPremiseDiscovery disabled by DISCOVERY_SOURCE_PREMISE_LIMIT=0');
              return [];
            }

            const sourcePremisesFromDb = self.database.getPremisesForUserInNetworks
              ? await self.database.getPremisesForUserInNetworks(discoveryUserId, targetNetworkIds, 'ACTIVE', sourceLimit)
              : await self.database.getPremisesForUser(discoveryUserId, 'ACTIVE');
            const sourcePremises = (sourcePremisesFromDb.length > 0
              ? sourcePremisesFromDb
                  .filter(p => Array.isArray(p.embedding) && p.embedding.length > 0)
                  .slice(0, sourceLimit)
                  .map(p => ({ premiseId: p.id as Id<'premises'>, embedding: p.embedding! }))
              : (state.sourcePremises ?? []).slice(0, sourceLimit)
            );

            if (sourcePremises.length === 0) return [];

            discoveryLog.verbose('runPremiseDiscovery start', {
              premiseCount: sourcePremises.length,
              sourceLimit,
              targetNetworks: targetNetworkIds.length,
              batched: !!self.database.searchPremisesBySimilarityBatch,
            });

            const rawResults = self.database.searchPremisesBySimilarityBatch
              ? await self.database.searchPremisesBySimilarityBatch({
                  sources: sourcePremises,
                  networkIds: targetNetworkIds,
                  excludeUserId: discoveryUserId,
                  limitPerSource: PREMISE_MATCH_LIMIT_PER_SOURCE,
                })
              : (await Promise.all(
                  sourcePremises.map(async (sp) => {
                    const results = await self.database.searchPremisesBySimilarity({
                      embedding: sp.embedding,
                      networkIds: targetNetworkIds,
                      excludeUserId: discoveryUserId,
                      limit: PREMISE_MATCH_LIMIT_PER_SOURCE,
                    });
                    return results.map((r) => ({ ...r, sourcePremiseId: sp.premiseId }));
                  })
                )).flat();

            const premiseCandidates: CandidateMatch[] = [];
            for (const r of rawResults) {
              premiseCandidates.push(withCandidateEvidence({
                candidateUserId: r.userId as Id<'users'>,
                sourcePremiseId: r.sourcePremiseId as Id<'premises'> | undefined,
                candidatePremiseId: r.premiseId as Id<'premises'>,
                networkId: r.networkId as Id<'networks'>,
                similarity: typeof r.similarity === 'number' ? r.similarity : parseFloat(String(r.similarity)),
                lens: 'premise_match',
                candidatePayload: r.assertionText ?? '',
                discoverySource: 'premise-similarity',
              }));
            }

            // Dedup by userId + premiseId + networkId (a premise can appear in multiple networks)
            const byKey = new Map<string, CandidateMatch>();
            for (const c of premiseCandidates) {
              const key = `${c.candidateUserId}:${c.candidatePremiseId ?? 'none'}:${c.networkId}`;
              if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
                byKey.set(key, c);
              }
            }
            const deduped = Array.from(byKey.values());
            discoveryLog.verbose('runPremiseDiscovery complete', {
              sourcePremiseCount: sourcePremises.length,
              rawCount: premiseCandidates.length,
              dedupedCount: deduped.length,
            });
            return deduped;
          }

          /**
           * Context-to-intent discovery: searches intents using context HyDE embeddings.
           * When HyDE documents exist for a context, uses optimised hypothetical-document
           * embeddings via searchWithHydeEmbeddings. Falls back to raw context embedding
           * via searchIntentsByContextEmbedding when no HyDE docs are available.
           */
          async function runContextToIntentDiscovery(): Promise<CandidateMatch[]> {
            if (!state.sourceContexts?.length) return [];
            const contextToIntentEnabled = process.env.DISCOVERY_CONTEXT_TO_INTENT !== '0';
            if (!contextToIntentEnabled) return [];

            const targetNetworkIds = state.targetNetworks.map(t => t.networkId);
            if (targetNetworkIds.length === 0) return [];

            discoveryLog.verbose('runContextToIntentDiscovery start', {
              contextCount: state.sourceContexts.length,
              targetNetworks: targetNetworkIds.length,
            });

            const contextCandidates: CandidateMatch[] = [];

            for (const ctx of state.sourceContexts.filter(c => targetNetworkIds.includes(c.networkId))) {
              // Attempt HyDE-enhanced search first
              const persistedHydeDocs = await self.database.getHydeDocumentsForSource('context', ctx.contextId);
              const hydeDocs = selectHydeDocumentsForGeneration(
                persistedHydeDocs,
                getHydeGenerationMode(),
                ctx.text,
              );
              const lensEmbeddings: LensEmbedding[] = hydeDocs
                .filter(d => d.hydeEmbedding?.length > 0)
                .map(d => ({
                  lens: d.strategy,
                  corpus: (d.targetCorpus === 'intents' ? 'intents' : d.targetCorpus === 'premises' ? 'premises' : 'intents') as 'intents' | 'premises' | 'profiles',
                  embedding: d.hydeEmbedding,
                }));

              if (lensEmbeddings.length > 0) {
                // HyDE-enhanced search: same path as query HyDE, scoped to this context's network
                const results = await self.embedder.searchWithHydeEmbeddings(lensEmbeddings, {
                  indexScope: [ctx.networkId],
                  excludeUserId: discoveryUserId,
                  limitPerStrategy: limitPerStrategy,
                  limit: 20,
                  minScore,
                });
                for (const r of results.filter(r => r.type === 'intent')) {
                  contextCandidates.push(withCandidateEvidence({
                    candidateUserId: r.userId as Id<'users'>,
                    candidateIntentId: r.id as Id<'intents'>,
                    sourceContextId: ctx.contextId,
                    networkId: ctx.networkId,
                    similarity: r.score,
                    lens: r.matchedVia,
                    candidatePayload: '',
                    candidateSummary: undefined,
                    discoverySource: 'context-to-intent',
                  }));
                }
              } else {
                // Fallback: raw context embedding search (no HyDE docs yet)
                const results = await self.database.searchIntentsByContextEmbedding({
                  embedding: ctx.embedding,
                  networkIds: [ctx.networkId],
                  excludeUserId: discoveryUserId,
                  limit: 20,
                  minScore: minScore,
                });
                for (const r of results) {
                  contextCandidates.push(withCandidateEvidence({
                    candidateUserId: r.userId as Id<'users'>,
                    candidateIntentId: r.intentId as Id<'intents'>,
                    sourceContextId: ctx.contextId,
                    networkId: r.networkId as Id<'networks'>,
                    similarity: typeof r.similarity === 'number' ? r.similarity : parseFloat(String(r.similarity)),
                    lens: 'context_match',
                    candidatePayload: r.payload ?? '',
                    candidateSummary: r.summary ?? undefined,
                    discoverySource: 'context-to-intent',
                  }));
                }
              }
            }

            const byKey = new Map<string, CandidateMatch>();
            for (const c of contextCandidates) {
              const key = `${c.candidateUserId}:${c.candidateIntentId ?? 'none'}:${c.networkId}`;
              if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
                byKey.set(key, c);
              }
            }
            const deduped = Array.from(byKey.values());
            discoveryLog.verbose('runContextToIntentDiscovery complete', {
              rawCount: contextCandidates.length,
              dedupedCount: deduped.length,
            });
            return deduped;
          }

          /**
           * Merge candidates from multiple strategies. Deduplicates by userId + networkId + entityId,
           * keeps the highest similarity, tracks which strategies found each candidate,
           * and applies a multi-strategy boost (+0.05 per additional strategy, boost capped at 0.15,
           * final similarity capped at 1.0).
           */
          function mergeStrategyCandidates(...groups: CandidateMatch[][]): CandidateMatch[] {
            const merged = new Map<string, CandidateMatch & { _strategies: Set<string> }>();
            for (const group of groups) {
              for (const c of group) {
                const entityId = c.candidateIntentId ?? c.candidatePremiseId ?? 'none';
                const key = `${c.candidateUserId}:${c.networkId}:${entityId}`;
                const existing = merged.get(key);
                if (!existing) {
                  merged.set(key, { ...c, _strategies: new Set([c.discoverySource ?? 'unknown']) });
                } else {
                  existing._strategies.add(c.discoverySource ?? 'unknown');
                  const mergedEvidence = mergeOpportunityEvidence(existing.evidence, c.evidence);
                  if (c.similarity > existing.similarity) {
                    Object.assign(existing, { ...c, evidence: mergedEvidence });
                  } else {
                    existing.evidence = mergedEvidence;
                  }
                }
              }
            }
            return Array.from(merged.values()).map(({ _strategies, ...c }) => {
              const matchedStrategies = Array.from(_strategies);
              const boost = Math.min((_strategies.size - 1) * 0.05, 0.15);
              return {
                ...c,
                similarity: Math.min(c.similarity + boost, 1.0),
                matchedStrategies,
                evidence: withMatchedStrategies(mergeOpportunityEvidence(c.evidence), matchedStrategies),
              };
            });
          }

          const resolvedIntent = state.resolvedTriggerIntentId
            ? state.indexedIntents.find((i) => i.intentId === state.resolvedTriggerIntentId)
            : state.indexedIntents[0];
          const searchText = state.searchQuery ?? resolvedIntent?.payload ?? '';
          if (!searchText) {
            discoveryLog.warn('No search text available for intent path');
            const [premiseCands, contextCands] = await Promise.all([
              runPremiseDiscovery(),
              runContextToIntentDiscovery(),
            ]);
            const merged = mergeStrategyCandidates(premiseCands, contextCands);
            if (merged.length > 0) {
              return {
                candidates: filterByTarget(merged),
                trace: [{ node: "discovery", detail: `No search text; premise → ${premiseCands.length}, context → ${contextCands.length}, merged → ${merged.length} candidate(s)` }],
              };
            }
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
            const [premiseCands, contextCands] = await Promise.all([
              runPremiseDiscovery(),
              runContextToIntentDiscovery(),
            ]);
            const merged = mergeStrategyCandidates(premiseCands, contextCands);
            if (merged.length > 0) {
              return {
                hydeEmbeddings: {} as Record<string, number[]>,
                candidates: filterByTarget(merged),
                trace: [{ node: "discovery", detail: `No HyDE embeddings; premise → ${premiseCands.length}, context → ${contextCands.length}, merged → ${merged.length} candidate(s)` }],
              };
            }
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
                allCandidates.push(withCandidateEvidence({
                  candidateUserId: result.userId as Id<'users'>,
                  candidateIntentId: result.id as Id<'intents'>,
                  networkId: targetIndex.networkId,
                  similarity: result.score,
                  lens: result.matchedVia,
                  candidatePayload: '',
                  candidateSummary: undefined,
                  discoverySource: 'query' as const,
                }));
              }
              for (const result of results.filter((r) => r.type === 'premise')) {
                allCandidates.push(withCandidateEvidence({
                  candidateUserId: result.userId as Id<'users'>,
                  candidatePremiseId: result.id as Id<'premises'>,
                  networkId: targetIndex.networkId,
                  similarity: result.score,
                  lens: result.matchedVia,
                  candidatePayload: '',
                  candidateSummary: undefined,
                  discoverySource: 'query' as const,
                }));
              }
            })
          );
          const byUserAndIndex = new Map<string, CandidateMatch>();
          for (const c of allCandidates) {
            const entityKey = c.candidateIntentId ? `intent:${c.candidateIntentId}` : `premise:${c.candidatePremiseId}`;
            const key = `${c.candidateUserId}:${c.networkId}:${entityKey}`;
            if (!byUserAndIndex.has(key) || c.similarity > (byUserAndIndex.get(key)?.similarity ?? 0)) {
              byUserAndIndex.set(key, c);
            }
          }
          const candidates = Array.from(byUserAndIndex.values());
          discoveryLog.verbose('Intent-path discovery complete', { candidatesFound: candidates.length });
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

          const [premiseCands, contextCands] = await Promise.all([
            runPremiseDiscovery(),
            runContextToIntentDiscovery(),
          ]);
          const allStrategies = mergeStrategyCandidates(candidates, premiseCands, contextCands);
          if (premiseCands.length > 0 || contextCands.length > 0) {
            traceEntries.push({
              node: "discovery",
              detail: `+ Premise → ${premiseCands.length}, Context → ${contextCands.length}, merged to ${allStrategies.length} candidate(s)`,
            });
          }
          return {
            hydeEmbeddings: hydeEmbeddings as Record<string, number[]>,
            candidates: filterByTarget(allStrategies),
            trace: traceEntries,
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          discoveryLog.error('Failed', { error });
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
        evaluationLog.verbose('Starting evaluation', {
          candidatesCount: state.candidates.length,
        });

        if (state.candidates.length === 0) {
          evaluationLog.verbose('No candidates to evaluate');
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

        const discoveryUserId = state.onBehalfOfUserId ?? state.userId;
        let eligibleCandidates: CandidateMatch[];
        try {
          const requestedPairs = dedupedCandidates.flatMap((candidate) => [
            { userId: discoveryUserId, networkId: candidate.networkId },
            { userId: candidate.candidateUserId, networkId: candidate.networkId },
          ]);
          const activePairs = await this.database.getActiveNetworkMembershipPairs(requestedPairs);
          const activePairKeys = new Set(
            activePairs.map((pair) => networkMembershipPairKey(pair.userId, pair.networkId)),
          );
          eligibleCandidates = dedupedCandidates.filter((candidate) =>
            activePairKeys.has(networkMembershipPairKey(discoveryUserId, candidate.networkId))
            && activePairKeys.has(networkMembershipPairKey(candidate.candidateUserId, candidate.networkId)),
          );
        } catch (error) {
          evaluationLog.error('Active network membership recheck failed; skipping evaluation', { error });
          return {
            candidates: [],
            evaluatedOpportunities: [],
            remainingCandidates: [],
            error: 'Failed to validate candidate network memberships.',
            agentTimings: [],
          };
        }

        if (eligibleCandidates.length < dedupedCandidates.length) {
          evaluationLog.info('Removed candidates without active network pairs before evaluation', {
            before: dedupedCandidates.length,
            after: eligibleCandidates.length,
            removed: dedupedCandidates.length - eligibleCandidates.length,
          });
        }
        if (eligibleCandidates.length === 0) {
          return { candidates: [], evaluatedOpportunities: [], remainingCandidates: [], agentTimings: [] };
        }

        if (dedupedCandidates.length < sortedCandidates.length) {
          evaluationLog.info("Deduped candidates by userId", {
            before: sortedCandidates.length,
            after: dedupedCandidates.length,
            removed: sortedCandidates.length - dedupedCandidates.length,
          });
        }

        // ── IND-567: Rejection cool-down penalty ──────────────────────────
        // Candidates with a recently rejected or stalled opportunity receive a
        // similarity penalty so they are ranked lower (and often pushed out of
        // the evaluation batch). This prevents cross-query re-surfacing of
        // false-positive matches that were already caught downstream.
        // The persist-node dedup is still the hard gate; this is a soft guard
        // that reduces evaluator cost and LLM false-positive rate.
        const rejectionCooldownIds = new Set<string>();
        if (
          eligibleCandidates.length > 0
          && typeof this.database.getRecentlyRejectedOpportunityCounterparties === 'function'
        ) {
          try {
            const cooldownMs = getRejectionCooldownMs();
            const ids = await (this.database.getRecentlyRejectedOpportunityCounterparties as NonNullable<typeof this.database.getRecentlyRejectedOpportunityCounterparties>)(
              discoveryUserId,
              eligibleCandidates.map((c) => c.candidateUserId),
              cooldownMs,
            );
            for (const id of ids) rejectionCooldownIds.add(id);
            if (rejectionCooldownIds.size > 0) {
              evaluationLog.info('IND-567 rejection cool-down: applying similarity penalty', {
                affectedCount: rejectionCooldownIds.size,
                cooldownDays: Math.round(cooldownMs / (24 * 60 * 60 * 1000)),
                penalty: REJECTION_COOLDOWN_SIMILARITY_PENALTY,
              });
            }
          } catch (err) {
            evaluationLog.warn('IND-567 rejection cool-down: lookup failed, skipping penalty', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Apply penalty and re-sort so penalised candidates fall to the back.
        const eligibleCandidatesAfterCooldown = rejectionCooldownIds.size > 0
          ? eligibleCandidates
              .map((c) =>
                rejectionCooldownIds.has(c.candidateUserId)
                  ? { ...c, similarity: c.similarity * REJECTION_COOLDOWN_SIMILARITY_PENALTY }
                  : c,
              )
              .sort((a, b) => b.similarity - a.similarity)
          : eligibleCandidates;

        const batchToEvaluate = eligibleCandidatesAfterCooldown.slice(0, EVAL_BATCH_SIZE);
        const remaining = eligibleCandidatesAfterCooldown.slice(EVAL_BATCH_SIZE);

        // Early termination: if search was query-driven and no query-sourced candidates remain,
        // clear remaining to prevent pointless pagination through non-query leftovers
        const isQueryDriven = !!state.searchQuery?.trim();
        const queryRemaining = remaining.filter(
          (c) => c.discoverySource === 'query' || c.discoverySource == null,
        );
        const effectiveRemaining =
          isQueryDriven && queryRemaining.length === 0 ? [] : remaining;

        if (isQueryDriven && remaining.length > 0 && queryRemaining.length === 0) {
          evaluationLog.info(
            "Early termination: no query-sourced candidates remain",
            {
              droppedCandidates: remaining.length,
            },
          );
        }

        if (effectiveRemaining.length > 0) {
          evaluationLog.verbose('Batched candidates for evaluation', {
            evaluating: batchToEvaluate.length,
            remaining: effectiveRemaining.length,
            total: sortedCandidates.length,
          });
        }

        const agentTimingsAccum: DebugMetaAgent[] = [];

        try {
          const sourceProfile = await this.database.getProfile(discoveryUserId);
          const sourceEntity: EvaluatorEntity = {
            userId: discoveryUserId,
            profile: {
              name: sourceProfile?.identity?.name,
              bio: sourceProfile?.identity?.bio,
              location: sourceProfile?.identity?.location,
              context: sourceProfile?.context,
            },
            intents: state.indexedIntents.slice(0, 5).map((i) => ({
              intentId: i.intentId,
              payload: i.payload,
              summary: i.summary,
            })),
            networkId: '' as Id<'networks'>,  // Placeholder — overwritten per-pairing below
            evidenceKey: `${discoveryUserId}::source`,
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
              // IND-567 Fix A: fetch premise text for query_premise candidates.
              // The query-path sets candidatePayload='' for premise hits because
              // the vector-search result only carries a premise ID, not its text.
              // Without the text, renderOpportunityEvidenceForPrompt emits a line
              // with no domain content, letting the evaluator score on lens label
              // alone — which produces cross-domain false positives at confidence 1.0.
              // Mirror the getIntent fetch pattern: populate the evidence assertionText
              // from the DB so the evaluator can see the candidate's actual claim.
              let candidateEvidence = c.evidence;
              if (
                c.candidatePremiseId != null
                && c.candidateIntentId == null
                && (!c.candidatePayload || c.candidatePayload === '')
                && typeof this.database.getPremise === 'function'
              ) {
                try {
                  const premise = await (this.database.getPremise as NonNullable<typeof this.database.getPremise>)(c.candidatePremiseId);
                  const assertionText = (premise as { assertion?: { text?: string } } | null)?.assertion?.text;
                  if (assertionText) {
                    candidateEvidence = (c.evidence ?? []).map((ev) =>
                      ev.kind === 'query_premise' && ev.candidatePremiseId === c.candidatePremiseId
                        ? { ...ev, payload: assertionText, assertionText }
                        : ev,
                    );
                  }
                } catch (premiseFetchErr) {
                  evaluationLog.warn('IND-567: failed to fetch premise text for evaluator', {
                    candidatePremiseId: c.candidatePremiseId,
                    error: premiseFetchErr instanceof Error ? premiseFetchErr.message : String(premiseFetchErr),
                  });
                }
              }
              const evidenceKey = buildEvaluatorEvidenceKey(c);
              return {
                userId: c.candidateUserId,
                profile: {
                  name: profile?.identity?.name,
                  bio: profile?.identity?.bio,
                  location: profile?.identity?.location,
                  context: profile?.context,
                },
                intents:
                  c.candidateIntentId != null
                    ? [{ intentId: c.candidateIntentId, payload: intentPayload ?? '', summary: intentSummary }]
                    : undefined,
                networkId: c.networkId,
                evidenceKey,
                ragScore: c.similarity * 100,
                matchedVia: c.lens,
                evidence: candidateEvidence, // IND-567 Fix A: may carry populated assertionText
              };
            })
          );

          const userIdToIndexId = new Map<string, Id<'networks'>>();
          const evidenceByEntityKey = new Map<string, OpportunityEvidence[]>();
          const entityKeysByUserId = new Map<string, string[]>();
          for (const e of candidateEntities) {
            if (!userIdToIndexId.has(e.userId)) userIdToIndexId.set(e.userId, e.networkId as Id<'networks'>);
            if (e.evidenceKey) {
              evidenceByEntityKey.set(
                e.evidenceKey,
                mergeOpportunityEvidence(evidenceByEntityKey.get(e.evidenceKey), e.evidence),
              );
              entityKeysByUserId.set(e.userId, [...(entityKeysByUserId.get(e.userId) ?? []), e.evidenceKey]);
            }
          }

          function evidenceForActor(actor: { userId: string; intentId?: string | null; evidenceKey?: string | null }): OpportunityEvidence[] | undefined {
            if (actor.evidenceKey) return evidenceByEntityKey.get(actor.evidenceKey);
            const keys = entityKeysByUserId.get(actor.userId) ?? [];
            const intentKey = actor.intentId ? keys.find((key) => key.endsWith(`:${actor.intentId}`)) : undefined;
            if (intentKey) return evidenceByEntityKey.get(intentKey);
            // Avoid leaking unrelated resource evidence when the evaluator collapsed multiple
            // candidates for the same user into a profile-only actor.
            if (keys.length === 1) return evidenceByEntityKey.get(keys[0]);
            return undefined;
          }

          // Lower default threshold to 50 for better recall
          const minScore = state.options.minScore ?? 50;

          const evaluator = typeof (evaluatorAgent as OpportunityEvaluator).invokeEntityBundle === 'function'
            ? (evaluatorAgent as OpportunityEvaluator)
            : new OpportunityEvaluator();

          const runParallel = process.env.RUN_OPPORTUNITY_EVAL_IN_PARALLEL === 'true';
          const networkContexts = await buildNetworkContexts([sourceEntity, ...candidateEntities], this.database);

          // Declare trace entries early so both parallel and serial paths can push error entries
          const traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> = [];
          const parallelErrors: Array<{ candidateUserId: string; candidateName: string; error: string; durationMs: number }> = [];

          let pairwiseOpportunities: Array<{ reasoning: string; score: number; actors: Array<{ userId: string; role: 'agent' | 'patient' | 'peer'; intentId?: string | null; evidenceKey?: string | null }> }>;

          if (runParallel) {
            // Experimental: one LLM call per candidate, all fired in parallel
            evaluationLog.verbose('Running parallel evaluation', { candidates: candidateEntities.length });
            const parallelResults = await Promise.all(
              candidateEntities.map((candidateEntity) => {
                const input: EvaluatorInput = {
                  discovererId: discoveryUserId,
                  entities: [sourceEntity, candidateEntity],
                  existingOpportunities: state.options.existingOpportunities,
                  ...(state.searchQuery?.trim() ? { discoveryQuery: state.searchQuery.trim() } : {}),
                  networkContexts,
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
                    evaluationLog.warn('Parallel eval failed for candidate', {
                      candidateUserId: candidateEntity.userId,
                      error: err,
                    });
                    parallelErrors.push({
                      candidateUserId: candidateEntity.userId,
                      candidateName: _candidateName,
                      error: _errMsg,
                      durationMs: _evalDuration,
                    });
                    return [] as Array<{ reasoning: string; score: number; actors: Array<{ userId: string; role: 'agent' | 'patient' | 'peer'; intentId?: string | null; evidenceKey?: string | null }> }>;
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
              networkContexts,
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
                evaluationLog.warn('Splitting multi-actor opportunity; LLM returned bundled actors instead of one-per-candidate', {
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
            evidence: mergeOpportunityEvidence(...op.actors.map(evidenceForActor)),
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
          evaluationLog.verbose('Evaluation complete', {
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
            candidates: eligibleCandidatesAfterCooldown,
            evaluatedOpportunities: passedOpportunities,
            remainingCandidates: effectiveRemaining,
            trace: traceEntries,
            agentTimings: agentTimingsAccum,
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          evaluationLog.error('Failed', { error });
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
      const persistedById = new Map(
        state.opportunities.map((opportunity) => [opportunity.id, opportunity] as const),
      );
      const attemptBoundaryById = new Map(
        state.opportunities.map((opportunity) => [opportunity.id, opportunity.updatedAt] as const),
      );
      const compensateTasklessNegotiatingOpportunity = async (opportunityId: string): Promise<void> => {
        const opportunity = persistedById.get(opportunityId);
        const expectedUpdatedAt = attemptBoundaryById.get(opportunityId);
        if (opportunity?.status !== 'negotiating' || !expectedUpdatedAt) return;
        const fallbackStatus = opportunity.actors.some((actor) => actor.role === 'introducer')
          ? 'latent'
          : 'draft';
        await this.database
          .compensateTasklessNegotiatingOpportunity(opportunityId, expectedUpdatedAt, fallbackStatus)
          .catch((error: unknown) => {
            negotiateLog.warn('Failed to compensate taskless negotiating opportunity', {
              opportunityId,
              expectedUpdatedAt,
              fallbackStatus,
              error,
            });
          });
      };
      traceEmitter?.({ type: "graph_start", name: "Negotiation graph" });

      try {
        // Use the same discoveryUserId pattern as evaluationNode
        const discoveryUserId = (state.onBehalfOfUserId ?? state.userId) as string;

        const sourceAccount = await this.database.getUser(discoveryUserId).catch(() => null);
        const sourceIntentInputs = (state.indexedIntents ?? []).map((intent) => ({
          id: intent.intentId as string,
          summary: intent.summary ?? null,
          payload: intent.payload ?? null,
        }));
        const sourceHasExactIntent = sourceIntentInputs.some((intent) => intent.id === state.triggerIntentId);
        const sourceFallbackIntent = state.triggerIntentId && !sourceHasExactIntent
          ? await this.database.getIntent(state.triggerIntentId).catch(() => null)
          : null;
        const ownedSourceFallback = sourceFallbackIntent?.userId === discoveryUserId
          ? sourceFallbackIntent
          : null;

        const sourceUser = {
          id: discoveryUserId,
          intents: buildPrioritizedNegotiationIntents(
            sourceIntentInputs,
            state.triggerIntentId,
            ownedSourceFallback,
          ),
          profile: {
            name: state.sourceProfile?.identity?.name ?? sourceAccount?.name,
            bio: state.sourceProfile?.identity?.bio ?? sourceAccount?.intro ?? undefined,
            location: state.sourceProfile?.identity?.location ?? sourceAccount?.location ?? undefined,
          },
        };

        // Build candidates from persisted opportunities. Each opportunity carries its DB id
        // so the negotiation graph's finalize node can update its status from the outcome.
        negotiateLog.verbose('Building candidates from opportunities', {
          opportunityCount: state.opportunities.length,
          discoveryUserId,
        });

        const filteredBeforeInvocation: string[] = [];
        const candidateEntries = state.opportunities
          .map(opp => {
            // Skip opportunities where any introducer exists but has not yet approved.
            const introducerActors = (opp.actors as OpportunityActor[])
              .filter(a => a.role === 'introducer');
            if (introducerActors.length > 0 && !introducerActors.every(a => a.approved === true)) {
              negotiateLog.verbose('Skipping opportunity: introducer not approved', {
                opportunityId: opp.id,
                introducerCount: introducerActors.length,
                approvedCount: introducerActors.filter(a => a.approved === true).length,
              });
              filteredBeforeInvocation.push(opp.id);
              return null;
            }

            const opportunityActors = opp.actors as Array<{
              userId: string;
              role?: string;
              networkId?: string;
              intent?: string;
              intentId?: string;
            }>;
            const sourceActor = opportunityActors.find(a => a.userId === discoveryUserId && a.role !== 'introducer');
            const candidateActor = opportunityActors.find(a => a.userId !== discoveryUserId && a.role !== 'introducer');
            if (!sourceActor || !candidateActor) {
              negotiateLog.verbose('Skipping opportunity: no candidateActor found', {
                opportunityId: opp.id,
                discoveryUserId,
                actors: (opp.actors as OpportunityActor[])?.map(a => ({ userId: a.userId, role: a.role })) ?? [],
              });
              filteredBeforeInvocation.push(opp.id);
              return null;
            }
            return { opp, sourceActor, candidateActor };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null);

        await Promise.all(filteredBeforeInvocation.map(compensateTasklessNegotiatingOpportunity));

        negotiateLog.verbose('Candidate filtering complete', {
          inputOpportunities: state.opportunities.length,
          outputCandidates: candidateEntries.length,
        });

        const candidates: NegotiationCandidate[] = await Promise.all(
          candidateEntries.map(async ({ opp, sourceActor, candidateActor }) => {
            const userId = candidateActor.userId as string;
            const sourceIntentId = resolveOpportunityActorIntent(sourceActor);
            const candidateIntentId = resolveOpportunityActorIntent(candidateActor);
            const [profile, user, activeIntents, intent] = await Promise.all([
              this.database.getProfile(userId).catch(() => null),
              this.database.getUser(userId).catch(() => null),
              this.database.getActiveIntents(userId).catch(() => []),
              candidateIntentId
                ? this.database.getIntent(candidateIntentId).catch(() => null)
                : null,
            ]);

            const ownedFallbackIntent = intent?.userId === userId ? intent : null;
            const candidateIntents = buildPrioritizedNegotiationIntents(
              activeIntents,
              candidateIntentId,
              ownedFallbackIntent,
            );

            return {
              userId,
              ...(sourceIntentId ? { sourceIntentId } : {}),
              ...(candidateIntentId ? { candidateIntentId } : {}),
              opportunityId: opp.id as string,
              opportunityStatus: opp.status,
              opportunityUpdatedAt: opp.updatedAt,
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
                },
              },
            };
          }),
        );

        const isChatPath = !!state.options?.conversationId;
        const maxTurns = isChatPath
          ? Number(process.env.NEGOTIATION_MAX_TURNS_CHAT) || 4
          : Number(process.env.NEGOTIATION_MAX_TURNS_AMBIENT) || 6;

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
        // every candidate. Only use the long (polling) timeout when an external
        // (poller) agent is authorized on ALL candidate networks; otherwise fall
        // back to the short timeout so chats don't stall on a network where only
        // the system negotiator is allowed.
        const hasExternalAgent = isChatPath && this.agentDispatcher
          ? (uniqueIndexIds.length > 0
              ? (await Promise.all(
                  uniqueIndexIds.map((networkId) =>
                    this.agentDispatcher!.hasExternalAgent(
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
        const useLongTimeout = !isChatPath || hasExternalAgent;
        const timeoutMs = isOrchestrator
          ? ORCHESTRATOR_PARK_WINDOW_MS
          : useLongTimeout ? AMBIENT_PARK_WINDOW_MS : 30_000;

        logger.info('negotiateNode timeout decision', {
          discoveryUserId,
          trigger: state.trigger,
          isChatPath,
          isOrchestrator,
          hasDispatcher: !!this.agentDispatcher,
          hasExternalAgent,
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
        const resolvedOpportunityIds = new Set<string>();

        const onCandidateResolved: OnNegotiationResolved = async ({ candidate, accepted, turns, outcome }) => {
          if (candidate.opportunityId) resolvedOpportunityIds.add(candidate.opportunityId);
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

          if (candidate.opportunityId) {
            await compensateTasklessNegotiatingOpportunity(candidate.opportunityId);
          }

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
              negotiateLog.warn('failed to flip opp to draft; suppressing draft-ready event', {
                opportunityId: candidate.opportunityId,
                error: err,
              });
              return null;
            });
          if (!updated || abortSignal?.aborted) return;

          const counterpartName = candidate.candidateUser.profile?.name ?? '';
          const viewerName = sourceUser.profile.name;
          const rawReasoning = updated.interpretation?.reasoning ?? '';
          const personalizedSummary = safeFallbackSummary(rawReasoning, {
            counterpartName,
            viewerName,
            emptyText: 'A suggested connection.',
          });

          traceEmitter?.({
            type: 'opportunity_draft_ready',
            opportunityId: candidate.opportunityId,
            opportunity: {
              ...updated,
              interpretation: {
                ...updated.interpretation,
                reasoning: personalizedSummary,
              },
            },
            personalizedSummary,
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
            // v2 initiator stamp: every fresh-discovery origin resolves to the
            // discovery user — querying user (chat/tool), intent owner
            // (from-intent), enriched user (from-enrichment/discovery-run), or
            // represented user (from-introducer, via onBehalfOfUserId).
            initiatorUserId: discoveryUserId,
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
            // Restore any attempt that is still before its task boundary. A running or
            // parked negotiation already has a task and makes the CAS a no-op; a hung
            // pre-task init becomes owner-actionable while its floating work may retry.
            await Promise.all(
              candidates
                .filter((candidate) => candidate.opportunityId && !resolvedOpportunityIds.has(candidate.opportunityId))
                .map((candidate) => compensateTasklessNegotiatingOpportunity(candidate.opportunityId!)),
            );
            // Floating promise is intentional — see comment above.
            void negotiationWork.catch((err) => {
              negotiateLog.warn('background negotiation failed after timer fired', { error: err });
            });
            negotiateLog.warn('timed out — returning partial results to caller', {
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
        await Promise.all(state.opportunities.map((opportunity) =>
          compensateTasklessNegotiatingOpportunity(opportunity.id)));
        negotiateLog.error("Negotiation stage failed", { error: err });
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
        rankingLog.verbose('Starting ranking', {
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

          rankingLog.verbose('Ranking complete', {
            sorted: sorted.length,
            afterLimit: ranked.length,
            afterDedup: deduplicated.length,
          });
          return { evaluatedOpportunities: deduplicated };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          rankingLog.error('Failed', { error });
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
     * Validates network scope, membership for introducer and all party users, and no existing opportunity.
     */
    const introValidationNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.introValidation", async () => {
        introValidationLog.verbose('Starting', {
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

          introValidationLog.verbose('Validation passed');
          return {};
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          introValidationLog.error('Failed', {
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
        introEvaluationLog.verbose('Starting', { userId: state.userId });

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
          const networkContexts = await buildNetworkContexts(entities, this.database);
          const input: EvaluatorInput = {
            discovererId: state.userId,
            entities,
            introductionMode: true,
            introducerName,
            introductionHint: state.introductionHint ?? undefined,
            networkContexts,
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
          introEvaluationLog.warn('Evaluator or getUser failed, using fallback', { error: evalErr });
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
        persistLog.verbose('Starting persistence (dedup-v2)', {
          opportunitiesToCreate: state.evaluatedOpportunities.length,
          trigger: state.trigger,
          initialStatus,
        });

        if (state.evaluatedOpportunities.length === 0) {
          persistLog.verbose('No opportunities to persist', {
            triggerIntentId: state.triggerIntentId,
            reason: state.candidates.length === 0 ? 'no_search_candidates' : 'evaluator_rejected_all',
          });
          return {
            opportunities: [],
            persistenceOutcome: {
              evaluatedCount: 0,
              createdCount: 0,
              reactivatedCount: 0,
              sameTriggerDuplicateSuppressions: 0,
              pairActiveNegotiationSuppressions: 0,
              crossTriggerAllowedCount: 0,
              finalAtomicConflictCount: 0,
            },
          };
        }

        try {
          // Recompute the authoritative owner-side scope at the final boundary.
          // The adapter receives this immutable request scope and locks current
          // memberships plus trigger-intent assignments through commit.
          const currentOwnerMemberships = await this.database.getNetworkMemberships(state.userId);
          let finalAllowedNetworkIds = currentOwnerMemberships.map((membership) => membership.networkId);
          // Only an explicit trigger intent is an authoritative network boundary.
          // Ad-hoc global discovery may heuristically resolve a matching intent
          // for ranking, but must retain its all-membership reach.
          const finalTriggerIntentId = state.triggerIntentId;
          if (finalTriggerIntentId) {
            const currentAssignments = new Set(
              await this.database.getNetworkIdsForIntent(finalTriggerIntentId),
            );
            finalAllowedNetworkIds = finalAllowedNetworkIds.filter((networkId) =>
              currentAssignments.has(networkId));
          }
          const explicitScope = state.networkId
            ? [state.networkId]
            : state.indexScope;
          if (explicitScope !== undefined) {
            const explicitlyAllowed = new Set(explicitScope);
            finalAllowedNetworkIds = finalAllowedNetworkIds.filter((networkId) =>
              explicitlyAllowed.has(networkId));
          }
          finalAllowedNetworkIds = [...new Set(finalAllowedNetworkIds)];
          if (finalAllowedNetworkIds.length === 0) {
            persistLog.info('Skipped persistence because final discovery scope is empty', {
              userId: state.userId,
              triggerIntentId: finalTriggerIntentId,
            });
            return { opportunities: [] };
          }
          const finalAllowedNetworks = new Set(finalAllowedNetworkIds);
          const networkEligibility: OpportunityNetworkEligibility = {
            ownerUserId: state.userId,
            allowedNetworkIds: finalAllowedNetworkIds,
            ...(finalTriggerIntentId ? { triggerIntentId: finalTriggerIntentId } : {}),
          };

          // Recheck evaluator participants before any dedup/reactivation/write.
          // Persistence-only introducers are deliberately absent here: personal-
          // network contact discovery validates the evaluated owner/candidate
          // pairs without requiring the owner actor that is added below.
          const requestedPairs = state.evaluatedOpportunities.flatMap((evaluated) =>
            evaluated.actors.flatMap((actor) => actor.networkId
              ? [{ userId: actor.userId, networkId: actor.networkId }]
              : []),
          );
          const activePairs = await this.database.getActiveNetworkMembershipPairs(requestedPairs);
          const activePairKeys = new Set(
            activePairs.map((pair) => networkMembershipPairKey(pair.userId, pair.networkId)),
          );
          const evaluatedToPersist = state.evaluatedOpportunities.filter((evaluated) =>
            evaluated.actors.length > 0
            && evaluated.actors.every((actor) =>
              actor.networkId != null
              && finalAllowedNetworks.has(actor.networkId)
              && activePairKeys.has(networkMembershipPairKey(actor.userId, actor.networkId))),
          );
          if (evaluatedToPersist.length < state.evaluatedOpportunities.length) {
            persistLog.info('Skipped opportunities with inactive participant network pairs', {
              before: state.evaluatedOpportunities.length,
              after: evaluatedToPersist.length,
              removed: state.evaluatedOpportunities.length - evaluatedToPersist.length,
            });
          }
          if (evaluatedToPersist.length === 0) return { opportunities: [] };

          const updateStatusIfStillEligible = async (
            opportunityId: string,
            status: Opportunity['status'],
            existingActors: OpportunityActor[],
            expectedStatus: Opportunity['status'],
          ): Promise<Opportunity | null> => {
            // Reactivation preserves the existing opportunity row, so lock the
            // existing participant anchors rather than the evaluator's current
            // (often network-less) actor output. Introducers do not participate
            // in matching eligibility and must not suppress a valid pair.
            const anchors = existingActors.filter((actor) => actor.role !== 'introducer');
            if (anchors.length === 0 || anchors.some((actor) =>
              !finalAllowedNetworks.has(actor.networkId))) {
              return null;
            }
            if (!this.database.updateOpportunityStatusIfNetworkEligible) {
              persistLog.error('Network-eligible status update adapter is unavailable; failing closed');
              return null;
            }
            return this.database.updateOpportunityStatusIfNetworkEligible(
              opportunityId,
              status,
              anchors,
              networkEligibility,
              expectedStatus,
            );
          };

          const itemsToPersist: CreateOpportunityData[] = [];
          const reactivatedOpportunities: Opportunity[] = [];
          let crossTriggerAllowedCount = 0;
          const existingBetweenActors: Array<{
            candidateUserId: Id<'users'>;
            networkId: Id<'networks'>;
            existingOpportunityId?: Id<'opportunities'>;
            existingStatus?: OpportunityStatus;
            reason?: 'same_trigger_recent_duplicate' | 'pair_active_negotiation' | 'final_atomic_conflict';
            existingTriggerIntentId?: string;
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
            for (const evaluated of evaluatedToPersist) {
              const candidateUserId = evaluated.actors.find(a => a.userId !== dedupUserId)?.userId;
              if (candidateUserId) uniqueCounterparts.add(candidateUserId);
            }
            const lookups = await Promise.all(
              [...uniqueCounterparts].map(async (counterpartyUserId) => {
                const accepted = await this.database
                  .findOpportunitiesByActors([dedupUserId, counterpartyUserId], { includeIntroducers: true, statuses: ['accepted'] })
                  .catch((err: unknown) => {
                    persistLog.warn('findOpportunitiesByActors (sibling-accept) failed', {
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

          for (const evaluated of evaluatedToPersist) {
            const indexIdForActors = state.networkId ?? evaluated.actors[0]?.networkId;
            let actors: OpportunityActor[];
            let data: CreateOpportunityData;

            persistPathLog.verbose('Selecting persistence path', {
              isIntroduction: !!state.introductionContext,
              stateUserId: state.userId,
              stateIndexId: state.networkId,
              evaluatedActorUserIds: evaluated.actors.map(a => a.userId),
            });

            if (state.introductionContext) {
              if (indexIdForActors === undefined) {
                persistLog.warn('Introduction path missing networkId; skipping opportunity', {
                  userId: state.userId,
                  actorsCount: evaluated.actors.length,
                });
                continue;
              }
              // Introduction path: manual detection, introducer actor, curator_judgment signal.
              const evaluatorActors: OpportunityActor[] = evaluated.actors.map((a: EvaluatedOpportunityActor) => {
                const intent = normalizeOpportunityActorIntent(a.intentId);
                return {
                  networkId: a.networkId ?? indexIdForActors,
                  userId: a.userId,
                  role: a.role,
                  ...(intent ? { intent: intent as Id<'intents'> } : {}),
                };
              });
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
                persistLog.warn('Introducer discovery path missing networkId; skipping opportunity', {
                  userId: state.userId,
                  actorsCount: evaluated.actors.length,
                });
                continue;
              }
              // Introducer discovery path: introducer is state.userId, target is onBehalfOfUserId.
              const evaluatorActors: OpportunityActor[] = evaluated.actors.map((a: EvaluatedOpportunityActor) => {
                const intent = normalizeOpportunityActorIntent(a.intentId);
                return {
                  networkId: a.networkId ?? indexIdForActors,
                  userId: a.userId,
                  role: a.role,
                  ...(intent ? { intent: intent as Id<'intents'> } : {}),
                };
              });
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
                    const reactivated = await updateStatusIfStillEligible(
                      existing.id, 'draft', existing.actors, existing.status,
                    );
                    if (reactivated) {
                      persistLog.verbose('Reactivated opportunity (introduction path)', {
                        opportunityId: existing.id,
                        candidateUserId,
                        previousStatus: existing.status,
                      });
                      reactivatedOpportunities.push(reactivated);
                    }
                    continue;
                  }
                } else if (existing.status === 'negotiating') {
                  // Orphan heal (introduction path): same logic as discovery path
                  const priorTask = await this.database.getNegotiationTaskForOpportunity(existing.id);
                  if (priorTask && isActiveNegotiationTaskFresh(priorTask)) {
                    existingBetweenActors.push({
                      candidateUserId: candidateUserId as Id<'users'>,
                      networkId: (state.networkId ?? indexIdForActors ?? '') as Id<'networks'>,
                      existingOpportunityId: existing.id as Id<'opportunities'>,
                      existingStatus: existing.status,
                    });
                    persistLog.verbose('Skipping negotiating opportunity with active task (introduction path)', {
                      opportunityId: existing.id,
                      candidateUserId,
                      taskState: priorTask.state,
                    });
                    continue;
                  }
                  const reactivated = await updateStatusIfStillEligible(
                    existing.id, 'draft', existing.actors, existing.status,
                  );
                  if (reactivated) {
                    persistLog.info('Resuming orphaned negotiating opportunity (introduction path)', {
                      opportunityId: existing.id,
                      candidateUserId,
                      priorTaskState: priorTask?.state,
                    });
                    reactivatedOpportunities.push(reactivated);
                  }
                  continue;
                } else if (existing.status === 'latent') {
                  // Upgrade latent to draft for introduction path
                  const upgraded = await updateStatusIfStillEligible(
                    existing.id, 'draft', existing.actors, existing.status,
                  );
                  if (upgraded) {
                    persistLog.verbose('Upgraded latent opportunity to draft (introduction path)', {
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
                  persistLog.verbose('Skipping recent duplicate (introduction path)', {
                    candidateUserId,
                    existingStatus: existing.status,
                    existingOpportunityId: existing.id,
                  });
                  continue;
                }
                // Else: existing opportunity is old enough, allow new opportunity creation
                persistLog.verbose('Allowing new opportunity; existing is outside dedup window (introduction path)', {
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

              // Build premise lookup from discovery candidates for premise tracking.
              // When multiple premise candidates exist for the same user, keep the highest-similarity one.
              const premiseLookup = new Map<string, { premiseId: string; similarity: number }>();
              for (const c of state.candidates ?? []) {
                if (c.candidatePremiseId) {
                  const existing = premiseLookup.get(c.candidateUserId);
                  if (!existing || c.similarity > existing.similarity) {
                    premiseLookup.set(c.candidateUserId, { premiseId: c.candidatePremiseId, similarity: c.similarity });
                  }
                }
              }

              const evaluatorActors: OpportunityActor[] = evaluated.actors.map((a: EvaluatedOpportunityActor) => {
                const intent = normalizeOpportunityActorIntent(a.intentId);
                return {
                  networkId: a.networkId ?? indexIdForActors,
                  userId: a.userId,
                  role: a.role,
                  ...(intent ? { intent: intent as Id<'intents'> } : {}),
                  ...(premiseLookup.has(a.userId) ? { premise: premiseLookup.get(a.userId)!.premiseId as Id<'premises'> } : {}),
                };
              });
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
                  persistLog.verbose('Swapped discoverer from agent to patient for lifecycle visibility', {
                    discovererId: state.userId,
                  });
                }
              }

              // Index-agnostic dedup: find ANY existing opportunity between these users,
              // regardless of which index it was created in or whether a focused network scope is set.
              const candidateUserId = evaluated.actors.find((a) => a.userId !== state.userId)?.userId;
              persistDedupLog.verbose('Checking overlapping opportunities', {
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
              persistDedupLog.verbose('findOpportunitiesByActors result', {
                count: overlapping.length,
                results: overlapping.map(o => ({ id: o.id, status: o.status, actors: o.actors?.map((a: OpportunityActor) => ({ userId: a.userId, role: a.role })) })),
              });

              const ownedIntentTriggerId = state.discoverySource === 'intent'
                && state.triggerIntentId
                && state.resolvedTriggerIntentId === state.triggerIntentId
                ? state.triggerIntentId
                : undefined;

              if (ownedIntentTriggerId && candidateUserId) {
                let activeNegotiation: { opportunity: Opportunity; taskState: string } | undefined;
                for (const opportunity of overlapping) {
                  if (opportunity.status !== 'negotiating') continue;
                  const task = await this.database.getNegotiationTaskForOpportunity(opportunity.id);
                  if (task && isActiveNegotiationTaskFresh(task)) {
                    activeNegotiation = { opportunity, taskState: task.state };
                    break;
                  }
                }

                if (activeNegotiation) {
                  const existingTriggerIntentId = triggerForOwner(activeNegotiation.opportunity, state.userId);
                  existingBetweenActors.push({
                    candidateUserId: candidateUserId as Id<'users'>,
                    networkId: (activeNegotiation.opportunity.context?.networkId ?? state.networkId ?? state.userNetworks?.[0] ?? '') as Id<'networks'>,
                    existingOpportunityId: activeNegotiation.opportunity.id as Id<'opportunities'>,
                    existingStatus: activeNegotiation.opportunity.status,
                    reason: 'pair_active_negotiation',
                    ...(existingTriggerIntentId ? { existingTriggerIntentId } : {}),
                  });
                  persistDedupLog.info('Suppressing owned-intent match for pair-global active negotiation', {
                    triggerIntentId: ownedIntentTriggerId,
                    candidateUserId,
                    existingOpportunityId: activeNegotiation.opportunity.id,
                    existingTriggerIntentId,
                    existingStatus: activeNegotiation.opportunity.status,
                    existingAgeMs: Date.now() - new Date(activeNegotiation.opportunity.createdAt).getTime(),
                    taskState: activeNegotiation.taskState,
                    reason: 'pair_active_negotiation',
                  });
                  continue;
                }

                const sameTrigger = overlapping
                  .filter((opportunity) => belongsToOwnedIntent(opportunity, state.userId, ownedIntentTriggerId))
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                const otherTrigger = overlapping.filter((opportunity) =>
                  !belongsToOwnedIntent(opportunity, state.userId, ownedIntentTriggerId));
                const existing = sameTrigger[0];

                if (!existing) {
                  if (otherTrigger.length > 0) {
                    crossTriggerAllowedCount += 1;
                    persistDedupLog.info('Allowing cross-trigger match for owned intent', {
                      triggerIntentId: ownedIntentTriggerId,
                      candidateUserId,
                      reason: 'cross_trigger_match_allowed',
                      otherTriggers: otherTrigger.map((opportunity) => ({
                        opportunityId: opportunity.id,
                        triggerIntentId: triggerForOwner(opportunity, state.userId),
                        status: opportunity.status,
                        ageMs: Date.now() - new Date(opportunity.createdAt).getTime(),
                      })),
                    });
                  }
                } else {
                  const existingIndexId = (existing.context?.networkId ?? state.networkId ?? state.userNetworks?.[0] ?? '') as Id<'networks'>;
                  const isRecent = new Date(existing.createdAt).getTime() > Date.now() - DEDUP_WINDOW_MS;

                  if (existing.status === 'expired' || existing.status === 'stalled') {
                    const reactivated = await updateStatusIfStillEligible(
                      existing.id, initialStatus, existing.actors, existing.status,
                    );
                    if (reactivated) {
                      persistLog.info('Reactivated same-trigger opportunity', {
                        triggerIntentId: ownedIntentTriggerId,
                        opportunityId: existing.id,
                        candidateUserId,
                        previousStatus: existing.status,
                        newStatus: initialStatus,
                      });
                      reactivatedOpportunities.push(reactivated);
                    }
                    continue;
                  }
                  if (existing.status === 'negotiating') {
                    const reactivated = await updateStatusIfStillEligible(
                      existing.id, initialStatus, existing.actors, existing.status,
                    );
                    if (reactivated) {
                      persistLog.info('Resuming same-trigger orphaned negotiating opportunity', {
                        triggerIntentId: ownedIntentTriggerId,
                        opportunityId: existing.id,
                        candidateUserId,
                      });
                      reactivatedOpportunities.push(reactivated);
                    }
                    continue;
                  }
                  if (existing.status === 'latent' && initialStatus !== 'latent') {
                    const upgraded = await updateStatusIfStillEligible(
                      existing.id, initialStatus, existing.actors, existing.status,
                    );
                    if (upgraded) {
                      persistLog.info('Upgraded same-trigger latent opportunity', {
                        triggerIntentId: ownedIntentTriggerId,
                        opportunityId: existing.id,
                        candidateUserId,
                        newStatus: initialStatus,
                      });
                      reactivatedOpportunities.push(upgraded);
                    }
                    continue;
                  }
                  if (isRecent) {
                    existingBetweenActors.push({
                      candidateUserId: candidateUserId as Id<'users'>,
                      networkId: existingIndexId,
                      existingOpportunityId: existing.id as Id<'opportunities'>,
                      existingStatus: existing.status,
                      reason: 'same_trigger_recent_duplicate',
                      existingTriggerIntentId: ownedIntentTriggerId,
                    });
                    persistDedupLog.info('Suppressing recent same-trigger duplicate', {
                      triggerIntentId: ownedIntentTriggerId,
                      candidateUserId,
                      existingOpportunityId: existing.id,
                      existingTriggerIntentId: ownedIntentTriggerId,
                      existingStatus: existing.status,
                      existingAgeMs: Date.now() - new Date(existing.createdAt).getTime(),
                      reason: 'same_trigger_recent_duplicate',
                    });
                    continue;
                  }
                  persistDedupLog.info('Allowing same-trigger opportunity outside dedup window', {
                    triggerIntentId: ownedIntentTriggerId,
                    candidateUserId,
                    existingOpportunityId: existing.id,
                    existingStatus: existing.status,
                    existingAgeMs: Date.now() - new Date(existing.createdAt).getTime(),
                  });
                }
              } else if (overlapping.length > 0) {
                const existing = overlapping[0];
                const existingIndexId = (existing.context?.networkId ?? state.networkId ?? state.userNetworks?.[0] ?? '') as Id<'networks'>;
                const isRecent = new Date(existing.createdAt).getTime() > Date.now() - DEDUP_WINDOW_MS;

                if (existing.status === 'expired' || existing.status === 'stalled') {
                  // Reactivate expired or stalled opportunities.
                  // Stalled opportunities are reactivated regardless of age: a stalled negotiation
                  // is still in-flight for this pair, so we resume it rather than create a parallel one.
                  const reactivated = await updateStatusIfStillEligible(
                    existing.id, initialStatus, existing.actors, existing.status,
                  );
                  if (reactivated) {
                    persistLog.verbose('Reactivated opportunity', {
                      opportunityId: existing.id,
                      candidateUserId,
                      previousStatus: existing.status,
                      newStatus: initialStatus,
                    });
                    reactivatedOpportunities.push(reactivated);
                  }
                  continue;
                } else if (existing.status === 'negotiating') {
                  // Orphan heal: if a prior opportunity is stuck in 'negotiating' with a stale task,
                  // reactivate it so the new discovery run can reuse it instead of creating a duplicate.
                  const priorTask = await this.database.getNegotiationTaskForOpportunity(existing.id);
                  if (priorTask && isActiveNegotiationTaskFresh(priorTask)) {
                    // Still active — skip (lock gate in init node will handle)
                    existingBetweenActors.push({
                      candidateUserId: candidateUserId as Id<'users'>,
                      networkId: existingIndexId,
                      existingOpportunityId: existing.id as Id<'opportunities'>,
                      existingStatus: existing.status,
                    });
                    persistLog.verbose('Skipping negotiating opportunity with active task', {
                      opportunityId: existing.id,
                      candidateUserId,
                      taskState: priorTask.state,
                    });
                    continue;
                  }
                  // Task is stale or missing — reactivate the orphaned negotiating opportunity
                  const reactivated = await updateStatusIfStillEligible(
                    existing.id, initialStatus, existing.actors, existing.status,
                  );
                  if (reactivated) {
                    persistLog.info('Resuming orphaned negotiating opportunity', {
                      opportunityId: existing.id,
                      candidateUserId,
                      priorTaskState: priorTask?.state,
                    });
                    reactivatedOpportunities.push(reactivated);
                  }
                  continue;
                } else if (existing.status === 'latent' && initialStatus !== 'latent') {
                  // Upgrade latent (background-discovered) to the higher-priority status (e.g. pending)
                  const upgraded = await updateStatusIfStillEligible(
                    existing.id, initialStatus, existing.actors, existing.status,
                  );
                  if (upgraded) {
                    persistLog.verbose('Upgraded latent opportunity to higher-priority status', {
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
                  persistLog.verbose('Skipping recent duplicate; opportunity created within dedup window', {
                    candidateUserId,
                    existingStatus: existing.status,
                    existingOpportunityId: existing.id,
                    createdAt: existing.createdAt,
                  });
                  continue;
                }
                // Else: existing opportunity is old enough (outside the 30-day dedup window), allow new opportunity creation
                persistLog.verbose('Allowing new opportunity; existing is outside dedup window', {
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
                metadata: {
                  evidence: evaluated.evidence ?? [],
                },
              };
            }

            if (hasUnsupportedOpportunityClaim(data.interpretation.reasoning)) {
              persistLog.warn('Skipping opportunity with unsupported affiliation/presence claim at persistence boundary', {
                source: data.detection.source,
                triggerIntentId: data.detection.triggeredBy,
              });
              continue;
            }

            try {
              validateOpportunityActors(data.actors);
            } catch (err) {
              persistLog.warn('Skipping opportunity with invalid actors', {
                error: err instanceof Error ? err.message : String(err),
                opportunityReasoning: evaluated.reasoning?.slice(0, 80),
              });
              continue;
            }

            itemsToPersist.push(data);
          }

          // P4b seam: only genuinely new, create-mode, owned-intent discovery
          // items reach the host stamper. Dedup reactivations/upgrades have
          // already continued above; introductions, on-behalf-of, context-only,
          // manual, and continuation flows are excluded explicitly.
          let itemsForPersistence = itemsToPersist;
          const stampIntentId = state.resolvedTriggerIntentId;
          const mayStamp = Boolean(
            this.stampNewbornOpportunities
            && state.operationMode === 'create'
            && !state.introductionContext
            && !state.onBehalfOfUserId
            && !state.targetUserId
            && state.discoverySource === 'intent'
            && stampIntentId
            && state.indexedIntents.some((intent) => intent.intentId === stampIntentId),
          );
          if (mayStamp && stampIntentId && itemsToPersist.length > 0) {
            const eligibleIndexes = itemsToPersist.flatMap((item, index) =>
              item.detection.source === 'opportunity_graph' && item.detection.triggeredBy === stampIntentId
                ? [index]
                : []);
            if (eligibleIndexes.length > 0) {
              const originals = eligibleIndexes.map((index) => itemsToPersist[index]);
              const callbackItems = originals.map(copyCreateOpportunityData);
              try {
                const stamped = await this.stampNewbornOpportunities!({
                  ownerUserId: state.userId,
                  intentId: stampIntentId,
                  items: callbackItems,
                });
                const valid = Array.isArray(stamped)
                  && stamped.length === originals.length
                  && stamped.every((item, index) => newbornItemIdentity(item) === newbornItemIdentity(originals[index]));
                if (valid) {
                  itemsForPersistence = [...itemsToPersist];
                  eligibleIndexes.forEach((itemIndex, stampedIndex) => {
                    itemsForPersistence[itemIndex] = stamped[stampedIndex];
                  });
                } else {
                  persistLog.warn('Newborn stamper returned unsafe length/order; persisting originals', {
                    expected: originals.length,
                    actual: Array.isArray(stamped) ? stamped.length : null,
                  });
                }
              } catch (error) {
                persistLog.warn('Newborn stamper failed; persisting originals', {
                  intentId: stampIntentId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }

          const intentDedupScope = finalTriggerIntentId && state.discoverySource === 'intent'
            ? { triggerIntentId: finalTriggerIntentId, dedupWindowMs: DEDUP_WINDOW_MS }
            : undefined;
          const { created: createdList, conflicts } = await persistOpportunities({
            database: this.database,
            embedder: this.embedder,
            items: itemsForPersistence,
            networkEligibility,
            intentDedupScope,
          });

          for (const conflict of conflicts) {
            const item = itemsForPersistence[conflict.itemIndex];
            const candidateActor = item?.actors.find((actor) => actor.userId !== state.userId);
            if (!candidateActor) continue;
            existingBetweenActors.push({
              candidateUserId: candidateActor.userId,
              networkId: candidateActor.networkId,
              existingOpportunityId: conflict.existingOpportunityId as Id<'opportunities'>,
              existingStatus: conflict.existingStatus,
              reason: conflict.reason,
              ...(conflict.existingTriggerIntentId
                ? { existingTriggerIntentId: conflict.existingTriggerIntentId }
                : {}),
            });
            persistDedupLog.info('Final atomic persistence conflict', {
              triggerIntentId: finalTriggerIntentId,
              candidateUserId: candidateActor.userId,
              existingOpportunityId: conflict.existingOpportunityId,
              existingTriggerIntentId: conflict.existingTriggerIntentId,
              existingStatus: conflict.existingStatus,
              existingAgeMs: Date.now() - new Date(conflict.existingCreatedAt).getTime(),
              reason: conflict.reason,
              finalAtomic: true,
            });
          }

          const allOpportunities = [...reactivatedOpportunities, ...createdList];

          persistLog.verbose('Persistence complete', {
            created: createdList.length,
            reactivated: reactivatedOpportunities.length,
            existingBetweenActorsCount: existingBetweenActors.length,
            status: initialStatus,
          });
          const persistenceOutcome = {
            evaluatedCount: state.evaluatedOpportunities.length,
            createdCount: createdList.length,
            reactivatedCount: reactivatedOpportunities.length,
            sameTriggerDuplicateSuppressions: existingBetweenActors.filter((entry) =>
              entry.reason === 'same_trigger_recent_duplicate').length,
            pairActiveNegotiationSuppressions: existingBetweenActors.filter((entry) =>
              entry.reason === 'pair_active_negotiation').length,
            crossTriggerAllowedCount,
            finalAtomicConflictCount: conflicts.length,
          };
          return {
            opportunities: allOpportunities,
            existingBetweenActors,
            dedupAlreadyAccepted,
            persistenceOutcome,
            trace: [{
              node: "persist",
              detail: `Created ${createdList.length}, reactivated ${reactivatedOpportunities.length}, ${existingBetweenActors.length} existing skipped, ${dedupAlreadyAccepted.length} already-accepted pair(s)`,
              data: {
                created: createdList.length,
                reactivated: reactivatedOpportunities.length,
                existingSkipped: existingBetweenActors.length,
                alreadyAccepted: dedupAlreadyAccepted.length,
                totalOutput: allOpportunities.length,
                persistenceOutcome,
                durationMs: Date.now() - startTime,
              },
            }],
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          persistLog.error('Failed', { error });
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
        readLog.verbose('Listing opportunities', {
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
                reasoning: safeFallbackSummary(opp.interpretation?.reasoning, {
                  counterpartName: connectedWith.join(' and '),
                  emptyText: 'Connection opportunity',
                }),
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
          readLog.error('Failed', { error: err });
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
        updateLog.verbose('Updating opportunity status', {
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
          updateLog.error('Failed', { error: err });
          return { mutationResult: { success: false, error: 'Failed to update opportunity.' } };
        }
      });
    };

    /**
     * Delete Node: Expire/archive an opportunity.
     */
    const deleteNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.delete", async () => {
        deleteLog.verbose('Expiring opportunity', {
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
          deleteLog.error('Failed', { error: err });
          return { mutationResult: { success: false, error: 'Failed to delete opportunity.' } };
        }
      });
    };

    /**
     * Send Node: Promote latent or draft opportunity to pending + queue notification.
     */
    const sendNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.send", async () => {
        sendLog.verbose('Sending opportunity', {
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
          sendLog.error('Failed', { error: err });
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
        negotiateExistingLog.warn('No negotiationGraph wired; skipping', {
          opportunityId: state.opportunityId,
        });
        return {};
      }

      try {
        const opp = await this.database.getOpportunity(state.opportunityId as string);
        if (!opp) {
          negotiateExistingLog.warn('Opportunity not found', { opportunityId: state.opportunityId });
          return {};
        }

        const actors = opp.actors as Array<OpportunityActor & { intentId?: string }>;
        const nonIntroducerActors = actors.filter(a => a.role !== 'introducer');
        const continuation = state.options.negotiationContinuation;
        if (continuation) {
          const recipientActor = nonIntroducerActors.find((actor) => actor.userId === state.userId);
          const counterpartyActor = nonIntroducerActors.find((actor) => actor.userId === continuation.counterpartyUserId);
          if (
            !recipientActor
            || resolveOpportunityActorIntent(recipientActor) !== continuation.recipientIntentId
            || recipientActor.networkId !== continuation.networkId
            || !counterpartyActor
            || resolveOpportunityActorIntent(counterpartyActor) !== continuation.counterpartyIntentId
            || counterpartyActor.networkId !== continuation.networkId
          ) {
            negotiateExistingLog.warn('Exact continuation actor binding is stale', {
              opportunityId: state.opportunityId,
              taskId: continuation.taskId,
            });
            return {};
          }
        }

        // Find the sourceActor: non-introducer with role patient or party, fallback to first non-introducer
        const sourceActor = nonIntroducerActors.find(a => a.role === 'patient' || a.role === 'party')
          ?? nonIntroducerActors[0];
        if (!sourceActor) {
          negotiateExistingLog.warn('No source actor found', { opportunityId: state.opportunityId });
          return {};
        }

        // Find the candidateActor: non-introducer that is NOT the sourceActor
        const candidateActor = nonIntroducerActors.find(a => a.userId !== sourceActor.userId);
        if (!candidateActor) {
          negotiateExistingLog.warn('No candidate actor found', { opportunityId: state.opportunityId });
          return {};
        }

        const sourceIntentId = resolveOpportunityActorIntent(sourceActor);
        const candidateIntentId = resolveOpportunityActorIntent(candidateActor);

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

        const sourceHasExactIntent = sourceIntents.some((intent) => intent.id === sourceIntentId);
        const candidateHasExactIntent = candidateIntents.some((intent) => intent.id === candidateIntentId);
        const [sourceFallbackIntent, candidateFallbackIntent] = await Promise.all([
          sourceIntentId && !sourceHasExactIntent
            ? this.database.getIntent(sourceIntentId).catch(() => null)
            : null,
          candidateIntentId && !candidateHasExactIntent
            ? this.database.getIntent(candidateIntentId).catch(() => null)
            : null,
        ]);

        const sourceUser = {
          id: sourceActor.userId,
          intents: buildPrioritizedNegotiationIntents(
            sourceIntents,
            sourceIntentId,
            sourceFallbackIntent?.userId === sourceActor.userId ? sourceFallbackIntent : null,
          ),
          profile: {
            name: sourceProfile?.identity?.name ?? sourceUserAccount?.name,
            bio: sourceProfile?.identity?.bio ?? sourceUserAccount?.intro ?? undefined,
            location: sourceProfile?.identity?.location ?? sourceUserAccount?.location ?? undefined,
          },
        };

        const candidateIntentsForNeg = buildPrioritizedNegotiationIntents(
          candidateIntents,
          candidateIntentId,
          candidateFallbackIntent?.userId === candidateActor.userId ? candidateFallbackIntent : null,
        );

        const candidate: NegotiationCandidate = {
          userId: candidateActor.userId,
          ...(sourceIntentId ? { sourceIntentId } : {}),
          ...(candidateIntentId ? { candidateIntentId } : {}),
          opportunityId: opp.id as string,
          opportunityStatus: opp.status,
          opportunityUpdatedAt: opp.updatedAt,
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

        // Deliberately no `initiatorUserId` here: re-entries inherit the stamp
        // from the prior task's metadata inside the negotiation init node
        // (continuations never re-derive the seat). The role heuristic above
        // remains only as the fallback for pre-stamp tasks.
        let continuationReceipt: NegotiationContinuationReceipt | undefined;
        const acceptedResults = await negotiateCandidates(
          this.negotiationGraph, sourceUser, [candidate],
          { networkId: '', prompt: '' },
          {
            maxTurns: Number(process.env.NEGOTIATION_MAX_TURNS_AMBIENT) || 6,
            indexContextOverrides: indexContextMap,
            timeoutMs: AMBIENT_PARK_WINDOW_MS,
            trigger: 'ambient',
            ...(continuation ? {
              resumeFromTaskId: continuation.taskId,
              continuationSettlementId: continuation.settlementId,
              continuationExecution: continuation,
              onCandidateResolved: async ({ continuationReceipt: receipt }) => {
                if (receipt?.successorTaskId === continuation.successorTaskId) continuationReceipt = receipt;
              },
            } : {}),
          },
        );

        // Send notifications to non-introducer actors if negotiation was accepted
        if (acceptedResults.length > 0 && this.queueNotification && !continuation) {
          for (const actor of nonIntroducerActors) {
            await this.queueNotification(opp.id, actor.userId, 'high').catch((err) => {
              negotiateExistingLog.warn('Failed to queue notification', { actorId: actor.userId, error: err });
            });
          }
        }

        negotiateExistingLog.info('Negotiation complete', {
          opportunityId: opp.id,
          accepted: acceptedResults.length > 0,
          continuationFence: continuation?.fence,
        });
        return continuationReceipt ? { negotiationContinuationReceipt: continuationReceipt } : {};
      } catch (err) {
        negotiateExistingLog.error('Failed', { opportunityId: state.opportunityId, error: err });
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
        routingLog.verbose('Error in prep - ending early');
        return END;
      }
      // Continuation mode: skip scope/resolve/discovery, go straight to evaluation
      if (state.operationMode === 'continue_discovery') {
        routingLog.verbose('Continue discovery → skipping to evaluation', {
          candidatesLoaded: state.candidates.length,
        });
        return 'evaluation';
      }
      routingLog.verbose('Continuing to scope');
      return 'scope';
    };

    /**
     * After scope: check if we have target indexes.
     */
    const shouldContinueAfterScope = (state: typeof OpportunityGraphState.State): string => {
      if (state.error || state.targetNetworks.length === 0) {
        routingLog.verbose('No target indexes - ending early');
        return END;
      }
      routingLog.verbose('Continuing to resolve');
      return 'resolve';
    };

    /**
     * After discovery: if create-intent signal was set, end so tool can return it; else continue to evaluation.
     */
    const shouldContinueAfterDiscovery = (state: typeof OpportunityGraphState.State): string => {
      if (state.createIntentSuggested) {
        routingLog.verbose('Create-intent suggested - ending for tool signal');
        return END;
      }
      return 'evaluation';
    };

    /**
     * After intro_validation: if validation set state.error, end early; else continue to intro_evaluation.
     */
    const routeAfterIntroValidation = (state: typeof OpportunityGraphState.State): string => {
      if (state.error) {
        routingLog.verbose('Intro validation error - ending early');
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
      // Fresh and continuation discovery both negotiate newly created/reactivated
      // opportunities. The stage is skipped only when no negotiation graph is wired or
      // persistence produced no negotiation targets (negotiateNode also guards both cases).
      .addNode('negotiate', negotiateNode)
      .addEdge('evaluation', 'ranking')
      .addEdge('ranking', 'persist')
      .addConditionalEdges('persist', (state) => {
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
