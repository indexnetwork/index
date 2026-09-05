import { Annotation } from "@langchain/langgraph";
import type { Id, OpportunityStatus } from '../../platform/database.js';
import type { Lens } from '../../platform/discovery/embedder.js';
import type { DebugMetaAgent } from "../../protocol/core.js";
import type { OpportunityEvidence } from '../../protocol/schemas/network-assignment.schema.js';
import type { OpenedNegotiation } from '../../platform/database.js';

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
  networks: Id<'networks'>[];
}

/**
 * Target network for search (from scope node)
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
export const OpportunityGraphState = Annotation.Root({
  // ─── Input Fields (Required) ───
  userId: Annotation<Id<'users'>>({
    reducer: (curr, next) => next ?? curr,
    default: () => '' as Id<'users'>,
  }),

  searchQuery: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  networkId: Annotation<Id<'networks'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * Optional set of networks discovery may search within (e.g. a network-scoped
   * agent's reachable networks: the bound network).
   * The scope node intersects this with the user's actual memberships. Ignored
   * when `networkId` is set (single-network override). When unset, discovery
   * spans all of the user's networks.
   */
  networkScope: Annotation<Id<'networks'>[] | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Optional intent to use as discovery source and for triggeredBy. When set, used for search text (if query empty) and persist. */
  triggerIntentId: Annotation<Id<'intents'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Optional: restrict discovery to this specific user ID only (direct connection). */
  targetUserId: Annotation<Id<'users'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  options: Annotation<OpportunityGraphOptions>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({}),
  }),

  /**
   * Operation mode controls graph flow:
   * - 'create': the discovery pipeline (Prep → Scope → Discovery → Evaluation → Ranking → EmitCandidates)
   * - 'read': List opportunities filtered by userId and optionally networkId (fast path)
   * - 'update': Change opportunity status (accept, reject, etc.)
   * - 'delete': Expire/archive an opportunity
   *
   * Defaults to 'create'.
   */
  operationMode: Annotation<'create' | 'read' | 'update' | 'delete'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'create' as const,
  }),

  /** When set (e.g. chat scope), networkId must match this. */
  requiredNetworkId: Annotation<Id<'networks'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  /** Target opportunity ID for update/delete modes. */
  opportunityId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** New status for update mode (e.g. 'accepted', 'rejected'). */
  newStatus: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  // ─── Intermediate Fields (Accumulated) ───

  /** User's indexed intents with hyde documents (from prep) */
  indexedIntents: Annotation<IndexedIntent[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** User's network memberships (from prep) */
  userNetworks: Annotation<Id<'networks'>[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Target networks to search within (from scope) */
  targetNetworks: Annotation<TargetNetwork[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Per-network relevancy scores for dedup tie-breaking, read from intent_networks. */
  networkRelevancyScores: Annotation<Record<string, number>>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({}),
  }),

  /** Whether discovery used intent (path A) or user context (path B/C). Used by persist for triggeredBy. In-memory routing state only; never persisted. */
  discoverySource: Annotation<'intent' | 'context'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'intent',
  }),

  /** Resolved intent ID used for this discovery run (when discoverySource is 'intent'). Set by intent-resolution. */
  resolvedTriggerIntentId: Annotation<Id<'intents'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Asker's profile (from prep). Used for profile-as-source discovery and evaluation. */
  sourceProfile: Annotation<SourceProfileData | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  /** User context embeddings per network (from prep). Used for discovery. */
  sourceContexts: Annotation<Array<{ contextId: string; networkId: Id<'networks'>; text: string; embedding: number[] }>>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Resolved intent is in at least one target network (path A vs C). */
  resolvedIntentInNetwork: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  /** HyDE embeddings per lens label (from discovery) */
  hydeEmbeddings: Annotation<Record<string, number[]>>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({}),
  }),

  /** Candidate matches from semantic search (from discovery) */
  candidates: Annotation<CandidateMatch[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Discovery session ID for pagination (maps to Redis cache key). */
  discoveryId: Annotation<string | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  /** Evaluated candidates with scores (from evaluation; legacy) */
  evaluatedCandidates: Annotation<EvaluatedCandidate[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Evaluated opportunities with actors (from entity-bundle evaluator) */
  evaluatedOpportunities: Annotation<EvaluatedOpportunity[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  // ─── Output Fields (Overwrite per turn) ───

  /** The pairs that became an opportunity and a negotiation this run. */
  opened: Annotation<OpenedNegotiation[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  /** Discovery path: pairs skipped because an opportunity already exists between viewer and candidate (no duplicate created). */
  existingBetweenActors: Annotation<Array<{
    candidateUserId: Id<'users'>;
    networkId: Id<'networks'>;
    existingOpportunityId?: Id<'opportunities'>;
    existingStatus?: OpportunityStatus;
    reason?: 'same_intent_pair_duplicate' | 'final_atomic_conflict';
    existingTriggerIntentId?: string;
  }>>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Typed persist-node counts used by queue telemetry. */
  persistenceOutcome: Annotation<OpportunityPersistenceOutcome | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Error message if any step fails */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /** Output for read mode: enriched list of opportunities. */
  readResult: Annotation<{
    count: number;
    message?: string;
    opportunities: Array<{
      id: string;
      networkName: string;
      connectedWith: string[];
      suggestedBy: string | null;
      reasoning: string;
      status: string;
      category: string;
      confidence: number | null;
      source: string | null;
    }>;
  } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /** Output for update/delete/send modes. */
  mutationResult: Annotation<{
    success: boolean;
    message?: string;
    opportunityId?: string;
    notified?: string[];
    conversationId?: string;
    error?: string;
  } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  // ─── Trace Output ───

  /**
   * Accumulated trace entries from each graph node.
   * Used for observability: surfaces internal processing steps (search query, HyDE strategies,
   * candidates found, evaluation results) to the frontend.
   */
  trace: Annotation<Array<{ node: string; detail?: string; data?: Record<string, unknown> }>>({
    reducer: (curr, next) => [...curr, ...(next || [])],
    default: () => [],
  }),

  /** Timing records for each agent invocation within this graph run. */
  agentTimings: Annotation<DebugMetaAgent[]>({
    reducer: (acc, val) => [...acc, ...val],
    default: () => [],
  }),

});
