import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import PageHead from "@/components/intents-home/PageHead";
import { useInAppFrame } from "@/components/intents-home/appFrameContext";
import { Stage, Window } from "@/components/workbench/Workbench";
import UserAvatar from "@/components/UserAvatar";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCompact } from "@/hooks/useCompact";
import { authClient } from "@/lib/auth-client";
import { useAuthenticatedAPI } from "@/lib/api";
import { log } from "@/lib/logger";
import { CONTACT_SCOPES, createIntroducerService, type IntroducerStatus, type IntroductionProgress, type IntroductionPhase, type PairSuggestion } from "@/services/introducer";
import "@/styles/plain.css";
import "@/styles/introduce.css";

const logger = log.page.from("introduce");

const SKIPS_KEY = "index.introSkips";
const POLL_MS = 5000;
const MAX_CONTEXT = 2000;

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

function loadSkips(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SKIPS_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

function since(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const isFinal = (p: IntroductionProgress) => p.phase === "met" || p.phase === "no_fit" || p.phase === "quiet";

/** The four stops every introduction can pass. Ending early stops the track where it was. */
const TRACK = ["woken", "talking", "agreed", "met"] as const;

const PHASE_LABEL: Record<IntroductionPhase, string> = {
  talking: "Agents talking",
  agreed: "Agents agreed",
  met: "Met",
  no_fit: "No fit",
  quiet: "Went quiet",
};

function phaseLine(p: IntroductionProgress): string {
  const A = first(p.a.name), B = first(p.b.name);
  switch (p.phase) {
    case "talking": return "Both agents are awake and talking privately.";
    case "agreed": return `The agents agreed. Now it's up to ${A} and ${B}.`;
    case "met": return `${A} and ${B} both said yes. They're connected.`;
    case "no_fit": return "It wasn't a fit. Nothing more happens.";
    case "quiet": return "It went quiet before both said yes.";
  }
}

/** How many stops of the track this introduction lit. */
function reached(p: IntroductionProgress): number {
  if (p.phase === "met") return 4;
  if (p.phase === "agreed") return 3;
  return 2; // talking, or ended while talking (no fit / quiet)
}

function ProgressPanel({ runs, activeId, setActiveId, minimized, setMinimized, onDismiss }: {
  runs: IntroductionProgress[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  onDismiss: (id: string) => void;
}) {
  const run = runs.find((r) => r.opportunityId === activeId) ?? runs[0];
  if (!run) return null;
  const live = runs.filter((r) => !isFinal(r)).length;

  if (minimized) {
    return (
      <button type="button" className="idk idk-mini" onClick={() => setMinimized(false)}>
        <span className={`idk-bot ${live ? "think" : "ok"}`} style={{ width: 14, height: 14 }} />
        {live ? `${live} INTRO${live > 1 ? "S" : ""} IN PROGRESS · OPEN` : "ALL DONE · OPEN"}
      </button>
    );
  }

  const A = first(run.a.name), B = first(run.b.name);
  const done = isFinal(run);
  const lit = reached(run);
  const ended = run.phase === "no_fit" || run.phase === "quiet";
  return (
    <div className="idk idk-panel" role="status" aria-live="polite">
      <div className="idk-tb">
        <button type="button" className="box" title="Minimize" aria-label="minimize" onClick={() => setMinimized(true)} />
        <span>{done ? "Introduction done" : "Both agents awake"}</span>
        {runs.length > 1 && <span className="r">{runs.length} RUNNING</span>}
      </div>
      {runs.length > 1 && (
        <div className="idk-tabs">
          {runs.map((r) => (
            <button key={r.opportunityId} type="button" aria-pressed={r.opportunityId === run.opportunityId} onClick={() => setActiveId(r.opportunityId)}>
              <span className={`d ${r.phase === "met" ? "f" : isFinal(r) ? "x" : ""}`} />{first(r.a.name)} ⇄ {first(r.b.name)}
            </button>
          ))}
        </div>
      )}
      <div className="idk-pbody">
        <div className="idk-big">{A} ⇄ {B}</div>
        <div className="idk-dim" style={{ fontSize: 12 }}>{PHASE_LABEL[run.phase]} · started {since(run.createdAt)} ago</div>
        <ol className="idk-track" aria-label="Introduction status">
          {TRACK.map((stop, i) => {
            const on = i < lit;
            const here = i === lit - 1;
            const cls = on ? (here && ended ? "x" : here && !done ? "cur" : "on") : "";
            return <li key={stop} className={cls}><i />{here && ended ? PHASE_LABEL[run.phase].toLowerCase() : stop}</li>;
          })}
        </ol>
        <div className="idk-wait">{phaseLine(run)}</div>
        <div className="idk-foot">
          <span>🔒 You see where it ends up, never what the agents say.</span>
          {done && <button type="button" className="idk-btn small" onClick={() => onDismiss(run.opportunityId)}>Dismiss</button>}
        </div>
      </div>
    </div>
  );
}

function PairCard({ pair, run, onWake, onSkip, onShow }: {
  pair: PairSuggestion;
  run?: IntroductionProgress;
  onWake: (pair: PairSuggestion, context: string) => Promise<void>;
  onSkip: (pair: PairSuggestion) => void;
  onShow: (id: string) => void;
}) {
  const [text, setText] = useState(pair.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const side = (s: PairSuggestion["a"]) => (
    <div className="idk-who">
      <UserAvatar id={s.userId} name={s.name} avatar={s.avatar} size={30} />
      <div style={{ minWidth: 0 }}>
        <div className="idk-line" title={s.intentText}><b>{first(s.name)}</b> {s.line}</div>
        <small>{pair.networkTitle}{s.isContact && <span className="idk-tag">your contact</span>}</small>
      </div>
    </div>
  );

  return (
    <div className={`idk-card${run && isFinal(run) ? " done" : ""}`}>
      <div className="idk-pair">{side(pair.a)}<div className="idk-link">⇄</div>{side(pair.b)}</div>
      {run ? (
        <button type="button" className="idk-woke" onClick={() => onShow(run.opportunityId)}>
          <span className={`idk-bot ${isFinal(run) ? "ok" : "think"}`} style={{ width: 14, height: 14 }} />
          {isFinal(run) ? "DONE" : "IN PROGRESS"} · {PHASE_LABEL[run.phase].toUpperCase()}
          <span style={{ marginLeft: "auto" }}>SHOW ›</span>
        </button>
      ) : (
        <>
          <label className="idk-label" htmlFor={`intro-${pair.key}`}>
            <span>YOUR INTRO · BOTH AGENTS READ THIS</span>
            <span>{text.length} / {MAX_CONTEXT}</span>
          </label>
          <textarea id={`intro-${pair.key}`} value={text} maxLength={MAX_CONTEXT} onChange={(e) => setText(e.target.value)} />
          <div className="idk-row">
            <button
              type="button"
              className="idk-btn go"
              disabled={busy || !text.trim()}
              onClick={() => {
                setBusy(true);
                setError(null);
                onWake(pair, text.trim())
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't wake the agents"))
                  .finally(() => setBusy(false));
              }}
            >{busy ? "Waking…" : "Wake both agents ▸"}</button>
            <button type="button" className="idk-btn small" disabled={busy} onClick={() => onSkip(pair)}>Skip</button>
          </div>
          {error && <div className="idk-error">{error}</div>}
        </>
      )}
    </div>
  );
}

function Setup({ status, importing, error, onConnect, onImport }: {
  status: IntroducerStatus;
  importing: boolean;
  error: string | null;
  onConnect: () => void;
  onImport: () => void;
}) {
  const googleDone = status.google.linked && status.google.contactsScope;
  const imported = status.contacts.lastImportAt !== null;
  return (
    <div className="idk-setup">
      <p><b>Introduce people you know.</b> You pick two people, write why they should meet, and wake both of their agents. The agents talk it over, and the two people meet only if both say yes.</p>
      <p className="idk-dim">Index reads your Google contacts to find which people you know are on Index, then suggests pairs whose intents fit.</p>
      <ol className="idk-steps">
        <li className={googleDone ? "done" : ""}>
          <span className="n">{googleDone ? "✓" : "1"}</span>
          <div>
            <b>Connect Google contacts</b>
            <small>{googleDone ? "Connected." : status.google.linked ? "Your Google account is linked. Allow Index to read your contacts." : "Sign in with Google and allow Index to read your contacts."}</small>
          </div>
          {!googleDone && <button type="button" className="idk-btn go" onClick={onConnect}>Connect Google ▸</button>}
        </li>
        <li className={imported ? "done" : googleDone ? "" : "todo"}>
          <span className="n">{imported ? "✓" : "2"}</span>
          <div>
            <b>Find who you know on Index</b>
            <small>{imported ? `${status.contacts.total} contacts · ${status.contacts.onIndex} on Index` : "Your saved contacts and the people you've emailed."}</small>
          </div>
          {googleDone && !imported && <button type="button" className="idk-btn go" disabled={importing} onClick={onImport}>{importing ? "Reading…" : "Read contacts ▸"}</button>}
        </li>
        <li className="todo">
          <span className="n">3</span>
          <div><b>Wake two agents</b><small>Pairs show up here once your contacts are in.</small></div>
          <span />
        </li>
      </ol>
      <div className="idk-note">Your contacts stay private to you. Nobody sees them, and nobody is contacted unless you wake their agent.</div>
      {error && <div className="idk-error">{error}</div>}
    </div>
  );
}

export default function IntroducePage() {
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const api = useAuthenticatedAPI();
  const service = useMemo(() => createIntroducerService(api), [api]);
  const plain = useInAppFrame();
  const compact = useCompact();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [status, setStatus] = useState<IntroducerStatus | null>(null);
  const [pairs, setPairs] = useState<PairSuggestion[] | null>(null);
  const [runs, setRuns] = useState<IntroductionProgress[]>([]);
  const [skips, setSkips] = useState<Set<string>>(loadSkips);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "Google didn't connect. Use the Google account with the same email as your Index account." : null);
  const autoImported = useRef(false);
  // Finished introductions stay on the panel for a week after they opened.
  const [recentCutoff] = useState(() => Date.now() - 7 * 86400_000);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await service.introductions());
    } catch (err) {
      logger.warn("introductions failed", { error: String(err) });
    }
  }, [service]);

  const load = useCallback(async () => {
    const s = await service.status();
    setStatus(s);
    if (s.contacts.lastImportAt) setPairs(await service.pairs());
    await refreshRuns();
  }, [service, refreshRuns]);

  const doImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    try {
      await service.importContacts();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [service, load]);

  useEffect(() => {
    if (!isAuthenticated) return;
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load"));
  }, [load, isAuthenticated]);

  // Back from Google with the contacts scope: import straight away, once.
  useEffect(() => {
    if (!status || autoImported.current || params.get("connected") !== "1") return;
    autoImported.current = true;
    setParams((p) => { p.delete("connected"); return p; }, { replace: true });
    if (status.google.contactsScope) void doImport();
  }, [status, params, setParams, doImport]);

  // While anything is still moving, keep the panel fresh.
  const visibleRuns = runs.filter((r) => !dismissed.has(r.opportunityId) && (!isFinal(r) || new Date(r.createdAt).getTime() > recentCutoff));
  const anyLive = visibleRuns.some((r) => !isFinal(r));
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => void refreshRuns(), POLL_MS);
    return () => clearInterval(t);
  }, [anyLive, refreshRuns]);

  const connect = () => {
    void authClient.linkSocial({
      provider: "google",
      scopes: CONTACT_SCOPES,
      callbackURL: `${window.location.origin}/introduce?connected=1`,
      errorCallbackURL: `${window.location.origin}/introduce?error=1`,
    });
  };

  const wake = async (pair: PairSuggestion, context: string) => {
    const { opportunityId } = await service.wake(pair, context);
    await refreshRuns();
    setActiveId(opportunityId);
    setMinimized(false);
  };

  const skip = (pair: PairSuggestion) => {
    const next = new Set(skips).add(pair.key);
    setSkips(next);
    localStorage.setItem(SKIPS_KEY, JSON.stringify([...next]));
  };

  // A pair you already woke stays on the desk with its progress; match by the two people.
  const runFor = (pair: PairSuggestion) => runs.find((r) =>
    (r.a.userId === pair.a.userId && r.b.userId === pair.b.userId) || (r.a.userId === pair.b.userId && r.b.userId === pair.a.userId));
  const shown = (pairs ?? []).filter((p) => !skips.has(p.key));
  const ready = !!status?.contacts.lastImportAt;

  const desk = (
    <div className="idk">
      {!status ? (
        error ? <div className="idk-error">{error}</div> : <p className="idk-dim">loading…</p>
      ) : !ready ? (
        <Setup status={status} importing={importing} error={error} onConnect={connect} onImport={() => void doImport()} />
      ) : (
        <>
          <div className="idk-bar">
            <span>{status.contacts.total} contacts · {status.contacts.onIndex} on Index</span>
            <span className="sp" />
            <span className="idk-faint" title="Index re-reads your Google contacts once a day">{importing ? "syncing…" : `synced ${since(status.contacts.lastImportAt!)} ago`}</span>
            {skips.size > 0 && <button type="button" className="idk-btn small" onClick={() => { setSkips(new Set()); localStorage.removeItem(SKIPS_KEY); }}>show skipped ({skips.size})</button>}
          </div>
          {error && <div className="idk-error" style={{ marginBottom: 10 }}>{error}</div>}
          {pairs === null ? (
            <p className="idk-dim">finding pairs…</p>
          ) : shown.length === 0 ? (
            <div className="idk-empty">
              No pairs right now. Pairs show up when people you know have public intents in networks you share
              {status.contacts.onIndex === 0 ? ". None of your contacts are on Index yet." : "."}
            </div>
          ) : (
            shown.map((pair) => (
              <PairCard key={pair.key} pair={pair} run={runFor(pair)} onWake={wake} onSkip={skip} onShow={(id) => { setActiveId(id); setMinimized(false); }} />
            ))
          )}
        </>
      )}
      <ProgressPanel
        runs={visibleRuns}
        activeId={activeId}
        setActiveId={setActiveId}
        minimized={minimized}
        setMinimized={setMinimized}
        onDismiss={(id) => setDismissed((d) => new Set(d).add(id))}
      />
    </div>
  );

  // Signed out: sign in first, then come back here.
  if (!authLoading && !isAuthenticated) return <Navigate to="/login?next=/introduce" replace />;

  const count = shown.filter((p) => !runFor(p)).length;

  if (plain) {
    return (
      <div className="ih-view pl">
        <div className="pl-col">
          <PageHead title="introduce" status={ready ? `${count} pair${count === 1 ? "" : "s"} you could introduce` : "connect your contacts to start"} />
          <div className="pl-page">{desk}</div>
        </div>
      </div>
    );
  }

  return (
    <Stage width={760} height="min(880px, calc(100vh - 96px))">
      <Window title="introduce" onClose={compact ? undefined : () => navigate("/")} style={{ height: "100%" }}>
        <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: compact ? "14px 16px 22px" : "18px 24px 22px" }}>
          {desk}
        </div>
      </Window>
    </Stage>
  );
}

export const Component = IntroducePage;
