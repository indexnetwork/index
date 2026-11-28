import { useEffect, useState } from "react";
import { Link } from "react-router";

import { useOpportunities } from "@/contexts/APIContext";
import { useOpportunityActions } from "@/hooks/useOpportunityActions";
import { radarBucketForOpportunity, radarActivityMs, formatRadarAge, radarActivityAt } from "@/lib/radar-buckets";
import type { RadarCardItem, OpportunityLifecycleStatus } from "@/services/opportunities";
import UserAvatar from "@/components/UserAvatar";
import { Placeholder } from "@/components/ui/Placeholder";
import { EmptyState } from "@/components/ui/EmptyState";
import "@/styles/network-home.css";

const SECTIONS = [
  { bucket: "awaiting you", title: "waiting on you", empty: "nothing waiting on you right now." },
  { bucket: "negotiating", title: "in progress", empty: "your agent will bring new opportunities here as it finds them." },
  { bucket: "accepted", title: "accepted", empty: "the opportunities you accept will appear here." },
] as const;

/** A member's opportunities from this network, independent of the global home. */
export default function NetworkHomePanel({ network }: { network: { id: string; title: string } }) {
  const service = useOpportunities();
  const [items, setItems] = useState<RadarCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const { opportunityStatusMap, opportunityActionLoading, handleOpportunityAction } = useOpportunityActions();

  useEffect(() => {
    let active = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await service.getRadarView({
          networkId: network.id,
          statuses: ["pending", "negotiating", "accepted"],
          limit: 100,
          noCache: true,
        });
        if (active) {
          setItems(result.items);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [network.id, service, revision]);

  const statusOf = (item: RadarCardItem) => (opportunityStatusMap[item.opportunityId] as OpportunityLifecycleStatus | undefined) ?? item.status;
  const ordered = [...items].sort((a, b) => radarActivityMs(b) - radarActivityMs(a));

  return (
    <div className="network-home">
      <p className="network-home-intro">your opportunities in {network.title}.</p>
      {failed && <EmptyState tone="error" message="couldn't refresh this network's opportunities." action={{ label: "try again", onClick: () => setRevision((value) => value + 1) }} />}
      {loading ? <Placeholder.Rows count={3} label="loading network opportunities" /> : !failed || items.length > 0 ? SECTIONS.map((section) => {
        const rows = ordered.filter((item) => radarBucketForOpportunity(statusOf(item), item.viewerCommitted) === section.bucket);
        return (
          <section key={section.bucket} aria-label={section.title}>
            <h2 className="network-home-heading">{section.title} <span>{rows.length}</span></h2>
            {rows.length === 0 ? <p className="network-home-empty">{section.empty}</p> : rows.map((item) => {
              const peerId = item.userId || item.peer?.userId;
              const name = item.name || item.peer?.name || "unknown";
              const busy = !!opportunityActionLoading[item.opportunityId];
              const age = formatRadarAge(radarActivityAt(item));
              const notOnIndex = item.peer?.emailVerified === false;
              return (
                <article key={item.opportunityId} className="network-home-card">
                  <UserAvatar id={peerId || item.opportunityId} name={name} avatar={item.avatar ?? item.peer?.avatar} size={36} />
                  <div className="network-home-body">
                    <div className="network-home-person">
                      {peerId ? <Link to={`/u/${peerId}`}>{name}</Link> : <strong>{name}</strong>}
                      {age && <span>{age}</span>}
                    </div>
                    {(item.headline || item.mainText) && <p>{item.headline || item.mainText}</p>}
                    {section.bucket === "awaiting you" && (
                      <div className="network-home-actions">
                        <button type="button" disabled={busy} onClick={() => void handleOpportunityAction(item.opportunityId, "accepted", peerId, { notOnIndex })}>accept</button>
                        <button type="button" disabled={busy} onClick={() => void handleOpportunityAction(item.opportunityId, "rejected", peerId)}>pass</button>
                      </div>
                    )}
                    {section.bucket === "accepted" && (notOnIndex
                      ? <p className="network-home-empty">accepted · not on index yet</p>
                      : peerId && <Link className="network-home-chat" to={`/u/${peerId}/chat`}>open chat ›</Link>)}
                  </div>
                </article>
              );
            })}
          </section>
        );
      }) : null}
    </div>
  );
}
