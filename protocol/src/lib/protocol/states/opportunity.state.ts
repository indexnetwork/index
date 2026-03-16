import { Annotation } from "@langchain/langgraph";
import type { Id } from '../../../types/common.types';
import type { OpportunityStatus, Opportunity } from '../interfaces/database.interface';
import type { Lens } from '../interfaces/embedder.interface';
import type { EvaluatorEntity } from '../agents/opportunity.evaluator';
import type { DebugMetaAgent } from '../../../types/chat-streaming.types';

/**
 * Opportunity Graph State (Linear Multi-Step Workflow)
 * 
 * Flow: Prep → Scope → Discovery → Evaluation → Ranking → Persist → END
 * 
 * Following the intent graph pattern with Annotation-based state management.
 */

/** Asker's profile shape (embedding + optional identity/narrative/attributes). Used by sourceProfile annotation. */
export interface SourceProfileData {
  embedding: number[] | null;
  identity?: { name?: string; bio?: string };
  narrative?: { context?: string };
  attributes?: { skills?: string[]; interests?: string[] };
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
  indexes: Id<'indexes'>[];
}

/**
 * Target index for search (from scope node)
 */
export interface TargetIndex {
  indexId: Id<'indexes'>;
  title: string;
  memberCount: number;
}

/**
 * Candidate match from discovery (semantic search).
 * candidateIntentId is set for intent matches; omitted for profile-only matches.
 */
export interface CandidateMatch {
  candidateUserId: Id<'users'>;
  candidateIntentId?: Id<'intents'>;
  indexId: Id<'indexes'>;
  similarity: number;
  /** Free-text lens label that produced this match. */
  lens: string;
  candidatePayload: string;
  candidateSummary?: string;
  /** How this candidate was found: 'query' (HyDE from search text) or 'profile-similarity'. */
  discoverySource?: 'query' | 'profile-similarity';
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
  indexId: Id<'indexes'>;
  score: number; // 0-100
  reasoning: string; // Third-party analytical explanation of the match (for LLM agents)
  valencyRole: 'Agent' | 'Patient' | 'Peer';
  /** Free-text lens label that produced this match. */
  lens: string;
}

/**
 * Actor in an evaluated opportunity (from entity-bundle evaluator).
 * indexId is filled from the entity bundle in the graph, not by the evaluator.
 */
export interface EvaluatedOpportunityActor {
  userId: Id<'users'>;
  role: 'agent' | 'patient' | 'peer';
  intentId?: Id<'intents'>;
  indexId: Id<'indexes'>;
}

/**
 * Evaluated opportunity with multi-actor output (entity-bundle evaluator).
 */
export interface EvaluatedOpportunity {
  actors: EvaluatedOpportunityActor[];
  score: number;
  reasoning: string;
}

/**
 * Options passed to the graph
 */
export interface OpportunityGraphOptions {
  /** Initial status for created opportunities (default: 'pending') */
  initialStatus?: OpportunityStatus;
  /** Minimum score threshold (default: 50) */
  minScore?: number;
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
  
  indexId: Annotation<Id<'indexes'> | undefined>({
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

  /** Optional: discover on behalf of this user (introducer flow). When set, prep/eval use this user's profile/intents; userId becomes the introducer. */
  onBehalfOfUserId: Annotation<Id<'users'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  options: Annotation<OpportunityGraphOptions>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({}),
  }),

  /**
   * Operation mode controls graph flow:
   * - 'create': Existing discover pipeline (Prep → Scope → Discovery → Evaluation → Ranking → Persist)
   * - 'create_introduction': Introduction path (validation → evaluation → persist) for chat-driven intros
   * - 'continue_discovery': Pagination path (Prep → Evaluation → Ranking → Persist) using pre-loaded candidates
   * - 'read': List opportunities filtered by userId and optionally indexId (fast path)
   * - 'update': Change opportunity status (accept, reject, etc.)
   * - 'delete': Expire/archive an opportunity
   * - 'send': Promote latent opportunity to pending + queue notification
   *
   * Defaults to 'create' for backward compatibility.
   */
  operationMode: Annotation<'create' | 'create_introduction' | 'continue_discovery' | 'read' | 'update' | 'delete' | 'send'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'create' as const,
  }),

  /** Introduction mode: pre-gathered entities (profiles + intents per party). */
  introductionEntities: Annotation<EvaluatorEntity[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Introduction mode: optional hint from the introducer. */
  introductionHint: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** When set (e.g. chat scope), indexId must match this. */
  requiredIndexId: Annotation<Id<'indexes'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Set by intro_evaluation; used by persist to build manual detection and introducer actor. */
  introductionContext: Annotation<{ createdByName?: string } | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Target opportunity ID for update/delete/send modes. */
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
  
  /** User's index memberships (from prep) */
  userIndexes: Annotation<Id<'indexes'>[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  
  /** Target indexes to search within (from scope) */
  targetIndexes: Annotation<TargetIndex[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Per-index relevancy scores for dedup tie-breaking. Background path: from intent_indexes. Chat path: transient from IntentIndexer. */
  indexRelevancyScores: Annotation<Record<string, number>>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({}),
  }),

  /** Whether discovery used intent (path A) or profile (path B/C). Used by persist for triggeredBy. */
  discoverySource: Annotation<'intent' | 'profile'>({
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

  /** Resolved intent is in at least one target index (path A vs C). */
  resolvedIntentInIndex: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  /** Create-intent signal: when true, tool should return createIntentSuggested so agent can auto-call create_intent. */
  createIntentSuggested: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  /** Suggested description for create_intent when createIntentSuggested is true. */
  suggestedIntentDescription: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
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

  /** Candidates not yet evaluated (for pagination -- cached in Redis by caller). */
  remainingCandidates: Annotation<CandidateMatch[]>({
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
  
  /** Final ranked and persisted opportunities */
  opportunities: Annotation<Opportunity[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  /** Discovery path: pairs skipped because an opportunity already exists between viewer and candidate (no duplicate created). */
  existingBetweenActors: Annotation<Array<{
    candidateUserId: Id<'users'>;
    indexId: Id<'indexes'>;
    existingOpportunityId?: Id<'opportunities'>;
    existingStatus?: OpportunityStatus;
  }>>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
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
      indexName: string;
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
