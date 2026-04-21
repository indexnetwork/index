/**
 * Shared type definitions for the Index CLI.
 *
 * All interface/type definitions used across the CLI live here.
 * Keeps api.client.ts focused on HTTP methods and output modules
 * focused on rendering.
 */

// ── Chat types ──────────────────────────────────────────────────────

/** A chat session as returned by the API. */
export interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt?: string;
}

/** User profile from GET /api/auth/me. */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
}

/** Parameters for POST /api/chat/stream. */
export interface StreamChatParams {
  message: string;
  sessionId?: string;
}

// ── User types ──────────────────────────────────────────────────────

/** Full user data from GET /api/users/:userId. */
export interface UserData {
  id: string;
  key?: string | null;
  name: string | null;
  intro: string | null;
  avatar: string | null;
  location: string | null;
  socials: Record<string, string> | null;
  isGhost: boolean;
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
    page: number;
    limit: number;
    total: number;
    totalPages: number;
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

/** An opportunity object as returned by the API. */
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

// ── Network types ───────────────────────────────────────────────────

/** A network (index) as returned by the API. */
export interface Network {
  id: string;
  key?: string | null;
  title: string;
  prompt?: string | null;
  joinPolicy?: string;
  isPersonal?: boolean;
  memberCount?: number;
  createdAt?: string;
  owner?: { id: string; name: string; email: string };
  /** Role of the current user (from list endpoint). */
  role?: string;
}

/** A member of a network. */
export interface NetworkMember {
  userId: string;
  user: { id?: string; name: string; email: string; image?: string | null };
  permissions: string[];
  createdAt?: string;
}

/** A user returned from the search endpoint. */
export interface SearchedUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

/** Result of adding a member to a network. */
export interface AddMemberResult {
  member: { userId: string };
  message: string;
}

// ── Conversation types ──────────────────────────────────────────────

/** A participant in a conversation. */
export interface ConversationParticipant {
  participantId: string;
  participantType: "user" | "agent";
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
  type: string;
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

// ── Tool types ───────────────────────────────────────────────────────

/** Generic result from POST /api/tools/:toolName. */
export interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  [key: string]: unknown;
}
