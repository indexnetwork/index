import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGmailConnect } from "@/hooks/useGmailConnect";
import { useNavigate } from "react-router";
import { ArrowUp, Pencil, Paperclip, Square, X, Globe, ChevronDown, Lock, ChevronLeft, Share2, Check, Users, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MentionsTextInput } from "@/components/MentionsInput";
import { useAIChat } from "@/contexts/AIChatContext";
import { useUploadServiceV2 } from "@/services/v2/upload.service";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunities, useQuestionsService } from "@/contexts/APIContext";
import { InjectedQuestions } from '@/components/InjectedQuestions/InjectedQuestions';
import type { PendingQuestion, AnswerBody } from '@/services/questions';
import { validateFiles } from "@/lib/file-validation";
import InlineDiscoveryCard from "@/components/chat/InlineDiscoveryCard";
import { DecisionQuestions } from "@/components/DecisionQuestions";
import { SuggestionChips } from "@/components/chat/SuggestionChips";
import { ToolCallsDisplay } from "@/components/chat/ToolCallsDisplay";
import AssistantMessageContent, { parseAllBlocks } from "@/components/chat/AssistantMessageContent";
import OpportunityCard, { type OpportunityCardData, OpportunitySkeleton } from "@/components/chat/OpportunityCardInChat";
import IntentList from "@/components/IntentList";
import { DebugCopyButton } from "@/components/DebugCopyButton";
import { ContentContainer } from "@/components/layout";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNetworkFilter } from "@/contexts/IndexFilterContext";
import { useNetworksState } from "@/contexts/IndexesContext";
import { apiClient } from "@/lib/api";
import { useSuggestions } from "@/hooks/useSuggestions";
import { useOpportunityActions } from "@/hooks/useOpportunityActions";

import { mentionsToMarkdownLinks } from "@/lib/mentions";
import { log } from "@/lib/logger";

const logger = log.ui.from("ChatContent");

const CHAT_INPUT_PLACEHOLDER = "What's on your mind?";

/** Intent list item shown on the home shelf (from POST /intents/list). */
interface HomeIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  sourceType?: 'file' | 'link' | 'integration';
  networks?: { id: string; title: string }[];
  status?: string;
}


interface PendingFile {
  id: string;
  file: File;
}

interface ChatContentProps {
  sessionIdParam?: string | null;
}
export default function ChatContent({ sessionIdParam }: ChatContentProps) {
  const navigate = useNavigate();
  const sessionIdFromUrl = sessionIdParam ?? null;
  const {
    messages,
    isLoading,
    stopStream,
    sendMessage,
    clearChat,
    loadSession,
    sessionId,
    sessionTitle,
    sessionPersona,
    suggestions: contextSuggestions,
    chatScope,
    setChatScope,
    setScopeNetworkId,
    sessionNetworkId,
    updateSessionTitle,
    pendingQueue,
    cancelQueuedMessage,
    submitMidStreamMessage,
    liveQuestions,
  } = useAIChat();
  const uploadServiceV2 = useUploadServiceV2();
  const { error: showError, addNotification } = useNotifications();
  const [input, setInput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<PendingFile[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [decisionQuestionsSubmittedIds, setDecisionQuestionsSubmittedIds] = useState<
    Set<string>
  >(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const navigatingToHomeRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  const [isIndexDropdownOpen, setIsIndexDropdownOpen] = useState(false);
  const [isInputMultiline, setIsInputMultiline] = useState(false);
  const [isTextareaMultiline, setIsTextareaMultiline] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const { OAuthLink } = useGmailConnect(useCallback(() => {
    sendMessage("I've connected my account, please continue with the import.", undefined, undefined, { hidden: true });
  }, [sendMessage]));

  const handleShare = useCallback(async () => {
    if (!sessionId) return;
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

  // Keep ref in sync with sessionId
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const opportunitiesService = useOpportunities();

  const intentOpportunityScope = useMemo(
    () => chatScope?.type === "intent"
      ? { scopeType: "intent" as const, scopeId: chatScope.id }
      : undefined,
    [chatScope],
  );

  // Opportunity accept/reject/start-chat + ghost invite modal (shared with the intent detail view).
  const {
    opportunityStatusMap,
    setOpportunityStatusMap,
    opportunityActionLoading,
    handleOpportunityAction,
    handleStreamingDraftStartChat,
    inviteModalElement,
  } = useOpportunityActions({ scope: intentOpportunityScope });

  // Intents shown on the home shelf.
  const [homeIntents, setHomeIntents] = useState<HomeIntent[]>([]);
  const [homeIntentsLoading, setHomeIntentsLoading] = useState(false);

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
  }, [opportunityIdsKey, opportunitiesService]);

  // Intent proposal status tracking
  const [intentProposalStatusMap, setIntentProposalStatusMap] = useState<
    Record<string, "pending" | "created" | "rejected">
  >({});
  const [proposalIntentMap, setProposalIntentMap] = useState<Record<string, string>>({});

  // Networks panel join tracking
  const [networkPanelPendingJoinIds, setNetworkPanelPendingJoinIds] = useState<Set<string>>(new Set());

  const questionsService = useQuestionsService();
  const [injectedQuestions, setInjectedQuestions] = useState<PendingQuestion[]>([]);
  /**
   * Ids of live ask_user_question cards already answered/dismissed locally.
   * Never reset: question ids are unique UUIDs, so stale entries are harmless.
   */
  const [resolvedLiveQuestionIds, setResolvedLiveQuestionIds] = useState<Set<string>>(new Set());

  // Fetch conversation-linked questions on session load. In intent-scoped
  // sessions, also include pending questions derived from that selected intent,
  // its opportunities, and their negotiations. In the negotiator DM (persona
  // 'negotiator', no intent pin), include the client's full question inbox —
  // the same noConversation set the /questions page shows (P4.3/IND-404).
  const isNegotiatorDm = sessionPersona === "negotiator" && chatScope?.type !== "intent";
  useEffect(() => {
    if (!sessionId) {
      setInjectedQuestions([]);
      return;
    }
    let active = true;
    const scopeQuestionPromise = chatScope?.type === "intent"
      ? questionsService.getPending({ scopeType: "intent", scopeId: chatScope.id })
      : isNegotiatorDm
        ? questionsService.getPending({ noConversation: true })
        : Promise.resolve([] as PendingQuestion[]);
    Promise.all([
      questionsService.getByConversation(sessionId),
      scopeQuestionPromise,
    ]).then(([conversationQuestions, scopeQuestions]) => {
      if (!active) return;
      const deduped = new Map<string, PendingQuestion>();
      for (const question of [...conversationQuestions, ...scopeQuestions]) {
        deduped.set(question.id, question);
      }
      setInjectedQuestions([...deduped.values()]);
    }).catch(() => {});
    return () => { active = false; };
  }, [sessionId, questionsService, chatScope, isNegotiatorDm]);

  // Merge live ask_user_question cards (streamed via the user_question SSE
  // event) into the inline injected-questions list at render time. The
  // server-side turn is blocked on these until answered/dismissed or the
  // wait times out. Locally-resolved live cards are filtered out.
  const mergedInjectedQuestions = useMemo(() => {
    const byId = new Map(injectedQuestions.map((q) => [q.id, q]));
    for (const q of liveQuestions) {
      if (!byId.has(q.id)) byId.set(q.id, q);
    }
    return [...byId.values()].filter((q) => !resolvedLiveQuestionIds.has(q.id));
  }, [injectedQuestions, liveQuestions, resolvedLiveQuestionIds]);

  // Group injected questions by messageId
  const injectedByMessageId = useMemo(() => {
    const map = new Map<string | null, PendingQuestion[]>();
    for (const q of mergedInjectedQuestions) {
      const key = q.detection.messageId ?? null;
      const existing = map.get(key) ?? [];
      existing.push(q);
      map.set(key, existing);
    }
    return map;
  }, [mergedInjectedQuestions]);

  const handleInjectedAnswer = useCallback(async (questionId: string, body: AnswerBody) => {
    const question = mergedInjectedQuestions.find((q) => q.id === questionId);
    const res = await questionsService.answer(questionId, body);
    setInjectedQuestions((prev) => prev.filter((q) => q.id !== questionId));
    setResolvedLiveQuestionIds((prev) => new Set([...prev, questionId]));
    // Chat-mode questions come from the orchestrator's blocking
    // ask_user_question tool. If no live turn consumed the answer (stream
    // already ended — e.g. the wait timed out or the page was reloaded),
    // feed it back as a new turn so the conversation continues.
    if (
      question?.detection.mode === 'chat' &&
      !res.resumed &&
      !isLoading
    ) {
      const parts = [...body.selectedOptions];
      if (body.freeText?.trim()) parts.push(body.freeText.trim());
      if (parts.length > 0) {
        void sendMessage(`Re: "${question.payload.prompt}" — ${parts.join('; ')}`);
      }
    }
  }, [questionsService, mergedInjectedQuestions, isLoading, sendMessage]);

  const handleInjectedDismiss = useCallback(async (questionId: string) => {
    await questionsService.dismiss(questionId);
    setInjectedQuestions((prev) => prev.filter((q) => q.id !== questionId));
    setResolvedLiveQuestionIds((prev) => new Set([...prev, questionId]));
  }, [questionsService]);

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
      setNetworkPanelPendingJoinIds((prev) => new Set([...prev, networkId]));
      sendMessage(`I'd like to join ${networkTitle}`);
    },
    [sendMessage],
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

  // Sync network filter selection to chat scope so backend receives networkId when user has selected a network
  useEffect(() => {
    if (chatScope?.type === "intent") return;
    setScopeNetworkId(selectedIndexId);
  }, [selectedIndexId, setScopeNetworkId, chatScope?.type]);

  // Fetch the intent list only on the root/home composer. Empty /d/:sessionId
  // conversations should render the chat shell, not the home shelf.
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
        showError("Failed to archive intent");
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
    if (sessionIdFromUrl) {
      // Skip loading if we already have this session in memory (e.g., we just created it)
      if (sessionIdRef.current === sessionIdFromUrl) {
        setSessionLoaded(true);
        return;
      }
      loadSession(sessionIdFromUrl).finally(() => setSessionLoaded(true));
    } else {
      navigatingToHomeRef.current = true;
      // Don't abort in-flight stream so the new session can finish and appear in the sidebar
      clearChat({ abortStream: false });
      setChatScope(null);
      setSelectedNetworkIds([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionLoaded(true);
    }
  }, [sessionIdFromUrl, loadSession, clearChat, setChatScope, setSelectedNetworkIds]);


  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Snap to bottom immediately when a session finishes loading (covers the case
  // where an in-memory session is restored and messages don't change).
  useEffect(() => {
    if (sessionLoaded && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [sessionLoaded]);

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
      await apiClient.patch(`/intents/${intentId}/archive`);
      setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "rejected" }));
    },
    [],
  );

  const handleIntentProposalApprove = useCallback(
    async (proposalId: string, description: string, networkId?: string) => {
      const res = await apiClient.post<{ intentId: string }>("/intents/confirm", { proposalId, description, networkId });
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
        onAction: () => archiveProposalIntent(proposalId, res.intentId),
      });
    },
    [addNotification, archiveProposalIntent, indexes],
  );

  const handleIntentProposalReject = useCallback(
    async (proposalId: string) => {
      await apiClient.post("/intents/reject", { proposalId });
      setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "rejected" }));
    },
    [],
  );

  const handleIntentProposalUndo = useCallback(
    async (proposalId: string) => {
      const intentId = proposalIntentMap[proposalId];
      if (!intentId) throw new Error("Intent ID not found for proposal");
      await archiveProposalIntent(proposalId, intentId);
    },
    [proposalIntentMap, archiveProposalIntent],
  );

  const canSend = input.trim() || selectedFiles.length > 0;

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
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      const list = Array.from(files);
      const validation = validateFiles(list, "general");
      if (!validation.isValid) {
        showError(validation.message ?? "Invalid file(s)");
        e.target.value = "";
        return;
      }
      setSelectedFiles((prev) => [
        ...prev,
        ...list.map((file) => ({ id: crypto.randomUUID(), file })),
      ]);
      e.target.value = "";
    },
    [showError],
  );

  const removeFile = useCallback((id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || isUploadingFiles) return;  // file upload blocks; stream does not

    const message = input.trim();
    setInput("");

    let fileIds: string[] = [];
    const attachmentNames: string[] = [];
    if (selectedFiles.length > 0) {
      setIsUploadingFiles(true);
      try {
        const uploaded = await Promise.all(
          selectedFiles.map(({ file }) => uploadServiceV2.uploadFile(file)),
        );
        fileIds = uploaded.map((f) => f.id);
        attachmentNames.push(...selectedFiles.map(({ file }) => file.name));
        setSelectedFiles([]);
      } catch (err) {
        logger.error("Upload failed", { error: err });
        showError(err instanceof Error ? err.message : "Failed to upload file(s)");
        setIsUploadingFiles(false);
        inputRef.current?.focus();
        return;
      }
      setIsUploadingFiles(false);
    }

    const msgContent = message || "Attached file(s).";
    const fileArg = fileIds.length ? fileIds : undefined;
    const nameArg = attachmentNames.length ? attachmentNames : undefined;

    if (isLoading) {
      // Mid-stream: route via interrupt flow
      const streamingMsg = messages.find((m) => m.isStreaming);
      submitMidStreamMessage(msgContent, streamingMsg?.traceEvents ?? [], fileArg, nameArg);
    } else {
      await sendMessage(msgContent, fileArg, nameArg);
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
    if (!sessionId) return;
    setEditTitleValue(displayTitle);
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const saveTitle = async () => {
    setIsEditingTitle(false);
    const trimmed = editTitleValue.trim();
    if (!sessionId || !trimmed || trimmed === displayTitle) return;
    await updateSessionTitle(sessionId, trimmed);
  };

  if (!sessionLoaded) {
    return (
      <div className="px-6 lg:px-8 min-h-full animate-pulse">
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

  // Shared input form JSX
  const renderInputForm = () => (
    <>
      <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
        <form
          onSubmit={handleSubmit}
          className={cn("flex flex-col bg-[#FCFCFC] border border-[#E9E9E9] rounded-4xl px-4 py-3", selectedFiles.length > 0 && "gap-2")}
        >
          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedFiles.map(({ id, file }) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-100 text-gray-800 text-sm font-ibm-plex-mono max-w-50"
                >
                  <span className="truncate" title={file.name}>
                    {file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(id)}
                    className="shrink-0 p-0.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 focus:outline-none"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className={cn("flex gap-3", isTextareaMultiline ? "items-end" : "items-center")}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".csv,.doc,.docx,.epub,.html,.json,.md,.pdf,.ppt,.pptx,.rtf,.tsv,.txt,.xls,.xlsx,.xml"
              onChange={handleFileSelect}
              className="sr-only"
              aria-label="Attach files"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={isUploadingFiles}
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 h-8 w-8 rounded-full text-gray-500 hover:text-[#4091BB] hover:bg-gray-200 p-0"
              title="Attach files"
              aria-label="Attach files"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <MentionsTextInput
              value={input}
              onChange={setInput}
              placeholder={CHAT_INPUT_PLACEHOLDER}
              disabled={isUploadingFiles}
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
                disabled={!canSend || isUploadingFiles}
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
    const personalIndex = indexes.find((i) => i.isPersonal);
    const selectedIndex = indexes.find((i) => selectedNetworkIds.includes(i.id));

    const renderScopeDropdown = () => {
      if (chatScope?.type === "intent") {
        return (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-black bg-gray-100 border border-gray-200">
            <MessageSquare className="w-4 h-4" />
            {!isInputMultiline && (
              <span className="max-w-48 truncate">
                {chatScope.label || "Selected intent"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setChatScope(null)}
              className="p-0.5 rounded-full text-gray-500 hover:text-black hover:bg-gray-200"
              aria-label="Clear intent scope"
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
            {selectedIndex?.isPersonal ? (
              <Users className="w-4 h-4" />
            ) : selectedIndex?.permissions?.joinPolicy ===
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
                {personalIndex && (
                  <button
                    type="button"
                    onClick={() => {
                      handleIndexSelect(personalIndex.id);
                      setIsIndexDropdownOpen(false);
                    }}
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                      selectedNetworkIds.includes(personalIndex.id) &&
                        "text-gray-900 font-medium",
                    )}
                  >
                    <Users className="w-4 h-4" /> {personalIndex.title}
                  </button>
                )}
                <div className="my-1 border-t border-gray-200" />
                {[...indexes]
                  .filter((i) => !i.isPersonal)
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
              Find your others
            </h1>
            <DebugCopyButton fetchPath="/debug/home" title="Copy home debug JSON" iconSize="w-5 h-5" />
          </div>
          <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
            <form
              onSubmit={handleSubmit}
              className={cn("flex flex-col bg-[#FCFCFC] border border-[#E9E9E9] rounded-4xl px-4 py-3", selectedFiles.length > 0 && "gap-2")}
            >
              {selectedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedFiles.map(({ id, file }) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-100 text-gray-800 text-sm font-ibm-plex-mono max-w-50"
                    >
                      <span className="truncate" title={file.name}>
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(id)}
                        className="shrink-0 p-0.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 focus:outline-none"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className={cn("flex gap-3", isTextareaMultiline ? "items-end" : "items-center")}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".csv,.doc,.docx,.epub,.html,.json,.md,.pdf,.ppt,.pptx,.rtf,.tsv,.txt,.xls,.xlsx,.xml"
                  onChange={handleFileSelect}
                  className="sr-only"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isUploadingFiles}
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 h-8 w-8 rounded-full text-gray-500 hover:text-[#4091BB] hover:bg-gray-200 p-0"
                  title="Attach files"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <MentionsTextInput
                  value={input}
                  onChange={setInput}
                  placeholder={CHAT_INPUT_PLACEHOLDER}
                  disabled={isUploadingFiles}
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
                    disabled={!canSend || isUploadingFiles}
                    className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </form>
          </div>
          <div className="mt-8">
            <IntentList
              intents={homeIntents}
              isLoading={homeIntentsLoading}
              emptyMessage="No signals yet"
              onIntentClick={(intent) => navigate(`/i/${intent.id}`)}
              onArchiveIntent={handleArchiveHomeIntent}
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
      {inviteModalElement}
      {/* Sticky header - full width, min-h-17 matches ChatView header height */}
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
        {isEditingTitle ? (
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
              disabled={!sessionId}
              className="text-left font-bold font-ibm-plex-mono text-lg text-black truncate hover:text-gray-700 disabled:pointer-events-none focus:outline-none rounded"
            >
              {displayTitle}
            </button>
            {sessionId && (
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
                {sessionId && (
                  <DebugCopyButton fetchPath={`/debug/chat/${sessionId}`} title="Copy chat debug JSON" />
                )}
              </>
            )}
            {chatScope?.type === "intent" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 ml-2">
                <MessageSquare className="w-3 h-3" />
                <span className="truncate max-w-40">
                  {chatScope.label || "Selected intent"}
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
            {messages.map((msg) => (
              <div key={msg.id}>
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
                          {msg.isQueued && (
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
                            onOpportunityPrimaryAction={(
                              oppId,
                              userId,
                              viewerRole,
                              counterpartName,
                              isGhost,
                            ) =>
                              handleOpportunityAction(
                                oppId,
                                "accepted",
                                userId,
                                viewerRole,
                                counterpartName,
                                isGhost,
                              )
                            }
                            onOpportunitySecondaryAction={(
                              oppId,
                              userId,
                              viewerRole,
                              counterpartName,
                              isGhost,
                            ) =>
                              handleOpportunityAction(
                                oppId,
                                "rejected",
                                userId,
                                viewerRole,
                                counterpartName,
                                isGhost,
                              )
                            }
                            opportunityLoadingMap={opportunityActionLoading}
                            currentStatusMap={opportunityStatusMap}
                            onIntentProposalApprove={handleIntentProposalApprove}
                            onIntentProposalReject={handleIntentProposalReject}
                            onIntentProposalUndo={handleIntentProposalUndo}
                            intentProposalStatusMap={intentProposalStatusMap}
                            OAuthLink={OAuthLink}
                            onNetworkJoin={handleNetworkJoin}
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
                {msg.role === "user" &&
                  msg.attachmentNames &&
                  msg.attachmentNames.length > 0 && (
                    <div className="flex justify-end mt-1.5">
                      <div className="bg-[#FAFAFA] border border-[#E8E8E8] rounded-2xl px-3 py-1.5 text-xs text-gray-600">
                        {msg.attachmentNames.map((name, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1.5">
                            <Paperclip className="w-3 h-3" />
                            {name}
                            {idx < msg.attachmentNames!.length - 1 && ", "}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
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
                {/* Orchestrator streaming drafts (Plan B): one card per
                   opportunity_draft_ready event. Renders the same
                   OpportunityCard used on the home feed for visual
                   consistency; button wires to the atomic Start Chat
                   endpoint for single-round-trip accept + navigate. */}
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
                            onPrimaryAction={(oppId, userId) =>
                              handleStreamingDraftStartChat(oppId, userId)
                            }
                            isLoading={opportunityActionLoading[draft.opportunityId]}
                          />
                        );
                      })}
                    </div>
                  )}
                {msg.role === "assistant" &&
                  msg.decisionQuestions &&
                  msg.decisionQuestions.length > 0 && (
                    <DecisionQuestions
                      questions={msg.decisionQuestions}
                      submitted={
                        msg.decisionQuestionsSubmitted ??
                        decisionQuestionsSubmittedIds.has(msg.id)
                      }
                      onSubmit={(flattened) => {
                        setDecisionQuestionsSubmittedIds((prev) => {
                          const next = new Set(prev);
                          next.add(msg.id);
                          return next;
                        });
                        sendMessage(flattened);
                      }}
                    />
                  )}
                {msg.role === "assistant" &&
                  injectedByMessageId.has(msg.id) && (
                    <InjectedQuestions
                      questions={injectedByMessageId.get(msg.id)!}
                      onAnswer={handleInjectedAnswer}
                      onDismiss={handleInjectedDismiss}
                    />
                  )}
              </div>
            ))}
            {injectedByMessageId.has(null) && (
              <div data-testid={isNegotiatorDm ? "negotiator-question-inbox" : undefined}>
                {isNegotiatorDm && (
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mt-4 mb-2">
                    Open questions for you
                  </p>
                )}
                <InjectedQuestions
                  questions={injectedByMessageId.get(null)!}
                  onAnswer={handleInjectedAnswer}
                  onDismiss={handleInjectedDismiss}
                />
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ContentContainer>
      </div>

      {/* Fixed input at bottom */}
      <div className="sticky bottom-0 z-20">
        <div className="px-6 lg:px-8">
          <ContentContainer>
            <SuggestionChips
              suggestions={suggestions}
              disabled={isUploadingFiles}
              onSuggestionClick={handleSuggestionClick}
            />
            {renderInputForm()}
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
