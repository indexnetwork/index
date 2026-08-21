import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, BotMessageSquare, Square } from "lucide-react";

import { useAIChat } from "@/contexts/AIChatContext";
import { useConversation } from "@/contexts/ConversationContext";
import AssistantMessageContent from "@/components/chat/AssistantMessageContent";
import { QuestionRegenerationIndicator } from "@/components/chat/QuestionSteps";
import { ToolCallsDisplay } from "@/components/chat/ToolCallsDisplay";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { log } from "@/lib/logger";

const logger = log.ui.from("IntentNegotiatorChat");

function formatRelativeTimestamp(timestamp: Date | undefined): string | null {
  if (!timestamp || Number.isNaN(timestamp.getTime())) return null;
  const elapsedMs = Date.now() - timestamp.getTime();
  const elapsedMinutes = Math.floor(Math.abs(elapsedMs) / 60_000);
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

export interface IntentNegotiatorChatProps {
  /** The intent this chat is pinned to. */
  intentId: string;
  /**
   * A question-message regeneration is queued or running for this
   * conversation — show an agent-working indicator so the user doesn't
   * answer a message that's about to be replaced. The component seeds this
   * from `questionRegenerationPending` on the POST /chat/negotiator/session
   * bootstrap response and then tracks the live SSE flips published by the
   * regeneration queue (reloading the session when a regeneration finishes,
   * so an in-place rewrite never lands silently); pass the prop only to
   * override both with an even fresher signal.
   */
  questionRegenerationPending?: boolean;
  /** Monotonic signal to reload server-appended Beat narration. */
  refreshVersion?: number;
  /** Opportunity card plumbing shared with the page's Radar panel. */
  opportunityStatusMap: Record<string, string>;
  opportunityActionLoading: Record<string, boolean>;
  onOpportunityAction: (
    opportunityId: string,
    action: "accepted" | "rejected",
    userId: string,
    viewerRole?: string,
    counterpartName?: string,
  ) => void;
  /**
   * Called when the negotiator chat cannot be bootstrapped (e.g. the backend
   * flag turned off between /auth/me and now). The parent falls back to a
   * static panel.
   */
  onUnavailable: () => void;
}

/**
 * Intent-pinned negotiator chat (P4.2 / IND-403).
 *
 * A chat window to the user's personal negotiator, pinned to this intent.
 * Questions are conversation: parked negotiations surface as the agent's own
 * question-messages in this thread (rendered as steps by
 * AssistantMessageContent), and replies route back automatically. Everything
 * streams through the shared AIChatContext against the per-intent negotiator
 * session.
 */
export default function IntentNegotiatorChat({
  intentId,
  questionRegenerationPending,
  refreshVersion = 0,
  opportunityStatusMap,
  opportunityActionLoading,
  onOpportunityAction,
  onUnavailable,
}: IntentNegotiatorChatProps) {
  const {
    messages,
    isLoading,
    sendMessage,
    stopStream,
    loadSession,
    loadPreviousMessages,
    hasPreviousSession,
    isLoadingPreviousMessages,
    clearChat,
    sessionId,
  } = useAIChat();
  const { subscribeQuestionRegeneration } = useConversation();

  const [agentName, setAgentName] = useState<string | null>(null);
  const [bootstrapRegenerationPending, setBootstrapRegenerationPending] = useState(false);
  const [liveRegenerationPending, setLiveRegenerationPending] = useState<boolean | null>(null);
  const [regenerationReloadToken, setRegenerationReloadToken] = useState(0);
  const appliedRegenerationReloadRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [restoredHistoryLoaded, setRestoredHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clearChatRef = useRef(clearChat);
  const appliedRefreshVersionRef = useRef(0);
  useEffect(() => {
    clearChatRef.current = clearChat;
  }, [clearChat]);

  // Intent-proposal card status (lean subset of ChatContent's tracking).
  const [proposalStatusMap, setProposalStatusMap] = useState<Record<string, "pending" | "created" | "rejected">>({});
  const [proposalIntentMap, setProposalIntentMap] = useState<Record<string, string>>({});

  // The prop overrides everything; otherwise the live SSE flip supersedes the
  // bootstrap snapshot once the first event for this intent arrives.
  const regenerationPending = questionRegenerationPending ?? liveRegenerationPending ?? bootstrapRegenerationPending;

  // Live regeneration flips from the shared conversation SSE stream: pending
  // true shows the indicator immediately; pending false means the job wrote
  // (possibly rewriting the open question-message in place), so the session
  // reloads to render the current content. The component remounts per intent
  // (key={intentId}), so the live state resets structurally.
  useEffect(() => {
    return subscribeQuestionRegeneration((event) => {
      if (event.intentId !== intentId) return;
      setLiveRegenerationPending(event.pending);
      if (!event.pending) setRegenerationReloadToken((token) => token + 1);
    });
  }, [intentId, subscribeQuestionRegeneration]);

  // Apply the reload outside the active stream: while the negotiator is
  // streaming, the shared context owns the message list, so wait for
  // isLoading to settle (the effect re-runs) before pulling fresh history.
  useEffect(() => {
    if (!ready || !sessionId || regenerationReloadToken === appliedRegenerationReloadRef.current) return;
    if (isLoading) return;
    appliedRegenerationReloadRef.current = regenerationReloadToken;
    void loadSession(sessionId).catch((error) => {
      logger.warn("Failed to reload after question-message regeneration", { error, intentId });
    });
  }, [intentId, isLoading, loadSession, ready, regenerationReloadToken, sessionId]);

  // Bootstrap: get-or-create the per-intent negotiator session, then load it
  // into the shared chat context. One session per (user, intent, persona) —
  // repeat visits land in the same conversation. The parent remounts this
  // component per intent (key={intentId}), so state resets are structural.
  useEffect(() => {
    let active = true;
    apiClient
      .post<{
        session: { id: string };
        created: boolean;
        agent: { id: string; name: string; description: string | null };
        questionRegenerationPending?: boolean;
      }>("/chat/negotiator/session", { intentId })
      .then(async ({ session, created, agent, questionRegenerationPending: pendingAtBootstrap }) => {
        if (!active) return;
        setAgentName(agent.name);
        setBootstrapRegenerationPending(Boolean(pendingAtBootstrap));
        const historyLoaded = await loadSession(session.id);
        if (active) {
          if (!created && historyLoaded) setRestoredHistoryLoaded(true);
          setReady(true);
        }
      })
      .catch((err) => {
        logger.error("Failed to bootstrap intent negotiator chat", { error: err, intentId });
        if (active) onUnavailable();
      });
    return () => {
      active = false;
      // Leave the intent page → release the shared chat context so the
      // negotiator session does not leak into the home chat.
      clearChatRef.current({ abortStream: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId]);

  // Server-side pool reactions append template messages outside the active
  // stream. Reload only when the parent emits one of its bounded checkpoints.
  useEffect(() => {
    if (!ready || !sessionId || refreshVersion <= appliedRefreshVersionRef.current) return;
    appliedRefreshVersionRef.current = refreshVersion;
    void loadSession(sessionId).catch((error) => {
      logger.warn("Failed to refresh intent negotiator session", { error, intentId });
    });
  }, [intentId, loadSession, ready, refreshVersion, sessionId]);

  // Follow the stream.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, regenerationPending, ready]);

  // Tap-to-quote from a question step: prefill the input with the question
  // being answered so the agent can route the reply. The answer itself stays
  // a plain chat message through the normal send path.
  const handleQuestionQuote = useCallback((prompt: string) => {
    const quoted = prompt.length > 140 ? `${prompt.slice(0, 139).trimEnd()}…` : prompt;
    setInput(`"${quoted}" — `);
    inputRef.current?.focus();
  }, []);

  // A chip is a canned reply, not a new answer channel: its text is sent
  // through the ordinary send path, so the agent's next turn cannot tell it
  // from something the user typed.
  const handleOptionSelect = useCallback(async (option: string) => {
    if (isLoading || !ready) return;
    setInput("");
    await sendMessage(option);
  }, [isLoading, ready, sendMessage]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || !ready) return;
    setInput("");
    await sendMessage(text);
  }, [input, isLoading, ready, sendMessage]);

  const handleProposalApprove = useCallback(
    async (proposalId: string, description: string, networkId?: string) => {
      const res = await apiClient.post<{ intentId: string }>("/intents/confirm", { proposalId, description, networkId });
      setProposalStatusMap((prev) => ({ ...prev, [proposalId]: "created" }));
      setProposalIntentMap((prev) => ({ ...prev, [proposalId]: res.intentId }));
    },
    [],
  );

  const handleProposalReject = useCallback(async (proposalId: string) => {
    await apiClient.post("/intents/reject", { proposalId });
    setProposalStatusMap((prev) => ({ ...prev, [proposalId]: "rejected" }));
  }, []);

  const handleProposalUndo = useCallback(
    async (proposalId: string) => {
      const createdIntentId = proposalIntentMap[proposalId];
      if (!createdIntentId) return;
      await apiClient.patch(`/intents/${createdIntentId}/archive`);
      setProposalStatusMap((prev) => ({ ...prev, [proposalId]: "rejected" }));
    },
    [proposalIntentMap],
  );

  const placeholder = agentName ? `Message ${agentName}…` : "Message your Personal Agent…";
  const hasRestoredHistory = restoredHistoryLoaded && messages.length > 0;
  const restoredHistoryLastActive = hasRestoredHistory
    ? formatRelativeTimestamp(messages[messages.length - 1]?.timestamp)
    : null;
  return (
    <div
      className="flex h-[520px] flex-col lg:h-auto lg:min-h-0 lg:flex-1"
      data-testid="intent-negotiator-chat"
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {!ready ? (
          /* Conversation-shaped skeleton while the session bootstraps. */
          <div className="animate-pulse space-y-4 pt-1" data-testid="negotiator-chat-skeleton" aria-hidden="true">
            <div className="flex justify-end">
              <div className="h-9 w-2/5 rounded-2xl rounded-br-md bg-gray-200" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-11/12 rounded bg-gray-200" />
              <div className="h-3 w-4/5 rounded bg-gray-200" />
              <div className="h-3 w-2/3 rounded bg-gray-200" />
            </div>
            <div className="flex justify-end">
              <div className="h-9 w-1/3 rounded-2xl rounded-br-md bg-gray-200" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-3/4 rounded bg-gray-200" />
              <div className="h-3 w-1/2 rounded bg-gray-200" />
            </div>
          </div>
        ) : (
          <>
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
            {messages.length === 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-2 text-sm text-gray-600 font-ibm-plex-mono">
                  <BotMessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <p>
                    This is your direct line to {agentName ?? "your Personal Agent"} about this signal —
                    ask who it found, why, what it's waiting on, or tell it how to negotiate on your
                    behalf.
                  </p>
                </div>
              </div>
            )}

            {hasRestoredHistory && (
              <div
                className="border-y border-gray-100 py-1 text-center text-[11px] text-gray-400 font-ibm-plex-mono"
                data-testid="negotiator-restored-history-divider"
                role="note"
              >
                earlier conversation
                {restoredHistoryLastActive ? ` · last active ${restoredHistoryLastActive}` : ""} — may not reflect current signal state
              </div>
            )}

            {messages.map((msg, messageIndex) => {
              const previousMessage = messageIndex > 0 ? messages[messageIndex - 1] : undefined;
              // Chips belong to an unanswered question only. Any later message
              // — the user's typed answer, their tapped chip, the agent's next
              // word — is that answer, so message order is the whole rule and
              // there is no "answered" state to keep.
              const options = messageIndex === messages.length - 1 && !msg.isStreaming
                ? msg.options ?? []
                : [];
              const startsSession = previousMessage !== undefined
                && previousMessage.conversationSessionId !== msg.conversationSessionId;
              return (
                <Fragment key={`message-${msg.id}`}>
                  {startsSession && (
                    <div className="flex items-center gap-3 py-3" role="separator" aria-label="Earlier chat session">
                      <span className="h-px flex-1 bg-gray-200" />
                      <span className="text-[10px] font-ibm-plex-mono uppercase tracking-[0.12em] text-gray-400">Earlier conversation</span>
                      <span className="h-px flex-1 bg-gray-200" />
                    </div>
                  )}
                  {msg.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#041729] px-4 py-2 text-sm text-white whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-900">
                      {msg.traceEvents && msg.traceEvents.length > 0 && (
                        <ToolCallsDisplay
                          traceEvents={msg.traceEvents}
                          isStreaming={msg.isStreaming}
                          wasStoppedByUser={msg.wasStoppedByUser}
                          stoppedAt={msg.stoppedAt}
                        />
                      )}
                      <AssistantMessageContent
                        content={msg.content}
                        isStreaming={msg.isStreaming ?? false}
                        onOpportunityPrimaryAction={(id, userId, role, name) =>
                          onOpportunityAction(id, "accepted", userId, role, name)
                        }
                        onOpportunitySecondaryAction={(id, userId, role, name) =>
                          onOpportunityAction(id, "rejected", userId, role, name)
                        }
                        opportunityLoadingMap={opportunityActionLoading}
                        currentStatusMap={opportunityStatusMap}
                        onIntentProposalApprove={handleProposalApprove}
                        onIntentProposalReject={handleProposalReject}
                        onIntentProposalUndo={handleProposalUndo}
                        intentProposalStatusMap={proposalStatusMap}
                        onQuestionQuote={handleQuestionQuote}
                      />
                      {options.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="negotiator-chat-options">
                          {options.map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => void handleOptionSelect(option)}
                              disabled={isLoading || !ready}
                              className="rounded-full border border-[#E9E9E9] bg-[#FCFCFC] px-3 py-1 text-xs font-ibm-plex-mono text-gray-700 transition-colors hover:border-[#4091BB] hover:text-[#041729] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })}

            {regenerationPending && <QuestionRegenerationIndicator />}
          </>
        )}
        <div ref={scrollRef} />
      </div>

      <div className="mt-2 flex shrink-0 items-center gap-2 border-t border-gray-100 pt-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={placeholder}
          disabled={!ready}
          data-testid="negotiator-chat-input"
          className="flex-1 rounded-full border border-[#E9E9E9] bg-[#FCFCFC] px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30 disabled:opacity-60"
        />
        {isLoading && sessionId ? (
          <button
            type="button"
            onClick={stopStream}
            aria-label="Stop response"
            className="shrink-0 rounded-full bg-[#041729] p-2 text-white hover:bg-[#0a2d4a]"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!ready || !input.trim()}
            aria-label="Send message"
            className={cn(
              "shrink-0 rounded-full bg-[#041729] p-2 text-white hover:bg-[#0a2d4a]",
              (!ready || !input.trim()) && "cursor-not-allowed opacity-50",
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
