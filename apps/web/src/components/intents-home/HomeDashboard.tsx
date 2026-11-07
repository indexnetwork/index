import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import "@/styles/intents-home.css";
import "@/styles/plain.css";
import { RANK, intentLabel, personKey, type Entry, type HomeIntent, type Stage } from "@/components/intents-home/stages";
import HomeAgentPanel from "@/components/intents-home/HomeAgentPanel";
import { usePublishHomeSections } from "@/components/intents-home/homeSectionsContext";
import { useAgentQuestions, type AgentQuestion } from "@/components/intents-home/useAgentQuestions";
import { questionAsker } from "@/components/IntentNegotiatorChat";
import { MyAgentAvatar, TheirAgentAvatar } from "@/components/workbench/agent-avatar";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNotifications } from "@/contexts/NotificationContext";
import type { RadarCardItem } from "@/services/opportunities";

interface Person {
  key: string;
  userId?: string;
  name: string;
  avatar?: string | null;
  notOnIndex: boolean;
  /** Every intent this person shows up in, best stage first. */
  entries: Entry[];
}

const AGENT_OPEN_KEY = "index.home.agentOpen";

/** Whether this viewer left the agent chat open last time. Closed by default. */
function readAgentOpen(): boolean {
  try { return localStorage.getItem(AGENT_OPEN_KEY) === "1"; } catch { return false; }
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

/**
 * Home: come in, answer your agents, see who they found, leave.
 * A plain page on purpose: text, links and native controls.
 */
export default function HomeDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { conversations } = useConversation();
  const { intents, intentsLoaded, fetchIntents, radar, radarFailed, entriesByIntent, opportunityActionLoading, handleOpportunityAction, loadRadar } = useIntentsData();
  const [agentOpen, setAgentOpen] = useState(readAgentOpen);
  const toggleAgent = (open: boolean) => {
    setAgentOpen(open);
    try { localStorage.setItem(AGENT_OPEN_KEY, open ? "1" : "0"); } catch { /* a per-viewer convenience only */ }
  };
  // After the agent changes something, show it: reread intents and everyone's stage.
  const onAgentChanged = useCallback(() => {
    void fetchIntents();
    for (const intent of intents) void loadRadar(intent.id, "skeleton");
  }, [fetchIntents, intents, loadRadar]);
  const withAgent = (page: ReactNode) => (
    <div className="ih-view pl">
      <div className="pl-wrap">
        {page}
        {agentOpen
          ? <HomeAgentPanel onClose={() => toggleAgent(false)} onChanged={onAgentChanged} />
          : <button type="button" className="go pl-agent-toggle" onClick={() => toggleAgent(true)}>talk to your agent ▸</button>}
      </div>
    </div>
  );

  const liveIds = useMemo(
    () => intents.filter((intent) => (intent.status || "active").toLowerCase() !== "paused").map((intent) => intent.id),
    [intents],
  );
  const { questions, loaded: questionsLoaded, answer } = useAgentQuestions(liveIds);
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
        ...(moving.length ? [{ id: "progress", label: "in progress", count: moving.length }] : []),
  ]);

  const forIntents = (person: Person) => (
    <>{" "}for <IntentLinks entries={person.entries} intentById={intentById} /></>
  );

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
          <div className="pl-questions">
            {questions.map((question, index) => (
              <QuestionItem key={question.id} number={index + 1} question={question} intent={intentById.get(question.intentId)} onAnswer={answer} />
            ))}
          </div>
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
                <li key={person.key} className="pl-card">
                  <TheirAgentAvatar owner={{ id: person.userId || person.key, name: person.name, photo: person.avatar }} size={44} />
                  <div className="pl-card-body">
                  <b>{person.userId ? <Link to={`/u/${person.userId}`}>{person.name}</Link> : person.name}</b>
                  {person.notOnIndex && <span className="pl-dim"> (not on index)</span>}
                  {forIntents(person)}
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

        {moving.length > 0 && (
          <>
            <hr />
            <h2 id="progress">in progress ({moving.length})</h2>
            <table className="pl-table">
              <thead>
                <tr><th>who</th><th>for</th><th>status</th><th /></tr>
              </thead>
              <tbody>
                {moving.map((person) => {
                  const lead = person.entries[0];
                  const talking = lead.stage === "talks";
                  return (
                    <tr key={person.key}>
                      <td>
                        <span className="pl-who">
                          <TheirAgentAvatar owner={{ id: person.userId || person.key, name: person.name, photo: person.avatar }} size={26} />
                          <b>{person.userId ? <Link to={`/u/${person.userId}`}>{person.name}</Link> : person.name}</b>
                        </span>
                      </td>
                      <td>
                        <IntentLinks entries={person.entries} intentById={intentById} />
                      </td>
                      <td>
                        <span className={`pl-status ${talking ? "talks" : "chat"}`}>
                          {talking ? "agents talking" : person.notOnIndex ? "not on index yet" : "chat open"}
                        </span>
                      </td>
                      <td className="pl-go">
                        {talking ? (
                          <Link to={`/i/${lead.intentId}`}>read log</Link>
                        ) : person.notOnIndex ? (
                          <Link to={`/i/${lead.intentId}`}>send invite</Link>
                        ) : (
                          person.userId && <Link to={`/u/${person.userId}/chat`}>go to chat</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>,
  );
}

function QuestionItem({ number, question, intent, onAnswer }: {
  number: number;
  question: AgentQuestion;
  intent?: HomeIntent;
  onAnswer: (intentId: string, questionId: string, text: string) => Promise<void>;
}) {
  const { error: showError } = useNotifications();
  const [choice, setChoice] = useState("");
  const [own, setOwn] = useState("");
  const [sending, setSending] = useState(false);
  const options = question.options ?? [];
  const text = (choice === "__own" || options.length === 0 ? own : choice).trim();
  const name = `q-${question.id}`;
  const asker = questionAsker(question);

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

  return (
    <form className="pl-q" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset>
        <legend>
          <span className="pl-q-face">
            {asker.owner ? <TheirAgentAvatar owner={{ id: asker.owner.id, name: asker.owner.name }} size={18} /> : <MyAgentAvatar size={18} />}
          </span>
          #{number} · {asker.label}
          {intent && <> · <Link to={`/i/${intent.id}`} className="pl-q-about" title={intent.payload}>{intentLabel(intent)}</Link></>}
        </legend>
        <p className="pl-q-text">{question.question}</p>
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
        <div className="pl-q-send">
          <button type="submit" className="go" disabled={!text || sending}>{sending ? "sending…" : "send answer"}</button>
        </div>
      </fieldset>
    </form>
  );
}

/** The intents someone matched on: the top two, then "+N" to show the rest. */
function IntentLinks({ entries, intentById }: { entries: Entry[]; intentById: Map<string, HomeIntent> }) {
  const [open, setOpen] = useState(false);
  const shown = open ? entries : entries.slice(0, 2);
  const rest = entries.length - shown.length;
  return (
    <>
      {shown.map((entry, i) => (
        <span key={entry.intentId}>
          {i > 0 && ", "}
          <Link to={`/i/${entry.intentId}`} title={intentById.get(entry.intentId)?.payload}>{intentLabel(intentById.get(entry.intentId))}</Link>
        </span>
      ))}
      {rest > 0 && (
        <>
          {" "}
          <button
            type="button"
            className="pl-more"
            title={entries.slice(2).map((entry) => intentLabel(intentById.get(entry.intentId))).join("\n")}
            onClick={() => setOpen(true)}
          >
            +{rest}
          </button>
        </>
      )}
      {open && entries.length > 2 && (
        <>
          {" "}
          <button type="button" className="pl-more" onClick={() => setOpen(false)}>less</button>
        </>
      )}
    </>
  );
}
