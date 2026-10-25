import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode, type UIEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import AppHandoff from "@/components/AppHandoff";
import IntentNegotiatorChat from "@/components/IntentNegotiatorChat";
import IntentsHome from "@/components/intents-home/IntentsHome";
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
import { INVITE_URL, buildInviteMessage, emailFromSocials, inviteEmailHref, inviteSubject, inviteXHref } from "@/lib/invite";
import { SOCIAL_ICONS } from "@/components/SocialIcons";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunityActions, type AcceptedOpportunityUpdate } from "@/hooks/useOpportunityActions";
import type { RadarCardItem, OpportunityLifecycleStatus } from "@/services/opportunities";
import type { IntentLifecycleStatus, MutableIntentLifecycleStatus } from "@/services/intents";
import { DEFAULT_RADAR_BUCKET, RADAR_STAGES, personWindowTitle, radarBucketForOpportunity, radarEmptyLine, type RadarBucket } from "@/lib/radar-buckets";
import { DiscoveryLoader, MatchCard, NotOnIndexTag, PipelineFunnel, IntentAction, SummarySection } from "@/components/workbench/mac-blocks";
import { Btn, Segmented, Stage, Window } from "@/components/workbench/Workbench";
import { useCompact } from "@/hooks/useCompact";
import { useBack } from "@/hooks/useBack";

function normalizeIntentLifecycleStatus(status: unknown): IntentLifecycleStatus {
  if (status === "paused") return status;
  return "active";
}

/** An intent can match nobody, so the radar stops showing the loader after this. Same as the Mac app. */
const DISCOVERY_GIVE_UP_MS = 120_000;

/** Bounded intent-refinement poll: interval (ms) and maximum total wait (ms). */
/** Same lifecycle set as the Mac radar. Rejected (not a fit) and expired both land in Closed. */
const RADAR_STATUSES: OpportunityLifecycleStatus[] = [
  "pending",
  "negotiating",
  "accepted",
  "rejected",
  "expired",
];

/** Intent detail view. Desktop: the intents screen with this intent selected. Phones: one window. */
export default function IntentDetailPage() {
  const { intentId } = useParams<{ intentId: string }>();
  return <AppHandoff kind="i" id={intentId ?? ""} webPage={<IntentWeb />} />;
}

function IntentWeb() {
  const { intentId } = useParams<{ intentId: string }>();
  const compact = useCompact();
  const { isAuthenticated, isLoading } = useAuthContext();
  if (compact) return <IntentDetail />;
  if (isLoading) return null;
  if (!isAuthenticated) {
    const next = window.location.pathname + window.location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <IntentsHome selectedId={intentId} />;
}

function IntentDetail() {
  const navigate = useNavigate();
  const compact = useCompact();
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
      showError("couldn't archive this intent.");
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

  // Compact: the intent header shrinks while the feed scrolls down and grows
  // back on the way up, and stays small while the keyboard is open.
  const [headerSmall, setHeaderSmall] = useState(false);
  const [typing, setTyping] = useState(false);
  const scrollGesture = useRef({ at: 0, quietUntil: 0, anchor: new WeakMap<Element, number>() });
  useEffect(() => { setHeaderSmall(false); setTyping(false); }, [intentId, compactPane]);
  const markScrollGesture = useCallback(() => { scrollGesture.current.at = Date.now(); }, []);
  const onBodyScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const pane = event.target;
    if (!(pane instanceof HTMLElement) || pane.tagName === "TEXTAREA" || pane.tagName === "INPUT") return;
    const gesture = scrollGesture.current;
    const top = pane.scrollTop;
    const anchor = gesture.anchor.get(pane) ?? top;
    const now = Date.now();
    // Only a finger or wheel moves the header: programmatic follow-scrolls and
    // the reflow from the header resizing itself would otherwise loop.
    if (now < gesture.quietUntil || now - gesture.at > 600) {
      gesture.anchor.set(pane, top);
      return;
    }
    const toggle = (small: boolean) => {
      gesture.quietUntil = now + 300;
      gesture.anchor.set(pane, top);
      setHeaderSmall(small);
    };
    if (top <= 0) { if (headerSmall) toggle(false); else gesture.anchor.set(pane, top); return; }
    const diff = top - anchor;
    if (!headerSmall && diff > 24) toggle(true);
    else if (headerSmall && diff < -24) toggle(false);
    // The anchor follows the scroll while it keeps going the current way.
    else if (headerSmall ? diff > 0 : diff < 0) gesture.anchor.set(pane, top);
  }, [headerSmall]);
  const isField = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  const onBodyFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!isField(event.target)) return;
    scrollGesture.current.quietUntil = Date.now() + 300;
    setTyping(true);
    setHeaderSmall(true);
  }, []);
  const onBodyBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!isField(event.target) || isField(event.relatedTarget)) return;
    scrollGesture.current.quietUntil = Date.now() + 300;
    setTyping(false);
    setHeaderSmall(false);
  }, []);
  const small = compact && headerSmall;

  const closePerson = () => setOpenPersonId(null);

  const intentHeader = (
    <div style={{
      padding: small ? "8px 14px" : "12px 18px", minHeight: small ? 0 : 68, boxSizing: "border-box",
      borderBottom: "1px solid var(--wb-hairline)", background: "#fff", transition: "padding 180ms ease, min-height 180ms ease",
    }}>
      {intentLoading ? (
        <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-3)" }}>loading…</p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <h2 title={title || "your intent"} style={{
              margin: 0, fontFamily: "var(--amiga-title)", fontWeight: 500,
              fontSize: small ? 14 : 16, color: "var(--ink)", lineHeight: 1.4,
              flex: 1, minWidth: 0, transition: "font-size 180ms ease",
              display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: small ? 1 : 3,
              maxHeight: small ? "1.4em" : "4.2em", overflow: "hidden",
            }}>{title || "your intent"}</h2>
            <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
              <IntentAction
                label={lifecycleStatus === "paused" ? "▶ resume" : "❚❚ pause"}
                active={lifecycleStatus === "paused"}
                onClick={() => { if (!lifecycleBusy) void handleSetIntentStatus(lifecycleStatus === "paused" ? "active" : "paused"); }}
              />
              <IntentAction
                danger
                label={archiving ? "archiving…" : archiveArmed ? "archive · confirm" : "archive"}
                active={archiveArmed || archiving}
                onClick={clickArchive}
              />
            </div>
          </div>
          <div aria-hidden={small || undefined} style={{
            marginTop: small ? 0 : 8, maxHeight: small ? 0 : 40, opacity: small ? 0 : 1, overflow: "hidden",
            transition: "margin-top 180ms ease, max-height 180ms ease, opacity 120ms ease",
            display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mac-sans)", fontSize: 12, color: lifecycleStatus === "paused" ? "var(--ink-3)" : "var(--ink-2)",
          }}>
            {lifecycleStatus !== "paused" && <span className="wb-live" style={{ width: 6, height: 6, borderRadius: "50%" }} />}
            <span>
              {lifecycleStatus === "paused" ? "paused · agent on hold" : "live · agent is looking in the background"}
              {intent?.createdAt && ` · created ${new Date(intent.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
            </span>
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
    <div style={{ height: 56, boxSizing: "border-box", borderBottom: "1px solid var(--wb-hairline)" }}>
      <PipelineFunnel
        activeStage={selectedBucket}
        onClickStage={(label) => setSelectedBucket(label as RadarBucket)}
        stages={RADAR_STAGES.map((stage) => ({
          label: stage,
          display: stage === "negotiating" ? "in talks" : stage === "accepted" ? "chat open" : stage,
          count: bucketCounts[stage] ?? 0,
          accent: stage === "awaiting you" || stage === "accepted",
        }))}
      />
    </div>
  );
  const radarList = (
    <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 16px 24px", display: "grid", gap: 0, alignContent: "start" }}>
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
          style={{ padding: 28, marginTop: 12 }}
          message={selectedBucket === "all" && lifecycleStatus === "paused" && shownCount === 0
            ? "this intent is paused, so your agent isn't looking right now."
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
        // "chat open" chip only while this viewer has said yes and
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
            onOpenChat={() => navigate(`/u/${item.userId || peer?.userId}/chat`)}
            onProfile={() => { setPane("profile"); setOpenPersonId(item.opportunityId); }}
            onAccept={() => { if (!busy) void handleOpportunityAction(item.opportunityId, "accepted", item.userId || peer?.userId, { notOnIndex: peer?.emailVerified === false }); }}
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
      intent={title}
      senderName={user?.name}
      pane={pane}
      onPane={setPane}
      onClose={() => setOpenPersonId(null)}
      onAccept={() => void handleOpportunityAction(openPerson.opportunityId, "accepted", openPerson.userId, { notOnIndex: openPerson.peer?.emailVerified === false })}
      onPass={() => void handleOpportunityAction(openPerson.opportunityId, "rejected", openPerson.userId)}
      hasChat={!!(openPerson.userId || openPerson.peer?.userId) && chatPeers.has(openPerson.userId || openPerson.peer?.userId || "")}
      onOpenChat={() => navigate(`/u/${openPerson.userId || openPerson.peer?.userId}/chat`)}
    />
  ) : null;

  // Phones only (desktop renders IntentsHome): one window. The intent switches
  // between the agent chat and the radar, and an open person drills in full
  // screen with back to the intent.
  return (
    <>
      {opportunityModalElement}
      <Stage>
        {!intent ? (
          <Window title="intent" onClose={back}>
            <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 28 }}>
              {intentLoading ? (
                <EmptyState tone="loading" />
              ) : intentMissing ? (
                <EmptyState message="this intent doesn't exist or was removed." action={{ label: "go home", to: "/" }} />
              ) : intentFailed ? (
                <EmptyState
                  tone="error"
                  message="couldn't load this intent."
                  action={{ label: "try again", onClick: () => setIntentReloadKey((k) => k + 1) }}
                />
              ) : null /* signed out: the effect above is already redirecting to /login */}
            </div>
          </Window>
        ) : openPerson ? (
          <Window title={personPaneTitle(bucketOf(openPerson), pane, openPerson.peer?.emailVerified === false)} onClose={closePerson}>
            {personPane}
          </Window>
        ) : (
          <Window title="intent" onClose={back}>
            <div
              style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
              onScrollCapture={onBodyScroll}
              onTouchMove={markScrollGesture}
              onWheel={markScrollGesture}
              onFocus={onBodyFocus}
              onBlur={onBodyBlur}
            >
              {intentHeader}
              {/* The keyboard leaves little room, so the pane switch steps aside while typing. */}
              {!typing && (
                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--wb-hairline)", background: "#fff" }}>
                  <Segmented
                    value={compactPane}
                    onChange={setCompactPane}
                    options={[
                      { value: "agent", label: "agent" },
                      { value: "radar", label: shownCount ? `radar · ${shownCount}` : "radar" },
                    ]}
                  />
                </div>
              )}
              {compactPane === "agent" ? agentChat : (
                <>
                  {radarFunnel}
                  {radarList}
                </>
              )}
            </div>
          </Window>
        )}
      </Stage>
    </>
  );
}

function personPaneTitle(bucket: ReturnType<typeof radarBucketForOpportunity>, pane: "stage" | "profile" | "negotiation", notOnIndex = false) {
  if (pane === "profile") return "profile";
  if (pane === "negotiation") return "agent log";
  // Someone not on Index has no chat; their accepted stage is the invite.
  if (bucket === "accepted" && notOnIndex) return "invite";
  return personWindowTitle(bucket);
}

function PersonHead({ name, photo, userId, unverified, sub, size = 28, action, onOpenProfile }: {
  name: string; photo?: string | null; userId?: string; unverified?: boolean; sub?: string; size?: number; action?: ReactNode; onOpenProfile?: () => void;
}) {
  const nameStyle = { display: "block", fontFamily: "var(--amiga-title)", fontSize: size > 34 ? 16 : 14, fontWeight: 500, color: "var(--ink)", whiteSpace: "normal", cursor: onOpenProfile ? "pointer" : undefined } as const;
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--wb-hairline)", display: "flex", gap: 12, alignItems: "center", background: "#fff" }}>
      <span title={onOpenProfile ? "view profile" : undefined} onClick={onOpenProfile} style={{ cursor: onOpenProfile ? "pointer" : undefined, lineHeight: 0 }}>
        <UserAvatar id={userId} name={name} avatar={photo} size={size} />
      </span>
      <div style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
        <div title={onOpenProfile ? "view profile" : undefined} onClick={onOpenProfile} style={nameStyle}>{name}</div>
        {unverified && <NotOnIndexTag />}
        {sub && <div style={{ fontFamily: "var(--mac-sans)", fontSize: 11, color: "var(--ink-2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}

/**
 * What accepting opens for someone not on Index yet: the opportunity, a
 * pre-written invite the user can edit, and ways to send it themselves. Each
 * way shows only when there is somewhere to send it: X when they have an X
 * link (the DM composer opens with the text, and the user picks them), email
 * when their profile lists an address. With neither there is nothing to send
 * the message through, so it gives way to the invite link to copy.
 */
function InvitePane({ item, name, intent, senderName, onOpenProfile, onNegotiation }: {
  item: RadarCardItem;
  name: string;
  intent?: string;
  senderName?: string | null;
  onOpenProfile: () => void;
  onNegotiation?: () => void;
}) {
  // Keyed by userId so another person's profile never shows while this one loads.
  const [loaded, setLoaded] = useState<{ userId: string; user: Awaited<ReturnType<typeof getPublicUserProfile>> } | null>(null);
  const profile = loaded && loaded.userId === item.userId ? loaded.user : null;
  useEffect(() => {
    if (!item.userId) return;
    let active = true;
    const userId = item.userId;
    getPublicUserProfile(userId)
      .then((user) => { if (active) setLoaded({ userId, user }); })
      .catch(() => {});
    return () => { active = false; };
  }, [item.userId]);

  // Drafted once; the pane is keyed by opportunity, so another person starts fresh.
  const [message, setMessage] = useState(() => buildInviteMessage({ name, intent, senderName }));

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const copy = () => {
    navigator.clipboard?.writeText(INVITE_URL).then(() => {
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const first = name.split(/\s+/)[0] || "them";
  const note = item.mainText || item.headline;
  const socials = resolveSocials(profile?.socials);
  const x = socials.find((s) => s.platform === "x");
  const email = emailFromSocials(profile?.socials);
  const canSend = !!(x || email);
  const linkBtn = { display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" } as const;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <PersonHead name={profile?.name || name} photo={profile?.avatar || item.avatar} userId={item.userId} unverified size={36} onOpenProfile={onOpenProfile} />
      <div className="mac-scroll" style={{ overflowY: "auto", padding: 16, display: "grid", gap: 15, alignContent: "start", background: "#fff" }}>
        <div style={{ fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
          {first} isn&apos;t on Index yet, so there&apos;s no chat to open. {canSend
            ? "Send them an invite and the two of you can pick it up here once they join."
            : "Share the invite link with them, and the two of you can pick it up here once they join."}
        </div>
        {note && <SummarySection label="the opportunity">{note}</SummarySection>}
        {canSend ? (
        <SummarySection label="your message">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={9}
            style={{ width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "var(--ink)", padding: "8px 10px", background: "#fff", outline: "none" }}
          />
        </SummarySection>
        ) : (
          <SummarySection label="invite link">
            <div style={{ fontFamily: "var(--wb-code)", fontSize: 12, padding: "8px 10px", border: "1px solid var(--wb-control)", borderRadius: 3, background: "#fff", userSelect: "text" }}>{INVITE_URL}</div>
          </SummarySection>
        )}
        {socials.length > 0 && (
          <SummarySection label="elsewhere">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {socials.map((s) => (
                <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--wb-control)", borderRadius: 3, padding: "4px 10px", fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-2)", textDecoration: "none" }}>
                  {SOCIAL_ICONS[s.platform]}
                  <span>{s.handle}</span>
                </a>
              ))}
            </div>
          </SummarySection>
        )}
      </div>
      <div style={{ borderTop: "1px solid var(--wb-hairline)", padding: "10px 16px", background: "#fff", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {x && (
          <a className="wb-btn primary small" href={inviteXHref(message)} target="_blank" rel="noopener noreferrer"
            title={`Opens an X message. Pick @${x.handle} as the recipient.`}
            style={linkBtn}>
            {SOCIAL_ICONS.x}
            send on X
          </a>
        )}
        {email && (
          <a className={`wb-btn small${x ? "" : " primary"}`} href={inviteEmailHref({ to: email, subject: inviteSubject(senderName), body: message })}
            title={`Opens your mail app with this message to ${email}.`}
            style={linkBtn}>
            email
          </a>
        )}
        <Btn small primary={!canSend} onClick={copy}>{copied ? "copied" : "copy invite link"}</Btn>
        {onNegotiation && (
          <span style={{ marginLeft: "auto" }}><Btn small onClick={onNegotiation}>agent log ›</Btn></span>
        )}
      </div>
    </div>
  );
}

function PersonPane({
  item,
  bucket,
  intentId,
  intent,
  senderName,
  pane,
  onPane,
  onClose,
  onAccept,
  onPass,
  hasChat = false,
  onOpenChat,
}: {
  item: RadarCardItem;
  bucket: ReturnType<typeof radarBucketForOpportunity>;
  intentId?: string;
  intent?: string;
  senderName?: string | null;
  pane: "stage" | "profile" | "negotiation";
  onPane: (pane: "stage" | "profile" | "negotiation") => void;
  onClose: () => void;
  onAccept: () => void;
  onPass: () => void;
  hasChat?: boolean;
  onOpenChat?: () => void;
}) {
  const navigate = useNavigate();
  const name = item.name || "someone";
  const notOnIndex = item.peer?.emailVerified === false;
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof getPublicUserProfile>> | null>(null);
  // The userId whose profile fetch has finished, so switching people shows loading again.
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const profileSettled = settledFor === item.userId;
  const showingProfile = pane === "profile" || (pane === "stage" && bucket !== "accepted" && bucket !== "negotiating" && bucket !== "closed");
  const openProfile = () => onPane("profile");
  // The agent log names the other agent; tapping it opens its owner's profile page.
  const openFullProfile = () => (item.userId ? navigate(`/u/${item.userId}`) : openProfile());
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
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--wb-hairline)", display: "flex", gap: 12, alignItems: "center", background: "#fff" }}>
          <span title="view profile" onClick={openFullProfile} style={{ cursor: "pointer", lineHeight: 0 }}>
            <TheirAgentAvatar owner={{ id: item.userId, name, photo: item.avatar }} size={28} />
          </span>
          <div style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: "var(--amiga-title)", fontSize: 14, fontWeight: 500 }}>
              your agent ⇄ <span title="view profile" onClick={openFullProfile} style={{ cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>{first}&apos;s agent</span>
            </div>
            <div style={{ fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.4, color: "var(--ink-2)" }}>
              {bucket === "closed"
                ? <>The agents finished talking. This isn&apos;t a chat with {name}.</>
                : <>The two agents are working out whether you and {name} should meet. This isn&apos;t a chat with {name}.</>}
            </div>
          </div>
          {bucket === "accepted" && <Btn small onClick={() => onPane("stage")}>{notOnIndex ? "invite ›" : "chat ›"}</Btn>}
        </div>
        <NegotiationConversation intentId={intentId} opportunityId={item.opportunityId} expanded onToggle={onClose} />
      </div>
    );
  }
  // No Index account means nobody on the other end of a chat, so the
  // accepted stage is an invite the user sends themselves.
  if (!showingProfile && bucket === "accepted" && notOnIndex) {
    return (
      <InvitePane
        key={item.opportunityId}
        item={item}
        name={name}
        intent={intent}
        senderName={senderName}
        onOpenProfile={openProfile}
        onNegotiation={intentId ? () => onPane("negotiation") : undefined}
      />
    );
  }
  if (!showingProfile && bucket === "accepted" && item.userId) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr" }}>
        <PersonHead name={name} photo={item.avatar} userId={item.userId} unverified={item.peer?.emailVerified === false} onOpenProfile={openProfile} action={intentId && (
          <Btn small onClick={() => onPane("negotiation")}>agent log ›</Btn>
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
      <PersonHead name={profile?.name || name} photo={profile?.avatar || item.avatar} userId={item.userId} unverified={item.peer?.emailVerified === false} size={36} onOpenProfile={item.userId ? () => navigate(`/u/${item.userId}`) : undefined} />
      <div className="mac-scroll" style={{ overflowY: "auto", padding: 16, display: "grid", gap: 15, alignContent: "start", background: "#fff" }}>
        {bio && <SummarySection label="bio">{bio}</SummarySection>}
        {note && <SummarySection label="why your agent surfaced them">{note}</SummarySection>}
        {socials.length > 0 && (
          <SummarySection label="elsewhere">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {socials.map((s) => (
                <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--wb-control)", borderRadius: 3, padding: "4px 10px", fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-2)", textDecoration: "none" }}>
                  {SOCIAL_ICONS[s.platform]}
                  <span>{s.handle}</span>
                </a>
              ))}
            </div>
          </SummarySection>
        )}
        {profile?.location && (
          <div style={{ fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-3)" }}>{profile.location}</div>
        )}
        {bucket === "closed" && item.status === "expired" && <SummarySection label="why it closed">an intent was archived.</SummarySection>}
        {!bio && !note && socials.length === 0 && !profile?.location && (
          !profileSettled && item.userId
            ? <EmptyState tone="loading" align="start" />
            : <EmptyState align="start" message="nothing recorded yet." />
        )}
      </div>
      <div style={{ borderTop: "1px solid var(--wb-hairline)", padding: "10px 16px", background: "#fff", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Same as the radar card: a chat that already exists means there is
            nothing left to accept, so offer the chat instead. */}
        {(bucket === "awaiting you" || bucket === "accepted") && hasChat && !notOnIndex ? (
          <Btn primary small onClick={onOpenChat}>open chat ›</Btn>
        ) : bucket === "awaiting you" ? (
          <>
            <Btn primary small onClick={onAccept}>accept</Btn>
            <Btn small onClick={onPass}>pass</Btn>
          </>
        ) : bucket === "accepted" ? (
          <Btn small onClick={() => onPane("stage")}>{notOnIndex ? "invite ›" : "chat ›"}</Btn>
        ) : bucket === "closed" ? (
          <span style={{ fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-3)" }}>this intent closed.</span>
        ) : bucket !== "negotiating" ? (
          <span style={{ fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-3)" }}>
            answer their question in your feed to move forward.
          </span>
        ) : null}
        {intentId && (
          <Btn small onClick={() => onPane(bucket === "negotiating" ? "stage" : "negotiation")}>agent log ›</Btn>
        )}
      </div>
    </div>
  );
}

export const Component = IntentDetailPage;
