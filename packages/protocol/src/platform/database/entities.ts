/**
 * Entity records and value types the database port speaks in.
 *
 * Split out of `database.interface.ts`, which had grown to hold the entities,
 * the port, the two access-scoped views, and every capability-narrowed alias in
 * one file. Import from `database.interface.js` — it re-exports all of them.
 */

import type { ScopeMembership } from '../../protocol/core.js';
import type { OpportunityEvidence } from '../../protocol/schemas/network-assignment.schema.js';

// ─── Inlined types (previously imported from outside the protocol lib) ───────

/** Branded string ID for type-safe entity references (keyed by Drizzle table name). */
export type Id<T extends string = string> = string & { readonly __table?: T };

// ─── Discovery match candidates ──────────────────────────────────────────────

export type DiscoveryMatchCandidateStatus = 'pending' | 'opened' | 'superseded' | 'expired';

/**
 * A pair discovery found, before anyone reached out.
 *
 * Discovery does not create opportunities; it records the pair, keyed by
 * `pairKey`. The uniqueness of that key IS the dedup — both principals'
 * discovery runs converge on one row instead of racing to persist two
 * opportunities between the same two people.
 */
export interface CreateDiscoveryMatchCandidateData {
  pairKey: string;
  networkId: Id<'networks'>;
  intentA: Id<'intents'>;
  intentB: Id<'intents'>;
  userA: Id<'users'>;
  userB: Id<'users'>;
  score: number;
  reasoning: string;
  evidence: OpportunityEvidence[];
}

export interface DiscoveryMatchCandidate extends CreateDiscoveryMatchCandidateData {
  id: string;
  status: DiscoveryMatchCandidateStatus;
  createdAt: Date;
  /** Set once this candidate became a row. */
  openedOpportunityId?: Id<'opportunities'> | null;
}

/**
 * A candidate that just became an opportunity with a negotiation beside it.
 * The initiator is the side whose discovery run recorded the pair, and it owes
 * the first turn.
 */
export interface OpenedNegotiation {
  opportunityId: Id<'opportunities'>;
  negotiationId: string;
  initiatorUserId: Id<'users'>;
  initiatorIntentId: Id<'intents'>;
}

export interface NetworkAssignmentContext {
  networkId: string;
  indexPrompt: string | null;
  memberPrompt: string | null;
}

export interface AssignmentNetworkMembership extends ScopeMembership {
  networkId: string;
}

/** Final-authority result for an existing intent-to-network assignment. */
export type IntentNetworkFinalAssignmentResult =
  | { kind: 'assigned' }
  | { kind: 'already_assigned' }
  | { kind: 'membership_required' }
  | { kind: 'intent_not_owned_or_not_found' };

/** Onboarding flow state stored as JSON on the user record. */
export interface OnboardingState {
  completedAt?: string;
  profileConfirmedAt?: string;
  firstSignalIntentId?: string;
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'summary' | 'connections' | 'create_network' | 'invite_members' | 'join_networks' | 'first_signal' | 'complete';
  networkId?: string;
  invitationCode?: string;
}

/** Single social-link row from the user_socials table. */
export interface UserSocial {
  id: string;
  userId: string;
  label: string;
  value: string;
}

/** Detection metadata recorded when an opportunity is created. */
export interface OpportunityDetection {
  source: 'opportunity_graph' | 'chat' | 'cron' | 'member_added';
  createdBy?: Id<'users'> | string;
  createdByName?: string;
  triggeredBy?: Id<'intents'>;
  timestamp: string;
  enrichedFrom?: string[];
}

/** A participant (user + network) involved in an opportunity. */
export interface OpportunityActor {
  networkId: Id<'networks'>;
  userId: Id<'users'>;
  intent?: Id<'intents'>;
  role: string;
  /**
   * ISO-8601 timestamp set the first time this actor advanced the opportunity's
   * state (patient sending, agent accepting, peer "accepting" on draft = sending
   * under the hood, peer accepting on pending). Once set,
   * this actor has committed and cannot be the one to subsequently `accept` the
   * same opportunity — enforced by the self-accept guard in `updateNode`.
   */
  actedAt?: string;
}

/** Individual signal contributing to an opportunity score. */
export interface OpportunitySignal {
  type: string;
  weight: number;
  detail?: string;
}

/** LLM-generated interpretation of an opportunity's category and confidence. */
export interface OpportunityInterpretation {
  category: string;
  reasoning: string;
  confidence: number;
  signals?: OpportunitySignal[];
}

/** Optional scoping context (network / conversation) for an opportunity. */
export interface OpportunityContext {
  networkId?: Id<'networks'>;
  conversationId?: Id<'conversations'>;
}

/** User record returned by getUser (minimal fields plus optional profile fields). */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  intro?: string | null;
  avatar?: string | null;
  location?: string | null;
  socials: UserSocial[];
  onboarding?: OnboardingState | null;
  deletedAt?: Date | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Minimal intent representation used for graph state population.
 * Contains only the fields needed for reconciliation logic.
 */
export interface ActiveIntent {
  /** Unique identifier of the intent */
  id: string;
  /** Full intent description/payload */
  payload: string;
  /** Short summary of the intent (may be null if not generated) */
  summary: string | null;
  /** When the intent was created */
  createdAt: Date;
  /** Relevancy score for this intent in its index context (0.0–1.0, null if not scored) */
  relevancyScore?: number | null;
}

/**
 * Input data for creating a new intent.
 * Supports the full intent pipeline including embedding and index association.
 */
export interface CreateIntentData {
  /** The user who owns this intent */
  userId: string;
  /** Full intent description/payload */
  payload: string;
  /** Pre-computed summary (optional, will be generated if not provided) */
  summary?: string | null;
  /** Pre-computed embedding vector (optional, will be generated if not provided) */
  embedding?: number[];
  /** Whether the intent should be hidden from public views */
  isIncognito?: boolean;
  /** Network IDs to associate with (optional, uses dynamic scoping if empty) */
  networkIds?: string[];
  /** Source type for provenance tracking */
  sourceType?: 'integration' | 'discovery_form' | 'enrichment';
  /** Source ID for provenance tracking */
  sourceId?: string;
  /** Confidence score from inference (0-1, required) */
  confidence: number;
  /** How the intent was inferred */
  inferenceType: 'explicit' | 'implicit';
  /** Semantic entropy from verifier (0 specific -> 1 vague) */
  semanticEntropy?: number | null;
  /** Referential anchor extracted by verifier (if any) */
  referentialAnchor?: string | null;
  /** Felicity authority score from verifier (0-100) */
  felicityAuthority?: number | null;
  /** Felicity sincerity score from verifier (0-100) */
  felicitySincerity?: number | null;
  /** Felicity clarity score from verifier (0-100) */
  felicityClarity?: number | null;
  /** Donnellan intent mode */
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
  /** Speech act category used by protocol enum */
  speechActType?: 'COMMISSIVE' | 'DIRECTIVE' | null;
}

/**
 * Input data for updating an existing intent.
 * All fields are optional - only provided fields will be updated.
 */
export interface UpdateIntentData {
  /** Updated intent description/payload */
  payload?: string;
  /** Updated summary */
  summary?: string | null;
  /** Updated embedding vector */
  embedding?: number[];
  /** Updated incognito status */
  isIncognito?: boolean;
  /** Updated index associations (replaces existing) */
  networkIds?: string[];
  /** Semantic entropy from verifier (0 specific -> 1 vague) */
  semanticEntropy?: number | null;
  /** Referential anchor extracted by verifier (if any) */
  referentialAnchor?: string | null;
  /** Felicity authority score from verifier (0-100) */
  felicityAuthority?: number | null;
  /** Felicity sincerity score from verifier (0-100) */
  felicitySincerity?: number | null;
  /** Felicity clarity score from verifier (0-100) */
  felicityClarity?: number | null;
  /** Donnellan intent mode */
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
  /** Speech act category used by protocol enum */
  speechActType?: 'COMMISSIVE' | 'DIRECTIVE' | null;
  /**
   * Optional compare-and-set guard for recovery-answer writes. Implementations
   * must compare this value with the material payload+summary fingerprint while
   * holding the final intent row lock. Omitted for ordinary intent updates.
   */
  expectedIntentFingerprint?: string;
  /** Expected owner paired with the recovery-answer fingerprint guard. */
  expectedIntentUserId?: string;
}

/**
 * The result of a successful intent creation.
 * Contains the core fields needed for immediate use.
 */
export interface CreatedIntent {
  /** Unique identifier of the created intent */
  id: string;
  /** Full intent description/payload */
  payload: string;
  /** Generated or provided summary */
  summary: string | null;
  /** Incognito status */
  isIncognito: boolean;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Owner user ID */
  userId: string;
}

/**
 * Full intent record with all fields (for detailed queries).
 */
export interface IntentRecord extends CreatedIntent {
  /** Archival timestamp (null if active) */
  archivedAt: Date | null;
  /** Embedding vector (may be null) */
  embedding?: number[] | null;
  /** Source type for provenance */
  sourceType?: string | null;
  /** Source ID for provenance */
  sourceId?: string | null;
  /** Lifecycle admission state; null is a legacy ACTIVE row. */
  status?: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED' | null;
}

/**
 * Intent with similarity score from vector search.
 */
export interface SimilarIntent extends IntentRecord {
  /** Cosine similarity score (0-1) */
  similarity: number;
}

/**
 * Result of an archive operation.
 */
export interface ArchiveResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/** An intent's admission lifecycle status; null/legacy rows are ACTIVE. */
export type IntentLifecycleStatus = 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED';

/**
 * Result of an atomic ACTIVE/PAUSED lifecycle transition.
 */
export type TransitionLifecycleResult =
  | { kind: 'success'; id: string; status: 'ACTIVE' | 'PAUSED'; changed: boolean; lifecycleVersionMs: number }
  | { kind: 'not_found' }
  | { kind: 'scope_violation' }
  | { kind: 'stale' }
  | { kind: 'conflict'; status: IntentLifecycleStatus | null; archived: boolean };

/**
 * A durable, owner-scoped intent proposal record — the verified analysis
 * produced before a user approves persistence. `analysis` is host-opaque:
 * the graph never inspects it, only compares/replaces it wholesale.
 */
export interface IntentProposalRecord {
  id: string;
  userId: string;
  description: string;
  networkId: string | null;
  status: 'pending' | 'consumed' | 'rejected';
  expiresAt: Date;
  consumedIntentId: string | null;
}

/** Replace a still-pending proposal's verified payload (owner-edited description). */
export interface ReviseIntentProposalInput {
  proposalId: string;
  userId: string;
  expectedDescription: string;
  expectedNetworkId: string | null;
  description: string;
  /** Host-validated verifier analysis; opaque to the graph. */
  analysis: unknown;
}

/**
 * Result of atomically confirming a proposal into a persisted intent.
 */
export type ConfirmProposalResult =
  | { kind: 'created'; intent: CreatedIntent }
  | { kind: 'replay'; intent: { id: string; archivedAt: Date | null } }
  | { kind: 'missing' }
  | { kind: 'expired' }
  | { kind: 'consumed' }
  | { kind: 'payload_mismatch' }
  | { kind: 'analysis_missing' }
  | { kind: 'membership_required' };

/**
 * Options for vector similarity search.
 */
export interface SimilarIntentSearchOptions {
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum similarity threshold (default: 0.7) */
  threshold?: number;
}

/**
 * Represents a user's membership in an index with full details.
 * Used for displaying network memberships in chat (index_query).
 */
export interface ActiveNetworkMembershipPair {
  userId: string;
  networkId: string;
}

export interface NetworkMembership {
  /** Unique identifier of the index */
  networkId: string;
  /** Display title of the index */
  networkTitle: string;
  /** Index description/prompt (what the community is about) */
  indexPrompt: string | null;
  /** Member's permissions in this network */
  permissions: string[];
  /** Member's custom prompt (overrides network prompt for their intents) */
  memberPrompt: string | null;
  /** Whether new intents are auto-assigned to this network */
  autoAssign: boolean;
  /** When the user joined the network */
  joinedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX OWNERSHIP TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Represents an index owned by the user with full details.
 */
export interface OwnedIndex {
  /** Network ID */
  id: string;
  /** Display title */
  title: string;
  /** Index purpose/scope prompt */
  prompt: string | null;
  /** Cover image URL */
  imageUrl: string | null;
  /** Permission settings */
  permissions: {
    joinPolicy: 'anyone' | 'invite_only';
    invitationLink: { code: string } | null;
  };
  /** When the index was created */
  createdAt: Date;
  /** When the index was last updated */
  updatedAt: Date;
  /** Member count */
  memberCount: number;
  /** Total intents indexed */
  intentCount: number;
  /** Owner summary */
  user: { id: string; name: string; avatar: string | null };
  /** Aggregate counts for frontend compatibility */
  _count: { members: number };
}

/**
 * Member details visible to network owners (and optionally to members with privacy rules).
 */
export interface IndexMemberDetails {
  /** User ID */
  userId: string;
  /** User's display name */
  name: string;
  /** User's avatar URL */
  avatar: string | null;
  /** User's email; only present when viewer is owner/admin or the member themselves (privacy-safe) */
  email?: string | null;
  /** Member's permissions in this network */
  permissions: string[];
  /** Member's custom prompt */
  memberPrompt: string | null;
  /** Whether auto-assign is enabled */
  autoAssign: boolean;
  /** When they joined */
  joinedAt: Date;
  /** Count of their intents in this network */
  intentCount: number;
  /** Whether this user is a ghost (not yet onboarded) */
}

/**
 * Intent details visible to network owners.
 */
export interface IndexedIntentDetails {
  /** Intent ID */
  id: string;
  /** Intent payload/description */
  payload: string;
  /** Intent summary */
  summary: string | null;
  /** Owner's user ID */
  userId: string;
  /** Owner's name */
  userName: string;
  /** When the intent was created */
  createdAt: Date;
  /** Relevancy score for this intent in its index context (0.0–1.0, null if not scored) */
  relevancyScore?: number | null;
}

/**
 * Options for updating index settings.
 */
export interface UpdateIndexSettingsData {
  /** New title (optional) */
  title?: string;
  /** New prompt (optional) */
  prompt?: string | null;
  /** New image URL (optional) */
  imageUrl?: string | null;
  /** New join policy (optional) */
  joinPolicy?: 'anyone' | 'invite_only';
}

// ═══════════════════════════════════════════════════════════════════════════════
// HYDE DOCUMENT TYPES (Opportunity Redesign)
// ═══════════════════════════════════════════════════════════════════════════════

export type HydeSourceType = 'intent' | 'query' | 'context';

export interface HydeDocument {
  id: string;
  sourceType: HydeSourceType;
  sourceId: string | null;
  sourceText: string | null;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface CreateHydeDocumentData {
  sourceType: HydeSourceType;
  sourceId?: string;
  sourceText?: string;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context?: Record<string, unknown>;
  expiresAt?: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPPORTUNITY TYPES (Opportunity Redesign)
// ═══════════════════════════════════════════════════════════════════════════════

export type OpportunityStatus = 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired';

/**
 * Minimal opportunity lifecycle evidence used to narrate an agent negotiation.
 * `acceptedByOwner` is true only when the authenticated owner is the persisted
 * human acceptor; other terminal states do not imply an owner action.
 */
export interface NegotiationOpportunityLifecycle {
  status: OpportunityStatus;
  acceptedByOwner: boolean;
}

export interface Opportunity {
  id: string;
  detection: OpportunityDetection;
  actors: OpportunityActor[];
  interpretation: OpportunityInterpretation;
  context: OpportunityContext;
  confidence: string;
  status: OpportunityStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface OpportunityNetworkEligibility {
  /** User whose active memberships define the discovery boundary. */
  ownerUserId: string;
  /** Request/intent-authorized networks after the latest graph-side recomputation. */
  allowedNetworkIds: string[];
  /** When present, each actor network must remain assigned to this intent through commit. */
  triggerIntentId?: string;
}

export type OpportunityDedupConflictReason = 'same_intent_pair_duplicate';

export interface OpportunityDedupConflict {
  reason: OpportunityDedupConflictReason;
  existingOpportunityId: string;
  existingTriggerIntentId?: string;
  existingStatus: OpportunityStatus;
  existingCreatedAt: Date;
}

export type IntentScopedOpportunityPersistenceResult =
  | { created: Opportunity; expired: Opportunity[] }
  | { conflict: OpportunityDedupConflict };

export interface CreateOpportunityData {
  detection: OpportunityDetection;
  actors: OpportunityActor[];
  interpretation: OpportunityInterpretation;
  context: OpportunityContext;
  confidence: string;
  status?: OpportunityStatus;
  expiresAt?: Date;
  metadata?: Record<string, unknown> | null;
}

export interface OpportunityQueryOptions {
  status?: OpportunityStatus;
  /** When set, filter to opportunities whose status is in this list. Orthogonal to `status` (single) — callers pick one. */
  statuses?: OpportunityStatus[];
  networkId?: string;
  /** Optional selected-intent scope. When `scopeType === 'intent'`, `scopeId` is the selected intent id. */
  scopeType?: 'intent';
  scopeId?: string;
  role?: string;
  /** When set, filter to opportunities this user is an actor on. Applied in the query so pagination counts only visible rows. */
  actorUserId?: string;
  limit?: number;
  offset?: number;
  /** When set, include draft opportunities for this chat session. When unset, exclude all draft opportunities (e.g. radar view, API). */
  conversationId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE INTERFACE
