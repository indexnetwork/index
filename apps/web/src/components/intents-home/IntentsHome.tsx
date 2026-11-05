import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import Avatar from "@/components/intents-home/Avatar";
import IntentAgentPanel, { AgentPanelHead } from "@/components/intents-home/IntentAgentPanel";
import { RANK, STAGE_META, filterOf, intentColor, personKey, type Entry, type Filter, type HomeIntent } from "@/components/intents-home/stages";
import { useAuthContext } from "@/contexts/AuthContext";
import { useIntents, useNegotiations } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { isNotFoundError } from "@/lib/api";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";
import { intentTitle } from "@/lib/intent-display";
import { INVITE_URL, buildInviteMessage, emailFromSocials, inviteEmailHref, inviteSubject, inviteXHref } from "@/lib/invite";
import { resolveSocials } from "@/lib/socials";
import type { ConversationSummary } from "@/services/conversation";
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

const labelOf = (intent: HomeIntent) => intentTitle((intent.summary?.trim() || intent.payload).trim());

/** The first text part of a message, for a one-line preview. */
function previewOf(conv: ConversationSummary) {
  for (const part of conv.lastMessage?.parts ?? []) {
    if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
      return (part as { text: string }).text;
    }
  }
  return "";
}

/**
 * The inbox and an intent, as one page beside the rail (AppFrame): the people
 * in sections (waiting on you, in progress, closed), and on the right your
 * agent. `selectedId` is undefined for the inbox, which also lists unread
 * replies and lets you pick a person to talk to your agent about.
 */
export default function IntentsHome({ selectedId }: { selectedId?: string }) {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const intentsService = useIntents();
  const { conversations } = useConversation();
  const { error: showError } = useNotifications();
  const {
    intents: visible, intentsLoaded, updateIntents, radar, radarFailed, loadRadar,
    entriesByIntent, opportunityActionLoading, handleOpportunityAction, waitingCount, waitingTotal,
  } = useIntentsData();

  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<{ key: string; mode: "log" | "invite" } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [shown, setShown] = useState<Record<Filter, boolean>>({ matches: true, "in progress": true, closed: false });
  /** Inbox only: the person whose agent conversation is open on the right. */
  const [picked, setPicked] = useState<string | null>(null);
  /** Inbox only: an intent opened from the agent overview, with nobody picked. */
  const [agentIntent, setAgentIntent] = useState<string | null>(null);
  const [statusPending, setStatusPending] = useState<string | null>(null);
  const [archiveArmed, setArchiveArmed] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const archiveTimer = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Each page starts on its own defaults: the inbox is a to-do list, so work
  // already moving and closed people start folded away.
  useEffect(() => {
    setOpen(null);
    setPicked(null);
    setAgentIntent(null);
    setShown({ matches: true, "in progress": !!selectedId, closed: false });
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

  // The inbox groups by person: one row, a tag per intent, the best stage leads.
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

  // Both pages show the same sections, in the same order.
  const sections = useMemo(() => {
    const sorted = [...pool].sort((a, b) => RANK[a.entries[0].stage] - RANK[b.entries[0].stage] || b.intentCount - a.intentCount);
    const out: Record<Filter, Person[]> = { matches: [], "in progress": [], closed: [] };
    for (const person of sorted) out[filterOf(person.entries[0].stage)].push(person);
    return out;
  }, [pool]);

  const chatPeers = useMemo(() => {
    const ids = new Set<string>();
    for (const conv of conversations) {
      for (const participant of conv.participants ?? []) {
        if (participant.participantType === "user" && participant.participantId !== user?.id) ids.add(participant.participantId);
      }
    }
    return ids;
  }, [conversations, user?.id]);

  /** Inbox: people chats with something unread, newest first. */
  const replies = useMemo(() => conversations
    .filter((conv) => isVisibleH2HConversation(conv) && conv.unreadCount > 0)
    .sort((a, b) => Date.parse(b.lastMessageAt ?? b.createdAt) - Date.parse(a.lastMessageAt ?? a.createdAt)),
  [conversations]);

  const intentById = useCallback((id: string) => visible.find((intent) => intent.id === id), [visible]);
  const intentLabel = (id: string) => {
    const intent = intentById(id);
    return intent ? labelOf(intent) : "";
  };

  const act = (person: Person, action: "accepted" | "rejected") => {
    // In the inbox, a decision applies to every intent where they are waiting on you.
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

  // The agent can point at a match from its chat: open that person's log.
  const selectMatch = useCallback((opportunityId: string) => {
    if (selectedId) {
      const entry = (entriesByIntent[selectedId] ?? []).find((e) => e.item.opportunityId === opportunityId);
      if (!entry) return;
      setShown((prev) => ({ ...prev, [filterOf(entry.stage)]: true }));
      setOpen({ key: `${entry.intentId}:${opportunityId}`, mode: "log" });
      return;
    }
    for (const entries of Object.values(entriesByIntent)) {
      const entry = entries.find((e) => e.item.opportunityId === opportunityId);
      if (!entry) continue;
      setShown((prev) => ({ ...prev, [filterOf(entry.stage)]: true }));
      setPicked(personKey(entry.item));
      return;
    }
  }, [selectedId, entriesByIntent]);

  // Clicking a row's blank space picks the person; its buttons and links keep their own jobs.
  const pickFrom = (person: Person) => (event: MouseEvent | KeyboardEvent) => {
    if (selectedId) return;
    if ((event.target as HTMLElement).closest("button, a, textarea, input")) return;
    if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setPicked((prev) => (prev === person.key ? null : person.key));
  };

  const renderRow = (person: Person) => {
    const lead = person.entries[0];
    const rowKey = selectedId ? person.key : `${lead.intentId}:${lead.item.opportunityId}`;
    const meta = STAGE_META[lead.stage];
    const blurb = lead.item.headline || lead.item.mainText || "";
    const busy = person.entries.some((e) => opportunityActionLoading[e.item.opportunityId]);
    const hasChat = !!person.userId && chatPeers.has(person.userId) && !person.notOnIndex;
    const isOpen = open?.key === rowKey;
    const isPicked = !selectedId && picked === person.key;
    return (
      <div key={person.key} className={`ih-row${isPicked ? " picked" : ""}${selectedId ? "" : " pickable"}`}>
        <div
          className="ih-row-main"
          onClick={pickFrom(person)}
          onKeyDown={pickFrom(person)}
          {...(selectedId ? {} : { role: "button", tabIndex: 0, "aria-pressed": isPicked, "aria-label": `Ask your agent about ${person.name}` })}
        >
          <Avatar name={person.name} photo={person.avatar} />
          <div className="ih-row-text">
            <div className="ih-name-line">
              {person.userId
                ? <Link to={`/u/${person.userId}`} className="ih-name">{person.name}</Link>
                : <span className="ih-name">{person.name}</span>}
              {!selectedId && (expanded.has(person.key) ? person.entries : [lead]).map((entry) => (
                <button key={entry.intentId} type="button" className="ih-tag" title={intentById(entry.intentId)?.payload} onClick={() => navigate(`/i/${entry.intentId}`)}>
                  <span className="ih-tag-swatch" style={{ background: intentColor(entry.intentId) }} />
                  {intentLabel(entry.intentId)}
                </button>
              ))}
              {!selectedId && person.entries.length > 1 && (
                <button type="button" className="ih-tag ih-more" onClick={() => toggleExpanded(person.key)}>
                  {expanded.has(person.key) ? "less" : `+${person.entries.length - 1} more`}
                </button>
              )}
              {selectedId && person.intentCount > 1 && <span className="ih-pill">{person.intentCount} intents</span>}
              {person.notOnIndex && <span className="ih-pill" style={{ color: "var(--ih-muted)" }}>not on index</span>}
            </div>
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
            intent={intentById(lead.intentId)?.payload}
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

  const loadingPeople = selectedId ? !radar[selectedId] && !radarFailed[selectedId] : visible.some((intent) => !radar[intent.id] && !radarFailed[intent.id]);
  const peopleFailed = selectedId ? radarFailed[selectedId] && !radar[selectedId] : false;
  const liveIntents = visible.filter((intent) => (intent.status || "").toLowerCase() !== "paused");

  const waitingEmpty = selectedId
    ? (paused && pool.length === 0 ? "this intent is paused, so your agent isn't looking right now." : "nothing waiting on you here. your agent is still looking.")
    : (intentsLoaded && !visible.length ? "no intents yet. start one and your agent goes looking." : "nothing waiting on you.");
  // Caught up on this intent: point at the next one that has someone waiting.
  const nextWaiting = selectedId && !sections.matches.length
    ? visible.find((intent) => intent.id !== selectedId && waitingCount(intent.id) > 0)
    : undefined;

  const section = (key: Filter, label: string, foldable: boolean) => {
    const people = sections[key];
    if (key !== "matches" && !people.length) return null;
    const isShown = shown[key] || !foldable;
    return (
      <div key={key}>
        {foldable ? (
          <button type="button" className="ih-bar ih-bar-toggle" aria-expanded={isShown} onClick={() => setShown((prev) => ({ ...prev, [key]: !prev[key] }))}>
            <span>{label}</span>
            <span className="ih-n">{isShown ? `${people.length} · hide` : `${people.length} · show`}</span>
          </button>
        ) : (
          <div className="ih-bar"><span>{label}</span>{people.length > 0 && <span className="ih-n">{people.length}</span>}</div>
        )}
        {isShown && (people.length ? people.map(renderRow) : key === "matches" && (
          <div className="ih-empty">
            {waitingEmpty}
            {nextWaiting && (
              <button type="button" className="ih-next" onClick={() => navigate(`/i/${nextWaiting.id}`)}>
                next: {labelOf(nextWaiting)} · {waitingCount(nextWaiting.id)} waiting ›
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  const peopleColumn = (
    <section className="ih-people">
      {peopleFailed ? (
        <div className="ih-empty">
          couldn&apos;t load people. <button type="button" className="ih-link" onClick={() => selectedId && void loadRadar(selectedId)}>try again</button>
        </div>
      ) : loadingPeople && !pool.length ? (
        <div className="ih-empty">loading…</div>
      ) : (
        <>
          {section("matches", "WAITING ON YOU", false)}
          {!selectedId && replies.length > 0 && (
            <div>
              <div className="ih-bar"><span>REPLIES</span><span className="ih-n">{replies.length}</span></div>
              {replies.map((conv) => {
                const peer = conv.participants.find((p) => p.participantId !== user?.id) ?? conv.participants[0];
                const via = conv.via?.[0];
                return (
                  <div key={conv.id} className="ih-row">
                    <div className="ih-row-main">
                      <Avatar name={peer?.name || "someone"} photo={peer?.avatar} />
                      <div className="ih-row-text">
                        <div className="ih-name-line">
                          <span className="ih-name">{peer?.name || "someone"}</span>
                          {via && (
                            <button type="button" className="ih-tag" onClick={() => navigate(`/i/${via.intentId}`)}>
                              <span className="ih-tag-swatch" style={{ background: intentColor(via.intentId) }} />
                              {intentLabel(via.intentId) || via.title}
                            </button>
                          )}
                        </div>
                        <div className="ih-blurb">{previewOf(conv) || `${conv.unreadCount} new`}</div>
                      </div>
                      <div className="ih-row-actions">
                        <button type="button" className="ih-accept" onClick={() => navigate(`/chat/${conv.id}`)}>reply</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {section("in progress", "IN PROGRESS", true)}
          {section("closed", "CLOSED", true)}
        </>
      )}
    </section>
  );

  // Inbox: the agent panel follows the picked person; with nobody picked it
  // gives an overview of what the agent is working on.
  const pickedPerson = !selectedId && picked ? pool.find((person) => person.key === picked) : undefined;
  const inboxAgentIntent = pickedPerson ? pickedPerson.entries[0].intentId : agentIntent;
  const inboxAgentIntentObj = inboxAgentIntent ? intentById(inboxAgentIntent) : undefined;
  const backToOverview = (
    <button type="button" className="ih-link" onClick={() => { setPicked(null); setAgentIntent(null); }}>overview</button>
  );
  const inboxAgent = inboxAgentIntent && inboxAgentIntentObj ? (
    <IntentAgentPanel
      key={inboxAgentIntent}
      intentId={inboxAgentIntent}
      paused={(inboxAgentIntentObj.status || "").toLowerCase() === "paused"}
      onSelectMatch={selectMatch}
      scope={<>
        <span className="ih-tag-swatch" style={{ background: intentColor(inboxAgentIntent) }} />
        {pickedPerson ? `about ${pickedPerson.name.split(/\s+/)[0]} · ` : ""}{labelOf(inboxAgentIntentObj)}
      </>}
      actions={backToOverview}
    />
  ) : (
    <div className="ih-agent" data-testid="inbox-agent-overview">
      <AgentPanelHead sub={visible.length ? `working on ${liveIntents.length} of ${visible.length} intents` : undefined} />
      <div className="ih-agent-body">
        {visible.length ? (
          <>
            <div className="ih-mono-sm">pick someone on the left to ask me about them, or open what I&apos;m doing for one intent.</div>
            <div className="ih-overview">
              {visible.map((intent) => {
                const waiting = waitingCount(intent.id);
                const isPaused = (intent.status || "").toLowerCase() === "paused";
                return (
                  <button key={intent.id} type="button" className={`ih-overview-row${isPaused ? " paused" : ""}`} onClick={() => setAgentIntent(intent.id)}>
                    <span className="ih-tag-swatch" style={{ background: intentColor(intent.id) }} />
                    <span className="ih-overview-text">{intent.payload?.trim() || labelOf(intent)}</span>
                    <span className="ih-overview-meta">{isPaused ? "paused" : waiting ? <b>{waiting} waiting</b> : "looking"} · chat ›</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="ih-mono-sm">start an intent and I&apos;ll go looking for the people it needs.</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="ih-view">
      <header className="ih-head">
        {selectedId ? (
          current ? (
            <>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="ih-eyebrow"><span className="ih-tag-swatch" style={{ background: intentColor(current.id) }} />INTENT</div>
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
          )
        ) : (
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="ih-eyebrow">INBOX</div>
            <h1 className="ih-title">
              {waitingTotal === 1 ? "1 person is waiting on you" : waitingTotal > 1 ? `${waitingTotal} people are waiting on you` : "you're all caught up"}
            </h1>
            <div className="ih-status">
              {visible.length ? `${liveIntents.length} intent${liveIntents.length === 1 ? "" : "s"} live` : "no intents yet"}
              {replies.length > 0 && ` · ${replies.length} unread repl${replies.length === 1 ? "y" : "ies"}`}
            </div>
          </div>
        )}
      </header>

      {(!selectedId || current) && (
        <div className="ih-cols">
          {peopleColumn}
          {selectedId && current
            ? <IntentAgentPanel key={selectedId} intentId={selectedId} paused={paused} onSelectMatch={selectMatch} />
            : inboxAgent}
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
