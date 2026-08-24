/**
 * Conversation service — typed API client for the conversations endpoints.
 */

/** A negotiation task's lifecycle is now exactly these three states (negotiation-graph rewrite, #1494). */
export type NegotiationTaskState = 'working' | 'paused' | 'completed';

/**
 * Every reason the protocol may pause a negotiation on — the wire vocabulary,
 * defined once for the whole app. A member missing here is not a type error
 * anywhere: the value still arrives, and each consumer renders it as whatever
 * its own default branch happens to say.
 */
export const NEGOTIATION_PAUSE_REASONS = [
  'counterparty_silent',
  'needs_principal',
  'ready_for_verdict',
  'turn_cap',
  'open_failed',
] as const;
export type NegotiationPauseReason = (typeof NEGOTIATION_PAUSE_REASONS)[number];

export type NegotiationOpportunityStatus =
  | 'latent'
  | 'draft'
  | 'negotiating'
  | 'pending'
  | 'stalled'
  | 'accepted'
  | 'rejected'
  | 'expired';

export interface ConversationNegotiationLifecycle {
  taskId: string;
  state: NegotiationTaskState;
  /** Set only when `state === 'paused'`. */
  pause: { reason: NegotiationPauseReason; payload?: unknown } | null;
  statusTimestamp: string | null;
  opportunityId: string | null;
  opportunityStatus: NegotiationOpportunityStatus | null;
  acceptedByViewer: boolean;
  turnCount: number;
  signalCount: number;
  updatedAt: string;
  /**
   * IND-610: the owner-facing outreach-gate decision, named-field projected by
   * the API. Present only when the viewer is the negotiation's initiator —
   * never populated for a non-owner viewer, even for `screened_out`
   * negotiations that are otherwise visible in a mutual conversation.
   *
   * `source` distinguishes the two refusals that collapse into the same
   * `screened_out` outcome: `outcome` (the agent refused on its opening turn,
   * so only reasoning exists) and `screen` — READ-ONLY HISTORY, the outreach
   * gate that wrote `evidence.*` is gone, but rows from before its removal
   * still project one.
   */
  screenDecision?: {
    source: 'screen' | 'outcome';
    decision: 'reach_out' | 'pass';
    reasoning: string;
    counterpartyPremiseFit: string | null;
    intentAlignment: string | null;
    screenedAt: string | null;
  } | null;
}

/** A viewer-visible opportunity and the exact negotiation task that owns its session. */
export interface ConversationNegotiationOpportunity extends Omit<ConversationNegotiationLifecycle, 'taskId' | 'opportunityId' | 'opportunityStatus' | 'statusTimestamp' | 'screenDecision'> {
  intentId: string;
  title: string;
  taskId: string;
  opportunityId: string;
  opportunityStatus: NegotiationOpportunityStatus | null;
}

export interface ConversationSummary {
  id: string;
  participants: { participantId: string; participantType: 'user' | 'agent'; name: string | null; avatar: string | null; ownerName?: string | null }[];
  /** The task session that produced the latest message, when it has one. */
  lastMessage: { parts: unknown[]; senderId: string; createdAt: string; taskId?: string | null } | null;
  metadata: { title?: string; shareToken?: string } | null;
  /** Viewer-scoped opportunity signal provenance, latest first. */
  via: Array<{ intentId: string; opportunityId: string; title: string }>;
  /** Number of counterpart messages newer than this viewer's read cursor. */
  unreadCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  /**
   * The task session that represents this A2A conversation to the viewer: the
   * most alive session with that counterparty, newest only within a liveness
   * tier. A pending approval is never shadowed by a later screened-out pairing.
   */
  negotiation?: ConversationNegotiationLifecycle | null;
  negotiationOpportunities?: ConversationNegotiationOpportunity[];
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderId: string;
  role: 'user' | 'agent';
  /** Durable conversation-session binding for sectioned history reads. */
  sessionId?: string | null;
  parts: unknown[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** Debug projection for the PersonalAgent's intent-scoped negotiation cycle. */
export interface IntentCycleSnapshot {
  round: {
    number: number;
    size: number | null;
    kickoffStartedAt: string | null;
    working: number;
    paused: number;
  };
  negotiations: Array<{
    taskId: string;
    conversationId: string;
    opportunityId: string;
    opportunityStatus: NegotiationOpportunityStatus;
    counterpartLabel: string;
    round: number;
    state: NegotiationTaskState;
    /** A pause reason is state, not its private payload. */
    pause: { reason: NegotiationPauseReason; by: 'yours' | 'theirs' | null } | null;
    latestActivity: {
      actor: 'yours' | 'theirs';
      verb: string | null;
      /** Shared A2A prose only; pause payloads are never projected here. */
      text: string | null;
      createdAt: string;
    } | null;
    updatedAt: string;
  }>;
}

/** Owner-only debugging detail for one seat in one negotiation. */
export interface IntentCycleNegotiationDetail {
  intent: { id: string; payload: string };
  task: {
    id: string;
    conversationId: string;
    opportunityId: string;
    round: number;
    state: NegotiationTaskState;
    brief: string | null;
    pause: { reason: NegotiationPauseReason; by: 'yours' | 'theirs' | null; payload?: unknown } | null;
  };
  transcript: Array<{
    id: string;
    actor: 'yours' | 'theirs';
    verb: string | null;
    pause: { reason: NegotiationPauseReason; payload?: unknown } | null;
    text: string | null;
    createdAt: string;
  }>;
  /** Present only when this owner resolved the negotiation. */
  outcome: { verdict: 'pending' | 'reject'; reasoning: string | null } | null;
}

/** Append-only, owner-scoped record of executed IS-A acts. */
export interface IntentCycleTimelineEntry {
  id: string;
  event: Record<string, unknown>;
  act: Record<string, unknown>;
  createdAt: string;
}

export const createConversationService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  /** List all conversations for the authenticated user. */
  getConversations: async (): Promise<ConversationSummary[]> => {
    const response = await api.get<{ conversations: ConversationSummary[] }>('/conversations');
    return response.conversations;
  },

  /** List A2A negotiation conversations for the authenticated user. */
  getNegotiations: async (): Promise<ConversationSummary[]> => {
    const response = await api.get<{ conversations: ConversationSummary[] }>('/conversations/negotiations');
    return response.conversations;
  },

  getIntentCycle: async (intentId: string): Promise<IntentCycleSnapshot> => {
    const response = await api.get<{ cycle: IntentCycleSnapshot }>(
      `/conversations/negotiations/intent-cycle?intentId=${encodeURIComponent(intentId)}`,
    );
    return response.cycle;
  },

  getIntentCycleTimeline: async (intentId: string): Promise<IntentCycleTimelineEntry[]> => {
    const response = await api.get<{ entries: IntentCycleTimelineEntry[] }>(
      `/conversations/negotiations/intent-cycle/timeline?intentId=${encodeURIComponent(intentId)}`,
    );
    return response.entries;
  },

  getIntentCycleNegotiation: async (intentId: string, taskId: string): Promise<IntentCycleNegotiationDetail> => {
    const response = await api.get<{ negotiation: IntentCycleNegotiationDetail }>(
      `/conversations/negotiations/intent-cycle/${encodeURIComponent(taskId)}?intentId=${encodeURIComponent(intentId)}`,
    );
    return response.negotiation;
  },

  /** Create a new conversation. */
  createConversation: async (participants: { participantId: string; participantType: 'user' | 'agent' }[], metadata?: Record<string, unknown>): Promise<ConversationSummary> => {
    const response = await api.post<{ conversation: ConversationSummary }>('/conversations', { participants, metadata });
    return response.conversation;
  },

  /** Get messages for a conversation. */
  getMessages: async (conversationId: string, opts?: { limit?: number; before?: string }): Promise<ConversationMessage[]> => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.before) params.set('before', opts.before);
    const qs = params.toString();
    const response = await api.get<{ messages: ConversationMessage[] }>(`/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`);
    return response.messages;
  },

  /** Send a message to a conversation. */
  sendMessage: async (conversationId: string, parts: unknown[], opts?: { metadata?: Record<string, unknown> }): Promise<ConversationMessage> => {
    const response = await api.post<{ message: ConversationMessage }>(`/conversations/${conversationId}/messages`, { parts, metadata: opts?.metadata });
    return response.message;
  },

  /** Get or create a DM conversation with a peer user. */
  getOrCreateDM: async (peerUserId: string): Promise<ConversationSummary> => {
    const response = await api.post<{ conversation: ConversationSummary }>('/conversations/dm', { peerUserId });
    return response.conversation;
  },

  /** Mark a conversation read for the current viewer. */
  markConversationRead: async (conversationId: string): Promise<void> => {
    await api.post(`/conversations/${conversationId}/read`);
  },

  /** Hide (soft-delete) a conversation. */
  hideConversation: async (conversationId: string): Promise<void> => {
    await api.delete(`/conversations/${conversationId}`);
  },
});
