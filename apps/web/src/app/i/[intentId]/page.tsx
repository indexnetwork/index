import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import AppHandoff from "@/components/AppHandoff";
import IntentNegotiatorChat from "@/components/IntentNegotiatorChat";
import NegotiationConversation from "@/components/NegotiationConversation";
import ChatView from "@/components/chat/ChatView";
import UserAvatar from "@/components/UserAvatar";
import { TheirAgentAvatar } from "@/components/workbench/agent-avatar";
import { useConversation } from "@/contexts/ConversationContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { APIError } from "@/lib/api";
import { useIntents, useOpportunities } from "@/contexts/APIContext";
import { getPublicUserProfile } from "@/services/users";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunityActions } from "@/hooks/useOpportunityActions";
import type { RadarCardItem, OpportunityLifecycleStatus } from "@/services/opportunities";
import type { IntentLifecycleStatus, MutableIntentLifecycleStatus } from "@/services/intents";
import { DEFAULT_RADAR_BUCKET, RADAR_STAGES, personWindowTitle, radarBucketForOpportunity, radarEmptyLine, type RadarBucket } from "@/lib/radar-buckets";
import { DiscoveryLoader, MatchCard, PipelineFunnel, SignalAction, SummarySection, expiryReason } from "@/components/workbench/mac-blocks";
import { Btn, Window } from "@/components/workbench/Workbench";

function normalizeIntentLifecycleStatus(status: unknown): IntentLifecycleStatus {
  if (status === "paused") return status;
  return "active";
}

/** A signal can match nobody, so the radar stops showing the loader after this. Same as the Mac app. */
const DISCOVERY_GIVE_UP_MS = 120_000;

/** Bounded intent-refinement poll: interval (ms) and maximum total wait (ms). */
/**
 * Same lifecycle set as the Mac radar. Rejected is left out on purpose:
 * the list keeps one card per person, newest first, and a rejection is
 * usually the agent's filter, not a choice the person made. Including it
 * hides the pending or accepted card the Mac app still shows.
 */
const RADAR_STATUSES: OpportunityLifecycleStatus[] = [
  "pending",
  "negotiating",
  "accepted",
  "expired",
];

/** Intent detail view: the signal window beside the radar. */
export default function IntentDetailPage() {
  const { intentId } = useParams<{ intentId: string }>();
  return <AppHandoff kind="i" id={intentId ?? ""} webPage={<IntentDetail />} />;
}

function IntentDetail() {
  const navigate = useNavigate();
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

  useLayoutEffect(() => {
    activeIntentIdRef.current = intentId;
    lifecycleGenerationRef.current += 1;
    lifecycleMutationRef.current = null;
    selectedBucketEffectRef.current = null;
    setArchiveArmed(false);
    if (archiveTimer.current) window.clearTimeout(archiveTimer.current);
    setArchiving(false);
    setOpenPersonId(null);
    setOpportunities([]);
  }, [intentId]);

  const scope = useMemo(
    () => (intentId ? { intentId } : undefined),
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
        setIntentMissing(error instanceof APIError && error.status === 404);
      })
      .finally(() => {
        if (active) setIntentLoading(false);
      });
    void loadOpportunities();
    return () => {
      active = false;
    };
  }, [intentId, intentsService, loadOpportunities, authLoading, isAuthenticated, navigate]);

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

  return (
    <>
      {opportunityModalElement}
      <div style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: openPerson
          ? "minmax(0, 40fr) minmax(0, 30fr) minmax(0, 30fr)"
          : "minmax(0, 56fr) minmax(0, 44fr)",
        gap: 8,
        padding: "56px 18px",
        minHeight: 0,
      }}>
        {!intentLoading && !intent && intentMissing ? (
          <Window title="signal" onClose={() => navigate("/")}>
            <p style={{ padding: 28, fontFamily: "var(--mac-mono)", fontSize: 12 }}>signal not found</p>
          </Window>
        ) : !intent ? null : (
          <>
            <Window title="signal" onClose={() => navigate("/")}>
              <div style={{ display: "grid", gridTemplateRows: "auto 1fr", flex: 1, minHeight: 0 }}>
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
                <div style={{ minHeight: 0, display: "flex", flexDirection: "column", flex: 1 }}>
                  {intentId && <IntentNegotiatorChat key={intentId} intentId={intentId} onSelectMatch={(id) => setOpenPersonId(id)} />}
                </div>
              </div>
            </Window>
            <Window title="radar" onClose={() => navigate("/")}>
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
              <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 22px 24px", display: "grid", gap: 8, alignContent: "start" }}>
                {opportunitiesLoading || discovering ? (
                  <div data-testid="radar-skeleton"><DiscoveryLoader /></div>
                ) : opportunitiesError && visibleOpportunities.length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center" }}>
                    <p style={{ fontFamily: "var(--mac-mono)", fontSize: 12 }}>radar couldn’t load.</p>
                    <Btn small onClick={() => void loadOpportunities()}>try again</Btn>
                  </div>
                ) : visibleOpportunities.length === 0 ? (
                  <p style={{ padding: 28, textAlign: "center", fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)", border: "1px dashed #000" }}>
                    {radarEmptyLine(selectedBucket)}
                  </p>
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
                      accepted={bucket === "accepted"}
                      ready={bucket === "awaiting you"}
                      negotiating={bucket === "negotiating"}
                      expired={bucket === "missed"}
                      waitingOnThem={waitingOnThem}
                      hasChat={!!(item.userId || peer?.userId) && chatPeers.has(item.userId || peer?.userId || "")}
                      onOpen={() => setOpenPersonId(item.opportunityId)}
                      onAccept={() => { if (!busy) void handleOpportunityAction(item.opportunityId, "accepted", item.userId || peer?.userId); }}
                      onPass={() => { if (!busy) void handleOpportunityAction(item.opportunityId, "rejected", item.userId || peer?.userId); }}
                    />
                  );
                })}
              </div>
            </Window>
            {openPerson && (
              <Window title={personWindowTitle(bucketOf(openPerson))} dismiss onClose={() => setOpenPersonId(null)}>
                <PersonPane
                  item={openPerson}
                  bucket={bucketOf(openPerson)}
                  intentId={intentId}
                  onClose={() => setOpenPersonId(null)}
                  onAccept={() => void handleOpportunityAction(openPerson.opportunityId, "accepted", openPerson.userId)}
                  onPass={() => void handleOpportunityAction(openPerson.opportunityId, "rejected", openPerson.userId)}
                />
              </Window>
            )}
          </>
        )}
      </div>
    </>
  );
}

function PersonHead({ name, photo, userId, sub, size = 34 }: {
  name: string; photo?: string | null; userId?: string; sub?: string; size?: number;
}) {
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid #000", display: "flex", gap: 12, alignItems: "center", background: "#fff" }}>
      <UserAvatar id={userId} name={name} avatar={photo} size={size} />
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--amiga-title)", fontSize: size > 34 ? 17 : 15, fontWeight: 600, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        {sub && <div style={{ fontFamily: "var(--mac-mono)", fontSize: 10, color: "var(--ink-2)", letterSpacing: 1, textTransform: "uppercase" }}>{sub}</div>}
      </div>
    </div>
  );
}

function PersonPane({
  item,
  bucket,
  intentId,
  onClose,
  onAccept,
  onPass,
}: {
  item: RadarCardItem;
  bucket: ReturnType<typeof radarBucketForOpportunity>;
  intentId?: string;
  onClose: () => void;
  onAccept: () => void;
  onPass: () => void;
}) {
  const name = item.name || "someone";
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof getPublicUserProfile>> | null>(null);
  useEffect(() => {
    if (!item.userId || bucket === "negotiating" || bucket === "accepted" || bucket === "missed") return;
    let active = true;
    getPublicUserProfile(item.userId).then((user) => { if (active) setProfile(user); }).catch(() => {});
    return () => { active = false; };
  }, [item.userId, bucket]);

  if (bucket === "accepted" && item.userId) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr" }}>
        <PersonHead name={name} photo={item.avatar} userId={item.userId} />
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ChatView embedded userId={item.userId} userName={name} userAvatar={item.avatar ?? undefined} onClose={onClose} opener={{ headline: item.headline, detail: item.mainText }} />
        </div>
      </div>
    );
  }
  if (bucket === "negotiating" && intentId) {
    const first = name.split(/\s+/)[0];
    return (
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #000", display: "flex", gap: 12, alignItems: "center", background: "#fff" }}>
          <TheirAgentAvatar owner={{ id: item.userId, name, photo: item.avatar }} size={34} />
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--amiga-title)", fontSize: 15, fontWeight: 600 }}>your agent ⇄ {first}&apos;s agent</div>
            <div style={{ fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.4, color: "var(--ink-2)" }}>
              The two agents are working out whether you and {name} should meet. This isn&apos;t a chat with {name}.
            </div>
          </div>
        </div>
        <NegotiationConversation intentId={intentId} opportunityId={item.opportunityId} expanded onToggle={onClose} />
      </div>
    );
  }
  if (bucket === "missed") {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr" }}>
        <PersonHead name={name} photo={item.avatar} userId={item.userId} sub="expired" />
        <div className="mac-scroll" style={{ overflowY: "auto", padding: 16, display: "grid", gap: 16, alignContent: "start", background: "#fff" }}>
          <SummarySection label="what your agent found">{item.mainText || item.headline || "nothing recorded."}</SummarySection>
          <SummarySection label="why it closed">{expiryReason(item.opportunityId, name)}</SummarySection>
        </div>
      </div>
    );
  }
  const bio = profile?.intro || "";
  const note = item.mainText && item.mainText !== bio ? item.mainText : item.headline;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <PersonHead name={profile?.name || name} photo={profile?.avatar || item.avatar} userId={item.userId} size={42} />
      <div className="mac-scroll" style={{ overflowY: "auto", padding: 16, display: "grid", gap: 15, alignContent: "start", background: "#fff" }}>
        {bio && <SummarySection label="bio">{bio}</SummarySection>}
        {note && <SummarySection label="why your agent surfaced them">{note}</SummarySection>}
        {profile?.location && <SummarySection label="elsewhere">{profile.location}</SummarySection>}
      </div>
      <div style={{ borderTop: "1px solid #000", padding: "10px 14px", background: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
        {bucket === "awaiting you" ? (
          <>
            <Btn primary small onClick={onAccept}>accept</Btn>
            <Btn small onClick={onPass}>pass</Btn>
          </>
        ) : (
          <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-3)" }}>
            answer their question in your feed to move forward.
          </span>
        )}
      </div>
    </div>
  );
}

export const Component = IntentDetailPage;
