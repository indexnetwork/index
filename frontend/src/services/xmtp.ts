export interface XmtpPeerInfo {
  walletAddress: string | null;
  xmtpInboxId: string | null;
}

export interface ChatContextResponse {
  opportunities: {
    opportunityId: string;
    headline: string;
    personalizedSummary: string;
    narratorRemark: string;
    introducerName: string | null;
    peerName: string;
    peerAvatar: string | null;
    acceptedAt: string | null;
  }[];
}

export interface XmtpChatContext extends ChatContextResponse {
  groupId: string | null;
}

export interface ResolvedPeer {
  id: string;
  name: string;
  avatar: string | null;
}

export const createXmtpService = (api: {
  get: <T>(endpoint: string) => Promise<T>;
  post: <T>(endpoint: string, data?: unknown) => Promise<T>;
}) => ({
  getPeerInfo: (userId: string) =>
    api.post<XmtpPeerInfo>('/xmtp/peer-info', { userId }),

  resolvePeers: (inboxIds: string[]) =>
    api.post<{ peers: Record<string, ResolvedPeer> }>(
      '/xmtp/resolve-peers', { inboxIds }),

  deleteConversation: (conversationId: string) =>
    api.post<{ success: boolean }>('/xmtp/hide-conversation', { conversationId }),

  getHiddenConversations: () =>
    api.get<{ conversations: { conversationId: string; hiddenAt: string }[] }>(
      '/xmtp/hidden-conversations'),

  getChatContext: (peerUserId: string) =>
    api.get<ChatContextResponse>(`/opportunities/chat-context?peerUserId=${encodeURIComponent(peerUserId)}`),
});
