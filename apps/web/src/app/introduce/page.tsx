import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useNavigate } from "react-router";

import PageHead from "@/components/intents-home/PageHead";
import { ListHead, PageView } from "@/components/intents-home/SplitView";
import { useUndo } from "@/components/intents-home/undo";
import { InAppFrameContext, useInAppFrame, useRightSlot } from "@/components/intents-home/appFrameContext";
import { PersonPane, PersonSummary, type PersonTab } from "@/components/intents-home/PersonPane";
import { useProfile } from "@/components/intents-home/useProfile";
import ChatView from "@/components/chat/ChatView";
import { Stage, Window } from "@/components/workbench/Workbench";
import UserAvatar from "@/components/UserAvatar";
import IntroducePersonPicker from "@/components/IntroducePersonPicker";
import { ContactsSetup } from "@/components/ContactsImport";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCompact } from "@/hooks/useCompact";
import { useContactsImport } from "@/hooks/useContactsImport";
import { useAuthenticatedAPI } from "@/lib/api";
import { log } from "@/lib/logger";
import { since } from "@/lib/since";
import { createIntroducerService, type IntroducerStatus, type IntroductionPhase, type IntroductionProgress, type OpportunityProposal, type PickablePerson } from "@/services/introducer";
import "@/styles/plain.css";
import "@/styles/introduce.css";

const logger = log.page.from("introduce");

const POLL_MS = 5000;
const MAX_CONTEXT = 2000;

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** A person on a pair, linked to their page when they have one: the member's profile, or the contact's ghost. */
function PersonLink({ userId, name, className = "idk-person", children }: { userId: string | null; name: string; className?: string; children: ReactNode }) {
  return userId ? <Link to={`/u/${userId}`} className={className} title={`${name}'s page`}>{children}</Link> : <>{children}</>;
}

const isFinal = (p: IntroductionProgress) => p.phase !== "talking" && p.phase !== "agreed";

/** Each phase as a word and a status square, as on home. */
const PHASE: Record<IntroductionPhase, { label: string; cls: string }> = {
  talking: { label: "talking", cls: "talks" },
  agreed: { label: "agreed", cls: "waiting" },
  met: { label: "met", cls: "live" },
  no_fit: { label: "no fit", cls: "paused" },
  quiet: { label: "went quiet", cls: "paused" },
  private: { label: "ended", cls: "paused" },
};

function phaseLine(p: IntroductionProgress): string {
  const A = first(p.a.name), B = first(p.b.name);
  switch (p.phase) {
    case "talking": return "Both agents are awake and talking privately.";
    case "agreed": return `The agents agreed. Now it's up to ${A} and ${B}.`;
    case "met": return `${A} and ${B} both said yes. They're connected.`;
    case "no_fit": return "It wasn't a fit. Nothing more happens.";
    case "quiet": return "It went quiet before both said yes.";
    case "private": return "It ended. One of them keeps how it went private.";
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
              {r.reports.map((n) => <span key={n.at} className="note">{n.note}</span>)}
            </li>
          ))}
        </ul>
      )}
      <div className="idk-run-foot">🔒 You see where each ends up and any note either side sends back, never what the agents say.</div>
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
          <PersonLink userId={proposal.member.userId} name={proposal.member.name} className="idk-face">
            <UserAvatar id={proposal.member.userId} name={proposal.member.name} avatar={proposal.member.avatar} size={30} />
          </PersonLink>
          <div style={{ minWidth: 0 }}>
            <div className="idk-line" title={proposal.member.intentText}><b><PersonLink userId={proposal.member.userId} name={proposal.member.name}>{first(proposal.member.name)}</PersonLink></b> {proposal.member.line}</div>
            <small>{proposal.networkTitle}</small>
          </div>
        </div>
        <div className="idk-link">⇄</div>
        <div className="idk-who">
          <PersonLink userId={proposal.contact.ghostUserId} name={proposal.contact.name} className="idk-face">
            <UserAvatar id={proposal.contact.id} name={proposal.contact.name} avatar={proposal.contact.avatar} size={30} />
          </PersonLink>
          <div style={{ minWidth: 0 }}>
            <div className="idk-line" title={proposal.contact.detail ?? undefined}><b><PersonLink userId={proposal.contact.ghostUserId} name={proposal.contact.name}>{first(proposal.contact.name)}</PersonLink></b> {proposal.contact.line}</div>
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

/** Someone on a pair or a running intro, opened on the right like a person on home. */
interface SidePerson {
  /** Who this is, so the same person isn't opened twice. */
  key: string;
  userId: string | null;
  name: string;
  avatar: string | null;
  /** Seeds the avatar's colour when there's no user. */
  avatarId: string;
  /** Known from the pair; otherwise read from their profile. */
  notOnIndex?: boolean;
  /** What this page knows about them, on top of their summary. */
  about?: { label: string; text: string };
}

const memberSide = (p: OpportunityProposal): SidePerson => ({
  key: `u:${p.member.userId}`, userId: p.member.userId, name: p.member.name, avatar: p.member.avatar, avatarId: p.member.userId,
  notOnIndex: false, about: { label: "looking for", text: p.member.intentText || p.member.line },
});

const contactSide = (p: OpportunityProposal): SidePerson => ({
  key: p.contact.ghostUserId ? `u:${p.contact.ghostUserId}` : `c:${p.contact.id}`,
  userId: p.contact.ghostUserId, name: p.contact.name, avatar: p.contact.avatar, avatarId: p.contact.id,
  notOnIndex: true, about: { label: "your contact", text: p.contact.detail || p.contact.line },
});

/** A name or face that opens that person on the right. */
function Opens({ who, onPerson, className = "sv-whobtn", children }: { who: SidePerson; onPerson: (who: SidePerson) => void; className?: string; children: ReactNode }) {
  return <button type="button" className={className} title={`open ${who.name}`} onClick={() => onPerson(who)}>{children}</button>;
}

/** A face and the name beside it, as one button that opens that person on the right. */
function FaceName({ who, onPerson }: { who: SidePerson; onPerson: (who: SidePerson) => void }) {
  return (
    <Opens who={who} onPerson={onPerson} className="sv-whobtn sv-facename">
      <UserAvatar id={who.avatarId} name={who.name} avatar={who.avatar} size={20} />
      <span>{who.name}</span>
    </Opens>
  );
}

/** "Wants a partner." → "wants a partner", but "PM at…" stays "PM at…". */
const lc = (text: string) => {
  const t = text.replace(/\.$/, "");
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
};

/** A pair, drawn like home's cards: who and who, the intro you'll send, wake or skip. */
function PairCard({ proposal, onOpen, onSkip, onNever, onPerson }: {
  proposal: OpportunityProposal;
  /** A name or face opens that person on the right. */
  onPerson: (who: SidePerson) => void;
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
      <div className="sv-card-body">
        <div className="idk-never-room sv-pairnames">
          <b><FaceName who={memberSide(proposal)} onPerson={onPerson} /></b>
          <span className="sv-pairswap" aria-hidden>⇄</span>
          <b><FaceName who={contactSide(proposal)} onPerson={onPerson} /></b>
          <span className="sv-via">· via {proposal.networkTitle}</span>
        </div>
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

/**
 * The introductions you woke, one row each, in the window on the right. Each
 * name opens that person there, in this list's place, until it's closed.
 */
function RunWindow({ runs, opening, freshId, onPerson }: {
  runs: IntroductionProgress[];
  opening: OpportunityProposal[];
  freshId: string | null;
  onPerson: (who: SidePerson) => void;
}) {
  const ordered = [...runs.filter((r) => !isFinal(r)), ...runs.filter(isFinal)];
  const live = opening.length + runs.filter((r) => !isFinal(r)).length;
  const runSide = (r: IntroductionProgress, who: IntroductionProgress["a"]): SidePerson => ({
    key: `u:${who.userId}`, userId: who.userId, name: who.name, avatar: who.avatar, avatarId: who.userId,
    about: { label: `your intro · ${PHASE[r.phase].label}`, text: r.context || phaseLine(r) },
  });
  return (
    <div className="sv-runwin" aria-live="polite">
      <ListHead id="running">running · {live}</ListHead>
      <div className="sv-runwin-list">
        {ordered.length + opening.length === 0 ? (
          <div className="sv-empty">Nothing running. Wake a pair and it shows up here.</div>
        ) : (
          <>
            {opening.map((p) => (
              <div key={p.id} className="sv-runrow" title={`Looking ${first(p.contact.name)} up and seating their agent. This takes a minute or two.`}>
                <span className="p"><Opens who={memberSide(p)} onPerson={onPerson}>{first(p.member.name)}</Opens> ⇄ <Opens who={contactSide(p)} onPerson={onPerson}>{first(p.contact.name)}</Opens></span>
                <span className="pl-status pending">waking</span>
                <span className="t">now</span>
              </div>
            ))}
            {ordered.map((r) => (
              <div key={r.opportunityId} className={`sv-runrow${isFinal(r) ? " done" : ""}${r.opportunityId === freshId ? " fresh" : ""}`} title={phaseLine(r)}>
                <span className="p"><Opens who={runSide(r, r.a)} onPerson={onPerson}>{first(r.a.name)}</Opens> ⇄ <Opens who={runSide(r, r.b)} onPerson={onPerson}>{first(r.b.name)}</Opens></span>
                <span className={`pl-status ${PHASE[r.phase].cls}`}>{PHASE[r.phase].label}</span>
                <span className="t">{since(r.createdAt)}</span>
                {r.reports.map((n) => <span key={n.at} className="note">{n.note}</span>)}
              </div>
            ))}
          </>
        )}
      </div>
      <div className="sv-run-foot">🔒 You see where each ends up and any note either side sends back, never what the agents say.</div>
    </div>
  );
}

/**
 * A person picked on Introduce, in the window on the right: the same pane
 * home opens (summary · chat), with what this page knows about them on top.
 */
function PersonSide({ who, onClose }: { who: SidePerson; onClose: () => void }) {
  const profile = useProfile(who.userId ?? undefined);
  const [tab, setTab] = useState<PersonTab>("summary");
  const [chatCount, setChatCount] = useState(0);
  const notOnIndex = who.notOnIndex ?? profile?.emailVerified === false;
  const canChat = !!who.userId && !notOnIndex;
  return (
    <PersonPane
      person={{ name: who.name, userId: who.userId ?? undefined, avatar: who.avatar, notOnIndex, fallbackId: who.avatarId }}
      tab={tab}
      onTab={setTab}
      chatOff={canChat ? undefined : `${first(who.name)} isn't on index yet. the chat opens here once they join.`}
      chatCount={canChat ? chatCount || undefined : undefined}
      onClose={onClose}
      summary={(
        <>
          {who.about?.text && (
            <>
              <h4 className="sv-h4">{who.about.label}</h4>
              <p>{who.about.text}</p>
            </>
          )}
          {who.userId && <PersonSummary userId={who.userId} name={who.name} avatar={who.avatar} />}
        </>
      )}
      chat={canChat && who.userId ? (
        <InAppFrameContext.Provider value>
          <ChatView key={who.userId} userId={who.userId} userName={who.name} userAvatar={who.avatar ?? undefined} onClose={() => setTab("summary")} bare onCount={setChatCount} />
        </InAppFrameContext.Provider>
      ) : null}
    />
  );
}

/** Before contacts are read: what introducing is, and reading them right here. */
function NeedsContacts({ status, importing, error, onConnect, onImport }: {
  status: IntroducerStatus;
  importing: boolean;
  error: string | null;
  onConnect: () => void;
  onImport: () => void;
}) {
  return (
    <ContactsSetup status={status} importing={importing} error={error} onConnect={onConnect} onImport={onImport}>
      <p><b>Introduce people you know to people on Index.</b> When someone in your networks wants something one of your contacts could help with, you see the pair here. You write why they should meet and wake both agents. They meet only if both say yes.</p>
      <p className="idk-dim">Pairs come from your contacts, so read them first. A contact hears from Index only after you wake the pair and the other person says yes, and then the email comes from you.</p>
    </ContactsSetup>
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
  const rightSlot = useRightSlot();
  // The person opened on the right, in the running list's place; closing brings the list back.
  const [side, setSide] = useState<SidePerson | null>(null);
  useEffect(() => {
    if (!side) return;
    // Esc closes them, unless you're halfway through typing something.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT") && (target as HTMLTextAreaElement).value.trim() !== "") return;
      event.preventDefault();
      setSide(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [side]);
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
  // Pairs you said never to suggest hide at once; the change waits behind "undo".
  // Contacts are keyed by contact id, members of your networks by their user id.
  const [hiding, setHiding] = useState<Set<string>>(() => new Set());
  const [hidingMembers, setHidingMembers] = useState<Set<string>>(() => new Set());

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

  useEffect(() => {
    if (!isAuthenticated) return;
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load"));
  }, [load, isAuthenticated]);

  // Regenerate: new pairs from contacts already looked up on the web. Polls the desk until the judge is done.
  const [regenerating, setRegenerating] = useState(false);
  useEffect(() => {
    if (!regenerating) return;
    const t = setInterval(() => {
      void (async () => {
        const running = await service.regenerating().catch(() => false);
        await refreshProposals();
        if (!running) setRegenerating(false);
      })();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [regenerating, service, refreshProposals]);

  const regenerate = async () => {
    setError(null);
    setRegenerating(true);
    try {
      await service.regenerate();
    } catch (err) {
      // 409: a run is already going; keep polling it.
      if ((err as { status?: number }).status !== 409) {
        setRegenerating(false);
        setError(err instanceof Error ? err.message : "Couldn't regenerate");
      }
    }
  };

  const regenerateButton = (className: string) => (
    <button type="button" className={className} disabled={regenerating} onClick={() => void regenerate()}>
      {regenerating ? "regenerating…" : "regenerate"}
    </button>
  );

  // Pick a person: only their pairs show, and with none you can look for some just for them.
  const [person, setPerson] = useState<PickablePerson | null>(null);
  // Who the last look was for, so an empty desk after it reads as "nothing found".
  const [lookedFor, setLookedFor] = useState<string | null>(null);
  const personKey = person ? `${person.kind}:${person.id}` : null;
  const isTheirs = (p: OpportunityProposal) =>
    !person || (person.kind === "member" ? p.member.userId === person.id : p.contact.id === person.id);

  const generate = async (who: PickablePerson) => {
    setError(null);
    setLookedFor(`${who.kind}:${who.id}`);
    setRegenerating(true);
    try {
      await service.generate(who);
    } catch (err) {
      // 409: a run is already going; keep polling it, but this look didn't start.
      setLookedFor(null);
      if ((err as { status?: number }).status !== 409) {
        setRegenerating(false);
        setError(err instanceof Error ? err.message : "Couldn't look for pairs");
      }
    }
  };

  const picker = <IntroducePersonPicker search={service.people} value={person} onChange={setPerson} />;

  const noPairsFor = (who: PickablePerson, buttonClass: string) => {
    const name = first(who.name);
    if (regenerating) return <>Looking for pairs for {name}. Index checks each one on the web before it shows here, so this can take a few minutes.</>;
    const looked = lookedFor === personKey;
    return (
      <>
        {looked ? `Nothing worth introducing for ${name} right now.` : `No pairs with ${name} yet.`}
        <div className="ipk-go">
          <button type="button" className={buttonClass} onClick={() => void generate(who)}>{looked ? "Look again" : `Find pairs for ${name}`}</button>
        </div>
      </>
    );
  };

  const contactsImport = useContactsImport({ service, status, reload: load, here: "/introduce" });

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

  // The list of who you never want suggested lives in My contacts; the toast links there.
  const toNever = { label: "see list ›", go: () => navigate("/networks/contacts?filter=excluded") };

  const neverSuggest = (p: OpportunityProposal, who: NeverWho) => {
    const failed = (err: unknown) => setError(err instanceof Error ? err.message : "Couldn't save");
    if (who === "member") {
      const userId = p.member.userId;
      setHidingMembers((all) => new Set(all).add(userId));
      later(`won't suggest ${p.member.name} again`, () => service.setMemberExcluded(userId, true)
        .then(() => setProposals((all) => all?.filter((x) => x.member.userId !== userId) ?? all))
        .catch(failed)
        .finally(() => unhideMember(userId)), () => unhideMember(userId), toNever);
      return;
    }
    const id = p.contact.id;
    setHiding((all) => new Set(all).add(id));
    later(`won't suggest ${p.contact.name} again`, () => service.setExcluded(id, true)
      .then(() => setProposals((all) => all?.filter((x) => x.contact.id !== id) ?? all))
      .catch(failed)
      .finally(() => unhide(id)), () => unhide(id), toNever);
  };

  // Signed out: sign in first, then come back here.
  if (!authLoading && !isAuthenticated) return <Navigate to="/login?next=/introduce" replace />;

  const toContacts = () => navigate("/networks/contacts");
  const waiting = (proposals ?? []).filter((p) => p.status !== "opening" && !hiding.has(p.contact.id) && !hidingMembers.has(p.member.userId) && isTheirs(p));
  const ready = !!status?.contacts.lastImportAt;
  const contactsLink = ready && status
    ? <button type="button" className="idk-open" onClick={toContacts}>from {status.contacts.total} contacts ›</button>
    : null;

  // A desktop inside the app: a page like home's with the pairs, and a window on
  // the right like home's: what's running, or the person you picked.
  if (plain && !compact) {
    const shown = waiting.filter((p) => !skipping.has(p.id));
    // Waking or skipping a pair is done with it: whoever was open on the right closes, and running shows again.
    const wake = (p: OpportunityProposal, context: string) => { setSide(null); return open(p, context); };
    const skipLater = (p: OpportunityProposal) => {
      setSide(null);
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
      <>
      <PageView title="Introduce" sub={sub}>
        {!status ? (
          <div className="sv-empty sv-page-gap">{error ?? "loading…"}</div>
        ) : !ready ? (
          <div className="idk sv-idk-page"><NeedsContacts status={status} importing={contactsImport.importing} error={contactsImport.error} onConnect={() => void contactsImport.connect()} onImport={() => void contactsImport.doImport()} /></div>
        ) : (
          <div className="sv-intro-cols">
            <section className="sv-intro-pairs">
              <div className="sv-lh sv-lh-fold" id="pairs">
                <span>pairs you could introduce · {shown.length}</span>
                {regenerateButton("sv-open")}
              </div>
              <div className="sv-pick-row">{picker}</div>
              {error && <div className="sv-empty sv-pair-err">{error}</div>}
              {proposals === null ? (
                <div className="sv-empty">loading pairs…</div>
              ) : shown.length === 0 && person ? (
                <div className="sv-empty">{noPairsFor(person, "sv-btn go")}</div>
              ) : shown.length === 0 ? (
                <div className="sv-empty">No pairs yet. Index matches your contacts in the background, against what people in your networks post. New pairs show up here as they come in.</div>
              ) : shown.map((p) => <PairCard key={p.id} proposal={p} onOpen={wake} onSkip={skipLater} onNever={neverSuggest} onPerson={setSide} />)}
            </section>
          </div>
        )}
      </PageView>
      {rightSlot && ready && createPortal(
        <section className="ih-agentwin sv-matchwin" aria-label={side ? `you and ${first(side.name)}` : "running introductions"}>
          <div className="sv">
            <section className="sv-pane" data-zone="pane">
              {side
                ? <PersonSide key={side.key} who={side} onClose={() => setSide(null)} />
                : <RunWindow runs={runs} opening={opening} freshId={freshId} onPerson={setSide} />}
            </section>
          </div>
        </section>,
        rightSlot,
      )}
      </>
    );
  }

  const desk = (
    <div className="idk">
      {!status ? (
        error ? <div className="idk-error">{error}</div> : <p className="idk-dim">loading…</p>
      ) : !ready ? (
        <NeedsContacts status={status} importing={contactsImport.importing} error={contactsImport.error} onConnect={() => void contactsImport.connect()} onImport={() => void contactsImport.doImport()} />
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
              <h2 className="idk-h2">pairs you could introduce <span className="n">{waiting.length || ""}</span>{regenerateButton("idk-open idk-regen")}</h2>
              {picker}
              {proposals === null ? (
                <p className="idk-dim">loading pairs…</p>
              ) : waiting.length === 0 && person ? (
                <div className="idk-empty">{noPairsFor(person, "idk-btn go")}</div>
              ) : waiting.length === 0 ? (
                <div className="idk-empty">
                  No pairs yet. Index matches your contacts in the background, against what people in your networks post. New pairs show up here as they come in.
                </div>
              ) : (
                waiting.map((p) => <ProposalCard key={p.id} proposal={p} onOpen={open} onSkip={skip} onNever={neverSuggest} />)
              )}
            </section>
            <Running runs={runs} opening={opening} freshId={freshId} />
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
