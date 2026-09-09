/**
 * Shared type definitions for the Index CLI.
 *
 * All interface/type definitions used across the CLI live here.
 * Keeps api.client.ts focused on HTTP methods and output modules
 * focused on rendering.
 */

/** User profile from GET /api/auth/me. */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
}

// ── User types ──────────────────────────────────────────────────────

/** A social link on a user profile. */
export interface SocialLink {
  label: string;
  value: string;
}

/** Full user data from GET /api/users/:userId. */
export interface UserData {
  id: string;
  key?: string | null;
  name: string | null;
  intro: string | null;
  avatar: string | null;
  location: string | null;
  socials: SocialLink[] | null;
  createdAt: string;
  updatedAt: string | null;
}

// ── Intent types ────────────────────────────────────────────────────

/** An intent as returned by the API. */
export interface Intent {
  id: string;
  payload: string;
  summary: string | null;
  status: string;
  sourceType: string | null;
  confidence?: number;
  inferenceType?: string;
  intentMode?: string;
  speechActType?: string;
  semanticEntropy?: number;
  isIncognito?: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  networks?: Array<{ id: string; title: string; relevancyScore?: number }>;
}

/** Options for listing intents. */
export interface ListIntentsOptions {
  page?: number;
  limit?: number;
  archived?: boolean;
  sourceType?: string;
}

/** Result from POST /api/intents/list. */
export interface IntentListResult {
  intents: Intent[];
  pagination: {
    /** Current page number (1-based). */
    current: number;
    /** Total number of pages. */
    total: number;
    /** Number of intents on the current page. */
    count: number;
    /** Total number of intents across all pages. */
    totalCount: number;
  };
}

// ── Opportunity types ───────────────────────────────────────────────

/** Options for listing opportunities. */
export interface OpportunityListOptions {
  status?: string;
  limit?: number;
}

/** An actor (party) in an opportunity. */
export interface OpportunityActor {
  userId: string;
  name?: string;
  role?: "agent" | "patient" | "peer";
  networkId?: string;
  intent?: string;
}

/** Interpretation (evaluation) of an opportunity. */
export interface OpportunityInterpretation {
  category?: string;
  reasoning?: string;
  confidence?: number;
  signals?: Array<{ type: string; weight: number; detail: string }>;
}

/** Detection provenance for an opportunity. */
export interface OpportunityDetection {
  source?: string;
  triggeredBy?: string;
  createdBy?: string;
  createdByName?: string;
  timestamp?: string;
}

/** An opportunity object as returned by the list API (GET /api/opportunities). */
export interface Opportunity {
  id: string;
  status: string;
  actors?: OpportunityActor[];
  interpretation?: OpportunityInterpretation;
  detection?: OpportunityDetection;
  presentation?: string;
  counterpartName?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** A party in the presented opportunity detail. */
export interface OpportunityParty {
  id: string;
  name?: string | null;
  avatar?: string | null;
  role?: string;
}

/**
 * Presented opportunity from the detail API (GET /api/opportunities/:id).
 * Distinct from {@link Opportunity}: the detail endpoint returns a viewer-scoped,
 * presentation-oriented shape rather than the raw actor/interpretation row.
 */
export interface OpportunityDetail {
  id: string;
  status: string;
  presentation?: { title?: string; description?: string; callToAction?: string };
  myRole?: string;
  otherParties?: OpportunityParty[];
  category?: string;
  confidence?: number;
  network?: { id: string; title: string };
  primaryActionLabel?: string;
  createdAt?: string;
  /** Present when the requested opportunity was superseded by this enriched opportunity. */
  resolvedFromOpportunityId?: string;
}

// ── Network types ───────────────────────────────────────────────────

/** A network as returned by the API. */
export interface Network {
  id: string;
  key?: string | null;
  title: string;
  prompt?: string | null;
  joinPolicy?: string;
  memberCount?: number;
  createdAt?: string;
  owner?: { id: string; name: string; email: string };
  /** Role of the current user (from list endpoint). */
  role?: string;
}

/** A member of a network (from GET /api/networks/:id/members). */
export interface NetworkMember {
  id?: string;
  userId?: string;
  name: string;
  email: string;
  image?: string | null;
  permissions: string[];
  createdAt?: string;
  /** Legacy nested shape — kept for backward compatibility. */
  user?: { id?: string; name: string; email: string; image?: string | null };
}

export interface NetworkRequest {
  id: string;
  title: string;
  status: string;
  purpose?: string;
  audience?: string;
  expectedSize?: string;
  notes?: string;
  reviewNote?: string;
  submittedAt: string;
}

export type NetworkCreateResult =
  | { kind: "created"; network: Network }
  | { kind: "requested"; request: NetworkRequest };

export interface NetworkInvitationResult {
  user: { id: string; email: string };
  created: boolean;
  alreadyMember: boolean;
}

// ── Conversation types ──────────────────────────────────────────────

/** A participant in a conversation. */
export interface ConversationParticipant {
  participantId: string;
  participantType: "user" | "agent";
  /** Display name, present on the list/detail endpoints. */
  name?: string | null;
  avatar?: string | null;
  /** Legacy nested shape — kept for backward compatibility. */
  user?: { name: string; email?: string };
}

/** A conversation as returned by the API. */
export interface Conversation {
  id: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  participants: ConversationParticipant[];
}

/** A message part (A2A-compatible). */
export interface MessagePart {
  kind: string;
  text?: string;
  [key: string]: unknown;
}

/** A message in a conversation. */
export interface ConversationMessage {
  id: string;
  role: string;
  senderId?: string;
  parts: MessagePart[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// ── Negotiation types ────────────────────────────────────────────────

export type NegotiationTurnAction = 'propose' | 'counter' | 'accept' | 'decline';
export type NegotiationOutcome = 'agreed' | 'declined' | 'closed';

export interface NegotiationTurn {
  turnIndex: number;
  seatUserId: string;
  action: NegotiationTurnAction;
  message: string;
  createdAt: string;
}

/** One negotiation as the authenticated seat sees it. */
export interface Negotiation {
  id: string;
  opportunityId: string;
  /** The viewer's own signal behind this negotiation. */
  intentId: string;
  /** The seat whose turn it is; null once settled. */
  awaitingUserId: string | null;
  outcome: NegotiationOutcome | null;
  settledAt: string | null;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  counterparty: {
    userId: string;
    intentId: string;
    name: string | null;
    avatar: string | null;
    statement: string;
  };
}

export interface NegotiationDetail extends Negotiation {
  turns: NegotiationTurn[];
  protocol: {
    availableActions: NegotiationTurnAction[];
    blockedReason: string | null;
    maxTurns: number;
    messageLimit: number;
  };
}

export interface NegotiationListOptions {
  intentId?: string;
  state?: "open" | "settled";
}

// ── Profile enrichment types ─────────────────────────────────────────

export interface EnrichedProfile {
  name: string | null;
  intro: string | null;
  location: string | null;
  avatar: string | null;
  socials: Array<{ label: string; value: string }>;
}

export interface EnrichmentResult {
  enriched: true;
  profile: EnrichedProfile;
}

// ── Tool types ───────────────────────────────────────────────────────

/** Generic result from POST /api/tools/:toolName. */
export interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  [key: string]: unknown;
}
