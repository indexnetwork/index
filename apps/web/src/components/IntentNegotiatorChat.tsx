import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, BotMessageSquare, Square } from "lucide-react";

import { useAIChat } from "@/contexts/AIChatContext";
import { AnsweredQuestionLog } from "@/components/InjectedQuestions/AnsweredQuestionLog";
import type { AnsweredThreadEntry } from "@/components/InjectedQuestions/AnsweredQuestionLog";
import { InjectedQuestions } from "@/components/InjectedQuestions/InjectedQuestions";
import { QuestionsEmptyState } from "@/components/InjectedQuestions/QuestionsEmptyState";
import AssistantMessageContent from "@/components/chat/AssistantMessageContent";
import { ToolCallsDisplay } from "@/components/chat/ToolCallsDisplay";
import type { PendingQuestion, AnswerBody } from "@/services/questions";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { log } from "@/lib/logger";

const logger = log.ui.from("IntentNegotiatorChat");

export interface IntentNegotiatorChatProps {
  /** The intent this chat is pinned to. */
  intentId: string;
  /** Pending questions for the intent — rendered as the chat's opening turns. */
  questions: PendingQuestion[];
  /** Answered questions retained above the pending opening turns. */
  answered: AnsweredThreadEntry[];
  onAnswerQuestion: (questionId: string, body: AnswerBody) => Promise<void>;
  onDismissQuestion: (questionId: string) => Promise<void>;
  /**
   * A pool-discovery answer was just submitted and a chained follow-up may
   * be incoming — render a typing indicator below the question cards.
   */
  questionChainPending?: boolean;
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
   * flag turned off between /auth/me and now). The parent falls back to the
   * static questions block.
   */
  onUnavailable: () => void;
}

/**
 * Intent-pinned negotiator chat (P4.2 / IND-403).
 *
 * Replaces the static questions block on the intent page with a chat window
 * to the user's personal negotiator, pinned to this intent. Pending intent
 * questions render as the opening turns (cards, answered through the
 * existing questions pipeline); everything conversational streams through
 * the shared AIChatContext against the per-intent negotiator session.
 */
export default function IntentNegotiatorChat({
  intentId,
  questions,
  answered,
  onAnswerQuestion,
  onDismissQuestion,
  questionChainPending,
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
    clearChat,
    sessionId,
  } = useAIChat();

  const [agentName, setAgentName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const clearChatRef = useRef(clearChat);
  const appliedRefreshVersionRef = useRef(0);
  useEffect(() => {
    clearChatRef.current = clearChat;
  }, [clearChat]);

  // Intent-proposal card status (lean subset of ChatContent's tracking).
  const [proposalStatusMap, setProposalStatusMap] = useState<Record<string, "pending" | "created" | "rejected">>({});
  const [proposalIntentMap, setProposalIntentMap] = useState<Record<string, string>>({});

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
      }>("/chat/negotiator/session", { intentId })
      .then(async ({ session, agent }) => {
        if (!active) return;
        setAgentName(agent.name);
        await loadSession(session.id);
        if (active) setReady(true);
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
  }, [messages, questions.length, questionChainPending, ready]);

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
            {messages.length === 0 && (answered.length > 0 || questions.length === 0) && (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-2 text-sm text-gray-600 font-ibm-plex-mono">
                  <BotMessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <p>
                    This is your direct line to {agentName ?? "your Personal Agent"} about this intent —
                    ask who it found, why, what it's waiting on, or tell it how to negotiate on your
                    behalf.
                  </p>
                </div>
                {answered.length === 0 && !questionChainPending && <QuestionsEmptyState />}
              </div>
            )}

            {answered.length > 0 && (
              <div data-testid="negotiator-answered-log">
                <AnsweredQuestionLog entries={answered} />
              </div>
            )}

            {(questions.length > 0 || questionChainPending) && (
              <div data-testid="negotiator-opening-questions">
                <p className="mb-2 text-xs uppercase tracking-wider text-gray-500 font-ibm-plex-mono">
                  Your Personal Agent needs your input
                </p>
                <InjectedQuestions
                  questions={questions}
                  onAnswer={onAnswerQuestion}
                  onDismiss={onDismissQuestion}
                  showTypingIndicator={questionChainPending}
                />
              </div>
            )}

            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#041729] px-4 py-2 text-sm text-white whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="text-sm text-gray-900">
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
                  />
                </div>
              ),
            )}
          </>
        )}
        <div ref={scrollRef} />
      </div>

      <div className="mt-2 flex shrink-0 items-center gap-2 border-t border-gray-100 pt-2">
        <input
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
