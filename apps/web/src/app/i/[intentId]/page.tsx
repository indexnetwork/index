import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowUp, ChevronLeft, Loader2, Pause, Pencil, Trash2 } from "lucide-react";

import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import OpportunityCard from "@/components/chat/OpportunityCardInChat";
import { QuestionCard } from "./QuestionCard";
import { useIntents, useOpportunities, useQuestionsService } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunityActions } from "@/hooks/useOpportunityActions";
import type { HomeViewCardItem, OpportunityLifecycleStatus } from "@/services/opportunities";
import type { AnswerBody, PendingQuestion } from "@/services/questions";
import { cn } from "@/lib/utils";

/** Raw opportunity status -> radar display bucket (mirrors the Hermes dashboard). */
const STATUS_BUCKET: Record<string, string> = {
  latent: "pending",
  draft: "pending",
  pending: "pending",
  negotiating: "negotiating",
  stalled: "negotiating",
  accepted: "accepted",
  rejected: "rejected",
  expired: "expired",
};

const RADAR_BUCKETS: Array<{ key: string; label: string }> = [
  { key: "pending", label: "Awaiting you" },
  { key: "negotiating", label: "Negotiating" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "expired", label: "Missed" },
];

function bucketForStatus(status?: string): string {
  return STATUS_BUCKET[status ?? ""] ?? "pending";
}

/** Prototype canned agent replies to a user message (no backend). */
const AGENT_REPLIES = [
  "Got it — I'll factor that in while I look.",
  "Noted. I'll keep an eye out for that.",
  "Makes sense — I'll sharpen what I surface.",
  "Thanks, that helps. I'll adjust the search.",
  "Understood. I'll weave that into the signal.",
];

/** Pick a canned agent reply. Prototype only. */
function agentReply(): string {
  return AGENT_REPLIES[Math.floor(Math.random() * AGENT_REPLIES.length)];
}

/** Compact relative time for the answered thread, e.g. "just now", "2d ago". */
function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Lifecycle statuses the radar fetches: the full pipeline except chat-only
 * drafts. This switches the home view into lifecycle mode (terminal statuses
 * pass through; latent/pending stay gated by viewer actionability).
 */
const RADAR_STATUSES: OpportunityLifecycleStatus[] = [
  "latent",
  "pending",
  "negotiating",
  "stalled",
  "accepted",
  "rejected",
  "expired",
];

/** Icon-only action button in the intent detail header (Pause / Edit / Archive). */
function ActionChip({
  icon,
  title,
  tone = "text-gray-400 hover:text-gray-700 hover:bg-gray-100",
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  tone?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center rounded p-1.5 leading-none transition-colors [&>svg]:h-4 [&>svg]:w-4",
        tone,
      )}
    >
      {icon}
    </button>
  );
}

/** Selectable radar status filter tab: a label with a subtle count badge. */
function StatPill({
  value,
  label,
  active,
  onSelect,
}: {
  value: number;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-[#041729] text-white"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "min-w-[18px] rounded-full px-1 py-px text-center text-[10px] font-semibold tabular-nums",
          active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500",
        )}
      >
        {value}
      </span>
    </button>
  );
}

/**
 * Standing free-form input pinned at the bottom of the Questions panel. Lets the
 * user tell the agent anything about this signal at any time — the text is fed
 * to the intent's refine flow (same effect as the header ✎ input). Independent
 * of the pending-question cards above it.
 */
function AgentMessageInput({
  onSend,
}: {
  onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const send = useCallback(async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    const ok = await onSend(value);
    if (ok) setText("");
    setSending(false);
  }, [text, sending, onSend]);

  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-400 font-ibm-plex-mono">
        Message the agent
      </p>
      <div className="flex items-center gap-2 pl-5 pr-2 py-1.5 rounded-full border border-[#E9E9E9] bg-[#FCFCFC] focus-within:border-[#041729] transition-colors">
        <input
          type="text"
          placeholder="tell the agent anything about this signal…"
          value={text}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || sending}
          className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Send message to agent"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

/** Card-style panel used for the Questions and Radar columns. */
function Panel({
  title,
  count,
  description,
  media,
  children,
  className,
}: {
  title: string;
  count?: number;
  description?: string;
  media?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-4">
        <h3 className="flex items-center gap-2 text-base font-bold tracking-[0.2em] text-[#3D3D3D] font-ibm-plex-mono">
          <span>
            {title}
            {count !== undefined && ` (${count})`}
          </span>
          {media}
        </h3>
        {description && (
          <p className="mt-1.5 text-sm text-gray-500">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Intent detail view. Mirrors the Hermes dashboard intent-detail layout: a
 * detail header card with a live indicator and Pause/Edit/Archive actions, a
 * primary Questions panel, and a Radar panel with a status filter strip.
 */
export default function IntentDetailPage() {
  const navigate = useNavigate();
  const { intentId } = useParams<{ intentId: string }>();
  const intentsService = useIntents();
  const opportunitiesService = useOpportunities();
  const questionsService = useQuestionsService();
  const { error: showError } = useNotifications();

  const [intent, setIntent] = useState<Awaited<
    ReturnType<typeof intentsService.getIntent>
  > | null>(null);
  const [intentLoading, setIntentLoading] = useState(true);
  const [opportunities, setOpportunities] = useState<HomeViewCardItem[]>([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(true);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  // Answered questions kept in view as a conversation thread (oldest first).
  // Conversation thread: answered questions (with a `prompt`) and free-form
  // messages the user sends (no `prompt`), oldest first.
  const [answered, setAnswered] = useState<
    Array<{
      id: string;
      prompt?: string;
      response: string;
      answeredAt?: string;
      from?: "user" | "agent";
    }>
  >([]);
  // Which pending question is currently shown (navigable via the header pager).
  const [questionIndex, setQuestionIndex] = useState(0);
  // Chat-style conversation column: scrolls internally, pinned to the bottom so
  // the newest question is always in view above the composer.
  const conversationRef = useRef<HTMLDivElement>(null);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState("pending");

  const scope = useMemo(
    () =>
      intentId
        ? { scopeType: "intent" as const, scopeId: intentId }
        : undefined,
    [intentId],
  );

  const {
    opportunityStatusMap,
    opportunityActionLoading,
    handleOpportunityAction,
    inviteModalElement,
  } = useOpportunityActions({ scope });

  /** Monotonic load id — guards against out-of-order responses when a reload
   * (e.g. after refine) starts while a previous two-phase load is in flight. */
  const loadSeqRef = useRef(0);

  const loadOpportunities = useCallback(async () => {
    if (!intentId) return;
    const seq = ++loadSeqRef.current;
    setOpportunitiesLoading(true);
    const baseOptions = {
      scopeType: "intent" as const,
      scopeId: intentId,
      statuses: RADAR_STATUSES,
    };
    // Phase 1 (fast, LLM-free): identity + status for every card. Paints the
    // status pills and the connection cards immediately; cards missing from
    // the presenter cache arrive with presentationPending and shimmer their
    // body until phase 2 replaces them.
    try {
      const fast = await opportunitiesService.getHomeView({
        ...baseOptions,
        presentation: "skeleton",
      });
      if (seq !== loadSeqRef.current) return;
      setOpportunities(fast.sections.flatMap((s) => s.items));
      setOpportunitiesLoading(false);
    } catch {
      // Skeleton phase is best-effort — fall through to the full fetch.
    }
    // Phase 2 (full): presenter text for cache misses; replaces the whole list.
    try {
      const res = await opportunitiesService.getHomeView(baseOptions);
      if (seq !== loadSeqRef.current) return;
      setOpportunities(res.sections.flatMap((s) => s.items));
    } catch {
      if (seq !== loadSeqRef.current) return;
      setOpportunities([]);
    } finally {
      if (seq === loadSeqRef.current) setOpportunitiesLoading(false);
    }
  }, [intentId, opportunitiesService]);

  useEffect(() => {
    if (!intentId) return;
    let active = true;
    setIntentLoading(true);
    intentsService
      .getIntent(intentId)
      .then((res) => {
        if (active) setIntent(res);
      })
      .catch(() => {
        if (active) setIntent(null);
      })
      .finally(() => {
        if (active) setIntentLoading(false);
      });
    questionsService
      .getPending({ scopeType: "intent", scopeId: intentId })
      .then((res) => {
        if (active) setQuestions(res);
      })
      .catch(() => {});
    void loadOpportunities();
    return () => {
      active = false;
    };
  }, [intentId, intentsService, questionsService, loadOpportunities]);

  // Keep the conversation pinned to the newest question. Scroll after paint
  // (double rAF) so the freshly-rendered question card is measured first.
  useEffect(() => {
    const el = conversationRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [answered, questions, questionIndex]);

  const handleArchive = useCallback(async () => {
    if (!intentId) return;
    if (!window.confirm("Archive this intent? It will stop matching.")) return;
    try {
      await intentsService.archiveIntent(intentId);
      navigate("/");
    } catch {
      showError("Failed to archive intent");
    }
  }, [intentId, intentsService, navigate, showError]);

  /** Feed free-form text to the intent's refine flow and reload matches.
   * Shared by the header ✎ input and the Questions-panel agent message input.
   * Returns whether the refine succeeded so callers can clear their input. */
  const submitRefine = useCallback(
    async (raw: string): Promise<boolean> => {
      const text = raw.trim();
      if (!intentId || !text) return false;
      try {
        const updated = await intentsService.refineIntent(intentId, text);
        setIntent(updated);
        void loadOpportunities();
        return true;
      } catch {
        showError("Failed to refine intent");
        return false;
      }
    },
    [intentId, intentsService, loadOpportunities, showError],
  );

  const handleRefine = useCallback(async () => {
    if (refining) return;
    setRefining(true);
    const ok = await submitRefine(refineText);
    if (ok) {
      setRefineText("");
      setShowRefine(false);
    }
    setRefining(false);
  }, [refining, refineText, submitRefine]);

  const handleAnswer = useCallback(
    async (questionId: string, body: AnswerBody) => {
      await questionsService.answer(questionId, body);
      const q = questions.find((x) => x.id === questionId);
      if (q) {
        const response =
          body.freeText?.trim() || body.selectedOptions.join(", ");
        setAnswered((prev) => [
          ...prev,
          {
            id: questionId,
            prompt: q.payload.prompt,
            response,
            answeredAt: new Date().toISOString(),
          },
        ]);
      }
      setQuestions((prev) => prev.filter((x) => x.id !== questionId));
    },
    [questionsService, questions],
  );

  const handleDismiss = useCallback(
    async (questionId: string) => {
      await questionsService.dismiss(questionId);
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    },
    [questionsService],
  );

  // Prototype: a sent message posts straight into the conversation thread
  // (no backend), and the agent streams back a canned reply character by
  // character (typewriter) after a short beat.
  const handleSendMessage = useCallback(async (text: string): Promise<boolean> => {
    const value = text.trim();
    if (!value) return false;
    setAnswered((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        response: value,
        answeredAt: new Date().toISOString(),
        from: "user",
      },
    ]);
    const agentId = crypto.randomUUID();
    const full = agentReply();
    window.setTimeout(() => {
      setAnswered((prev) => [
        ...prev,
        { id: agentId, response: "", from: "agent" },
      ]);
      let i = 0;
      const tick = () => {
        i += 1;
        setAnswered((prev) =>
          prev.map((m) =>
            m.id === agentId ? { ...m, response: full.slice(0, i) } : m,
          ),
        );
        if (i < full.length) window.setTimeout(tick, 22);
      };
      tick();
    }, 450);
    return true;
  }, []);

  const bucketOf = useCallback(
    // Local actions (accept/reject in this session) override the fetched status.
    (item: HomeViewCardItem) =>
      bucketForStatus(opportunityStatusMap[item.opportunityId] ?? item.status),
    [opportunityStatusMap],
  );

  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of opportunities) {
      const b = bucketOf(item);
      counts[b] = (counts[b] ?? 0) + 1;
    }
    return counts;
  }, [opportunities, bucketOf]);

  const visibleOpportunities = useMemo(
    () => opportunities.filter((item) => bucketOf(item) === selectedBucket),
    [opportunities, bucketOf, selectedBucket],
  );

  // Clamp the pager index to the current queue; the shown question follows it.
  const currentQuestionIndex =
    questions.length === 0
      ? 0
      : Math.min(questionIndex, questions.length - 1);
  const currentQuestion = questions[currentQuestionIndex];

  const title = (
    intent?.summary && intent.summary.trim().length > 0
      ? intent.summary
      : (intent?.payload ?? "")
  ).trim();

  return (
    <ClientLayout>
      {inviteModalElement}
      <div className="flex h-full min-h-0 flex-col px-10 lg:px-16 py-6">
        <ContentContainer size="xwide" className="flex min-h-0 flex-1 flex-col">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-black transition-colors"
            aria-label="Back to home"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          {intentLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : !intent ? (
            <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
              Intent not found
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-6 shrink-0 rounded-lg border border-gray-200 bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                  <h1 className="text-base font-bold text-black font-ibm-plex-mono leading-snug">
                    {title}
                  </h1>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <ActionChip
                      icon={<Pause />}
                      title="Pause"
                      tone="text-amber-500 hover:text-amber-600 hover:bg-amber-50"
                    />
                    <ActionChip
                      icon={<Pencil />}
                      title="Edit"
                      onClick={() => setShowRefine((v) => !v)}
                    />
                    <ActionChip
                      icon={<Trash2 />}
                      title="Archive"
                      tone="text-red-400 hover:text-red-500 hover:bg-red-50"
                      onClick={handleArchive}
                    />
                  </div>
                </div>
                <div className="mt-2.5 flex items-center gap-2 text-xs text-gray-500 font-ibm-plex-mono">
                  <span className="inline-flex items-center gap-1.5 rounded border border-green-300 px-1.5 py-0.5 font-medium lowercase tracking-wide text-green-600">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                    </span>
                    live
                  </span>
                </div>

                {showRefine && (
                  <div className="mt-4 flex items-center gap-2">
                    <input
                      type="text"
                      value={refineText}
                      onChange={(e) => setRefineText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRefine();
                      }}
                      placeholder="Refine this signal..."
                      disabled={refining}
                      autoFocus
                      className="flex-1 text-sm bg-[#FCFCFC] border border-[#E9E9E9] rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30"
                    />
                    <button
                      type="button"
                      onClick={handleRefine}
                      disabled={refining || !refineText.trim()}
                      className="shrink-0 px-4 py-2 rounded-full bg-[#041729] text-white text-sm font-medium hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {refining ? "Refining..." : "Refine"}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-8 lg:flex-row">
                <section
                  className={cn(
                    "flex min-h-0 min-w-0 flex-1 flex-col lg:w-2/5 lg:flex-none",
                    // When there's no conversation yet, take natural height
                    // instead of stretching, so the empty state stays compact.
                    answered.length === 0 &&
                      questions.length === 0 &&
                      "lg:self-start",
                  )}
                >
                  <div className="mb-4 shrink-0">
                    <h3 className="flex items-center gap-2 text-base font-bold tracking-[0.2em] text-[#3D3D3D] font-ibm-plex-mono">
                      <span>Questions</span>
                    </h3>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div
                      ref={conversationRef}
                      className="flex-1 overflow-y-auto pr-1"
                    >
                      <div
                        className={cn(
                          "flex min-h-full flex-col gap-5",
                          answered.length > 0 || questions.length > 0
                            ? "justify-end"
                            : "justify-center",
                        )}
                      >
                        {answered.length > 0 && (
                          <div className="flex flex-col gap-3">
                            {answered.map((a) => (
                              <div key={a.id} className="px-1">
                                {a.from === "agent" ? (
                                  <p className="text-[13px] leading-relaxed text-gray-500">
                                    {a.response}
                                  </p>
                                ) : (
                                  <>
                                    {a.prompt && (
                                      <p className="text-[13px] text-gray-400">
                                        {a.prompt}
                                        {a.answeredAt && (
                                          <span className="text-gray-300">
                                            {" · "}
                                            {timeAgo(a.answeredAt)}
                                          </span>
                                        )}
                                      </p>
                                    )}
                                    <p className="mt-0.5 flex gap-1.5 text-[13px] text-gray-900 font-ibm-plex-mono">
                                      <span className="text-gray-400">›</span>
                                      <span>{a.response}</span>
                                    </p>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {currentQuestion && (
                          // One question at a time, selected by the header pager;
                          // answering/dismissing it surfaces the next.
                          <QuestionCard
                            question={currentQuestion}
                            onAnswer={handleAnswer}
                            onDismiss={handleDismiss}
                            onPrev={
                              questions.length > 1
                                ? () =>
                                    setQuestionIndex(
                                      Math.max(currentQuestionIndex - 1, 0),
                                    )
                                : undefined
                            }
                            onNext={
                              questions.length > 1
                                ? () =>
                                    setQuestionIndex(
                                      Math.min(
                                        currentQuestionIndex + 1,
                                        questions.length - 1,
                                      ),
                                    )
                                : undefined
                            }
                            canPrev={currentQuestionIndex > 0}
                            canNext={currentQuestionIndex < questions.length - 1}
                          />
                        )}
                      </div>
                    </div>
                    <div className="pt-4 shrink-0">
                      <AgentMessageInput onSend={handleSendMessage} />
                    </div>
                  </div>
                </section>

                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:w-3/5 lg:flex-none">
                <Panel
                  title="Radar"
                  description="People the network surfaced for this intent."
                  media={
                    <img
                      src="/eye.webp"
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      className="h-6 w-auto object-contain"
                    />
                  }
                >
                  <div className="mb-4 flex flex-wrap gap-2">
                    {RADAR_BUCKETS.map((bucket) => (
                      <StatPill
                        key={bucket.key}
                        value={bucketCounts[bucket.key] ?? 0}
                        label={bucket.label}
                        active={selectedBucket === bucket.key}
                        onSelect={() => setSelectedBucket(bucket.key)}
                      />
                    ))}
                  </div>
                  {opportunitiesLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                  ) : visibleOpportunities.length === 0 ? (
                    <div className="text-sm text-gray-500 font-ibm-plex-mono py-8 text-center border border-dashed border-gray-200 rounded-lg">
                      No matches here yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {visibleOpportunities.map((item) => (
                        <OpportunityCard
                          key={item.opportunityId}
                          card={item}
                          currentStatus={
                            opportunityStatusMap[item.opportunityId]
                          }
                          onPrimaryAction={(
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
                          onSecondaryAction={(
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
                          isLoading={
                            !!opportunityActionLoading[item.opportunityId]
                          }
                        />
                      ))}
                    </div>
                  )}
                </Panel>
                </div>
              </div>
            </div>
          )}
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = IntentDetailPage;
