"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import { usePathname } from "next/navigation";
import { useAIChatSessions } from "@/contexts/AIChatSessionsContext";
import { apiClient } from "@/lib/api";
import type { Suggestion } from "@/hooks/useSuggestions";

export interface DiscoveryOpportunity {
  candidateId: string;
  candidateName?: string;
  candidateAvatar?: string;
  score: number;
  sourceDescription: string;
}

/**
 * Re-export OpportunityCardData for consumers that import from this context.
 */
export type { OpportunityCardData } from "@/components/chat/OpportunityCardInChat";

/** Per-turn debug meta (graph + tool calls) for copy debug. */
export interface DebugTurnMeta {
  graph: string;
  iterations: number;
  tools: Array<{
    name: string;
    args: Record<string, unknown>;
    resultSummary: string;
    success: boolean;
    /** Internal steps (subgraphs, subtasks) when tool reports debugSteps. */
    steps?: Array<{ step: string; detail?: string }>;
  }>;
}

export interface ToolCallStep {
  step: string;
  detail?: string;
  /** Structured data for rich display (e.g., Felicity scores, classification, candidate info). */
  data?: Record<string, unknown>;
}

export type TraceEventType =
  | "iteration_start"
  | "llm_start"
  | "llm_end"
  | "tool_start"
  | "tool_end"
  | "negotiation_progress";

export interface TraceEvent {
  type: TraceEventType;
  timestamp: number;
  iteration?: number;
  name?: string;
  status?: "running" | "success" | "error";
  summary?: string;
  steps?: ToolCallStep[];
  hasToolCalls?: boolean;
  toolNames?: string[];
  // Negotiation-specific fields
  negotiationId?: string;
  candidateUserId?: string;
  candidateName?: string;
  eventType?: "start" | "turn" | "end";
  turn?: number;
  maxTurns?: number;
  speaker?: "user_agent" | "candidate_agent";
  message?: string;
  decision?: string;
  outcome?: string;
  reasoning?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  attachmentNames?: string[];
  discoveries?: DiscoveryOpportunity[];
  traceEvents?: TraceEvent[];
}

interface AIChatContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  messages: ChatMessage[];
  sessionId: string | null;
  sessionTitle: string | null;
  setSessionId: (id: string | null) => void;
  /** The index bound to the current session (persisted). Null if no index scope. */
  sessionIndexId: string | null;
  /** When the user has selected a single index (e.g. in chat dropdown), chat and create_intent are scoped to that index. */
  scopeIndexId: string | null;
  /** Set the current index scope (e.g. from the index filter dropdown in ChatContent). Call with null for "Everywhere". */
  setScopeIndexId: (indexId: string | null) => void;
  /** Context-aware suggestions from the last done event; empty when no messages or after clear/load. */
  suggestions: Suggestion[];
  /** Per-turn debug meta (one entry per assistant message, null for loaded history). */
  debugMetaByTurn: (DebugTurnMeta | null)[];
  isLoading: boolean;
  sendMessage: (
    message: string,
    fileIds?: string[],
    attachmentNames?: string[],
  ) => Promise<void>;
  /** Clear messages and session state. Use { abortStream: false } when navigating away so the in-flight stream can finish and the new session appears in the sidebar. */
  clearChat: (options?: { abortStream?: boolean }) => void;
  loadSession: (sessionId: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => Promise<boolean>;
}

const AIChatContext = createContext<AIChatContextType | null>(null);

/** Extract index ID from pathname when on /index/[indexId] (fallback when no dropdown selection). */
function getScopeIndexIdFromPathname(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = pathname.match(/^\/index\/([^/]+)/);
  return match ? match[1] : null;
}

export function AIChatProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [scopeIndexIdOverride, setScopeIndexIdOverride] = useState<
    string | null
  >(null);
  const scopeFromPath = getScopeIndexIdFromPathname(pathname);
  // For new chats, use the UI selection; for existing sessions, the session's bound index takes precedence
  const [sessionIndexId, setSessionIndexId] = useState<string | null>(null);
  // Effective scope: session's bound index takes precedence, then UI override, then path
  const scopeIndexId = sessionIndexId ?? scopeIndexIdOverride ?? scopeFromPath;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [debugMetaByTurn, setDebugMetaByTurn] = useState<(DebugTurnMeta | null)[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { refetchSessions } = useAIChatSessions();
  const abortControllerRef = useRef<AbortController | null>(null);
  /** When true, sendMessage will only refetch sessions on X-Session-Id and not set sessionId (used when user navigated away during stream). */
  const skipSessionUpdateForRequestRef = useRef(false);

  const sendMessage = useCallback(
    async (message: string, fileIds?: string[], attachmentNames?: string[]) => {
      const displayContent =
        message.trim() || (fileIds?.length ? "Attached file(s)." : "");
      if (!displayContent) return;

      // A new sendMessage call is always intentional — reset the skip flag
      // so the session ID from the response header is captured correctly.
      // (clearChat with abortStream:false sets this flag for in-flight streams
      // that should finish silently, but it must not carry over to new calls.)
      skipSessionUpdateForRequestRef.current = false;

      // Add user message (include attachment names for display)
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: displayContent,
        timestamp: new Date(),
        ...(attachmentNames?.length ? { attachmentNames } : {}),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Add placeholder for assistant response
      const assistantMessageId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          isStreaming: true,
        },
      ]);

      setIsLoading(true);
      abortControllerRef.current = new AbortController();

      try {
        const bodyPayload: Record<string, unknown> = {
          message:
            message.trim() || (fileIds?.length ? "Attached file(s)." : ""),
          sessionId,
          ...(fileIds?.length ? { fileIds } : {}),
          ...(scopeIndexId ? { indexId: scopeIndexId } : {}),
        };

        const response = await apiClient.stream("/chat/stream", bodyPayload, {
          signal: abortControllerRef.current.signal,
        });

        // Get session ID from header (new session created)
        const newSessionId = response.headers.get("X-Session-Id");
        if (newSessionId && !sessionId) {
          if (skipSessionUpdateForRequestRef.current) {
            // User navigated away; only refresh sidebar so the new session appears and can be opened later
            refetchSessions();
          } else {
            setSessionId(newSessionId);
            // The index selected at session creation becomes the session's bound index
            // (scopeIndexId at this point is the UI selection since sessionIndexId is null for new chats)
            if (scopeIndexId) {
              setSessionIndexId(scopeIndexId);
            }
            refetchSessions();
          }
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));

                switch (event.type) {
                  case "iteration_start":
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || [])];
                        traceEvents.push({
                          type: "iteration_start",
                          timestamp: Date.now(),
                          iteration: event.iteration,
                        });
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  case "llm_start":
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || [])];
                        traceEvents.push({
                          type: "llm_start",
                          timestamp: Date.now(),
                          iteration: event.iteration,
                        });
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  case "token":
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: msg.content + event.content }
                          : msg,
                      ),
                    );
                    break;
                  case "llm_end":
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || [])];
                        traceEvents.push({
                          type: "llm_end",
                          timestamp: Date.now(),
                          iteration: event.iteration,
                          hasToolCalls: event.hasToolCalls,
                          toolNames: event.toolNames,
                        });
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  case "tool_activity": {
                    const now = Date.now();
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || [])];
                        if (event.phase === "start") {
                          traceEvents.push({
                            type: "tool_start",
                            timestamp: now,
                            name: event.toolName,
                            status: "running",
                          });
                        } else {
                          traceEvents.push({
                            type: "tool_end",
                            timestamp: now,
                            name: event.toolName,
                            status: event.success === true ? "success" : event.success === false ? "error" : undefined,
                            summary: event.summary,
                            steps: event.steps,
                          });
                        }
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  }
                  case "negotiation_progress": {
                    const now = Date.now();
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || [])];
                        traceEvents.push({
                          type: "negotiation_progress",
                          timestamp: now,
                          negotiationId: event.negotiationId,
                          candidateUserId: event.candidateUserId,
                          candidateName: event.candidateName,
                          eventType: event.eventType,
                          turn: event.turn,
                          maxTurns: event.maxTurns,
                          speaker: event.speaker,
                          message: event.message,
                          decision: event.decision,
                          outcome: event.outcome,
                          reasoning: event.reasoning,
                        });
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  }
                  case "done":
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        // If we already have streamed content (with possible inline tool
                        // activity blockquotes), keep it. Only fall back to event.response
                        // when no tokens were received (e.g. legacy/fallback path).
                        const finalContent = msg.content.trim()
                          ? msg.content
                          : event.response || msg.content;
                        return {
                          ...msg,
                          content: finalContent,
                          isStreaming: false,
                        };
                      }),
                    );
                    // Update session title if provided by backend
                    if (event.title) {
                      setSessionTitle(event.title);
                    }
                    // Update context-aware suggestions from backend; clear stale chips if absent
                    if (Array.isArray(event.suggestions)) {
                      setSuggestions(event.suggestions);
                    } else {
                      setSuggestions([]);
                    }
                    // Refetch sessions after streaming completes (title is generated on backend)
                    refetchSessions();
                    break;
                  case "error":
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                              ...msg,
                              content: `Error: ${event.message}`,
                              isStreaming: false,
                            }
                          : msg,
                      ),
                    );
                    break;
                  case "debug_meta":
                    setDebugMetaByTurn((prev) => [
                      ...prev,
                      {
                        graph: event.graph ?? "",
                        iterations: event.iterations ?? 0,
                        tools: event.tools ?? [],
                      },
                    ]);
                    break;
                }
              } catch (e) {
                console.error("Failed to parse SSE event:", e);
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          console.log("Chat stream aborted");
        } else {
          console.error("Chat error:", error);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: "Failed to get response. Please try again.",
                    isStreaming: false,
                  }
                : msg,
            ),
          );
        }
      } finally {
        skipSessionUpdateForRequestRef.current = false;
        setIsLoading(false);
      }
    },
    [sessionId, scopeIndexId, refetchSessions],
  );

  const clearChat = useCallback((options?: { abortStream?: boolean }) => {
    const abortStream = options?.abortStream !== false;
    if (!abortStream) {
      skipSessionUpdateForRequestRef.current = true;
      setIsLoading(false); // Stop showing loading on home while stream continues in background
    }
    setMessages([]);
    setSuggestions([]);
    setDebugMetaByTurn([]);
    setSessionId(null);
    setSessionTitle(null);
    setSessionIndexId(null); // Clear session-bound index so new chat can use UI selection
    if (abortStream && abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    try {
      const data = await apiClient.post<{
        session: {
          id: string;
          title?: string | null;
          indexId?: string | null;
        };
        messages: Array<{
          id: string;
          role: string;
          content: string;
          createdAt: string;
        }>;
      }>("/chat/session", { sessionId: id });
      setSessionId(data.session.id);
      setSessionTitle(data.session.title?.trim() ?? null);
      setSuggestions([]); // Session load does not return suggestions; next response will
      // Load the session's bound index - this is the persisted scope for this conversation
      setSessionIndexId(data.session.indexId ?? null);
      setMessages(
        data.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          timestamp: new Date(m.createdAt),
          isStreaming: false,
        })),
      );
      const assistantCount = data.messages.filter((m) => m.role === "assistant").length;
      setDebugMetaByTurn(Array(assistantCount).fill(null));
    } catch (err) {
      console.error("Load session error:", err);
    }
  }, []);

  const updateSessionTitle = useCallback(
    async (id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return false;

      try {
        await apiClient.post("/chat/session/title", { sessionId: id, title: trimmed });
        if (sessionId === id) {
          setSessionTitle(trimmed);
        }
        refetchSessions();
        return true;
      } catch (err) {
        console.error("Update session title error:", err);
        return false;
      }
    },
    [sessionId, refetchSessions],
  );

  return (
    <AIChatContext.Provider
      value={{
        isOpen,
        setIsOpen,
        messages,
        sessionId,
        sessionTitle,
        setSessionId,
        sessionIndexId,
        scopeIndexId,
        setScopeIndexId: setScopeIndexIdOverride,
        suggestions,
        debugMetaByTurn,
        isLoading,
        sendMessage,
        clearChat,
        loadSession,
        updateSessionTitle,
      }}
    >
      {children}
    </AIChatContext.Provider>
  );
}

export function useAIChat() {
  const context = useContext(AIChatContext);
  if (!context) {
    throw new Error("useAIChat must be used within AIChatProvider");
  }
  return context;
}
