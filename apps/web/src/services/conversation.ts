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

export interface NegotiationActivityMessage {
  id: string;
  opportunityId: string;
  sender: 'yours' | 'theirs';
  parts: unknown[];
  createdAt: string;
}

export interface NegotiationActivityGroup {
  correspondentUserId: string;
  correspondentLabel: string;
  correspondentAvatar: string | null;
  messages: NegotiationActivityMessage[];
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

  getNegotiationActivity: async (intentId: string): Promise<NegotiationActivityGroup[]> => {
    const response = await api.get<{ groups: NegotiationActivityGroup[] }>(
      `/conversations/negotiations/activity?intentId=${encodeURIComponent(intentId)}`,
    );
    return response.groups;
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
