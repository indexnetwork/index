import type { ArtifactInput, HydeState } from './artifacts.js';
import { hasUnsupportedOpportunityClaim, mergeMatchEvidence, type EvaluatorEntity, type MatchExplainerInput, type MatchExplainerLike } from './explanation.js';
import { DEFAULT_MODEL } from './model.js';
import { discoveryNode, discoveryTraceSummary } from './retrieval.js';
import { getAbortSignalConfig, loggerFor, requestContext, timed } from './runtime.js';
import type { ActiveIntent, AgentTiming, CandidateSearch, MatchEvidence, DiscoveryData, RunOptions } from './types.js';

/**
 * Discovery retrieval thresholds.
 *
 * Discovery is intent-to-intent. The match-type and profile-source gates
 * (DISCOVERY_ALLOWED_TYPES, DISCOVERY_PROFILE_SOURCE) are gone with the
 * profile corpus they selected.
 */

/** Semantic retrieval cutoff, 0..1. */
export const DISCOVERY_MIN_SIMILARITY = 0.20;

/**
 * Minimum opportunities a discovery run surfaces when the pool allows it.
 */
export const DISCOVERY_MIN_MATCHES = 10;

function validateThreshold(name: string, value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${name} must be a finite decimal between 0 and ${max} (inclusive)`);
  }
  return value;
}

export function validateDiscoveryMinSimilarity(value: number): number {
  return validateThreshold('DISCOVERY_MIN_SIMILARITY', value, 1);
}

/** Asker's profile shape (identity + context). Used by sourceProfile annotation. */
export interface SourceProfileData {
  identity?: { name?: string; bio?: string; location?: string };
  context?: string;
}

/** Active source intent and its assigned networks. */
export interface IndexedIntent {
  intentId: string;
  payload: string;
  summary?: string;
  networks: string[];
}

/**
 * Target network for search (from scope node)
 */
export interface TargetNetwork {
  networkId: string;
  title: string;
  memberCount: number;
}

/**
 * Candidate match from discovery (semantic search).
 */
export interface CandidateMatch {
  candidateUserId: string;
  candidateIntentId?: string;
  /** Source context that produced this candidate, when context-grounded. */
  sourceContextId?: string;
  /** Candidate context that matched this candidate (set for user_context-based matches). */
  candidateContextId?: string;
  networkId: string;
  similarity: number;
  /** Free-text lens label that produced this match. */
  lens: string;
  candidatePayload: string;
  candidateSummary?: string;
  /** How this candidate was found. HyDE query retrieval is the only path. */
  discoverySource?: 'query';
  /** Which discovery strategies found this candidate (set by mergeStrategyCandidates). */
  matchedStrategies?: string[];
  /** Typed evidence that explains why this candidate entered evaluation. */
  evidence?: MatchEvidence[];
}

/**
 * Actor in an evaluated opportunity (from entity-bundle evaluator).
 * networkId is filled from the entity bundle in the graph, not by the evaluator.
 */
export interface EvaluatedOpportunityActor {
  userId: string;
  role: 'agent' | 'patient' | 'peer';
  intentId?: string;
  networkId: string;
}

/**
 * Evaluated opportunity with multi-actor output (entity-bundle evaluator).
 */
export interface EvaluatedOpportunity {
  actors: EvaluatedOpportunityActor[];
  score: number;
  reasoning: string;
  evidence?: MatchEvidence[];
}


export interface DiscoveryInput {
  userId: string;
  searchQuery?: string;
  networkId?: string;
  networkScope?: string[];
  triggerIntentId?: string;
  targetUserId?: string;
  options?: { limit?: number; existingOpportunities?: string };
}

export interface DiscoveryState extends Omit<DiscoveryInput, 'options'> {
  options: NonNullable<DiscoveryInput['options']>;
  indexedIntents: IndexedIntent[];
  userNetworks: string[];
  targetNetworks: TargetNetwork[];
  networkRelevancyScores: Record<string, number>;
  discoverySource: 'intent' | 'context';
  resolvedTriggerIntentId?: string;
  sourceProfile: SourceProfileData | null;
  resolvedIntentInNetwork: boolean;
  hydeEmbeddings: Record<string, number[]>;
  candidates: CandidateMatch[];
  evaluatedOpportunities: EvaluatedOpportunity[];
  error?: string;
  trace: Array<{ node: string; detail?: string; data?: Record<string, unknown> }>;
  agentTimings: AgentTiming[];
}

/** Potential pair; the host assigns protocol identity and decides whether to open it. */
export interface PotentialIntentPair {
  networkId: string;
  intentA: string;
  intentB: string;
  userA: string;
  userB: string;
  score: number;
  reasoning: string;
  evidence: MatchEvidence[];
}

export interface DiscoveryDeps {
  database: DiscoveryData;
  search: CandidateSearch;
  prepareArtifacts: (input: ArtifactInput) => Promise<Pick<HydeState, 'hydeEmbeddings'> & Partial<Pick<HydeState, 'lenses' | 'hydeDocuments'>>>;
  matchExplainer: MatchExplainerLike;
  retrievalMinSimilarity: number;
}
export const prepLog = loggerFor('Discovery:Prep');
export const scopeLog = loggerFor('Discovery:Scope');
export const resolveLog = loggerFor('Discovery:Resolve');
export const discoveryLog = loggerFor('Discovery:Discovery');
export const evaluationLog = loggerFor('Discovery:Evaluation');
export const rankingLog = loggerFor('Discovery:Ranking');

/**
 * Error text can include provider response bodies, URLs, and credentials. Keep
 * observability useful by retaining only a conservative error class at this
 * boundary; detailed errors are intentionally not emitted from graph traces.
 */
export function safeDiscoveryError(_error: unknown): string {
  return 'OpportunityEvaluationError: [redacted]';
}

/**
 * Wraps a graph node function to emit agent_start/agent_end trace events
 * at its boundaries so the frontend TRACE panel shows real-time progress.
 * @param traceName - Kebab-case agent name (e.g. "opportunity-prep")
 * @param nodeFn - The original node function
 * @param summaryFn - Optional function to derive a summary string from the node result
 */
export function withNodeTrace<S, R>(
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
      const errMsg = safeDiscoveryError(err);
      traceEmitter?.({ type: "agent_end", name: traceName, durationMs, summary: `error: ${errMsg}` });
      throw err;
    }
  };
}

/** Shared trace summary: surface `error` when a node returned one. */
export function errorSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown> | null | undefined;
  return r?.error ? `error: ${r.error}` : undefined;
}

/**
 * IND-567: Cool-down window (ms) for cross-query rejection suppression.
 * Candidates with a recently rejected opportunity within this window
 * receive a similarity penalty during evaluation ranking. 7 days.
 */
export const REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Similarity multiplier applied to candidates that fall within the rejection
 * cool-down window (IND-567). 0.5 halves their ranking score, typically
 * pushing them below the evaluation-batch cut while leaving a soft trace in
 * the trace log rather than silently dropping them.
 */
export const REJECTION_COOLDOWN_SIMILARITY_PENALTY = 0.5;

/** NUL separator: it cannot occur inside an id, so the composite key is unambiguous. */
const PAIR_KEY_SEPARATOR = String.fromCharCode(0);

export function networkMembershipPairKey(userId: string, networkId: string): string {
  return userId + PAIR_KEY_SEPARATOR + networkId;
}

export function buildEvaluatorEvidenceKey(candidate: CandidateMatch): string {
  return [
    candidate.candidateUserId,
    candidate.networkId,
    candidate.candidateIntentId ?? candidate.candidateContextId ?? candidate.sourceContextId ?? 'profile',
  ].join(':');
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
 * Discovery pipeline, stages 0–2: prep, scope, resolve.
 *
 * Each stage is a top-level function taking the graph state and an explicit
 * dependency bag. `opportunity.graph.ts` wires them into the StateGraph.
 */


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

/**
 * Discovery pipeline, stages 4–5: evaluation and ranking.
 *
 * Evaluation builds an entity bundle from the discoverer plus the top candidates
 * and asks a lightweight explainer to write the "why this match" reasoning for
 * each one — it does not judge accept/reject any more (negotiators own that
 * downstream). Every eligible candidate that survives discovery's own similarity
 * floor, membership checks, and the rejection cooldown is persisted; the only
 * reason a candidate is dropped here is an unsupported-claim guard trip.
 */


/** Explanation coupled to the authoritative discovery candidate that produced it. */
type CandidateExplanation = {
  reasoning: string;
  droppedUnsupportedClaim?: boolean;
  candidate: CandidateMatch;
};


/**
 * Every candidate in the pool is explained and persisted — no score cutoff,
 * no similarity cutoff beyond discovery's own retrieval floor. This still
 * bounds the pool by rank so a run can never fan out unboundedly against a
 * very large network.
 */
const MAX_EVALUATION_POOL = 80;

/**
 * Node 3: Evaluation (Entity bundle)
 * Builds entity bundle from source + candidates, asks the match explainer for
 * reasoning, and maps every survivor to an `EvaluatedOpportunity`.
 */
export async function evaluationNode(state: DiscoveryState, deps: DiscoveryDeps) {
  return timed("OpportunityGraph.evaluation", async () => {
    const startTime = Date.now();
    evaluationLog.verbose('Starting evaluation', {
      candidatesCount: state.candidates.length,
    });

    if (state.candidates.length === 0) {
      evaluationLog.verbose('No candidates to evaluate');
      return { evaluatedOpportunities: [], agentTimings: [] };
    }

    const sortedCandidates = [...state.candidates].sort((a, b) => b.similarity - a.similarity);
    const dedupedCandidates = dedupeCandidatesByUser(sortedCandidates, state);

    const discoveryUserId = state.userId;
    let eligibleCandidates: CandidateMatch[];
    try {
      eligibleCandidates = await filterToActiveMemberships(dedupedCandidates, discoveryUserId, deps);
    } catch (error) {
      evaluationLog.error('Active network membership recheck failed; skipping evaluation', { error });
      return {
        candidates: [],
        evaluatedOpportunities: [],
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
      return { candidates: [], evaluatedOpportunities: [], agentTimings: [] };
    }

    if (dedupedCandidates.length < sortedCandidates.length) {
      evaluationLog.info("Deduped candidates by userId", {
        before: sortedCandidates.length,
        after: dedupedCandidates.length,
        removed: sortedCandidates.length - dedupedCandidates.length,
      });
    }

    const pool = await applyRejectionCooldown(eligibleCandidates, discoveryUserId, deps);
    const boundedPool = pool.slice(0, MAX_EVALUATION_POOL);
    if (boundedPool.length < pool.length) {
      evaluationLog.info('Evaluation pool bounded by rank', {
        pool: pool.length,
        evaluated: boundedPool.length,
      });
    }

    const agentTimingsAccum: AgentTiming[] = [];

    try {
      const sourceProfile = await deps.database.getProfile(discoveryUserId);
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
        networkId: '' as string,  // Placeholder — overwritten per-pairing below
        evidenceKey: `${discoveryUserId}::source`,
        ragScore: undefined,
        matchedVia: undefined,
      };

      const explainerSignalConfig = getAbortSignalConfig();

      const { evaluatedOpportunities, trace: traceEntries } = await evaluateCandidatePool({
        pool: boundedPool,
        sourceEntity,
        state,
        deps,
        discoveryUserId,
        explainerSignalConfig,
        agentTimingsAccum,
      });

      evaluationLog.verbose('Evaluation complete', {
        evaluatedCandidates: boundedPool.length,
        explained: evaluatedOpportunities.length,
      });

      return {
        candidates: eligibleCandidates,
        evaluatedOpportunities,
        trace: traceEntries,
        agentTimings: agentTimingsAccum,
      };
    } catch (error) {
      const errMsg = safeDiscoveryError(error);
      evaluationLog.error('Failed', { error: errMsg });
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
}

/** Everything the evaluation round needs, resolved once per run by {@link evaluationNode}. */
interface CandidatePoolArgs {
  pool: CandidateMatch[];
  sourceEntity: EvaluatorEntity;
  state: DiscoveryState;
  deps: DiscoveryDeps;
  discoveryUserId: string;
  explainerSignalConfig: ReturnType<typeof getAbortSignalConfig>;
  agentTimingsAccum: AgentTiming[];
}

/**
 * Evaluate the whole candidate pool in one parallel round: hydrate entities,
 * invoke the match explainer once per candidate, and map every survivor onto
 * an `EvaluatedOpportunity`. The only candidates dropped here are ones whose
 * explanation tripped the unsupported-claim guard.
 */
async function evaluateCandidatePool(
  args: CandidatePoolArgs,
): Promise<{ evaluatedOpportunities: EvaluatedOpportunity[]; trace: TraceEntry[] }> {
  const {
    pool, sourceEntity, state, deps, discoveryUserId,
    explainerSignalConfig, agentTimingsAccum,
  } = args;
  const evalStart = Date.now();
  const traceEntries: TraceEntry[] = [];

  const candidateEntities = await buildCandidateEntities(pool, deps);
  const evidenceByEntityKey = new Map<string, MatchEvidence[]>();
  const entityKeysByUserId = new Map<string, string[]>();
  for (const e of candidateEntities) {
    if (e.evidenceKey) {
      evidenceByEntityKey.set(
        e.evidenceKey,
        mergeMatchEvidence(evidenceByEntityKey.get(e.evidenceKey), e.evidence),
      );
      entityKeysByUserId.set(e.userId, [...(entityKeysByUserId.get(e.userId) ?? []), e.evidenceKey]);
    }
  }

  function evidenceForActor(actor: { userId: string; intentId?: string | null; evidenceKey?: string | null }): MatchEvidence[] | undefined {
    if (actor.evidenceKey) return evidenceByEntityKey.get(actor.evidenceKey);
    const keys = entityKeysByUserId.get(actor.userId) ?? [];
    const intentKey = actor.intentId ? keys.find((key) => key.endsWith(`:${actor.intentId}`)) : undefined;
    if (intentKey) return evidenceByEntityKey.get(intentKey);
    // Avoid leaking unrelated resource evidence when a user has more than one
    // candidate entity collapsed into a single profile-only actor.
    if (keys.length === 1) return evidenceByEntityKey.get(keys[0]!);
    return undefined;
  }

  const networkContexts = await deps.database.getNetworkContexts([...new Set(candidateEntities.map(entity => entity.networkId))]);

  // One explainer call per candidate, fired in parallel — the whole pool, one round.
  const explanations = await explainInParallel({
    matchExplainer: deps.matchExplainer, sourceEntity, candidateEntities, candidateMatches: pool, state, discoveryUserId,
    networkContexts, explainerSignalConfig, agentTimingsAccum, traceEntries,
  });

  const dropped = explanations.filter((e) => e.droppedUnsupportedClaim);
  const kept = explanations.filter((e) => !e.droppedUnsupportedClaim);

  function toEvaluatedOpportunity(explanation: CandidateExplanation): EvaluatedOpportunity {
    const { candidate, reasoning } = explanation;
    const actors: EvaluatedOpportunity['actors'] = [
      {
        userId: discoveryUserId as string,
        role: 'peer',
        intentId: state.resolvedTriggerIntentId ?? sourceEntity.intents?.[0]?.intentId as string | undefined,
        networkId: candidate.networkId,
      },
      {
        userId: candidate.candidateUserId,
        role: 'peer',
        intentId: candidate.candidateIntentId,
        networkId: candidate.networkId,
      },
    ];
    return {
      reasoning,
      score: candidate.similarity * 100,
      evidence: mergeMatchEvidence(...actors.map(evidenceForActor)),
      actors,
    };
  }

  const evaluatedOpportunities = kept.map(toEvaluatedOpportunity);

  evaluationLog.verbose('Pool evaluated', {
    evaluatedCount: explanations.length,
    explainedCount: evaluatedOpportunities.length,
    droppedCount: dropped.length,
  });

  // Threshold filter trace: how many candidates in the pool were above/below the retrieval similarity threshold.
  const aboveThreshold = pool.filter(
    (candidate) => candidate.similarity >= deps.retrievalMinSimilarity,
  ).length;
  const belowThreshold = pool.length - aboveThreshold;
  traceEntries.push({
    node: "threshold_filter",
    detail: `${aboveThreshold} above ${deps.retrievalMinSimilarity}, ${belowThreshold} below (pool of ${pool.length})`,
    data: {
      aboveThreshold,
      belowThreshold,
      minSimilarity: deps.retrievalMinSimilarity,
      retrievalMinSimilarity: deps.retrievalMinSimilarity,
      poolSize: pool.length,
    },
  });

  const explainedByUserId = new Map<string, { score: number; reasoning: string }>();
  for (const opp of evaluatedOpportunities) {
    const candidateActor = opp.actors.find(a => a.userId !== discoveryUserId);
    if (candidateActor) {
      explainedByUserId.set(candidateActor.userId, { score: opp.score, reasoning: opp.reasoning });
    }
  }
  const droppedByUserId = new Map<string, true>();
  for (const explanation of dropped) {
    droppedByUserId.set(explanation.candidate.candidateUserId, true);
  }

  traceEntries.push({
    node: "evaluation",
    detail: `Explained ${candidateEntities.length} candidate(s) → ${evaluatedOpportunities.length} persisted, ${dropped.length} dropped by claim-safety guard`,
    data: {
      inputCandidates: pool.length,
      explainedCount: evaluatedOpportunities.length,
      droppedCount: dropped.length,
      durationMs: Date.now() - evalStart,
      model: DEFAULT_MODEL,
    },
  });

  if (dropped.length > 0) {
    traceEntries.push({
      node: "evaluation_dropped",
      detail: `${dropped.length} explanation(s) dropped by the unsupported-claim guard`,
      data: {
        droppedCount: dropped.length,
        drops: dropped.map((e) => ({ candidateUserId: e.candidate.candidateUserId })),
      },
    });
  }

  // Individual candidate entries - show ALL candidates that went to the explainer
  for (const entity of candidateEntities) {
    const candidateName = entity.profile?.name || entity.userId.slice(0, 8);
    const explained = explainedByUserId.get(entity.userId);
    const wasDropped = droppedByUserId.has(entity.userId);
    const status = explained
      ? '✓ explained'
      : wasDropped
        ? '✗ dropped (unsupported claim)'
        : '✗ no explanation';

    traceEntries.push({
      node: "candidate",
      detail: `${candidateName}: ${status}`,
      data: {
        userId: entity.userId,
        name: candidateName,
        bio: entity.profile?.bio,
        score: explained?.score,
        explained: !!explained,
        dropped: wasDropped,
        reasoning: explained?.reasoning ?? 'No explanation persisted for this candidate',
        matchedVia: entity.matchedVia,
        ragScore: entity.ragScore,
        model: DEFAULT_MODEL,
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

  return { evaluatedOpportunities, trace: traceEntries };
}
/** Dedup by userId — when same similarity, prefer network with highest relevancyScore. */
function dedupeCandidatesByUser(sortedCandidates: CandidateMatch[], state: DiscoveryState): CandidateMatch[] {
  const bestByUser = new Map<string, CandidateMatch>();
  for (const c of sortedCandidates) {
    const existing = bestByUser.get(c.candidateUserId);
    if (!existing) {
      bestByUser.set(c.candidateUserId, c);
    } else if (c.similarity > existing.similarity) {
      bestByUser.set(c.candidateUserId, c);
    } else if (c.similarity === existing.similarity) {
      // Tie-break: prefer network with higher relevancy score
      const cScore = state.networkRelevancyScores[c.networkId] ?? 0;
      const existingScore = state.networkRelevancyScores[existing.networkId] ?? 0;
      if (cScore > existingScore) {
        bestByUser.set(c.candidateUserId, c);
      }
    }
  }
  const deduped = Array.from(bestByUser.values());
  // Re-sort by similarity descending (Map iteration order doesn't guarantee sort)
  deduped.sort((a, b) => b.similarity - a.similarity);
  return deduped;
}

/** Both sides of every pairing must still hold an active membership in the shared network. */
async function filterToActiveMemberships(
  dedupedCandidates: CandidateMatch[],
  discoveryUserId: string,
  deps: DiscoveryDeps,
): Promise<CandidateMatch[]> {
  const requestedPairs = dedupedCandidates.flatMap((candidate) => [
    { userId: discoveryUserId, networkId: candidate.networkId },
    { userId: candidate.candidateUserId, networkId: candidate.networkId },
  ]);
  const activePairs = await deps.database.getActiveNetworkMembershipPairs(requestedPairs);
  const activePairKeys = new Set(
    activePairs.map((pair) => networkMembershipPairKey(pair.userId, pair.networkId)),
  );
  return dedupedCandidates.filter((candidate) =>
    activePairKeys.has(networkMembershipPairKey(discoveryUserId, candidate.networkId))
    && activePairKeys.has(networkMembershipPairKey(candidate.candidateUserId, candidate.networkId)),
  );
}

/**
 * IND-567: Rejection cool-down penalty.
 *
 * Candidates with a recently rejected opportunity receive a
 * similarity penalty so they are ranked lower (and often pushed out of
 * the evaluation pool). This prevents cross-query re-surfacing of
 * false-positive matches that were already caught downstream.
 * The persist-node dedup is still the hard gate; this is a soft guard
 * that reduces explainer cost and repeat surfacing of already-rejected pairs.
 */
async function applyRejectionCooldown(
  eligibleCandidates: CandidateMatch[],
  discoveryUserId: string,
  deps: DiscoveryDeps,
): Promise<CandidateMatch[]> {
  const rejectionCooldownIds = new Set<string>();
  if (eligibleCandidates.length > 0) {
    try {
      const ids = await deps.database.getRecentlyRejectedOpportunityCounterparties(
        discoveryUserId,
        eligibleCandidates.map((c) => c.candidateUserId),
        REJECTION_COOLDOWN_MS,
      );
      for (const id of ids) rejectionCooldownIds.add(id);
      if (rejectionCooldownIds.size > 0) {
        evaluationLog.info('IND-567 rejection cool-down: applying similarity penalty', {
          affectedCount: rejectionCooldownIds.size,
          cooldownDays: Math.round(REJECTION_COOLDOWN_MS / (24 * 60 * 60 * 1000)),
          penalty: REJECTION_COOLDOWN_SIMILARITY_PENALTY,
        });
      }
    } catch (err) {
      evaluationLog.warn('IND-567 rejection cool-down: lookup failed, skipping penalty', {
        error: safeDiscoveryError(err),
      });
    }
  }

  // Apply penalty and re-sort so penalised candidates fall to the back.
  return rejectionCooldownIds.size > 0
    ? eligibleCandidates
        .map((c) =>
          rejectionCooldownIds.has(c.candidateUserId)
            ? { ...c, similarity: c.similarity * REJECTION_COOLDOWN_SIMILARITY_PENALTY }
            : c,
        )
        .sort((a, b) => b.similarity - a.similarity)
    : eligibleCandidates;
}

/** Hydrate each candidate into the profile/intent shape the explainer reads. */
async function buildCandidateEntities(
  batchToEvaluate: CandidateMatch[],
  deps: DiscoveryDeps,
): Promise<EvaluatorEntity[]> {
  return Promise.all(
    batchToEvaluate.map(async (c) => {
      const profile = await deps.database.getProfile(c.candidateUserId);
      let intentPayload = c.candidatePayload;
      let intentSummary = c.candidateSummary;
      const evidence = c.evidence;
      if (c.candidateIntentId != null && (!intentPayload || intentPayload === '')) {
        const intent = await deps.database.getIntent(c.candidateIntentId);
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
          context: profile?.context,
        },
        intents:
          c.candidateIntentId != null
            ? [{ intentId: c.candidateIntentId, payload: intentPayload ?? '', summary: intentSummary }]
            : undefined,
        networkId: c.networkId,
        evidenceKey: buildEvaluatorEvidenceKey(c),
        ragScore: c.similarity * 100,
        matchedVia: c.lens,
        evidence,
      };
    })
  );
}

/** Shared arguments for the explainer invocation. */
interface ExplainArgs {
  matchExplainer: DiscoveryDeps['matchExplainer'];
  sourceEntity: EvaluatorEntity;
  candidateEntities: EvaluatorEntity[];
  candidateMatches: CandidateMatch[];
  state: DiscoveryState;
  discoveryUserId: string;
  networkContexts: Record<string, string>;
  explainerSignalConfig: ReturnType<typeof getAbortSignalConfig>;
  agentTimingsAccum: AgentTiming[];
}

/** Build the explainer input for a given entity pair. */
function buildExplainerInput(args: ExplainArgs, entities: EvaluatorEntity[]): MatchExplainerInput {
  return {
    discovererId: args.discoveryUserId,
    entities,
    existingOpportunities: args.state.options.existingOpportunities,
    ...(args.state.searchQuery?.trim() ? { discoveryQuery: args.state.searchQuery.trim() } : {}),
    networkContexts: args.networkContexts,
  };
}

/** One LLM call per candidate, all fired in parallel. */
async function explainInParallel(
  args: ExplainArgs & { traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> },
): Promise<CandidateExplanation[]> {
  const { matchExplainer, sourceEntity, candidateEntities, candidateMatches, explainerSignalConfig, agentTimingsAccum, traceEntries } = args;
  evaluationLog.verbose('Running parallel explanation', { candidates: candidateEntities.length });
  const parallelErrors: Array<{ candidateUserId: string; candidateName: string; error: string; durationMs: number }> = [];

  const parallelResults = await Promise.all(
    candidateEntities.map((candidateEntity, index) => {
      const candidate = candidateMatches[index];
      if (!candidate) throw new Error('Candidate entity has no discovery provenance');
      const input = buildExplainerInput(args, [sourceEntity, candidateEntity]);
      const _evalStart = Date.now();
      const _traceEmitter = requestContext.getStore()?.traceEmitter;
      _traceEmitter?.({ type: "agent_start", name: "opportunity-match-explainer" });
      const _candidateName = candidateEntity.profile?.name ?? "Unknown";
      return matchExplainer.explain(input, explainerSignalConfig)
        .then((res): CandidateExplanation => {
          const _evalDuration = Date.now() - _evalStart;
          agentTimingsAccum.push({ name: 'opportunity.match-explainer', durationMs: _evalDuration });
          const _summary = res.droppedUnsupportedClaim ? `${_candidateName}: dropped` : `${_candidateName}: explained`;
          _traceEmitter?.({ type: "agent_end", name: "opportunity-match-explainer", durationMs: _evalDuration, summary: _summary });
          return { ...res, candidate };
        })
        .catch((err): CandidateExplanation => {
          const _evalDuration = Date.now() - _evalStart;
          const _errMsg = safeDiscoveryError(err);
          agentTimingsAccum.push({ name: 'opportunity.match-explainer', durationMs: _evalDuration });
          _traceEmitter?.({ type: "agent_end", name: "opportunity-match-explainer", durationMs: _evalDuration, summary: `${_candidateName}: error — ${_errMsg}` });
          evaluationLog.warn('Parallel explanation failed for candidate', {
            candidateUserId: candidateEntity.userId,
            error: _errMsg,
          });
          parallelErrors.push({
            candidateUserId: candidateEntity.userId,
            candidateName: _candidateName,
            error: _errMsg,
            durationMs: _evalDuration,
          });
          return { reasoning: '', droppedUnsupportedClaim: true, candidate };
        });
    })
  );

  // Record trace entries for candidates that failed during parallel explanation
  if (parallelErrors.length > 0) {
    traceEntries.push({
      node: "evaluation_errors",
      detail: `${parallelErrors.length}/${candidateEntities.length} candidate explanation(s) failed`,
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

  return parallelResults;
}

/**
 * Node 4: Ranking
 * Sorts evaluated opportunities by score, applies limit, dedupes by actor-set hash.
 */
export async function rankingNode(state: DiscoveryState) {
  return timed("OpportunityGraph.ranking", async () => {
    rankingLog.verbose('Starting ranking', {
      evaluatedCount: state.evaluatedOpportunities.length,
    });

    try {
      const sorted = [...state.evaluatedOpportunities].sort((a, b) => b.score - a.score);
      const ranked = state.options.limit != null ? sorted.slice(0, state.options.limit) : sorted;

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
}

/** Trace summary for {@link rankingNode}. */
export function rankingTraceSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown>;
  if (r?.error) return `error: ${r.error}`;
  const opps = r?.evaluatedOpportunities as unknown[];
  return opps ? `Ranked ${opps.length} opportunity(ies)` : undefined;
}

/** Plain async discovery. The host owns every protocol mutation after discovery. */
export class Discovery {
  private readonly deps: DiscoveryDeps;

  constructor(deps: Omit<DiscoveryDeps, 'retrievalMinSimilarity'> & { retrievalMinSimilarity?: number }) {
    this.deps = { ...deps, retrievalMinSimilarity: validateDiscoveryMinSimilarity(deps.retrievalMinSimilarity ?? DISCOVERY_MIN_SIMILARITY) };
  }

  /**
   * @param input - Discoverer, intent/query, and requested network scope.
   * @param options - Cancellation and tracing, isolated to this run.
   * @returns Potential intent pairs and discovery diagnostics, with no opportunities committed.
   * @throws On cancellation; ordinary stage failures are reported in `error`.
   */
  discover(input: DiscoveryInput, options: RunOptions = {}): Promise<DiscoveryState & { pairs: PotentialIntentPair[] }> {
    return requestContext.run(options, async () => {
      const state: DiscoveryState = {
        ...input, options: input.options ?? {}, indexedIntents: [], userNetworks: [], targetNetworks: [],
        networkRelevancyScores: {}, discoverySource: 'intent', sourceProfile: null, resolvedIntentInNetwork: false,
        hydeEmbeddings: {}, candidates: [], evaluatedOpportunities: [], trace: [], agentTimings: [],
      };
      const apply = async (
        name: string,
        step: (state: DiscoveryState, deps: DiscoveryDeps) => Promise<Partial<DiscoveryState>>,
        summary?: (result: unknown) => string | undefined,
      ) => {
        options.signal?.throwIfAborted();
        const result = await withNodeTrace(name, (s: DiscoveryState) => step(s, this.deps), summary)(state);
        const trace = [...state.trace, ...(result.trace ?? [])];
        const agentTimings = [...state.agentTimings, ...(result.agentTimings ?? [])];
        Object.assign(state, result, { trace, agentTimings });
        options.signal?.throwIfAborted();
      };
      await apply('opportunity-prep', prepNode, prepTraceSummary);
      if (!state.error) await apply('opportunity-scope', scopeNode, scopeTraceSummary);
      if (!state.error && state.targetNetworks.length) {
        await apply('opportunity-resolve', resolveNode, resolveTraceSummary);
        if (!state.error) await apply('opportunity-discovery', discoveryNode, discoveryTraceSummary);
        if (!state.error) await apply('opportunity-evaluation', evaluationNode);
        if (!state.error) await apply('opportunity-ranking', rankingNode, rankingTraceSummary);
      }

      const pairs: PotentialIntentPair[] = [];
      for (const evaluated of state.evaluatedOpportunities) {
        const own = evaluated.actors.find(actor => actor.userId === state.userId);
        const other = evaluated.actors.find(actor => actor.userId !== state.userId);
        const networkId = state.networkId ?? own?.networkId ?? other?.networkId;
        if (!own?.intentId || !other?.intentId || !networkId || hasUnsupportedOpportunityClaim(evaluated.reasoning)) continue;
        pairs.push({
          networkId, intentA: own.intentId, intentB: other.intentId, userA: own.userId, userB: other.userId,
          score: evaluated.score, reasoning: evaluated.reasoning, evidence: evaluated.evidence ?? [],
        });
      }
      return { ...state, pairs };
    });
  }
}

type TraceEntry = { node: string; detail?: string; data?: Record<string, unknown> };
