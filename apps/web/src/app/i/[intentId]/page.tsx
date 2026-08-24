import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowUp, Brain, ChevronLeft, Loader2, LoaderCircle, MessageCircle, Pause, Pencil, Play, Trash2, X } from "lucide-react";
import { Link } from "react-router";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { FocusScope } from "@radix-ui/react-focus-scope";

import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import { Button } from "@/components/ui/button";
import OpportunityCard, { OpportunitySkeleton } from "@/components/chat/OpportunityCardInChat";
import IntentMemoryStrip from "@/components/IntentMemoryStrip";
import IntentNegotiatorChat from "@/components/IntentNegotiatorChat";
import IntentCycleInspector from "@/components/IntentCycleInspector";
import PersonalAgentTimeline from "@/components/PersonalAgentTimeline";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversations, useIntents, useOpportunities } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunityActions } from "@/hooks/useOpportunityActions";
import { useRadarLiveRefresh } from "@/hooks/useRadarLiveRefresh";
import { useIntentVisitPing } from "@/hooks/useIntentVisitPing";
import type { IntentCycleSnapshot, IntentCycleTimelineEntry } from "@/services/conversation";
import type { RadarCardItem, OpportunityLifecycleStatus } from "@/services/opportunities";
import type { IntentLifecycleStatus, MutableIntentLifecycleStatus } from "@/services/intents";
import { cn } from "@/lib/utils";
import { intentNegotiationActivityRevision } from "@/lib/intent-negotiation-activity";
import { DEFAULT_RADAR_BUCKET, radarBucketBadgeTone } from "@/lib/radar-buckets";

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

/** Bounded intent-refinement poll: interval (ms) and maximum total wait (ms). */
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
  bucketKey,
  value,
  label,
  active,
  onSelect,
}: {
  bucketKey: string;
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
          radarBucketBadgeTone(bucketKey, value, active),
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
 * Breakpoint query matching Tailwind's `lg`. Used ONLY for accessibility
 * semantics (role / aria-modal / inert / focus containment) — layout and
 * visibility stay pure Tailwind CSS. Focus containment and the
 * dialog-vs-region distinction genuinely cannot be expressed in CSS, which
 * is the sole reason a matchMedia switch exists here.
 */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia("(min-width: 1024px)");
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );
}

/**
 * Intent detail view. Mirrors the Hermes dashboard intent-detail layout: a
 * detail header card with a live indicator and Pause/Edit/Archive actions, a
 * Personal Agent column, and a Radar panel with a status filter strip. At lg+ the two columns are equal width (50/50) and the left
 * column is a plain labelled region; below lg the Radar is the primary
 * content and the left column becomes an off-canvas sheet (a modal dialog
 * with focus containment and an inert background while open). The sheet
 * stays mounted at all times, so the negotiator chat's live stream state
 * survives open/close and breakpoint changes.
 */
export default function IntentDetailPage() {
  const navigate = useNavigate();
  const { intentId } = useParams<{ intentId: string }>();
  const intentsService = useIntents();
  const opportunitiesService = useOpportunities();
  const conversationsService = useConversations();
  useIntentVisitPing(intentId);
  const { error: showError } = useNotifications();
  const { user } = useAuthContext();
  const { negotiations } = useConversation();

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
  const [opportunities, setOpportunities] = useState<RadarCardItem[]>([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(true);
  const opportunitiesLoadingRef = useRef(true);
  const [opportunitiesError, setOpportunitiesError] = useState(false);
  const [intentCycle, setIntentCycle] = useState<IntentCycleSnapshot | null>(null);
  const [intentCycleLoading, setIntentCycleLoading] = useState(true);
  const [intentCycleError, setIntentCycleError] = useState(false);
  const [intentTimeline, setIntentTimeline] = useState<IntentCycleTimelineEntry[]>([]);
  const [intentTimelineLoading, setIntentTimelineLoading] = useState(true);
  const [intentTimelineError, setIntentTimelineError] = useState(false);
  /** Bumps make the intent negotiator reload its stable session after lifecycle changes. */
  const [negotiatorRefreshVersion, setNegotiatorRefreshVersion] = useState(0);
  const reactionTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const clearReactionTimers = useCallback(() => {
    for (const timer of reactionTimersRef.current) clearTimeout(timer);
    reactionTimersRef.current = [];
  }, []);
  useEffect(
    () => () => {
      clearReactionTimers();
    },
    [clearReactionTimers],
  );
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState(DEFAULT_RADAR_BUCKET);
  // The left column is the signal's agent chat window. `chatUnavailable` is
  // the runtime fallback if the bootstrap fails.
  const [chatUnavailable, setChatUnavailable] = useState(false);
  const showNegotiatorPanel = !chatUnavailable && !!intentId;
  // Mobile (< lg): the Personal Agent column becomes an off-canvas sheet over
  // the Radar; this is its open state. Desktop (lg+) always shows the column.
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const isDesktop = useIsDesktop();
  /** True only while the column is presented as a mobile overlay sheet. */
  const sheetOverlayActive = agentPanelOpen && !isDesktop;
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetId = useId();
  const sheetTitleId = useId();
  const sheetDescriptionId = useId();
  // Focus choreography for the mobile sheet. The sheet is never unmounted
  // (to preserve the chat's live state), so Radix's mount/unmount auto-focus
  // hooks never fire — move focus into the sheet on open and back to the
  // trigger on every close path (Escape, outside press, close button).
  const wasSheetOpenRef = useRef(agentPanelOpen);
  useEffect(() => {
    const wasOpen = wasSheetOpenRef.current;
    wasSheetOpenRef.current = agentPanelOpen;
    if (isDesktop || wasOpen === agentPanelOpen) return;
    if (agentPanelOpen) {
      sheetRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [agentPanelOpen, isDesktop]);

  useLayoutEffect(() => {
    activeIntentIdRef.current = intentId;
    lifecycleGenerationRef.current += 1;
    lifecycleMutationRef.current = null;
    setArchiveTargetId(null);
    setArchiving(false);
    clearReactionTimers();
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
    opportunityModalElement,
  } = useOpportunityActions({ scope });

  /** Monotonic load ids guard every intent-scoped feed against stale responses. */
  const loadSeqRef = useRef(0);
  const activityLoadSeqRef = useRef(0);
  const timelineLoadSeqRef = useRef(0);

  const loadIntentCycle = useCallback(async (showLoading = false) => {
    if (!intentId) return;
    const seq = ++activityLoadSeqRef.current;
    if (showLoading) setIntentCycleLoading(true);
    try {
      const cycle = await conversationsService.getIntentCycle(intentId);
      if (activeIntentIdRef.current !== intentId || activityLoadSeqRef.current !== seq) return;
      setIntentCycle(cycle);
      setIntentCycleError(false);
    } catch {
      if (activeIntentIdRef.current !== intentId || activityLoadSeqRef.current !== seq) return;
      setIntentCycleError(true);
    } finally {
      if (activeIntentIdRef.current === intentId && activityLoadSeqRef.current === seq) {
        setIntentCycleLoading(false);
      }
    }
  }, [conversationsService, intentId]);

  const loadIntentTimeline = useCallback(async (showLoading = false) => {
    if (!intentId) return;
    const seq = ++timelineLoadSeqRef.current;
    if (showLoading) setIntentTimelineLoading(true);
    try {
      const entries = await conversationsService.getIntentCycleTimeline(intentId);
      if (activeIntentIdRef.current !== intentId || timelineLoadSeqRef.current !== seq) return;
      setIntentTimeline(entries);
      setIntentTimelineError(false);
    } catch {
      if (activeIntentIdRef.current !== intentId || timelineLoadSeqRef.current !== seq) return;
      setIntentTimelineError(true);
    } finally {
      if (activeIntentIdRef.current === intentId && timelineLoadSeqRef.current === seq) {
        setIntentTimelineLoading(false);
      }
    }
  }, [conversationsService, intentId]);

  const loadOpportunities = useCallback(async (preserveExisting = false) => {
    if (!intentId) return;
    // The live 5s refresh must not supersede the initial two-phase load. If it
    // does, the initial request's sequence becomes stale and its finally block
    // cannot clear the loading state; the passive request then populates badge
    // counts behind a permanent pair of skeleton cards.
    if (preserveExisting && opportunitiesLoadingRef.current) return;
    const seq = ++loadSeqRef.current;
    if (!preserveExisting) {
      opportunitiesLoadingRef.current = true;
      setOpportunitiesLoading(true);
      setOpportunitiesError(false);
    }
    const settleLoading = () => {
      if (activeIntentIdRef.current !== intentId) return;
      opportunitiesLoadingRef.current = false;
      setOpportunitiesLoading(false);
    };
    const applyItems = (items: RadarCardItem[]) => {
      // Every response is an authoritative snapshot for this exact intent.
      // Passive refreshes avoid loading flicker, but must still remove rows
      // that changed lifecycle or disappeared from the server response.
      setOpportunities(items);
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
        const fast = await opportunitiesService.getRadarView({
          ...baseOptions,
          presentation: "skeleton",
        });
        if (seq !== loadSeqRef.current) return;
        applyItems(fast.items);
        setOpportunitiesError(false);
        settleLoading();
      } catch {
        // Skeleton phase is best-effort — fall through to the full fetch.
      }
    }
    // Phase 2 (full): presenter text for cache misses; replaces the whole list.
    try {
      const res = await opportunitiesService.getRadarView(baseOptions);
      if (seq !== loadSeqRef.current) return;
      applyItems(res.items);
      setOpportunitiesError(false);
      settleLoading();
    } catch {
      if (seq !== loadSeqRef.current) return;
      if (!preserveExisting) {
        setOpportunities([]);
        setOpportunitiesError(true);
      }
    } finally {
      if (seq === loadSeqRef.current && !preserveExisting) settleLoading();
    }
  }, [intentId, opportunitiesService]);

  const negotiationActivityRevision = useMemo(
    () => intentNegotiationActivityRevision(negotiations, intentId),
    [intentId, negotiations],
  );

  const inspectorHrefByOpportunity = useMemo(() => {
    const hrefs = new Map<string, string>();
    for (const negotiation of intentCycle?.negotiations ?? []) {
      if (!hrefs.has(negotiation.opportunityId)) {
        hrefs.set(negotiation.opportunityId, `/i/${intentId}/negotiations/${negotiation.taskId}`);
      }
    }
    return hrefs;
  }, [intentCycle?.negotiations, intentId]);
  const refreshLiveRadar = useCallback(() => {
    void loadOpportunities(true);
    void loadIntentCycle();
    void loadIntentTimeline();
    // The SSE feed never carries the intent snapshot, so a finished run's final
    // tallies would otherwise sit unread until the next 15s progress poll.
    if (intentId) void intentsService.getIntent(intentId).then(setIntent).catch(() => {});
  }, [intentId, intentsService, loadIntentCycle, loadIntentTimeline, loadOpportunities]);

  // Refresh only the owner-scoped progress snapshot while work is non-terminal;
  // this intentionally leaves the negotiator chat mounted and untouched.
  // `blocked` belongs here: a blocked card can only observe its own recovery
  // (the signal joining an active community) by polling for it.
  const discoveryStatus = intent?.discoveryProgress?.status;
  useEffect(() => {
    // Depend on the status alone, not the whole intent: refetching the intent
    // replaces the object on every live refresh, which would reset this
    // interval before it ever fired.
    if (!intentId || !["queued", "running", "retrying", "blocked"].includes(discoveryStatus ?? "")) return;
    const timer = window.setInterval(() => {
      void intentsService.getIntent(intentId).then(setIntent).catch(() => {});
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [intentId, discoveryStatus, intentsService]);

  useRadarLiveRefresh({
    intentId,
    activityRevision: negotiationActivityRevision,
    onRefresh: refreshLiveRadar,
  });

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
    void loadOpportunities();
    void loadIntentCycle(true);
    void loadIntentTimeline(true);
    return () => {
      active = false;
    };
  }, [intentId, intentsService, loadOpportunities, loadIntentCycle, loadIntentTimeline]);

  const refreshWorkspaceAfterReaction = useCallback(() => {
    setNegotiatorRefreshVersion((version) => version + 1);
    void loadOpportunities(true);
  }, [loadOpportunities]);

  const scheduleBoundedWorkspaceRefresh = useCallback(() => {
    clearReactionTimers();
    refreshWorkspaceAfterReaction();
    reactionTimersRef.current = [1_500, 65_000, 90_000, 120_000, 180_000].map((delay) =>
      setTimeout(() => refreshWorkspaceAfterReaction(), delay),
    );
  }, [clearReactionTimers, refreshWorkspaceAfterReaction]);

  const handleArchive = useCallback(async () => {
    if (!archiveTargetId || archiving) return;
    setArchiving(true);
    try {
      await intentsService.archiveIntent(archiveTargetId);
      setArchiveTargetId(null);
      navigate("/");
    } catch {
      showError("Failed to archive signal");
    } finally {
      setArchiving(false);
    }
  }, [archiveTargetId, archiving, intentsService, navigate, showError]);

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
          scheduleBoundedWorkspaceRefresh();
        }
      } catch {
        if (!isCurrentRequest()) return;
        showError(
          status === "PAUSED"
            ? "Failed to pause signal"
            : "Failed to resume signal",
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
        showError("Failed to refine signal");
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

  const bucketOf = useCallback(
    // Local actions (accept/reject in this session) override the fetched status.
    (item: RadarCardItem) =>
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
      {opportunityModalElement}
      <div className="flex h-full min-h-0 flex-col px-10 lg:px-16 py-6">
        <ContentContainer size="xwide" className="flex min-h-0 flex-1 flex-col">
          {/* Dialog.Root provides the trigger semantics (aria-expanded /
              aria-controls / open state). The sheet itself is a
              DismissableLayer + FocusScope composition rather than
              Dialog.Content: Dialog.Content's baked-in FocusScope
              (loop=true even when untrapped) would Tab-loop the static
              desktop column, and a modal Dialog runs hideOthers() on mount
              even while closed, permanently aria-hiding the page under
              forceMount. Escape close and outside-press dismiss below are
              still Radix (DismissableLayer) — nothing hand-rolled.

              Everything except the sheet and its backdrop lives in ONE
              background wrapper that is inert while the mobile sheet is
              open. inert is DOM-inherited and cannot be opted out of per
              descendant, so the sheet — a flex sibling of Radar at lg+ —
              must sit outside the wrapper; the Radar column carries the
              same inert flag. `contents` keeps the wrapper boxless so the
              existing flex layout is unchanged. */}
          <Dialog.Root open={agentPanelOpen} onOpenChange={setAgentPanelOpen}>
          <div
            inert={sheetOverlayActive}
            data-testid="page-background"
            className="contents"
          >
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
              Signal not found
            </div>
          ) : (
            <>
            <div className="contents">
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
                      onClick={() => intentId && setArchiveTargetId(intentId)}
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
                      <span>background matching on — the PersonalAgent cycle is shown below</span>
                    </>
                  )}
                  {lifecycleStatus === "PAUSED" && (
                    <>
                      <span className="inline-flex items-center rounded border border-amber-300 px-1.5 py-0.5 font-medium lowercase tracking-wide text-amber-600">
                        paused
                      </span>
                      <span>
                        background discovery is paused; existing Radar matches
                        remain available
                      </span>
                    </>
                  )}
                  {lifecycleStatus === "FULFILLED" && (
                    <>
                      <span className="inline-flex items-center rounded border border-gray-300 px-1.5 py-0.5 font-medium lowercase tracking-wide text-gray-600">
                        fulfilled
                      </span>
                      <span>this signal has been fulfilled</span>
                    </>
                  )}
                  {lifecycleStatus === "EXPIRED" && (
                    <>
                      <span className="inline-flex items-center rounded border border-gray-300 px-1.5 py-0.5 font-medium lowercase tracking-wide text-gray-600">
                        expired
                      </span>
                      <span>this signal has expired</span>
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

              {/* Mobile-only trigger: below lg the Radar is the primary
                  content and the Personal Agent column opens as an off-canvas
                  sheet. The badge carries the same pending-question count
                  semantics as the desktop panel header. */}
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  ref={triggerRef}
                  aria-controls={sheetId}
                  data-testid="personal-agent-trigger"
                  className="mb-4 inline-flex items-center gap-2 self-start rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 lg:hidden"
                >
                  <MessageCircle className="h-4 w-4" />
                  Personal Agent
                </button>
              </Dialog.Trigger>
            </div>
            </>
          )}
          </div>

          {!intentLoading && !intent ? null : (
              <div className="flex min-h-0 flex-1 flex-col gap-8 lg:flex-row">
                {/* Visual backdrop only (Radix renders no overlay part for
                    non-modal dialogs); dismissing it is Radix's
                    pointer-down-outside on the content, not hand-rolled. */}
                <div
                  aria-hidden="true"
                  data-testid="personal-agent-overlay"
                  className={cn(
                    "fixed inset-0 z-[100] bg-black/50 transition-opacity duration-300 lg:hidden",
                    agentPanelOpen
                      ? "opacity-100"
                      : "pointer-events-none invisible opacity-0",
                  )}
                />
                {/* One mounted left column: a fixed off-canvas sheet below
                    lg (slid out when closed), a normal static equal-width
                    flex column at lg+. It is never unmounted or duplicated,
                    so the negotiator chat's live stream/question state
                    survives open/close and breakpoint changes.
                    Semantics switch at lg (a11y-only; layout is pure
                    Tailwind): a modal dialog with FocusScope containment and
                    an inert background while open on mobile, a plain
                    labelled region on desktop. */}
                <FocusScope
                  asChild
                  loop={sheetOverlayActive}
                  trapped={sheetOverlayActive}
                  onMountAutoFocus={(event) => event.preventDefault()}
                >
                <DismissableLayer
                  ref={sheetRef}
                  id={sheetId}
                  data-testid="personal-agent-sheet"
                  data-state={agentPanelOpen ? "open" : "closed"}
                  role={isDesktop ? "region" : "dialog"}
                  aria-modal={sheetOverlayActive || undefined}
                  aria-labelledby={sheetTitleId}
                  aria-describedby={sheetDescriptionId}
                  tabIndex={-1}
                  onDismiss={() => setAgentPanelOpen(false)}
                  className={cn(
                    "fixed inset-y-0 right-0 z-[100] flex w-[min(85vw,24rem)] flex-col overflow-y-auto bg-white p-4 shadow-xl outline-none",
                    "transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    "max-lg:data-[state=closed]:pointer-events-none max-lg:data-[state=closed]:invisible max-lg:data-[state=closed]:translate-x-full",
                    "lg:static lg:z-auto lg:min-h-0 lg:min-w-0 lg:w-auto lg:flex-1 lg:translate-x-0 lg:visible lg:pointer-events-auto lg:overflow-visible lg:bg-transparent lg:p-0 lg:shadow-none",
                  )}
                >
                  <h2 id={sheetTitleId} className="sr-only">
                    Personal Agent
                  </h2>
                  <p id={sheetDescriptionId} className="sr-only">
                    Chat with your Personal Agent about this signal.
                  </p>
                  <div className="mb-1 flex shrink-0 justify-end lg:hidden">
                    <button
                      type="button"
                      aria-label="Close panel"
                      onClick={() => setAgentPanelOpen(false)}
                      className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                {showNegotiatorPanel ? (
                  <Panel
                    title="Personal Agent"
                    description="Your Personal Agent, scoped to this signal — ask what it's doing, steer it, or answer its follow-ups."
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
                    className="min-h-0 flex-1"
                  >
                    {user?.id && (
                      <IntentMemoryStrip intentId={intentId} userId={user.id} />
                    )}
                    <IntentNegotiatorChat
                      key={intentId}
                      intentId={intentId}
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
                  <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="mb-4 shrink-0">
                      <h3 className="flex items-center gap-2 text-base font-bold tracking-[0.2em] text-[#3D3D3D] font-ibm-plex-mono">
                        <span>Personal Agent</span>
                      </h3>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div className="flex-1 overflow-y-auto pr-1">
                        {/* The agent chat is unavailable — the standing input
                            below still feeds the signal's refine flow. */}
                        <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 text-center">
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
                            your agent is working the room on this signal.
                          </p>
                        </div>
                      </div>
                      <div className="pt-4 shrink-0">
                        <AgentMessageInput onSend={submitRefine} />
                      </div>
                    </div>
                  </section>
                )}
                </DismissableLayer>
                </FocusScope>

                <div data-testid="radar-column" inert={sheetOverlayActive} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:flex-1">
                <Panel
                  title="Radar"
                  description="Opportunities the network surfaced for this signal."
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
                  <div className="mb-3">
                    <IntentCycleInspector
                      intentId={intentId ?? ""}
                      cycle={intentCycle}
                      loading={intentCycleLoading}
                      error={intentCycleError}
                    />
                  </div>
                  <div className="mb-3">
                    <PersonalAgentTimeline
                      entries={intentTimeline}
                      loading={intentTimelineLoading}
                      error={intentTimelineError}
                    />
                  </div>
                  <div className="mb-3 flex shrink-0 flex-wrap gap-1.5">
                    {RADAR_BUCKETS.map((bucket) => (
                      <StatPill
                        key={bucket.key}
                        bucketKey={bucket.key}
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
                  ) : opportunitiesError && visibleOpportunities.length === 0 ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center">
                      <p className="font-ibm-plex-mono text-sm text-red-700">Radar couldn’t load opportunities.</p>
                      <button
                        type="button"
                        onClick={() => void loadOpportunities()}
                        className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Try again
                      </button>
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
                          negotiationInspectorHref={inspectorHrefByOpportunity.get(item.opportunityId)}
                          onPrimaryAction={(
                            oppId,
                            userId,
                            viewerRole,
                            counterpartName,
                          ) =>
                            handleOpportunityAction(
                              oppId,
                              "accepted",
                              userId,
                              viewerRole,
                              counterpartName,
                            )
                          }
                          onSecondaryAction={(
                            oppId,
                            userId,
                            viewerRole,
                            counterpartName,
                          ) =>
                            handleOpportunityAction(
                              oppId,
                              "rejected",
                              userId,
                              viewerRole,
                              counterpartName,
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
          )}
          </Dialog.Root>

          <AlertDialog.Root
            open={archiveTargetId !== null}
            onOpenChange={(open) => {
              if (!open && !archiving) setArchiveTargetId(null);
            }}
          >
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 z-[110] bg-black/50" />
              <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[110] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white p-6 shadow-lg focus:outline-none">
                <AlertDialog.Title className="mb-2 text-lg font-bold text-gray-900">
                  Archive this signal? It will stop matching.
                </AlertDialog.Title>
                <AlertDialog.Description className="mb-6 text-sm text-gray-600">
                  You can keep its existing history, but it will no longer find new opportunities.
                </AlertDialog.Description>
                <div className="flex justify-end gap-3">
                  <AlertDialog.Cancel asChild>
                    <Button variant="outline" disabled={archiving}>Cancel</Button>
                  </AlertDialog.Cancel>
                  <Button
                    type="button"
                    onClick={() => void handleArchive()}
                    disabled={archiving}
                    aria-busy={archiving || undefined}
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    {archiving ? "Archiving..." : "Archive signal"}
                  </Button>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = IntentDetailPage;
