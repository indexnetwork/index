import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import "@/styles/intents-home.css";
import { isPaused, sentenceOf } from "@/components/intents-home/people";
import { intentColor, type HomeIntent } from "@/components/intents-home/stages";
import { useIntents } from "@/contexts/APIContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNotifications } from "@/contexts/NotificationContext";

/** Your intents in your own words, with what each one has turned up and the controls to pause or archive it. */
export default function IntentsPage() {
  const navigate = useNavigate();
  const { intents, intentsLoaded, intentsError, fetchIntents } = useIntentsData();
  const live = intents.filter((intent) => !isPaused(intent)).length;
  return (
    <div className="ih-view">
      <header className="ih-head">
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="ih-eyebrow">INTENTS</div>
          <h1 className="ih-title">what you&apos;re looking for</h1>
          <div className="ih-status">
            {intents.length ? `${live} live${intents.length > live ? ` · ${intents.length - live} paused` : ""}` : "nothing yet"}
          </div>
        </div>
      </header>
      <div className="ih-cols">
        <section className="ih-people ih-all ih-intent-list">
          {intentsError && !intents.length ? (
            <div className="ih-empty">couldn&apos;t load your intents. <button type="button" className="ih-link" onClick={() => void fetchIntents()}>try again</button></div>
          ) : !intentsLoaded ? (
            <div className="ih-empty">loading…</div>
          ) : !intents.length ? (
            <div className="ih-empty">
              no intents yet. say what you need and your agent goes looking.
              <button type="button" className="ih-next" onClick={() => navigate("/i/new")}>+ start your first intent ›</button>
            </div>
          ) : intents.map((intent) => <IntentCard key={intent.id} intent={intent} />)}
        </section>
      </div>
    </div>
  );
}

function IntentCard({ intent }: { intent: HomeIntent }) {
  const navigate = useNavigate();
  const intentsService = useIntents();
  const { error: showError } = useNotifications();
  const { entriesByIntent, questionsByIntent, updateIntents } = useIntentsData();
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const paused = isPaused(intent);
  const entries = entriesByIntent[intent.id] ?? [];
  const count = (stages: string[]) => entries.filter((entry) => stages.includes(entry.stage)).length;
  const waiting = count(["awaiting"]);
  const moving = count(["talks", "chat"]);
  const closed = count(["closed"]);
  const questions = questionsByIntent[intent.id]?.length ?? 0;

  const togglePause = async () => {
    if (pending) return;
    setPending(true);
    try {
      const updated = await intentsService.setIntentStatus(intent.id, paused ? "active" : "paused");
      updateIntents((prev) => prev.map((i) => (i.id === updated.id ? { ...i, status: updated.status } : i)));
    } catch {
      showError(paused ? "Failed to resume intent" : "Failed to pause intent");
    } finally {
      setPending(false);
    }
  };

  const archive = async () => {
    if (pending) return;
    if (timer.current) window.clearTimeout(timer.current);
    if (!armed) {
      setArmed(true);
      timer.current = window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    setPending(true);
    try {
      await intentsService.archiveIntent(intent.id);
      updateIntents((prev) => prev.filter((i) => i.id !== intent.id));
    } catch {
      showError("couldn't archive this intent.");
      setPending(false);
    }
  };

  return (
    <article className={`ih-intent-card${paused ? " paused" : ""}`} data-testid="intent-card">
      <span className="ih-intent-tag" style={{ background: intentColor(intent.id) }} aria-hidden="true" />
      <div className="ih-intent-card-body">
        <h2 className="ih-intent-card-text">{sentenceOf(intent)}</h2>
        <div className="ih-intent-meta">
          {paused ? "paused · your agent isn't looking" : <><span className="ih-live-dot" aria-hidden="true" />live</>}
          {intent.createdAt && ` · since ${new Date(intent.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
        </div>
        <div className="ih-intent-counts">
          {questions > 0 && <button type="button" className="ih-count hot" onClick={() => navigate("/")}>{questions} question{questions === 1 ? "" : "s"}</button>}
          {waiting > 0 && <button type="button" className="ih-count hot" onClick={() => navigate(`/opportunities?intent=${intent.id}`)}>{waiting} waiting on you</button>}
          {moving > 0 && <button type="button" className="ih-count" onClick={() => navigate(`/opportunities?intent=${intent.id}`)}>{moving} in progress</button>}
          {closed > 0 && <button type="button" className="ih-count" onClick={() => navigate(`/opportunities?intent=${intent.id}`)}>{closed} closed</button>}
          {!questions && !waiting && !moving && !closed && <span className="ih-intent-meta">{paused ? "nobody found yet" : "nobody found yet · your agent is looking"}</span>}
        </div>
      </div>
      <div className="ih-actions ih-intent-card-actions">
        <button type="button" className="ih-ghost" disabled={pending} onClick={() => void togglePause()}>{paused ? "▶ resume" : "❚❚ pause"}</button>
        <button type="button" className="ih-ghost" disabled={pending} onClick={() => void archive()}>{armed ? "archive · confirm" : "archive"}</button>
      </div>
    </article>
  );
}
