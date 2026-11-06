import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import Avatar from "@/components/intents-home/Avatar";
import { RANK, STAGE_META, filterOf, intentColor, personKey, type Entry, type Filter, type HomeIntent } from "@/components/intents-home/stages";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNegotiations } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { intentTitle } from "@/lib/intent-display";
import { INVITE_URL, buildInviteMessage, emailFromSocials, inviteEmailHref, inviteSubject, inviteXHref } from "@/lib/invite";
import { resolveSocials } from "@/lib/socials";
import type { NegotiationDetail } from "@/services/negotiations";
import type { RadarCardItem } from "@/services/opportunities";
import { getPublicUserProfile } from "@/services/users";

export interface Person {
  key: string;
  userId?: string;
  name: string;
  avatar?: string | null;
  notOnIndex: boolean;
  /** Every intent this person was found for, best stage first. */
  entries: Entry[];
}

export const labelOf = (intent: HomeIntent) => intentTitle((intent.summary?.trim() || intent.payload).trim());
export const sentenceOf = (intent: HomeIntent) => intent.payload?.trim() || intent.summary?.trim() || "your intent";
export const isPaused = (intent?: HomeIntent) => (intent?.status || "").toLowerCase() === "paused";

/**
 * Everyone your agent found, one row per person across intents, in the three
 * sections every list uses. `intentId` narrows it to the people found for one intent.
 */
export function usePeople(intentId?: string | null) {
  const { entriesByIntent } = useIntentsData();
  return useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const entries of Object.values(entriesByIntent)) {
      for (const entry of entries) {
        const key = personKey(entry.item);
        groups.set(key, [...(groups.get(key) ?? []), entry]);
      }
    }
    const people: Person[] = [];
    for (const [key, all] of groups) {
      const entries = (intentId ? all.filter((entry) => entry.intentId === intentId) : all)
        .sort((a, b) => RANK[a.stage] - RANK[b.stage]);
      if (!entries.length) continue;
      const item = entries[0].item;
      people.push({
        key,
        userId: item.userId || item.peer?.userId,
        name: item.name || item.peer?.name || "unknown",
        avatar: item.avatar ?? item.peer?.avatar,
        notOnIndex: item.peer?.emailVerified === false,
        entries,
      });
    }
    people.sort((a, b) => RANK[a.entries[0].stage] - RANK[b.entries[0].stage] || b.entries.length - a.entries.length);
    const sections: Record<Filter, Person[]> = { matches: [], "in progress": [], closed: [] };
    for (const person of people) sections[filterOf(person.entries[0].stage)].push(person);
    return { people, sections };
  }, [entriesByIntent, intentId]);
}

/** People you already have a chat with, so a match with them opens it instead of asking again. */
function useChatPeers() {
  const { user } = useAuthContext();
  const { conversations } = useConversation();
  return useMemo(() => {
    const ids = new Set<string>();
    for (const conv of conversations) {
      for (const participant of conv.participants ?? []) {
        if (participant.participantType === "user" && participant.participantId !== user?.id) ids.add(participant.participantId);
      }
    }
    return ids;
  }, [conversations, user?.id]);
}

/** A small coloured chip naming an intent; it opens that intent's people. */
export function IntentTag({ intentId, fallback }: { intentId: string; fallback?: string }) {
  const navigate = useNavigate();
  const { intents } = useIntentsData();
  const intent = intents.find((i) => i.id === intentId);
  return (
    <button type="button" className="ih-tag" title={intent?.payload} onClick={() => navigate(`/opportunities?intent=${intentId}`)}>
      <span className="ih-tag-swatch" style={{ background: intentColor(intentId) }} />
      {intent ? labelOf(intent) : fallback || "intent"}
    </button>
  );
}

/**
 * One person: who they are, every intent they came up for, and what you can
 * do next. Accept and pass apply to every intent where they wait on you.
 */
export function PersonRow({ person, highlight = false, initiallyOpen = false }: { person: Person; highlight?: boolean; initiallyOpen?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { intents, opportunityActionLoading, handleOpportunityAction, loadRadar } = useIntentsData();
  const chatPeers = useChatPeers();
  const [open, setOpen] = useState<"log" | "invite" | null>(initiallyOpen ? "log" : null);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight || initiallyOpen) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, initiallyOpen]);

  const lead = person.entries[0];
  const meta = STAGE_META[lead.stage];
  const blurb = lead.item.headline || lead.item.mainText || "";
  const busy = person.entries.some((e) => opportunityActionLoading[e.item.opportunityId]);
  const hasChat = !!person.userId && chatPeers.has(person.userId) && !person.notOnIndex;
  const toggle = (mode: "log" | "invite") => setOpen((prev) => (prev === mode ? null : mode));
  const act = useCallback((action: "accepted" | "rejected") => {
    for (const entry of person.entries.filter((e) => e.stage === "awaiting")) {
      if (opportunityActionLoading[entry.item.opportunityId]) continue;
      void handleOpportunityAction(entry.item.opportunityId, action, person.userId, {
        notOnIndex: person.notOnIndex,
        scope: { intentId: entry.intentId },
      }).then(() => loadRadar(entry.intentId));
    }
  }, [person, opportunityActionLoading, handleOpportunityAction, loadRadar]);

  return (
    <div ref={ref} className={`ih-row${highlight ? " picked" : ""}`} data-person={person.key}>
      <div className="ih-row-main">
        <Avatar name={person.name} photo={person.avatar} />
        <div className="ih-row-text">
          <div className="ih-name-line">
            {person.userId
              ? <Link to={`/u/${person.userId}`} className="ih-name">{person.name}</Link>
              : <span className="ih-name">{person.name}</span>}
            {(expanded ? person.entries : [lead]).map((entry) => <IntentTag key={entry.intentId} intentId={entry.intentId} />)}
            {person.entries.length > 1 && (
              <button type="button" className="ih-tag ih-more" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "less" : `+${person.entries.length - 1} more`}
              </button>
            )}
            {person.notOnIndex && <span className="ih-pill" style={{ color: "var(--ih-muted)" }}>not on index</span>}
          </div>
          <div className={`ih-blurb${!blurb ? " pending" : ""}`}>{blurb || (lead.item.presentationPending ? "…" : "")}</div>
        </div>
        <div className="ih-row-actions">
          {lead.stage === "awaiting" && hasChat ? (
            <button type="button" className="ih-accept" onClick={() => navigate(`/u/${person.userId}/chat`)}>open chat</button>
          ) : lead.stage === "awaiting" ? (
            <>
              <button type="button" className="ih-accept" disabled={busy} onClick={() => act("accepted")}>accept</button>
              <button type="button" className="ih-pass" disabled={busy} onClick={() => act("rejected")}>pass</button>
            </>
          ) : (
            <>
              <span className={`ih-state${lead.stage === "closed" ? " closed" : ""}`}>
                <span className="ih-state-dot" style={{ background: meta.dot }} />
                {lead.stage === "closed" && lead.item.status === "rejected" ? "not a fit" : meta.label}
              </span>
              {lead.stage === "chat" && (person.notOnIndex
                ? <button type="button" className="ih-link" onClick={() => toggle("invite")}>{open === "invite" ? "HIDE INVITE ▴" : "INVITE ›"}</button>
                : person.userId && <button type="button" className="ih-link" onClick={() => navigate(`/u/${person.userId}/chat`)}>CHAT ›</button>)}
              <button type="button" className="ih-link" onClick={() => toggle("log")}>
                {open === "log" ? "HIDE LOG ▴" : "AGENT LOG ›"}
              </button>
            </>
          )}
        </div>
      </div>
      {open === "log" && <AgentLog opportunityId={lead.item.opportunityId} name={person.name} />}
      {open === "invite" && (
        <InviteLog
          key={lead.item.opportunityId}
          item={lead.item}
          name={person.name}
          intent={intents.find((i) => i.id === lead.intentId)?.payload}
          senderName={user?.name}
        />
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
