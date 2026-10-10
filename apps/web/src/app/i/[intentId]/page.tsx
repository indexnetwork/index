import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";

import AppHandoff from "@/components/AppHandoff";
import IntentNegotiatorChat from "@/components/IntentNegotiatorChat";
import NegotiationConversation from "@/components/NegotiationConversation";
import ChatView from "@/components/chat/ChatView";
import UserAvatar from "@/components/UserAvatar";
import { TheirAgentAvatar } from "@/components/workbench/agent-avatar";
import { useConversation } from "@/contexts/ConversationContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { APIError, isNotFoundError } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIntents, useOpportunities } from "@/contexts/APIContext";
import { getPublicUserProfile } from "@/services/users";
import { resolveSocials } from "@/lib/socials";
import { SOCIAL_ICONS } from "@/components/SocialIcons";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunityActions, type AcceptedOpportunityUpdate } from "@/hooks/useOpportunityActions";
import type { RadarCardItem, OpportunityLifecycleStatus } from "@/services/opportunities";
import type { IntentLifecycleStatus, MutableIntentLifecycleStatus } from "@/services/intents";
import { DEFAULT_RADAR_BUCKET, RADAR_STAGES, personWindowTitle, radarBucketForOpportunity, radarEmptyLine, type RadarBucket } from "@/lib/radar-buckets";
import { DiscoveryLoader, MatchCard, NotOnIndexTag, PipelineFunnel, SignalAction, SummarySection, expiryReason } from "@/components/workbench/mac-blocks";
import { Btn, Segmented, Stage, Window } from "@/components/workbench/Workbench";
import { MEDIUM_QUERY, useCompact, useMediaQuery } from "@/hooks/useCompact";
import { useBack } from "@/hooks/useBack";

function normalizeIntentLifecycleStatus(status: unknown): IntentLifecycleStatus {
  if (status === "paused") return status;
  return "active";
}

/** A signal can match nobody, so the radar stops showing the loader after this. Same as the Mac app. */
const DISCOVERY_GIVE_UP_MS = 120_000;

/** Bounded intent-refinement poll: interval (ms) and maximum total wait (ms). */
/** Same lifecycle set as the Mac radar. Rejected (failed) and expired (missed) both land in Closed. */
const RADAR_STATUSES: OpportunityLifecycleStatus[] = [
  "pending",
  "negotiating",
  "accepted",
  "rejected",
  "expired",
];

/** Intent detail view: the signal window beside the radar. */
export default function IntentDetailPage() {
  const { intentId } = useParams<{ intentId: string }>();
  return <AppHandoff kind="i" id={intentId ?? ""} webPage={<IntentDetail />} />;
}

function IntentDetail() {
  const navigate = useNavigate();
  const compact = useCompact();
  const medium = useMediaQuery(MEDIUM_QUERY);
  const back = useBack("/");
  const [compactPane, setCompactPane] = useState<"agent" | "radar">("agent");
  const { intentId } = useParams<{ intentId: string }>();
  const { user, isAuthenticated, isLoading: authLoading } = useAuthContext();
  const { conversations } = useConversation();
  const intentsService = useIntents();
  const opportunitiesService = useOpportunities();
  const { error: showError } = useNotifications();

  const [intent, setIntent] = useState<Awaited<
    ReturnType<typeof intentsService.getIntent>
  > | null>(null);
  const [intentLoading, setIntentLoading] = useState(true);
  const [intentMissing, setIntentMissing] = useState(false);
  const [intentFailed, setIntentFailed] = useState(false);
  const [intentReloadKey, setIntentReloadKey] = useState(0);
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
  const [archiveArmed, setArchiveArmed] = useState(false);
  const archiveTimer = useRef<number | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState(DEFAULT_RADAR_BUCKET);
  const selectedBucketEffectRef = useRef<RadarBucket | null>(null);
  // Below lg the Radar is the primary content and the negotiator column opens
  // as an off-canvas sheet; this is its open state.
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  // The third column. "stage" is whatever the radar row opens (chat, the live
  // negotiation, a summary). Profile and a past negotiation replace that column.
  const [pane, setPane] = useState<"stage" | "profile" | "negotiation">("stage");

  useLayoutEffect(() => {
    activeIntentIdRef.current = intentId;
    lifecycleGenerationRef.current += 1;
    lifecycleMutationRef.current = null;
    selectedBucketEffectRef.current = null;
    setArchiveArmed(false);
    if (archiveTimer.current) window.clearTimeout(archiveTimer.current);
    setArchiving(false);
    setOpenPersonId(null);
    setPane("stage");
    setOpportunities([]);
  }, [intentId]);

  const scope = useMemo(
    () => (intentId ? { intentId } : undefined),
    [intentId],
  );

  const onAccepted = useCallback((update: AcceptedOpportunityUpdate) => {
    setOpportunities((prev) => prev.map((item) =>
      item.opportunityId === update.opportunityId
        ? { ...item, status: update.status, viewerCommitted: update.viewerCommitted ?? true }
        : item,
    ));
    setOpenPersonId(update.opportunityId);
    setPane("stage");
  }, []);

  const {
    opportunityStatusMap,
    opportunityActionLoading,
    handleOpportunityAction,
    opportunityModalElement,
  } = useOpportunityActions({ scope, onAccepted });

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
    const applyItems = (items: RadarCardItem[], skeleton = false) => {
      // Every full response is an authoritative snapshot for this exact intent.
      // A skeleton pass is only the first paint: applying it over cards that
      // already have presenter text blanks the line the Mac radar keeps.
      setOpportunities((prev) => (skeleton && prev.length > 0 ? prev : items));
    };
    const baseOptions = {
      intentId,
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
        applyItems(fast.items, true);
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

  useEffect(() => {
    if (!intentId || authLoading) return;
    if (!isAuthenticated) {
      setIntent(null);
      setIntentMissing(false);
      setIntentLoading(false);
      const next = window.location.pathname + window.location.search;
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
      return;
    }
    let active = true;
    setIntentLoading(true);
    setIntentMissing(false);
    setIntentFailed(false);
    intentsService
      .getIntent(intentId)
      .then((res) => {
        if (active) setIntent(res);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setIntent(null);
        if (error instanceof APIError && error.status === 401) {
          const next = window.location.pathname + window.location.search;
          navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
          return;
        }
        const missing = isNotFoundError(error);
        setIntentMissing(missing);
        setIntentFailed(!missing);
      })
      .finally(() => {
        if (active) setIntentLoading(false);
      });
    void loadOpportunities();
    return () => {
      active = false;
    };
  }, [intentId, intentsService, loadOpportunities, authLoading, isAuthenticated, navigate, intentReloadKey]);

  useEffect(() => {
    if (selectedBucketEffectRef.current === null) {
      selectedBucketEffectRef.current = selectedBucket;
      return;
    }
    void loadOpportunities(true);
  }, [loadOpportunities, selectedBucket]);

  useEffect(() => {
    const timer = setInterval(() => { void loadOpportunities(true); }, 5_000);
    return () => clearInterval(timer);
  }, [loadOpportunities]);

  const handleArchive = useCallback(async () => {
    if (!intentId || archiving) return;
    setArchiving(true);
    try {
      await intentsService.archiveIntent(intentId);
      navigate("/");
    } catch {
      showError("couldn't archive this signal.");
    } finally {
      setArchiving(false);
    }
  }, [intentId, archiving, intentsService, navigate, showError]);

  const clickArchive = useCallback(() => {
    if (archiving || !intentId) return;
    if (archiveTimer.current) window.clearTimeout(archiveTimer.current);
    if (!archiveArmed) {
      setArchiveArmed(true);
      archiveTimer.current = window.setTimeout(() => setArchiveArmed(false), 4000);
      return;
    }
    setArchiveArmed(false);
    void handleArchive();
  }, [archiveArmed, archiving, handleArchive, intentId]);

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
          status === "paused"
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
        item.viewerCommitted,
      ),
    [opportunityStatusMap],
  );

  const bucketCounts = useMemo(() => {
    const counts: Partial<Record<Exclude<RadarBucket, "all">, number>> = {};
    for (const item of opportunities) {
      const b = bucketOf(item);
      if (!b) continue;
      counts[b] = (counts[b] ?? 0) + 1;
    }
    return counts;
  }, [opportunities, bucketOf]);

  const visibleOpportunities = useMemo(
    () => opportunities.filter((item) => {
      const bucket = bucketOf(item);
      if (!bucket) return false;
      return selectedBucket === "all" || bucket === selectedBucket;
    }).sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")),
    [opportunities, bucketOf, selectedBucket],
  );
  const chatPeers = useMemo(() => {
    const ids = new Set<string>();
    for (const conv of conversations) {
      for (const participant of conv.participants ?? []) {
        if (participant.participantType === "user" && participant.participantId !== user?.id) ids.add(participant.participantId);
      }
    }
    return ids;
  }, [conversations, user?.id]);
  const openPerson = opportunities.find((item) => item.opportunityId === openPersonId) ?? null;
  const title = (intent?.payload?.trim() || intent?.summary?.trim() || "");
  const lifecycleStatus = normalizeIntentLifecycleStatus(intent?.status);
  // Nothing on the radar in any stage and not yet given up: the agent is still out.
  const shownCount = Object.values(bucketCounts).reduce((sum, n) => sum + (n ?? 0), 0);
  const [discoveryExpired, setDiscoveryExpired] = useState(false);
  useEffect(() => { setDiscoveryExpired(false); }, [intentId]);
  useEffect(() => {
    if (lifecycleStatus === "paused" || shownCount > 0) return;
    const timer = setTimeout(() => setDiscoveryExpired(true), DISCOVERY_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [lifecycleStatus, shownCount, intentId]);
  const discovering = !!intent && lifecycleStatus !== "paused" && shownCount === 0 && !discoveryExpired;
  const lifecycleBusy = intentStatusPending?.intentId === intentId;

  const leave = compact ? back : () => navigate("/");
  const closePerson = () => setOpenPersonId(null);
  // Medium widths fit two panes, so an open person takes the agent chat's place.
  const hideChat = !compact && medium && !!openPerson;

  const signalHeader = (
    <div style={{ padding: "12px 18px", minHeight: 68, boxSizing: "border-box", borderBottom: "1px solid #000", background: "#fff" }}>
      {intentLoading ? (
        <p style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 12 }}>loading…</p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <h2 title={title || "your signal"} style={{
              margin: 0, fontFamily: "var(--amiga-title)", fontWeight: 500,
              fontSize: 17, color: "#000", letterSpacing: -0.2, lineHeight: 1.2,
              flex: 1, minWidth: 0,
              display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3,
              maxHeight: "3.6em", overflow: "hidden",
            }}>{title || "your signal"}</h2>
            <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
              <SignalAction
                label={lifecycleStatus === "paused" ? "▶ resume" : "❚❚ pause"}
                active={lifecycleStatus === "paused"}
                onClick={() => { if (!lifecycleBusy) void handleSetIntentStatus(lifecycleStatus === "paused" ? "active" : "paused"); }}
              />
              <SignalAction
                danger
                label={archiving ? "archiving…" : archiveArmed ? "archive · confirm" : "archive"}
                active={archiveArmed || archiving}
                onClick={clickArchive}
              />
            </div>
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mac-mono)", fontSize: 10, letterSpacing: 0.3, color: lifecycleStatus === "paused" ? "var(--ink-3)" : "#000" }}>
            {lifecycleStatus !== "paused" && <span className="wb-live" style={{ width: 6, height: 6 }} />}
            <span>{lifecycleStatus === "paused" ? "paused · agent on hold" : "live · agent is looking in the background"}</span>
          </div>
        </>
      )}
    </div>
  );
  const agentChat = (
    <div style={{ minHeight: 0, display: "flex", flexDirection: "column", flex: 1 }}>
      {intentId && <IntentNegotiatorChat key={intentId} intentId={intentId} onSelectMatch={(id) => { setPane("stage"); setOpenPersonId(id); }} />}
    </div>
  );
  const radarFunnel = (
    <div style={{ height: 56, boxSizing: "border-box", borderBottom: "1.5px solid #111" }}>
      <PipelineFunnel
        activeStage={selectedBucket}
        onClickStage={(label) => setSelectedBucket(label as RadarBucket)}
        stages={RADAR_STAGES.map((stage) => ({
          label: stage,
          count: bucketCounts[stage] ?? 0,
          accent: stage === "awaiting you" || stage === "accepted",
        }))}
      />
    </div>
  );
  const radarList = (
    <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 22px 24px", display: "grid", gap: 8, alignContent: "start" }}>
      {/* A failed fetch wins over the discovery loader, even inside the give-up window. */}
      {opportunitiesError && visibleOpportunities.length === 0 && !opportunitiesLoading ? (
        <EmptyState
          tone="error"
          style={{ padding: 16 }}
          message="radar couldn't load."
          action={{ label: "try again", onClick: () => void loadOpportunities() }}
        />
      ) : opportunitiesLoading && opportunities.length === 0 ? (
        <div data-testid="radar-skeleton"><EmptyState tone="loading" style={{ padding: 28 }} /></div>
      ) : discovering ? (
        <div data-testid="radar-discovering"><DiscoveryLoader /></div>
      ) : visibleOpportunities.length === 0 ? (
        <EmptyState
          framed
          style={{ padding: 28, borderColor: "#000" }}
          message={selectedBucket === "all" && lifecycleStatus === "paused" && shownCount === 0
            ? "this signal is paused, so your agent isn't looking right now."
            : radarEmptyLine(selectedBucket)}
          action={selectedBucket === "accepted" && (bucketCounts["awaiting you"] ?? 0) > 0
            ? { label: "see awaiting you", onClick: () => setSelectedBucket("awaiting you") }
            : undefined}
        />
      ) : visibleOpportunities.map((item) => {
        const bucket = bucketOf(item);
        const busy = !!opportunityActionLoading[item.opportunityId];
        const peer = item.peer;
        const name = item.name || peer?.name || "unknown";
        const blurb = item.headline || item.mainText || "";
        // "waiting for them" only while this viewer has said yes and
        // the other person has not. A mutual accept stays a plain
        // accepted row, same as the Mac card.
        const waitingOnThem = item.status === "pending" && (
          opportunityStatusMap[item.opportunityId] === "accepted" || item.viewerCommitted === true
        );
        return (
          <MatchCard
            key={item.opportunityId}
            name={name}
            blurb={blurb}
            photo={item.avatar ?? peer?.avatar}
            userId={item.userId || peer?.userId}
            unverified={peer?.emailVerified === false}
            accepted={bucket === "accepted"}
            ready={bucket === "awaiting you"}
            negotiating={bucket === "negotiating"}
            expired={bucket === "closed"}
            closedLabel={item.status === "rejected" ? "not a fit" : "missed"}
            waitingOnThem={waitingOnThem}
            hasChat={!!(item.userId || peer?.userId) && chatPeers.has(item.userId || peer?.userId || "")}
            onOpen={() => { setPane("stage"); setOpenPersonId(item.opportunityId); }}
            onProfile={() => { setPane("profile"); setOpenPersonId(item.opportunityId); }}
            onAccept={() => { if (!busy) void handleOpportunityAction(item.opportunityId, "accepted", item.userId || peer?.userId); }}
            onPass={() => { if (!busy) void handleOpportunityAction(item.opportunityId, "rejected", item.userId || peer?.userId); }}
          />
        );
      })}
    </div>
  );
  const personPane = openPerson ? (
    <PersonPane
      item={openPerson}
      bucket={bucketOf(openPerson)}
      intentId={intentId}
      pane={pane}
      onPane={setPane}
      onClose={() => setOpenPersonId(null)}
      onAccept={() => void handleOpportunityAction(openPerson.opportunityId, "accepted", openPerson.userId)}
      onPass={() => void handleOpportunityAction(openPerson.opportunityId, "rejected", openPerson.userId)}
    />
  ) : null;

  // Compact: one window. The signal switches between the agent chat and the
  // radar, and an open person drills in full screen with back to the signal.
  if (compact) {
    return (
      <>
        {opportunityModalElement}
        <Stage>
          {!intent ? (
            <Window title="signal" onClose={leave}>
              <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 28 }}>
                {intentLoading ? (
                  <EmptyState tone="loading" />
                ) : intentMissing ? (
                  <EmptyState message="this signal doesn't exist or was removed." action={{ label: "go home", to: "/" }} />
                ) : intentFailed ? (
                  <EmptyState
                    tone="error"
                    message="couldn't load this signal."
                    action={{ label: "try again", onClick: () => setIntentReloadKey((k) => k + 1) }}
                  />
                ) : null /* signed out: the effect above is already redirecting to /login */}
              </div>
            </Window>
          ) : openPerson ? (
            <Window title={personPaneTitle(bucketOf(openPerson), pane)} onClose={closePerson}>
              {personPane}
            </Window>
          ) : (
            <Window title="signal" onClose={leave}>
              {signalHeader}
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #000", background: "#fff" }}>
                <Segmented
                  value={compactPane}
                  onChange={setCompactPane}
                  options={[
                    { value: "agent", label: "agent" },
                    { value: "radar", label: shownCount ? `radar · ${shownCount}` : "radar" },
                  ]}
                />
              </div>
              {compactPane === "agent" ? agentChat : (
                <>
                  {radarFunnel}
                  {radarList}
                </>
              )}
            </Window>
          )}
        </Stage>
      </>
    );
  }

  return (
    <>
      {opportunityModalElement}
      <div style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: openPerson
          ? hideChat ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 40fr) minmax(0, 30fr) minmax(0, 30fr)"
          : "minmax(0, 56fr) minmax(0, 44fr)",
        gap: 8,
        padding: medium ? "32px 16px" : "56px 18px",
        minHeight: 0,
      }}>
        {!intent ? (
          <Window title="signal" onClose={leave}>
            <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 28 }}>
              {intentLoading ? (
                <EmptyState tone="loading" />
              ) : intentMissing ? (
                <EmptyState message="this signal doesn't exist or was removed." action={{ label: "go home", to: "/" }} />
              ) : intentFailed ? (
                <EmptyState
                  tone="error"
                  message="couldn't load this signal."
                  action={{ label: "try again", onClick: () => setIntentReloadKey((k) => k + 1) }}
                />
              ) : null /* signed out: the effect above is already redirecting to /login */}
            </div>
          </Window>
        ) : (
          <>
            {!hideChat && (
              <Window title="signal" onClose={leave}>
                <div style={{ display: "grid", gridTemplateRows: "auto 1fr", flex: 1, minHeight: 0 }}>
                  {signalHeader}
                  {agentChat}
                </div>
              </Window>
            )}
            <Window title="radar" onClose={leave}>
              {radarFunnel}
              {radarList}
            </Window>
            {openPerson && (
              <Window title={personPaneTitle(bucketOf(openPerson), pane)} dismiss onClose={closePerson}>
                {personPane}
              </Window>
            )}
          </>
        )}
      </div>
    </>
  );
}

function personPaneTitle(bucket: ReturnType<typeof radarBucketForOpportunity>, pane: "stage" | "profile" | "negotiation") {
  if (pane === "profile") return "profile";
  if (pane === "negotiation") return "negotiation";
  return personWindowTitle(bucket);
}

function PersonHead({ name, photo, userId, unverified, sub, size = 34, action, onOpenProfile }: {
  name: string; photo?: string | null; userId?: string; unverified?: boolean; sub?: string; size?: number; action?: ReactNode; onOpenProfile?: () => void;
}) {
  const nameStyle = { display: "block", fontFamily: "var(--amiga-title)", fontSize: size > 34 ? 17 : 15, fontWeight: 600, color: "#000", whiteSpace: "normal", cursor: onOpenProfile ? "pointer" : undefined } as const;
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid #000", display: "flex", gap: 12, alignItems: "center", background: "#fff" }}>
      <span title={onOpenProfile ? "view profile" : undefined} onClick={onOpenProfile} style={{ cursor: onOpenProfile ? "pointer" : undefined, lineHeight: 0 }}>
        <UserAvatar id={userId} name={name} avatar={photo} size={size} />
      </span>
      <div style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
        <div title={onOpenProfile ? "view profile" : undefined} onClick={onOpenProfile} style={nameStyle}>{name}</div>
        {unverified && <NotOnIndexTag />}
        {sub && <div style={{ fontFamily: "var(--mac-mono)", fontSize: 10, color: "var(--ink-2)", letterSpacing: 1, textTransform: "uppercase" }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}

function PersonPane({
  item,
  bucket,
  intentId,
  pane,
  onPane,
  onClose,
  onAccept,
  onPass,
}: {
  item: RadarCardItem;
  bucket: ReturnType<typeof radarBucketForOpportunity>;
  intentId?: string;
  pane: "stage" | "profile" | "negotiation";
  onPane: (pane: "stage" | "profile" | "negotiation") => void;
  onClose: () => void;
  onAccept: () => void;
  onPass: () => void;
}) {
  const name = item.name || "someone";
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof getPublicUserProfile>> | null>(null);
  // The userId whose profile fetch has finished, so switching people shows loading again.
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const profileSettled = settledFor === item.userId;
  const showingProfile = pane === "profile" || (pane === "stage" && bucket !== "accepted" && bucket !== "negotiating" && bucket !== "closed");
  const openProfile = () => onPane("profile");
  useEffect(() => {
    if (!item.userId || !showingProfile) return;
    let active = true;
    const userId = item.userId;
    getPublicUserProfile(userId)
      .then((user) => { if (active) setProfile(user); })
      .catch(() => {})
      .finally(() => { if (active) setSettledFor(userId); });
    return () => { active = false; };
  }, [item.userId, showingProfile]);

  if (!showingProfile && intentId && (pane === "negotiation" || (pane === "stage" && (bucket === "negotiating" || bucket === "closed")))) {
    const first = name.split(/\s+/)[0];
    return (
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #000", display: "flex", gap: 12, alignItems: "center", background: "#fff" }}>
          <TheirAgentAvatar owner={{ id: item.userId, name, photo: item.avatar }} size={34} />
          <div style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: "var(--amiga-title)", fontSize: 15, fontWeight: 600 }}>
              your agent ⇄ <span title="view profile" onClick={openProfile} style={{ cursor: "pointer" }}>{first}</span>&apos;s agent
            </div>
            <div style={{ fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.4, color: "var(--ink-2)" }}>
              {bucket === "closed"
                ? <>This negotiation closed. This isn&apos;t a chat with {name}.</>
                : <>The two agents are working out whether you and {name} should meet. This isn&apos;t a chat with {name}.</>}
            </div>
          </div>
          {bucket === "accepted" && <Btn small onClick={() => onPane("stage")}>chat ›</Btn>}
        </div>
        <NegotiationConversation intentId={intentId} opportunityId={item.opportunityId} expanded onToggle={onClose} />
      </div>
    );
  }
  if (!showingProfile && bucket === "accepted" && item.userId) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr" }}>
        <PersonHead name={name} photo={item.avatar} userId={item.userId} unverified={item.peer?.emailVerified === false} onOpenProfile={openProfile} action={intentId && (
          <Btn small onClick={() => onPane("negotiation")}>negotiation ›</Btn>
        )} />
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ChatView embedded userId={item.userId} userName={name} userAvatar={item.avatar ?? undefined} onClose={onClose} opener={{ headline: item.headline, detail: item.mainText }} />
        </div>
      </div>
    );
  }
  const bio = profile?.intro || "";
  const note = item.mainText && item.mainText !== bio ? item.mainText : item.headline;
  const socials = resolveSocials(profile?.socials);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <PersonHead name={profile?.name || name} photo={profile?.avatar || item.avatar} userId={item.userId} unverified={item.peer?.emailVerified === false} size={42} />
      <div className="mac-scroll" style={{ overflowY: "auto", padding: 16, display: "grid", gap: 15, alignContent: "start", background: "#fff" }}>
        {bio && <SummarySection label="bio">{bio}</SummarySection>}
        {note && <SummarySection label="why your agent surfaced them">{note}</SummarySection>}
        {socials.length > 0 && (
          <SummarySection label="elsewhere">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {socials.map((s) => (
                <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #000", padding: "4px 9px", fontFamily: "var(--mac-mono)", fontSize: 11, color: "#000", textDecoration: "none" }}>
                  {SOCIAL_ICONS[s.platform]}
                  <span>{s.handle}</span>
                </a>
              ))}
            </div>
          </SummarySection>
        )}
        {profile?.location && (
          <div style={{ fontFamily: "var(--mac-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>{profile.location}</div>
        )}
        {bucket === "closed" && <SummarySection label="why it closed">{expiryReason(item.opportunityId, name)}</SummarySection>}
        {!bio && !note && socials.length === 0 && !profile?.location && (
          !profileSettled && item.userId
            ? <EmptyState tone="loading" align="start" />
            : <EmptyState align="start" message="nothing recorded yet." />
        )}
      </div>
      <div style={{ borderTop: "1px solid #000", padding: "10px 14px", background: "#fff", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {bucket === "awaiting you" ? (
          <>
            <Btn primary small onClick={onAccept}>accept</Btn>
            <Btn small onClick={onPass}>pass</Btn>
          </>
        ) : bucket === "accepted" ? (
          <Btn small onClick={() => onPane("stage")}>chat ›</Btn>
        ) : bucket === "closed" ? (
          <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-3)" }}>this signal closed.</span>
        ) : bucket !== "negotiating" ? (
          <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-3)" }}>
            answer their question in your feed to move forward.
          </span>
        ) : null}
        {intentId && (
          <Btn small onClick={() => onPane(bucket === "negotiating" ? "stage" : "negotiation")}>negotiation ›</Btn>
        )}
      </div>
    </div>
  );
}

export const Component = IntentDetailPage;
