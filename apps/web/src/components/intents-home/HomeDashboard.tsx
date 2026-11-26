import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";

import "@/styles/intents-home.css";
import "@/styles/plain.css";
import { PageView, ListHead } from "@/components/intents-home/SplitView";
import QuestionCard from "@/components/intents-home/QuestionCard";
import { useUndo } from "@/components/intents-home/undo";
import { RANK, intentLabel, personKey, type Entry, type Stage } from "@/components/intents-home/stages";
import { useAgentWindow, type Decision } from "@/components/intents-home/agentWindowContext";
import { usePublishHomeSections } from "@/components/intents-home/homeSectionsContext";
import { focusedGroup, intentsToRefresh } from "@/components/intents-home/personal-questions";
import { usePersonalQuestions } from "@/components/intents-home/usePersonalQuestions";
import UserAvatar from "@/components/UserAvatar";
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
  const later = useUndo();
  // A page in the middle; your agent, or whoever you open, docks on the right (see AppFrame).
  const split = (page: ReactNode) => (
    <PageView
      title={<>{user?.name ? `hi ${user.name.split(" ")[0].toLowerCase()}.` : "hi."} {HOME_STATUS_LINE}</>}
      actions={<button type="button" className="sv-btn go sm" onClick={() => navigate("/i/new")}>+ new intent</button>}
    >
      {page}
    </PageView>
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
    const send = () => void Promise.all(pending.map((entry) => handleOpportunityAction(entry.item.opportunityId, action, person.userId, {
      notOnIndex: person.notOnIndex,
      scope: { intentId: entry.intentId },
    }).then((ok) => { void loadRadar(entry.intentId); return ok; }))).then((results) => {
      // It didn't go through: the error is already shown, so give the card back.
      if (results.includes(false)) { decide(person.key, null); if (chatting) setLog(null); }
    });
    if (action === "accepted") { send(); return; }
    // Passing on the one that's open moves on to the next person waiting.
    const wasOpen = !!openLog && person.entries.some((e) => e.item.opportunityId === openLog.opportunityId);
    if (wasOpen) {
      const rest = waitingRows.filter((row) => !row.decision && row.person.key !== person.key).map((row) => row.person);
      const at = waitingRows.findIndex((row) => row.person.key === person.key);
      const next = rest.find((p) => waitingRows.findIndex((row) => row.person.key === p.key) > at) ?? rest[0];
      if (next) openMatch(next); else setLog(null);
    }
    later(`passed on ${person.name.split(" ")[0]}`, send, () => decide(person.key, null));
  };

  const loadingPeople = intents.some((intent) => !radar[intent.id] && !radarFailed[intent.id]);
  // Chats have their own page (conversations), so this section is only people your agent is still talking with.
  const talking = byStage.talks;
  // At most 3 question cards before "show all ›"; one opened from a /q/ link stays in view past them.
  const questionList = useShowMore(questions, (question) => question.groupId === linkedGroup, 3);
  const waitingList = useShowMore(waitingRows);
  const talkingList = useShowMore(talking, undefined, 0);
  usePublishHomeSections([
        { id: "questions", label: "questions", count: questionsLoaded ? questions.length : undefined },
        { id: "waiting", label: "waiting on you", count: loadingPeople ? undefined : waitingCount },
        ...(talking.length || refreshingIds.length ? [{ id: "progress", label: "in progress", count: talking.length, loading: refreshingIds.length > 0 }] : []),
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
      className: `${className}${on ? " on" : ""}`,
      "data-sv-item": person.key,
      onClick: (event: React.MouseEvent) => {
        if ((event.target as HTMLElement).closest("a, button, input")) return;
        if (on) setLog(null); else openMatch(person);
      },
    };
  };

  if (intentsLoaded && intents.length === 0) {
    return split(
      <div className="sv-empty">
        <p className="sv-p"><b>welcome to index.</b></p>
        <p className="sv-p" style={{ margin: "6px 0 12px" }}>tell your agent who you want to meet. it goes looking, talks to other agents, and brings you the people worth meeting.</p>
        <div className="sv-actions">
          <button type="button" className="sv-btn go" onClick={() => toggleAgent(true)}>talk to your agent</button>
          <button type="button" className="sv-btn" onClick={() => navigate("/i/new")}>+ start an intent</button>
        </div>
      </div>,
    );
  }


  return split(
    <>
      <ListHead id="questions" fold={questionList.fold}>agents are asking you · {questionsLoaded ? questions.length : "…"}</ListHead>
      {staleLink && <div className="sv-empty">that question was already answered.</div>}
      {!questionsLoaded ? (
        <div className="sv-empty"><Placeholder.Rows count={2} avatar={false} label="loading questions" /></div>
      ) : questions.length === 0 ? (
        <div className="sv-empty">no questions right now.</div>
      ) : (
        <>
          {questionList.shown.map((question) => (
            <QuestionCard
              key={question.groupId}
              question={question}
              selected={question.groupId === linkedGroup}
              onAnswer={answerAndRefresh}
            />
          ))}
        </>
      )}

      <ListHead id="waiting" fold={waitingList.fold}>agents agreed. your call · {loadingPeople ? "…" : waitingCount}</ListHead>
      {loadingPeople && !waitingRows.length ? (
        <div className="sv-empty"><Placeholder.Rows count={3} label="loading people" /></div>
      ) : waitingRows.length === 0 ? (
        <div className="sv-empty">nobody yet. your agents are still looking.</div>
      ) : (
        <>
          {waitingList.shown.map(({ person, decision }) => {
            const lead = person.entries[0];
            const blurb = lead.item.headline || lead.item.mainText || "";
            const busy = person.entries.some((e) => opportunityActionLoading[e.item.opportunityId]);
            // Once you decide, the card stays as it was; only its buttons change.
            const canChat = decision === "accepted" && !!person.userId && !person.notOnIndex;
            return (
              <div key={person.key} {...cardProps(person, "sv-card")}>
                <UserAvatar id={person.userId ?? person.key} name={person.name} avatar={person.avatar} size={36} />
                <div className="sv-card-body">
                  <div className="sv-mrow">
                    <b>{person.name}</b>
                    {person.notOnIndex && <span className="sv-via"> · not on index</span>}
                    {canChat
                      ? <button type="button" className="sv-open" onClick={() => openChat(person)}>open chat ›</button>
                      : decision === "rejected" && <span className="sv-mchip">passed</span>}
                  </div>
                  {blurb && <div className="sv-blurb">{blurb}</div>}
                  {!decision ? (
                    <div className="sv-actions">
                      <button type="button" className="sv-btn go" data-sv-key="accept" disabled={busy} onClick={() => act(person, "accepted")}>accept</button>
                      <button type="button" className="sv-btn" data-sv-key="pass" disabled={busy} onClick={() => act(person, "rejected")}>pass</button>
                    </div>
                  ) : decision === "accepted" && person.notOnIndex && (
                    <div className="sv-actions">
                      <button type="button" className="sv-btn" onClick={() => navigate(`/i/${lead.intentId}`)}>send invite</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      {(talking.length > 0 || refreshingIds.length > 0) && (
        <>
          <ListHead id="progress">in progress</ListHead>
          {/* The whole line opens the list; the "see all ›" inside stays the keyboard's way in. */}
          <div
            className={`sv-strip${talkingList.fold ? " sv-strip-go" : ""}`}
            onClick={(event) => {
              if (!talkingList.fold || (event.target as HTMLElement).closest("a, button")) return;
              talkingList.fold.toggle();
            }}
          >
            <span className="sv-stack">
              {talking.slice(0, 5).map((person) => (
                <UserAvatar key={person.key} id={person.userId ?? person.key} name={person.name} avatar={person.avatar} size={22} />
              ))}
            </span>
            <span className="sv-strip-t">
              {refreshingIds.length > 0
                ? <>your agent is talking with <Placeholder.Count label="updating" /> people</>
                : <>your agent is talking with {talking.length} {talking.length === 1 ? "person" : "people"}</>}
            </span>
            {talkingList.fold && (
              <button type="button" className="sv-open" aria-expanded={talkingList.fold.open} onClick={talkingList.fold.toggle}>
                {talkingList.fold.open ? "show fewer" : "see all ›"}
              </button>
            )}
          </div>
          {talkingList.shown.map((person) => {
            const lead = person.entries[0];
            // While agents talk the headline is only "Agents are talking"; the intent says why they're talking.
            const intent = intents.find((i) => i.id === lead.intentId);
            const blurb = intent ? `for ${intentLabel(intent)}` : lead.item.headline || lead.item.mainText || "";
            return (
              <div key={person.key} {...cardProps(person, "sv-row")}>
                <UserAvatar id={person.userId ?? person.key} name={person.name} avatar={person.avatar} size={36} />
                <div className="sv-row-t">
                  <div className="sv-row-n">{person.name}</div>
                  <div className="sv-row-pv">{blurb}</div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </>,
  );
}

