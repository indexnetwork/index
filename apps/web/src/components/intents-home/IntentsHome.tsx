import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import "@/styles/plain.css";
import { useAgentWindow } from "@/components/intents-home/agentWindowContext";
import { RANK, filterOf, personKey, type Entry, type Filter, type HomeIntent } from "@/components/intents-home/stages";
import UserAvatar from "@/components/UserAvatar";
import { TheirAgentAvatar } from "@/components/workbench/agent-avatar";
import { useAuthContext } from "@/contexts/AuthContext";
import { useIntents } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { isNotFoundError } from "@/lib/api";
import { INVITE_URL, buildInviteMessage, emailFromSocials, inviteEmailHref, inviteSubject, inviteXHref } from "@/lib/invite";
import { resolveSocials } from "@/lib/socials";
import type { RadarCardItem } from "@/services/opportunities";
import { getPublicUserProfile } from "@/services/users";

interface Person {
  key: string;
  userId?: string;
  name: string;
  avatar?: string | null;
  notOnIndex: boolean;
  /** Where this person shows up for this intent. */
  entries: Entry[];
  /** How many of the user's intents this person appears in. */
  intentCount: number;
}

/**
 * One intent, drawn like Home: the intent as the page's title, then the
 * people my agent found for it in Home's sections and cards. This intent's
 * agent chat is the full-height window on the right (see AppFrame); a card
 * opens that match in its place until it's closed.
 */
export default function IntentsHome({ selectedId }: { selectedId: string }) {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const intentsService = useIntents();
  const { conversations } = useConversation();
  const { error: showError } = useNotifications();
  const { log, setLog } = useAgentWindow();
  const {
    intents: visible, intentsLoaded, updateIntents, radar, radarFailed, loadRadar,
    entriesByIntent, opportunityActionLoading, handleOpportunityAction,
  } = useIntentsData();

  const [missing, setMissing] = useState(false);
  const [inviteFor, setInviteFor] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [statusPending, setStatusPending] = useState<string | null>(null);
  const [archiveArmed, setArchiveArmed] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const archiveTimer = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // The page is keyed by intent (see app/i/[intentId]), so a different one starts fresh.
  useEffect(() => () => { if (archiveTimer.current) window.clearTimeout(archiveTimer.current); }, []);

  const current = visible.find((intent) => intent.id === selectedId);

  // A deep link (or a just-created intent) can be missing from the list; read it directly.
  useEffect(() => {
    if (!intentsLoaded || current) return;
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

  // Everyone found for this intent, in Home's sections, best stage first.
  const sections = useMemo(() => {
    const out: Record<Filter, Person[]> = { matches: [], "in progress": [], closed: [] };
    const people = (entriesByIntent[selectedId] ?? []).map((entry): Person => ({
      key: `${entry.intentId}:${entry.item.opportunityId}`,
      userId: entry.item.userId || entry.item.peer?.userId,
      name: entry.item.name || entry.item.peer?.name || "unknown",
      avatar: entry.item.avatar ?? entry.item.peer?.avatar,
      notOnIndex: entry.item.peer?.emailVerified === false,
      entries: [entry],
      intentCount: intentCountByPerson.get(personKey(entry.item)) ?? 1,
    }));
    people.sort((a, b) => RANK[a.entries[0].stage] - RANK[b.entries[0].stage] || b.intentCount - a.intentCount);
    for (const person of people) out[filterOf(person.entries[0].stage)].push(person);
    return out;
  }, [selectedId, entriesByIntent, intentCountByPerson]);

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
    for (const entry of person.entries.filter((e) => e.stage === "awaiting")) {
      if (opportunityActionLoading[entry.item.opportunityId]) continue;
      void handleOpportunityAction(entry.item.opportunityId, action, person.userId, {
        notOnIndex: person.notOnIndex,
        scope: { intentId: entry.intentId },
      }).then(() => loadRadar(entry.intentId));
    }
  };

  const openMatch = (person: Person) => {
    const lead = person.entries[0];
    setLog({
      opportunityId: lead.item.opportunityId,
      intentId: lead.intentId,
      name: person.name,
      userId: person.userId,
      avatar: person.avatar,
      notOnIndex: person.notOnIndex,
      entries: person.entries,
    });
  };

  const renderCard = (person: Person) => {
    const lead = person.entries[0];
    const stage = lead.stage;
    const blurb = lead.item.headline || lead.item.mainText || "";
    const busy = person.entries.some((e) => opportunityActionLoading[e.item.opportunityId]);
    const hasChat = !!person.userId && chatPeers.has(person.userId) && !person.notOnIndex;
    const on = log?.opportunityId === lead.item.opportunityId;
    const inviting = inviteFor === person.key;
    const chip = stage === "talks" ? { tone: "talks", text: "agents talking" }
      : stage === "chat" ? { tone: "chat", text: person.notOnIndex ? "not on index yet" : "chat open" }
        : stage === "closed" ? { tone: "paused", text: lead.item.status === "rejected" ? "not a fit" : "missed" }
          : null;
    const tone = stage === "talks" ? " talks" : stage === "chat" ? " live" : stage === "closed" ? " paused" : "";
    const face = stage === "awaiting"
      ? <UserAvatar id={person.userId ?? person.key} name={person.name} avatar={person.avatar} size={36} />
      : <TheirAgentAvatar owner={{ id: person.userId ?? person.key, name: person.name, photo: person.avatar }} size={36} />;
    return (
      <li key={person.key} className={`pl-card${tone} pl-card-open${on ? " on" : ""}`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a, button, textarea, input")) return;
          if (on) setLog(null); else openMatch(person);
        }}>
        {person.userId ? <Link to={`/u/${person.userId}`} className="pl-card-face" title={`${person.name}'s profile`}>{face}</Link> : face}
        <div className="pl-card-body">
          <div className="pl-card-head">
            <span>
              <b>{person.userId ? <Link to={`/u/${person.userId}`} className="pl-name" title={`${person.name}'s profile`}>{person.name}</Link> : person.name}</b>
              {person.notOnIndex && stage !== "chat" && <span className="pl-dim"> (not on index)</span>}
              {person.intentCount > 1 && <span className="pl-dim"> · in {person.intentCount} of your intents</span>}
            </span>
            {chip && <span className={`pl-status ${chip.tone}`}>{chip.text}</span>}
          </div>
          {blurb
            ? <div className="pl-blurb">{blurb}</div>
            : lead.item.presentationPending && <div className="pl-blurb pl-dim">I&apos;m still writing this up<span className="pl-blink">_</span></div>}
          <div className="pl-actions">
            {stage === "awaiting" && hasChat ? (
              <button type="button" className="go" onClick={() => navigate(`/u/${person.userId}/chat`)}>open chat</button>
            ) : stage === "awaiting" ? (
              <>
                <button type="button" className="go" disabled={busy} onClick={() => act(person, "accepted")}>accept</button>{" "}
                <button type="button" disabled={busy} onClick={() => act(person, "rejected")}>pass</button>
              </>
            ) : stage === "chat" && person.notOnIndex ? (
              <button type="button" aria-pressed={inviting} onClick={() => setInviteFor(inviting ? null : person.key)}>send invite</button>
            ) : stage === "chat" && person.userId ? (
              <button type="button" className="go" onClick={() => navigate(`/u/${person.userId}/chat`)}>go to chat</button>
            ) : (
              <button type="button" onClick={() => openMatch(person)}>read the log</button>
            )}
          </div>
          {inviting && (
            <InviteLog
              key={lead.item.opportunityId}
              item={lead.item}
              name={person.name}
              intent={current?.payload}
              senderName={user?.name}
            />
          )}
        </div>
      </li>
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
      setLog(null);
      navigate("/intents");
    } catch {
      showError("couldn't archive this intent.");
    } finally {
      if (mountedRef.current) setArchiving(false);
    }
  };

  const loadingPeople = !radar[selectedId] && !radarFailed[selectedId];
  const peopleFailed = radarFailed[selectedId] && !radar[selectedId];
  const found = sections.matches.length + sections["in progress"].length + sections.closed.length;
  const created = current?.createdAt
    ? ` · since ${new Date(current.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "";

  return (
    <div className="ih-view pl">
      <div className="pl-col">
        {/* It's all about the intent: back and the buttons share the top line, so the intent gets the column's full width. */}
        <header className="ih-head pl-intent-head">
          <div className="pl-intent-top">
            <button type="button" className="pl-back ih-head-back" onClick={() => navigate("/intents")}>◂ intents</button>
            {current && (
              <div className="ih-actions">
                <button type="button" disabled={!!statusPending} onClick={() => void togglePause()}>{paused ? "▶ resume" : "❚❚ pause"}</button>
                <button type="button" className={`danger${archiveArmed || archiving ? " on" : ""}`} disabled={archiving} onClick={() => void clickArchive()}>
                  {archiving ? "archiving…" : archiveArmed ? "archive, sure?" : "archive"}
                </button>
              </div>
            )}
          </div>
          <h1 className="ih-title">
            {current ? (current.payload?.trim() || current.summary?.trim() || "your intent") : missing ? "this intent doesn't exist or was removed." : "loading…"}
          </h1>
          {current && (
            <div className="ih-status">
              <span className="ih-status-dot" style={{ background: paused ? "var(--ih-closed)" : "var(--ih-live)" }} />
              <span style={{ flex: 1, minWidth: 0 }}>{paused ? "paused, your agent isn't looking" : "live, your agent is looking in the background"}{created}</span>
            </div>
          )}
        </header>

        {current && (
          <div className="pl-page">
            {peopleFailed ? (
              <p>couldn&apos;t load people. <button type="button" onClick={() => void loadRadar(selectedId)}>try again</button></p>
            ) : loadingPeople && found === 0 ? (
              <p className="pl-dim">loading…</p>
            ) : (
              <>
                <h2>waiting on you ({sections.matches.length})</h2>
                {sections.matches.length > 0 ? (
                  <ul className="pl-cards">{sections.matches.map(renderCard)}</ul>
                ) : (
                  <p className="pl-dim">
                    {found > 0 ? "nobody waiting on you." : paused ? "this intent is paused, so your agent isn't looking right now." : "nobody yet. your agent is still looking."}
                  </p>
                )}

                {sections["in progress"].length > 0 && (
                  <>
                    <hr />
                    <h2>in progress ({sections["in progress"].length})</h2>
                    <ul className="pl-cards">{sections["in progress"].map(renderCard)}</ul>
                  </>
                )}

                {sections.closed.length > 0 && (
                  <>
                    <hr />
                    <h2>closed ({sections.closed.length})</h2>
                    {showClosed
                      ? <ul className="pl-cards">{sections.closed.map(renderCard)}</ul>
                      : <p><button type="button" onClick={() => setShowClosed(true)}>show closed</button></p>}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
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
    <div className="pl-invite">
      <p className="pl-dim pl-small">{first} isn&apos;t on index yet, so there&apos;s no chat to open. send an invite and pick it up here once they join.</p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={6}
        aria-label="Invite message"
      />
      <div className="pl-actions">
        {x && <button type="button" className="go" title={`Opens an X message. Pick @${x.handle} as the recipient.`} onClick={() => window.open(inviteXHref(message), "_blank", "noopener,noreferrer")}>send on X</button>}
        {email && <button type="button" className={x ? undefined : "go"} onClick={() => { window.location.href = inviteEmailHref({ to: email, subject: inviteSubject(senderName), body: message }); }}>email</button>}
        <button type="button" className={x || email ? undefined : "go"} onClick={copy}>{copied ? "copied" : "copy invite link"}</button>
      </div>
    </div>
  );
}
