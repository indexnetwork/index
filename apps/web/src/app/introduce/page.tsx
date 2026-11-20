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

const POLL_MS = 5000;
const MAX_CONTEXT = 2000;

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

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
  const waking = pair.status === "waking" || (pair.status === "woken" && !run);

  return (
    <div className={`idk-card${run && isFinal(run) ? " done" : ""}`}>
      <div className="idk-pair">
        <div className="idk-who">
          <UserAvatar id={pair.member.userId} name={pair.member.name} avatar={pair.member.avatar} size={30} />
          <div style={{ minWidth: 0 }}>
            <div className="idk-line" title={pair.member.intentText}><b>{first(pair.member.name)}</b> {pair.member.line}</div>
            <small>{pair.networkTitle}</small>
          </div>
        </div>
        <div className="idk-link">⇄</div>
        <div className="idk-who">
          <span className="idk-ghost" aria-hidden>{first(pair.contact.name).slice(0, 1).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div className="idk-line" title={pair.contact.detail ?? undefined}><b>{first(pair.contact.name)}</b> {pair.contact.line}</div>
            <small>your contact<span className="idk-tag dash">not on Index</span></small>
          </div>
        </div>
      </div>
      {run ? (
        <button type="button" className="idk-woke" onClick={() => onShow(run.opportunityId)}>
          <span className={`idk-bot ${isFinal(run) ? "ok" : "think"}`} style={{ width: 14, height: 14 }} />
          {isFinal(run) ? "DONE" : "IN PROGRESS"} · {PHASE_LABEL[run.phase].toUpperCase()}
          <span style={{ marginLeft: "auto" }}>SHOW ›</span>
        </button>
      ) : waking ? (
        <div className="idk-woke" role="status">
          <span className="idk-bot think" style={{ width: 14, height: 14 }} />
          WAKING · LOOKING UP {first(pair.contact.name).toUpperCase()} AND SEATING THEIR AGENT
        </div>
      ) : (
        <>
          <label className="idk-label" htmlFor={`intro-${pair.id}`}>
            <span>YOUR INTRO · BOTH AGENTS READ THIS</span>
            <span>{text.length} / {MAX_CONTEXT}</span>
          </label>
          <textarea id={`intro-${pair.id}`} value={text} maxLength={MAX_CONTEXT} onChange={(e) => setText(e.target.value)} />
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
            >{busy ? "Waking…" : pair.status === "failed" ? "Try again ▸" : "Wake both agents ▸"}</button>
            <button type="button" className="idk-btn small" disabled={busy} onClick={() => onSkip(pair)}>Skip</button>
          </div>
          {(error ?? pair.failure) && <div className="idk-error">{error ?? pair.failure}</div>}
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
      <p><b>Introduce people you know to people on Index.</b> When someone in your networks wants something one of your contacts could help with, you see the pair here. You write why they should meet and wake both agents. They meet only if both say yes.</p>
      <p className="idk-dim">Your contacts are reached only through you: never through a network, and never passed on.</p>
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
            <b>Read your contacts</b>
            <small>{imported ? `${status.contacts.total} contacts · ${status.contacts.total - status.contacts.onIndex} not on Index` : "Your saved contacts and the people you've emailed."}</small>
          </div>
          {googleDone && !imported && <button type="button" className="idk-btn go" disabled={importing} onClick={onImport}>{importing ? "Reading…" : "Read contacts ▸"}</button>}
        </li>
        <li className="todo">
          <span className="n">3</span>
          <div><b>Wake two agents</b><small>Pairs appear as people in your networks post what they want.</small></div>
          <span />
        </li>
      </ol>
      <div className="idk-note">Your contacts stay private to you. Nobody else sees them. A contact hears from Index only after you wake the pair and the other person says yes, and then the email comes from you.</div>
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

  // Pairs you woke from this page; when one's agents are up, its progress opens.
  const wakingHere = useRef(new Set<string>());
  const refreshPairs = useCallback(async () => {
    try {
      const next = await service.pairs();
      setPairs(next);
      const woke = next.find((p) => wakingHere.current.has(p.id) && p.status !== "waking");
      if (woke) {
        wakingHere.current.delete(woke.id);
        if (woke.opportunityId) {
          setActiveId(woke.opportunityId);
          setMinimized(false);
        }
      }
    } catch (err) {
      logger.warn("pairs failed", { error: String(err) });
    }
  }, [service]);

  const wake = async (pair: PairSuggestion, context: string) => {
    await service.wake(pair.id, context);
    wakingHere.current.add(pair.id);
    setPairs((all) => all?.map((p) => (p.id === pair.id ? { ...p, status: "waking", failure: null } : p)) ?? all);
  };

  const skip = (pair: PairSuggestion) => {
    setPairs((all) => all?.filter((p) => p.id !== pair.id) ?? all);
    service.skip(pair.id).catch((err: unknown) => logger.warn("skip failed", { error: String(err) }));
  };

  // A woken pair stays on the desk with its progress.
  const runFor = (pair: PairSuggestion) => (pair.opportunityId ? runs.find((r) => r.opportunityId === pair.opportunityId) : undefined);
  const shown = pairs ?? [];

  // Seating a contact takes up to a few minutes: watch it, then open its progress.
  const wakingIds = shown.filter((p) => p.status === "waking").map((p) => p.id).join(",");
  useEffect(() => {
    if (!wakingIds) return;
    const t = setInterval(() => void refreshPairs().then(refreshRuns), POLL_MS);
    return () => clearInterval(t);
  }, [wakingIds, refreshPairs, refreshRuns]);
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
            <span>{status.contacts.total} contacts · {status.contacts.total - status.contacts.onIndex} not on Index</span>
            <span className="sp" />
            <span className="idk-faint" title="Index re-reads your Google contacts once a day">{importing ? "syncing…" : `synced ${since(status.contacts.lastImportAt!)} ago`}</span>
          </div>
          {error && <div className="idk-error" style={{ marginBottom: 10 }}>{error}</div>}
          {pairs === null ? (
            <p className="idk-dim">loading pairs…</p>
          ) : shown.length === 0 ? (
            <div className="idk-empty">
              No pairs yet. Index matches your contacts in the background, against what people in your networks post. New pairs show up here as they come in.
            </div>
          ) : (
            shown.map((pair) => (
              <PairCard key={pair.id} pair={pair} run={runFor(pair)} onWake={wake} onSkip={skip} onShow={(id) => { setActiveId(id); setMinimized(false); }} />
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

  const count = shown.filter((p) => p.status === "open" || p.status === "failed").length;

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
