import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, LoaderCircle, Pause, Pencil, Play, Trash2 } from "lucide-react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";

import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import { Button } from "@/components/ui/button";
import OpportunityCard, { OpportunitySkeleton } from "@/components/chat/OpportunityCardInChat";
import { useIntents, useOpportunities } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunityActions } from "@/hooks/useOpportunityActions";
import { useIntentVisitPing } from "@/hooks/useIntentVisitPing";
import type { RadarCardItem, OpportunityLifecycleStatus } from "@/services/opportunities";
import type { IntentLifecycleStatus, MutableIntentLifecycleStatus } from "@/services/intents";
import { cn } from "@/lib/utils";
import { DEFAULT_RADAR_BUCKET, radarBucketBadgeTone, radarBucketForOpportunity, type RadarBucket } from "@/lib/radar-buckets";

const RADAR_BUCKETS: Array<{ key: RadarBucket; label: string }> = [
  { key: "needs-you", label: "Needs you" },
  { key: "waiting", label: "Waiting" },
  { key: "connected", label: "Connected" },
  { key: "closed", label: "Closed" },
];

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
  bucketKey: RadarBucket;
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

/** Intent detail view: the signal's header card with Pause/Edit/Archive
 * actions over a Radar panel with a status filter strip. */
export default function IntentDetailPage() {
  const navigate = useNavigate();
  const { intentId } = useParams<{ intentId: string }>();
  const intentsService = useIntents();
  const opportunitiesService = useOpportunities();
  useIntentVisitPing(intentId);
  const { error: showError } = useNotifications();
  const { subscribeIntentDiscoveryProgress, subscribeIntentInvalidation } = useConversation();

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
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState(DEFAULT_RADAR_BUCKET);
  const selectedBucketEffectRef = useRef<RadarBucket | null>(null);

  useLayoutEffect(() => {
    activeIntentIdRef.current = intentId;
    lifecycleGenerationRef.current += 1;
    lifecycleMutationRef.current = null;
    selectedBucketEffectRef.current = null;
    setArchiveTargetId(null);
    setArchiving(false);
  }, [intentId]);

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

  const refreshLiveRadar = useCallback(() => {
    void loadOpportunities(true);
    // The SSE feed never carries the intent snapshot, so a finished run's final
    // tallies would otherwise sit unread until the next 15s progress poll.
    if (intentId) void intentsService.getIntent(intentId).then(setIntent).catch(() => {});
  }, [intentId, intentsService, loadOpportunities]);

  const invalidateLiveIntent = useCallback(() => {
    refreshLiveRadar();
  }, [refreshLiveRadar]);

  useEffect(() => {
    return subscribeIntentDiscoveryProgress((event) => {
      if (event.intentId === intentId) invalidateLiveIntent();
    });
  }, [intentId, invalidateLiveIntent, subscribeIntentDiscoveryProgress]);

  useEffect(() => {
    return subscribeIntentInvalidation((event) => {
      if (event.intentId === intentId) invalidateLiveIntent();
    });
  }, [intentId, invalidateLiveIntent, subscribeIntentInvalidation]);

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
    return () => {
      active = false;
    };
  }, [intentId, intentsService, loadOpportunities]);

  useEffect(() => {
    if (selectedBucketEffectRef.current === null) {
      selectedBucketEffectRef.current = selectedBucket;
      return;
    }
    void loadOpportunities(true);
  }, [loadOpportunities, selectedBucket]);

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
    [intentId, intentsService, showError],
  );

  /** Feed the header ✎ input's text to the intent's refine flow and reload
   * matches. Returns whether the refine succeeded so the caller can clear it. */
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
      radarBucketForOpportunity(
        (opportunityStatusMap[item.opportunityId] as OpportunityLifecycleStatus | undefined) ?? item.status,
      ),
    [opportunityStatusMap],
  );

  const bucketCounts = useMemo(() => {
    const counts: Partial<Record<RadarBucket, number>> = {};
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
                      <span>background matching on — new matches appear in Radar below</span>
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

            </div>
            </>
          )}

          {!intentLoading && !intent ? null : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div data-testid="radar-column" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
                <Panel
                  title="Radar"
                  description="Opportunities the network surfaced for this signal."
                  className="flex-1"
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
                            pendingActionable={
                              ((opportunityStatusMap[item.opportunityId] as OpportunityLifecycleStatus | undefined) ?? item.status) !== "pending"
                            }
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
