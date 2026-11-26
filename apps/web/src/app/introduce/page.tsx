import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router";

import PageHead from "@/components/intents-home/PageHead";
import { ListHead, PageView } from "@/components/intents-home/SplitView";
import { useUndo } from "@/components/intents-home/undo";
import { useInAppFrame } from "@/components/intents-home/appFrameContext";
import { Stage, Window } from "@/components/workbench/Workbench";
import UserAvatar from "@/components/UserAvatar";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCompact } from "@/hooks/useCompact";
import { useAuthenticatedAPI } from "@/lib/api";
import { log } from "@/lib/logger";
import { since } from "@/lib/since";
import { createIntroducerService, type ContactEntry, type ExcludedMember, type IntroducerStatus, type IntroductionPhase, type IntroductionProgress, type OpportunityProposal } from "@/services/introducer";
import "@/styles/plain.css";
import "@/styles/introduce.css";

const logger = log.page.from("introduce");

const POLL_MS = 5000;
const MAX_CONTEXT = 2000;

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

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

/** Contacts you said never to suggest, each with a way to allow them again. */
function NeverList({ members, people, total, onAllow, onAllowMember }: {
  members: ExcludedMember[];
  people: ContactEntry[];
  total: number;
  onAllow: (c: ContactEntry) => void;
  onAllowMember: (m: ExcludedMember) => void;
}) {
  if (!people.length && !members.length) return null;
  return (
    <>
      <h2 className="idk-h2" style={{ marginTop: 18 }}>never suggest <span className="n">{total}</span></h2>
      <ul className="idk-rows">
        {members.map((m) => (
          <li key={m.userId} title="in your networks">
            <span className="p">{m.name}</span>
            <button type="button" className="idk-btn small" onClick={() => onAllowMember(m)}>allow</button>
          </li>
        ))}
        {people.map((c) => (
          <li key={c.id} title={c.detail ?? c.email}>
            <span className="p">{c.name}</span>
            <button type="button" className="idk-btn small" onClick={() => onAllow(c)}>allow</button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Introductions you opened, one row each: who, where it is, when it started. Never how. */
function Running({ runs, opening, freshId, never }: { runs: IntroductionProgress[]; opening: OpportunityProposal[]; freshId: string | null; never: ReactNode }) {
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
      {never}
    </aside>
  );
}

/** Which side of a pair to never suggest again: the member, or your contact. */
type NeverWho = "member" | "contact";

/** "⋯" in the card's top-right corner: a small menu to never suggest either person again. */
function NeverMenu({ proposal, disabled, onNever }: {
  proposal: OpportunityProposal;
  disabled: boolean;
  onNever: (p: OpportunityProposal, who: NeverWho) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const pick = (who: NeverWho) => { setOpen(false); onNever(proposal, who); };
  return (
    <div className="idk-never" ref={ref}>
      <button type="button" className="idk-never-dots" disabled={disabled} aria-label="More" title="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="15" height="3" viewBox="0 0 15 3" aria-hidden><circle cx="1.5" cy="1.5" r="1.5" /><circle cx="7.5" cy="1.5" r="1.5" /><circle cx="13.5" cy="1.5" r="1.5" /></svg>
      </button>
      {open && (
        <div className="idk-never-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => pick("member")} title={`No more pairs with ${proposal.member.name}`}>
            never suggest {first(proposal.member.name)}
          </button>
          <button type="button" role="menuitem" onClick={() => pick("contact")} title={`Never pair ${proposal.contact.name}, your contact, with anyone`}>
            never suggest {first(proposal.contact.name)}
          </button>
        </div>
      )}
    </div>
  );
}

function ProposalCard({ proposal, onOpen, onSkip, onNever }: {
  proposal: OpportunityProposal;
  onOpen: (p: OpportunityProposal, context: string) => Promise<void>;
  onSkip: (p: OpportunityProposal) => void;
  /** Never suggest one side of this pair again. */
  onNever: (p: OpportunityProposal, who: NeverWho) => void;
}) {
  const [text, setText] = useState(proposal.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opening = proposal.status === "opening";

  return (
    <div className={`idk-card idk-has-never${opening ? " opening" : ""}`}>
      {!opening && <NeverMenu proposal={proposal} disabled={busy} onNever={onNever} />}
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

/** "Wants a partner." → "wants a partner", but "PM at…" stays "PM at…". */
const lc = (text: string) => {
  const t = text.replace(/\.$/, "");
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
};

/** A pair, drawn like home's cards: who and who, the intro you'll send, wake or skip. */
function PairCard({ proposal, onOpen, onSkip, onNever }: {
  proposal: OpportunityProposal;
  onOpen: (p: OpportunityProposal, context: string) => Promise<void>;
  onSkip: (p: OpportunityProposal) => void;
  /** Never suggest one side of this pair again. */
  onNever: (p: OpportunityProposal, who: NeverWho) => void;
}) {
  const [text, setText] = useState(proposal.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opening = proposal.status === "opening";
  const A = first(proposal.member.name), B = first(proposal.contact.name);
  return (
    <div className="sv-card sv-static sv-pair idk-has-never" data-sv-item={proposal.id}>
      {!opening && <NeverMenu proposal={proposal} disabled={busy} onNever={onNever} />}
      <PairFace proposal={proposal} />
      <div className="sv-card-body">
        <div className="idk-never-room"><b>{A} ⇄ {B}</b><span className="sv-via"> · via {proposal.networkTitle}</span></div>
        <div className="sv-blurb">
          <div title={proposal.member.intentText}>{A} {lc(proposal.member.line)}</div>
          <div title={proposal.contact.detail ?? undefined}>{B} {lc(proposal.contact.line)}<span className="sv-via"> · your contact, not on index</span></div>
        </div>
        {opening ? (
          <div className="sv-pair-lab" role="status"><span>waking both agents · see running</span></div>
        ) : (
          <>
            <label className="sv-pair-lab" htmlFor={`intro-${proposal.id}`}>
              <span>your intro</span>
              <span>{text.length} / {MAX_CONTEXT}</span>
            </label>
            <textarea id={`intro-${proposal.id}`} className="sv-pair-text" value={text} maxLength={MAX_CONTEXT} onChange={(e) => setText(e.target.value)} />
            <div className="sv-actions">
              <button
                type="button"
                className="sv-btn go"
                disabled={busy || !text.trim()}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  onOpen(proposal, text.trim())
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't wake the agents"))
                    .finally(() => setBusy(false));
                }}
              >{busy ? "waking…" : proposal.status === "failed" ? "try again" : "wake both agents"}</button>
              <button type="button" className="sv-btn" disabled={busy} onClick={() => onSkip(proposal)}>skip</button>
            </div>
            {(error ?? proposal.failure) && <div className="sv-pair-err">{error ?? proposal.failure}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/** The introductions you woke, one row each, as a column beside the pairs. */
function RunColumn({ runs, opening, freshId, never, neverMembers, neverTotal, onAllow, onAllowMember }: {
  runs: IntroductionProgress[];
  opening: OpportunityProposal[];
  freshId: string | null;
  never: ContactEntry[];
  neverMembers: ExcludedMember[];
  neverTotal: number;
  onAllow: (c: ContactEntry) => void;
  onAllowMember: (m: ExcludedMember) => void;
}) {
  const ordered = [...runs.filter((r) => !isFinal(r)), ...runs.filter(isFinal)];
  const live = opening.length + runs.filter((r) => !isFinal(r)).length;
  return (
    <aside className="sv-intro-run" aria-live="polite">
      <ListHead id="running">running · {live}</ListHead>
      {ordered.length + opening.length === 0 ? (
        <div className="sv-empty">Nothing running. Wake a pair and it shows up here.</div>
      ) : (
        <>
          {opening.map((p) => (
            <div key={p.id} className="sv-runrow" title={`Looking ${first(p.contact.name)} up and seating their agent. This takes a minute or two.`}>
              <span className="p">{first(p.member.name)} ⇄ {first(p.contact.name)}</span>
              <span className="pl-status pending">waking</span>
              <span className="t">now</span>
            </div>
          ))}
          {ordered.map((r) => (
            <div key={r.opportunityId} className={`sv-runrow${isFinal(r) ? " done" : ""}${r.opportunityId === freshId ? " fresh" : ""}`} title={phaseLine(r)}>
              <span className="p">{first(r.a.name)} ⇄ {first(r.b.name)}</span>
              <span className={`pl-status ${PHASE[r.phase].cls}`}>{PHASE[r.phase].label}</span>
              <span className="t">{since(r.createdAt)}</span>
            </div>
          ))}
        </>
      )}
      <div className="sv-run-foot">🔒 You see where each ends up, never what the agents say.</div>
      {never.length + neverMembers.length > 0 && (
        <>
          <ListHead id="never">never suggest · {neverTotal}</ListHead>
          {neverMembers.map((m) => (
            <div key={m.userId} className="sv-runrow sv-never" title="in your networks">
              <span className="p">{m.name}</span>
              <button type="button" className="sv-btn sm" onClick={() => onAllowMember(m)}>allow</button>
            </div>
          ))}
          {never.map((c) => (
            <div key={c.id} className="sv-runrow sv-never" title={c.detail ?? c.email}>
              <span className="p">{c.name}</span>
              <button type="button" className="sv-btn sm" onClick={() => onAllow(c)}>allow</button>
            </div>
          ))}
        </>
      )}
    </aside>
  );
}

/** Before contacts are read: what introducing is, and where to start. */
function NeedsContacts({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="idk-setup">
      <p><b>Introduce people you know to people on Index.</b> When someone in your networks wants something one of your contacts could help with, you see the pair here. You write why they should meet and wake both agents. They meet only if both say yes.</p>
      <p className="idk-dim">Pairs come from your contacts, so read them first. A contact hears from Index only after you wake the pair and the other person says yes, and then the email comes from you.</p>
      <button type="button" className="idk-open" onClick={onOpen}>open my contacts ›</button>
    </div>
  );
}

/**
 * Introduce: pairs you could introduce (someone in your networks ⇄ one of
 * your contacts not on Index), and the introductions you woke. Needs your
 * contacts first; those live in My contacts.
 */
export default function IntroducePage() {
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const api = useAuthenticatedAPI();
  const service = useMemo(() => createIntroducerService(api), [api]);
  const plain = useInAppFrame();
  const compact = useCompact();
  const navigate = useNavigate();

  const [status, setStatus] = useState<IntroducerStatus | null>(null);
  const [proposals, setProposals] = useState<OpportunityProposal[] | null>(null);
  const [runs, setRuns] = useState<IntroductionProgress[]>([]);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Proposals opened from this page; when one's agents are up, it lights up in the running column.
  const openingHere = useRef(new Set<string>());
  const later = useUndo();
  // Skips wait behind "undo" for a few seconds before they reach the server.
  const [skipping, setSkipping] = useState<Set<string>>(() => new Set());
  // Contacts you said never to suggest; their pairs hide at once, the change waits behind "undo".
  const [never, setNever] = useState<{ people: ContactEntry[]; total: number }>({ people: [], total: 0 });
  const [hiding, setHiding] = useState<Set<string>>(() => new Set());
  // Members of your networks you said never to suggest; same undo, keyed by their user id.
  const [neverMembers, setNeverMembers] = useState<ExcludedMember[]>([]);
  const [hidingMembers, setHidingMembers] = useState<Set<string>>(() => new Set());

  const refreshNever = useCallback(async () => {
    try {
      const [res, members] = await Promise.all([service.contacts("", "excluded", 0), service.excludedMembers()]);
      setNever({ people: res.contacts, total: res.total });
      setNeverMembers(members);
    } catch (err) {
      logger.warn("never-suggest list failed", { error: String(err) });
    }
  }, [service]);

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
    if (s.contacts.lastImportAt) {
      setProposals(await service.proposals());
      void refreshNever();
    }
    await refreshRuns();
  }, [service, refreshRuns, refreshNever]);

  useEffect(() => {
    if (!isAuthenticated) return;
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load"));
  }, [load, isAuthenticated]);

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

  const open = async (proposal: OpportunityProposal, context: string) => {
    await service.open(proposal.id, context);
    openingHere.current.add(proposal.id);
    setProposals((all) => all?.map((p) => (p.id === proposal.id ? { ...p, status: "opening", failure: null } : p)) ?? all);
  };

  const skip = (proposal: OpportunityProposal) => {
    setProposals((all) => all?.filter((p) => p.id !== proposal.id) ?? all);
    service.skip(proposal.id).catch((err: unknown) => logger.warn("skip failed", { error: String(err) }));
  };

  const unhide = (contactId: string) => setHiding((all) => { const next = new Set(all); next.delete(contactId); return next; });

  const unhideMember = (userId: string) => setHidingMembers((all) => { const next = new Set(all); next.delete(userId); return next; });

  const neverSuggest = (p: OpportunityProposal, who: NeverWho) => {
    if (who === "member") {
      const userId = p.member.userId;
      setHidingMembers((all) => new Set(all).add(userId));
      later(`won't suggest ${p.member.name} again`, () => {
        service.setMemberExcluded(userId, true)
          .then(async () => {
            setProposals((all) => all?.filter((x) => x.member.userId !== userId) ?? all);
            await refreshNever();
          })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't save"))
          .finally(() => unhideMember(userId));
      }, () => unhideMember(userId));
      return;
    }
    const id = p.contact.id;
    setHiding((all) => new Set(all).add(id));
    later(`won't suggest ${p.contact.name} again`, () => {
      service.setExcluded(id, true)
        .then(async () => {
          setProposals((all) => all?.filter((x) => x.contact.id !== id) ?? all);
          await refreshNever();
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't save"))
        .finally(() => unhide(id));
    }, () => unhide(id));
  };

  const allow = (c: ContactEntry) => {
    setNever((n) => ({ people: n.people.filter((x) => x.id !== c.id), total: Math.max(0, n.total - 1) }));
    service.setExcluded(c.id, false).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Couldn't save");
      void refreshNever();
    });
  };

  const allowMember = (m: ExcludedMember) => {
    setNeverMembers((all) => all.filter((x) => x.userId !== m.userId));
    service.setMemberExcluded(m.userId, false)
      .then(() => refreshProposals())
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Couldn't save");
        void refreshNever();
      });
  };

  // Signed out: sign in first, then come back here.
  if (!authLoading && !isAuthenticated) return <Navigate to="/login?next=/introduce" replace />;

  const toContacts = () => navigate("/networks/contacts");
  const waiting = (proposals ?? []).filter((p) => p.status !== "opening" && !hiding.has(p.contact.id) && !hidingMembers.has(p.member.userId));
  const neverTotal = never.total + neverMembers.length;
  const ready = !!status?.contacts.lastImportAt;
  const contactsLink = ready && status
    ? <button type="button" className="idk-open" onClick={toContacts}>from {status.contacts.total} contacts ›</button>
    : null;

  // A desktop inside the app: a page like home's, pairs on the left and what's running beside them.
  if (plain && !compact) {
    const shown = waiting.filter((p) => !skipping.has(p.id));
    const skipLater = (p: OpportunityProposal) => {
      setSkipping((all) => new Set(all).add(p.id));
      later(`skipped ${first(p.member.name)} ⇄ ${first(p.contact.name)}`, () => skip(p), () => {
        setSkipping((all) => { const next = new Set(all); next.delete(p.id); return next; });
      });
    };
    const sub = (
      <>
        <span>{ready ? `${shown.length} pair${shown.length === 1 ? "" : "s"} you could introduce` : "your contacts come first"}</span>
        <span className="sp" />
        {ready && status && <button type="button" className="sv-open" onClick={toContacts}>from {status.contacts.total} contacts ›</button>}
      </>
    );
    return (
      <PageView title="Introduce" sub={sub}>
        {!status ? (
          <div className="sv-empty sv-page-gap">{error ?? "loading…"}</div>
        ) : !ready ? (
          <div className="idk sv-idk-page"><NeedsContacts onOpen={toContacts} /></div>
        ) : (
          <div className="sv-intro-cols">
            <section className="sv-intro-pairs">
              <ListHead id="pairs">pairs you could introduce · {shown.length}</ListHead>
              {error && <div className="sv-empty sv-pair-err">{error}</div>}
              {proposals === null ? (
                <div className="sv-empty">loading pairs…</div>
              ) : shown.length === 0 ? (
                <div className="sv-empty">No pairs yet. Index matches your contacts in the background, against what people in your networks post. New pairs show up here as they come in.</div>
              ) : shown.map((p) => <PairCard key={p.id} proposal={p} onOpen={open} onSkip={skipLater} onNever={neverSuggest} />)}
            </section>
            <RunColumn runs={runs} opening={opening} freshId={freshId} never={never.people} neverMembers={neverMembers} neverTotal={neverTotal} onAllow={allow} onAllowMember={allowMember} />
          </div>
        )}
      </PageView>
    );
  }

  const desk = (
    <div className="idk">
      {!status ? (
        error ? <div className="idk-error">{error}</div> : <p className="idk-dim">loading…</p>
      ) : !ready ? (
        <NeedsContacts onOpen={toContacts} />
      ) : (
        <>
          <div className="idk-bar">
            <span>{waiting.length} pair{waiting.length === 1 ? "" : "s"} you could introduce</span>
            <span className="sp" />
            {contactsLink}
          </div>
          {error && <div className="idk-error" style={{ marginBottom: 10 }}>{error}</div>}
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
                waiting.map((p) => <ProposalCard key={p.id} proposal={p} onOpen={open} onSkip={skip} onNever={neverSuggest} />)
              )}
            </section>
            <Running runs={runs} opening={opening} freshId={freshId} never={<NeverList members={neverMembers} people={never.people} total={neverTotal} onAllow={allow} onAllowMember={allowMember} />} />
          </div>
        </>
      )}
    </div>
  );

  const headStatus = !ready ? "your contacts come first" : `${waiting.length} pair${waiting.length === 1 ? "" : "s"} you could introduce`;

  if (plain) {
    return (
      <div className="ih-view pl">
        <div className="pl-col">
          <PageHead title="Introduce" status={headStatus} />
          <div className="pl-page">{desk}</div>
        </div>
      </div>
    );
  }

  return (
    <Stage width={1040} height="min(880px, calc(100vh - 96px))">
      <Window title="introduce" onClose={() => navigate("/")} style={{ height: "100%" }}>
        <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: compact ? "14px 16px 22px" : "18px 24px 22px" }}>
          {desk}
        </div>
      </Window>
    </Stage>
  );
}

export const Component = IntroducePage;
