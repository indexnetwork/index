import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api';
import { getJwtToken } from '@/lib/auth-client';
import { useAuthContext } from '@/contexts/AuthContext';
import type { ConversationSummary, ConversationMessage } from '@/services/conversation';
import { log } from '@/lib/logger';

const logger = log.context.from('ConversationContext');

const PROTOCOL_BASE = import.meta.env.VITE_PROTOCOL_URL || '';
const SSE_URL = `${PROTOCOL_BASE}/api/conversations/stream`;

interface ConversationSessionHistoryState {
  hasPreviousSession: boolean;
  previousSessionCursor: string | null;
  loadingPrevious: boolean;
}

/** IND-570: Per-session opportunity attribution, keyed by sessionId. */
export interface SessionOpportunityInfo {
  opportunityId: string;
  status: string | null;
}

/**
 * Live flip of the `questionRegenerationPending` signal for one signal scope,
 * published on the conversation SSE channel by the question-message
 * regeneration queue: true at enqueue, false when the job finishes and the
 * negotiator DM content is current.
 */
export interface QuestionRegenerationEvent {
  intentId: string;
  pending: boolean;
}

/** A persisted message received on the authenticated conversation SSE channel. */
export interface ConversationMessageEvent {
  conversationId: string;
  message: ConversationMessage;
}

/** An owner-visible discovery-progress write; fetch the intent for its data. */
export interface IntentDiscoveryProgressEvent {
  intentId: string;
}

/** An owner-scoped invalidation for an intent-owned view. */
export interface IntentInvalidationEvent {
  intentId: string;
}

interface ConversationContextType {
  conversations: ConversationSummary[];
  negotiations: ConversationSummary[];
  messages: Map<string, ConversationMessage[]>;
  sessionHistory: Map<string, ConversationSessionHistoryState>;
  /** IND-570: Per-session opportunity attribution, keyed by sessionId. */
  sessionOpportunityMap: Map<string, SessionOpportunityInfo>;
  isConnected: boolean;
  loadMessages: (conversationId: string, opts?: { limit?: number; before?: string }) => Promise<void>;
  loadSessionHistory: (conversationId: string, opts?: { taskId?: string; beforeSessionId?: string }) => Promise<void>;
  loadPreviousSessionMessages: (conversationId: string, taskId?: string) => Promise<void>;
  sendMessage: (conversationId: string, parts: unknown[]) => Promise<ConversationMessage | null>;
  refreshConversations: () => Promise<void>;
  refreshNegotiations: () => Promise<void>;
  markConversationRead: (conversationId: string) => Promise<void>;
  hideConversation: (conversationId: string) => Promise<void>;
  getOrCreateDM: (peerUserId: string) => Promise<ConversationSummary>;
  /**
   * Subscribe to live question-regeneration flips from the SSE stream.
   * Returns the unsubscribe function.
   */
  subscribeQuestionRegeneration: (handler: (event: QuestionRegenerationEvent) => void) => () => void;
  /** Subscribe to persisted conversation messages from the SSE stream. */
  subscribeConversationMessage: (handler: (event: ConversationMessageEvent) => void) => () => void;
  /** Subscribe to owner-scoped discovery-progress invalidations. */
  subscribeIntentDiscoveryProgress: (handler: (event: IntentDiscoveryProgressEvent) => void) => () => void;
  /** Subscribe to owner-scoped intent invalidations. */
  subscribeIntentInvalidation: (handler: (event: IntentInvalidationEvent) => void) => () => void;
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
  const [sessionHistory, setSessionHistory] = useState<Map<string, ConversationSessionHistoryState>>(new Map());
  const [sessionOpportunityMap, setSessionOpportunityMap] = useState<Map<string, SessionOpportunityInfo>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const sseGenerationRef = useRef(0);
  const connectSSERef = useRef<() => void>(() => {});
  const refreshConversationsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const refreshNegotiationsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const negotiationsRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionRegenerationHandlersRef = useRef(new Set<(event: QuestionRegenerationEvent) => void>());
  const conversationMessageHandlersRef = useRef(new Set<(event: ConversationMessageEvent) => void>());
  const intentDiscoveryProgressHandlersRef = useRef(new Set<(event: IntentDiscoveryProgressEvent) => void>());
  const intentInvalidationHandlersRef = useRef(new Set<(event: IntentInvalidationEvent) => void>());

  const subscribeQuestionRegeneration = useCallback(
    (handler: (event: QuestionRegenerationEvent) => void) => {
      questionRegenerationHandlersRef.current.add(handler);
      return () => {
        questionRegenerationHandlersRef.current.delete(handler);
      };
    },
    [],
  );

  const subscribeConversationMessage = useCallback(
    (handler: (event: ConversationMessageEvent) => void) => {
      conversationMessageHandlersRef.current.add(handler);
      return () => { conversationMessageHandlersRef.current.delete(handler); };
    },
    [],
  );

  const subscribeIntentDiscoveryProgress = useCallback(
    (handler: (event: IntentDiscoveryProgressEvent) => void) => {
      intentDiscoveryProgressHandlersRef.current.add(handler);
      return () => { intentDiscoveryProgressHandlersRef.current.delete(handler); };
    },
    [],
  );

  const subscribeIntentInvalidation = useCallback(
    (handler: (event: IntentInvalidationEvent) => void) => {
      intentInvalidationHandlersRef.current.add(handler);
      return () => { intentInvalidationHandlersRef.current.delete(handler); };
    },
    [],
  );

  // --- REST helpers (use apiClient directly, same pattern as AIChatContext) ---

  const refreshConversations = useCallback(async () => {
    try {
      const data = await apiClient.get<{ conversations: ConversationSummary[] }>('/conversations');
      setConversations(data.conversations);
    } catch (err) {
      logger.error('Failed to fetch conversations', { error: err });
    }
  }, []);
  useEffect(() => { refreshConversationsRef.current = refreshConversations; }, [refreshConversations]);

  const refreshNegotiations = useCallback(async () => {
    try {
      const data = await apiClient.get<{ conversations: ConversationSummary[] }>('/conversations/negotiations');
      setNegotiations(data.conversations);
    } catch (err) {
      logger.error('Failed to fetch negotiations', { error: err });
    }
  }, []);
  useEffect(() => { refreshNegotiationsRef.current = refreshNegotiations; }, [refreshNegotiations]);

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
      logger.error('Failed to load messages', { error: err });
    }
  }, []);

  const loadSessionHistory = useCallback(async (
    conversationId: string,
    opts?: { taskId?: string; beforeSessionId?: string },
  ) => {
    try {
      const params = new URLSearchParams({ sessionHistory: 'true' });
      if (opts?.taskId) params.set('taskId', opts.taskId);
      if (opts?.beforeSessionId) params.set('beforeSessionId', opts.beforeSessionId);
      const data = await apiClient.get<{
        messages: ConversationMessage[];
        sessionId: string | null;
        hasPreviousSession: boolean;
        previousSessionCursor: string | null;
        sessionOpportunityId: string | null;
        sessionOpportunityStatus: string | null;
      }>(`/conversations/${conversationId}/messages?${params.toString()}`);
      setMessages((previous) => {
        const next = new Map(previous);
        const existing = next.get(conversationId) ?? [];
        const received = data.messages.map((message) => ({ ...message, sessionId: data.sessionId }));
        if (!opts?.beforeSessionId) {
          next.set(conversationId, received);
          return next;
        }
        const knownIds = new Set(existing.map((message) => message.id));
        next.set(conversationId, [...received.filter((message) => !knownIds.has(message.id)), ...existing].sort((left, right) => (
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
          || left.id.localeCompare(right.id)
        )));
        return next;
      });
      setSessionHistory((previous) => {
        const next = new Map(previous);
        next.set(conversationId, {
          hasPreviousSession: data.hasPreviousSession,
          previousSessionCursor: data.previousSessionCursor,
          loadingPrevious: false,
        });
        return next;
      });
      // IND-570: store per-session opportunity attribution keyed by sessionId.
      if (data.sessionId && data.sessionOpportunityId) {
        setSessionOpportunityMap((previous) => {
          const next = new Map(previous);
          next.set(data.sessionId!, { opportunityId: data.sessionOpportunityId!, status: data.sessionOpportunityStatus });
          return next;
        });
      }
    } catch (error) {
      logger.error('Failed to load conversation session history', { error, conversationId });
      setSessionHistory((previous) => {
        const next = new Map(previous);
        const current = next.get(conversationId);
        if (current) next.set(conversationId, { ...current, loadingPrevious: false });
        return next;
      });
    }
  }, []);

  const loadPreviousSessionMessages = useCallback(async (conversationId: string, taskId?: string) => {
    const current = sessionHistory.get(conversationId);
    if (!current?.hasPreviousSession || !current.previousSessionCursor || current.loadingPrevious) return;
    setSessionHistory((previous) => {
      const next = new Map(previous);
      const history = next.get(conversationId);
      if (history) next.set(conversationId, { ...history, loadingPrevious: true });
      return next;
    });
    await loadSessionHistory(conversationId, { taskId, beforeSessionId: current.previousSessionCursor });
  }, [loadSessionHistory, sessionHistory]);

  const sendMessage = useCallback(async (conversationId: string, parts: unknown[]): Promise<ConversationMessage | null> => {
    if (!user?.id) {
      logger.error('Cannot send message: user not authenticated');
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
      logger.error('Failed to send message', { error: err });
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
  }, [user]);

  const markConversationRead = useCallback(async (conversationId: string) => {
    // Clear locally before the request returns so nav/sidebar badges respond
    // immediately. The server operation is idempotent and viewer-scoped.
    setConversations((prev) => prev.map((conversation) => (
      conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
    )));
    setNegotiations((prev) => prev.map((conversation) => (
      conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
    )));

    try {
      await apiClient.post(`/conversations/${conversationId}/read`);
    } catch (err) {
      logger.error('Failed to mark conversation read', { conversationId, error: err });
    }
  }, []);

  const hideConversation = useCallback(async (conversationId: string) => {
    try {
      await apiClient.delete(`/conversations/${conversationId}`);
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      setMessages((prev) => {
        const next = new Map(prev);
        next.delete(conversationId);
        return next;
      });
      setSessionHistory((prev) => {
        const next = new Map(prev);
        next.delete(conversationId);
        return next;
      });
    } catch (err) {
      logger.error('Failed to hide conversation', { error: err });
    }
  }, []);

  const getOrCreateDM = useCallback(async (peerUserId: string): Promise<ConversationSummary> => {
    const data = await apiClient.post<{ conversation: ConversationSummary }>(
      '/conversations/dm',
      { peerUserId }
    );
    // Add to list if not already present
    setConversations((prev) => {
      const existingIndex = prev.findIndex((c) => c.id === data.conversation.id);
      if (existingIndex < 0) return [data.conversation, ...prev];
      return prev.map((conversation, index) => index === existingIndex ? data.conversation : conversation);
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
                        unreadCount: msg.senderId === user?.id ? c.unreadCount : c.unreadCount + 1,
                      }
                    : c
                );
              });
              // Negotiation turns use the same stream but their summaries are
              // owner-filtered separately (`agent:<ownerId>` participants).
              // Trailing-debounce revalidation so a multi-turn burst refetches
              // once; intent provenance and Radar still react without polling.
              if (negotiationsRefreshTimeoutRef.current) {
                clearTimeout(negotiationsRefreshTimeoutRef.current);
              }
              negotiationsRefreshTimeoutRef.current = setTimeout(() => {
                negotiationsRefreshTimeoutRef.current = null;
                void refreshNegotiationsRef.current();
              }, 500);
              conversationMessageHandlersRef.current.forEach((handler) => handler({
                conversationId: convId,
                message: msg,
              }));
              break;
            }
            case 'question_regeneration': {
              // Question-message regeneration flip for one signal scope. Fan
              // out to the mounted negotiator DM (if any); no inbox state to
              // touch — the negotiator conversation is not an H2H summary.
              const intentId = data.intentId as string | undefined;
              if (!intentId) break;
              const regenerationEvent: QuestionRegenerationEvent = {
                intentId,
                pending: Boolean(data.pending),
              };
              questionRegenerationHandlersRef.current.forEach((handler) => handler(regenerationEvent));
              break;
            }
            case 'intent_discovery_progress': {
              const intentId = data.intentId as string | undefined;
              if (!intentId) break;
              intentDiscoveryProgressHandlersRef.current.forEach((handler) => handler({ intentId }));
              break;
            }
            case 'intent_invalidated': {
              const intentId = data.intentId as string | undefined;
              if (!intentId) break;
              intentInvalidationHandlersRef.current.forEach((handler) => handler({ intentId }));
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
          logger.error('SSE max retries reached, giving up');
        }
      };
    } catch (err) {
      logger.error('SSE connection failed', { error: err });
      retryCountRef.current += 1;
      if (retryCountRef.current <= 10) {
        const delay = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 60000);
        retryTimeoutRef.current = setTimeout(() => { connectSSERef.current(); }, delay);
      }
    }
  }, [user?.id]);
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
      if (negotiationsRefreshTimeoutRef.current) {
        clearTimeout(negotiationsRefreshTimeoutRef.current);
        negotiationsRefreshTimeoutRef.current = null;
      }
      // Intentional synchronous reset on logout — not a cascading render issue
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsConnected(false);
      setConversations([]);
      setNegotiations([]);
      setMessages(new Map());
      setSessionHistory(new Map());
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
      if (negotiationsRefreshTimeoutRef.current) {
        clearTimeout(negotiationsRefreshTimeoutRef.current);
        negotiationsRefreshTimeoutRef.current = null;
      }
    };
  }, [isAuthenticated, refreshConversations, refreshNegotiations, connectSSE]);

  return (
    <ConversationContext.Provider
      value={{
        conversations,
        negotiations,
        messages,
        sessionHistory,
        sessionOpportunityMap,
        isConnected,
        loadMessages,
        loadSessionHistory,
        loadPreviousSessionMessages,
        sendMessage,
        refreshConversations,
        refreshNegotiations,
        markConversationRead,
        hideConversation,
        getOrCreateDM,
        subscribeQuestionRegeneration,
        subscribeConversationMessage,
        subscribeIntentDiscoveryProgress,
        subscribeIntentInvalidation,
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
