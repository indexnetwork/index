import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import PageHead from "@/components/intents-home/PageHead";
import { SplitView, Seg, ListHead } from "@/components/intents-home/SplitView";
import { useUndo } from "@/components/intents-home/undo";
import { useInAppFrame } from "@/components/intents-home/appFrameContext";
import { Stage, Window } from "@/components/workbench/Workbench";
import UserAvatar from "@/components/UserAvatar";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCompact } from "@/hooks/useCompact";
import { authClient } from "@/lib/auth-client";
import { useAuthenticatedAPI } from "@/lib/api";
import { log } from "@/lib/logger";
import { CONTACT_SCOPES, createIntroducerService, type ContactEntry, type ContactFilter, type IntroducerStatus, type IntroductionPhase, type IntroductionProgress, type OpportunityProposal } from "@/services/introducer";
import "@/styles/plain.css";
import "@/styles/introduce.css";

const logger = log.page.from("introduce");

const POLL_MS = 5000;
const MAX_CONTEXT = 2000;

type Service = ReturnType<typeof createIntroducerService>;

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

function since(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const isFinal = (p: IntroductionProgress) => p.phase === "met" || p.phase === "no_fit" || p.phase === "quiet";

/** Each phase as a word and a status square, as on home. */
const PHASE: Record<IntroductionPhase, { label: string; cls: string }> = {
  talking: { label: "talking", cls: "talks" },
  agreed: { label: "agreed", cls: "waiting" },
  met: { label: "met", cls: "live" },
  no_fit: { label: "no fit", cls: "paused" },
  quiet: { label: "went quiet", cls: "paused" },
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

/** Introductions you opened, one row each: who, where it is, when it started. Never how. */
function Running({ runs, opening, freshId }: { runs: IntroductionProgress[]; opening: OpportunityProposal[]; freshId: string | null }) {
  // Live ones first, then finished, newest first within each.
  const ordered = [...runs.filter((r) => !isFinal(r)), ...runs.filter(isFinal)];
  return (
    <aside className="idk-col idk-running" aria-live="polite">
      <h2 className="idk-h2">running <span className="n">{opening.length + runs.filter((r) => !isFinal(r)).length || ""}</span></h2>
      {ordered.length + opening.length === 0 ? (
        <div className="idk-run-empty">Nothing running. Wake a pair and it shows up here.</div>
      ) : (
        <ul className="idk-rows">
          {opening.map((p) => (
            <li key={p.id} title={`Looking ${first(p.contact.name)} up and seating their agent. This takes a minute or two.`}>
              <span className="p">{first(p.member.name)} ⇄ {first(p.contact.name)}</span>
              <span className="pl-status pending">waking</span>
              <span className="t">now</span>
            </li>
          ))}
          {ordered.map((r) => (
            <li key={r.opportunityId} className={`${isFinal(r) ? "done" : ""}${r.opportunityId === freshId ? " fresh" : ""}`} title={phaseLine(r)}>
              <span className="p">{first(r.a.name)} ⇄ {first(r.b.name)}</span>
              <span className={`pl-status ${PHASE[r.phase].cls}`}>{PHASE[r.phase].label}</span>
              <span className="t">{since(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="idk-run-foot">🔒 You see where each ends up, never what the agents say.</div>
    </aside>
  );
}

function ProposalCard({ proposal, onOpen, onSkip }: {
  proposal: OpportunityProposal;
  onOpen: (p: OpportunityProposal, context: string) => Promise<void>;
  onSkip: (p: OpportunityProposal) => void;
}) {
  const [text, setText] = useState(proposal.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opening = proposal.status === "opening";

  return (
    <div className={`idk-card${opening ? " opening" : ""}`}>
      <div className="idk-pair">
        <div className="idk-who">
          <UserAvatar id={proposal.member.userId} name={proposal.member.name} avatar={proposal.member.avatar} size={30} />
          <div style={{ minWidth: 0 }}>
            <div className="idk-line" title={proposal.member.intentText}><b>{first(proposal.member.name)}</b> {proposal.member.line}</div>
            <small>{proposal.networkTitle}</small>
          </div>
        </div>
        <div className="idk-link">⇄</div>
        <div className="idk-who">
          <span className="idk-ghost" aria-hidden>{first(proposal.contact.name).slice(0, 1).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div className="idk-line" title={proposal.contact.detail ?? undefined}><b>{first(proposal.contact.name)}</b> {proposal.contact.line}</div>
            <small>your contact<span className="idk-tag dash">not on Index</span></small>
          </div>
        </div>
      </div>
      {opening ? (
        <div className="idk-woke" role="status">
          <span className="idk-bot think" style={{ width: 14, height: 14 }} />
          WAKING · SEE RUNNING
        </div>
      ) : (
        <>
          <label className="idk-label" htmlFor={`intro-${proposal.id}`}>
            <span>YOUR INTRO</span>
            <span>{text.length} / {MAX_CONTEXT}</span>
          </label>
          <textarea id={`intro-${proposal.id}`} value={text} maxLength={MAX_CONTEXT} onChange={(e) => setText(e.target.value)} />
          <div className="idk-row">
            <button
              type="button"
              className="idk-btn go"
              disabled={busy || !text.trim()}
              onClick={() => {
                setBusy(true);
                setError(null);
                onOpen(proposal, text.trim())
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't wake the agents"))
                  .finally(() => setBusy(false));
              }}
            >{busy ? "Waking…" : proposal.status === "failed" ? "Try again ▸" : "Wake both agents ▸"}</button>
            <button type="button" className="idk-btn small" disabled={busy} onClick={() => onSkip(proposal)}>Skip</button>
          </div>
          {(error ?? proposal.failure) && <div className="idk-error">{error ?? proposal.failure}</div>}
        </>
      )}
    </div>
  );
}

/** The member's photo with your contact's letter beside it, in a dashed circle: they're not on Index. */
function PairFace({ proposal, size = 36 }: { proposal: OpportunityProposal; size?: number }) {
  return (
    <div className="sv-pairav" style={{ width: Math.round(size * 1.7), height: size }}>
      <UserAvatar id={proposal.member.userId} name={proposal.member.name} avatar={proposal.member.avatar} size={size} />
      <span className="sv-ghost" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden>{first(proposal.contact.name).slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

const lc = (text: string) => text ? text[0].toLowerCase() + text.slice(1).replace(/\.$/, "") : text;

/** A pair in the list, drawn like home's waiting cards: who ⇄ who, one line, wake or skip. The intro is in its detail. */
function PairCard({ proposal, on, onPick, onWake, onSkip }: {
  proposal: OpportunityProposal;
  on: boolean;
  onPick: () => void;
  onWake: () => void;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const wake = (event: MouseEvent) => {
    event.stopPropagation();
    setBusy(true);
    Promise.resolve(onWake()).finally(() => setBusy(false));
  };
  return (
    <div className={`sv-card${on ? " on" : ""}`} data-sv-item={proposal.id} onClick={onPick}>
      <PairFace proposal={proposal} />
      <div className="sv-card-body">
        <b>{first(proposal.member.name)} ⇄ {first(proposal.contact.name)}</b>
        <div className="sv-blurb">{lc(proposal.member.line)} ⇄ {proposal.contact.line}</div>
        <div className="sv-actions">
          <button type="button" className="sv-btn go" data-sv-key="accept" disabled={busy} onClick={wake}>
            {busy ? "waking" : proposal.status === "failed" ? "try again" : "wake both agents"}
          </button>
          <button type="button" className="sv-btn" data-sv-key="pass" disabled={busy} onClick={(event) => { event.stopPropagation(); onSkip(); }}>skip</button>
        </div>
        {proposal.failure && <div className="idk-error">{proposal.failure}</div>}
      </div>
    </div>
  );
}

/** A picked pair, on the right: who's who and the intro you'll send. No buttons: you wake it from the list. */
function PairPane({ proposal, text, error, onText, onClose }: {
  proposal: OpportunityProposal;
  text: string;
  error: string | null;
  onText: (text: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="sv-person">
      <header className="sv-ph">
        <div className="sv-pid">
          <PairFace proposal={proposal} size={48} />
          <div className="who">
            <div className="sv-pn">{first(proposal.member.name)} ⇄ {first(proposal.contact.name)}</div>
            <div className="sv-pu">via {proposal.networkTitle}<span className="loc"> · {first(proposal.contact.name)} isn&apos;t on Index</span></div>
          </div>
        </div>
        <button type="button" className="sv-x" aria-label="close" onClick={onClose}>×</button>
      </header>
      <div className="sv-body idk sv-idk">
        <div className="idk-pair">
          <div className="idk-who">
            <UserAvatar id={proposal.member.userId} name={proposal.member.name} avatar={proposal.member.avatar} size={30} />
            <div style={{ minWidth: 0 }}>
              <div className="idk-line" title={proposal.member.intentText}><b>{first(proposal.member.name)}</b> {proposal.member.line}</div>
              <small>{proposal.networkTitle}</small>
            </div>
          </div>
          <div className="idk-link">⇄</div>
          <div className="idk-who">
            <span className="idk-ghost" aria-hidden>{first(proposal.contact.name).slice(0, 1).toUpperCase()}</span>
            <div style={{ minWidth: 0 }}>
              <div className="idk-line" title={proposal.contact.detail ?? undefined}><b>{first(proposal.contact.name)}</b> {proposal.contact.line}</div>
              <small>your contact<span className="idk-tag dash">not on Index</span></small>
            </div>
          </div>
        </div>
        <label className="idk-label" htmlFor={`intro-${proposal.id}`}>
          <span>YOUR INTRO</span>
          <span>{text.length} / {MAX_CONTEXT}</span>
        </label>
        <textarea id={`intro-${proposal.id}`} className="sv-idk-text" value={text} maxLength={MAX_CONTEXT} onChange={(e) => onText(e.target.value)} />
        <div className="sv-idk-hint">edits stay as you type; wake it from the list.</div>
        {error && <div className="idk-error">{error}</div>}
      </div>
    </div>
  );
}

const STEPS = ["woken", "talking", "agreed", "met"] as const;

/** Where one introduction stands: woken → talking → agreed → met, or where it ended. */
function RunSteps({ phase }: { phase: IntroductionPhase | "woken" }) {
  const ended = phase === "no_fit" || phase === "quiet";
  const at = ended ? 1 : STEPS.indexOf(phase as (typeof STEPS)[number]);
  const shown = ended ? STEPS.slice(0, 2) : STEPS;
  return (
    <div className="sv-rsteps">
      {shown.map((step, i) => (
        <span key={step} className="sv-rstep-wrap">
          {i > 0 && <span className="sep">→</span>}
          <span className={`st${i < at ? " done" : i === at ? (ended ? " end" : " now") : ""}`}>{i === at && ended ? PHASE[phase as IntroductionPhase].label : step}</span>
        </span>
      ))}
    </div>
  );
}

/** The right side when no pair is picked: the introductions you woke, where each stands. A click opens one in place. */
function RunningPane({ runs, opening, freshId }: { runs: IntroductionProgress[]; opening: OpportunityProposal[]; freshId: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const live = runs.filter((r) => !isFinal(r));
  const ended = runs.filter(isFinal);
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));
  return (
    <div className="sv-person">
      <header className="sv-ph">
        <div className="sv-pid">
          <div className="who">
            <div className="sv-pn">running</div>
            <div className="sv-pu">{opening.length + live.length} going<span className="loc"> · {ended.length} ended</span></div>
          </div>
        </div>
      </header>
      <div className="sv-body idk sv-idk" aria-live="polite">
        {opening.length + runs.length === 0 ? (
          <div className="idk-run-empty">Nothing running. Wake a pair and it shows up here.</div>
        ) : (
          <ul className="idk-rows sv-runs">
            {opening.map((p) => (
              <li key={p.id} className={openId === p.id ? "on" : ""}>
                <button type="button" className="sv-run" aria-expanded={openId === p.id} onClick={() => toggle(p.id)}>
                  <span className="p">{first(p.member.name)} ⇄ {first(p.contact.name)}</span>
                  <span className="pl-status pending">waking</span>
                  <span className="t">now</span>
                  <span className="chev" aria-hidden>{openId === p.id ? "▾" : "›"}</span>
                </button>
                {openId === p.id && (
                  <div className="sv-rdet">
                    <RunSteps phase="woken" />
                    <div className="sv-dim-note">Looking {first(p.contact.name)} up and seating their agent. This takes a minute or two.</div>
                  </div>
                )}
              </li>
            ))}
            {[...live, ...ended].map((r) => (
              <li key={r.opportunityId} className={`${isFinal(r) ? "done" : ""}${r.opportunityId === freshId ? " fresh" : ""}${openId === r.opportunityId ? " on" : ""}`}>
                <button type="button" className="sv-run" aria-expanded={openId === r.opportunityId} onClick={() => toggle(r.opportunityId)} title={phaseLine(r)}>
                  <span className="p">{first(r.a.name)} ⇄ {first(r.b.name)}</span>
                  <span className={`pl-status ${PHASE[r.phase].cls}`}>{PHASE[r.phase].label}</span>
                  <span className="t">{since(r.createdAt)}</span>
                  <span className="chev" aria-hidden>{openId === r.opportunityId ? "▾" : "›"}</span>
                </button>
                {openId === r.opportunityId && (
                  <div className="sv-rdet">
                    <RunSteps phase={r.phase} />
                    <div className="sv-dim-note">{phaseLine(r)}</div>
                    {r.context && (
                      <>
                        <div className="idk-label"><span>THE INTRO YOU SENT</span></div>
                        <div className="sv-idk-sent">{r.context}</div>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="idk-run-foot">🔒 You see where each ends up, never what the agents say. Click one to see where it stands.</div>
      </div>
    </div>
  );
}

const FILTERS: { key: ContactFilter; label: string }[] = [
  { key: "all", label: "all" },
  { key: "not_on_index", label: "not on Index" },
  { key: "on_index", label: "on Index" },
  { key: "excluded", label: "never suggest" },
];

/** Your imported contacts: search, see who's on Index, and say who never to suggest. */
function Contacts({ service, status, onDeleted }: { service: Service; status: IntroducerStatus; onDeleted: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [rows, setRows] = useState<ContactEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (offset: number) => {
    try {
      const res = await service.contacts(q, filter, offset);
      setTotal(res.total);
      setRows((prev) => (offset === 0 ? res.contacts : [...(prev ?? []), ...res.contacts]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load contacts");
    }
  }, [service, q, filter]);

  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const toggle = async (c: ContactEntry) => {
    const excluded = !c.excluded;
    setRows((all) => all?.map((r) => (r.id === c.id ? { ...r, excluded, proposals: excluded ? 0 : r.proposals } : r)) ?? all);
    try {
      await service.setExcluded(c.id, excluded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
      void load(0);
    }
  };

  const deleteAll = async () => {
    if (!window.confirm(`Delete all ${status.contacts.total} contacts from Index? Pairs made from them go too. Introductions you already opened stay. You can read your contacts again later.`)) return;
    setDeleting(true);
    try {
      await service.deleteContacts();
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete");
      setDeleting(false);
    }
  };

  return (
    <div className="idk-contacts">
      <div className="idk-contacts-tools">
        <input type="search" placeholder="Search name, company, email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" />
        <div className="idk-chips" role="tablist" aria-label="Filter contacts">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>
      {error && <div className="idk-error">{error}</div>}
      {rows === null ? (
        <p className="idk-dim">loading contacts…</p>
      ) : rows.length === 0 ? (
        <div className="idk-empty">{q ? "No contact matches that." : filter === "excluded" ? "Nobody is on your never-suggest list." : "No contacts here."}</div>
      ) : (
        <>
          <div className="idk-faint" style={{ fontSize: 11, margin: "0 0 6px" }}>{total} {total === 1 ? "contact" : "contacts"}</div>
          <ul className="idk-clist">
            {rows.map((c) => (
              <li key={c.id} className={c.excluded ? "excluded" : ""}>
                <span className="idk-ghost" aria-hidden>{c.name.slice(0, 1).toUpperCase()}</span>
                <div className="who" title={c.source === "saved" ? "Saved in your Google contacts" : "Someone you've emailed (Google's \"Other contacts\")"}>
                  <b>{c.name}</b>
                  <small>{c.detail ?? c.email}</small>
                  {c.detail && <small className="idk-faint">{c.email}</small>}
                </div>
                <div className="tags">
                  {c.onIndex && <span className="idk-tag">on Index</span>}
                  {c.proposals > 0 && <span className="idk-faint">{c.proposals} pair{c.proposals === 1 ? "" : "s"} waiting</span>}
                </div>
                {!c.onIndex && (
                  <button type="button" className="idk-btn small" onClick={() => void toggle(c)} aria-pressed={c.excluded}>
                    {c.excluded ? "allow" : "never suggest"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {rows.length < total && (
            <button type="button" className="idk-btn small" style={{ marginTop: 10 }} onClick={() => void load(rows.length)}>show more</button>
          )}
        </>
      )}
      <div className="idk-contacts-foot">
        <span>Synced from Google {status.contacts.lastImportAt ? `${since(status.contacts.lastImportAt)} ago` : "never"}. Only you see this list.</span>
        <button type="button" className="idk-btn small danger" disabled={deleting} onClick={() => void deleteAll()}>{deleting ? "deleting…" : "Delete all contacts"}</button>
      </div>
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
  const view = params.get("view") === "contacts" ? "contacts" : "pairs";

  const [status, setStatus] = useState<IntroducerStatus | null>(null);
  const [proposals, setProposals] = useState<OpportunityProposal[] | null>(null);
  const [runs, setRuns] = useState<IntroductionProgress[]>([]);
  const [importing, setImporting] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(params.get("error") ? "Google didn't connect. Use the Google account with the same email as your Index account." : null);
  const autoImported = useRef(false);
  // Proposals opened from this page; when one's agents are up, it lights up in the running column.
  const openingHere = useRef(new Set<string>());
  // On a desktop: the pair open on the right, intros edited there, and skips waiting behind "undo".
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [wakeErrors, setWakeErrors] = useState<Record<string, string>>({});
  const [skipping, setSkipping] = useState<Set<string>>(() => new Set());
  const later = useUndo();

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await service.introductions());
    } catch (err) {
      logger.warn("introductions failed", { error: String(err) });
    }
  }, [service]);

  const refreshProposals = useCallback(async () => {
    try {
      const next = await service.proposals();
      setProposals(next);
      for (const id of [...openingHere.current]) {
        if (next.some((p) => p.id === id && p.status === "opening")) continue;
        openingHere.current.delete(id);
        const runsNow = await service.introductions();
        setRuns(runsNow);
        setFreshId(runsNow[0]?.opportunityId ?? null);
      }
    } catch (err) {
      logger.warn("proposals failed", { error: String(err) });
    }
  }, [service]);

  const load = useCallback(async () => {
    const s = await service.status();
    setStatus(s);
    if (s.contacts.lastImportAt) setProposals(await service.proposals());
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

  // Back from Google with the contacts scope: read contacts straight away, once.
  useEffect(() => {
    if (!status || autoImported.current || params.get("connected") !== "1") return;
    autoImported.current = true;
    setParams((p) => { p.delete("connected"); return p; }, { replace: true });
    if (status.google.contactsScope) void doImport();
  }, [status, params, setParams, doImport]);

  // Keep the page fresh while anything is moving: proposals being opened, agents talking.
  const opening = (proposals ?? []).filter((p) => p.status === "opening");
  const anyLive = opening.length > 0 || runs.some((r) => !isFinal(r));
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => {
      if (opening.length) void refreshProposals();
      void refreshRuns();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [anyLive, opening.length, refreshProposals, refreshRuns]);

  const connect = () => {
    void authClient.linkSocial({
      provider: "google",
      scopes: CONTACT_SCOPES,
      callbackURL: `${window.location.origin}/introduce?connected=1`,
      errorCallbackURL: `${window.location.origin}/introduce?error=1`,
    });
  };

  const open = async (proposal: OpportunityProposal, context: string) => {
    await service.open(proposal.id, context);
    openingHere.current.add(proposal.id);
    setProposals((all) => all?.map((p) => (p.id === proposal.id ? { ...p, status: "opening", failure: null } : p)) ?? all);
  };

  const skip = (proposal: OpportunityProposal) => {
    setProposals((all) => all?.filter((p) => p.id !== proposal.id) ?? all);
    service.skip(proposal.id).catch((err: unknown) => logger.warn("skip failed", { error: String(err) }));
  };

  const setView = (next: "pairs" | "contacts") => setParams((p) => {
    if (next === "contacts") p.set("view", "contacts");
    else p.delete("view");
    return p;
  }, { replace: true });

  const waiting = (proposals ?? []).filter((p) => p.status !== "opening");
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
            <div className="idk-views" role="tablist" aria-label="Introduce">
              <button type="button" role="tab" aria-selected={view === "pairs"} onClick={() => setView("pairs")}>pairs ({waiting.length})</button>
              <button type="button" role="tab" aria-selected={view === "contacts"} onClick={() => setView("contacts")}>contacts ({status.contacts.total})</button>
            </div>
            <span className="sp" />
            <span className="idk-faint" title="Index re-reads your Google contacts once a day">{importing ? "syncing…" : `synced ${since(status.contacts.lastImportAt!)} ago`}</span>
          </div>
          {error && <div className="idk-error" style={{ marginBottom: 10 }}>{error}</div>}
          {view === "contacts" ? (
            <Contacts
              service={service}
              status={status}
              onDeleted={() => { setView("pairs"); setProposals(null); void load(); }}
            />
          ) : (
            <div className="idk-cols">
              <section className="idk-col">
                <h2 className="idk-h2">pairs you could introduce <span className="n">{waiting.length || ""}</span></h2>
                {proposals === null ? (
                  <p className="idk-dim">loading pairs…</p>
                ) : waiting.length === 0 ? (
                  <div className="idk-empty">
                    No pairs yet. Index matches your contacts in the background, against what people in your networks post. New pairs show up here as they come in.
                  </div>
                ) : (
                  waiting.map((p) => <ProposalCard key={p.id} proposal={p} onOpen={open} onSkip={skip} />)
                )}
              </section>
              <Running runs={runs} opening={opening} freshId={freshId} />
            </div>
          )}
        </>
      )}
    </div>
  );

  // Signed out: sign in first, then come back here.
  if (!authLoading && !isAuthenticated) return <Navigate to="/login?next=/introduce" replace />;

  const count = waiting.length;
  const headStatus = !ready ? "connect your contacts to start"
    : view === "contacts" ? `${status?.contacts.total ?? 0} contacts, private to you`
      : `${count} pair${count === 1 ? "" : "s"} you could introduce`;

  // A desktop inside the app: pairs on the left; on the right the pair you picked, or what's running.
  if (plain && !compact) {
    const shown = waiting.filter((p) => !skipping.has(p.id));
    const picked = shown.find((p) => p.id === pickedId) ?? null;
    const liveRuns = opening.length + runs.filter((r) => !isFinal(r)).length;
    const textOf = (p: OpportunityProposal) => drafts[p.id] ?? p.draft;
    const wake = async (p: OpportunityProposal) => {
      const text = textOf(p).trim();
      if (!text) { setPickedId(p.id); setWakeErrors((e) => ({ ...e, [p.id]: "Write a line for both of them first." })); return; }
      setWakeErrors((e) => { const next = { ...e }; delete next[p.id]; return next; });
      try {
        await open(p, text);
        if (pickedId === p.id) setPickedId(null);
      } catch (err) {
        setPickedId(p.id);
        setWakeErrors((e) => ({ ...e, [p.id]: err instanceof Error ? err.message : "Couldn't wake the agents" }));
      }
    };
    const skipLater = (p: OpportunityProposal) => {
      setSkipping((all) => new Set(all).add(p.id));
      if (pickedId === p.id) setPickedId(null);
      later(`skipped ${first(p.member.name)} ⇄ ${first(p.contact.name)}`, () => skip(p), () => {
        setSkipping((all) => { const next = new Set(all); next.delete(p.id); return next; });
      });
    };
    const synced = status?.contacts.lastImportAt
      ? <span className="sv-faint" title="Index re-reads your Google contacts once a day">{importing ? "syncing…" : `synced ${since(status.contacts.lastImportAt)} ago`}</span>
      : undefined;
    const list = !status ? (
      <div className="sv-empty">{error ?? "loading…"}</div>
    ) : !ready ? (
      <div className="sv-empty">connect your contacts to start. Index pairs them with people in your networks.</div>
    ) : proposals === null ? (
      <div className="sv-empty">loading pairs…</div>
    ) : (
      <>
        {error && <div className="sv-empty idk-error">{error}</div>}
        <ListHead id="pairs">pairs you could introduce · {shown.length}</ListHead>
        {shown.length === 0 ? (
          <div className="sv-empty">No pairs yet. Index matches your contacts in the background, against what people in your networks post. New pairs show up here as they come in.</div>
        ) : shown.map((p) => (
          <PairCard key={p.id} proposal={p} on={picked?.id === p.id}
            onPick={() => { setPickedId(picked?.id === p.id ? null : p.id); if (view === "contacts") setView("pairs"); }}
            onWake={() => wake(p)}
            onSkip={() => skipLater(p)} />
        ))}
      </>
    );
    const pane = !status ? null
      : !ready ? <div className="sv-body idk sv-idk"><Setup status={status} importing={importing} error={error} onConnect={connect} onImport={() => void doImport()} /></div>
      : view === "contacts" ? (
        <div className="sv-person">
          <header className="sv-ph"><div className="sv-pid"><div className="who"><div className="sv-pn">contacts</div><div className="sv-pu">{status.contacts.total} contacts, private to you<span className="loc"> · {status.contacts.onIndex} on Index</span></div></div></div>
            <button type="button" className="sv-x" aria-label="close" onClick={() => setView("pairs")}>×</button>
          </header>
          <div className="sv-body idk sv-idk">
            <Contacts service={service} status={status} onDeleted={() => { setView("pairs"); setProposals(null); void load(); }} />
          </div>
        </div>
      )
      : picked ? <PairPane key={picked.id} proposal={picked} text={textOf(picked)} error={wakeErrors[picked.id] ?? null} onText={(text) => setDrafts((d) => ({ ...d, [picked.id]: text }))} onClose={() => setPickedId(null)} />
      : <RunningPane runs={runs} opening={opening} freshId={freshId} />;
    return (
      <SplitView
        title="introduce"
        actions={synced}
        seg={ready ? <Seg items={[
          { label: "pairs", n: shown.length, on: view === "pairs" && !!picked, onClick: () => { setView("pairs"); if (!picked && shown[0]) setPickedId(shown[0].id); } },
          { label: "running", n: liveRuns, on: view === "pairs" && !picked, onClick: () => { setView("pairs"); setPickedId(null); } },
          { label: "contacts", n: status?.contacts.total ?? 0, on: view === "contacts", onClick: () => setView(view === "contacts" ? "pairs" : "contacts") },
        ]} /> : undefined}
        list={list}
        pane={pane}
      />
    );
  }

  if (plain) {
    return (
      <div className="ih-view pl">
        <div className="pl-col">
          <PageHead title="introduce" status={headStatus} />
          <div className="pl-page">{desk}</div>
        </div>
      </div>
    );
  }

  return (
    <Stage width={1040} height="min(880px, calc(100vh - 96px))">
      <Window title="introduce" onClose={compact ? undefined : () => navigate("/")} style={{ height: "100%" }}>
        <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: compact ? "14px 16px 22px" : "18px 24px 22px" }}>
          {desk}
        </div>
      </Window>
    </Stage>
  );
}

export const Component = IntroducePage;
