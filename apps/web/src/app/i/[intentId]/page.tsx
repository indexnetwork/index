import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowUp, Brain, ChevronLeft, Loader2, LoaderCircle, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { Link } from "react-router";

import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import OpportunityCard, { OpportunitySkeleton } from "@/components/chat/OpportunityCardInChat";
import { InjectedQuestions } from "@/components/InjectedQuestions/InjectedQuestions";
import IntentMemoryStrip from "@/components/IntentMemoryStrip";
import IntentNegotiatorChat from "@/components/IntentNegotiatorChat";
import { useAuthContext } from "@/contexts/AuthContext";
import { useIntents, useOpportunities, useQuestionsService } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useQuestions } from "@/contexts/QuestionsContext";
import { useOpportunityActions } from "@/hooks/useOpportunityActions";
import { useIntentVisitPing } from "@/hooks/useIntentVisitPing";
import type { HomeViewCardItem, OpportunityLifecycleStatus } from "@/services/opportunities";
import type { IntentLifecycleStatus, MutableIntentLifecycleStatus } from "@/services/intents";
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

function normalizeIntentLifecycleStatus(status: unknown): IntentLifecycleStatus {
  if (
    status === "PAUSED" ||
    status === "FULFILLED" ||
    status === "EXPIRED"
  ) {
    return status;
  }
  return "ACTIVE";
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
  disabled = false,
  busy = false,
}: {
  icon: React.ReactNode;
  title: string;
  tone?: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-busy={busy || undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded p-1.5 leading-none transition-colors [&>svg]:h-4 [&>svg]:w-4",
        tone,
        disabled && "cursor-not-allowed opacity-50",
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
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
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
  );
}

/** Card-style panel used for the Questions and Radar columns. */
function Panel({
  title,
  count,
  description,
  media,
  action,
  children,
  className,
}: {
  title: string;
  count?: number;
  description?: string;
  media?: React.ReactNode;
  /** Right-aligned header affordance (e.g. a link to a related surface). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <div className="mb-2.5 shrink-0">
        <h3 className="flex items-center gap-2 text-sm font-bold tracking-[0.2em] text-[#3D3D3D] font-ibm-plex-mono">
          <span>
            {title}
            {count !== undefined && ` (${count})`}
          </span>
          {media}
          {action && <span className="ml-auto">{action}</span>}
        </h3>
        {description && (
          <p className="mt-1 text-xs text-gray-500">{description}</p>
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
  useIntentVisitPing(intentId);
  const { refresh: refreshQuestionCounts } = useQuestions();
  const { error: showError } = useNotifications();
  const { user, features } = useAuthContext();

  const [intent, setIntent] = useState<Awaited<
    ReturnType<typeof intentsService.getIntent>
  > | null>(null);
  const [intentLoading, setIntentLoading] = useState(true);
  const [intentStatusPending, setIntentStatusPending] = useState<{
    intentId: string;
    status: MutableIntentLifecycleStatus;
  } | null>(null);
  const lifecycleMutationRef = useRef<{
    intentId: string;
    generation: number;
  } | null>(null);
  const lifecycleGenerationRef = useRef(0);
  const activeIntentIdRef = useRef(intentId);
  const [opportunities, setOpportunities] = useState<HomeViewCardItem[]>([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(true);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  // Interview-mode chaining (IND-418): after a pool_discovery answer, the
  // backend may synchronously persist a follow-up — show a typing indicator,
  // refetch once, and append any new pool_discovery card.
  const [questionChainPending, setQuestionChainPending] = useState(false);
  /** Bumps make the intent negotiator reload its stable session on pool beats. */
  const [negotiatorRefreshVersion, setNegotiatorRefreshVersion] = useState(0);
  /** Every question id ever displayed — so a chain refetch only appends new cards. */
  const seenQuestionIdsRef = useRef<Set<string>>(new Set());
  const chainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const clearReactionTimers = useCallback(() => {
    for (const timer of reactionTimersRef.current) clearTimeout(timer);
    reactionTimersRef.current = [];
  }, []);
  useEffect(
    () => () => {
      if (chainTimerRef.current) clearTimeout(chainTimerRef.current);
      clearReactionTimers();
    },
    [clearReactionTimers],
  );
  // Conversation thread: answered questions kept in view (oldest first).
  const [answered, setAnswered] = useState<
    Array<{
      id: string;
      prompt?: string;
      response: string;
      answeredAt?: string;
    }>
  >([]);
  // Chat-style conversation column: scrolls internally, pinned to the bottom so
  // the newest question is always in view above the composer.
  const conversationRef = useRef<HTMLDivElement>(null);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState("pending");
  // Backend-surfaced flag (features on /auth/me): when on, the static
  // questions block becomes the negotiator chat window (P4.2/IND-403).
  // `chatUnavailable` is the runtime fallback if the bootstrap fails.
  const [chatUnavailable, setChatUnavailable] = useState(false);
  const negotiatorChatEnabled = features?.negotiatorChat === true && !chatUnavailable;

  useLayoutEffect(() => {
    activeIntentIdRef.current = intentId;
    lifecycleGenerationRef.current += 1;
    lifecycleMutationRef.current = null;
    clearReactionTimers();
    if (chainTimerRef.current) {
      clearTimeout(chainTimerRef.current);
      chainTimerRef.current = null;
    }
  }, [intentId, clearReactionTimers]);

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

  const loadQuestions = useCallback(async (appendOnly = false) => {
    if (!intentId) return;
    try {
      const res = await questionsService.getPending({
        scopeType: "intent",
        scopeId: intentId,
      });
      if (activeIntentIdRef.current !== intentId) return;
      for (const question of res) seenQuestionIdsRef.current.add(question.id);
      if (!appendOnly) {
        setQuestions(res);
        return;
      }
      setQuestions((current) => {
        const currentIds = new Set(current.map((question) => question.id));
        const fresh = res.filter((question) => !currentIds.has(question.id));
        return fresh.length > 0 ? [...current, ...fresh] : current;
      });
    } catch {
      // Best-effort refresh; keep already-rendered questions on failure.
    }
  }, [intentId, questionsService]);

  const loadOpportunities = useCallback(async (preserveExisting = false) => {
    if (!intentId) return;
    const seq = ++loadSeqRef.current;
    if (!preserveExisting) setOpportunitiesLoading(true);
    const applyItems = (items: HomeViewCardItem[]) => {
      if (!preserveExisting) {
        setOpportunities(items);
        return;
      }
      setOpportunities((current) => {
        const merged = new Map(current.map((item) => [item.opportunityId, item]));
        for (const item of items) merged.set(item.opportunityId, item);
        return [...merged.values()];
      });
    };
    const baseOptions = {
      scopeType: "intent" as const,
      scopeId: intentId,
      statuses: RADAR_STATUSES,
    };
    // Phase 1 (fast, LLM-free): identity + status for every card. Paints the
    // status pills and the connection cards immediately; cards missing from
    // the presenter cache arrive with presentationPending and shimmer their
    // body until phase 2 replaces them.
    if (!preserveExisting) {
      try {
        const fast = await opportunitiesService.getHomeView({
          ...baseOptions,
          presentation: "skeleton",
        });
        if (seq !== loadSeqRef.current) return;
        applyItems(fast.sections.flatMap((s) => s.items));
        setOpportunitiesLoading(false);
      } catch {
        // Skeleton phase is best-effort — fall through to the full fetch.
      }
    }
    // Phase 2 (full): presenter text for cache misses; replaces the whole list.
    try {
      const res = await opportunitiesService.getHomeView(baseOptions);
      if (seq !== loadSeqRef.current) return;
      applyItems(res.sections.flatMap((s) => s.items));
    } catch {
      if (seq !== loadSeqRef.current) return;
      if (!preserveExisting) setOpportunities([]);
    } finally {
      if (seq === loadSeqRef.current && !preserveExisting) setOpportunitiesLoading(false);
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
    void loadQuestions();
    void loadOpportunities();
    return () => {
      active = false;
    };
  }, [intentId, intentsService, loadQuestions, loadOpportunities]);

  const refreshWorkspaceAfterReaction = useCallback((includeQuestions: boolean) => {
    setNegotiatorRefreshVersion((version) => version + 1);
    void loadOpportunities(true);
    if (includeQuestions) void loadQuestions(true);
  }, [loadOpportunities, loadQuestions]);

  const scheduleBoundedWorkspaceRefresh = useCallback(
    ({ includeQuestions }: { includeQuestions: boolean }) => {
      clearReactionTimers();
      refreshWorkspaceAfterReaction(includeQuestions);
      reactionTimersRef.current = [1_500, 65_000, 90_000, 120_000, 180_000].map((delay) =>
        setTimeout(() => refreshWorkspaceAfterReaction(includeQuestions), delay),
      );
    },
    [clearReactionTimers, refreshWorkspaceAfterReaction],
  );

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
  }, [answered, questions]);

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

  const handleSetIntentStatus = useCallback(
    async (status: MutableIntentLifecycleStatus) => {
      if (!intentId || lifecycleMutationRef.current?.intentId === intentId) return;

      const generation = ++lifecycleGenerationRef.current;
      const request = { intentId, generation };
      lifecycleMutationRef.current = request;
      setIntentStatusPending({ intentId, status });
      const isCurrentRequest = () =>
        activeIntentIdRef.current === request.intentId
        && lifecycleMutationRef.current?.intentId === request.intentId
        && lifecycleMutationRef.current.generation === request.generation;
      try {
        const updated = await intentsService.setIntentStatus(intentId, status);
        if (!isCurrentRequest()) return;
        setIntent((current: typeof intent) =>
          current?.id === request.intentId
            ? { ...current, status: updated.status }
            : current,
        );
        if (status === "ACTIVE" && updated.status === "ACTIVE") {
          scheduleBoundedWorkspaceRefresh({ includeQuestions: true });
        }
      } catch {
        if (!isCurrentRequest()) return;
        showError(
          status === "PAUSED"
            ? "Failed to pause intent"
            : "Failed to resume intent",
        );
      } finally {
        if (isCurrentRequest()) {
          lifecycleMutationRef.current = null;
          setIntentStatusPending(null);
        }
      }
    },
    [intentId, intentsService, scheduleBoundedWorkspaceRefresh, showError],
  );

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
      const answered = questions.find((q) => q.id === questionId);
      await questionsService.answer(questionId, body);
      // Keep the answered exchange visible in the conversation thread.
      if (answered) {
        const response = body.freeText?.trim() || body.selectedOptions.join(", ");
        setAnswered((prev) => [
          ...prev,
          {
            id: questionId,
            prompt: answered.payload.prompt,
            response,
            answeredAt: new Date().toISOString(),
          },
        ]);
      }
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
      void refreshQuestionCounts();
      // Chain once per answer: a pool_discovery answer may have synchronously
      // produced a follow-up question — refetch shortly and append it.
      if (answered?.detection?.mode === "pool_discovery" && intentId) {
        // The answer endpoint persists first and dispatches reactions
        // asynchronously. Refresh now, shortly for Beat 1, and only at bounded
        // Tier-1 checkpoints through three minutes for Beat 2/retries — no
        // permanent polling.
        scheduleBoundedWorkspaceRefresh({ includeQuestions: false });

        setQuestionChainPending(true);
        if (chainTimerRef.current) clearTimeout(chainTimerRef.current);
        chainTimerRef.current = setTimeout(async () => {
          try {
            const refreshed = await questionsService.getPending({
              scopeType: "intent",
              scopeId: intentId,
            });
            const fresh = refreshed.filter(
              (q) =>
                q.detection?.mode === "pool_discovery" &&
                !seenQuestionIdsRef.current.has(q.id),
            );
            for (const q of fresh) seenQuestionIdsRef.current.add(q.id);
            if (fresh.length > 0) {
              setQuestions((current) => [...current, ...fresh]);
            }
          } catch {
            // Best-effort — the follow-up will surface on the next visit.
          } finally {
            await refreshQuestionCounts();
            setQuestionChainPending(false);
          }
        }, 1200);
      }
    },
    [questions, questionsService, intentId, refreshQuestionCounts, scheduleBoundedWorkspaceRefresh],
  );

  const handleDismiss = useCallback(
    async (questionId: string) => {
      await questionsService.dismiss(questionId);
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
      void refreshQuestionCounts();
    },
    [questionsService, refreshQuestionCounts],
  );

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

  const title = (
    intent?.summary && intent.summary.trim().length > 0
      ? intent.summary
      : (intent?.payload ?? "")
  ).trim();
  const lifecycleStatus = normalizeIntentLifecycleStatus(intent?.status);
  const lifecycleBusy = intentStatusPending?.intentId === intentId;

  return (
    <ClientLayout>
      {inviteModalElement}
      <div className="flex h-full min-h-0 flex-col px-10 lg:px-16 py-6">
        <ContentContainer size="xwide" className="flex min-h-0 flex-1 flex-col">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mb-3 inline-flex shrink-0 items-center gap-1 self-start text-sm text-gray-600 hover:text-black transition-colors"
            aria-label="Back to home"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          {!intentLoading && !intent ? (
            <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
              Intent not found
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Header card: skeleton while the intent loads — the workspace
                  below renders (and fetches) immediately, in parallel. */}
              <div className="mb-6 shrink-0 rounded-lg border border-gray-200 bg-white p-5">
                {intentLoading ? (
                  <div className="animate-pulse space-y-3" data-testid="intent-header-skeleton">
                    <div className="h-4 w-2/3 rounded bg-gray-200" />
                    <div className="h-3.5 w-52 rounded bg-gray-200" />
                  </div>
                ) : (
                  <>
                <div className="flex items-start justify-between gap-4">
                  <h1 className="text-sm font-bold text-black font-ibm-plex-mono leading-snug">
                    {title}
                  </h1>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {lifecycleStatus === "ACTIVE" && (
                      <ActionChip
                        icon={
                          lifecycleBusy
                            ? <LoaderCircle className="animate-spin" />
                            : <Pause />
                        }
                        title="Pause"
                        tone="text-amber-500 hover:text-amber-600 hover:bg-amber-50"
                        onClick={() => void handleSetIntentStatus("PAUSED")}
                        disabled={lifecycleBusy}
                        busy={lifecycleBusy}
                      />
                    )}
                    {lifecycleStatus === "PAUSED" && (
                      <ActionChip
                        icon={
                          lifecycleBusy
                            ? <LoaderCircle className="animate-spin" />
                            : <Play />
                        }
                        title="Resume"
                        tone="text-green-600 hover:text-green-700 hover:bg-green-50"
                        onClick={() => void handleSetIntentStatus("ACTIVE")}
                        disabled={lifecycleBusy}
                        busy={lifecycleBusy}
                      />
                    )}
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
                  {lifecycleStatus === "ACTIVE" && (
                    <>
                      <span className="inline-flex items-center gap-1.5 rounded border border-green-300 px-1.5 py-0.5 font-medium lowercase tracking-wide text-green-600">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                        </span>
                        live
                      </span>
                      <span>agent is looking in the background</span>
                    </>
                  )}
                  {lifecycleStatus === "PAUSED" && (
                    <>
                      <span className="inline-flex items-center rounded border border-amber-300 px-1.5 py-0.5 font-medium lowercase tracking-wide text-amber-600">
                        paused
                      </span>
                      <span>
                        background discovery is paused; existing Radar matches
                        and questions remain available
                      </span>
                    </>
                  )}
                  {lifecycleStatus === "FULFILLED" && (
                    <>
                      <span className="inline-flex items-center rounded border border-gray-300 px-1.5 py-0.5 font-medium lowercase tracking-wide text-gray-600">
                        fulfilled
                      </span>
                      <span>this intent has been fulfilled</span>
                    </>
                  )}
                  {lifecycleStatus === "EXPIRED" && (
                    <>
                      <span className="inline-flex items-center rounded border border-gray-300 px-1.5 py-0.5 font-medium lowercase tracking-wide text-gray-600">
                        expired
                      </span>
                      <span>this intent has expired</span>
                    </>
                  )}
                </div>

                {showRefine && (
                  <div className="mt-3 flex items-center gap-2">
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
                      className="flex-1 text-sm text-gray-900 placeholder:text-gray-400 bg-[#FCFCFC] border border-[#E9E9E9] rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30"
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
                  </>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-8 lg:flex-row">
                {negotiatorChatEnabled && intentId ? (
                  <Panel
                    title="Personal Agent"
                    description="Your Personal Agent, scoped to this intent — ask what it's doing, steer it, or answer its follow-ups."
                    media={
                      questions.length > 0 ? (
                        <span
                          data-testid="intent-question-count"
                          className="bg-[#041729] text-white text-xs px-2 py-0.5 rounded-full min-w-[20px] text-center font-sans normal-case tracking-normal"
                        >
                          {questions.length > 99 ? "99+" : questions.length}
                        </span>
                      ) : undefined
                    }
                    action={
                      <Link
                        to="/agent/memory"
                        data-testid="intent-agent-memory-link"
                        className="inline-flex items-center gap-1 text-[11px] font-medium normal-case tracking-normal text-gray-400 hover:text-gray-700"
                      >
                        <Brain className="h-3.5 w-3.5" />
                        Memory
                      </Link>
                    }
                    className="lg:flex-[2]"
                  >
                    {user?.id && (
                      <IntentMemoryStrip intentId={intentId} userId={user.id} />
                    )}
                    <IntentNegotiatorChat
                      key={intentId}
                      intentId={intentId}
                      questions={questions}
                      onAnswerQuestion={handleAnswer}
                      onDismissQuestion={handleDismiss}
                      questionChainPending={questionChainPending}
                      refreshVersion={negotiatorRefreshVersion}
                      opportunityStatusMap={opportunityStatusMap}
                      opportunityActionLoading={opportunityActionLoading}
                      onOpportunityAction={(id, action, userId, role, name) =>
                        handleOpportunityAction(id, action, userId, role, name)
                      }
                      onUnavailable={() => setChatUnavailable(true)}
                    />
                  </Panel>
                ) : (
                  <section className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-[2]">
                    <div className="mb-4 shrink-0">
                      <h3 className="flex items-center gap-2 text-base font-bold tracking-[0.2em] text-[#3D3D3D] font-ibm-plex-mono">
                        <span>
                          Questions{questions.length > 0 ? ` (${questions.length})` : ""}
                        </span>
                      </h3>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div
                        ref={conversationRef}
                        className="flex-1 overflow-y-auto pr-1"
                      >
                        <div className="flex min-h-full flex-col justify-end gap-5">
                          {answered.length === 0 && questions.length === 0 && !questionChainPending && (
                            // Nothing to answer yet — the agent is still working
                            // the room on this signal.
                            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                              <video
                                autoPlay
                                loop
                                muted
                                playsInline
                                // The clip is matted on opaque white; multiply
                                // blends it into the page background.
                                className="w-44 mix-blend-multiply"
                              >
                                <source
                                  src="/loading-tree.m4v"
                                  type="video/mp4"
                                />
                              </video>
                              <p className="max-w-[19rem] text-[13px] leading-relaxed text-gray-400">
                                Your agent is negotiating. Nothing needs you yet.
                              </p>
                            </div>
                          )}
                          {answered.length > 0 && (
                            <div className="flex flex-col gap-3">
                              {answered.map((a) => (
                                <div key={a.id} className="px-1">
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
                                </div>
                              ))}
                            </div>
                          )}
                          {(questions.length > 0 || questionChainPending) && (
                            <InjectedQuestions
                              questions={questions}
                              onAnswer={handleAnswer}
                              onDismiss={handleDismiss}
                              showTypingIndicator={questionChainPending}
                              paginate
                            />
                          )}
                        </div>
                      </div>
                      <div className="pt-4 shrink-0">
                        <AgentMessageInput onSend={submitRefine} />
                      </div>
                    </div>
                  </section>
                )}

                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:flex-[3]">
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
                  <div className="mb-3 flex shrink-0 flex-wrap gap-1.5">
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
                  <div className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
                  {opportunitiesLoading ? (
                    <div className="space-y-3" data-testid="radar-skeleton">
                      <OpportunitySkeleton />
                      <OpportunitySkeleton />
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
                  </div>
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
