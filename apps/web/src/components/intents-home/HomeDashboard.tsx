import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import "@/styles/intents-home.css";
import PageHead from "@/components/intents-home/PageHead";
import "@/styles/plain.css";
import { RANK, intentLabel, personKey, type Entry, type HomeIntent, type Stage } from "@/components/intents-home/stages";
import { useAgentWindow } from "@/components/intents-home/agentWindowContext";
import { usePublishHomeSections } from "@/components/intents-home/homeSectionsContext";
import { useAgentQuestions, type AgentQuestion } from "@/components/intents-home/useAgentQuestions";
import { questionAsker } from "@/components/IntentNegotiatorChat";
import UserAvatar from "@/components/UserAvatar";
import { MyAgentAvatar, TheirAgentAvatar } from "@/components/workbench/agent-avatar";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNotifications } from "@/contexts/NotificationContext";
import type { RadarCardItem } from "@/services/opportunities";

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

/** Dev-only sample matches for trying the page (`?demo=off` hides them). Never in a production build. */
const DEMO_MATCHES: Array<{ name: string; headline: string }> = [
  { name: "Ada Lovelace", headline: "Writes the first programs for agent runtimes and wants a design partner for the inbox." },
  { name: "Grace Hopper", headline: "Leads a compiler team that is adding intent routing; looking for people building agent UIs." },
  { name: "Alan Kay", headline: "Prototyping personal computing for agents, and keen to compare notes on matchmaking." },
  { name: "Radia Perlman", headline: "Designs protocols for agent-to-agent negotiation and is raising a small angel round." },
];

/** Dev only: the samples show by default. `?demo=off` hides them and `?demo` brings them back; the choice sticks. */
function demoOn(param: string | null): boolean {
  const KEY = "index.dev.hideDemoMatches";
  try {
    if (param === "off" || param === "0") localStorage.setItem(KEY, "1");
    else if (param !== null) localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) !== "1";
  } catch {
    return param !== "off" && param !== "0";
  }
}

/** How many of your intents each sample shares, so one, two and many all show up. */
const DEMO_SHARED = [1, 2, 4, 5];

function demoPeople(intentIds: string[]): Person[] {
  const ids = intentIds.length ? intentIds : ["demo"];
  return DEMO_MATCHES.map((match, i) => {
    const shared = Math.min(DEMO_SHARED[i % DEMO_SHARED.length], ids.length);
    const entries: Entry[] = Array.from({ length: shared }, (_, j) => ({
      intentId: ids[(i + j) % ids.length],
      stage: "awaiting" as const,
      item: {
        opportunityId: `demo-${i}-${j}`,
        status: "pending",
        peer: { userId: "", name: match.name, avatar: null, emailVerified: true },
        name: match.name,
        headline: match.headline,
        mainText: match.headline,
      } as unknown as RadarCardItem,
    }));
    return { key: `demo-${i}`, name: match.name, notOnIndex: false, entries };
  });
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
  const { conversations } = useConversation();
  const { intents, intentsLoaded, radar, radarFailed, entriesByIntent, opportunityActionLoading, handleOpportunityAction, loadRadar } = useIntentsData();
  // The agent has its own window on the desktop (see AppFrame); Home only opens it.
  const { setOpen: toggleAgent, log: openLog, setLog } = useAgentWindow();
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

  const liveIds = useMemo(
    () => intents.filter((intent) => (intent.status || "active").toLowerCase() !== "paused").map((intent) => intent.id),
    [intents],
  );
  const { questions, loaded: questionsLoaded, answer } = useAgentQuestions(liveIds);

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
    await answer(intentId, questionId, text);
    setRefreshing((prev) => ({ ...prev, [intentId]: stagesOf(intentId) }));
    void loadRadar(intentId, "skeleton");
  };
  const intentById = useMemo(() => new Map(intents.map((intent) => [intent.id, intent])), [intents]);

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

  const chatPeers = useMemo(() => {
    const ids = new Set<string>();
    for (const conv of conversations) {
      for (const participant of conv.participants ?? []) {
        if (participant.participantType === "user" && participant.participantId !== user?.id) ids.add(participant.participantId);
      }
    }
    return ids;
  }, [conversations, user?.id]);

  const [searchParams] = useSearchParams();
  const [demoDone, setDemoDone] = useState<Set<string>>(() => new Set());
  const showDemo = import.meta.env.DEV && demoOn(searchParams.get("demo"));
  const awaiting = useMemo(
    () => showDemo
      ? [...byStage.awaiting, ...demoPeople(intents.map((intent) => intent.id)).filter((person) => !demoDone.has(person.key))]
      : byStage.awaiting,
    [showDemo, byStage.awaiting, intents, demoDone],
  );

  const act = (person: Person, action: "accepted" | "rejected") => {
    // A sample match only leaves the list; nothing is sent.
    if (person.key.startsWith("demo-")) {
      setDemoDone((prev) => new Set(prev).add(person.key));
      return;
    }
    // A decision applies to every intent where they are waiting on you.
    for (const entry of person.entries.filter((e) => e.stage === "awaiting")) {
      if (opportunityActionLoading[entry.item.opportunityId]) continue;
      void handleOpportunityAction(entry.item.opportunityId, action, person.userId, {
        notOnIndex: person.notOnIndex,
        scope: { intentId: entry.intentId },
      }).then(() => loadRadar(entry.intentId));
    }
  };

  const loadingPeople = intents.some((intent) => !radar[intent.id] && !radarFailed[intent.id]);
  const moving = [...byStage.talks, ...byStage.chat];
  usePublishHomeSections([
        { id: "questions", label: "questions", count: questionsLoaded ? questions.length : undefined },
        { id: "waiting", label: "waiting on you", count: loadingPeople ? undefined : awaiting.length },
        ...(moving.length || refreshingIds.length ? [{ id: "progress", label: "in progress", count: moving.length, loading: refreshingIds.length > 0 }] : []),
  ]);

  // A card opens its match beside Home; links and buttons inside it keep their own jobs.
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
        {!questionsLoaded ? (
          <p className="pl-dim">loading…</p>
        ) : questions.length === 0 ? (
          <p className="pl-dim">none right now.</p>
        ) : (
          <ul className="pl-cards pl-q-list">
            {questions.map((question) => (
              <QuestionItem key={question.id} question={question} intent={intentById.get(question.intentId)} onAnswer={answerAndRefresh} />
            ))}
          </ul>
        )}

        <hr />

        <h2 id="waiting">waiting on you {!loadingPeople && `(${awaiting.length})`}</h2>
        {loadingPeople && !awaiting.length ? (
          <p className="pl-dim">loading…</p>
        ) : awaiting.length === 0 ? (
          <p className="pl-dim">nobody yet. your agents are still looking.</p>
        ) : (
          <ul className="pl-cards">
            {awaiting.map((person) => {
              const lead = person.entries[0];
              const blurb = lead.item.headline || lead.item.mainText || "";
              const busy = person.entries.some((e) => opportunityActionLoading[e.item.opportunityId]);
              const hasChat = !!person.userId && chatPeers.has(person.userId) && !person.notOnIndex;
              return (
                <li key={person.key} {...cardProps(person, "pl-card")}>
                  {/* The person themselves here, not their agent: this is who you'd meet. */}
                  {person.userId
                    ? <Link to={`/u/${person.userId}`} className="pl-card-face" title={`${person.name}'s profile`}><UserAvatar id={person.userId} name={person.name} avatar={person.avatar} size={44} /></Link>
                    : <UserAvatar id={person.key} name={person.name} avatar={person.avatar} size={44} />}
                  <div className="pl-card-body">
                  <b>{person.userId ? <Link to={`/u/${person.userId}`} className="pl-name" title={`${person.name}'s profile`}>{person.name}</Link> : person.name}</b>
                  {person.notOnIndex && <span className="pl-dim"> (not on index)</span>}
                  {blurb && <div className="pl-blurb">{blurb}</div>}
                  <div className="pl-actions">
                    {hasChat ? (
                      <button type="button" className="go" onClick={() => navigate(`/u/${person.userId}/chat`)}>open chat</button>
                    ) : (
                      <>
                        <button type="button" className="go" disabled={busy} onClick={() => act(person, "accepted")}>accept</button>{" "}
                        <button type="button" disabled={busy} onClick={() => act(person, "rejected")}>pass</button>
                      </>
                    )}
                  </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {(moving.length > 0 || refreshingIds.length > 0) && (
          <>
            <hr />
            <h2 id="progress">
              in progress ({moving.length})
              {refreshingIds.length > 0 && <span className="pl-dim"> updating<span className="pl-blink">_</span></span>}
            </h2>
            <ul className="pl-cards">
              {moving.map((person) => {
                const lead = person.entries[0];
                const talking = lead.stage === "talks";
                const blurb = lead.item.headline || lead.item.mainText || "";
                return (
                  <li key={person.key} {...cardProps(person, talking ? "pl-card talks" : "pl-card live")}>
                    {person.userId
                      ? <Link to={`/u/${person.userId}`} className="pl-card-face" title={`${person.name}'s profile`}><TheirAgentAvatar owner={{ id: person.userId, name: person.name, photo: person.avatar }} size={44} /></Link>
                      : <TheirAgentAvatar owner={{ id: person.key, name: person.name, photo: person.avatar }} size={44} />}
                    <div className="pl-card-body">
                      <div className="pl-card-head">
                        <span>
                          <b>{person.userId ? <Link to={`/u/${person.userId}`} className="pl-name" title={`${person.name}'s profile`}>{person.name}</Link> : person.name}</b>
                        </span>
                        <span className={`pl-status ${talking ? "talks" : "chat"}`}>
                          {talking ? "agents talking" : person.notOnIndex ? "not on index yet" : "chat open"}
                        </span>
                      </div>
                      {blurb && <div className="pl-blurb">{blurb}</div>}
                      <div className="pl-actions">
                        {talking ? (
                          <button type="button" onClick={() => openMatch(person)}>read the log</button>
                        ) : person.notOnIndex ? (
                          <button type="button" onClick={() => navigate(`/i/${lead.intentId}`)}>send invite</button>
                        ) : (
                          person.userId && <button type="button" className="go" onClick={() => navigate(`/u/${person.userId}/chat`)}>go to chat</button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>,
  );
}

/** Who's asking, with each person's name linked to their profile. */
function AskerName({ question, fallback }: { question: AgentQuestion; fallback: string }) {
  const people = (question.matches ?? [])
    .map((match) => match.counterparty)
    .filter((person): person is { id: string; name: string } => Boolean(person?.id && person.name && !/^unknown$/i.test(person.name.trim())));
  if (!people.length) return <>{fallback}</>;
  return (
    <>
      {people.map((person, index) => (
        <span key={person.id}>
          {index > 0 && ", "}
          <Link to={`/u/${person.id}`} className="pl-name" title={`${person.name}'s profile`}>{person.name}</Link>
        </span>
      ))}
      &apos;s {people.length === 1 ? "agent" : "agents"}
    </>
  );
}

/** One answer in progress: the picked option or your own words, and sending it. */
function useQuestionAnswer(question: AgentQuestion, onAnswer: (intentId: string, questionId: string, text: string) => Promise<void>) {
  const { error: showError } = useNotifications();
  const [choice, setChoice] = useState("");
  const [own, setOwn] = useState("");
  const [sending, setSending] = useState(false);
  const options = question.options ?? [];
  const text = (choice === "__own" || options.length === 0 ? own : choice).trim();
  const submit = async () => {
    if (!text || sending) return;
    setSending(true);
    try {
      await onAnswer(question.intentId, question.id, text);
    } catch {
      showError("couldn't send your answer.");
      setSending(false);
    }
  };
  return { choice, setChoice, own, setOwn, sending, options, text, submit };
}

/** The asking agent's face, sized and linked like an opportunity row's avatar. */
function AskerFace({ question, size }: { question: AgentQuestion; size: number }) {
  const asker = questionAsker(question);
  return asker.owner
    ? <Link to={`/u/${asker.owner.id}`} className="pl-card-face" title={`${asker.owner.name}'s profile`}><TheirAgentAvatar owner={{ id: asker.owner.id, name: asker.owner.name }} size={size} /></Link>
    : <span className="pl-card-face"><MyAgentAvatar size={size} /></span>;
}

/**
 * One question from an agent, drawn like an opportunity row:
 * the asker's face on the left, who's asking and about which intent, the
 * question, its answers as radios, and the card's small send button.
 */
function QuestionItem({ question, intent, onAnswer }: {
  question: AgentQuestion;
  intent?: HomeIntent;
  onAnswer: (intentId: string, questionId: string, text: string) => Promise<void>;
}) {
  const { choice, setChoice, own, setOwn, sending, options, text, submit } = useQuestionAnswer(question, onAnswer);
  const asker = questionAsker(question);
  const name = `q-${question.id}`;
  return (
    <li className="pl-card pl-q-row">
      <AskerFace question={question} size={44} />
      <form className="pl-card-body" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="pl-q-row-meta">
          <b><AskerName question={question} fallback={asker.label} /></b>
          {intent && <> · <Link to={`/i/${intent.id}`} className="pl-q-about" title={intent.payload}>{intentLabel(intent)}</Link></>}
        </div>
        <div className="pl-blurb pl-q-row-text">{question.question}</div>
        <div className="pl-q-options">
          {options.map((option) => (
            <label key={option}>
              <input type="radio" name={name} checked={choice === option} onChange={() => setChoice(option)} /> {option}
            </label>
          ))}
          {options.length > 0 && (
            <label>
              <input type="radio" name={name} checked={choice === "__own"} onChange={() => setChoice("__own")} /> something else
            </label>
          )}
          {(options.length === 0 || choice === "__own") && (
            <input type="text" value={own} onChange={(event) => setOwn(event.target.value)} placeholder="type your answer" aria-label="your answer" autoFocus={options.length > 0} />
          )}
        </div>
        <div className="pl-actions">
          <button type="submit" className="go" disabled={!text || sending}>{sending ? "sending…" : "send answer"}</button>
        </div>
      </form>
    </li>
  );
}
