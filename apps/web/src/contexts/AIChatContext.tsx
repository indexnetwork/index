import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { useLocation } from "react-router";
import { useAIChatSessions } from "@/contexts/AIChatSessionsContext";
import { apiClient } from "@/lib/api";
import type { Suggestion } from "@/hooks/useSuggestions";
import type { Question } from "@/components/DecisionQuestions/types";
import type { PendingQuestion } from "@/services/questions";
import { log } from "@/lib/logger";

const logger = log.context.from("AIChatContext");

export interface DiscoveryOpportunity {
  candidateId: string;
  candidateName?: string;
  candidateAvatar?: string;
  score: number;
  sourceDescription: string;
}

/**
 * A draft opportunity delivered progressively during an orchestrator-driven
 * chat discovery run. Populated by the `opportunity_draft_ready` stream
 * event from the backend — one per accepted negotiation outcome — so the
 * chat UI can render cards as they settle rather than waiting for the whole
 * discovery fan-out to complete.
 *
 * `opportunity` mirrors the backend's Opportunity row; `counterparty`
 * carries the minimum the card needs to render without a second-round-trip
 * user lookup (name only — avatar falls back to initials).
 */
export interface StreamingDraft {
  opportunityId: string;
  opportunity: {
    id: string;
    status: string;
    interpretation?: { reasoning?: string };
    actors?: Array<{ userId: string; role?: string }>;
  };
  personalizedSummary?: string;
  counterparty: {
    userId: string;
    name?: string;
  };
  receivedAt: number;
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
  | "phase_start"
  | "phase_end"
  | "agent_start"
  | "agent_end"
  | "negotiation_session_start"
  | "negotiation_session_end"
  | "negotiation_turn"
  | "negotiation_outcome";

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
  // Negotiation event fields
  opportunityId?: string;
  negotiationConversationId?: string;
  sourceUserId?: string;
  candidateUserId?: string;
  candidateName?: string;
  trigger?: "orchestrator" | "ambient";
  startedAt?: number;
  turnIndex?: number;
  actor?: "source" | "candidate";
  action?: "propose" | "accept" | "reject" | "counter" | "question" | "outreach" | "withdraw" | "decline" | "ask_user";
  reasoning?: string;
  message?: string;
  suggestedRoles?: { ownUser?: string; otherUser?: string };
  outcome?: "accepted" | "rejected_stalled" | "waiting_for_agent" | "timed_out" | "turn_cap" | "screened_out";
  turnCount?: number;
  agreedRoles?: { ownUser?: string; otherUser?: string };
}

export type ChatTransport = "compatibility" | "web" | "onboarding";

export interface QueuedMessage {
  id: string;
  message: string;
  fileIds?: string[];
  attachmentNames?: string[];
  status: "pending" | "queued";
  /** Transport owned by the originating turn; queue drains must preserve it. */
  transport: ChatTransport;
}

export interface ChatSendOptions {
  hidden?: boolean;
  prefillMessages?: Array<{ role: "assistant" | "user"; content: string }>;
  persona?: "signal" | "reporter";
  /** @deprecated Product surfaces should use their dedicated send helper. */
  surface?: "web" | "onboarding";
  existingMessageId?: string;
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
  /**
   * Drafts streamed in via the orchestrator's opportunity_draft_ready events.
   * Appended progressively during the stream; persists on the message so
   * cards stay visible after the stream ends.
   */
  streamingDrafts?: StreamingDraft[];
  traceEvents?: TraceEvent[];
  /** Decision questions to render below this assistant message (orchestrator path). */
  decisionQuestions?: Question[];
  /** True once the user has submitted answers; disables/mutes the renderer. */
  decisionQuestionsSubmitted?: boolean;
  isPending?: boolean;
  isQueued?: boolean;
  wasInterrupted?: boolean;
}

export type ChatScope =
  | { type: "network"; id: string; label?: string }
  | { type: "intent"; id: string; label?: string }
  | null;

export type ChatTurnBlock = {
  code: string;
  message: string;
  action?: { type: "start_signal_session"; href: "/" };
};

export type ChatSessionLoadState =
  | { status: "idle"; targetSessionId: null; error: null }
  | { status: "loading"; targetSessionId: string; error: null }
  | { status: "ready"; targetSessionId: string; error: null }
  | { status: "error"; targetSessionId: string; error: string };

interface AIChatContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  messages: ChatMessage[];
  sessionId: string | null;
  sessionTitle: string | null;
  /** Persona driving the loaded session's agent loop (e.g. 'negotiator'). Null until a session is loaded. */
  sessionPersona: string | null;
  setSessionId: (id: string | null) => void;
  /** The network bound to the current session (persisted). Null if no network scope. */
  sessionNetworkId: string | null;
  /** Effective mutually-exclusive chat scope. Intent scope and network scope are never active together. */
  chatScope: ChatScope;
  /** Set the active chat scope. Call with null for "Everywhere". */
  setChatScope: (scope: ChatScope) => void;
  /** When the user has selected a single network (e.g. in chat dropdown), chat and create_intent are scoped to that network. */
  scopeNetworkId: string | null;
  /** Set the current network scope (e.g. from the network filter dropdown in ChatContent). Call with null for "Everywhere". */
  setScopeNetworkId: (networkId: string | null) => void;
  /** Resolve or create the stable persona session for an intent scope. */
  resolveIntentSession: (
    intent: { id: string; label?: string },
    persona?: "signal" | "reporter",
  ) => Promise<string | null>;
  /** Context-aware suggestions from the last done event; empty when no messages or after clear/load. */
  suggestions: Suggestion[];
  isLoading: boolean;
  /** Typed pre-stream refusal, used to offer a safe continuation action. */
  turnBlock: ChatTurnBlock | null;
  /** Abort the in-progress agent response stream. */
  stopStream: () => void;
  sendMessage: (
    message: string,
    fileIds?: string[],
    attachmentNames?: string[],
    options?: ChatSendOptions,
  ) => Promise<void>;
  /** Main-web transport. Queued and steered continuations inherit this route. */
  sendWebMessage: (
    message: string,
    fileIds?: string[],
    attachmentNames?: string[],
    options?: Omit<ChatSendOptions, "surface">,
  ) => Promise<void>;
  /** Incomplete-user onboarding transport; server-clamped to orchestrator. */
  sendOnboardingMessage: (
    message: string,
    fileIds?: string[],
    attachmentNames?: string[],
    options?: Omit<ChatSendOptions, "surface" | "persona">,
  ) => Promise<void>;
  /** Clear messages and session state. Detached route cleanup may preserve a one-shot forced persona. */
  clearChat: (options?: { abortStream?: boolean; preserveForcedPersona?: boolean }) => void;
  /** Clear the current chat and force the next new web session to request Signal. */
  startSignalSession: () => void;
  /** Start a fresh main-web reporter session. */
  startReporterSession: () => void;
  /** Load a session, returning false for failed or superseded requests. */
  loadSession: (sessionId: string) => Promise<boolean>;
  /** Observable target-specific load state for disabling route interactions until ready. */
  sessionLoadState: ChatSessionLoadState;
  isSessionReady: (sessionId: string) => boolean;
  updateSessionTitle: (sessionId: string, title: string) => Promise<boolean>;
  pendingQueue: QueuedMessage[];
  cancelQueuedMessage: (id: string) => void;
  submitMidStreamMessage: (message: string, traceEvents: TraceEvent[], fileIds?: string[], attachmentNames?: string[]) => void;
  /**
   * Questions streamed live by a chat persona's ask_user_question tool
   * (`user_question` SSE event). The turn is blocked server-side until they
   * are answered/dismissed or the wait times out. ChatContent and guided
   * Signal intake surfaces consume these from the same stream state.
   */
  liveQuestions: PendingQuestion[];
}

const AIChatContext = createContext<AIChatContextType | null>(null);

/** Extract network ID from pathname when on /index/[networkId] (fallback when no dropdown selection). */
function getScopeNetworkIdFromPathname(pathname: string | null): string | null {
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

const SAFE_TURN_BLOCK_MESSAGES: Readonly<Record<string, string>> = {
  WEB_SIGNAL_PERSONA_REQUIRED: "Start a new Signal Agent chat to continue.",
  WEB_SIGNAL_SESSION_REQUIRED: "This earlier chat is read-only. Start a new Signal Agent chat to continue.",
  WEB_SIGNAL_AGENT_DISABLED: "Signal Agent is not available right now.",
  WEB_SIGNAL_PERSONA_FORBIDDEN: "This chat can only be continued in the web app.",
  CHAT_PERSONA_MISMATCH: "This request does not match the chat that was opened.",
  CHAT_PERSONA_UNSUPPORTED: "This chat cannot be continued safely.",
  CHAT_SCOPE_REQUIRES_NEW_SESSION: "Start a separate Signal Agent chat for that focus.",
};

/** Parse only known policy denials and never render server-controlled detail text. */
function parseTurnBlock(value: unknown): ChatTurnBlock | null {
  if (!value || typeof value !== "object") return null;
  const failure = value as { code?: unknown; action?: { type?: unknown; href?: unknown } };
  if (typeof failure.code !== "string") return null;
  const message = SAFE_TURN_BLOCK_MESSAGES[failure.code];
  if (!message) return null;

  const actionAllowedForCode = failure.code === "WEB_SIGNAL_PERSONA_REQUIRED"
    || failure.code === "WEB_SIGNAL_SESSION_REQUIRED";
  const hasSafeAction = actionAllowedForCode
    && failure.action?.type === "start_signal_session"
    && failure.action.href === "/";
  return {
    code: failure.code,
    message,
    ...(hasSafeAction
      ? { action: { type: "start_signal_session" as const, href: "/" as const } }
      : {}),
  };
}

export function AIChatProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [scopeOverride, setScopeOverride] = useState<ChatScope>(null);
  const pathNetworkScopeId = getScopeNetworkIdFromPathname(pathname);
  const scopeFromPath: ChatScope = pathNetworkScopeId
    ? { type: "network", id: pathNetworkScopeId }
    : null;
  // For existing sessions, the session's bound scope takes precedence over UI/path selection.
  const [sessionScope, setSessionScope] = useState<ChatScope>(null);
  // Backward-compatible network alias for existing consumers.
  const [sessionNetworkId, setSessionNetworkId] = useState<string | null>(null);
  // Effective scope: session-bound scope takes precedence, then UI override, then path.
  const chatScope = sessionScope ?? scopeOverride ?? scopeFromPath;
  const scopeNetworkId = chatScope?.type === "network" ? chatScope.id : null;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [sessionPersona, setSessionPersona] = useState<string | null>(null);
  const [turnBlock, setTurnBlock] = useState<ChatTurnBlock | null>(null);
  const forcePersonaNextSessionRef = useRef<"signal" | "reporter" | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionLoadState, setSessionLoadState] = useState<ChatSessionLoadState>({
    status: "idle",
    targetSessionId: null,
    error: null,
  });
  const { refetchSessions } = useAIChatSessions();
  const pendingQueueRef = useRef<QueuedMessage[]>([]);
  const steerPendingRef = useRef<Array<{
    id: string;
    message: string;
    fileIds?: string[];
    attachmentNames?: string[];
    transport: ChatTransport;
  }>>([]);
  /** Per-message timeout IDs so cancelling or resolving one pending message doesn't affect others. */
  const interruptTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** Messages submitted while the first web stream is creating its session. */
  const preSessionQueueRef = useRef<QueuedMessage[]>([]);
  const [pendingQueue, setPendingQueue] = useState<QueuedMessage[]>([]);
  /** Live questions from any chat persona's ask_user_question tool (user_question SSE event). */
  const [liveQuestions, setLiveQuestions] = useState<PendingQuestion[]>([]);
  type SendAbortReason = "clear" | "load" | "steer" | "stopped" | "superseded" | "unmount";
  type SendOperation = {
    token: symbol;
    controller: AbortController;
    transport: ChatTransport;
    abortReason?: SendAbortReason;
    refreshSidebarWhenStale: boolean;
  };
  /** One owner token covers sends and loads so stale work cannot commit across either boundary. */
  const operationOwnerRef = useRef<symbol | null>(null);
  /** Independent latest-owner token for intent-session resolution requests. */
  const intentResolutionOwnerRef = useRef<symbol | null>(null);
  const activeSendRef = useRef<SendOperation | null>(null);

  const ownsOperation = useCallback((token: symbol) => operationOwnerRef.current === token, []);

  const invalidateActiveSend = useCallback((reason: SendAbortReason, abort = true) => {
    const active = activeSendRef.current;
    if (!active) return;
    active.abortReason = reason;
    if (abort && !active.controller.signal.aborted) active.controller.abort();
    if (activeSendRef.current === active) activeSendRef.current = null;
  }, []);

  React.useEffect(() => () => {
    operationOwnerRef.current = null;
    intentResolutionOwnerRef.current = null;
    invalidateActiveSend("unmount");
    interruptTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    interruptTimeoutsRef.current.clear();
  }, [invalidateActiveSend]);

  const setChatScope = useCallback((scope: ChatScope) => {
    setScopeOverride(scope);
  }, []);

  const setScopeNetworkId = useCallback((networkId: string | null) => {
    setScopeOverride(networkId ? { type: "network", id: networkId } : null);
  }, []);

  const resolveIntentSession = useCallback(async (
    intent: { id: string; label?: string },
    persona?: "signal" | "reporter",
  ): Promise<string | null> => {
    const resolutionToken = Symbol(`resolve-intent-session:${intent.id}`);
    intentResolutionOwnerRef.current = resolutionToken;
    try {
      const response = await apiClient.post<{
        session: { id: string; scopeType?: "intent" | "network" | null; scopeId?: string | null };
      }>(persona ? "/chat/web/session/resolve" : "/chat/session/resolve", {
        scopeType: "intent",
        scopeId: intent.id,
        ...(persona ? { persona } : {}),
      });
      if (intentResolutionOwnerRef.current !== resolutionToken) return null;
      setScopeOverride({ type: "intent", id: intent.id, ...(intent.label ? { label: intent.label } : {}) });
      intentResolutionOwnerRef.current = null;
      return response.session.id;
    } catch (error) {
      if (intentResolutionOwnerRef.current !== resolutionToken) return null;
      intentResolutionOwnerRef.current = null;
      throw error;
    }
  }, []);

  const cancelQueuedMessage = useCallback((id: string) => {
    const t = interruptTimeoutsRef.current.get(id);
    if (t !== undefined) { clearTimeout(t); interruptTimeoutsRef.current.delete(id); }
    pendingQueueRef.current = pendingQueueRef.current.filter((q) => q.id !== id);
    preSessionQueueRef.current = preSessionQueueRef.current.filter((q) => q.id !== id);
    setPendingQueue([...pendingQueueRef.current]);
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  }, []);

  const submitMidStreamMessage = useCallback(
    (message: string, traceEvents: TraceEvent[], fileIds?: string[], attachmentNames?: string[]) => {
      const pendingMsgId = crypto.randomUUID();
      const displayContent = message.trim() || (fileIds?.length ? "Attached file(s)." : "");
      if (!displayContent) return;

      const originatingOperation = activeSendRef.current;
      const transport = originatingOperation?.transport ?? "compatibility";
      const entry: QueuedMessage = {
        id: pendingMsgId,
        message,
        fileIds,
        attachmentNames,
        status: "pending",
        transport,
      };
      setMessages((prev) => [...prev, {
        id: pendingMsgId, role: "user" as const, content: displayContent,
        timestamp: new Date(), isPending: true,
        ...(attachmentNames?.length ? { attachmentNames } : {}),
      }]);

      // A new session has no id until the first stream receives its response
      // headers. Keep submissions made during that window instead of dropping
      // them (the reporter briefing hits this path).
      if (!sessionId) {
        preSessionQueueRef.current = [...preSessionQueueRef.current, entry];
        return;
      }

      pendingQueueRef.current = [...pendingQueueRef.current, entry];
      setPendingQueue([...pendingQueueRef.current]);

      const agentStateNames = traceEvents
        .filter((e) => ["tool_start", "graph_start", "agent_start", "phase_start"].includes(e.type))
        .slice(-5)
        .map((e) => `${e.type}: ${(e as { name?: string }).name ?? "unknown"}`);

      const steer = () => {
        if (
          !originatingOperation
          || !ownsOperation(originatingOperation.token)
          || activeSendRef.current !== originatingOperation
        ) {
          // The originating request lost ownership. Keep this entry queued for
          // the current session, but never let its timeout abort a newer send.
          pendingQueueRef.current = pendingQueueRef.current.map((entry) =>
            entry.id === pendingMsgId ? { ...entry, status: "queued" } : entry,
          );
          setPendingQueue([...pendingQueueRef.current]);
          setMessages((prev) => prev.map((msg) =>
            msg.id === pendingMsgId ? { ...msg, isPending: false, isQueued: true } : msg,
          ));
          return;
        }
        steerPendingRef.current = [...steerPendingRef.current, {
          id: pendingMsgId,
          message,
          fileIds,
          attachmentNames,
          transport,
        }];
        pendingQueueRef.current = pendingQueueRef.current.filter((q) => q.id !== pendingMsgId);
        setPendingQueue([...pendingQueueRef.current]);
        setMessages((prev) => prev.map((msg) =>
          msg.id === pendingMsgId ? { ...msg, isPending: false } : msg,
        ));
        const active = activeSendRef.current;
        if (active) {
          active.abortReason = "steer";
          active.controller.abort();
        }
      };

      // 5-second fallback → steer (in case SSE steer_or_queue event never arrives)
      const timeoutId = setTimeout(() => {
        interruptTimeoutsRef.current.delete(pendingMsgId);
        steer();
      }, 5_000);
      interruptTimeoutsRef.current.set(pendingMsgId, timeoutId);

      apiClient
        .post("/chat/interrupt", { sessionId, message, messageId: pendingMsgId, traceSnapshot: agentStateNames })
        .catch(() => {
          clearTimeout(timeoutId);
          interruptTimeoutsRef.current.delete(pendingMsgId);
          // The message may have been cancelled before the POST failed.
          if (!pendingQueueRef.current.some((q) => q.id === pendingMsgId)) return;
          steer();
        });
    },
    [ownsOperation, sessionId],
  );

  const sendMessageWithTransport = useCallback(
    async (
      transport: ChatTransport,
      message: string,
      fileIds?: string[],
      attachmentNames?: string[],
      options?: ChatSendOptions,
    ) => {
      const displayContent =
        message.trim() || (fileIds?.length ? "Attached file(s)." : "");
      if (!displayContent) return;

      const requestedPersona = options?.persona
        ?? (!sessionId ? forcePersonaNextSessionRef.current ?? undefined : undefined);
      const effectiveTransport: ChatTransport = transport === "onboarding"
        ? "onboarding"
        : transport === "web"
          || requestedPersona === "signal"
          || requestedPersona === "reporter"
          || sessionPersona === "signal"
          || sessionPersona === "reporter"
          ? "web"
          : "compatibility";

      invalidateActiveSend("superseded");
      intentResolutionOwnerRef.current = null;
      const operation: SendOperation = {
        token: Symbol("chat-send"),
        controller: new AbortController(),
        transport: effectiveTransport,
        refreshSidebarWhenStale: false,
      };
      operationOwnerRef.current = operation.token;
      activeSendRef.current = operation;
      setSessionLoadState((current) => current.status === "loading"
        ? { status: "idle", targetSessionId: null, error: null }
        : current);

      const isHidden = options?.hidden ?? false;

      // Add user message (include attachment names for display) — skip if hidden
      let optimisticUserMessageId: string | undefined;
      if (!isHidden) {
        optimisticUserMessageId = crypto.randomUUID();
        const userMessage: ChatMessage = {
          id: optimisticUserMessageId,
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
      /** Local trace buffer scoped to this sendMessage call — avoids cross-message corruption. */
      const streamTraceEvents: TraceEvent[] = [];
      /** Push a trace event to the local buffer and append it to the assistant message. */
      const appendTrace = (ev: TraceEvent) => {
        if (!ownsOperation(operation.token)) return;
        streamTraceEvents.push(ev);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id !== assistantMessageId
              ? msg
              : { ...msg, traceEvents: [...(msg.traceEvents || []), ev] },
          ),
        );
      };
      /**
       * Local streaming-draft buffer scoped to this sendMessage call. Flushed
       * to the server on `done` so cards survive session reload.
       */
      const streamingDraftsBuffer: StreamingDraft[] = [];

      try {
        const bodyPayload: Record<string, unknown> = {
          message:
            message.trim() || (fileIds?.length ? "Attached file(s)." : ""),
          sessionId,
          ...(fileIds?.length ? { fileIds } : {}),
          ...(chatScope ? { scopeType: chatScope.type, scopeId: chatScope.id } : {}),
          ...(options?.prefillMessages?.length ? { prefillMessages: options.prefillMessages } : {}),
          ...(requestedPersona ? { persona: requestedPersona } : {}),
        };

        const streamEndpoint = effectiveTransport === "web"
          ? "/chat/web/stream"
          : effectiveTransport === "onboarding"
            ? "/chat/onboarding/stream"
            : "/chat/stream";
        const response = await apiClient.stream(streamEndpoint, bodyPayload, {
          signal: operation.controller.signal,
        });

        const responseSessionId = response.headers.get("X-Session-Id");
        if (!ownsOperation(operation.token)) {
          // A deliberately detached stream may only make its completed session visible in the sidebar.
          if (response.ok && responseSessionId && operation.refreshSidebarWhenStale) {
            refetchSessions();
          }
          return;
        }

        if (!response.ok) {
          const failure = await response.json().catch(() => null);
          if (!ownsOperation(operation.token)) return;
          const parsedBlock = parseTurnBlock(failure);
          if (parsedBlock) {
            setTurnBlock(parsedBlock);
            setMessages((prev) => prev.filter((item) =>
              item.id !== assistantMessageId
              && item.id !== optimisticUserMessageId
              && item.id !== options?.existingMessageId
            ));
            return;
          }
          throw new Error(`Chat request failed (${response.status})`);
        }

        setTurnBlock(null);
        // Get authoritative session identity from response headers.
        const newSessionId = responseSessionId;
        const responsePersona = response.headers.get("X-Chat-Persona");
        if (responsePersona) setSessionPersona(responsePersona);
        if (newSessionId && !sessionId) {
          setSessionId(newSessionId);
          // The newly-created session is already the current in-memory target;
          // mark it route-ready so the ensuing /d/:id navigation never reloads
          // or briefly replaces it with a loading shell.
          setSessionLoadState({ status: "ready", targetSessionId: newSessionId, error: null });
          forcePersonaNextSessionRef.current = null;
          // The scope selected at session creation becomes the session's bound scope.
          if (chatScope) {
            setSessionScope(chatScope);
            setSessionNetworkId(chatScope.type === "network" ? chatScope.id : null);
          }
          refetchSessions();
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (!ownsOperation(operation.token)) return;
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                if (!ownsOperation(operation.token)) return;

                switch (event.type) {
                  case "iteration_start": {
                    appendTrace({
                      type: "iteration_start",
                      timestamp: Date.now(),
                      iteration: event.iteration,
                    });
                    break;
                  }
                  case "llm_start": {
                    appendTrace({
                      type: "llm_start",
                      timestamp: Date.now(),
                      iteration: event.iteration,
                    });
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
                    appendTrace({
                      type: "hallucination_detected",
                      timestamp: Date.now(),
                      name: event.tool,
                      summary: event.blockType,
                    });
                    break;
                  }
                  case "llm_end": {
                    appendTrace({
                      type: "llm_end",
                      timestamp: Date.now(),
                      iteration: event.iteration,
                      hasToolCalls: event.hasToolCalls,
                      toolNames: event.toolNames,
                    });
                    break;
                  }
                  case "tool_activity": {
                    const now = Date.now();
                    appendTrace(event.phase === "start"
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
                        });
                    break;
                  }
                  case "graph_start": {
                    appendTrace({
                      type: "graph_start",
                      timestamp: Date.now(),
                      name: event.graphName,
                    });
                    break;
                  }
                  case "graph_end": {
                    appendTrace({
                      type: "graph_end",
                      timestamp: Date.now(),
                      name: event.graphName,
                      durationMs: event.durationMs,
                    });
                    break;
                  }
                  case "phase_start": {
                    appendTrace({
                      type: "phase_start",
                      timestamp: Date.now(),
                      name: (event as { phaseName?: string }).phaseName,
                    });
                    break;
                  }
                  case "phase_end": {
                    appendTrace({
                      type: "phase_end",
                      timestamp: Date.now(),
                      name: (event as { phaseName?: string }).phaseName,
                      durationMs: (event as { durationMs?: number }).durationMs,
                    });
                    break;
                  }
                  case "agent_start": {
                    appendTrace({
                      type: "agent_start",
                      timestamp: Date.now(),
                      name: event.agentName,
                    });
                    break;
                  }
                  case "agent_end": {
                    appendTrace({
                      type: "agent_end",
                      timestamp: Date.now(),
                      name: event.agentName,
                      durationMs: event.durationMs,
                      summary: event.summary,
                    });
                    break;
                  }
                  case "negotiation_summarizer_start": {
                    const count = typeof (event as { count?: number }).count === "number"
                      ? (event as { count: number }).count
                      : 0;
                    appendTrace({
                      type: "agent_start",
                      timestamp: Date.now(),
                      name: `Negotiation summary (${count})`,
                    });
                    break;
                  }
                  case "negotiation_summarizer_end": {
                    const count = typeof (event as { count?: number }).count === "number"
                      ? (event as { count: number }).count
                      : 0;
                    const durationMs = typeof (event as { durationMs?: number }).durationMs === "number"
                      ? (event as { durationMs: number }).durationMs
                      : undefined;
                    appendTrace({
                      type: "agent_end",
                      timestamp: Date.now(),
                      name: `Negotiation summary (${count})`,
                      durationMs,
                      summary: `${count} digest${count === 1 ? "" : "s"}`,
                    });
                    break;
                  }
                  case "chat_summarizer_start": {
                    appendTrace({
                      type: "agent_start",
                      timestamp: Date.now(),
                      name: "Chat summary",
                    });
                    break;
                  }
                  case "chat_summarizer_end": {
                    appendTrace({
                      type: "agent_end",
                      timestamp: Date.now(),
                      name: "Chat summary",
                      durationMs:
                        (event as { payload?: { durationMs?: number } }).payload?.durationMs ??
                        event.durationMs,
                    });
                    break;
                  }
                  case "question_generator_start": {
                    appendTrace({
                      type: "agent_start",
                      timestamp: Date.now(),
                      name: "Decision questions",
                    });
                    break;
                  }
                  case "question_generator_end": {
                    const payload = (event as { payload?: { finalCount?: number; durationMs?: number } }).payload;
                    const finalCount = payload?.finalCount ?? 0;
                    appendTrace({
                      type: "agent_end",
                      timestamp: Date.now(),
                      name: "Decision questions",
                      durationMs: payload?.durationMs ?? event.durationMs,
                      summary: `${finalCount} question${finalCount === 1 ? "" : "s"}`,
                    });
                    break;
                  }
                  case "negotiation_session_start": {
                    appendTrace({
                      type: "negotiation_session_start",
                      timestamp: Date.now(),
                      opportunityId: event.opportunityId,
                      negotiationConversationId: event.negotiationConversationId,
                      sourceUserId: event.sourceUserId,
                      candidateUserId: event.candidateUserId,
                      candidateName: event.candidateName,
                      trigger: event.trigger,
                      startedAt: event.startedAt,
                    });
                    break;
                  }
                  case "negotiation_turn": {
                    appendTrace({
                      type: "negotiation_turn",
                      timestamp: Date.now(),
                      opportunityId: event.opportunityId,
                      negotiationConversationId: event.negotiationConversationId,
                      turnIndex: event.turnIndex,
                      actor: event.actor,
                      action: event.action,
                      reasoning: event.reasoning,
                      message: event.message,
                      suggestedRoles: event.suggestedRoles,
                      durationMs: event.durationMs,
                    });
                    break;
                  }
                  case "negotiation_outcome": {
                    appendTrace({
                      type: "negotiation_outcome",
                      timestamp: Date.now(),
                      opportunityId: event.opportunityId,
                      negotiationConversationId: event.negotiationConversationId,
                      outcome: event.outcome,
                      turnCount: event.turnCount,
                      reasoning: event.reasoning,
                      agreedRoles: event.agreedRoles,
                    });
                    break;
                  }
                  case "negotiation_session_end": {
                    appendTrace({
                      type: "negotiation_session_end",
                      timestamp: Date.now(),
                      opportunityId: event.opportunityId,
                      negotiationConversationId: event.negotiationConversationId,
                      durationMs: event.durationMs,
                    });
                    break;
                  }
                  case "opportunity_draft_ready": {
                    // Plan B Task 9: orchestrator-triggered negotiations
                    // stream accepted drafts back one at a time so the UI
                    // can render cards progressively. Append to the
                    // message's streamingDrafts list; the message-list
                    // component renders them inline alongside the LLM text.
                    // The buffer is flushed to message metadata on `done`
                    // so cards survive session reload.
                    const draft: StreamingDraft = {
                      opportunityId: event.opportunityId,
                      opportunity: event.opportunity,
                      personalizedSummary: event.personalizedSummary,
                      counterparty: event.counterparty,
                      receivedAt: Date.now(),
                    };
                    streamingDraftsBuffer.push(draft);
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const streamingDrafts = [...(msg.streamingDrafts || []), draft];
                        return { ...msg, streamingDrafts };
                      }),
                    );
                    break;
                  }
                  case "steer_or_queue": {
                    const t = interruptTimeoutsRef.current.get((event as { messageId: string }).messageId ?? '');
                    if (t !== undefined) { clearTimeout(t); interruptTimeoutsRef.current.delete((event as { messageId: string }).messageId); }
                    const { decision, messageId: pendingId } = event as { decision: 'steer' | 'queue'; messageId: string };
                    if (decision === 'steer') {
                      const steerEntry = pendingQueueRef.current.find((q) => q.id === pendingId);
                      // Only act if the message is still tracked — it may have been cancelled
                      // or drained already, in which case we must not abort the current stream.
                      if (steerEntry) {
                        steerPendingRef.current = [...steerPendingRef.current, {
                          id: steerEntry.id,
                          message: steerEntry.message,
                          fileIds: steerEntry.fileIds,
                          attachmentNames: steerEntry.attachmentNames,
                          transport: steerEntry.transport,
                        }];
                        pendingQueueRef.current = pendingQueueRef.current.filter((q) => q.id !== pendingId);
                        setPendingQueue([...pendingQueueRef.current]);
                        setMessages((prev) => prev.map((msg) => msg.id === pendingId ? { ...msg, isPending: false, isQueued: false } : msg));
                        operation.abortReason = "steer";
                        operation.controller.abort();
                      }
                    } else {
                      // Only act if the message is still tracked — the 5s fallback may have
                      // already fired and moved it to steerPendingRef before this SSE arrived.
                      const queueEntry = pendingQueueRef.current.find((q) => q.id === pendingId);
                      if (queueEntry) {
                        pendingQueueRef.current = pendingQueueRef.current.map((q) =>
                          q.id === pendingId ? { ...q, status: 'queued' as const } : q,
                        );
                        setPendingQueue([...pendingQueueRef.current]);
                        setMessages((prev) => prev.map((msg) =>
                          msg.id === pendingId ? { ...msg, isPending: false, isQueued: true } : msg,
                        ));
                      }
                    }
                    break;
                  }
                  case "user_question": {
                    // The orchestrator persisted chat-mode questions and is now
                    // blocking the turn on them. Shape them like the REST
                    // PendingQuestion so ChatContent can reuse InjectedQuestions.
                    const eventSessionId =
                      (typeof event.sessionId === "string" && event.sessionId) ||
                      newSessionId ||
                      sessionId ||
                      "";
                    const incoming: PendingQuestion[] = (event.questions ?? []).map(
                      (q: { id: string; title: string; prompt: string; options: Array<{ label: string; description: string }>; multiSelect: boolean }) => ({
                        id: q.id,
                        detection: {
                          mode: "chat" as const,
                          sourceType: "conversation",
                          sourceId: eventSessionId,
                          timestamp: new Date().toISOString(),
                        },
                        actors: [],
                        payload: {
                          title: q.title,
                          prompt: q.prompt,
                          options: q.options,
                          multiSelect: q.multiSelect,
                        },
                        status: "pending" as const,
                        answer: null,
                        expiresAt: null,
                        createdAt: new Date().toISOString(),
                        conversationId: eventSessionId || null,
                      }),
                    );
                    if (incoming.length > 0) {
                      setLiveQuestions((prev) => {
                        const byId = new Map(prev.map((q) => [q.id, q]));
                        for (const q of incoming) byId.set(q.id, q);
                        return [...byId.values()];
                      });
                    }
                    break;
                  }
                  case "decision_questions": {
                    const incoming = (event.questions ?? []) as Question[];
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const existing = msg.decisionQuestions ?? [];
                        return {
                          ...msg,
                          decisionQuestions: [...existing, ...incoming],
                        };
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
                        const fromDone = Array.isArray(event.decisionQuestions)
                          ? (event.decisionQuestions as Question[])
                          : undefined;
                        const decisionQuestions =
                          msg.decisionQuestions && msg.decisionQuestions.length > 0
                            ? msg.decisionQuestions
                            : fromDone;
                        return {
                          ...msg,
                          content: finalContent,
                          isStreaming: false,
                          ...(decisionQuestions ? { decisionQuestions } : {}),
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
                    // Persist trace events and streamed drafts for this
                    // message (non-blocking). One POST carries both payloads
                    // so rehydration on reload reproduces the full turn.
                    {
                      const serverMessageId = event.messageId as
                        | string
                        | undefined;
                      const hasTrace = streamTraceEvents.length > 0;
                      const hasDrafts = streamingDraftsBuffer.length > 0;
                      if (serverMessageId && (hasTrace || hasDrafts)) {
                        const payload: {
                          traceEvents?: TraceEvent[];
                          streamingDrafts?: StreamingDraft[];
                        } = {};
                        if (hasTrace) payload.traceEvents = streamTraceEvents;
                        if (hasDrafts) payload.streamingDrafts = streamingDraftsBuffer;
                        apiClient
                          .post(
                            `/chat/message/${serverMessageId}/metadata`,
                            payload,
                          )
                          .catch(() => {
                            // Non-critical — metadata persistence failure shouldn't break the chat
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
                              content: "Failed to get response. Please try again.",
                              isStreaming: false,
                            }
                          : msg,
                      ),
                    );
                    break;
                }
              } catch (e) {
                logger.error("Failed to parse SSE event", { error: e });
              }
            }
          }
        }
      } catch (error) {
        if (!ownsOperation(operation.token)) return;
        if (error instanceof Error && error.name === "AbortError") {
          const isSteerAbort = operation.abortReason === "steer";
          logger.debug(isSteerAbort ? "Chat stream interrupted by steer" : "Chat stream aborted");
          const stoppedAt = Date.now();
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    isStreaming: false,
                    ...(isSteerAbort
                      ? { wasInterrupted: true }
                      : { wasStoppedByUser: true, stoppedAt }),
                  }
                : msg,
            ),
          );
        } else {
          logger.error("Chat error", { error });
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
        if (ownsOperation(operation.token)) {
          operationOwnerRef.current = null;
          if (activeSendRef.current === operation) activeSendRef.current = null;
          setIsLoading(false);
          // Queue drain is handled by the useEffect below (watches isLoading transition to false).
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, isStreaming: false }
                : msg,
            ),
          );
        } else if (activeSendRef.current === operation) {
          // Local cleanup only; never clear a newer operation's controller or UI state.
          activeSendRef.current = null;
        }
      }
    },
    [chatScope, invalidateActiveSend, ownsOperation, refetchSessions, sessionId, sessionPersona],
  );

  const sendMessage = useCallback((
    message: string,
    fileIds?: string[],
    attachmentNames?: string[],
    options?: ChatSendOptions,
  ) => {
    const transport: ChatTransport = options?.surface === "onboarding"
      ? "onboarding"
      : options?.surface === "web"
        || options?.persona === "signal"
        || options?.persona === "reporter"
        || sessionPersona === "signal"
        || sessionPersona === "reporter"
        ? "web"
        : "compatibility";
    return sendMessageWithTransport(transport, message, fileIds, attachmentNames, options);
  }, [sendMessageWithTransport, sessionPersona]);

  const sendWebMessage = useCallback((
    message: string,
    fileIds?: string[],
    attachmentNames?: string[],
    options?: Omit<ChatSendOptions, "surface">,
  ) => sendMessageWithTransport("web", message, fileIds, attachmentNames, options), [sendMessageWithTransport]);

  const sendOnboardingMessage = useCallback((
    message: string,
    fileIds?: string[],
    attachmentNames?: string[],
    options?: Omit<ChatSendOptions, "surface" | "persona">,
  ) => sendMessageWithTransport("onboarding", message, fileIds, attachmentNames, options), [sendMessageWithTransport]);

  const stopStream = useCallback(() => {
    const active = activeSendRef.current;
    if (!active) return;
    active.abortReason = "stopped";
    active.controller.abort();
  }, []);

  // Drain pending messages whenever loading ends.
  // Pre-session messages are first so a new reporter chat cannot lose a user
  // submission while its hidden briefing creates the session.
  React.useEffect(() => {
    if (isLoading || turnBlock) return;
    if (preSessionQueueRef.current.length > 0 && sessionId) {
      const [nextMsg, ...rest] = preSessionQueueRef.current;
      preSessionQueueRef.current = rest;
      setMessages((prev) => prev.map((msg) =>
        msg.id === nextMsg.id ? { ...msg, isPending: false, isQueued: false } : msg,
      ));
      void sendMessageWithTransport(
        nextMsg.transport,
        nextMsg.message,
        nextMsg.fileIds,
        nextMsg.attachmentNames,
        { hidden: true, existingMessageId: nextMsg.id },
      );
    } else if (steerPendingRef.current.length > 0) {
      const [steerMsg, ...rest] = steerPendingRef.current;
      steerPendingRef.current = rest;
      // Preserve the originating transport so a web continuation cannot fall back.
      void sendMessageWithTransport(
        steerMsg.transport,
        steerMsg.message,
        steerMsg.fileIds,
        steerMsg.attachmentNames,
        { hidden: true, existingMessageId: steerMsg.id },
      );
    } else if (pendingQueueRef.current.length > 0) {
      const [nextMsg, ...rest] = pendingQueueRef.current;
      pendingQueueRef.current = rest;
      setPendingQueue(rest);
      // Cancel any live fallback timer for this message (may still be running if
      // the stream ended before the SSE decision arrived).
      const t = interruptTimeoutsRef.current.get(nextMsg.id);
      if (t !== undefined) { clearTimeout(t); interruptTimeoutsRef.current.delete(nextMsg.id); }
      // Reset both isPending and isQueued so the placeholder no longer shows "classifying…".
      setMessages((prev) =>
        prev.map((msg) => msg.id === nextMsg.id ? { ...msg, isPending: false, isQueued: false } : msg),
      );
      // Use hidden:true — the placeholder is the canonical user bubble.
      void sendMessageWithTransport(
        nextMsg.transport,
        nextMsg.message,
        nextMsg.fileIds,
        nextMsg.attachmentNames,
        { hidden: true, existingMessageId: nextMsg.id },
      );
    }
  }, [isLoading, sendMessageWithTransport, sessionId, turnBlock]);

  const clearChat = useCallback((options?: {
    abortStream?: boolean;
    preserveForcedPersona?: boolean;
  }) => {
    const abortStream = options?.abortStream !== false;
    const active = activeSendRef.current;
    operationOwnerRef.current = null;
    intentResolutionOwnerRef.current = null;
    if (active && !abortStream) {
      active.refreshSidebarWhenStale = true;
    } else {
      invalidateActiveSend("clear");
    }
    // Cancel all pending interrupt timers and reset queue refs so the drain
    // effect does not fire stale queued messages into the freshly-cleared chat.
    interruptTimeoutsRef.current.forEach((t) => clearTimeout(t));
    interruptTimeoutsRef.current.clear();
    pendingQueueRef.current = [];
    preSessionQueueRef.current = [];
    steerPendingRef.current = [];
    setPendingQueue([]);
    setIsLoading(false);
    setSessionLoadState({ status: "idle", targetSessionId: null, error: null });
    setMessages([]);
    setSuggestions([]);
    setLiveQuestions([]);
    setSessionId(null);
    setSessionTitle(null);
    setSessionPersona(null);
    if (!options?.preserveForcedPersona) {
      forcePersonaNextSessionRef.current = null;
    }
    setTurnBlock(null);
    setSessionScope(null); // Clear session-bound scope so new chat can use UI selection
    setSessionNetworkId(null); // Clear session-bound network so new chat can use UI selection
  }, [invalidateActiveSend]);

  const startSignalSession = useCallback(() => {
    clearChat();
    forcePersonaNextSessionRef.current = "signal";
  }, [clearChat]);

  const startReporterSession = useCallback(() => {
    clearChat();
    forcePersonaNextSessionRef.current = "reporter";
  }, [clearChat]);

  const loadSession = useCallback(async (id: string): Promise<boolean> => {
    invalidateActiveSend("load");
    intentResolutionOwnerRef.current = null;
    const loadToken = Symbol(`load-session:${id}`);
    operationOwnerRef.current = loadToken;

    // Loading is target-specific and starts before any network work. Quarantine
    // the previous session immediately so route B never renders/interacts as A.
    setSessionLoadState({ status: "loading", targetSessionId: id, error: null });
    setIsLoading(false);
    setSessionId(null);
    setSessionTitle(null);
    setSessionPersona(null);
    setSessionScope(null);
    setSessionNetworkId(null);
    setMessages([]);
    setSuggestions([]);
    forcePersonaNextSessionRef.current = null;

    interruptTimeoutsRef.current.forEach((t) => clearTimeout(t));
    interruptTimeoutsRef.current.clear();
    pendingQueueRef.current = [];
    preSessionQueueRef.current = [];
    steerPendingRef.current = [];
    setPendingQueue([]);
    setLiveQuestions([]);
    setTurnBlock(null);

    try {
      const data = await apiClient.post<{
        session: {
          id: string;
          title?: string | null;
          persona?: string | null;
          networkId?: string | null;
          scopeType?: "network" | "intent" | null;
          scopeId?: string | null;
        };
        messages: Array<{
          id: string;
          role: string;
          content: string;
          createdAt: string;
          traceEvents?: TraceEvent[];
          streamingDrafts?: StreamingDraft[] | null;
          decisionQuestions?: Question[] | null;
          decisionQuestionsSubmitted?: boolean | null;
          interrupted?: boolean | null;
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
      }>("/chat/web/session", { sessionId: id });
      if (!ownsOperation(loadToken)) return false;
      if (data.session.id !== id) throw new Error("Loaded chat did not match the requested session");

      const loadedScope: ChatScope = data.session.scopeType && data.session.scopeId
        ? {
            type: data.session.scopeType,
            id: data.session.scopeId,
            ...(data.session.scopeType === "intent" && data.session.title?.trim()
              ? { label: data.session.title.trim() }
              : {}),
          }
        : data.session.networkId
          ? { type: "network", id: data.session.networkId }
          : null;
      const loadedMessages = data.messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: new Date(m.createdAt),
        isStreaming: false,
        traceEvents: mergeDebugMetaIntoTraceEvents(m.traceEvents, m.debugMeta) ?? undefined,
        ...(Array.isArray(m.streamingDrafts) && m.streamingDrafts.length > 0
          ? { streamingDrafts: m.streamingDrafts }
          : {}),
        ...(Array.isArray(m.decisionQuestions) && m.decisionQuestions.length > 0
          ? { decisionQuestions: m.decisionQuestions }
          : {}),
        ...(m.decisionQuestionsSubmitted ? { decisionQuestionsSubmitted: true } : {}),
        ...(m.interrupted ? { wasInterrupted: true } : {}),
      }));

      if (!ownsOperation(loadToken)) return false;
      setSessionId(data.session.id);
      setSessionTitle(data.session.title?.trim() ?? null);
      setSessionPersona(data.session.persona ?? null);
      setSessionScope(loadedScope);
      setSessionNetworkId(loadedScope?.type === "network" ? loadedScope.id : null);
      setMessages(loadedMessages);
      setSessionLoadState({ status: "ready", targetSessionId: id, error: null });
      operationOwnerRef.current = null;
      return true;
    } catch (err) {
      if (!ownsOperation(loadToken)) return false;
      logger.error("Load session error", { error: err, sessionId: id });
      operationOwnerRef.current = null;
      const error = "Could not load this chat. Please try again.";
      setSessionLoadState({ status: "error", targetSessionId: id, error });
      return false;
    }
  }, [invalidateActiveSend, ownsOperation]);

  const isSessionReady = useCallback((id: string) => (
    sessionLoadState.status === "ready"
    && sessionLoadState.targetSessionId === id
    && sessionId === id
  ), [sessionId, sessionLoadState]);

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
        logger.error("Update session title error", { error: err });
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
        sessionPersona,
        setSessionId,
        sessionNetworkId,
        chatScope,
        setChatScope,
        scopeNetworkId,
        setScopeNetworkId,
        resolveIntentSession,
        suggestions,
        isLoading,
        turnBlock,
        stopStream,
        sendMessage,
        sendWebMessage,
        sendOnboardingMessage,
        clearChat,
        startSignalSession,
        startReporterSession,
        loadSession,
        sessionLoadState,
        isSessionReady,
        updateSessionTitle,
        pendingQueue,
        cancelQueuedMessage,
        submitMidStreamMessage,
        liveQuestions,
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
