import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import "@/styles/intents-home.css";
import PageHead from "@/components/intents-home/PageHead";
import "@/styles/plain.css";
import { RANK, intentLabel, personKey, type Entry, type Stage } from "@/components/intents-home/stages";
import { useAgentWindow, type Decision } from "@/components/intents-home/agentWindowContext";
import { usePublishHomeSections } from "@/components/intents-home/homeSectionsContext";
import { focusedGroup, intentsToRefresh, type PersonalQuestion as AgentQuestion } from "@/components/intents-home/personal-questions";
import { usePersonalQuestions } from "@/components/intents-home/usePersonalQuestions";
import QuestionItem from "@/components/intents-home/QuestionItem";
import UserAvatar from "@/components/UserAvatar";
import { TheirAgentAvatar } from "@/components/workbench/agent-avatar";
import { useAuthContext } from "@/contexts/AuthContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { Placeholder } from "@/components/ui/Placeholder";
import { useShowMore } from "@/components/ui/ShowMore";

/** How often to reread an intent right after an answer, and for how long. */
const ANSWER_POLL_MS = 3_000;
const ANSWER_REFRESH_MS = 60_000;

interface Person {
  key: string;
  userId?: string;
  name: string;
  avatar?: string | null;
  notOnIndex: boolean;
  /** Every intent this person shows up in, best stage first. */
  entries: Entry[];
}

/** The line after the greeting; one is picked per page load. */
const HOME_STATUS_LINES = [
  "good things are taking shape.",
  "the world is rearranging around your intentions.",
  "an opportunity is taking shape.",
  "your next coincidence is in the making.",
  "possibilities are finding their way to you.",
  "your intentions are finding their counterparts.",
];
const HOME_STATUS_LINE = HOME_STATUS_LINES[Math.floor(Math.random() * HOME_STATUS_LINES.length)];

/**
 * Home: come in, answer your agents, see who they found, leave.
 * A plain page on purpose: text, links and native controls.
 */
export default function HomeDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { intents, intentsLoaded, radar, radarFailed, entriesByIntent, opportunityActionLoading, handleOpportunityAction, loadRadar } = useIntentsData();
  // The agent has its own window on the desktop (see AppFrame); Home only opens it.
  const { setOpen: toggleAgent, log: openLog, setLog, decisions, decide } = useAgentWindow();
  const withAgent = (page: ReactNode) => (
    <div className="ih-view pl">
      <div className="pl-col">
        <PageHead
          title={<>{user?.name ? `hi ${user.name.split(" ")[0].toLowerCase()}.` : "hi."} {HOME_STATUS_LINE}</>}
          centered
        >
          <button type="button" className="go" onClick={() => navigate("/i/new")}>+ new intent</button>
        </PageHead>
        {page}
      </div>
    </div>
  );

  const { questions, all: allQuestions, loaded: questionsLoaded, answer } = usePersonalQuestions();
  // A /q/<id> link lands here as ?q=<id>: that question's card is selected until answered.
  const [linkParams, setLinkParams] = useSearchParams();
  const linkedQuestion = linkParams.get("q");
  const linkedGroup = focusedGroup(questions, linkedQuestion);
  const staleLink = Boolean(linkedQuestion && questionsLoaded && !linkedGroup);
  useEffect(() => {
    if (linkedGroup) document.getElementById(`q-card-${linkedGroup}`)?.scrollIntoView({ block: "center" });
  }, [linkedGroup]);
  /** "for: …" under a card that stands for more than one intent. */
  const forLine = (question: AgentQuestion) => question.intentIds.length > 1
    ? `for: ${question.intentIds.map((id) => intentLabel(intents.find((intent) => intent.id === id))).filter(Boolean).join(", ")}`
    : undefined;

  // After an answer my agent goes back to work on that intent, so "in progress"
  // shows as loading until its people change (or a while passes), rereading
  // the intent every few seconds instead of waiting for the slow poll.
  const stagesOf = useCallback(
    (intentId: string) => (entriesByIntent[intentId] ?? []).map((e) => `${e.item.opportunityId}:${e.stage}`).sort().join(","),
    [entriesByIntent],
  );
  const [refreshing, setRefreshing] = useState<Record<string, string>>({});
  const refreshingIds = Object.keys(refreshing).filter((id) => refreshing[id] === stagesOf(id));
  const refreshKey = refreshingIds.join(",");
  useEffect(() => {
    if (!refreshKey) return;
    const ids = refreshKey.split(",");
    const poll = setInterval(() => { for (const id of ids) void loadRadar(id, "skeleton"); }, ANSWER_POLL_MS);
    const stop = setTimeout(() => setRefreshing({}), ANSWER_REFRESH_MS);
    return () => { clearInterval(poll); clearTimeout(stop); };
  }, [refreshKey, loadRadar]);
  const answerAndRefresh = async (intentId: string, questionId: string, text: string) => {
    // One answer reaches every intent in the question's group; each goes back to work.
    const touched = intentsToRefresh(allQuestions, questionId, intentId);
    await answer(intentId, questionId, text);
    if (linkedQuestion) setLinkParams((prev) => { const next = new URLSearchParams(prev); next.delete("q"); return next; }, { replace: true });
    setRefreshing((prev) => ({ ...prev, ...Object.fromEntries(touched.map((id) => [id, stagesOf(id)])) }));
    for (const id of touched) void loadRadar(id, "skeleton");
  };

  // One line per person, across intents; their best stage decides where they sit.
  const byStage = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const entries of Object.values(entriesByIntent)) {
      for (const entry of entries) {
        const key = personKey(entry.item);
        groups.set(key, [...(groups.get(key) ?? []), entry]);
      }
    }
    const out: Record<Stage, Person[]> = { awaiting: [], talks: [], chat: [], closed: [] };
    for (const [key, entries] of groups) {
      const sorted = [...entries].sort((a, b) => RANK[a.stage] - RANK[b.stage]);
      const item = sorted[0].item;
      out[sorted[0].stage].push({
        key,
        userId: item.userId || item.peer?.userId,
        name: item.name || item.peer?.name || "unknown",
        avatar: item.avatar ?? item.peer?.avatar,
        notOnIndex: item.peer?.emailVerified === false,
        entries: sorted,
      });
    }
    return out;
  }, [entriesByIntent]);

  const awaiting = byStage.awaiting;

  // People you accepted or passed on stay in their spot as a one-line note until the page
  // reloads, like LinkedIn's "invitation ignored". The decision itself lives with the
  // window on the right (it can be made there too); this keeps who it was and where.
  const [pinned, setPinned] = useState<Map<string, { person: Person; at: number } | null>>(() => new Map());
  const waitingRows = useMemo(() => {
    const rows: Array<{ person: Person; decision: Decision | null }> = awaiting
      .filter((person) => !(decisions[person.key] && pinned.get(person.key)))
      .map((person) => ({ person, decision: null }));
    [...pinned.entries()]
      .flatMap(([key, pin]) => (pin && decisions[key] ? [{ ...pin, decision: decisions[key] }] : []))
      .sort((a, b) => a.at - b.at)
      .forEach(({ person, at, decision }) => rows.splice(Math.min(at, rows.length), 0, { person, decision }));
    return rows;
  }, [awaiting, pinned, decisions]);
  // A new decision pins the person at the row they are on right now. Someone
  // no longer in the list (decided before this page opened) gets no line.
  const unpinned = Object.keys(decisions).filter((key) => !pinned.has(key));
  if (unpinned.length) {
    const next = new Map(pinned);
    for (const key of unpinned) {
      const at = waitingRows.findIndex((row) => row.person.key === key);
      next.set(key, at < 0 ? null : { person: waitingRows[at].person, at });
    }
    setPinned(next);
  }
  const waitingCount = waitingRows.filter((row) => !row.decision).length;

  // The chat with someone you accepted opens beside Home, where their match was.
  const openChat = (person: Person) => {
    const lead = person.entries[0];
    setLog({
      opportunityId: lead.item.opportunityId,
      intentId: lead.intentId,
      personKey: person.key,
      name: person.name,
      userId: person.userId,
      avatar: person.avatar,
      notOnIndex: person.notOnIndex,
      entries: person.entries,
      view: "chat",
    });
  };

  const act = (person: Person, action: Decision) => {
    decide(person.key, action);
    // Accepting opens the chat at once; the accept itself finishes behind it.
    const chatting = action === "accepted" && !!person.userId && !person.notOnIndex;
    if (chatting) openChat(person);
    // A decision applies to every intent where they are waiting on you.
    const pending = person.entries.filter((e) => e.stage === "awaiting" && !opportunityActionLoading[e.item.opportunityId]);
    void Promise.all(pending.map((entry) => handleOpportunityAction(entry.item.opportunityId, action, person.userId, {
      notOnIndex: person.notOnIndex,
      scope: { intentId: entry.intentId },
    }).then((ok) => { void loadRadar(entry.intentId); return ok; }))).then((results) => {
      // It didn't go through: the error is already shown, so give the card back.
      if (results.includes(false)) { decide(person.key, null); if (chatting) setLog(null); }
    });
  };

  const loadingPeople = intents.some((intent) => !radar[intent.id] && !radarFailed[intent.id]);
  const moving = [...byStage.talks, ...byStage.chat];
  // A question opened from a /q/ link stays in view even past the first few.
  const questionList = useShowMore(questions, (question) => question.groupId === linkedGroup);
  const waitingList = useShowMore(waitingRows);
  const movingList = useShowMore(moving);
  usePublishHomeSections([
        { id: "questions", label: "questions", count: questionsLoaded ? questions.length : undefined },
        { id: "waiting", label: "waiting on you", count: loadingPeople ? undefined : waitingCount },
        ...(moving.length || refreshingIds.length ? [{ id: "progress", label: "in progress", count: moving.length, loading: refreshingIds.length > 0 }] : []),
  ]);

  // A card opens its match beside Home; links and buttons inside it keep their own jobs.
  const openMatch = (person: Person) => {
    const lead = person.entries[0];
    setLog({
      opportunityId: lead.item.opportunityId,
      intentId: lead.intentId,
      personKey: person.key,
      name: person.name,
      userId: person.userId,
      avatar: person.avatar,
      notOnIndex: person.notOnIndex,
      entries: person.entries,
    });
  };
  const cardProps = (person: Person, className: string) => {
    const on = !!openLog && person.entries.some((e) => e.item.opportunityId === openLog.opportunityId);
    return {
      className: `${className} pl-card-open${on ? " on" : ""}`,
      onClick: (event: React.MouseEvent) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        if (on) setLog(null); else openMatch(person);
      },
    };
  };

  if (intentsLoaded && intents.length === 0) {
    return withAgent(
      <div className="pl-page">
        <h1>welcome to index.</h1>
        <p>tell your agent who you want to meet. it goes looking, talks to other agents, and brings you the people worth meeting.</p>
        <p>
          <button type="button" className="go big" onClick={() => toggleAgent(true)}>talk to your agent</button>{" "}
          <button type="button" onClick={() => navigate("/i/new")}>+ start an intent</button>
        </p>
      </div>,
    );
  }

  return withAgent(
      <div className="pl-page">
        <h2 id="questions">questions from your agents {questionsLoaded && `(${questions.length})`}</h2>
        {staleLink && <p className="pl-dim">that question was already answered.</p>}
        {!questionsLoaded ? (
          <Placeholder.Rows count={2} avatar={false} label="loading questions" />
        ) : questions.length === 0 ? (
          <p className="pl-dim">none right now.</p>
        ) : (
          <>
          <ul className="pl-cards pl-q-list">
            {questionList.shown.map((question) => (
              <QuestionItem key={question.groupId} question={question} forIntents={forLine(question)} selected={question.groupId === linkedGroup} onAnswer={answerAndRefresh} />
            ))}
          </ul>
          {questionList.more}
          </>
        )}

        <hr />

        <h2 id="waiting">waiting on you {!loadingPeople && `(${waitingCount})`}</h2>
        {loadingPeople && !waitingRows.length ? (
          <Placeholder.Rows count={3} label="loading people" />
        ) : waitingRows.length === 0 ? (
          <p className="pl-dim">nobody yet. your agents are still looking.</p>
        ) : (
          <>
          <ul className="pl-cards">
            {waitingList.shown.map(({ person, decision }) => {
              if (decision) {
                const canChat = decision === "accepted" && !!person.userId && !person.notOnIndex;
                const chatOpen = canChat && openLog?.view === "chat" && openLog.userId === person.userId;
                return (
                  <li key={person.key} className={`pl-card pl-card-passed${chatOpen ? " on" : ""}`}>
                    <UserAvatar id={person.userId ?? person.key} name={person.name} avatar={person.avatar} size={36} />
                    <div className="pl-card-body">
                      {decision === "accepted" ? "you accepted" : "you passed on"} <b>{person.name}</b>.
                    </div>
                    {canChat && !chatOpen && <button type="button" onClick={() => openChat(person)}>open chat</button>}
                    {decision === "accepted" && person.notOnIndex && (
                      <button type="button" onClick={() => navigate(`/i/${person.entries[0].intentId}`)}>send invite</button>
                    )}
                  </li>
                );
              }
              const lead = person.entries[0];
              const blurb = lead.item.headline || lead.item.mainText || "";
              const busy = person.entries.some((e) => opportunityActionLoading[e.item.opportunityId]);
              return (
                <li key={person.key} {...cardProps(person, "pl-card")}>
                  {/* The person themselves here, not their agent: this is who you'd meet. */}
                  {person.userId
                    ? <Link to={`/u/${person.userId}`} className="pl-card-face" title={`${person.name}'s profile`}><UserAvatar id={person.userId} name={person.name} avatar={person.avatar} size={36} /></Link>
                    : <UserAvatar id={person.key} name={person.name} avatar={person.avatar} size={36} />}
                  <div className="pl-card-body">
                  <b>{person.userId ? <Link to={`/u/${person.userId}`} className="pl-name" title={`${person.name}'s profile`}>{person.name}</Link> : person.name}</b>
                  {person.notOnIndex && <span className="pl-dim"> (not on index)</span>}
                  {blurb && <div className="pl-blurb">{blurb}</div>}
                  <div className="pl-actions">
                    {/* Someone you already chat with sits in progress, so everyone here is a fresh decision. */}
                    <button type="button" className="go" disabled={busy} onClick={() => act(person, "accepted")}>accept</button>{" "}
                    <button type="button" disabled={busy} onClick={() => act(person, "rejected")}>pass</button>
                  </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {waitingList.more}
          </>
        )}

        {(moving.length > 0 || refreshingIds.length > 0) && (
          <>
            <hr />
            <h2 id="progress">
              in progress ({refreshingIds.length > 0 ? <Placeholder.Count label="updating" /> : moving.length})
            </h2>
            <ul className="pl-moving">
              {movingList.shown.map((person) => {
                const lead = person.entries[0];
                const talking = lead.stage === "talks";
                const blurb = lead.item.headline || lead.item.mainText || "";
                const { className, onClick } = cardProps(person, "pl-moving-row");
                return (
                  <li key={person.key} className={className} onClick={onClick}>
                    {person.userId
                      ? <Link to={`/u/${person.userId}`} className="pl-card-face" title={`${person.name}'s profile`}><TheirAgentAvatar owner={{ id: person.userId, name: person.name, photo: person.avatar }} size={22} /></Link>
                      : <TheirAgentAvatar owner={{ id: person.key, name: person.name, photo: person.avatar }} size={22} />}
                    <b>{person.userId ? <Link to={`/u/${person.userId}`} className="pl-name" title={`${person.name}'s profile`}>{person.name}</Link> : person.name}</b>
                    <span className="pl-moving-blurb">{blurb}</span>
                    <span className={`pl-status ${talking ? "talks" : "chat"}`}>
                      {talking ? "talking" : person.notOnIndex ? "not on index" : "chat"}
                    </span>
                  </li>
                );
              })}
            </ul>
            {movingList.more}
          </>
        )}
      </div>,
  );
}

