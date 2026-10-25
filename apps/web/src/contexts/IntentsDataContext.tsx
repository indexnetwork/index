import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import { STAGE_OF, intentRank, type Entry, type HomeIntent, type Stage } from "@/components/intents-home/stages";
import { useOpportunities } from "@/contexts/APIContext";
import { useOpportunityActions, type AcceptedOpportunityUpdate } from "@/hooks/useOpportunityActions";
import { apiClient } from "@/lib/api";
import { log } from "@/lib/logger";
import { radarBucketForOpportunity } from "@/lib/radar-buckets";
import type { OpportunityLifecycleStatus, RadarCardItem } from "@/services/opportunities";

const logger = log.context.from("IntentsData");

/** Same lifecycle set as the intent radar. Rejected and expired both land in closed. */
const RADAR_STATUSES: OpportunityLifecycleStatus[] = ["pending", "negotiating", "accepted", "rejected", "expired"];
const RADAR_POLL_MS = 10_000;

type OpportunityActions = ReturnType<typeof useOpportunityActions>;

interface IntentsData {
  /** Non-archived intents, active first, newest first. */
  intents: HomeIntent[];
  intentsLoaded: boolean;
  intentsError: boolean;
  fetchIntents: () => Promise<void>;
  updateIntents: (next: (prev: HomeIntent[]) => HomeIntent[]) => void;
  radar: Record<string, RadarCardItem[]>;
  radarFailed: Record<string, boolean>;
  /** "full" runs the presenter (LLM text); "skeleton" reads statuses only and keeps the text already shown. */
  loadRadar: (intentId: string, mode?: "full" | "skeleton") => Promise<void>;
  /** Each intent's people with their stage, after this session's accept/pass. */
  entriesByIntent: Record<string, Entry[]>;
  /** People not yet closed, per intent: the rail's counts. */
  activeCount: (intentId: string) => number;
  opportunityStatusMap: OpportunityActions["opportunityStatusMap"];
  opportunityActionLoading: OpportunityActions["opportunityActionLoading"];
  handleOpportunityAction: OpportunityActions["handleOpportunityAction"];
}

const IntentsDataContext = createContext<IntentsData | null>(null);

/**
 * The signed-in desktop shell's intents and the people found for each. The
 * rail (counts on every page) and the intents screen read the same copy, so
 * moving between pages never refetches or flashes.
 */
export function IntentsDataProvider({ children }: { children: ReactNode }) {
  const opportunitiesService = useOpportunities();
  const [allIntents, setAllIntents] = useState<HomeIntent[]>([]);
  const [intentsLoaded, setIntentsLoaded] = useState(false);
  const [intentsError, setIntentsError] = useState(false);
  const [radar, setRadar] = useState<Record<string, RadarCardItem[]>>({});
  const [radarFailed, setRadarFailed] = useState<Record<string, boolean>>({});
  const radarRef = useRef(radar);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => { radarRef.current = radar; }, [radar]);

  const updateIntents = useCallback((next: (prev: HomeIntent[]) => HomeIntent[]) => setAllIntents(next), []);

  const fetchIntents = useCallback(async () => {
    try {
      const res = await apiClient.post<{ intents?: HomeIntent[] }>("/intents/list", { page: 1, limit: 100 });
      if (!mountedRef.current) return;
      setAllIntents(res.intents ?? []);
      setIntentsError(false);
    } catch (err) {
      logger.error("Failed to load intents", { error: err });
      if (mountedRef.current) setIntentsError(true);
    } finally {
      if (mountedRef.current) setIntentsLoaded(true);
    }
  }, []);

  useEffect(() => { void fetchIntents(); }, [fetchIntents]);

  useEffect(() => {
    if (!allIntents.some((intent) => intent.warming)) return;
    const interval = setInterval(fetchIntents, 30_000);
    return () => clearInterval(interval);
  }, [fetchIntents, allIntents]);

  const intents = useMemo(
    () => allIntents
      .filter((intent) => intent.status !== "archived")
      .sort((a, b) => intentRank(a.status) - intentRank(b.status) || Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [allIntents],
  );

  // One read per intent and mode at a time, so a slow presenter never stacks polls.
  const inFlight = useRef(new Set<string>());
  const loadRadar = useCallback(async (intentId: string, mode: "full" | "skeleton" = "full") => {
    const flightKey = `${intentId}:${mode}`;
    if (inFlight.current.has(flightKey)) return;
    inFlight.current.add(flightKey);
    try {
      const { items } = await opportunitiesService.getRadarView({
        intentId,
        statuses: RADAR_STATUSES,
        ...(mode === "skeleton" ? { presentation: "skeleton" as const } : {}),
      });
      if (!mountedRef.current) return;
      setRadar((prev) => {
        if (mode === "full" || !prev[intentId]) return { ...prev, [intentId]: items };
        // A skeleton read updates who and where; the presenter text already on screen stays.
        const shown = new Map(prev[intentId].map((item) => [item.opportunityId, item]));
        return {
          ...prev,
          [intentId]: items.map((item) => {
            const old = shown.get(item.opportunityId);
            return old && !old.presentationPending ? { ...old, status: item.status, viewerCommitted: item.viewerCommitted } : item;
          }),
        };
      });
      setRadarFailed((prev) => (prev[intentId] ? { ...prev, [intentId]: false } : prev));
    } catch {
      if (mountedRef.current && mode === "full") setRadarFailed((prev) => ({ ...prev, [intentId]: true }));
    } finally {
      inFlight.current.delete(flightKey);
    }
  }, [opportunitiesService]);

  // Every intent's people feed the rail counts and the all view. Presenter text
  // is an LLM call per person (never cached while negotiating), so it is read
  // once per intent; after that only skeletons are polled, plus full text for
  // the intent that is open.
  const { pathname } = useLocation();
  const openIntentId = /^\/i\/([^/]+)/.exec(pathname)?.[1];
  const intentIds = intents.map((intent) => intent.id).join(",");
  useEffect(() => {
    if (!intentIds) return;
    const ids = intentIds.split(",");
    void (async () => {
      const fresh = ids.filter((id) => !radarRef.current[id]);
      await Promise.all(fresh.map((id) => loadRadar(id, "skeleton")));
      // A few at a time, so the presenter never gets every intent at once.
      const queue = [...fresh];
      const worker = async () => { for (let id = queue.shift(); id; id = queue.shift()) await loadRadar(id, "full"); };
      await Promise.all([worker(), worker(), worker()]);
    })();
    const timer = setInterval(() => { for (const id of ids) void loadRadar(id, "skeleton"); }, RADAR_POLL_MS);
    return () => clearInterval(timer);
  }, [intentIds, loadRadar]);

  useEffect(() => {
    if (!openIntentId || openIntentId === "new") return;
    const timer = setInterval(() => { void loadRadar(openIntentId, "full"); }, RADAR_POLL_MS * 3);
    return () => clearInterval(timer);
  }, [openIntentId, loadRadar]);

  const onAccepted = useCallback((update: AcceptedOpportunityUpdate) => {
    setRadar((prev) => {
      const next: typeof prev = {};
      for (const [id, items] of Object.entries(prev)) {
        next[id] = items.map((item) => item.opportunityId === update.opportunityId
          ? { ...item, status: update.status, viewerCommitted: update.viewerCommitted ?? true }
          : item);
      }
      return next;
    });
  }, []);
  const { opportunityStatusMap, opportunityActionLoading, handleOpportunityAction } = useOpportunityActions({ onAccepted });

  const entriesByIntent = useMemo(() => {
    const stageOf = (item: RadarCardItem): Stage | null => {
      // Local actions (accept/pass in this session) override the fetched status.
      const status = (opportunityStatusMap[item.opportunityId] as OpportunityLifecycleStatus | undefined) ?? item.status;
      const bucket = radarBucketForOpportunity(status, item.viewerCommitted);
      return bucket ? STAGE_OF[bucket] : null;
    };
    const out: Record<string, Entry[]> = {};
    for (const intent of intents) {
      out[intent.id] = (radar[intent.id] ?? []).flatMap((item) => {
        const stage = stageOf(item);
        return stage ? [{ intentId: intent.id, item, stage }] : [];
      });
    }
    return out;
  }, [intents, radar, opportunityStatusMap]);

  const activeCount = useCallback(
    (intentId: string) => (entriesByIntent[intentId] ?? []).filter((entry) => entry.stage !== "closed").length,
    [entriesByIntent],
  );

  const value = useMemo<IntentsData>(() => ({
    intents, intentsLoaded, intentsError, fetchIntents, updateIntents,
    radar, radarFailed, loadRadar, entriesByIntent, activeCount,
    opportunityStatusMap, opportunityActionLoading, handleOpportunityAction,
  }), [intents, intentsLoaded, intentsError, fetchIntents, updateIntents, radar, radarFailed, loadRadar, entriesByIntent, activeCount, opportunityStatusMap, opportunityActionLoading, handleOpportunityAction]);

  return <IntentsDataContext.Provider value={value}>{children}</IntentsDataContext.Provider>;
}

export function useIntentsData(): IntentsData {
  const value = useContext(IntentsDataContext);
  if (!value) throw new Error("useIntentsData must be used within IntentsDataProvider");
  return value;
}
