import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, BotMessageSquare, Square } from "lucide-react";

import { useAIChat } from "@/contexts/AIChatContext";
import { useConversation } from "@/contexts/ConversationContext";
import AssistantMessageContent from "@/components/chat/AssistantMessageContent";
import { DecisionQuestions } from "@/components/DecisionQuestions";
import { QuestionRegenerationIndicator } from "@/components/chat/QuestionSteps";
import { ToolCallsDisplay } from "@/components/chat/ToolCallsDisplay";
import { PersonalAgentDebugTrace } from "@/components/PersonalAgentTimeline";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { log } from "@/lib/logger";
import type { IntentCycleTimelineEntry } from "@/services/conversation";

const logger = log.ui.from("IntentNegotiatorChat");

interface TraceChatMessage {
  id: string;
  timestamp: Date;
}

interface TraceGroup {
  id: string;
  entries: IntentCycleTimelineEntry[];
  createdAt: Date;
  inputMessageId: string | null;
  outputMessageId: string | null;
}

interface TracePlacement {
  before: Map<string, TraceGroup[]>;
  after: Map<string, TraceGroup[]>;
  tail: TraceGroup[];
}

function recordString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" && record[key].trim() ? record[key] : null;
}

/**
 * Durable acts normally precede the message they explain, except
 * `message_user`: its ledger row is written after delivery. The message ids
 * recorded with a turn make that causal position exact; older rows fall back
 * to their timestamp without pretending to know more than they do.
 */
function placeTraceGroups(messages: TraceChatMessage[], entries: IntentCycleTimelineEntry[]): TracePlacement {
  const groups = new Map<string, TraceGroup>();
  for (const entry of entries) {
    const traceId = recordString(entry.event, "traceId");
    const groupId = traceId ?? `legacy-${entry.id}`;
    const createdAt = new Date(entry.createdAt);
    const current = groups.get(groupId);
    const inputMessageId = recordString(entry.event, "messageId");
    const outputMessageId = recordString(entry.act, "messageId");
    if (current) {
      current.entries.push(entry);
      if (createdAt < current.createdAt) current.createdAt = createdAt;
      current.inputMessageId ??= inputMessageId;
      current.outputMessageId ??= outputMessageId;
    } else {
      groups.set(groupId, {
        id: groupId,
        entries: [entry],
        createdAt,
        inputMessageId,
        outputMessageId,
      });
    }
  }

  const knownMessageIds = new Set(messages.map((message) => message.id));
  const placement: TracePlacement = { before: new Map(), after: new Map(), tail: [] };
  const add = (target: Map<string, TraceGroup[]>, messageId: string, group: TraceGroup) => {
    const existing = target.get(messageId) ?? [];
    existing.push(group);
    target.set(messageId, existing);
  };
  for (const group of [...groups.values()].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())) {
    if (group.outputMessageId && knownMessageIds.has(group.outputMessageId)) {
      add(placement.before, group.outputMessageId, group);
    } else if (group.inputMessageId && knownMessageIds.has(group.inputMessageId)) {
      add(placement.after, group.inputMessageId, group);
    } else {
      const nextMessage = messages.find((message) => message.timestamp.getTime() > group.createdAt.getTime());
      if (nextMessage) add(placement.before, nextMessage.id, group);
      else placement.tail.push(group);
    }
  }
  return placement;
}

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
  /** Owner-scoped append-only IS-A ledger, loaded by the intent workspace. */
  timelineEntries: IntentCycleTimelineEntry[];
  timelineLoading: boolean;
  timelineError: boolean;
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
  /** Revalidate the intent workspace after a durable agent message arrives. */
  onLiveInvalidation?: () => void;
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
  timelineEntries,
  timelineLoading,
  timelineError,
  opportunityStatusMap,
  opportunityActionLoading,
  onOpportunityAction,
  onUnavailable,
  onLiveInvalidation,
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
  const { subscribeQuestionRegeneration, subscribePersonalAgentTurnCompleted, subscribeConversationMessage } = useConversation();

  const [agentName, setAgentName] = useState<string | null>(null);
  const [bootstrapRegenerationPending, setBootstrapRegenerationPending] = useState(false);
  const [liveRegenerationPending, setLiveRegenerationPending] = useState<boolean | null>(null);
  const [regenerationReloadToken, setRegenerationReloadToken] = useState(0);
  const appliedRegenerationReloadRef = useRef(0);
  const [turnReloadToken, setTurnReloadToken] = useState(0);
  const appliedTurnReloadRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [restoredHistoryLoaded, setRestoredHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [decisionQuestionsSubmittedIds, setDecisionQuestionsSubmittedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clearChatRef = useRef(clearChat);
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

  // Background IS-A work appends durable DM messages outside this component's
  // POST/SSE stream. Reconcile from the session only when no user reply is
  // streaming, preserving the original stream as the primary response path.
  useEffect(() => {
    return subscribePersonalAgentTurnCompleted((event) => {
      if (event.intentId === intentId) setTurnReloadToken((token) => token + 1);
    });
  }, [intentId, subscribePersonalAgentTurnCompleted]);

  // A2H writes can happen outside the local POST stream. Reconcile this
  // session on any persisted agent message, then let the parent refresh its
  // intent-scoped server snapshots.
  useEffect(() => {
    return subscribeConversationMessage((event) => {
      if (event.conversationId !== sessionId || event.message.role !== "agent") return;
      setTurnReloadToken((token) => token + 1);
      onLiveInvalidation?.();
    });
  }, [onLiveInvalidation, sessionId, subscribeConversationMessage]);

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

  useEffect(() => {
    if (!ready || !sessionId || turnReloadToken === appliedTurnReloadRef.current) return;
    if (isLoading) return;
    appliedTurnReloadRef.current = turnReloadToken;
    void loadSession(sessionId).catch((error) => {
      logger.warn("Failed to reconcile completed PersonalAgent turn", { error, intentId });
    });
  }, [intentId, isLoading, loadSession, ready, sessionId, turnReloadToken]);

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
  const firstPendingQuestionIndex = messages.findIndex((message) => (
    message.role === "assistant"
    && message.decisionQuestions !== undefined
    && message.decisionQuestions.length > 0
    && !(message.decisionQuestionsSubmitted ?? decisionQuestionsSubmittedIds.has(message.id))
  ));
  // A principal question is a transcript barrier. Background agent activity
  // remains durable, but it must not appear to supersede a form the principal
  // has not submitted yet. Principal chat messages stay visible and do not
  // count as answers to the structured form.
  const visibleMessages = firstPendingQuestionIndex < 0
    ? messages
    : messages.filter((message, index) => (
      index <= firstPendingQuestionIndex || message.role === "user"
    ));
  const tracePlacement = useMemo(
    () => placeTraceGroups(visibleMessages, timelineEntries),
    [visibleMessages, timelineEntries],
  );
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

            {visibleMessages.map((msg, messageIndex) => {
              const previousMessage = messageIndex > 0 ? visibleMessages[messageIndex - 1] : undefined;
              const startsSession = previousMessage !== undefined
                && previousMessage.conversationSessionId !== msg.conversationSessionId;
              return (
                <Fragment key={`message-${msg.id}`}>
                  {tracePlacement.before.get(msg.id)?.map((group) => (
                    <PersonalAgentDebugTrace key={group.id} entries={group.entries} />
                  ))}
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
                      {msg.isStreaming && msg.agentActivityLabel && !msg.content.trim() ? (
                        <div
                          className="flex items-center gap-2 py-1 text-xs font-ibm-plex-mono text-gray-500"
                          role="status"
                          aria-live="polite"
                          data-testid="negotiator-agent-activity"
                        >
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4091BB]" />
                          <span>{msg.agentActivityLabel}</span>
                        </div>
                      ) : (
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
                      )}
                      {msg.decisionQuestions && msg.decisionQuestions.length > 0 && (
                        <DecisionQuestions
                          questions={msg.decisionQuestions}
                          submitted={
                            msg.decisionQuestionsSubmitted ??
                            decisionQuestionsSubmittedIds.has(msg.id)
                          }
                          onSubmit={(flattened) => {
                            setDecisionQuestionsSubmittedIds((previous) => {
                              const next = new Set(previous);
                              next.add(msg.id);
                              return next;
                            });
                            void sendMessage(flattened, {
                              decisionQuestionMessageIds: [msg.id],
                              onError: () => {
                                setDecisionQuestionsSubmittedIds((previous) => {
                                  const next = new Set(previous);
                                  next.delete(msg.id);
                                  return next;
                                });
                              },
                            });
                          }}
                        />
                      )}
                    </div>
                  )}
                  {tracePlacement.after.get(msg.id)?.map((group) => (
                    <PersonalAgentDebugTrace key={group.id} entries={group.entries} />
                  ))}
                </Fragment>
              );
            })}

            {tracePlacement.tail.map((group) => (
              <PersonalAgentDebugTrace key={group.id} entries={group.entries} />
            ))}
            {timelineLoading && <p role="status" className="text-xs text-gray-500">Loading agent trace…</p>}
            {timelineError && <p role="status" className="text-xs text-red-600">Agent trace could not be loaded.</p>}

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
