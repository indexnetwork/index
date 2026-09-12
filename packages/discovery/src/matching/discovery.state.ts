import type { ArtifactInput, HydeState } from '../artifacts/artifact.state.js';
import type { AgentTiming, CandidateSearch, DiscoveryData, MatchEvidence } from '../core/types.js';

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

/** A person (profile + optional intents) as discovery/introduction hands it to the explainer. */
export interface EvaluatorEntity {
  userId: string;
  profile: {
    name?: string;
    bio?: string;
    location?: string;
    interests?: string[];
    skills?: string[];
    context?: string;
  };
  intents?: Array<{
    intentId: string;
    payload: string;
    summary?: string;
  }>;
  networkId: string;
  evidenceKey?: string;
  ragScore?: number;
  matchedVia?: string;
  evidence?: MatchEvidence[];
}

export interface MatchExplainerInput {
  /** The user who triggered discovery. */
  discovererId: string;
  /** Exactly two entities: [source, candidate]. */
  entities: EvaluatorEntity[];
  existingOpportunities?: string;
  /** Optional discovery query (e.g. from chat), for framing relevance. */
  discoveryQuery?: string;
  /** Pre-rendered network context markdown, keyed by networkId. */
  networkContexts?: Record<string, string>;
}

export interface MatchExplainerResult {
  reasoning: string;
  /** Set when the claim-safety guard dropped the model's reasoning as unsupported. */
  droppedUnsupportedClaim?: boolean;
}

/** Optional test double for the explainer model (avoids live LLM calls in unit tests). */
export type MatchExplainerLike = {
  explain: (input: MatchExplainerInput, options?: { signal?: AbortSignal }) => Promise<MatchExplainerResult>;
};

/** Trace entries accumulate in the order the frontend renders them. */
export type TraceEntry = { node: string; detail?: string; data?: Record<string, unknown> };
