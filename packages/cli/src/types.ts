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
  /** Case-insensitive text match over the signal's description and summary. */
  query?: string;
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

/** One question the preparer asks before a draft can be created. */
export interface IntentRecoveryField {
  id: string;
  /** The prompt; `--answer '<label>=<reply>'` answers it. */
  label: string;
  kind: "single" | "multi" | "text";
  options?: { label: string; description: string }[];
  placeholder?: string;
}

/** Result from POST /api/intents/prepare. */
export type IntentPreparation =
  | { status: "ready"; payload: string; preparationReceipt: string }
  | { status: "needs_revision"; payload: string; feedback: string; recovery: IntentRecoveryField[] };

// ── Opportunity types ───────────────────────────────────────────────

/** Options for listing opportunities. */
export interface OpportunityListOptions {
  status?: string;
  statuses?: string;
  intentId?: string;
  limit?: number;
}

/** An opportunity object as returned by the list API (GET /api/opportunities). */
export interface Opportunity {
  opportunityId: string;
  status: string;
  peer: { userId: string; name: string; avatar: string | null };
  headline?: string;
  mainText: string;
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
export interface OpportunityDetail extends Opportunity {
  id: string;
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

/** A question the personal agent put to its owner and is still waiting on. */
export interface AgentQuestion {
  id: string;
  question: string;
  options?: string[];
  scope: "intent" | "match";
  matches: { opportunityId: string; counterparty: { id: string; name: string | null } }[];
}

/** Result from GET /api/conversations/agent/messages?intentId=. */
export interface AgentConversation {
  conversationId: string;
  messages: ConversationMessage[];
  agent: {
    /** Who answers on this intent: Index's hosted agent or the owner's external negotiator. */
    status: "hosted" | "external";
    /** Unanswered questions, oldest first. */
    questions: AgentQuestion[];
  };
}

/**
 * An owner answer as persisted by POST /api/conversations/agent/answers.
 * An answer naming a question that is no longer waiting is kept as a plain
 * `user` message instead of an `answer`.
 */
export interface AgentAnswerMessage extends ConversationMessage {
  metadata: {
    intentId: string;
    principalMessage: { kind: "answer" | "user"; questionId?: string };
  };
}

// ── Agent types ─────────────────────────────────────────────────────

/** Result from GET /api/agents/me: the external agent selected to negotiate. */
export interface SelectedAgent {
  agent: {
    id: string;
    ownerId: string;
    name: string;
    description: string | null;
    type: "external" | "system";
    status: "active" | "inactive";
    handleNegotiations: boolean;
    lastSeenAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  onboardingCompletedAt: string | null;
  negotiationExecutorFence: true;
}

// ── Onboarding types ────────────────────────────────────────────────

/** Result from POST /api/auth/onboarding/confirm-profile. */
export interface ProfileConfirmation {
  success: true;
  profileConfirmedAt: string;
}

/** Result from POST /api/auth/onboarding/complete. */
export interface OnboardingCompletion {
  success: true;
  message: string;
  completedAt: string;
  intentId: string;
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