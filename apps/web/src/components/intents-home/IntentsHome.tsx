import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import Avatar from "@/components/intents-home/Avatar";
import IntentAgentPanel from "@/components/intents-home/IntentAgentPanel";
import { FILTERS, RANK, STAGE_META, filterOf, personKey, useDismiss, type Entry, type Filter, type HomeIntent } from "@/components/intents-home/stages";
import { useAuthContext } from "@/contexts/AuthContext";
import { useIntents, useNegotiations } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { isNotFoundError } from "@/lib/api";
import { intentTitle } from "@/lib/intent-display";
import { INVITE_URL, buildInviteMessage, emailFromSocials, inviteEmailHref, inviteSubject, inviteXHref } from "@/lib/invite";
import { resolveSocials } from "@/lib/socials";
import type { NegotiationDetail } from "@/services/negotiations";
import type { RadarCardItem } from "@/services/opportunities";
import { getPublicUserProfile } from "@/services/users";

interface Person {
  key: string;
  userId?: string;
  name: string;
  avatar?: string | null;
  notOnIndex: boolean;
  /** Where this person shows up in the current view, best stage first. */
  entries: Entry[];
  /** How many of the user's intents this person appears in. */
  intentCount: number;
}

/**
 * Home and intent detail in one page beside the rail (AppFrame): the people
 * found for the selected intent (or all of them), and the intent's agent.
 * `selectedId` is undefined for the all view.
 */
export default function IntentsHome({ selectedId }: { selectedId?: string }) {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const intentsService = useIntents();
  const { conversations } = useConversation();
  const { error: showError } = useNotifications();
  const {
    intents: visible, intentsLoaded, updateIntents, radar, radarFailed, loadRadar,
    entriesByIntent, opportunityActionLoading, handleOpportunityAction,
  } = useIntentsData();

  const [missing, setMissing] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("matches");
  const [open, setOpen] = useState<{ key: string; mode: "log" | "invite" } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showClosed, setShowClosed] = useState(false);
  const [statusPending, setStatusPending] = useState<string | null>(null);
  const [archiveArmed, setArchiveArmed] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const archiveTimer = useRef<number | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Picking an intent starts it on its matches with nothing expanded.
  useEffect(() => {
    setFilter("matches");
    setOpen(null);
    setFilterOpen(false);
    setArchiveArmed(false);
    setMissing(false);
    if (archiveTimer.current) window.clearTimeout(archiveTimer.current);
  }, [selectedId]);

  const current = selectedId ? visible.find((intent) => intent.id === selectedId) : undefined;

  // A deep link (or a just-created intent) can be missing from the list; read it directly.
  useEffect(() => {
    if (!selectedId || !intentsLoaded || current) return;
    let active = true;
    intentsService.getIntent(selectedId).then((intent) => {
      if (!active) return;
      if (intent.status === "archived") { setMissing(true); return; }
      updateIntents((prev) => prev.some((i) => i.id === intent.id) ? prev : [...prev, intent as HomeIntent]);
    }).catch((error: unknown) => {
      if (!active) return;
      if (isNotFoundError(error)) setMissing(true);
      else showError("couldn't load this intent.");
    });
    return () => { active = false; };
  }, [selectedId, intentsLoaded, current, intentsService, updateIntents, showError]);

  const intentCountByPerson = useMemo(() => {
    const sets = new Map<string, Set<string>>();
    for (const entries of Object.values(entriesByIntent)) {
      for (const entry of entries) {
        const key = personKey(entry.item);
        if (!sets.has(key)) sets.set(key, new Set());
        sets.get(key)!.add(entry.intentId);
      }
    }
    return new Map([...sets].map(([key, set]) => [key, set.size]));
  }, [entriesByIntent]);

  // The all view groups by person: one row, a tag per intent, the best stage leads.
  const pool = useMemo((): Person[] => {
    const toPerson = (key: string, entries: Entry[]): Person => {
      const sorted = [...entries].sort((a, b) => RANK[a.stage] - RANK[b.stage]);
      const item = sorted[0].item;
      return {
        key,
        userId: item.userId || item.peer?.userId,
        name: item.name || item.peer?.name || "unknown",
        avatar: item.avatar ?? item.peer?.avatar,
        notOnIndex: item.peer?.emailVerified === false,
        entries: sorted,
        intentCount: intentCountByPerson.get(personKey(item)) ?? 1,
      };
    };
    if (selectedId) {
      return (entriesByIntent[selectedId] ?? []).map((entry) => toPerson(`${entry.intentId}:${entry.item.opportunityId}`, [entry]));
    }
    const groups = new Map<string, Entry[]>();
    for (const entries of Object.values(entriesByIntent)) {
      for (const entry of entries) {
        const key = personKey(entry.item);
        groups.set(key, [...(groups.get(key) ?? []), entry]);
      }
    }
    return [...groups].map(([key, entries]) => toPerson(key, entries));
  }, [selectedId, entriesByIntent, intentCountByPerson]);

  const filterCounts = useMemo(() => {
    const counts: Record<Filter, number> = { matches: 0, "in progress": 0, closed: 0 };
    for (const person of pool) counts[filterOf(person.entries[0].stage)] += 1;
    return counts;
  }, [pool]);

  const sorted = useMemo(
    () => [...pool].sort((a, b) => RANK[a.entries[0].stage] - RANK[b.entries[0].stage] || b.intentCount - a.intentCount),
    [pool],
  );
  const rows = useMemo(() => sorted.filter((person) => filterOf(person.entries[0].stage) === filter), [sorted, filter]);
  // The all view shows every filter at once, as sections.
  const sections = useMemo(() => {
    const out: Record<Filter, Person[]> = { matches: [], "in progress": [], closed: [] };
    for (const person of sorted) out[filterOf(person.entries[0].stage)].push(person);
    return out;
  }, [sorted]);

  const labelOf = (intent: HomeIntent) => intentTitle((intent.summary?.trim() || intent.payload).trim());

  const chatPeers = useMemo(() => {
    const ids = new Set<string>();
    for (const conv of conversations) {
      for (const participant of conv.participants ?? []) {
        if (participant.participantType === "user" && participant.participantId !== user?.id) ids.add(participant.participantId);
      }
    }
    return ids;
  }, [conversations, user?.id]);

  const act = (person: Person, action: "accepted" | "rejected") => {
    // In the all view, a decision applies to every intent where they are waiting on you.
    for (const entry of person.entries.filter((e) => e.stage === "awaiting")) {
      if (opportunityActionLoading[entry.item.opportunityId]) continue;
      void handleOpportunityAction(entry.item.opportunityId, action, person.userId, {
        notOnIndex: person.notOnIndex,
        scope: { intentId: entry.intentId },
      }).then(() => loadRadar(entry.intentId));
    }
  };

  const toggleExpanded = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  const toggle = (key: string, mode: "log" | "invite") =>
    setOpen((prev) => (prev?.key === key && prev.mode === mode ? null : { key, mode }));

  const selectMatch = useCallback((opportunityId: string) => {
    if (!selectedId) return;
    const entry = (entriesByIntent[selectedId] ?? []).find((e) => e.item.opportunityId === opportunityId);
    if (!entry) return;
    setFilter(filterOf(entry.stage));
    setOpen({ key: `${entry.intentId}:${opportunityId}`, mode: "log" });
  }, [selectedId, entriesByIntent]);

  const renderRow = (person: Person) => {
    const lead = person.entries[0];
    const rowKey = selectedId ? person.key : `${lead.intentId}:${lead.item.opportunityId}`;
    const meta = STAGE_META[lead.stage];
    const blurb = lead.item.headline || lead.item.mainText || "";
    const busy = person.entries.some((e) => opportunityActionLoading[e.item.opportunityId]);
    const hasChat = !!person.userId && chatPeers.has(person.userId) && !person.notOnIndex;
    const isOpen = open?.key === rowKey;
    const intentLabel = (id: string) => {
      const intent = visible.find((i) => i.id === id);
      return intent ? labelOf(intent) : "";
    };
    return (
      <div key={person.key} className="ih-row">
        <div className="ih-row-main">
          <Avatar name={person.name} photo={person.avatar} />
          <div className="ih-row-text">
            <div className="ih-name-line">
              {person.userId
                ? <Link to={`/u/${person.userId}`} className="ih-name">{person.name}</Link>
                : <span className="ih-name">{person.name}</span>}
              {selectedId && person.intentCount > 1 && <span className="ih-pill">{person.intentCount} intents</span>}
              {person.notOnIndex && <span className="ih-pill" style={{ color: "var(--ih-muted)" }}>not on index</span>}
            </div>
            {!selectedId && (
              <div className="ih-tags">
                {(expanded.has(person.key) ? person.entries : [lead]).map((entry) => (
                  <button key={entry.intentId} type="button" className="ih-tag" onClick={() => pick(entry.intentId)}>
                    <span className="ih-tag-dot" style={{ background: STAGE_META[entry.stage].dot }} />
                    {intentLabel(entry.intentId)}
                  </button>
                ))}
                {person.entries.length > 1 && (
                  <button type="button" className="ih-tag ih-more" onClick={() => toggleExpanded(person.key)}>
                    {expanded.has(person.key) ? "less" : `+${person.entries.length - 1} more`}
                  </button>
                )}
              </div>
            )}
            <div className={`ih-blurb${!blurb ? " pending" : ""}`}>{blurb || (lead.item.presentationPending ? "…" : "")}</div>
          </div>
          <div className="ih-row-actions">
            {lead.stage === "awaiting" && hasChat ? (
              <button type="button" className="ih-accept" onClick={() => navigate(`/u/${person.userId}/chat`)}>open chat</button>
            ) : lead.stage === "awaiting" ? (
              <>
                <button type="button" className="ih-accept" disabled={busy} onClick={() => act(person, "accepted")}>accept</button>
                <button type="button" className="ih-pass" disabled={busy} onClick={() => act(person, "rejected")}>pass</button>
              </>
            ) : (
              <>
                <span className={`ih-state${lead.stage === "closed" ? " closed" : ""}`}>
                  <span className="ih-state-dot" style={{ background: meta.dot }} />
                  {lead.stage === "closed" && lead.item.status === "rejected" ? "not a fit" : meta.label}
                </span>
                {lead.stage === "chat" && (person.notOnIndex
                  ? <button type="button" className="ih-link" onClick={() => toggle(rowKey, "invite")}>{isOpen && open?.mode === "invite" ? "HIDE INVITE ▴" : "INVITE ›"}</button>
                  : person.userId && <button type="button" className="ih-link" onClick={() => navigate(`/u/${person.userId}/chat`)}>CHAT ›</button>)}
                <button type="button" className="ih-link" onClick={() => toggle(rowKey, "log")}>
                  {isOpen && open?.mode === "log" ? "HIDE LOG ▴" : "AGENT LOG ›"}
                </button>
              </>
            )}
          </div>
        </div>
        {isOpen && open?.mode === "log" && <AgentLog opportunityId={lead.item.opportunityId} name={person.name} />}
        {isOpen && open?.mode === "invite" && (
          <InviteLog
            key={lead.item.opportunityId}
            item={lead.item}
            name={person.name}
            intent={visible.find((i) => i.id === lead.intentId)?.payload}
            senderName={user?.name}
          />
        )}
      </div>
    );
  };

  const paused = (current?.status || "").toLowerCase() === "paused";

  const togglePause = async () => {
    if (!current || statusPending) return;
    const next = paused ? "active" : "paused";
    setStatusPending(current.id);
    try {
      const updated = await intentsService.setIntentStatus(current.id, next);
      updateIntents((prev) => prev.map((intent) => intent.id === updated.id ? { ...intent, status: updated.status } : intent));
    } catch {
      showError(next === "paused" ? "Failed to pause intent" : "Failed to resume intent");
    } finally {
      if (mountedRef.current) setStatusPending(null);
    }
  };

  const clickArchive = async () => {
    if (!current || archiving) return;
    if (archiveTimer.current) window.clearTimeout(archiveTimer.current);
    if (!archiveArmed) {
      setArchiveArmed(true);
      archiveTimer.current = window.setTimeout(() => setArchiveArmed(false), 4000);
      return;
    }
    setArchiveArmed(false);
    setArchiving(true);
    try {
      await intentsService.archiveIntent(current.id);
      updateIntents((prev) => prev.filter((intent) => intent.id !== current.id));
      navigate("/");
    } catch {
      showError("couldn't archive this intent.");
    } finally {
      if (mountedRef.current) setArchiving(false);
    }
  };

  const closeFilter = useCallback(() => setFilterOpen(false), []);
  useDismiss(filterOpen, filterRef, closeFilter);

  const pick = (id?: string) => navigate(id ? `/i/${id}` : "/");
  const peopleTotal = pool.length;
  const loadingPeople = selectedId ? !radar[selectedId] && !radarFailed[selectedId] : visible.some((intent) => !radar[intent.id] && !radarFailed[intent.id]);
  const peopleFailed = selectedId ? radarFailed[selectedId] && !radar[selectedId] : false;

  const emptyLine = filter === "closed"
    ? "nothing closed."
    : paused && peopleTotal === 0
      ? "this intent is paused, so your agent isn't looking right now."
      : "nothing here yet. your agent is still looking.";

  return (
    <div className="ih-view">
      {selectedId && <header className="ih-head">
        {current ? (
          <>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="ih-eyebrow">INTENT</div>
              <h1 className="ih-title">{current.payload?.trim() || current.summary?.trim() || "your intent"}</h1>
              <div className="ih-status">
                <span className="ih-status-dot" style={{ background: paused ? "var(--ih-closed)" : "var(--ih-live)" }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  {paused ? "paused · agent is not looking" : "live · agent is looking in the background"}
                  {current.createdAt && ` · created ${new Date(current.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                </span>
              </div>
            </div>
            <div className="ih-actions">
              <button type="button" className="ih-ghost" disabled={!!statusPending} onClick={() => void togglePause()}>
                {paused ? "▶ resume" : "❚❚ pause"}
              </button>
              <button type="button" className="ih-ghost" disabled={archiving} onClick={() => void clickArchive()}>
                {archiving ? "archiving…" : archiveArmed ? "archive · confirm" : "archive"}
              </button>
            </div>
          </>
        ) : (
          <div>
            <div className="ih-eyebrow">INTENT</div>
            <h1 className="ih-title" style={{ color: "var(--ih-muted)" }}>{missing ? "this intent doesn't exist or was removed." : "loading…"}</h1>
          </div>
        )}
      </header>}

      {!selectedId && (
        <div className="ih-cols">
          <section className="ih-people ih-all">
            {/* Wait for every intent's people, or the sections reshuffle as they arrive. */}
            {loadingPeople ? (
              <div className="ih-empty">loading…</div>
            ) : pool.length === 0 ? (
              <div className="ih-empty">{intentsLoaded && !visible.length ? "no intents yet. start one and your agent goes looking." : "nothing here yet. your agents are still looking."}</div>
            ) : (
              <>
                <div className="ih-bar">
                  <span>WAITING ON YOU</span>
                  {sections.matches.length > 0 && <span className="ih-n">{sections.matches.length}</span>}
                </div>
                {sections.matches.length ? sections.matches.map(renderRow) : <div className="ih-empty">nothing waiting on you.</div>}
                {sections["in progress"].length > 0 && (
                  <>
                    <div className="ih-bar">
                      <span>IN PROGRESS</span>
                      <span className="ih-n">{sections["in progress"].length}</span>
                    </div>
                    {sections["in progress"].map(renderRow)}
                  </>
                )}
                {sections.closed.length > 0 && (
                  <>
                    <button type="button" className="ih-bar ih-bar-toggle" aria-expanded={showClosed} onClick={() => setShowClosed((v) => !v)}>
                      <span>CLOSED</span>
                      <span className="ih-n">{showClosed ? "hide" : `${sections.closed.length} · show`}</span>
                    </button>
                    {showClosed && sections.closed.map(renderRow)}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {selectedId && current && (
        <div className="ih-cols">
          <section className="ih-people">
            <div className="ih-bar">
              <span>PEOPLE</span>
              <div ref={filterRef} style={{ position: "relative" }}>
                <button type="button" className="ih-filter" aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => setFilterOpen((v) => !v)}>
                  {filter}<span style={{ color: "var(--ih-muted)", fontSize: 10 }}>▾</span>
                </button>
                {filterOpen && (
                  <div role="menu" className="ih-pop" style={{ right: 0, top: "calc(100% + 4px)" }}>
                    {FILTERS.map(({ value }) => (
                      <button key={value} type="button" role="menuitemradio" aria-checked={filter === value}
                        className={`ih-pop-item${filter === value ? " on" : ""}`}
                        onClick={() => { setFilter(value); setFilterOpen(false); }}>
                        <span>{value}</span><span className="ih-n">{filterCounts[value]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {peopleFailed ? (
              <div className="ih-empty">
                couldn&apos;t load people. <button type="button" className="ih-link" onClick={() => selectedId && void loadRadar(selectedId)}>try again</button>
              </div>
            ) : rows.length === 0 && loadingPeople ? (
              <div className="ih-empty">loading…</div>
            ) : rows.length === 0 ? (
              <div className="ih-empty">{emptyLine}</div>
            ) : rows.map(renderRow)}
          </section>

          {current && (
            <IntentAgentPanel key={selectedId} intentId={selectedId} paused={paused} onSelectMatch={selectMatch} />
          )}
        </div>
      )}
    </div>
  );
}

/** One match's read-only agent-to-agent thread, as plain speaker/text lines. */
function AgentLog({ opportunityId, name }: { opportunityId: string; name: string }) {
  const { user } = useAuthContext();
  const service = useNegotiations();
  const [detail, setDetail] = useState<NegotiationDetail>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const record = await service.getNegotiation(opportunityId);
        if (active) { setDetail(record); setFailed(false); }
      } catch {
        if (active) setFailed(true);
      } finally { loading = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [opportunityId, service]);

  const first = (detail?.counterparty.name || name).split(" ")[0];
  return (
    <div className="ih-log" data-testid="agent-log">
      {failed && !detail && <div className="ih-log-note">couldn&apos;t load this agent log.</div>}
      {!detail && !failed && <div className="ih-log-note">loading…</div>}
      {detail && detail.turns.length === 0 && <div className="ih-log-note">no turns yet.</div>}
      {detail?.turns.map((turn) => (
        <div key={turn.turnIndex} className="ih-log-line">
          <span className="ih-log-from">{turn.seatUserId === user?.id ? "your agent" : `${first}'s agent`}</span>
          <span className="ih-log-text">{turn.message}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * What accepting opens for someone not on Index yet: a pre-written invite and
 * the ways to send it. X and email show only when their profile has them;
 * otherwise the invite link is there to copy.
 */
function InviteLog({ item, name, intent, senderName }: { item: RadarCardItem; name: string; intent?: string; senderName?: string | null }) {
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof getPublicUserProfile>> | null>(null);
  const [message, setMessage] = useState(() => buildInviteMessage({ name, intent, senderName }));
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (!item.userId) return;
    let active = true;
    getPublicUserProfile(item.userId).then((user) => { if (active) setProfile(user); }).catch(() => {});
    return () => { active = false; };
  }, [item.userId]);

  const copy = () => {
    navigator.clipboard?.writeText(INVITE_URL).then(() => {
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  const x = resolveSocials(profile?.socials).find((s) => s.platform === "x");
  const email = emailFromSocials(profile?.socials);
  const first = name.split(/\s+/)[0] || "them";
  return (
    <div className="ih-log">
      <div className="ih-log-note">{first} isn&apos;t on index yet, so there&apos;s no chat to open. send an invite and pick it up here once they join.</div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={6}
        aria-label="Invite message"
        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", border: "1px solid var(--ih-control)", borderRadius: 3, background: "#fff", padding: "8px 10px", font: "400 12px/1.6 var(--ih-mono)", color: "var(--ih-ink)", outline: "none" }}
      />
      <div className="ih-log-actions">
        {x && <a className="ih-link" href={inviteXHref(message)} target="_blank" rel="noopener noreferrer" title={`Opens an X message. Pick @${x.handle} as the recipient.`}>send on X</a>}
        {email && <a className="ih-link" href={inviteEmailHref({ to: email, subject: inviteSubject(senderName), body: message })}>email</a>}
        <button type="button" className="ih-link" onClick={copy}>{copied ? "copied" : "copy invite link"}</button>
      </div>
    </div>
  );
}
