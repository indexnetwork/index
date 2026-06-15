import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGmailConnect } from "@/hooks/useGmailConnect";
import { useNavigate } from "react-router";
import { ArrowUp, Pencil, Paperclip, Square, X, Globe, ChevronDown, Lock, ChevronLeft, Share2, Check, Users } from "lucide-react";
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
import InviteMessageModal from "@/components/InviteMessageModal";
import { SuggestionChips } from "@/components/chat/SuggestionChips";
import { ToolCallsDisplay } from "@/components/chat/ToolCallsDisplay";
import AssistantMessageContent, { parseAllBlocks } from "@/components/chat/AssistantMessageContent";
import OpportunityCard, { type OpportunityCardData, OpportunitySkeleton } from "@/components/chat/OpportunityCardInChat";
import { DebugCopyButton } from "@/components/DebugCopyButton";
import { ContentContainer } from "@/components/layout";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNetworkFilter } from "@/contexts/IndexFilterContext";
import { useNetworksState } from "@/contexts/IndexesContext";
import { useConversation } from "@/contexts/ConversationContext";
import { apiClient } from "@/lib/api";
import { useSuggestions } from "@/hooks/useSuggestions";

import { mentionsToMarkdownLinks } from "@/lib/mentions";
import type { HomeViewSection } from "@/services/opportunities";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";

/**
 * When true, use GET /opportunities/home for dynamic sections; when false, use static/mock data.
 */
const USE_HOME_API = true;

const CHAT_INPUT_PLACEHOLDER = "What's on your mind?";


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
    suggestions: contextSuggestions,
    setScopeNetworkId,
    sessionNetworkId,
    updateSessionTitle,
    pendingQueue,
    cancelQueuedMessage,
    submitMidStreamMessage,
  } = useAIChat();
  const uploadServiceV2 = useUploadServiceV2();
  const { error: showError, success: showSuccess, addNotification } = useNotifications();
  const { refreshConversations } = useConversation();
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

  // Track current opportunity statuses (fetched from server to detect changes)
  const [opportunityStatusMap, setOpportunityStatusMap] = useState<
    Record<string, string>
  >({});

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

  // Home view from API (when USE_HOME_API)
  const [homeViewData, setHomeViewData] = useState<{
    sections: HomeViewSection[];
    meta: { totalOpportunities: number; totalSections: number };
  } | null>(null);
  const [homeViewLoading, setHomeViewLoading] = useState(false);
  const [, setHomeViewError] = useState<string | null>(null);
  const [opportunityActionLoading, setOpportunityActionLoading] =
    useState<Record<string, boolean>>({});

  // Intent proposal status tracking
  const [intentProposalStatusMap, setIntentProposalStatusMap] = useState<
    Record<string, "pending" | "created" | "rejected">
  >({});
  const [proposalIntentMap, setProposalIntentMap] = useState<Record<string, string>>({});

  // Networks panel join tracking
  const [networkPanelPendingJoinIds, setNetworkPanelPendingJoinIds] = useState<Set<string>>(new Set());

  // Invite message modal state
  const [inviteModal, setInviteModal] = useState<{ userId: string; userName: string; message: string; loading: boolean; opportunityId: string } | null>(null);
  const inviteModalResolveRef = useRef<((msg: string | null) => void) | null>(null);

  const questionsService = useQuestionsService();
  const [injectedQuestions, setInjectedQuestions] = useState<PendingQuestion[]>([]);

  // Fetch conversation-linked questions on session load
  useEffect(() => {
    if (!sessionId) {
      setInjectedQuestions([]);
      return;
    }
    let active = true;
    questionsService.getByConversation(sessionId).then((qs) => {
      if (active) setInjectedQuestions(qs);
    }).catch(() => {});
    return () => { active = false; };
  }, [sessionId, questionsService]);

  // Group injected questions by messageId
  const injectedByMessageId = useMemo(() => {
    const map = new Map<string | null, PendingQuestion[]>();
    for (const q of injectedQuestions) {
      const key = q.detection.messageId ?? null;
      const existing = map.get(key) ?? [];
      existing.push(q);
      map.set(key, existing);
    }
    return map;
  }, [injectedQuestions]);

  const handleInjectedAnswer = useCallback(async (questionId: string, body: AnswerBody) => {
    await questionsService.answer(questionId, body);
    setInjectedQuestions((prev) => prev.filter((q) => q.id !== questionId));
  }, [questionsService]);

  const handleInjectedDismiss = useCallback(async (questionId: string) => {
    await questionsService.dismiss(questionId);
    setInjectedQuestions((prev) => prev.filter((q) => q.id !== questionId));
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
    networkId: selectedIndexId,
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
    setScopeNetworkId(selectedIndexId);
  }, [selectedIndexId, setScopeNetworkId]);

  // Fetch home view when on home (no messages) and USE_HOME_API
  useEffect(() => {
    if (!USE_HOME_API || messages.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHomeViewData(null);
      return;
    }
    setHomeViewLoading(true);
    setHomeViewError(null);
    const urlParams = new URLSearchParams(window.location.search);
    const noCache = urlParams.get('noCache') === '1' || urlParams.get('noCache') === 'true';
    opportunitiesService
      .getHomeView({ networkId: selectedIndexId ?? undefined, limit: 5, noCache })
      .then((res) => {
        setHomeViewData(res);
        setHomeViewLoading(false);
      })
      .catch((err) => {
        setHomeViewError(err?.message ?? "Failed to load home view");
        setHomeViewData(null);
        setHomeViewLoading(false);
      });
  }, [messages.length, selectedIndexId, opportunitiesService]);

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
      setSelectedNetworkIds([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionLoaded(true);
    }
  }, [sessionIdFromUrl, loadSession, clearChat]);


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

  const handleHomeOpportunityAction = useCallback(
    async (
      opportunityId: string,
      action: "accepted" | "rejected",
      fallbackUserId?: string,
      viewerRole?: string,
      counterpartName?: string,
      isGhost?: boolean,
    ) => {
      const isIntroducer = viewerRole === "introducer";

      // Ghost + accepted + non-introducer: show modal immediately, fetch AI message in background
      if (action === "accepted" && !isIntroducer && isGhost) {
        const name = counterpartName ?? "them";
        const displayUserId = fallbackUserId ?? "";

        setInviteModal({ userId: displayUserId, userName: name, message: "", loading: true, opportunityId });

        opportunitiesService.getInviteMessage(opportunityId)
          .then(({ message }) => {
            setInviteModal((prev) => prev?.opportunityId === opportunityId ? { ...prev, message, loading: false } : prev);
          })
          .catch(() => {
            setInviteModal((prev) => prev?.opportunityId === opportunityId ? { ...prev, loading: false } : prev);
          });

        const finalMessage = await new Promise<string | null>((resolve) => {
          inviteModalResolveRef.current = resolve;
        });

        if (finalMessage === null) {
          throw new Error("user_cancelled");
        }

        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
        try {
          const result = await opportunitiesService.updateStatus(opportunityId, "accepted");
          setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: "accepted" }));
          setHomeViewData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              sections: prev.sections
                .map((s) => ({ ...s, items: s.items.filter((i) => i.opportunityId !== opportunityId) }))
                .filter((s) => s.items.length > 0),
            };
          });
          const counterpartUserId = result.counterpartUserId ?? fallbackUserId;
          if (counterpartUserId) {
            navigate(`/u/${counterpartUserId}/chat`, { state: { prefill: finalMessage, autoSend: true } });
          }
        } catch (error) {
          showError(error instanceof Error ? error.message : "Failed to update opportunity");
        } finally {
          setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
        }
        return;
      }

      // Non-ghost + accepted + non-introducer: atomically accept the opp and
      // resolve the DM in one round-trip via POST /opportunities/:id/start-chat.
      if (action === "accepted" && !isIntroducer && !isGhost) {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
        try {
          const result = await opportunitiesService.startChat(opportunityId);
          setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: "accepted" }));
          setHomeViewData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              sections: prev.sections
                .map((s) => ({ ...s, items: s.items.filter((i) => i.opportunityId !== opportunityId) }))
                .filter((s) => s.items.length > 0),
            };
          });
          refreshConversations();
          // Always route to the h2h chat page (`/u/:peer/chat` renders `ChatView`).
          // `/chat/:id` routes to the A2A NegotiationDetailPage and does not show
          // the in-chat opportunity context.
          navigate(`/u/${result.counterpartUserId ?? fallbackUserId ?? ""}/chat`);
        } catch (error) {
          showError(error instanceof Error ? error.message : "Failed to start chat");
        } finally {
          setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
        }
        return;
      }

      // For rejected or introducer accepted: proceed immediately without modal
      setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
      try {
        const effectiveStatus = isIntroducer && action === "accepted" ? "pending" : action;
        const result = await opportunitiesService.updateStatus(opportunityId, effectiveStatus);
        setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: effectiveStatus }));

        if (action === "accepted" && isIntroducer) {
          showSuccess(
            "Introduction sent",
            `${counterpartName || "They"} will be notified and can accept to start the conversation.`,
          );
        }

        setHomeViewData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            sections: prev.sections
              .map((s) => ({ ...s, items: s.items.filter((i) => i.opportunityId !== opportunityId) }))
              .filter((s) => s.items.length > 0),
          };
        });

        // For rejected accepted non-introducer (shouldn't happen but just in case)
        const counterpartUserId = result.counterpartUserId ?? fallbackUserId;
        if (action === "accepted" && !isIntroducer && counterpartUserId) {
          navigate(`/u/${counterpartUserId}/chat`);
        }
      } catch (error) {
        showError(error instanceof Error ? error.message : "Failed to update opportunity");
      } finally {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
      }
    },
    [opportunitiesService, navigate, showError, showSuccess, refreshConversations],
  );

  /**
   * Start Chat handler for an orchestrator-streamed draft card. Uses the
   * atomic POST /opportunities/:id/start-chat endpoint (Plan B Task 8) to
   * flip the opp to `accepted` and resolve the pair's conversation in one
   * round-trip, then navigates to the h2h chat. Falls back to a counterpart-
   * page route if the conversation ID is missing for any reason.
   */
  const handleStreamingDraftStartChat = useCallback(
    async (opportunityId: string, counterpartUserId: string) => {
      setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
      try {
        const result = await opportunitiesService.startChat(opportunityId);
        setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: "accepted" }));
        refreshConversations();
        // Always route to the h2h chat page (`/u/:peer/chat`). `/chat/:id`
        // is the A2A negotiation route and does not render the in-chat
        // opportunity context.
        navigate(`/u/${result.counterpartUserId ?? counterpartUserId}/chat`);
      } catch (error) {
        showError(error instanceof Error ? error.message : "Failed to start chat");
      } finally {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
      }
    },
    [opportunitiesService, navigate, showError, refreshConversations],
  );

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
        console.error("[AI Chat] Upload failed:", err);
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

  const inviteModalElement = inviteModal ? (
    <InviteMessageModal
      userName={inviteModal.userName}
      message={inviteModal.message}
      loading={inviteModal.loading}
      onMessageChange={(msg) => setInviteModal((prev) => prev ? { ...prev, message: msg } : null)}
      onConfirm={() => {
        const resolve = inviteModalResolveRef.current;
        const msg = inviteModal.message;
        inviteModalResolveRef.current = null;
        setInviteModal(null);
        resolve?.(msg);
      }}
      onCancel={() => {
        const resolve = inviteModalResolveRef.current;
        inviteModalResolveRef.current = null;
        setInviteModal(null);
        resolve?.(null);
      }}
    />
  ) : null;

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

  // HOME STATE - No messages yet
  if (messages.length === 0) {
    const personalIndex = indexes.find((i) => i.isPersonal);
    const selectedIndex = indexes.find((i) => selectedNetworkIds.includes(i.id));

    const renderScopeDropdown = () => {
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

    // API-driven home view (dynamic sections with Lucide icons)
    if (USE_HOME_API) {
      if (
        homeViewLoading ||
        (homeViewData && homeViewData.sections.length > 0)
      ) {
        return (
          <>
          {inviteModalElement}
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
                  className={cn("flex flex-col bg-[#FCFCFC] border border-[#E9E9E9] rounded-4xl px-4 py-3 mb-6", selectedFiles.length > 0 && "gap-2")}
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
              {homeViewLoading ? (
                <div className="animate-pulse">
                  {[1, 2].map((s) => (
                    <div key={s} className={s === 1 ? "mt-12" : "mt-6"}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-3.5 h-3.5 bg-gray-200 rounded-sm" />
                        <div className="h-3 w-32 bg-gray-200 rounded-sm" />
                      </div>
                      <div className="space-y-3">
                        {[1, 2].map((c) => (
                          <OpportunitySkeleton key={c} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                homeViewData?.sections.map((section) => (
                  <div
                    key={section.id}
                    className={
                      section.id === homeViewData.sections[0]?.id
                        ? "mt-12"
                        : "mt-6"
                    }
                  >
                    <h3 className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider mb-3 font-ibm-plex-mono text-left flex items-center gap-2">
                      <span className="w-3.5 h-3.5 shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                        <DynamicIcon name={section.iconName as IconName} />
                      </span>
                      {section.title}
                    </h3>
                    <div className="space-y-3">
                      {section.items.map((item) => (
                        <OpportunityCard
                          key={item.opportunityId}
                          card={item}
                          onPrimaryAction={(
                            oppId,
                            userId,
                            viewerRole,
                            counterpartName,
                            isGhost,
                          ) =>
                            handleHomeOpportunityAction(
                              oppId,
                              "accepted",
                              userId,
                              viewerRole,
                              counterpartName,
                              isGhost,
                            )
                          }
                          onSecondaryAction={(
                            oppId,
                            userId,
                            viewerRole,
                            counterpartName,
                            isGhost,
                          ) =>
                            handleHomeOpportunityAction(
                              oppId,
                              "rejected",
                              userId,
                              viewerRole,
                              counterpartName,
                              isGhost,
                            )
                          }
                          isLoading={
                            !!opportunityActionLoading[item.opportunityId]
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </ContentContainer>
          </div>
          </>
        );
      }
    }

    // Empty state — no opportunities to show
    return (
      <div className="px-6 lg:px-8 bg-white pb-12">
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
          <div className="py-2"></div>
          <div className="mt-0 flex flex-col items-center text-center pb-4">
            <video
              src="/loading.m4v"
              autoPlay
              loop
              muted
              playsInline
              className="mb-8 w-85 h-75 object-contain"
            />
            <h2 className="text-lg font-bold text-gray-900 font-ibm-plex-mono mb-3">
              It&apos;s quiet here, but your signal is in motion
            </h2>
            <p className="text-sm font-normal text-[#3D3D3D] max-w-sm leading-relaxed font-ibm-plex-mono">
              I&apos;m watching for the right people. While I look, you can add
              more about what you&apos;re working on, connect your network, or
              ask me to research someone specific.
            </p>
          </div>
        </ContentContainer>
      </div>
    );
  }

  // CONVERSATION MODE - Has messages
  const boundIndexId = sessionNetworkId ?? selectedIndexId;
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
                              handleHomeOpportunityAction(
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
                              handleHomeOpportunityAction(
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
              <InjectedQuestions
                questions={injectedByMessageId.get(null)!}
                onAnswer={handleInjectedAnswer}
                onDismiss={handleInjectedDismiss}
              />
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
