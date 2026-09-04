/**
 * Conversation service — typed API client for the conversations endpoints.
 */

export interface ConversationSummary {
  id: string;
  participants: { participantId: string; participantType: 'user' | 'agent'; name: string | null; avatar: string | null; ownerName?: string | null }[];
  lastMessage: { parts: unknown[]; senderId: string; createdAt: string } | null;
  metadata: { title?: string; shareToken?: string } | null;
  /** Viewer-scoped opportunity signal provenance, latest first. */
  via: Array<{ intentId: string; opportunityId: string; title: string }>;
  /** Number of counterpart messages newer than this viewer's read cursor. */
  unreadCount: number;
  lastMessageAt: string | null;
  createdAt: string;
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

/** One session slice of a conversation's history, with a cursor to the previous session. */
export interface ConversationSessionHistory {
  messages: ConversationMessage[];
  sessionId: string | null;
  hasPreviousSession: boolean;
  previousSessionCursor: string | null;
}

export const createConversationService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  /** List all conversations for the authenticated user. */
  getConversations: async (): Promise<ConversationSummary[]> => {
    const response = await api.get<{ conversations: ConversationSummary[] }>('/conversations');
    return response.conversations;
  },

  /**
   * Get messages for a conversation. `intentId` filters the agent DM to the
   * messages tagged with that signal, and nothing else.
   */
  getMessages: async (conversationId: string, opts?: { limit?: number; before?: string; intentId?: string }): Promise<ConversationMessage[]> => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.before) params.set('before', opts.before);
    if (opts?.intentId) params.set('intentId', opts.intentId);
    const qs = params.toString();
    const response = await api.get<{ messages: ConversationMessage[] }>(`/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`);
    return response.messages;
  },

  /**
   * Get one session's messages for a conversation, newest session first.
   * `beforeSessionId` pages back to the session preceding that cursor.
   */
  getSessionHistory: async (conversationId: string, opts?: { beforeSessionId?: string }): Promise<ConversationSessionHistory> => {
    const params = new URLSearchParams({ sessionHistory: 'true' });
    if (opts?.beforeSessionId) params.set('beforeSessionId', opts.beforeSessionId);
    return api.get<ConversationSessionHistory>(`/conversations/${conversationId}/messages?${params.toString()}`);
  },

  /** Send a message to a conversation. */
  sendMessage: async (conversationId: string, parts: unknown[], opts?: { metadata?: Record<string, unknown> }): Promise<ConversationMessage> => {
    const response = await api.post<{ message: ConversationMessage }>(`/conversations/${conversationId}/messages`, { parts, metadata: opts?.metadata });
    return response.message;
  },

  /** Get or create a DM conversation with a peer user. */
  getOrCreateDm: async (peerUserId: string): Promise<ConversationSummary> => {
    const response = await api.post<{ conversation: ConversationSummary }>('/conversations/dm', { peerUserId });
    return response.conversation;
  },

  /** Get or create the caller's agent DM — one conversation per owner. */
  getOrCreateAgentDm: async (): Promise<ConversationSummary> => {
    const response = await api.post<{ conversation: ConversationSummary }>('/conversations/agent-dm', {});
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
