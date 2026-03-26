import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import { useLocation } from "react-router";
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
  | "hallucination_detected"
  | "tool_start"
  | "tool_end"
  | "graph_start"
  | "graph_end"
  | "agent_start"
  | "agent_end";

export interface TraceEvent {
  type: TraceEventType;
  timestamp: number;
  iteration?: number;
  name?: string;
  status?: "running" | "success" | "error";
  summary?: string;
  durationMs?: number;
  steps?: ToolCallStep[];
  hasToolCalls?: boolean;
  toolNames?: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  /** Set when user stopped the stream; trace should show "Stopped" instead of "Thinking...". */
  wasStoppedByUser?: boolean;
  /** Timestamp when user stopped; used to freeze trace duration display. */
  stoppedAt?: number;
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
  isLoading: boolean;
  /** Abort the in-progress agent response stream. */
  stopStream: () => void;
  sendMessage: (
    message: string,
    fileIds?: string[],
    attachmentNames?: string[],
    options?: { hidden?: boolean; prefillMessages?: Array<{ role: "assistant" | "user"; content: string }> },
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

/**
 * Merges tool step details from persisted debugMeta into trace events.
 * When traceEvents are persisted without steps but debugMeta has them,
 * this fills in the matching tool_end events so the UI can display steps on reload.
 * Also synthesizes graph_start/graph_end/agent_start/agent_end events from persisted graphs data.
 */
function mergeDebugMetaIntoTraceEvents(
  traceEvents: TraceEvent[] | undefined,
  debugMeta: {
    tools?: Array<{
      name: string;
      steps?: ToolCallStep[];
      graphs?: Array<{
        name: string;
        durationMs?: number;
        agents?: Array<{ name: string; durationMs?: number }>;
      }>;
    }>;
  } | undefined | null,
): TraceEvent[] | undefined {
  if (!traceEvents || !debugMeta?.tools?.length) return traceEvents;

  const merged = [...traceEvents];
  for (const toolDebug of debugMeta.tools) {
    // Merge step details into the matching tool_end event
    if (toolDebug.steps?.length) {
      const toolEndIdx = merged.findIndex(
        (e) => e.type === "tool_end" && e.name === toolDebug.name && !e.steps?.length,
      );
      if (toolEndIdx !== -1) {
        merged[toolEndIdx] = { ...merged[toolEndIdx], steps: toolDebug.steps };
      }
    }

    // Synthesize graph/agent events from persisted graphs data
    if (toolDebug.graphs?.length) {
      // Insert synthesized events before the tool_end for this tool
      const toolEndIdx = merged.findIndex(
        (e) => e.type === "tool_end" && e.name === toolDebug.name,
      );
      const insertAt = toolEndIdx !== -1 ? toolEndIdx : merged.length;

      const synthesized: TraceEvent[] = [];
      for (const graph of toolDebug.graphs) {
        synthesized.push({
          type: "graph_start",
          timestamp: 0,
          name: graph.name,
        });
        for (const agent of graph.agents ?? []) {
          synthesized.push({
            type: "agent_start",
            timestamp: 0,
            name: agent.name,
          });
          synthesized.push({
            type: "agent_end",
            timestamp: 0,
            name: agent.name,
            durationMs: agent.durationMs,
          });
        }
        synthesized.push({
          type: "graph_end",
          timestamp: 0,
          name: graph.name,
          durationMs: graph.durationMs,
        });
      }
      merged.splice(insertAt, 0, ...synthesized);
    }
  }
  return merged;
}

export function AIChatProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
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
  const [isLoading, setIsLoading] = useState(false);
  const { refetchSessions } = useAIChatSessions();
  const abortControllerRef = useRef<AbortController | null>(null);
  /** When true, sendMessage will only refetch sessions on X-Session-Id and not set sessionId (used when user navigated away during stream). */
  const skipSessionUpdateForRequestRef = useRef(false);

  const sendMessage = useCallback(
    async (message: string, fileIds?: string[], attachmentNames?: string[], options?: { hidden?: boolean; prefillMessages?: Array<{ role: "assistant" | "user"; content: string }> }) => {
      const displayContent =
        message.trim() || (fileIds?.length ? "Attached file(s)." : "");
      if (!displayContent) return;

      const isHidden = options?.hidden ?? false;

      // A new sendMessage call is always intentional — reset the skip flag
      // so the session ID from the response header is captured correctly.
      // (clearChat with abortStream:false sets this flag for in-flight streams
      // that should finish silently, but it must not carry over to new calls.)
      skipSessionUpdateForRequestRef.current = false;

      // Add user message (include attachment names for display) — skip if hidden
      if (!isHidden) {
        const userMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: displayContent,
          timestamp: new Date(),
          ...(attachmentNames?.length ? { attachmentNames } : {}),
        };
        setMessages((prev) => [...prev, userMessage]);
      }

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
      /** Local trace buffer scoped to this sendMessage call — avoids cross-message corruption. */
      const streamTraceEvents: TraceEvent[] = [];

      try {
        const bodyPayload: Record<string, unknown> = {
          message:
            message.trim() || (fileIds?.length ? "Attached file(s)." : ""),
          sessionId,
          ...(fileIds?.length ? { fileIds } : {}),
          ...(scopeIndexId ? { indexId: scopeIndexId } : {}),
          ...(options?.prefillMessages?.length ? { prefillMessages: options.prefillMessages } : {}),
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
                  case "iteration_start": {
                    const iterTraceEvent: TraceEvent = {
                      type: "iteration_start",
                      timestamp: Date.now(),
                      iteration: event.iteration,
                    };
                    streamTraceEvents.push(iterTraceEvent);
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || []), iterTraceEvent];
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  }
                  case "llm_start": {
                    const llmStartEvent: TraceEvent = {
                      type: "llm_start",
                      timestamp: Date.now(),
                      iteration: event.iteration,
                    };
                    streamTraceEvents.push(llmStartEvent);
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || []), llmStartEvent];
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  }
                  case "token":
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: msg.content + event.content }
                          : msg,
                      ),
                    );
                    break;
                  case "response_reset":
                    // Discard all previously streamed tokens — the agent detected
                    // hallucinated code blocks and is forcing a correction iteration.
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: "" }
                          : msg,
                      ),
                    );
                    break;
                  case "hallucination_detected": {
                    const hallucinationEvent: TraceEvent = {
                      type: "hallucination_detected",
                      timestamp: Date.now(),
                      name: event.tool,
                      summary: event.blockType,
                    };
                    streamTraceEvents.push(hallucinationEvent);
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || []), hallucinationEvent];
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  }
                  case "llm_end": {
                    const llmEndEvent: TraceEvent = {
                      type: "llm_end",
                      timestamp: Date.now(),
                      iteration: event.iteration,
                      hasToolCalls: event.hasToolCalls,
                      toolNames: event.toolNames,
                    };
                    streamTraceEvents.push(llmEndEvent);
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || []), llmEndEvent];
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  }
                  case "tool_activity": {
                    const now = Date.now();
                    const toolTraceEvent: TraceEvent = event.phase === "start"
                      ? {
                          type: "tool_start",
                          timestamp: now,
                          name: event.toolName,
                          status: "running",
                        }
                      : {
                          type: "tool_end",
                          timestamp: now,
                          name: event.toolName,
                          status: event.success === true ? "success" : event.success === false ? "error" : undefined,
                          summary: event.summary,
                          steps: event.steps,
                        };
                    streamTraceEvents.push(toolTraceEvent);
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || []), toolTraceEvent];
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  }
                  case "graph_start": {
                    const graphStartEvent: TraceEvent = {
                      type: "graph_start",
                      timestamp: Date.now(),
                      name: event.graphName,
                    };
                    streamTraceEvents.push(graphStartEvent);
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || []), graphStartEvent];
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  }
                  case "graph_end": {
                    const graphEndEvent: TraceEvent = {
                      type: "graph_end",
                      timestamp: Date.now(),
                      name: event.graphName,
                      durationMs: event.durationMs,
                    };
                    streamTraceEvents.push(graphEndEvent);
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || []), graphEndEvent];
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  }
                  case "agent_start": {
                    const agentStartEvent: TraceEvent = {
                      type: "agent_start",
                      timestamp: Date.now(),
                      name: event.agentName,
                    };
                    streamTraceEvents.push(agentStartEvent);
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || []), agentStartEvent];
                        return { ...msg, traceEvents };
                      }),
                    );
                    break;
                  }
                  case "agent_end": {
                    const agentEndEvent: TraceEvent = {
                      type: "agent_end",
                      timestamp: Date.now(),
                      name: event.agentName,
                      durationMs: event.durationMs,
                      summary: event.summary,
                    };
                    streamTraceEvents.push(agentEndEvent);
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const traceEvents = [...(msg.traceEvents || []), agentEndEvent];
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
                    // Persist trace events for this message (non-blocking)
                    {
                      const serverMessageId = event.messageId as
                        | string
                        | undefined;
                      if (serverMessageId && streamTraceEvents.length > 0) {
                        apiClient
                          .post(
                            `/chat/message/${serverMessageId}/metadata`,
                            { traceEvents: streamTraceEvents },
                          )
                          .catch(() => {
                            // Non-critical — trace persistence failure shouldn't break the chat
                          });
                      }
                    }
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
          const stoppedAt = Date.now();
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    isStreaming: false,
                    wasStoppedByUser: true,
                    stoppedAt,
                  }
                : msg,
            ),
          );
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
        // Ensure isStreaming is always cleared when the stream ends
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, isStreaming: false }
              : msg,
          ),
        );
      }
    },
    [sessionId, scopeIndexId, refetchSessions],
  );

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const clearChat = useCallback((options?: { abortStream?: boolean }) => {
    const abortStream = options?.abortStream !== false;
    if (!abortStream) {
      skipSessionUpdateForRequestRef.current = true;
      setIsLoading(false); // Stop showing loading on home while stream continues in background
    }
    setMessages([]);
    setSuggestions([]);
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
          traceEvents?: TraceEvent[];
          debugMeta?: {
            tools?: Array<{
              name: string;
              steps?: ToolCallStep[];
              graphs?: Array<{
                name: string;
                durationMs?: number;
                agents?: Array<{ name: string; durationMs?: number }>;
              }>;
            }>;
          } | null;
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
          traceEvents: mergeDebugMetaIntoTraceEvents(m.traceEvents, m.debugMeta) ?? undefined,
        })),
      );
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
        isLoading,
        stopStream,
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
