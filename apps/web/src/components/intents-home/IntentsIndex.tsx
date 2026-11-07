import { Link, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import "@/styles/plain.css";
import { RANK, intentLabel, personKey, type Entry, type Stage } from "@/components/intents-home/stages";
import { MyAgentAvatar, TheirAgentAvatar } from "@/components/workbench/agent-avatar";
import { useIntentsData } from "@/contexts/IntentsDataContext";

const FACES = 5;

/**
 * Every intent as a card, the same card as Home's matches: your agent on the
 * left, the short name, the intent itself, who it has found, and a way in.
 */
export default function IntentsIndex() {
  const navigate = useNavigate();
  const { intents, intentsLoaded, intentsError, fetchIntents, entriesByIntent, radar, radarFailed } = useIntentsData();

  return (
    <div className="ih-view pl">
      <div className="pl-page">
        <h2>your intents {intentsLoaded && `(${intents.length})`}</h2>
        <p><button type="button" className="go big" onClick={() => navigate("/i/new")}>+ new intent</button></p>
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
              const found = uniquePeople(entries.filter((entry) => entry.stage !== "closed"));
              const bits = [
                counts.talks && `${counts.talks} in talks`,
                counts.chat && `${counts.chat} chatting`,
              ].filter(Boolean);
              const state = paused ? "paused" : counts.awaiting > 0 ? "waiting" : "live";
              const text = intent.payload?.trim() || intent.summary?.trim() || "";
              return (
                <li key={intent.id} className={`pl-card${state === "waiting" ? "" : ` ${state}`}`}>
                  <MyAgentAvatar size={44} />
                  <div className="pl-card-body">
                    <div className="pl-card-head">
                      <b><Link to={`/i/${intent.id}`} title={text}>{intentLabel(intent)}</Link></b>
                      <span className={`pl-status ${state}`}>
                        {paused ? "paused" : counts.awaiting > 0 ? `${counts.awaiting} waiting on you` : "live"}
                      </span>
                    </div>
                    {text && <p className="pl-intent-text">{text}</p>}
                    <div className="pl-card-foot">
                      <button type="button" className="go" onClick={() => navigate(`/i/${intent.id}`)}>open</button>
                      {found.length > 0 && (
                        <span className="pl-faces" aria-label={`${found.length} people found`}>
                          {found.slice(0, FACES).map((entry) => {
                            const item = entry.item;
                            const name = item.name || item.peer?.name || "someone";
                            return (
                              <TheirAgentAvatar key={personKey(item)} size={22}
                                owner={{ id: item.userId || item.peer?.userId, name, photo: item.avatar ?? item.peer?.avatar }} />
                            );
                          })}
                          {found.length > FACES && <span className="ih-badge">+{found.length - FACES}</span>}
                        </span>
                      )}
                      <span className="pl-dim pl-small">
                        {loading ? "loading…" : bits.length ? bits.join(", ") : counts.awaiting ? "new matches" : paused ? "not looking" : "still looking"}
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
  );
}

/** One entry per person, best stage first, so a face shows once. */
function uniquePeople(entries: Entry[]): Entry[] {
  const best = new Map<string, Entry>();
  for (const entry of [...entries].sort((a, b) => RANK[a.stage] - RANK[b.stage])) {
    const key = personKey(entry.item);
    if (!best.has(key)) best.set(key, entry);
  }
  return [...best.values()];
}
