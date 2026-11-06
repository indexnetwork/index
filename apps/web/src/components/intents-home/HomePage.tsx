import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import "@/styles/intents-home.css";
import { IntentTag, PersonRow, isPaused, usePeople } from "@/components/intents-home/people";
import { personKey } from "@/components/intents-home/stages";
import { useConversations } from "@/contexts/APIContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { agentLabel } from "@/components/workbench/agent-avatar";
import type { PrincipalQuestion } from "@/services/conversation";

type OpenQuestion = { intentId: string; question: PrincipalQuestion };

/**
 * Home: what needs you today. Your agent's open questions and the people
 * waiting on your accept or pass.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const conversations = useConversations();
  const { error: showError } = useNotifications();
  const { intents, intentsLoaded, radar, radarFailed, entriesByIntent, questionsByIntent, refreshQuestions } = useIntentsData();
  const { sections } = usePeople();
  const waiting = sections.matches;

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, boolean>>({});
  /** Answers sent this session, hidden until the server's list catches up. */
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);

  const questions = useMemo((): OpenQuestion[] => intents.flatMap((intent) =>
    (questionsByIntent[intent.id] ?? []).filter((q) => !sent.has(q.id)).map((question) => ({ intentId: intent.id, question }))),
  [intents, questionsByIntent, sent]);
  const chosen = questions.filter(({ question }) => selections[question.id]?.trim());

  const sendAnswers = async () => {
    if (!chosen.length || sending) return;
    setSending(true);
    // One write per intent, so the agent reads all of an intent's answers at once.
    const byIntent = new Map<string, { questionId: string; text: string }[]>();
    for (const { intentId, question } of chosen) {
      byIntent.set(intentId, [...(byIntent.get(intentId) ?? []), { questionId: question.id, text: selections[question.id]!.trim() }]);
    }
    const results = await Promise.allSettled([...byIntent].map(async ([intentId, answers]) => {
      await conversations.sendAnswers(intentId, answers);
      return answers.map((answer) => answer.questionId);
    }));
    const done = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    setSent((prev) => new Set([...prev, ...done]));
    setSelections((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !done.includes(id))));
    if (results.some((result) => result.status === "rejected")) showError("couldn't send some answers. try again.");
    setSending(false);
    for (const intentId of byIntent.keys()) void refreshQuestions(intentId);
  };

  // A question can point at a match: someone waiting here lights up; anyone else opens in opportunities.
  const selectMatch = useCallback((opportunityId: string) => {
    for (const entries of Object.values(entriesByIntent)) {
      const entry = entries.find((e) => e.item.opportunityId === opportunityId);
      if (!entry) continue;
      const key = personKey(entry.item);
      if (waiting.some((person) => person.key === key)) setHighlight(key);
      else navigate(`/opportunities?open=${opportunityId}`);
      return;
    }
  }, [entriesByIntent, waiting, navigate]);

  const live = intents.filter((intent) => !isPaused(intent));
  const loadingPeople = intents.some((intent) => !radar[intent.id] && !radarFailed[intent.id]);
  const need = questions.length + waiting.length;

  return (
    <div className="ih-view">
      <header className="ih-head">
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="ih-eyebrow">HOME</div>
          <h1 className="ih-title">
            {!intentsLoaded ? "…" : !intents.length ? "start with what you're looking for"
              : need === 0 ? "you're all caught up"
              : need === 1 ? "1 thing needs you" : `${need} things need you`}
          </h1>
          <div className="ih-status">
            {intents.length
              ? [
                questions.length && `${questions.length} question${questions.length === 1 ? "" : "s"} from your agent`,
                waiting.length && `${waiting.length} ${waiting.length === 1 ? "person" : "people"} waiting on you`,
                `${live.length} intent${live.length === 1 ? "" : "s"} live`,
              ].filter(Boolean).join(" · ")
              : "your agent looks for people once you tell it what you need."}
          </div>
        </div>
      </header>

      <div className="ih-cols">
        <section className="ih-people ih-all">
          {intentsLoaded && !intents.length ? (
            <div className="ih-empty">
              no intents yet.
              <button type="button" className="ih-next" onClick={() => navigate("/i/new")}>+ start your first intent ›</button>
            </div>
          ) : (
            <>
              <div className="ih-bar"><span>YOUR AGENT IS ASKING</span>{questions.length > 0 && <span className="ih-n">{questions.length}</span>}</div>
              {questions.length ? questions.map(({ intentId, question }) => (
                <QuestionRow
                  key={question.id}
                  intentId={intentId}
                  question={question}
                  answer={selections[question.id] ?? ""}
                  writing={!!writing[question.id] || !(question.options?.length)}
                  onAnswer={(text) => setSelections((prev) => ({ ...prev, [question.id]: text }))}
                  onWrite={(on) => setWriting((prev) => ({ ...prev, [question.id]: on }))}
                  onSelectMatch={selectMatch}
                />
              )) : <div className="ih-empty ih-empty-sm">no questions right now.</div>}
              {chosen.length > 0 && (
                <div className="ih-answers-bar">
                  <span>{questions.length - chosen.length > 0 ? `${questions.length - chosen.length} of ${questions.length} unanswered` : "all answered"}</span>
                  <button type="button" className="ih-accept" disabled={sending} onClick={() => void sendAnswers()}>
                    {sending ? "sending…" : chosen.length > 1 ? `send ${chosen.length} answers` : "send answer"}
                  </button>
                </div>
              )}

              <div className="ih-bar"><span>WAITING ON YOU</span>{waiting.length > 0 && <span className="ih-n">{waiting.length}</span>}</div>
              {waiting.length
                ? waiting.map((person) => <PersonRow key={person.key} person={person} highlight={highlight === person.key} />)
                : <div className="ih-empty ih-empty-sm">{loadingPeople ? "loading…" : "nobody waiting on you. your agent is still looking."}</div>}
              <button type="button" className="ih-next ih-see-all" onClick={() => navigate("/opportunities")}>all opportunities ›</button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** One open question: which intent it's about, who's asking, and quick answers. */
function QuestionRow({ intentId, question, answer, writing, onAnswer, onWrite, onSelectMatch }: {
  intentId: string;
  question: PrincipalQuestion;
  answer: string;
  writing: boolean;
  onAnswer(text: string): void;
  onWrite(on: boolean): void;
  onSelectMatch(opportunityId: string): void;
}) {
  const options = question.options ?? [];
  const people = (question.matches ?? []).filter((match) => match.counterparty?.name);
  const own = answer && !options.includes(answer) ? answer : "";
  return (
    <div className="ih-q" data-testid="agent-question">
      <div className="ih-q-meta">
        <IntentTag intentId={intentId} />
        {people.length === 1 ? (
          <button type="button" className="ih-q-who" onClick={() => onSelectMatch(people[0].opportunityId)}>
            {agentLabel(people[0].counterparty.name!)}
          </button>
        ) : <span className="ih-q-who">{people.length > 1 ? `about ${people.map((p) => p.counterparty.name).join(", ")}` : "your agent"}</span>}
      </div>
      <div className="ih-q-text">{question.question}</div>
      <div className="ih-options">
        {options.map((option) => (
          <button key={option} type="button" className={`ih-option${answer === option ? " on" : ""}`} aria-pressed={answer === option}
            onClick={() => { onAnswer(answer === option ? "" : option); onWrite(false); }}>
            {option}
          </button>
        ))}
        {writing ? (
          <input
            className="ih-q-input"
            autoFocus={options.length > 0}
            value={own}
            onChange={(event) => onAnswer(event.target.value)}
            onBlur={(event) => { if (!event.currentTarget.value.trim() && options.length) onWrite(false); }}
            placeholder={options.length ? "write your own" : "your answer"}
            aria-label="Your answer"
          />
        ) : (
          <button type="button" className="ih-option ih-option-write" onClick={() => { onAnswer(""); onWrite(true); }}>write your own</button>
        )}
      </div>
    </div>
  );
}
