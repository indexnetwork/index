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
import { CONTACT_SCOPES, createIntroducerService, type IntroducerStatus, type IntroductionProgress, type PairSuggestion, type ProgressStep } from "@/services/introducer";
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

const isFinal = (p: IntroductionProgress) => p.phase === "accepted" || p.phase === "declined" || p.phase === "expired";

const ACTION_WORD: Record<string, string> = { propose: "proposed", counter: "countered", accept: "accepted", decline: "declined" };

function stepText(step: ProgressStep, p: IntroductionProgress): string {
  const who = step.side === "a" ? first(p.a.name) : step.side === "b" ? first(p.b.name) : "";
  switch (step.kind) {
    case "opened": return "Opened · your intro delivered to both agents";
    case "turn": return `Turn ${step.turn} · ${who}'s agent ${ACTION_WORD[step.action ?? ""] ?? step.action}`;
    case "agreed": return "Agents agreed · sent to both people";
    case "committed": return `${who} said yes`;
    case "declined": return who ? `${who} declined` : "Declined";
    case "expired": return "Expired before both said yes";
  }
}

/** How far along an introduction is, for the bar. */
function percent(p: IntroductionProgress): number {
  if (isFinal(p)) return 100;
  const turns = p.steps.filter((s) => s.kind === "turn").length;
  if (p.phase === "agreed") return 75 + 10 * p.steps.filter((s) => s.kind === "committed").length;
  return Math.min(15 + turns * 12, 70);
}

/** The line under the agents: who everything is waiting on right now. */
function waitingOn(p: IntroductionProgress): string {
  const A = first(p.a.name), B = first(p.b.name);
  if (p.phase === "accepted") return `${A} and ${B} both said yes. Their chat is open.`;
  if (p.phase === "declined") return "This one didn't land. Nothing more happens.";
  if (p.phase === "expired") return "It expired before both said yes.";
  if (p.phase === "agreed") {
    const yes = new Set(p.steps.filter((s) => s.kind === "committed").map((s) => s.side));
    const left = [!yes.has("a") ? A : null, !yes.has("b") ? B : null].filter(Boolean).join(" and ");
    return `Waiting on ${left}: a person, not the agent.`;
  }
  if (p.awaiting) return `Waiting on ${p.awaiting === "a" ? A : B}'s agent.`;
  return "Waiting for an agent to wake.";
}

function agentState(p: IntroductionProgress, side: "a" | "b"): { cls: string; text: string; active: boolean } {
  const name = first(side === "a" ? p.a.name : p.b.name);
  const committed = p.steps.some((s) => s.kind === "committed" && s.side === side);
  if (p.phase === "accepted" || committed) return { cls: "ok", text: `${name} said yes`, active: false };
  if (p.phase === "declined" || p.phase === "expired") return { cls: "off", text: "done", active: false };
  if (p.phase === "agreed") return { cls: "", text: `handed to ${name}`, active: true };
  const moved = p.steps.some((s) => s.kind === "turn" && s.side === side);
  if (p.awaiting === side) return { cls: "think", text: moved ? "working on its turn…" : "waking · takes a turn", active: true };
  return { cls: moved ? "" : "off", text: moved ? "waiting for the other agent" : "not woken yet", active: false };
}

function phaseLabel(p: IntroductionProgress): string {
  const turns = p.steps.filter((s) => s.kind === "turn").length;
  if (p.phase === "accepted") return "Done · both said yes";
  if (p.phase === "declined") return "Declined";
  if (p.phase === "expired") return "Expired";
  if (p.phase === "agreed") return "Agents agreed";
  return turns ? `Negotiating · turn ${turns}` : "Waking";
}

function ProgressPanel({ runs, activeId, setActiveId, minimized, setMinimized, onDismiss }: {
  runs: IntroductionProgress[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  onDismiss: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const run = runs.find((r) => r.opportunityId === activeId) ?? runs[0];
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [run?.steps.length]);
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
  const pct = percent(run);
  const sa = agentState(run, "a"), sb = agentState(run, "b");
  const barClass = run.phase === "accepted" ? "f" : done ? "x" : "";
  return (
    <div className="idk idk-panel" role="status" aria-live="polite">
      <div className="idk-tb">
        <button type="button" className="box" title="Minimize" aria-label="minimize" onClick={() => setMinimized(true)} />
        <span>{done ? "Introduction done" : "Waking both agents"}</span>
        {runs.length > 1 && <span className="r">{runs.length} RUNNING</span>}
      </div>
      {runs.length > 1 && (
        <div className="idk-tabs">
          {runs.map((r) => (
            <button key={r.opportunityId} type="button" aria-pressed={r.opportunityId === run.opportunityId} onClick={() => setActiveId(r.opportunityId)}>
              <span className={`d ${r.phase === "accepted" ? "f" : isFinal(r) ? "x" : ""}`} />{first(r.a.name)} ⇄ {first(r.b.name)}
            </button>
          ))}
        </div>
      )}
      <div className="idk-pbody">
        <div className="idk-big">{A} ⇄ {B}</div>
        <div className="idk-dim" style={{ fontSize: 12 }}>{phaseLabel(run)}</div>
        <div className={`idk-pb ${barClass}`}><i style={{ width: `${pct}%` }} /></div>
        <div className="idk-pbl"><span>{run.steps.length} STEPS · STARTED {since(run.createdAt).toUpperCase()} AGO</span><span>{pct}%</span></div>
        <div className="idk-agents">
          {([["a", run.a, sa], ["b", run.b, sb]] as const).map(([k, person, s]) => (
            <div key={k} className={`idk-ag${s.active ? " act" : ""}`}>
              <span className={`idk-bot ${s.cls}`} />
              <div><b>{first(person.name)}&apos;s agent</b><small>{s.text}</small></div>
            </div>
          ))}
        </div>
        <div className="idk-wait">{waitingOn(run)}</div>
        <div className="idk-list" ref={listRef}>
          {run.steps.map((s, i) => (
            <div key={`${s.kind}-${s.at}-${i}`} className={`idk-st${i === run.steps.length - 1 && !done ? " cur" : ""}`}>
              <span className="ic">✓</span>
              <span>{stepText(s, run)}{s.kind === "turn" && <span className="idk-faint"> 🔒</span>}</span>
              <span className="t">{since(s.at)}</span>
            </div>
          ))}
          {!done && (
            <div className="idk-st todo"><span className="ic">…</span><span>{run.phase === "agreed" ? "Both people decide" : "Next turn"}</span><span className="t" /></div>
          )}
        </div>
        <div className="idk-foot">
          <span>🔒 What the agents say stays between {A} and {B}.</span>
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
  const A = first(pair.a.name), B = first(pair.b.name);

  const side = (s: PairSuggestion["a"]) => (
    <div className="idk-who">
      <UserAvatar id={s.userId} name={s.name} avatar={s.avatar} size={30} />
      <div style={{ minWidth: 0 }}>
        <b title={s.name}>{s.name}</b>
        <small>{pair.networkTitle}{s.isContact && <span className="idk-tag">your contact</span>}</small>
      </div>
    </div>
  );

  return (
    <div className={`idk-card${run && isFinal(run) ? " done" : ""}`}>
      <div className="idk-pair">{side(pair.a)}<div className="idk-link">⇄</div>{side(pair.b)}</div>
      <div className="idk-ask">
        <div><b>{A}</b> wants: {pair.a.intentText}</div>
        <div><b>{B}</b> wants: {pair.b.intentText}</div>
      </div>
      {run ? (
        <button type="button" className="idk-woke" onClick={() => onShow(run.opportunityId)}>
          <span className={`idk-bot ${isFinal(run) ? "ok" : "think"}`} style={{ width: 14, height: 14 }} />
          {isFinal(run) ? "DONE" : "IN PROGRESS"} · {phaseLabel(run).toUpperCase()}
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
          {googleDone && !imported && <button type="button" className="idk-btn go" disabled={importing} onClick={onImport}>{importing ? "Importing…" : "Import ▸"}</button>}
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
            <button type="button" className="idk-btn small" disabled={importing} onClick={() => void doImport()}>{importing ? "importing…" : "re-import"}</button>
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
