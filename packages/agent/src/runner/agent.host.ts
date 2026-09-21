import type { PrincipalOperations } from "../agents/principal/principal.discovery.js";
import type { Intent, NegotiationAction, Profile } from "../agents/shared/agent.context.js";

/**
 * Principal-scoped access to authoritative host records, independent of transport.
 * Implementations return current data and enforce ownership and authorization on reads and writes.
 * Failed reads reject; they must not be replaced with empty records or lists.
 */
export interface AgentHost extends PrincipalOperations {
  /**
   * @returns The principal's current profile, including its confirmation status.
   * @throws If the profile cannot be read or access is denied.
   */
  getProfile(): Promise<Profile>;

  /**
   * @param intentId - The principal's intent to read.
   * @returns The current intent, including its authoritative lifecycle status.
   * @throws If the intent does not exist, cannot be read, or access is denied.
   */
  getIntent(intentId: string): Promise<Intent>;

  /**
   * @returns The principal's intents; active-intent selection belongs to the runner.
   * @throws If the intents cannot be listed or access is denied.
   */
  listIntents(): Promise<Intent[]>;

  /**
   * @param intentId - The intent whose principal conversation to read.
   * @returns Its conversation ID and messages, oldest first; messages may be empty.
   * @throws If the conversation cannot be read or access is denied.
   */
  getConversation(intentId: string): Promise<{ conversationId: string; messages: ConversationMessage[] }>;

  /**
   * @returns The principal's open negotiations, or an empty list when none exist.
   * @throws If the negotiations cannot be listed or access is denied.
   */
  listNegotiations(): Promise<Negotiation[]>;

  /**
   * @param opportunityId - The opportunity whose negotiation to read.
   * @returns The current negotiation, ordered turns, and authoritative protocol data.
   * @throws If the negotiation does not exist, cannot be read, or access is denied.
   */
  getNegotiation(opportunityId: string): Promise<NegotiationDetail>;

  /**
   * @param intentId - The intent whose principal conversation receives the entries.
   * @param messages - Structured entries with IDs and publication timestamps assigned by the runner.
   * @returns Resolves after persistence succeeds, never after an in-memory fallback.
   * @throws If persistence fails or access is denied.
   */
  appendMessages(intentId: string, messages: PrincipalMessage[]): Promise<void>;

  /**
   * @param opportunityId - The opportunity whose negotiation receives the turn.
   * @param turn - The proposed turn and the authoritative turn count used for reasoning.
   * @returns The host's post-submission negotiation record.
   * @throws If access is denied, the turn violates the protocol, the expected count is stale, or persistence fails.
   */
  submitTurn(opportunityId: string, turn: {
    action: NegotiationAction;
    message: string;
    expectedTurnCount: number;
  }): Promise<NegotiationDetail>;
}

/** Raw persisted message; the runner reconstructs domain entries from parts and metadata. */
export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  senderAvatar?: string;
  role: "user" | "agent";
  parts: unknown;
  createdAt: string;
  /** Carries the intent ID and structured entry in `principalMessage`. */
  metadata?: unknown;
}

/** `match` is the persisted wire scope for an opportunity. */
export type QuestionScope = "intent" | "match";

export interface MatchReference {
  opportunityId: string;
  counterparty: { id: string; name: string | null };
}

/** Structured conversation entry using the existing persistence format. */
export interface PrincipalMessage {
  id: string;
  createdAt: string;
  questionId?: string;
  /**
   * `expire` retires a question without treating it as answered. `brief`,
   * `decision`, `stall` and `progress` are the agent's own bookkeeping: they are
   * persisted so a surface can show them, but they are never addressed to the
   * principal and never read as a reply to them.
   */
  kind: "question" | "answer" | "user" | "message" | "expire" | "brief" | "decision" | "stall" | "progress";
  matches: readonly MatchReference[];
  text: string;
  scope?: QuestionScope;
  options?: string[];
}

export type NegotiationOutcome = "agreed" | "declined" | "closed";

export interface Negotiation {
  id: string;
  opportunityId: string;
  intentId: string;
  awaitingUserId: string | null;
  outcome: NegotiationOutcome | null;
  settledAt: string | null;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  counterparty: {
    intentId: string;
    userId: string;
    name: string | null;
    avatar: string | null;
    statement: string;
  };
}

export interface NegotiationDetail extends Negotiation {
  /** Protocol turns in ascending turn order. */
  turns: {
    turnIndex: number;
    seatUserId: string;
    action: NegotiationAction;
    message: string;
    createdAt: string;
  }[];
  /** Host-authoritative permissions and constraints for this principal's seat. */
  protocol: {
    guidance: string;
    availableActions: NegotiationAction[];
    blockedReason: string | null;
    maxTurns: number;
    messageLimit: number;
  };
}
