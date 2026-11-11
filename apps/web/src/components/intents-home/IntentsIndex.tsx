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
  const { intents, intentsLoaded, intentsError, fetchIntents, entriesByIntent } = useIntentsData();

  return (
    <div className="ih-view pl">
      <div className="pl-col">
      {/* A title line like Home's, with the way to start another. */}
      <PageHead title="intents" centered>
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
              const state = paused ? "paused" : counts.awaiting > 0 ? "waiting" : "live";
              const text = intent.payload?.trim() || intent.summary?.trim() || "";
              return (
                <li key={intent.id} className={`pl-card pl-card-open${state === "waiting" ? "" : ` ${state}`}`}
                  onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button")) navigate(`/i/${intent.id}`); }}>
                  <div className="pl-card-body">
                    <div className="pl-card-head">
                      <b className="pl-intent-title"><Link to={`/i/${intent.id}`} className="pl-name">{text || intentLabel(intent)}</Link></b>
                      {!paused && counts.awaiting > 0 && (
                        <span className="ih-badge pl-intent-count" title={`${counts.awaiting} waiting on you`}>{counts.awaiting}</span>
                      )}
                    </div>
                    {/* Status as on production (a blinking orange square while my agents talk), then the date, on one line. */}
                    <div className="pl-intent-state">
                      {!paused && <span className="pl-live-sq" aria-hidden />}
                      {paused ? "paused" : "agents in talks"}
                      {intent.createdAt && <span className="pl-intent-since">· since {new Date(intent.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
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
