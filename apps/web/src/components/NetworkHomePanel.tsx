import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNetworks, useOpportunities } from "@/contexts/APIContext";
import { useOpportunityActions } from "@/hooks/useOpportunityActions";
import { radarBucketForOpportunity } from "@/lib/radar-buckets";
import type { RadarCardItem, OpportunityLifecycleStatus } from "@/services/opportunities";
import { HomeDashboardBody, type HomeDashboardData } from "@/components/intents-home/HomeDashboard";
import { STAGE_OF, type Entry, type HomeIntent } from "@/components/intents-home/stages";
import { EmptyState } from "@/components/ui/EmptyState";

const NETWORK_RADAR = "opportunity:inbox";

/** Supplies network-scoped data to the real Home body; no separate layout or styles. */
export default function NetworkHomePanel({ network }: { network: { id: string; title: string } }) {
  const service = useOpportunities();
  const networks = useNetworks();
  const [items, setItems] = useState<RadarCardItem[]>([]);
  const [intents, setIntents] = useState<HomeIntent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const active = useRef(false);
  const actions = useOpportunityActions();

  const loadRadar = useCallback(async () => {
    const result = await service.getRadarView({ networkId: network.id, statuses: ["pending", "negotiating", "accepted"], limit: 100, noCache: true });
    if (active.current) setItems(result.items);
  }, [network.id, service]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const [result, overview] = await Promise.all([
          service.getRadarView({ networkId: network.id, statuses: ["pending", "negotiating", "accepted"], limit: 100, noCache: true }),
          networks.getNetworkOverview(network.id),
        ]);
        if (!cancelled) { setItems(result.items); setIntents(overview.intents); setFailed(false); }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        pending = false;
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => { cancelled = true; active.current = false; clearInterval(timer); };
  }, [network.id, service, networks, revision]);

  const entries = useMemo<Entry[]>(() => items.map((item) => {
    const status = (actions.opportunityStatusMap[item.opportunityId] as OpportunityLifecycleStatus | undefined) ?? item.status;
    return { intentId: NETWORK_RADAR, item, stage: STAGE_OF[radarBucketForOpportunity(status, item.viewerCommitted)!] };
  }), [items, actions.opportunityStatusMap]);
  const data: HomeDashboardData = {
    intents, intentsLoaded: loaded,
    radar: { [NETWORK_RADAR]: items, ...Object.fromEntries(intents.map((intent) => [intent.id, []])) },
    radarFailed: {}, entriesByIntent: { [NETWORK_RADAR]: entries },
    opportunityActionLoading: actions.opportunityActionLoading,
    handleOpportunityAction: actions.handleOpportunityAction,
    loadRadar: async () => { try { await loadRadar(); } catch { if (active.current) setFailed(true); } },
  };

  return <>
    {failed && <EmptyState tone="error" message="couldn't refresh this network's opportunities." action={{ label: "try again", onClick: () => setRevision((value) => value + 1) }} />}
    {(!failed || items.length > 0) && <HomeDashboardBody data={data} embedded questionIntentIds={intents.map((intent) => intent.id)} />}
  </>;
}
