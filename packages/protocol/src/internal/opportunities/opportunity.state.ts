import type { Id, OpportunityStatus } from '../../platform/database.js';
import type { Lens } from '../../platform/discovery/embedder.js';
import type { DebugMetaAgent } from "../../protocol/core.js";
import type { OpportunityEvidence } from '../../protocol/schemas/network-assignment.schema.js';
import type { DiscoveryMatchCandidate } from '../../platform/database.js';

/**
 * Opportunity Graph State (Linear Multi-Step Workflow)
 *
 * Flow: Prep → Scope → Discovery → Evaluation → Ranking → Persist → END
 *
 * Following the intent graph pattern with Annotation-based state management.
 */

/** Asker's profile shape (identity + context). Used by sourceProfile annotation. */
export interface SourceProfileData {
  identity?: { name?: string; bio?: string; location?: string };
  context?: string;
}

/**
 * Indexed intent with hyde document (from prep node)
 */
export interface IndexedIntent {
  intentId: Id<'intents'>;
  payload: string;
  summary?: string;
  hydeDocumentId?: string;
  hydeEmbedding?: number[];
  indexes: Id<'networks'>[];
}

/**
 * Target index for search (from scope node)
 */
export interface TargetNetwork {
  networkId: Id<'networks'>;
  title: string;
  memberCount: number;
}

/**
 * Candidate match from discovery (semantic search).
 */
export interface CandidateMatch {
  candidateUserId: Id<'users'>;
  candidateIntentId?: Id<'intents'>;
  /** Source premise that produced this candidate, when premise-grounded. */
  sourcePremiseId?: Id<'premises'>;
  /** Candidate premise that matched this candidate (set for premise-based matches). */
  candidatePremiseId?: Id<'premises'>;
  /** Source context that produced this candidate, when context-grounded. */
  sourceContextId?: string;
  /** Candidate context that matched this candidate (set for user_context-based matches). */
  candidateContextId?: string;
  networkId: Id<'networks'>;
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
  evidence?: OpportunityEvidence[];
}

/**
 * Evaluated candidate with LLM scoring (legacy; used when evaluator returns source/candidate pair).
 * candidateIntentId is set for intent matches; omitted for profile-only matches.
 */
export interface EvaluatedCandidate {
  sourceUserId: Id<'users'>;
  candidateUserId: Id<'users'>;
  sourceIntentId?: Id<'intents'>;
  candidateIntentId?: Id<'intents'>;
  networkId: Id<'networks'>;
  score: number; // 0-100
  reasoning: string; // Third-party analytical explanation of the match (for LLM agents)
  valencyRole: 'Agent' | 'Patient' | 'Peer';
  /** Free-text lens label that produced this match. */
  lens: string;
}

/**
 * Actor in an evaluated opportunity (from entity-bundle evaluator).
 * networkId is filled from the entity bundle in the graph, not by the evaluator.
 */
export interface EvaluatedOpportunityActor {
  userId: Id<'users'>;
  role: 'agent' | 'patient' | 'peer';
  intentId?: Id<'intents'>;
  networkId: Id<'networks'>;
}

/**
 * Evaluated opportunity with multi-actor output (entity-bundle evaluator).
 */
export interface EvaluatedOpportunity {
  actors: EvaluatedOpportunityActor[];
  score: number;
  reasoning: string;
  evidence?: OpportunityEvidence[];
}

export interface OpportunityPersistenceOutcome {
  evaluatedCount: number;
  createdCount: number;
  reactivatedCount: number;
  sameIntentPairDuplicateSuppressions: number;
  crossIntentPairAllowedCount: number;
  finalAtomicConflictCount: number;
}

/**
 * Options passed to the graph
 */
export interface OpportunityGraphOptions {
  /** Maximum opportunities to return (default: 20) */
  limit?: number;
  /** Pre-inferred lenses (if not provided, lens inference runs automatically in HyDE graph) */
  lenses?: Lens[];
  /** User's search query for HyDE generation */
  hydeDescription?: string;
  /** Existing opportunities summary for evaluator deduplication */
  existingOpportunities?: string;
  /** Chat session ID for draft opportunities; stored as context.conversationId for visibility filtering. */
  conversationId?: string;
}

/**
 * Opportunity Graph State Annotation
 */
export interface OpportunityState {
  userId: Id<'users'>;
  searchQuery: string | undefined;
  networkId: Id<'networks'> | undefined;
  /** Optional set of indexes discovery may search within (e.g. a network-scoped agent's reachable networks: the bound network). The scope node intersects this with the user's actual memberships. Ignored when `networkId` is set (single-network override). When unset, discovery spans all of the user's networks. */
  indexScope: Id<'networks'>[] | undefined;
  /** Optional intent to use as discovery source and for triggeredBy. When set, used for search text (if query empty) and persist. */
  triggerIntentId: Id<'intents'> | undefined;
  /** Optional: restrict discovery to this specific user ID only (direct connection). */
  targetUserId: Id<'users'> | undefined;
  options: OpportunityGraphOptions;
  /** Operation mode controls graph flow: - 'create': the discovery pipeline (Prep → Scope → Discovery → Evaluation → Ranking → EmitCandidates) - 'read': List opportunities filtered by userId and optionally networkId (fast path) - 'update': Change opportunity status (accept, reject, etc.) - 'delete': Expire/archive an opportunity Defaults to 'create'. */
  operationMode: 'create' | 'read' | 'update' | 'delete';
  /** When set (e.g. chat scope), networkId must match this. */
  requiredNetworkId: Id<'networks'> | undefined;
  /** Target opportunity ID for update/delete modes. */
  opportunityId: string | undefined;
  /** New status for update mode (e.g. 'accepted', 'rejected'). */
  newStatus: string | undefined;
  /** User's indexed intents with hyde documents (from prep) */
  indexedIntents: IndexedIntent[];
  /** User's network memberships (from prep) */
  userNetworks: Id<'networks'>[];
  /** Target indexes to search within (from scope) */
  targetNetworks: TargetNetwork[];
  /** Per-index relevancy scores for dedup tie-breaking. Background path: from intent_indexes. Chat path: transient from IntentIndexer. */
  indexRelevancyScores: Record<string, number>;
  /** Whether discovery used intent (path A) or user context (path B/C). Used by persist for triggeredBy. In-memory routing state only; never persisted. */
  discoverySource: 'intent' | 'context';
  /** Resolved intent ID used for this discovery run (when discoverySource is 'intent'). Set by intent-resolution. */
  resolvedTriggerIntentId: Id<'intents'> | undefined;
  /** Asker's profile (from prep). Used for profile-as-source discovery and evaluation. */
  sourceProfile: SourceProfileData | null;
  /** User's active premises with embeddings (from prep). Used for premise-to-premise discovery path D. */
  sourcePremises: Array<{ premiseId: Id<'premises'>; embedding: number[] }>;
  /** User context embeddings per network (from prep). Used for discovery. */
  sourceContexts: Array<{ contextId: string; networkId: Id<'networks'>; text: string; embedding: number[] }>;
  /** Resolved intent is in at least one target index (path A vs C). */
  resolvedIntentInIndex: boolean;
  /** Create-intent signal: when true, tool should return createIntentSuggested so agent can auto-call create_intent. */
  createIntentSuggested: boolean;
  /** Suggested description for create_intent when createIntentSuggested is true. */
  suggestedIntentDescription: string | undefined;
  /** HyDE embeddings per lens label (from discovery) */
  hydeEmbeddings: Record<string, number[]>;
  /** Candidate matches from semantic search (from discovery) */
  candidates: CandidateMatch[];
  /** Discovery session ID for pagination (maps to Redis cache key). */
  discoveryId: string | null;
  /** Evaluated candidates with scores (from evaluation; legacy) */
  evaluatedCandidates: EvaluatedCandidate[];
  /** Evaluated opportunities with actors (from entity-bundle evaluator) */
  evaluatedOpportunities: EvaluatedOpportunity[];
  /** Pairs discovery recorded this run. Discovery creates no opportunities. */
  candidatesEmitted: DiscoveryMatchCandidate[];
  /** Discovery path: pairs skipped because an opportunity already exists between viewer and candidate (no duplicate created). */
  existingBetweenActors: Array<{
    candidateUserId: Id<'users'>;
    networkId: Id<'networks'>;
    existingOpportunityId?: Id<'opportunities'>;
    existingStatus?: OpportunityStatus;
    reason?: 'same_intent_pair_duplicate' | 'final_atomic_conflict';
    existingTriggerIntentId?: string;
  }>;
  /** Typed persist-node counts used by queue telemetry. */
  persistenceOutcome: OpportunityPersistenceOutcome | undefined;
  /** Error message if any step fails */
  error: string | undefined;
  /** Output for read mode: enriched list of opportunities. */
  readResult: {
    count: number;
    message?: string;
    opportunities: Array<{
      id: string;
      indexName: string;
      connectedWith: string[];
      suggestedBy: string | null;
      reasoning: string;
      status: string;
      category: string;
      confidence: number | null;
      source: string | null;
    }>;
  } | undefined;
  /** Output for update/delete/send modes. */
  mutationResult: {
    success: boolean;
    message?: string;
    opportunityId?: string;
    notified?: string[];
    conversationId?: string;
    error?: string;
  } | undefined;
  /** Accumulated trace entries from each graph node. Used for observability: surfaces internal processing steps (search query, HyDE strategies, candidates found, evaluation results) to the frontend. */
  trace: Array<{ node: string; detail?: string; data?: Record<string, unknown> }>;
  /** Timing records for each agent invocation within this graph run. */
  agentTimings: DebugMetaAgent[];
}

export function opportunityDefaults(): OpportunityState {
  return {
    userId: '' as Id<'users'>,
    searchQuery: undefined,
    networkId: undefined,
    indexScope: undefined,
    triggerIntentId: undefined,
    targetUserId: undefined,
    options: ({}),
    operationMode: 'create' as const,
    requiredNetworkId: undefined,
    opportunityId: undefined,
    newStatus: undefined,
    indexedIntents: [],
    userNetworks: [],
    targetNetworks: [],
    indexRelevancyScores: ({}),
    discoverySource: 'intent',
    resolvedTriggerIntentId: undefined,
    sourceProfile: null,
    sourcePremises: [],
    sourceContexts: [],
    resolvedIntentInIndex: false,
    createIntentSuggested: false,
    suggestedIntentDescription: undefined,
    hydeEmbeddings: ({}),
    candidates: [],
    discoveryId: null,
    evaluatedCandidates: [],
    evaluatedOpportunities: [],
    candidatesEmitted: [],
    existingBetweenActors: [],
    persistenceOutcome: undefined,
    error: undefined,
    readResult: undefined,
    mutationResult: undefined,
    trace: [],
    agentTimings: [],
  };
}

