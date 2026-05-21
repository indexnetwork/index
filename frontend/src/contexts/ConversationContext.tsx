import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { apiClient } from '@/lib/api';
import { getJwtToken } from '@/lib/auth-client';
import { useAuthContext } from '@/contexts/AuthContext';
import type { ConversationSummary, ConversationMessage } from '@/services/conversation';

const PROTOCOL_BASE = import.meta.env.VITE_PROTOCOL_URL || '';
const SSE_URL = `${PROTOCOL_BASE}/api/conversations/stream`;

interface ConversationContextType {
  conversations: ConversationSummary[];
  negotiations: ConversationSummary[];
  messages: Map<string, ConversationMessage[]>;
  isConnected: boolean;
  loadMessages: (conversationId: string, opts?: { limit?: number; before?: string }) => Promise<void>;
  sendMessage: (conversationId: string, parts: unknown[]) => Promise<ConversationMessage | null>;
  refreshConversations: () => Promise<void>;
  refreshNegotiations: () => Promise<void>;
  hideConversation: (conversationId: string) => Promise<void>;
  getOrCreateDM: (peerUserId: string) => Promise<ConversationSummary>;
}

const ConversationContext = createContext<ConversationContextType | null>(null);

/**
 * Provides real-time conversation state via SSE and REST API calls.
 */
export function ConversationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthContext();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [negotiations, setNegotiations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Map<string, ConversationMessage[]>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const sseGenerationRef = useRef(0);
  const connectSSERef = useRef<() => void>(() => {});
  const refreshConversationsRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // --- REST helpers (use apiClient directly, same pattern as AIChatContext) ---

  const refreshConversations = useCallback(async () => {
    try {
      const data = await apiClient.get<{ conversations: ConversationSummary[] }>('/conversations');
      setConversations(data.conversations);
    } catch (err) {
      console.error('[ConversationContext] Failed to fetch conversations:', err);
    }
  }, []);
  useEffect(() => { refreshConversationsRef.current = refreshConversations; }, [refreshConversations]);

  const refreshNegotiations = useCallback(async () => {
    try {
      const data = await apiClient.get<{ conversations: ConversationSummary[] }>('/conversations/negotiations');
      setNegotiations(data.conversations);
    } catch (err) {
      console.error('[ConversationContext] Failed to fetch negotiations:', err);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, opts?: { limit?: number; before?: string }) => {
    try {
      const params = new URLSearchParams();
      if (opts?.limit) params.set('limit', String(opts.limit));
      if (opts?.before) params.set('before', opts.before);
      const qs = params.toString();
      const data = await apiClient.get<{ messages: ConversationMessage[] }>(
        `/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`
      );
      setMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId) ?? [];
        if (opts?.before) {
          const olderIds = new Set(data.messages.map((m: ConversationMessage) => m.id));
          next.set(
            conversationId,
            [...data.messages, ...existing.filter((m) => !olderIds.has(m.id))]
          );
        } else {
          next.set(conversationId, data.messages);
        }
        return next;
      });
    } catch (err) {
      console.error('[ConversationContext] Failed to load messages:', err);
    }
  }, []);

  const sendMessage = useCallback(async (conversationId: string, parts: unknown[]): Promise<ConversationMessage | null> => {
    if (!user?.id) {
      console.error('[ConversationContext] Cannot send message: user not authenticated');
      return null;
    }
    // Optimistic update
    const optimisticId = crypto.randomUUID();
    const optimistic: ConversationMessage = {
      id: optimisticId,
      conversationId,
      senderId: user.id,
      role: 'user',
      parts,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => {
      const next = new Map(prev);
      const existing = next.get(conversationId) || [];
      next.set(conversationId, [...existing, optimistic]);
      return next;
    });

    // Optimistically update conversation sidebar (last message + timestamp)
    let prevConversation: ConversationSummary | undefined;
    setConversations((prev) => {
      prevConversation = prev.find((c) => c.id === conversationId);
      return prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              lastMessage: { parts, senderId: user.id, createdAt: optimistic.createdAt },
              lastMessageAt: optimistic.createdAt,
            }
          : c
      );
    });

    try {
      const data = await apiClient.post<{ message: ConversationMessage }>(
        `/conversations/${conversationId}/messages`,
        { parts }
      );
      // Replace optimistic message with real one
      setMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId) || [];
        next.set(
          conversationId,
          existing.map((m) => (m.id === optimisticId ? data.message : m))
        );
        return next;
      });
      return data.message;
    } catch (err) {
      console.error('[ConversationContext] Failed to send message:', err);
      // Roll back optimistic update (messages + conversation sidebar)
      setMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId) || [];
        next.set(
          conversationId,
          existing.filter((m) => m.id !== optimisticId)
        );
        return next;
      });
      if (prevConversation) {
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? prevConversation! : c))
        );
      }
      return null;
    }
  }, [user, apiClient]);

  const hideConversation = useCallback(async (conversationId: string) => {
    try {
      await apiClient.delete(`/conversations/${conversationId}`);
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      setMessages((prev) => {
        const next = new Map(prev);
        next.delete(conversationId);
        return next;
      });
    } catch (err) {
      console.error('[ConversationContext] Failed to hide conversation:', err);
    }
  }, []);

  const getOrCreateDM = useCallback(async (peerUserId: string): Promise<ConversationSummary> => {
    const data = await apiClient.post<{ conversation: ConversationSummary }>(
      '/conversations/dm',
      { peerUserId }
    );
    // Add to list if not already present
    setConversations((prev) => {
      if (prev.some((c) => c.id === data.conversation.id)) return prev;
      return [data.conversation, ...prev];
    });
    return data.conversation;
  }, []);

  // --- SSE connection ---

  const connectSSE = useCallback(async () => {
    const generation = ++sseGenerationRef.current;

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      const token = await getJwtToken();
      if (generation !== sseGenerationRef.current) return;

      const url = `${SSE_URL}?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        retryCountRef.current = 0;
        setIsConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case 'connected':
              setIsConnected(true);
              break;
            case 'message': {
              const msg = data.message as ConversationMessage;
              const convId = data.conversationId as string;
              // Append message to the conversation's message list
              setMessages((prev) => {
                const next = new Map(prev);
                const existing = next.get(convId) || [];
                // Deduplicate by id (in case we already have it from optimistic update)
                if (existing.some((m) => m.id === msg.id)) return prev;
                next.set(convId, [...existing, msg]);
                return next;
              });
              // Update conversation summary, or refresh list if conversation is unknown (e.g. was hidden)
              setConversations((prev) => {
                const exists = prev.some((c) => c.id === convId);
                if (!exists) {
                  // Conversation not in local list — re-fetch from server (it was unhidden by the new message)
                  refreshConversationsRef.current();
                  return prev;
                }
                return prev.map((c) =>
                  c.id === convId
                    ? {
                        ...c,
                        lastMessage: { parts: msg.parts, senderId: msg.senderId, createdAt: msg.createdAt },
                        lastMessageAt: msg.createdAt,
                      }
                    : c
                );
              });
              break;
            }
          }
        } catch {
          // Ignore parse errors (e.g. keepalive comments)
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        eventSourceRef.current = null;
        retryCountRef.current += 1;
        if (retryCountRef.current <= 10) {
          const delay = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 60000);
          retryTimeoutRef.current = setTimeout(() => { connectSSERef.current(); }, delay);
        } else {
          console.error('[ConversationContext] SSE max retries reached, giving up');
        }
      };
    } catch (err) {
      console.error('[ConversationContext] SSE connection failed:', err);
      retryCountRef.current += 1;
      if (retryCountRef.current <= 10) {
        const delay = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 60000);
        retryTimeoutRef.current = setTimeout(() => { connectSSERef.current(); }, delay);
      }
    }
  }, []);
  useEffect(() => { connectSSERef.current = connectSSE; }, [connectSSE]);

  // Connect SSE and load conversations when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      sseGenerationRef.current += 1;
      // Clean up on logout
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      // Intentional synchronous reset on logout — not a cascading render issue
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsConnected(false);
      setConversations([]);
      setMessages(new Map());
      return;
    }

    refreshConversations();
    refreshNegotiations();
    connectSSE();

    return () => {
      sseGenerationRef.current += 1;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [isAuthenticated, refreshConversations, connectSSE]);

  return (
    <ConversationContext.Provider
      value={{
        conversations,
        negotiations,
        messages,
        isConnected,
        loadMessages,
        sendMessage,
        refreshConversations,
        refreshNegotiations,
        hideConversation,
        getOrCreateDM,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
}

export function useConversation() {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error('useConversation must be used within ConversationProvider');
  }
  return context;
}
