import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGmailConnect } from "@/hooks/useGmailConnect";
import { useNavigate } from "react-router";
import { ArrowUp, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAIChat } from "@/contexts/AIChatContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunities, useNetworks } from "@/contexts/APIContext";
import { useNetworksState } from "@/contexts/IndexesContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiClient } from "@/lib/api";
import { ToolCallsDisplay } from "@/components/chat/ToolCallsDisplay";
import AssistantMessageContent from "@/components/chat/AssistantMessageContent";
import { SuggestionChips } from "@/components/chat/SuggestionChips";
import { MentionsTextInput } from "@/components/MentionsInput";
import { cn } from "@/lib/utils";
import { mentionsToMarkdownLinks } from "@/lib/mentions";
import type { Suggestion } from "@/hooks/useSuggestions";
import NetworksPanel from "@/components/chat/NetworksPanel";
import { log } from "@/lib/logger";

const logger = log.page.from("onboarding");

/** Step-specific suggestions for onboarding. */
const ONBOARDING_STEP_SUGGESTIONS: Record<string, Suggestion[]> = {
  identity: [
    { label: "Yes, that's me!", type: "direct", followupText: "Yes, that's me!" },
    { label: "No, here's my LinkedIn", type: "prompt", prefill: "No, here's my LinkedIn: " },
    { label: "No, here's my Twitter", type: "prompt", prefill: "No, here's my Twitter: " },
  ],
  identity_no_name: [
    { label: "I'm ...", type: "prompt", prefill: "I'm " },
    { label: "Here's my LinkedIn", type: "prompt", prefill: "Here's my LinkedIn: " },
    { label: "Here's my Twitter", type: "prompt", prefill: "Here's my Twitter: " },
  ],
  profile: [
    { label: "That's right", type: "direct", followupText: "That's right" },
    { label: "No, let me fix that", type: "prompt", prefill: "No, let me fix that: " },
    { label: "Add more about my work", type: "direct", followupText: "Can you add more details about my work?" },
  ],
  gmail: [
    { label: "Skip for now", type: "direct", followupText: "Skip for now" },
  ],
  communities: [
    { label: "Continue", type: "direct", followupText: "I'll skip joining networks for now, let's continue" },
  ],
  intent: [
    { label: "Building something", type: "prompt", prefill: "Building something " },
    { label: "Exploring partnerships", type: "prompt", prefill: "Exploring partnerships " },
    { label: "Hiring", type: "prompt", prefill: "Hiring " },
    { label: "Raising", type: "prompt", prefill: "Raising " },
  ],
};

const GREETING_PREAMBLE = `Hi, I'm Index, your social agent. I help the right people find you — and help you find them.

I learn what you're working on, what you care about, and what you're open to right now. From there, I exchange signals with other agents and quietly look for moments where things line up — when a conversation makes sense, when an idea connects, or when an opportunity becomes real. When someone shows up, I'll tell you why and what could happen between you two.

Let's get you set up.`;

function buildGreeting(hasName: boolean, userName?: string): string {
  return hasName
    ? `${GREETING_PREAMBLE}\nYou're ${userName}, right?`
    : `${GREETING_PREAMBLE} What's your name, and what's your LinkedIn, Twitter/X, or GitHub?`;
}

// ---------------------------------------------------------------------------
// OnboardingPage
// ---------------------------------------------------------------------------

interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  wasStoppedByUser?: boolean;
  stoppedAt?: number;
  traceEvents?: import("@/contexts/AIChatContext").TraceEvent[];
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, refetchUser } = useAuthContext();
  const {
    messages: chatMessages,
    sendOnboardingMessage: sendOnboardingTurn,
    isLoading,
    stopStream,
    sessionId,
    clearChat,
  } = useAIChat();

  const opportunitiesService = useOpportunities();
  const indexesService = useNetworks();
  const { refreshIndexes } = useNetworksState();
  const { error: showError } = useNotifications();

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { OAuthLink } = useGmailConnect(useCallback(() => {
    sendOnboardingTurn("I've connected my account, please continue with the import.", undefined, undefined, { hidden: true });
  }, [sendOnboardingTurn]));

  // Opportunity & intent proposal action state
  const [opportunityActionLoading, setOpportunityActionLoading] = useState<Record<string, boolean>>({});
  const [opportunityStatusMap, setOpportunityStatusMap] = useState<Record<string, string>>({});
  const [intentProposalStatusMap, setIntentProposalStatusMap] = useState<Record<string, "pending" | "created" | "rejected">>({});
  const [proposalIntentMap, setProposalIntentMap] = useState<Record<string, string>>({});
  const [networkPanelPendingJoinIds, setNetworkPanelPendingJoinIds] = useState<Set<string>>(new Set());

  const hasName = !!user?.name?.trim();
  const fullGreeting = buildGreeting(hasName, hasName ? `**${user?.name?.trim()}**` : undefined);

  // Stream the greeting on mount (typewriter effect)
  const [streamedGreeting, setStreamedGreeting] = useState("");
  const [greetingComplete, setGreetingComplete] = useState(false);
  useEffect(() => {
    if (greetingComplete || !fullGreeting || !user) return;
    let index = 0;
    const chunkSize = 2;
    const intervalMs = 15;
    const timer = setInterval(() => {
      index = Math.min(index + chunkSize, fullGreeting.length);
      setStreamedGreeting(fullGreeting.slice(0, index));
      if (index >= fullGreeting.length) {
        setGreetingComplete(true);
        clearInterval(timer);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [fullGreeting, greetingComplete, user]);

  // Combine streamed greeting with live chat messages
  const greetingMessage: LocalMessage = {
    id: "onboarding-greeting",
    role: "assistant",
    content: streamedGreeting,
    isStreaming: !greetingComplete,
  };

  const allMessages: LocalMessage[] = [
    greetingMessage,
    ...chatMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      isStreaming: m.isStreaming,
      wasStoppedByUser: m.wasStoppedByUser,
      stoppedAt: m.stoppedAt,
      traceEvents: m.traceEvents,
    })),
  ];

  // Scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length, chatMessages[chatMessages.length - 1]?.content]);

  // Clear chat state on mount so we start a fresh session
  useEffect(() => {
    clearChat({ abortStream: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After each stream completes, refetch user to check if onboarding was completed
  const prevLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      refetchUser();
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, refetchUser]);



  // After stream completes with pending network join IDs, clear them and refresh sidebar
  const prevNetworkJoinLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevNetworkJoinLoadingRef.current && !isLoading && networkPanelPendingJoinIds.size > 0) {
      setNetworkPanelPendingJoinIds(new Set());
      void refreshIndexes();
    }
    prevNetworkJoinLoadingRef.current = isLoading;
  }, [isLoading, networkPanelPendingJoinIds.size, refreshIndexes]);

  // Slide transition: sidebar slides in from left, content shifts right
  const [isTransitioning, setIsTransitioning] = useState(false);
  const hasTriggeredRedirect = useRef(false);

  useEffect(() => {
    if (!user?.onboarding?.completedAt || hasTriggeredRedirect.current) return;
    hasTriggeredRedirect.current = true;

    // Always refresh so any new memberships appear in the sidebar immediately
    void refreshIndexes();

    // Accept pending invitation deferred from /l/:code (only after onboarding completes)
    const pendingCode = localStorage.getItem('pendingInviteCode');
    if (pendingCode) {
      indexesService
        .acceptInvitation(pendingCode)
        .then(async () => {
          localStorage.removeItem('pendingInviteCode');
          await refreshIndexes();
        })
        .catch((err) => {
          // Keep code in localStorage so user can retry via the invitation link
          logger.error('Failed to accept deferred invitation', { error: err });
          showError('Could not join the network from your invitation link. Please try the link again.');
        });
    }

    setIsTransitioning(true);
    const target = sessionId ? `/d/${sessionId}` : "/";
    const timer = setTimeout(() => navigate(target, { replace: true }), 700);
    return () => clearTimeout(timer);
  }, [user?.onboarding?.completedAt, sessionId, navigate, indexesService, refreshIndexes, showError]);

  // Opportunity actions
  const handleOpportunityAction = useCallback(
    async (opportunityId: string, action: "accepted" | "rejected", userId: string, viewerRole?: string, counterpartName?: string) => {
      setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
      try {
        await opportunitiesService.updateOpportunityStatus(opportunityId, action);
        setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: action }));
      } catch {
        showError("Failed to update opportunity");
      } finally {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
      }
    },
    [opportunitiesService, showError],
  );

  const handleIntentProposalApprove = useCallback(
    async (proposalId: string, description: string, networkId?: string) => {
      setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "pending" }));
      try {
        const result = await opportunitiesService.approveIntentProposal(proposalId, description, networkId);
        setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "created" }));
        if (result?.intentId) {
          setProposalIntentMap((prev) => ({ ...prev, [proposalId]: result.intentId }));
        }
      } catch {
        setIntentProposalStatusMap((prev) => {
          const next = { ...prev };
          delete next[proposalId];
          return next;
        });
        showError("Failed to create intent");
      }
    },
    [opportunitiesService, showError],
  );

  const handleIntentProposalReject = useCallback(
    async (proposalId: string) => {
      try {
        await apiClient.post("/intents/reject", { proposalId });
        setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "rejected" }));
      } catch {
        showError("Failed to reject proposal");
      }
    },
    [showError],
  );

  const archiveProposalIntent = useCallback(
    async (proposalId: string, intentId: string) => {
      try {
        await opportunitiesService.archiveIntent(intentId);
        setIntentProposalStatusMap((prev) => {
          const next = { ...prev };
          delete next[proposalId];
          return next;
        });
        setProposalIntentMap((prev) => {
          const next = { ...prev };
          delete next[proposalId];
          return next;
        });
      } catch {
        showError("Failed to undo");
      }
    },
    [opportunitiesService, showError],
  );

  const handleIntentProposalUndo = useCallback(
    async (proposalId: string) => {
      const intentId = proposalIntentMap[proposalId];
      if (!intentId) return;
      await archiveProposalIntent(proposalId, intentId);
    },
    [proposalIntentMap, archiveProposalIntent],
  );

  // Include the greeting as a prefill on the first server-clamped onboarding turn.
  const sendOnboardingMessage = useCallback(
    (message: string) => {
      const isFirstMessage = !sessionId;
      if (isFirstMessage) {
        return sendOnboardingTurn(message, undefined, undefined, {
          prefillMessages: [{ role: "assistant" as const, content: fullGreeting }],
        });
      }
      return sendOnboardingTurn(message);
    },
    [sessionId, sendOnboardingTurn, fullGreeting],
  );

  const handleNetworkJoin = useCallback(
    (networkId: string, networkTitle: string) => {
      setNetworkPanelPendingJoinIds((prev) => new Set([...prev, networkId]));
      sendOnboardingMessage(`I'd like to join ${networkTitle}`);
    },
    [sendOnboardingMessage],
  );

  // Infer onboarding step from last assistant message to show step-specific suggestions
  const onboardingStep = useMemo(() => {
    const lastAssistant = [...allMessages].reverse().find((m) => m.role === "assistant");
    const content = (lastAssistant?.content ?? "").toLowerCase();
    const userCount = chatMessages.filter((m) => m.role === "user").length;

    if (userCount === 0) return hasName ? "identity" : "identity_no_name";
    if (content.includes("does that sound right") || content.includes("here's what i found")) return "profile";
    if (content.includes("connect your google account") || content.includes("connect gmail")) return "gmail";
    if (content.includes("communities you might find relevant")) return "communities";
    if (content.includes("what are you open to") || content.includes("open to right now")) return "intent";
    return "identity";
  }, [allMessages, chatMessages, hasName]);

  const suggestions: Suggestion[] = ONBOARDING_STEP_SUGGESTIONS[onboardingStep] ?? [];

  const handleSuggestionClick = useCallback(
    (suggestion: Suggestion) => {
      if (isLoading) return;
      if (suggestion.type === "prompt" && suggestion.prefill) {
        setInput(suggestion.prefill);
        inputRef.current?.focus();
      } else {
        const text = suggestion.followupText ?? suggestion.label;
        sendOnboardingMessage(text);
      }
    },
    [isLoading, sendOnboardingMessage],
  );

  // Submit
  const canSend = input.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || isLoading) return;
    const message = input.trim();
    setInput("");
    await sendOnboardingMessage(message);
    inputRef.current?.focus();
  };

  // Auto-focus input on keypress
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === "Backspace") {
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen bg-[#FDFDFD] overflow-hidden">
      {/* Sidebar panel that slides in on completion */}
      <div
        className={cn(
          "shrink-0 h-full bg-white border-r border-gray-200 transition-all duration-600 ease-in-out overflow-hidden",
          isTransitioning ? "w-64 opacity-100" : "w-0 opacity-0",
        )}
      />

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Minimal header - fades out during transition */}
        <header className={cn(
          "shrink-0 px-6 py-4 transition-opacity duration-400",
          isTransitioning && "opacity-0",
        )}>
          <img
            src="/logos/logo-black-full.svg"
            alt="Index Network"
            width={160}
            height={28}
            className="object-contain"
          />
        </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 lg:px-8 pb-32">
        <div className="max-w-3xl mx-auto space-y-4">
          {allMessages.map((msg) => (
            <div key={msg.id}>
              <div className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                {msg.role === "user" ? (
                  <div className="w-fit max-w-[75%] bg-[#FAFAFA] text-gray-900 border border-[#E8E8E8] rounded-4xl px-4 py-1 text-sm leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{ p: ({ children }) => <span className="block">{children}</span> }}
                    >
                      {mentionsToMarkdownLinks(msg.content)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="w-full text-gray-900">
                    {msg.id !== "onboarding-greeting" && (
                      <span className="text-[10px] uppercase tracking-wider text-black font-bold mb-1 block">
                        Index
                      </span>
                    )}
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
                          onOpportunityPrimaryAction={(id, userId, role, name) =>
                            handleOpportunityAction(id, "accepted", userId, role, name)
                          }
                          onOpportunitySecondaryAction={(id, userId, role, name) =>
                            handleOpportunityAction(id, "rejected", userId, role, name)
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
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={scrollRef} />
        </div>
      </div>

      {/* Fixed input at bottom */}
      <div className="sticky bottom-0 z-20">
        <div className="px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            {!isLoading && (
              <SuggestionChips
                suggestions={suggestions}
                disabled={false}
                onSuggestionClick={handleSuggestionClick}
              />
            )}
            <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
              <form
                onSubmit={handleSubmit}
                className="flex flex-col bg-[#FCFCFC] border border-[#E9E9E9] rounded-4xl px-4 py-3"
              >
                <div className="flex gap-3 items-center">
                  <MentionsTextInput
                    value={input}
                    onChange={setInput}
                    placeholder="What's on your mind?"
                    disabled={isLoading}
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
                      className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </form>
            </div>
            <div className="py-2 bg-white" />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export const Component = OnboardingPage;
