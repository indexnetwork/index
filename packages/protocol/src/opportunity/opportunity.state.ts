import { Annotation } from "@langchain/langgraph";
import type { Id } from '../shared/interfaces/database.interface.js';
import type { OpportunityStatus, Opportunity } from '../shared/interfaces/database.interface.js';
import type { Lens } from '../shared/interfaces/embedder.interface.js';
import type { EvaluatorEntity } from './opportunity.evaluator.js';
import type { DebugMetaAgent } from '../chat/chat-streaming.types.js';
import type { DiscoveryNegotiation, DiscoverySummary } from "./question.prompt.js";

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
  identity?: { name?: string; bio?: string; location?: string };
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
 * candidateIntentId is set for intent matches; omitted for profile-only matches.
 */
export interface CandidateMatch {
  candidateUserId: Id<'users'>;
  candidateIntentId?: Id<'intents'>;
  networkId: Id<'networks'>;
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
}

/**
 * Which flow triggered this graph invocation. Determines initial persist status,
 * park-window timeout, streaming behavior, and whether AbortSignal is honored.
 *
 * - 'ambient' (default): queue-driven. Persists at the trigger default of
 *   `pending` unless `options.initialStatus` overrides (the queue worker
 *   passes `'latent'`, chat-bound ambient discovery passes `'draft'`). 5-min
 *   park window, no streaming, ignores abort.
 * - 'orchestrator': chat-driven. Persists at the trigger default of
 *   `negotiating` unless `options.initialStatus` overrides. 60s park window,
 *   streams `opportunity_draft_ready` events, honors abort.
 *
 * See {@link resolveInitialStatus} for the exact fallback used when
 * `options.initialStatus` is undefined.
 */
export type OpportunityTrigger = 'ambient' | 'orchestrator';

/**
 * Resolves the initial status for opportunities created in the persist node.
 *
 * Explicit `options.initialStatus` always wins (callers like the chat tool or
 * maintenance scripts override per-call). When the caller leaves it
 * undefined, the trigger drives the default:
 * - 'orchestrator' → 'negotiating' (chat-driven; negotiations run before the
 *   user sees a draft card).
 * - 'ambient' (or any other trigger) → 'pending' (long-standing default for
 *   queue- and intent-driven discovery).
 *
 * Lives here rather than in opportunity.graph.ts so unit tests can exercise
 * it without pulling in the full graph (and the evaluator's LLM requirements).
 *
 * @param trigger - The graph invocation's trigger
 * @param explicit - Caller-supplied initial status from options.initialStatus
 */
export function resolveInitialStatus(
  trigger: OpportunityTrigger,
  explicit: OpportunityStatus | undefined,
): OpportunityStatus {
  if (explicit !== undefined) return explicit;
  return trigger === 'orchestrator' ? 'negotiating' : 'pending';
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
  /**
   * MCP-only: cap the negotiate-phase wall-clock at this many milliseconds.
   * When set, `negotiateNode` races `negotiateCandidates(...)` against a timer;
   * if the timer wins, the node returns early with a `timed_out` trace and the
   * unawaited negotiation chains finalize each opp's DB status in the
   * background. Set to 20_000 by the MCP `discover_opportunities` handler.
   * Chat, ambient queue, and all other callers omit this — existing behavior.
   */
  negotiateTimeoutMs?: number;
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
   * Which flow triggered this graph invocation. See {@link OpportunityTrigger}
   * for the exact branch behavior and {@link resolveInitialStatus} for the
   * persist default when `options.initialStatus` is unset.
   *
   * - 'ambient' (default): queue-driven, persist default `pending`, 5-min
   *   park window, no streaming, ignores abort.
   * - 'orchestrator': chat-driven, persist default `negotiating`, 60s park
   *   window, streams `opportunity_draft_ready` events, honors abort.
   */
  trigger: Annotation<OpportunityTrigger>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'ambient',
  }),

  /**
   * Accepted opportunities the persist node discovered between the discoverer
   * and a candidate actor (same pair, status='accepted'). The orchestrator
   * branch populates this so the discover_opportunities tool (Task 7) can tell
   * the LLM "these pairs are already connected, surface the existing chat
   * rather than creating a new draft". Always empty for the ambient trigger.
   *
   * Left intentionally minimal — conversationId/URL resolution happens at
   * Start Chat time (Task 8), not here.
   */
  dedupAlreadyAccepted: Annotation<Array<{
    opportunityId: string;
    counterpartyUserId: string;
  }>>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /**
   * Operation mode controls graph flow:
   * - 'create': Existing discover pipeline (Prep → Scope → Discovery → Evaluation → Ranking → Persist)
   * - 'create_introduction': Introduction path (validation → evaluation → persist) for chat-driven intros
   * - 'continue_discovery': Pagination path (Prep → Evaluation → Ranking → Persist) using pre-loaded candidates
   * - 'read': List opportunities filtered by userId and optionally networkId (fast path)
   * - 'update': Change opportunity status (accept, reject, etc.)
   * - 'delete': Expire/archive an opportunity
   * - 'send': Promote latent opportunity to pending + queue notification
   * - 'negotiate_existing': Load an existing opportunity by opportunityId and run bilateral negotiation.
   *   Used after introducer approval to trigger the normal negotiation flow.
   * - 'approve_introduction': Mark the caller as having approved a latent introducer opportunity,
   *   then enqueue a negotiate_existing job for that opportunity.
   *
   * Defaults to 'create' for backward compatibility.
   */
  operationMode: Annotation<'create' | 'create_introduction' | 'continue_discovery' | 'read' | 'update' | 'delete' | 'send' | 'negotiate_existing' | 'approve_introduction'>({
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

  /** When set (e.g. chat scope), networkId must match this. */
  requiredNetworkId: Annotation<Id<'networks'> | undefined>({
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
  
  /** User's network memberships (from prep) */
  userNetworks: Annotation<Id<'networks'>[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  
  /** Target indexes to search within (from scope) */
  targetNetworks: Annotation<TargetNetwork[]>({
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
    networkId: Id<'networks'>;
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

  /**
   * Per-candidate negotiation records captured by `negotiateNode`. Populated
   * regardless of accept/reject so the question generator sees a complete
   * picture. Populated for ALL triggers (ambient + orchestrator) since the
   * negotiate node's `onCandidateResolved` hook is unconditional; only the
   * orchestrator streaming side-effects (opportunity_draft_ready emission)
   * are trigger-gated. Empty when the negotiate node was skipped (no
   * opportunities to negotiate).
   */
  discoveryNegotiations: Annotation<DiscoveryNegotiation[]>({
    reducer: (curr, next) => [...curr, ...(next || [])],
    default: () => [],
  }),

  /** Aggregate counters across `discoveryNegotiations`. Built in the negotiate node. */
  discoverySummary: Annotation<DiscoverySummary | null>({
    reducer: (_curr, next) => next ?? null,
    default: () => null,
  }),
});
