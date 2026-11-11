import { Link, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import PageHead from "@/components/intents-home/PageHead";
import "@/styles/plain.css";
import { intentLabel, type Stage } from "@/components/intents-home/stages";
import { useIntentsData } from "@/contexts/IntentsDataContext";

/**
 * Every intent as a row, with the same lines and hover as Home's cards: the
 * intent in full, how it's going. A click anywhere on the row
 * opens the intent.
 */
export default function IntentsIndex() {
  const navigate = useNavigate();
  const { intents, intentsLoaded, intentsError, fetchIntents, entriesByIntent, radar, radarFailed } = useIntentsData();
  const paused = intents.filter((intent) => (intent.status || "").toLowerCase() === "paused").length;
  const live = intents.length - paused;

  return (
    <div className="ih-view pl">
      <div className="pl-col">
      {/* One centered line like Home's: what this page is, then how many are live. */}
      <PageHead
        title={<>your intents. {intentsLoaded && (intents.length === 0
          ? "none yet."
          : live === 0
            ? "all paused for now."
            : `${live} live${paused ? `, ${paused} paused` : ""}. your agent is looking for each one.`)}</>}
        centered
      >
        <button type="button" className="go" onClick={() => navigate("/i/new")}>+ new intent</button>
      </PageHead>
      <div className="pl-page">
        {intentsError && !intents.length ? (
          <p>couldn&apos;t load your intents. <button type="button" onClick={() => void fetchIntents()}>try again</button></p>
        ) : !intentsLoaded ? (
          <p className="pl-dim">loading…</p>
        ) : intents.length === 0 ? (
          <p className="pl-dim">none yet.</p>
        ) : (
          <ul className="pl-cards">
            {intents.map((intent) => {
              const paused = (intent.status || "").toLowerCase() === "paused";
              const entries = entriesByIntent[intent.id] ?? [];
              const counts: Record<Stage, number> = { awaiting: 0, talks: 0, chat: 0, closed: 0 };
              for (const entry of entries) counts[entry.stage] += 1;
              const loading = !radar[intent.id] && !radarFailed[intent.id];
              const bits = [
                counts.talks && `${counts.talks} in talks`,
                counts.chat && `${counts.chat} chatting`,
              ].filter(Boolean);
              const state = paused ? "paused" : counts.awaiting > 0 ? "waiting" : "live";
              const text = intent.payload?.trim() || intent.summary?.trim() || "";
              return (
                <li key={intent.id} className={`pl-card pl-card-open${state === "waiting" ? "" : ` ${state}`}`}
                  onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button")) navigate(`/i/${intent.id}`); }}>
                  <div className="pl-card-body">
                    <div className="pl-card-head">
                      <b className="pl-intent-title"><Link to={`/i/${intent.id}`}>{text || intentLabel(intent)}</Link></b>
                      <span className={`pl-status ${state}`}>
                        {paused ? "paused" : counts.awaiting > 0 ? `${counts.awaiting} waiting on you` : "live"}
                      </span>
                    </div>
                    <div className="pl-card-foot">
                      <span className="pl-dim pl-small">
                        {loading ? "loading…" : bits.length ? bits.join(", ") : counts.awaiting ? "new matches" : paused ? "not looking" : "agents in talks"}
                        {intent.createdAt && ` · since ${new Date(intent.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </div>
    </div>
  );
}
