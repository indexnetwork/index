import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import "@/styles/intents-home.css";
import "@/styles/plain.css";
import { useAgentWindow } from "@/components/intents-home/agentWindowContext";
import { RANK, filterOf, personKey, type Entry, type Filter, type HomeIntent } from "@/components/intents-home/stages";
import UserAvatar from "@/components/UserAvatar";
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
import { Placeholder } from "@/components/ui/Placeholder";
import { useShowMore } from "@/components/ui/ShowMore";
import { PageView, ListHead } from "@/components/intents-home/SplitView";
import QuestionCard from "@/components/intents-home/QuestionCard";
import { usePersonalQuestions } from "@/components/intents-home/usePersonalQuestions";
import { useUndo } from "@/components/intents-home/undo";

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
 * One intent, drawn like Home: the intent as the page's title, then its
 * questions and the people my agent found for it in Home's sections and
 * cards. This intent's agent docks on the right (see AppFrame); a card opens
 * that match in its place until it's closed.
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

  const later = useUndo();
  const { questions: allQuestions, answer } = usePersonalQuestions();
  // This intent's questions sit on top of its matches, the same cards as Home's.
  const questions = allQuestions.filter((question) => question.intentIds.includes(selectedId));
  const [missing, setMissing] = useState(false);
  const [inviteFor, setInviteFor] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [statusPending, setStatusPending] = useState<string | null>(null);
  const [archiveArmed, setArchiveArmed] = useState(false);
  const [archiving] = useState(false);
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

  const [passed, setPassed] = useState<Set<string>>(() => new Set());
  const act = (person: Person, action: "accepted" | "rejected") => {
    const send = () => {
      for (const entry of person.entries.filter((e) => e.stage === "awaiting")) {
        if (opportunityActionLoading[entry.item.opportunityId]) continue;
        void handleOpportunityAction(entry.item.opportunityId, action, person.userId, {
          notOnIndex: person.notOnIndex,
          scope: { intentId: entry.intentId },
        }).then(() => loadRadar(entry.intentId));
      }
    };
    if (action === "accepted") { send(); return; }
    // A pass waits a few seconds behind "undo"; the card steps aside meanwhile.
    setPassed((prev) => new Set(prev).add(person.key));
    later(`passed on ${person.name.split(" ")[0]}`, send, () => setPassed((prev) => { const next = new Set(prev); next.delete(person.key); return next; }));
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
    const inviting = inviteFor === person.key;
    const chip = stage === "talks" ? "agents talking"
      : stage === "chat" ? (person.notOnIndex ? "not on index yet" : "chat open")
        : stage === "closed" ? (lead.item.status === "rejected" ? "not a fit" : "missed")
          : null;
    return (
      <div key={person.key} data-sv-item={person.key} className={`sv-card${stage === "closed" ? " closed" : ""}${log?.opportunityId === lead.item.opportunityId ? " on" : ""}`}
        onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button, textarea, input")) openMatch(person); }}>
        <UserAvatar id={person.userId ?? person.key} name={person.name} avatar={person.avatar} size={36} />
        <div className="sv-card-body">
          <div className="sv-mrow">
            <b>{person.name}</b>
            {person.notOnIndex && stage !== "chat" && <span className="sv-via"> · not on index</span>}
            {person.intentCount > 1 && <span className="sv-via"> · in {person.intentCount} of your intents</span>}
            {chip && <span className="sv-mchip">{chip}</span>}
          </div>
          {blurb
            ? <div className="sv-blurb">{blurb}</div>
            : lead.item.presentationPending && <div className="sv-blurb"><Placeholder.Text lines={2} label="writing this up" /></div>}
          <div className="sv-actions">
            {stage === "awaiting" && hasChat ? (
              <button type="button" className="sv-btn go" onClick={() => navigate(`/u/${person.userId}/chat`)}>open chat</button>
            ) : stage === "awaiting" ? (
              <>
                <button type="button" className="sv-btn go" disabled={busy} onClick={() => act(person, "accepted")}>accept</button>
                <button type="button" className="sv-btn" disabled={busy} onClick={() => act(person, "rejected")}>pass</button>
              </>
            ) : stage === "chat" && person.notOnIndex ? (
              <button type="button" className="sv-btn" aria-pressed={inviting} onClick={() => setInviteFor(inviting ? null : person.key)}>send invite</button>
            ) : stage === "chat" && person.userId ? (
              <button type="button" className="sv-btn" onClick={() => navigate(`/u/${person.userId}/chat`)}>go to chat</button>
            ) : (
              <button type="button" className="sv-btn" onClick={() => openMatch(person)}>read the log</button>
            )}
          </div>
          {inviting && (
            <InviteLog key={lead.item.opportunityId} item={lead.item} name={person.name} intent={current?.payload} senderName={user?.name} />
          )}
        </div>
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

  const clickArchive = () => {
    if (!current || archiving) return;
    if (archiveTimer.current) window.clearTimeout(archiveTimer.current);
    if (!archiveArmed) {
      setArchiveArmed(true);
      archiveTimer.current = window.setTimeout(() => setArchiveArmed(false), 4000);
      return;
    }
    setArchiveArmed(false);
    // The intent leaves the list at once; the archive is sent a few seconds later unless undone.
    const gone = current;
    updateIntents((prev) => prev.filter((intent) => intent.id !== gone.id));
    setLog(null);
    navigate("/intents");
    later("intent archived", () => {
      intentsService.archiveIntent(gone.id).catch(() => {
        showError("couldn't archive this intent.");
        updateIntents((prev) => prev.some((i) => i.id === gone.id) ? prev : [gone, ...prev]);
      });
    }, () => {
      updateIntents((prev) => prev.some((i) => i.id === gone.id) ? prev : [gone, ...prev]);
      navigate(`/i/${gone.id}`);
    });
  };

  const loadingPeople = !radar[selectedId] && !radarFailed[selectedId];
  const peopleFailed = radarFailed[selectedId] && !radar[selectedId];
  const found = sections.matches.length + sections["in progress"].length + sections.closed.length;
  const matchList = useShowMore(sections.matches.filter((person) => !passed.has(person.key)));
  const progressList = useShowMore(sections["in progress"]);
  const closedList = useShowMore(sections.closed);
  const created = current?.createdAt
    ? `since ${new Date(current.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase()}`
    : "";

  const text = current ? (current.payload?.trim() || current.summary?.trim() || "your intent") : "";
  const waitingNow = matchList.shown.length;

  if (!current) {
    return (
      <PageView>
        <div className="sv-empty sv-page-gap">{missing ? "this intent doesn't exist or was removed." : <Placeholder.Text lines={2} title label="loading this intent" />}</div>
      </PageView>
    );
  }

  // A page like Home's: the intent as its title, then its questions and people.
  // Its agent docks on the right, and a person opened here takes its place (see AppFrame).
  return (
    <PageView
      title={<span className={text.length > 90 ? "sv-page-long" : undefined}>{text}</span>}
      actions={
        <span className="sv-actions">
          <button type="button" className="sv-btn sm" disabled={!!statusPending} onClick={() => void togglePause()}>{paused ? "▶ resume" : "❚❚ pause"}</button>
          <button aria-busy={archiving} type="button" className="sv-btn sm danger" disabled={archiving} onClick={clickArchive}>
            {archiving ? "archiving" : archiveArmed ? "archive, sure?" : "archive"}
          </button>
        </span>
      }
      sub={<><span className={`sv-sdot${paused ? " off" : ""}`} />{paused ? "paused, your agent isn't looking" : "live, your agent is looking in the background"}{created && <span> · {created}</span>}</>}
    >
      {questions.length > 0 && (
        <>
          <ListHead>questions · {questions.length}</ListHead>
          {questions.map((question) => <QuestionCard key={question.groupId} question={question} onAnswer={answer} />)}
        </>
      )}
      {peopleFailed ? (
        <div className="sv-empty sv-page-gap">couldn&apos;t load people. <button type="button" className="sv-link" onClick={() => void loadRadar(selectedId)}>try again</button></div>
      ) : loadingPeople && found === 0 ? (
        <div className="sv-empty sv-page-gap"><Placeholder.Rows count={3} label="loading people" /></div>
      ) : (
        <>
          <ListHead>waiting on you · {waitingNow}</ListHead>
          {waitingNow > 0 ? (
            <>{matchList.shown.map(renderCard)}{matchList.more}</>
          ) : (
            <div className="sv-empty">
              {found > 0 ? "good things are in the works. your agent is talking with people right now and will bring them to you as soon as they're ready." : paused ? "this intent is paused, so your agent isn't looking right now." : "nobody yet. your agent is still looking."}
            </div>
          )}
          {sections["in progress"].length > 0 && (
            <>
              <ListHead>in progress · {sections["in progress"].length}</ListHead>
              {progressList.shown.map(renderCard)}{progressList.more}
            </>
          )}
          {sections.closed.length > 0 && (
            showClosed ? (
              <>
                <ListHead>closed · {sections.closed.length}</ListHead>
                {closedList.shown.map(renderCard)}{closedList.more}
              </>
            ) : <button type="button" className="sv-more" onClick={() => setShowClosed(true)}>show {sections.closed.length} closed</button>
          )}
        </>
      )}
    </PageView>
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
