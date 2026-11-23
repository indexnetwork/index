import { useNavigate } from "react-router";

import "@/styles/intents-home.css";
import "@/styles/plain.css";
import { PageView, Seg } from "@/components/intents-home/SplitView";
import { intentLabel, type Stage } from "@/components/intents-home/stages";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { Placeholder } from "@/components/ui/Placeholder";

const since = (iso?: string) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase() : "";

/**
 * /intents: every intent as a row (in your words, how many are waiting on
 * you, how it's going). A row opens the intent's own page.
 */
export default function IntentsIndex() {
  const navigate = useNavigate();
  const { intents, intentsLoaded, intentsError, fetchIntents, entriesByIntent } = useIntentsData();
  const live = intents.filter((intent) => (intent.status || "").toLowerCase() !== "paused").length;

  const list = intentsError && !intents.length ? (
    <div className="sv-empty">couldn&apos;t load your intents. <button type="button" className="sv-link" onClick={() => void fetchIntents()}>try again</button></div>
  ) : !intentsLoaded ? (
    <div className="sv-empty"><Placeholder.Rows count={4} avatar={false} label="loading intents" /></div>
  ) : intents.length === 0 ? (
    <div className="sv-empty">none yet. <button type="button" className="sv-link" onClick={() => navigate("/i/new")}>write your first intent</button></div>
  ) : [...intents].sort((a, b) => {
    // Live first, then paused; each oldest first.
    const pa = (a.status || "").toLowerCase() === "paused" ? 1 : 0;
    const pb = (b.status || "").toLowerCase() === "paused" ? 1 : 0;
    return pa - pb || (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  }).map((intent) => {
    const paused = (intent.status || "").toLowerCase() === "paused";
    const counts: Record<Stage, number> = { awaiting: 0, talks: 0, chat: 0, closed: 0 };
    for (const entry of entriesByIntent[intent.id] ?? []) counts[entry.stage] += 1;
    const text = intent.payload?.trim() || intent.summary?.trim() || intentLabel(intent);
    return (
      <div key={intent.id} data-sv-item={intent.id} className={`sv-card sv-icard${paused ? " paused" : ""}`}
        onClick={() => navigate(`/i/${intent.id}`)}>
        <div className="sv-card-body">
          <div className="sv-itext">{text}</div>
          <div className="sv-istat">
            {paused ? "paused" : <span className="sv-status talks">agents in talks</span>}
            {intent.createdAt && <> · since {since(intent.createdAt)}</>}
          </div>
        </div>
        {!paused && counts.awaiting > 0 && <span className="sv-badge" title={`${counts.awaiting} waiting on you`}>{counts.awaiting}</span>}
      </div>
    );
  });

  return (
    <PageView
      title="intents"
      actions={<button type="button" className="sv-btn go sm" onClick={() => navigate("/i/new")}>+ new intent</button>}
      seg={<Seg items={[{ label: "all", n: intents.length }, { label: "live", n: live }, { label: "paused", n: intents.length - live }]} />}
    >
      <div className="sv-page-list">{list}</div>
    </PageView>
  );
}
