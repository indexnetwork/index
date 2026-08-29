import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGmailConnect } from "@/hooks/useGmailConnect";
import { useLocation, useNavigate } from "react-router";
import { ArrowUp, Pencil, Square, X, Globe, ChevronDown, Lock, ChevronLeft, Share2, Check, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MentionsTextInput } from "@/components/MentionsInput";
import { useAIChat } from "@/contexts/AIChatContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunities } from "@/contexts/APIContext";
import InlineDiscoveryCard from "@/components/chat/InlineDiscoveryCard";
import { DecisionQuestions } from "@/components/DecisionQuestions";
import { SuggestionChips } from "@/components/chat/SuggestionChips";
import { ToolCallsDisplay } from "@/components/chat/ToolCallsDisplay";
import AssistantMessageContent, { parseAllBlocks } from "@/components/chat/AssistantMessageContent";
import OpportunityCard, { type OpportunityCardData, OpportunitySkeleton } from "@/components/chat/OpportunityCardInChat";
import { DebugCopyButton } from "@/components/DebugCopyButton";
import { ContentContainer } from "@/components/layout";
import IntentList from "@/components/IntentList";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNetworkFilter } from "@/contexts/IndexFilterContext";
import { useNetworksState } from "@/contexts/IndexesContext";
import { apiClient } from "@/lib/api";
import { useSuggestions } from "@/hooks/useSuggestions";
import { useOpportunityActions } from "@/hooks/useOpportunityActions";

import { mentionsToMarkdownLinks } from "@/lib/mentions";

const CHAT_INPUT_PLACEHOLDER = "What's on your mind?";

interface HomeIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  sourceType?: 'integration' | 'discovery_form' | 'enrichment';
  networks?: { id: string; title: string }[];
  status?: string;
}

interface ChatContentProps {
  sessionIdParam?: string | null;
}
export default function ChatContent({
  sessionIdParam,
}: ChatContentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const sessionIdFromUrl = sessionIdParam ?? null;
  const {
    messages,
    isLoading,
    stopStream,
    sendWebMessage,
    clearChat,
    loadSession,
    loadPreviousMessages,
    hasPreviousSession,
    isLoadingPreviousMessages,
    sessionLoadState,
    isSessionReady,
    sessionId,
    sessionTitle,
    sessionPersona,
    turnBlock,
    suggestions: contextSuggestions,
    chatScope,
    setChatScope,
    setScopeNetworkId,
    sessionNetworkId,
    updateSessionTitle,
    cancelQueuedMessage,
    submitMidStreamMessage,
  } = useAIChat();
  const routedSessionReady = !sessionIdFromUrl
    || isSessionReady(sessionIdFromUrl)
    || (sessionId === sessionIdFromUrl && sessionLoadState.status === "idle");
  const routedSessionError = sessionIdFromUrl
    && sessionLoadState.status === "error"
    && sessionLoadState.targetSessionId === sessionIdFromUrl
      ? sessionLoadState.error
      : null;
  // The orchestrator persona is retired: its sessions render but cannot be
  // continued (the server answers WEB_SIGNAL_SESSION_REQUIRED).
  const legacyOrchestratorReadOnly = sessionPersona === "orchestrator"
    && sessionId === sessionIdFromUrl
    && routedSessionReady;
  const routeSessionMismatch = sessionId !== sessionIdFromUrl
    && Boolean(sessionId || sessionIdFromUrl)
    ;
  const mutationsBlocked = legacyOrchestratorReadOnly
    || routeSessionMismatch
    || (Boolean(sessionIdFromUrl) && !routedSessionReady);
  const mutationsBlockedRef = useRef(mutationsBlocked);
  const routeSessionIdRef = useRef(sessionIdFromUrl);
  const inMemorySessionIdRef = useRef(sessionId);
  const locationKeyRef = useRef(location.key);
  useLayoutEffect(() => {
    mutationsBlockedRef.current = mutationsBlocked;
    routeSessionIdRef.current = sessionIdFromUrl;
    inMemorySessionIdRef.current = sessionId;
    locationKeyRef.current = location.key;
  }, [location.key, mutationsBlocked, sessionId, sessionIdFromUrl]);
  const { error: showError, addNotification } = useNotifications();
  const [input, setInput] = useState("");
  const [decisionQuestionsSubmittedIds, setDecisionQuestionsSubmittedIds] = useState<
    Set<string>
  >(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const navigatingToHomeRef = useRef(false);
  const [isIndexDropdownOpen, setIsIndexDropdownOpen] = useState(false);
  const [isInputMultiline, setIsInputMultiline] = useState(false);
  const [isTextareaMultiline, setIsTextareaMultiline] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const { OAuthLink } = useGmailConnect(useCallback(() => {
    if (mutationsBlockedRef.current) return;
    void sendWebMessage("I've connected my account, please continue with the import.", { hidden: true });
  }, [sendWebMessage]));

  const handleShare = useCallback(async () => {
    if (mutationsBlockedRef.current || !sessionId) return;
    try {
      const { shareToken } = await apiClient.post<{ shareToken: string }>("/chat/session/share", { sessionId });
      const shareUrl = `${window.location.origin}/s/${shareToken}`;
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      showError("Failed to create share link");
    }
  }, [sessionId, showError]);

  const opportunitiesService = useOpportunities();

  const intentOpportunityScope = useMemo(
    () => chatScope?.type === "intent"
      ? { scopeType: "intent" as const, scopeId: chatScope.id }
      : undefined,
    [chatScope],
  );

  // Opportunity accept/reject/start-chat (shared with the intent detail view).
  const {
    opportunityStatusMap,
    setOpportunityStatusMap,
    opportunityActionLoading,
    handleOpportunityAction,
    handleStreamingDraftStartChat,
    opportunityModalElement,
  } = useOpportunityActions({ scope: intentOpportunityScope });

  // Intents shown on the home shelf.

  // Stable list of opportunity IDs from assistant messages (avoids effect re-run on every streaming token)
  const opportunityIdsArray = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of messages) {
      if (msg.role === "assistant" && msg.content) {
        const segments = parseAllBlocks(msg.content);
        for (const seg of segments) {
          if (seg.type === "opportunity" && seg.data.opportunityId) {
            ids.add(seg.data.opportunityId);
          }
        }
      }
    }
    return [...ids].sort();
  }, [messages]);

  // Stable key so effect runs only when the set of IDs changes, not on every message reference change
  const opportunityIdsKey = opportunityIdsArray.join(",");

  // Fetch current status for each opportunity (debounced, parallel)
  useEffect(() => {
    const ids = opportunityIdsKey ? opportunityIdsKey.split(",") : [];
    if (ids.length === 0) return;

    const newStatusMap: Record<string, string> = {};
    const fetchStatuses = async () => {
      const results = await Promise.allSettled(
        ids.map((id) => opportunitiesService.getOpportunity(id)),
      );
      results.forEach((result, i) => {
        const id = ids[i];
        if (result.status === "fulfilled" && result.value?.status) {
          newStatusMap[id] = result.value.status;
        }
      });
      setOpportunityStatusMap((prev) => ({ ...prev, ...newStatusMap }));
    };

    const timeoutId = setTimeout(fetchStatuses, 200);
    return () => clearTimeout(timeoutId);
  }, [opportunityIdsKey, opportunitiesService, setOpportunityStatusMap]);

  // Intent proposal status tracking
  const [intentProposalStatusMap, setIntentProposalStatusMap] = useState<
    Record<string, "pending" | "created" | "rejected">
  >({});
  const [proposalIntentMap, setProposalIntentMap] = useState<Record<string, string>>({});
  const confirmOperationsRef = useRef(new Map<string, symbol>());
  useEffect(() => () => {
    confirmOperationsRef.current.clear();
  }, []);

  // Networks panel join tracking
  const [networkPanelPendingJoinIds, setNetworkPanelPendingJoinIds] = useState<Set<string>>(new Set());


  // Index filter state (needed before stream-end effect so refreshIndexes is in scope)
  const { indexes, refreshIndexes } = useNetworksState();

  // Clear pending join IDs when stream completes and refresh sidebar
  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading && networkPanelPendingJoinIds.size > 0) {
      setNetworkPanelPendingJoinIds(new Set());
      void refreshIndexes();
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, networkPanelPendingJoinIds.size, refreshIndexes]);

  const handleNetworkJoin = useCallback(
    (networkId: string, networkTitle: string) => {
      if (mutationsBlockedRef.current) return;
      setNetworkPanelPendingJoinIds((prev) => new Set([...prev, networkId]));
      void sendWebMessage(`I'd like to join ${networkTitle}`);
    },
    [sendWebMessage],
  );

  // Stable list of proposal IDs from assistant messages
  const proposalIdsArray = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of messages) {
      if (msg.role === "assistant" && msg.content) {
        const segments = parseAllBlocks(msg.content);
        for (const seg of segments) {
          if (seg.type === "intent_proposal" && seg.data.proposalId) {
            ids.add(seg.data.proposalId);
          }
        }
      }
    }
    return [...ids].sort();
  }, [messages]);

  const proposalIdsKey = proposalIdsArray.join(",");

  // Fetch confirmed proposal statuses from server on chat load
  useEffect(() => {
    const ids = proposalIdsKey ? proposalIdsKey.split(",") : [];
    if (ids.length === 0) return;

    const fetchStatuses = async () => {
      try {
        const res = await apiClient.post<{
          statuses: Record<string, { intentId: string; archivedAt: string | null }>;
        }>("/intents/proposals/status", { proposalIds: ids });
        const statusMap: Record<string, "pending" | "created" | "rejected"> = {};
        const intentMap: Record<string, string> = {};
        for (const id of ids) {
          const info = res.statuses?.[id];
          if (info) {
            statusMap[id] = info.archivedAt ? "rejected" : "created";
            intentMap[id] = info.intentId;
          } else {
            statusMap[id] = "pending";
          }
        }
        setIntentProposalStatusMap((prev) => ({ ...prev, ...statusMap }));
        setProposalIntentMap((prev) => ({ ...prev, ...intentMap }));
      } catch {
        // Leave statuses unresolved — cards stay in loading state rather than
        // incorrectly triggering auto-create for already-created intents
      }
    };

    const timeoutId = setTimeout(fetchStatuses, 200);
    return () => clearTimeout(timeoutId);
  }, [proposalIdsKey]);

  // Index filter
  const { selectedNetworkIds, setSelectedNetworkIds } = useNetworkFilter();
  const selectedIndexId =
    selectedNetworkIds.length === 1 ? selectedNetworkIds[0] : null;

  // Suggestions: from context (done event) when we have messages, else static starters
  const { suggestions } = useSuggestions({
    contextSuggestions: contextSuggestions ?? null,
    hasMessages: messages.length > 0,
    networkId: chatScope?.type === "network" ? selectedIndexId : undefined,
    enabled: messages.length > 0,
  });

  const handleIndexSelect = useCallback(
    (networkId: string | null) => {
      if (networkId === null) {
        setSelectedNetworkIds([]);
      } else {
        setSelectedNetworkIds([networkId]);
      }
    },
    [setSelectedNetworkIds],
  );

  // Intents shown on the home shelf (legacy, non-Signal home only).
  const [homeIntents, setHomeIntents] = useState<HomeIntent[]>([]);
  const [homeIntentsLoading, setHomeIntentsLoading] = useState(false);

  // Sync network filter selection to chat scope so backend receives networkId when user has selected a network
  useEffect(() => {
    if (chatScope?.type === "intent") return;
    setScopeNetworkId(selectedIndexId);
  }, [selectedIndexId, setScopeNetworkId, chatScope?.type]);

  useEffect(() => {
    if (messages.length > 0 || sessionIdFromUrl) return;
    let active = true;
    setHomeIntentsLoading(true);
    apiClient
      .post<{ intents?: HomeIntent[] }>("/intents/list", { page: 1, limit: 100 })
      .then((res) => {
        if (active) setHomeIntents(res.intents ?? []);
      })
      .catch(() => {
        if (active) setHomeIntents([]);
      })
      .finally(() => {
        if (active) setHomeIntentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [messages.length, sessionIdFromUrl]);

  const handleArchiveHomeIntent = useCallback(
    async (intent: HomeIntent) => {
      setHomeIntents((prev) => prev.filter((i) => i.id !== intent.id));
      try {
        await apiClient.patch(`/intents/${intent.id}/archive`);
      } catch {
        showError("Failed to archive signal");
      }
    },
    [showError],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: {
      label: string;
      type: string;
      followupText?: string;
      prefill?: string;
    }) => {
      if (suggestion.type === "prompt" && suggestion.prefill) {
        setInput(suggestion.prefill);
        inputRef.current?.focus();
      } else if (suggestion.type === "direct" && suggestion.followupText) {
        setInput(suggestion.followupText);
        // Auto-submit after a brief delay
        setTimeout(() => {
          inputRef.current?.form?.requestSubmit();
        }, 50);
      }
    },
    [],
  );

  useEffect(() => {
    if (!sessionIdFromUrl || routedSessionReady) return;
    const targetAlreadySettled = sessionLoadState.targetSessionId === sessionIdFromUrl
      && (sessionLoadState.status === "loading" || sessionLoadState.status === "error");
    if (!targetAlreadySettled) void loadSession(sessionIdFromUrl);
  }, [sessionIdFromUrl, routedSessionReady, sessionLoadState, loadSession]);

  useLayoutEffect(() => {
    if (sessionIdFromUrl) return;
    navigatingToHomeRef.current = true;
    // Don't abort in-flight stream so the new session can finish and appear in the sidebar.
    clearChat({ abortStream: false });
    setChatScope(null);
    setSelectedNetworkIds([]);
  }, [sessionIdFromUrl, clearChat, setChatScope, setSelectedNetworkIds]);


  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Snap to bottom immediately when a session finishes loading (covers the case
  // where an in-memory session is restored and messages don't change).
  useEffect(() => {
    if (routedSessionReady && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [routedSessionReady]);

  // Update URL when session changes: push so back from /d/id returns to /
  useEffect(() => {
    if (navigatingToHomeRef.current) {
      navigatingToHomeRef.current = false;
      return;
    }
    if (sessionId && !sessionIdFromUrl) {
      navigate(`/d/${sessionId}`);
    }
  }, [sessionId, sessionIdFromUrl, navigate]);

  const archiveProposalIntent = useCallback(
    async (proposalId: string, intentId: string) => {
      if (mutationsBlockedRef.current) throw new Error("This chat is read-only.");
      await apiClient.patch(`/intents/${intentId}/archive`);
      setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "rejected" }));
    },
    [],
  );

  const handleIntentProposalApprove = useCallback(
    async (proposalId: string, description: string, networkId?: string) => {
      const mutationsAllowedAtStart = !mutationsBlockedRef.current;
      if (!mutationsAllowedAtStart) return;

      const operationToken = Symbol("confirm-intent-proposal");
      confirmOperationsRef.current.set(proposalId, operationToken);
      const originatingRouteSessionId = sessionIdFromUrl;
      const originatingInMemorySessionId = sessionId;
      const originatingLocationKey = location.key;
      const originatingRoute = originatingRouteSessionId ? `/d/${originatingRouteSessionId}` : "/";
      const operationStillOwnsChat = () => mutationsAllowedAtStart
        && confirmOperationsRef.current.get(proposalId) === operationToken
        && routeSessionIdRef.current === originatingRouteSessionId
        && inMemorySessionIdRef.current === originatingInMemorySessionId
        && locationKeyRef.current === originatingLocationKey
        && !mutationsBlockedRef.current;
      const releaseOperation = () => {
        if (confirmOperationsRef.current.get(proposalId) === operationToken) {
          confirmOperationsRef.current.delete(proposalId);
        }
      };

      let res: { intentId: string };
      try {
        res = await apiClient.post<{ intentId: string }>("/intents/confirm", { proposalId, description, networkId });
      } catch (error) {
        if (!operationStillOwnsChat()) {
          releaseOperation();
          addNotification({
            type: "intent_broadcast",
            title: "Signal creation failed",
            message: "An earlier signal confirmation failed. This conversation was left unchanged.",
            duration: 10000,
          });
          return;
        }
        releaseOperation();
        throw error;
      }

      if (!operationStillOwnsChat()) {
        releaseOperation();
        addNotification({
          type: "intent_broadcast",
          title: "Signal created",
          message: "A signal was created from an earlier confirmation. This conversation was left unchanged.",
          duration: 10000,
        });
        return;
      }
      releaseOperation();

      setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "created" }));
      setProposalIntentMap((prev) => ({ ...prev, [proposalId]: res.intentId }));
      // Outcome-aware feedback: a network-scoped create lands directly in that
      // network; an unscoped create is evaluated against all the user's
      // networks asynchronously, so set expectations rather than implying it's
      // already broadcasting somewhere specific.
      const targetNetwork = networkId ? indexes.find((i) => i.id === networkId) : undefined;
      addNotification({
        type: "intent_broadcast",
        title: targetNetwork ? `Broadcasting to ${targetNetwork.title}` : "Evaluating networks…",
        message: description,
        duration: 10000,
        onAction: async () => {
          try {
            await archiveProposalIntent(proposalId, res.intentId);
            navigate(originatingRoute);
          } catch (error) {
            showError("Failed to undo signal", error instanceof Error ? error.message : "Please try again.");
            throw error;
          }
        },
      });
      navigate(`/i/${res.intentId}`);
    },
    [addNotification, archiveProposalIntent, indexes, location.key, navigate, sessionId, sessionIdFromUrl, showError],
  );

  const handleIntentProposalReject = useCallback(
    async (proposalId: string) => {
      if (mutationsBlockedRef.current) return;
      await apiClient.post("/intents/reject", { proposalId });
      setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "rejected" }));
    },
    [],
  );

  const handleIntentProposalUndo = useCallback(
    async (proposalId: string) => {
      if (mutationsBlockedRef.current) return;
      const intentId = proposalIntentMap[proposalId];
      if (!intentId) throw new Error("Signal ID not found for proposal");
      await archiveProposalIntent(proposalId, intentId);
    },
    [proposalIntentMap, archiveProposalIntent],
  );

  const canSend = Boolean(input.trim());

  useEffect(() => {
    const el = inputRef.current;
    if (!input) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsInputMultiline(false);
      setIsTextareaMultiline(false);
      return;
    }
    if (!el) return;
    // Detect actual line wrapping: single line = paddingTop(6) + lineHeight(20) + paddingBottom(6) = 32px
    setIsTextareaMultiline(el.scrollHeight > 34);
    // Network selector compression: only triggers at 75% width, never reverts mid-typing
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = window.getComputedStyle(el).font;
    const textWidth = ctx.measureText(input).width;
    const availableWidth = el.clientWidth;
    if (availableWidth > 0 && textWidth / availableWidth > 0.75) {
      setIsInputMultiline(true);
    }
  }, [input]);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      mutationsBlockedRef.current
      || Boolean(turnBlock)
      || !canSend
    ) return;

    const message = input.trim();
    setInput("");

    if (isLoading) {
      const streamingMsg = messages.find((m) => m.isStreaming);
      submitMidStreamMessage(message, streamingMsg?.traceEvents ?? []);
    } else {
      await sendWebMessage(message);
    }
    inputRef.current?.focus();
  };

  // Auto-focus input on keydown/paste anywhere
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === "Backspace") {
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const displayTitle = sessionTitle || "Untitled chat";

  const startEditingTitle = () => {
    if (mutationsBlockedRef.current || !sessionId) return;
    setEditTitleValue(displayTitle);
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const saveTitle = async () => {
    setIsEditingTitle(false);
    const trimmed = editTitleValue.trim();
    if (mutationsBlockedRef.current || !sessionId || !trimmed || trimmed === displayTitle) return;
    await updateSessionTitle(sessionId, trimmed);
  };

  if (sessionIdFromUrl && !routedSessionReady) {
    if (routedSessionError) {
      return (
        <div className="px-6 lg:px-8 min-h-full flex items-center justify-center">
          <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-gray-900">Could not load this chat</h1>
            <p className="mt-2 text-sm text-gray-600">{routedSessionError}</p>
            <div className="mt-5 flex justify-center gap-2">
              <Button type="button" variant="outline" onClick={() => {
                clearChat();
                setChatScope(null);
                setSelectedNetworkIds([]);
                navigate("/");
              }}>
                Back to home
              </Button>
              <Button type="button" onClick={() => void loadSession(sessionIdFromUrl)}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="px-6 lg:px-8 min-h-full animate-pulse" aria-label={`Loading chat ${sessionIdFromUrl}`}>
        <div className="max-w-2xl mx-auto">
          <div className="mt-12 mb-6 flex justify-center">
            <div className="h-8 w-48 bg-gray-100 rounded-sm" />
          </div>
          <div className="h-14 bg-gray-100 rounded-4xl mb-6" />
          <div className="mt-12 space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3.5 h-3.5 bg-gray-100 rounded-sm" />
              <div className="h-3 w-32 bg-gray-100 rounded-sm" />
            </div>
            {[1, 2].map((i) => (
              <OpportunitySkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const renderContinuationPanel = () => {
    const startsSignal = legacyOrchestratorReadOnly
      || (turnBlock?.action?.type === "start_signal_session" && turnBlock.action.href === "/");
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-medium text-gray-900">
          {turnBlock?.message ?? "This earlier chat is read-only."}
        </p>
        <p className="mt-1 text-sm text-gray-600">
          {startsSignal
            ? "Its messages are preserved. Continue in a separate chat with your agent."
            : "This chat is unchanged. Start a new chat to continue safely."}
        </p>
        <Button
          type="button"
          className="mt-3 bg-[#041729] text-white hover:bg-[#0a2d4a]"
          onClick={() => {
            clearChat();
            setChatScope(null);
            setSelectedNetworkIds([]);
            navigate("/");
          }}
        >
          {startsSignal ? "Start a chat with your agent" : "Start a new chat"}
        </Button>
      </div>
    );
  };

  // Shared input form JSX
  const renderInputForm = () => (
    <>
      <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col bg-[#FCFCFC] border border-[#E9E9E9] rounded-4xl px-4 py-3"
        >
          <div className={cn("flex gap-3", isTextareaMultiline ? "items-end" : "items-center")}>
            <MentionsTextInput
              value={input}
              onChange={setInput}
              placeholder={CHAT_INPUT_PLACEHOLDER}
              autoFocus
              inputRef={inputRef}
              suggestionsAbove
            />
            {isLoading ? (
              <Button
                type="button"
                size="icon"
                onClick={() => stopStream()}
                className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] p-0"
                title="Stop generating"
                aria-label="Stop generating"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!canSend}
                title="Send message"
                aria-label="Send message"
                className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </form>
      </div>
      <div className="py-2 bg-white"></div>
    </>
  );

  // HOME STATE - No messages yet. A resolved /d/:sessionId may legitimately
  // have no messages yet; keep that in conversation mode so intent-scoped
  // sessions open directly into the chat shell with their scope chip visible.
  if (messages.length === 0 && !sessionIdFromUrl) {
    const selectedIndex = indexes.find((i) => selectedNetworkIds.includes(i.id));

    const renderScopeDropdown = () => {
      if (chatScope?.type === "intent") {
        return (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-black bg-gray-100 border border-gray-200">
            <MessageSquare className="w-4 h-4" />
            {!isInputMultiline && (
              <span className="max-w-48 truncate">
                {chatScope.label || "Selected signal"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setChatScope(null)}
              className="p-0.5 rounded-full text-gray-500 hover:text-black hover:bg-gray-200"
              aria-label="Clear signal scope"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      }
      if (indexes.length === 0) return null;
      return (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setIsIndexDropdownOpen(!isIndexDropdownOpen)}
            className={cn(
              "inline-flex items-center gap-1.5 py-1.5 rounded-full text-sm font-medium text-black transition-all hover:bg-gray-100",
              isInputMultiline ? "px-1.5" : "px-3",
            )}
          >
            {selectedIndex?.permissions?.joinPolicy ===
              "invite_only" ? (
              <Lock className="w-4 h-4" />
            ) : (
              <Globe className="w-4 h-4" />
            )}
            {!isInputMultiline && (
              <span>
                {selectedIndex?.title || "Everywhere"}
              </span>
            )}
            <ChevronDown
              className={cn(
                "w-4 h-4 transition-transform",
                isIndexDropdownOpen && "rotate-180",
              )}
            />
          </button>
          {isIndexDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsIndexDropdownOpen(false)}
              />
              <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-40">
                <button
                  type="button"
                  onClick={() => {
                    handleIndexSelect(null);
                    setIsIndexDropdownOpen(false);
                  }}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                    selectedNetworkIds.length === 0 &&
                      "text-gray-900 font-medium",
                  )}
                >
                  <Globe className="w-4 h-4" /> Everywhere
                </button>
                <div className="my-1 border-t border-gray-200" />
                {[...indexes]
                  .sort(
                    (a, b) =>
                      (a.permissions?.joinPolicy === "invite_only"
                        ? 1
                        : 0) -
                        (b.permissions?.joinPolicy === "invite_only"
                          ? 1
                          : 0) ||
                      (a.title || "").localeCompare(b.title || ""),
                  )
                  .map((index) => (
                    <button
                      key={index.id}
                      type="button"
                      onClick={() => {
                        handleIndexSelect(index.id);
                        setIsIndexDropdownOpen(false);
                      }}
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                        selectedNetworkIds.includes(index.id) &&
                          "text-gray-900 font-medium",
                      )}
                    >
                      {index.permissions?.joinPolicy ===
                      "invite_only" ? (
                        <Lock className="w-4 h-4 shrink-0" />
                      ) : (
                        <Globe className="w-4 h-4 shrink-0" />
                      )}
                      <span className="truncate">
                        {index.title}
                      </span>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      );
    };

    // Home shelf: composer on top, the user's intent list below.
    return (
      <div className="px-6 lg:px-8 pb-12">
        <ContentContainer className="text-left">
          <div className="mt-12 mb-6 flex items-center justify-center gap-2">
            <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono text-center">
              Talk to your agent
            </h1>
            <DebugCopyButton fetchPath="/debug/radar" title="Copy radar debug JSON" iconSize="w-5 h-5" />
          </div>
          <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
            {turnBlock ? renderContinuationPanel() : (
            <form
              onSubmit={handleSubmit}
              className="flex flex-col bg-[#FCFCFC] border border-[#E9E9E9] rounded-4xl px-4 py-3"
            >
              <div className={cn("flex gap-3", isTextareaMultiline ? "items-end" : "items-center")}>
                <MentionsTextInput
                  value={input}
                  onChange={setInput}
                  placeholder={CHAT_INPUT_PLACEHOLDER}
                  autoFocus
                  inputRef={inputRef}
                />
                {renderScopeDropdown()}
                {isLoading ? (
                  <Button
                    type="button"
                    size="icon"
                    onClick={() => stopStream()}
                    className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] p-0"
                    title="Stop generating"
                    aria-label="Stop generating"
                  >
                    <Square className="h-4 w-4 fill-current" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!canSend}
                    title="Send message"
                    aria-label="Send message"
                    className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </form>
            )}
          </div>
          <button
              type="button"
              onClick={() => navigate("/i/new")}
              className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-400 hover:shadow-sm"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#041729] text-lg leading-none text-white">+</span>
              <span>
                <span className="block text-sm font-medium text-[#041729]">Who are you trying to meet?</span>
                <span className="block text-xs text-gray-500">A few questions to make what you’re looking for legible.</span>
              </span>
            </button>
          <div className="mt-8">
              <IntentList
                intents={homeIntents}
                isLoading={homeIntentsLoading}
                emptyMessage="No signals yet"
                onIntentClick={(intent) => navigate(`/i/${intent.id}`)}
                onArchiveIntent={turnBlock ? undefined : handleArchiveHomeIntent}
              />
            </div>
        </ContentContainer>
      </div>
    );
  }

  // CONVERSATION MODE - Has messages
  const boundIndexId = chatScope?.type === "network" ? (sessionNetworkId ?? selectedIndexId) : null;
  const boundIndex = indexes.find((i) => i.id === boundIndexId) ?? null;

  return (
    <>
      {!legacyOrchestratorReadOnly && opportunityModalElement}
      {/* Sticky header - full width, min-h-17 matches ChatView header height. */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center gap-3 min-h-17">
        <button
          type="button"
          onClick={() => {
            clearChat({ abortStream: false });
            setChatScope(null);
            setSelectedNetworkIds([]);
            navigate("/");
          }}
          className="p-1 -ml-1 rounded-md hover:bg-gray-100 text-gray-600 hover:text-black transition-colors shrink-0"
          aria-label="Back to home"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        {isEditingTitle && !legacyOrchestratorReadOnly ? (
          <input
            ref={titleInputRef}
            type="text"
            value={editTitleValue}
            onChange={(e) => setEditTitleValue(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                setEditTitleValue(displayTitle);
                setIsEditingTitle(false);
              }
            }}
            className="flex-1 min-w-0 font-semibold font-ibm-plex-mono text-gray-900 bg-transparent border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30 focus:border-[#4091BB]"
            placeholder="Conversation title"
          />
        ) : (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={startEditingTitle}
              disabled={!sessionId || legacyOrchestratorReadOnly}
              className="text-left font-bold font-ibm-plex-mono text-lg text-black truncate hover:text-gray-700 disabled:pointer-events-none focus:outline-none rounded"
            >
              {displayTitle}
            </button>
            {sessionId && (
              <>
                {!legacyOrchestratorReadOnly && (
                  <>
                    <button
                      type="button"
                      onClick={startEditingTitle}
                      title="Rename conversation"
                      className="shrink-0 p-1 rounded text-gray-500 hover:text-[#4091BB] hover:bg-gray-100 focus:outline-none"
                      aria-label="Rename conversation"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleShare}
                      title={shareCopied ? "Link copied!" : "Share conversation"}
                      className="shrink-0 p-1 rounded text-gray-500 hover:text-[#4091BB] hover:bg-gray-100 focus:outline-none"
                      aria-label="Share conversation"
                    >
                      {shareCopied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Share2 className="h-4 w-4" />
                      )}
                    </button>
                  </>
                )}
                <DebugCopyButton fetchPath={`/debug/chat/${sessionId}`} title="Copy chat debug JSON" />
              </>
            )}
            {chatScope?.type === "intent" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 ml-2">
                <MessageSquare className="w-3 h-3" />
                <span className="truncate max-w-40">
                  {chatScope.label || "Selected signal"}
                </span>
              </span>
            )}
            {boundIndex && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 ml-2">
                {boundIndex.permissions?.joinPolicy === "invite_only" ? (
                  <Lock className="w-3 h-3" />
                ) : (
                  <Globe className="w-3 h-3" />
                )}
                <span className="truncate max-w-30">
                  {boundIndex.title}
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="px-6 lg:px-8 pb-32 flex-1">
        <ContentContainer>
          <div className="space-y-4">
            {hasPreviousSession && (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={() => void loadPreviousMessages()}
                  disabled={isLoadingPreviousMessages}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-ibm-plex-mono text-gray-600 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
                  aria-label="Load previous messages"
                >
                  {isLoadingPreviousMessages ? "Loading previous messages…" : "Load Previous Messages"}
                </button>
              </div>
            )}
            {messages.map((msg, index) => (
              <div key={msg.id}>
                {index > 0 && msg.conversationSessionId !== messages[index - 1]?.conversationSessionId && (
                  <div className="flex items-center gap-3 py-3" role="separator" aria-label="Earlier chat session">
                    <span className="h-px flex-1 bg-gray-200" />
                    <span className="text-[10px] font-ibm-plex-mono uppercase tracking-[0.12em] text-gray-400">Earlier conversation</span>
                    <span className="h-px flex-1 bg-gray-200" />
                  </div>
                )}
                <div
                  className={cn(
                    "flex",
                    msg.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  {msg.role === "user" ? (
                    <div className="flex flex-col items-end gap-1 max-w-[75%]">
                      {(msg.isPending || msg.isQueued) && (
                        <span className={cn(
                          "inline-flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full font-medium font-ibm-plex-mono tracking-wide transition-colors duration-150",
                          msg.isPending
                            ? "bg-amber-50 text-amber-600 border border-amber-200 badge-classifying"
                            : "bg-blue-50 text-blue-500 border border-blue-200",
                        )}>
                          {msg.isPending ? "classifying…" : "queued"}
                          {msg.isQueued && !legacyOrchestratorReadOnly && (
                            <button
                              type="button"
                              onClick={() => cancelQueuedMessage(msg.id)}
                              className="ml-0.5 text-blue-400 hover:text-blue-700 focus:outline-none cancel-fade-in"
                              aria-label="Cancel queued message"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </span>
                      )}
                      <div className={cn(
                        "w-fit max-w-full bg-[#FAFAFA] text-gray-900 border border-[#E8E8E8] rounded-4xl px-4 py-1 text-sm leading-relaxed transition-opacity duration-150",
                        (msg.isPending || msg.isQueued) && "opacity-60",
                      )}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{ p: ({ children }) => <span className="block">{children}</span> }}
                        >
                          {mentionsToMarkdownLinks(msg.content)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full text-gray-900">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-ibm-plex-mono mb-1.5 block">
                        Index
                      </span>
                      {msg.traceEvents && msg.traceEvents.length > 0 && (
                        <ToolCallsDisplay
                          traceEvents={msg.traceEvents}
                          isStreaming={msg.isStreaming}
                          wasStoppedByUser={msg.wasStoppedByUser}
                          stoppedAt={msg.stoppedAt}
                        />
                      )}
                      <div className="max-w-[90%]">
                        <article className="max-w-none">
                          <AssistantMessageContent
                            content={msg.content}
                            isStreaming={msg.isStreaming ?? false}
                            onOpportunityPrimaryAction={legacyOrchestratorReadOnly ? undefined : (
                              oppId,
                              userId,
                              viewerRole,
                              counterpartName,
                            ) => {
                              if (mutationsBlockedRef.current) return;
                              return handleOpportunityAction(
                                oppId,
                                "accepted",
                                userId,
                                viewerRole,
                                counterpartName,
                              );
                            }}
                            onOpportunitySecondaryAction={legacyOrchestratorReadOnly ? undefined : (
                              oppId,
                              userId,
                              viewerRole,
                              counterpartName,
                            ) => {
                              if (mutationsBlockedRef.current) return;
                              return handleOpportunityAction(
                                oppId,
                                "rejected",
                                userId,
                                viewerRole,
                                counterpartName,
                              );
                            }}
                            opportunityLoadingMap={opportunityActionLoading}
                            currentStatusMap={opportunityStatusMap}
                            onIntentProposalApprove={legacyOrchestratorReadOnly ? undefined : handleIntentProposalApprove}
                            onIntentProposalReject={legacyOrchestratorReadOnly ? undefined : handleIntentProposalReject}
                            onIntentProposalUndo={legacyOrchestratorReadOnly ? undefined : handleIntentProposalUndo}
                            intentProposalStatusMap={intentProposalStatusMap}
                            OAuthLink={legacyOrchestratorReadOnly ? undefined : OAuthLink}
                            onNetworkJoin={legacyOrchestratorReadOnly ? undefined : handleNetworkJoin}
                            networkPanelPendingJoinIds={networkPanelPendingJoinIds}
                          />
                        </article>
                      </div>
                      {msg.wasInterrupted && (
                        <p className="text-[10px] text-gray-300 mt-1 font-ibm-plex-mono tracking-wide">{"\u2014 interrupted"}</p>
                      )}
                    </div>
                  )}
                </div>
                {/* Inline discovery cards (legacy format) */}
                {msg.role === "assistant" &&
                  msg.discoveries &&
                  msg.discoveries.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.discoveries.map((discovery, idx) => (
                        <InlineDiscoveryCard
                          key={`${discovery.candidateId}-${idx}`}
                          discovery={discovery}
                        />
                      ))}
                    </div>
                  )}
                {/* Historical draft cards from persisted session metadata. */}
                {msg.role === "assistant" &&
                  msg.streamingDrafts &&
                  msg.streamingDrafts.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.streamingDrafts.map((draft) => {
                        const cardStatus =
                          opportunityStatusMap[draft.opportunityId] ??
                          draft.opportunity.status ??
                          "draft";
                        const cardData: OpportunityCardData = {
                          opportunityId: draft.opportunityId,
                          userId: draft.counterparty.userId,
                          name: draft.counterparty.name ?? "New connection",
                          mainText:
                            draft.personalizedSummary ??
                            draft.opportunity.interpretation?.reasoning ??
                            "Accepted draft opportunity",
                          primaryActionLabel: "Start Chat",
                          secondaryActionLabel: "Skip",
                          status: cardStatus,
                        };
                        return (
                          <OpportunityCard
                            key={draft.opportunityId}
                            card={cardData}
                            currentStatus={cardStatus}
                            onPrimaryAction={legacyOrchestratorReadOnly ? undefined : (oppId, userId) => {
                              if (mutationsBlockedRef.current) return;
                              return handleStreamingDraftStartChat(oppId, userId);
                            }}
                            isLoading={opportunityActionLoading[draft.opportunityId]}
                          />
                        );
                      })}
                    </div>
                  )}
                {msg.role === "assistant" &&
                  !legacyOrchestratorReadOnly &&
                  msg.decisionQuestions &&
                  msg.decisionQuestions.length > 0 && (
                    <DecisionQuestions
                      questions={msg.decisionQuestions}
                      submitted={
                        msg.decisionQuestionsSubmitted ??
                        decisionQuestionsSubmittedIds.has(msg.id)
                      }
                      onSubmit={(flattened) => {
                        if (mutationsBlockedRef.current) return;
                        setDecisionQuestionsSubmittedIds((prev) => {
                          const next = new Set(prev);
                          next.add(msg.id);
                          return next;
                        });
                        void sendWebMessage(flattened);
                      }}
                    />
                  )}
              </div>
            ))}
            <div ref={scrollRef} />
          </div>
        </ContentContainer>
      </div>

      {/* Fixed input or legacy-session continuation action at bottom */}
      <div className="sticky bottom-0 z-20">
        <div className="px-6 lg:px-8">
          <ContentContainer>
            {legacyOrchestratorReadOnly || turnBlock ? (
              <div className="mb-4">{renderContinuationPanel()}</div>
            ) : (
              <>
                <SuggestionChips
                  suggestions={suggestions}
                  onSuggestionClick={handleSuggestionClick}
                />
                {renderInputForm()}
              </>
            )}
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
