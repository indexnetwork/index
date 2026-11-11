import { useEffect, useRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { questionAsker, useIntentAgentChat, type QuestionCard } from "@/components/IntentNegotiatorChat";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import { discoverySummary } from "@/components/workbench/mac-blocks";
import { formatChatClock } from "@/lib/utils";

/** One line of the chat, drawn like Home's agent window: my avatar and a bubble, yours on the right. */
function Line({ who, at, mine = false, children }: { who: ReactNode; at?: string; mine?: boolean; children: ReactNode }) {
  return (
    <div className={`pl-agent-line${mine ? " mine" : ""}`}>
      {!mine && <MyAgentAvatar size={22} />}
      <div className={`pl-agent-bubble${mine ? " mine" : ""}`}>
        <div className="pl-agent-meta">{who}{at && <> · <time dateTime={at} title={new Date(at).toLocaleString()}>{formatChatClock(at)}</time></>}</div>
        {children}
      </div>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return <div className="pl-agent-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
}

/**
 * This intent's agent, in the window beside the intent page (as Home's agent
 * window): how it went looking, its notes and questions, and a composer.
 */
export default function IntentAgentPanel({ intentId, paused, onSelectMatch }: {
  intentId: string;
  paused: boolean;
  onSelectMatch(opportunityId: string): void;
}) {
  const {
    loading, loadFailed, retry, feed, questions, chosen, selections, setSelections, writing, setWriting,
    draft, setDraft, send, sendAnswers, sending, waiting, firstWaiting, timeById, inputRef,
  } = useIntentAgentChat(intentId);
  const endRef = useRef<HTMLDivElement>(null);
  // Follow new content, not an answer: it turns its question into an answered card in place.
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [feed.length]);

  const askerLabel = (question: QuestionCard) => questionAsker(question).label;

  return (
    <div className="pl pl-agent pl-intent-agent" data-testid="intent-agent-panel">
      <div className="pl-agent-head">
        <span>talk to me about this intent</span>
        <span className={`pl-status ${paused ? "paused" : "live"}`}>{paused ? "paused" : "live"}</span>
      </div>
      <div className="pl-agent-log">
        {loading ? (
          <p className="pl-dim pl-small">loading…</p>
        ) : feed.length === 0 && questions.length === 0 && loadFailed ? (
          <p className="pl-dim pl-small">couldn&apos;t load this chat. <button type="button" onClick={retry}>try again</button></p>
        ) : feed.length === 0 && questions.length === 0 ? (
          <div className="pl-agent-line">
            <MyAgentAvatar size={22} />
            <div className="pl-agent-bubble">ask me about your matches, share a preference, or tell me what to look for.</div>
          </div>
        ) : feed.map((piece, index) => {
          const at = timeById.get(piece.id);
          if (piece.kind === "discovery") {
            const summary = typeof piece.discovered === "number" ? `${discoverySummary(piece.discovered, piece.reached)}.` : piece.progress;
            return (
              <Line key={piece.id} who="your agent" at={at}>
                <div className="pl-trace">
                  {piece.loading.map((line) => <div key={line} className="pl-dim">{line.endsWith(".") ? line : `${line}.`}</div>)}
                  {piece.plan && <div>{piece.plan}</div>}
                  {piece.queries.length > 0 && (
                    <>
                      <div className="pl-dim">ran {piece.queries.length} {piece.queries.length === 1 ? "query" : "queries"}</div>
                      {piece.queries.map((query) => <div key={query} className="pl-trace-q">{query}</div>)}
                    </>
                  )}
                  {summary && <div>{summary}</div>}
                </div>
              </Line>
            );
          }
          if (piece.kind === "user") {
            return (
              <div key={piece.id}>
                <Line who="you" at={at} mine><Markdown text={piece.text} /></Line>
                {waiting && index > firstWaiting && <div className="pl-agent-meta pl-queued">queued</div>}
              </div>
            );
          }
          if (piece.kind === "progress") {
            return <p key={piece.id} className="pl-dim pl-small pl-trace-step">· {piece.text}</p>;
          }
          if (piece.kind === "open-question") {
            const { question } = piece;
            const id = question.questionId;
            const answer = selections[id] || "";
            const own = !question.options.includes(answer) && answer;
            const write = writing[id] || question.options.length === 0;
            const opportunityId = question.matches?.[0]?.opportunityId;
            const asker = opportunityId
              ? <button type="button" className="pl-skip pl-asker" onClick={() => onSelectMatch(opportunityId)}>{askerLabel(question)}</button>
              : askerLabel(question);
            return (
              <Line key={piece.id} who={<>question · {asker}</>} at={at}>
                {question.text}
                <div className="pl-agent-suggest">
                  {question.options.map((option) => (
                    <button key={option} type="button" className={answer === option ? "on" : undefined} aria-pressed={answer === option}
                      onClick={() => {
                        setSelections((current) => ({ ...current, [id]: current[id] === option ? "" : option }));
                        setWriting((current) => ({ ...current, [id]: false }));
                      }}>{option}</button>
                  ))}
                  {write ? (
                    <input
                      type="text"
                      className="pl-own-answer"
                      autoFocus={question.options.length > 0}
                      value={own ? answer : ""}
                      onChange={(event) => setSelections((current) => ({ ...current, [id]: event.target.value }))}
                      onBlur={(event) => { if (!event.currentTarget.value.trim()) setWriting((current) => ({ ...current, [id]: false })); }}
                      placeholder="write your own"
                      aria-label="Write your own answer"
                    />
                  ) : (
                    <button type="button" onClick={() => {
                      setSelections((current) => ({ ...current, [id]: "" }));
                      setWriting((current) => ({ ...current, [id]: true }));
                    }}>write your own</button>
                  )}
                </div>
              </Line>
            );
          }
          if (piece.kind === "answered-question") {
            return (
              <div key={piece.id} className="pl-answered">
                <Line who={`answered · ${askerLabel(piece.question)}`} at={at}>{piece.question.text}</Line>
                <Line who="you" mine>{piece.answer}</Line>
              </div>
            );
          }
          return <Line key={piece.id} who="your agent" at={at}><Markdown text={piece.text} /></Line>;
        })}
        {waiting && (
          <div className="pl-agent-line">
            <MyAgentAvatar size={22} />
            <div className="pl-agent-bubble pl-dim">working on it<span className="pl-blink">_</span></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {chosen.length > 0 && (
        <div className="pl-answers">
          <span className="pl-dim pl-small">
            {questions.length - chosen.length > 0 ? `${questions.length - chosen.length} of ${questions.length} unanswered` : "all answered, ready to send"}
          </span>
          <button type="button" className="go" disabled={sending} onClick={() => void sendAnswers()}>
            {sending ? "sending…" : chosen.length > 1 ? `send ${chosen.length} answers` : "send answer"}
          </button>
        </div>
      )}

      <form className="pl-agent-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
          placeholder="tell your agent…"
          aria-label="Message your agent"
        />
        <button type="submit" className="go" disabled={!draft.trim() || sending}>send</button>
      </form>
    </div>
  );
}
