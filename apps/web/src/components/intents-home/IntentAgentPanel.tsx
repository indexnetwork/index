import { useEffect, useRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { questionAsker, useIntentAgentChat, type QuestionCard } from "@/components/IntentNegotiatorChat";
import { discoverySummary } from "@/components/workbench/mac-blocks";
import { formatChatClock } from "@/lib/utils";

function Meta({ who, at }: { who: string; at?: string }) {
  return (
    <div className="ih-msg-meta">
      {who.toUpperCase()}
      {at && <time dateTime={at} title={new Date(at).toLocaleString()}> · {formatChatClock(at)}</time>}
    </div>
  );
}

function Message({ who, at, mine = false, children }: { who: string; at?: string; mine?: boolean; children: ReactNode }) {
  return (
    <div className="ih-msg">
      <Meta who={who} at={at} />
      <div className={`ih-msg-body${mine ? " mine" : ""}`}>{children}</div>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>;
}

/**
 * The single-intent agent column: the discovery trace, the agent's notes and
 * questions, and a composer. Everything here is monospace.
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
    <div className="ih-agent" data-testid="intent-agent-panel">
      <div className="ih-bar">
        <span>YOUR AGENT</span>
        <span style={{ color: paused ? "var(--ih-disabled)" : "var(--ih-live)" }}>● {paused ? "paused" : "live"}</span>
      </div>
      <div className="ih-agent-body">
        {loading ? (
          <div className="ih-mono-sm" style={{ color: "var(--ih-muted)" }}>loading…</div>
        ) : feed.length === 0 && questions.length === 0 && loadFailed ? (
          <div className="ih-mono-sm" style={{ color: "var(--ih-muted)" }}>
            couldn&apos;t load your agent&apos;s messages. <button type="button" className="ih-link" onClick={retry}>try again</button>
          </div>
        ) : feed.length === 0 && questions.length === 0 ? (
          <div className="ih-mono-sm" style={{ color: "var(--ih-muted)", lineHeight: 1.6 }}>
            ask about your matches, share a preference, or tell your agent what to look for.
          </div>
        ) : feed.map((piece, index) => {
          const at = timeById.get(piece.id);
          if (piece.kind === "discovery") {
            const summary = typeof piece.discovered === "number" ? `${discoverySummary(piece.discovered, piece.reached)}.` : piece.progress;
            return (
              <div key={piece.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {piece.loading.map((line) => (
                  <div key={line} className="ih-mono-sm">{line.endsWith(".") ? line : `${line}.`}</div>
                ))}
                {piece.plan && <div className="ih-found" style={{ marginTop: 0 }}>{piece.plan}</div>}
                {piece.queries.length > 0 && (
                  <>
                    <div className="ih-mono-sm">ran {piece.queries.length} {piece.queries.length === 1 ? "query" : "queries"}</div>
                    {piece.queries.map((query) => <div key={query} className="ih-query">{query}</div>)}
                  </>
                )}
                {summary && <div className="ih-found">{summary}</div>}
              </div>
            );
          }
          if (piece.kind === "user") {
            return (
              <div key={piece.id}>
                <Message who="you" at={at} mine><Markdown text={piece.text} /></Message>
                {waiting && index > firstWaiting && <div className="ih-msg-meta" style={{ marginTop: 4 }}>queued</div>}
              </div>
            );
          }
          if (piece.kind === "progress") {
            return <div key={piece.id} className="ih-mono-sm">· {piece.text}</div>;
          }
          if (piece.kind === "open-question") {
            const { question } = piece;
            const id = question.questionId;
            const answer = selections[id] || "";
            const own = !question.options.includes(answer) && answer;
            const write = writing[id] || question.options.length === 0;
            const opportunityId = question.matches?.[0]?.opportunityId;
            return (
              <div key={piece.id} className="ih-msg">
                <div className="ih-msg-meta">
                  QUESTION · {opportunityId
                    ? <button type="button" className="ih-link" style={{ letterSpacing: "inherit" }} onClick={() => onSelectMatch(opportunityId)}>{askerLabel(question).toUpperCase()}</button>
                    : askerLabel(question).toUpperCase()}
                  {at && <time dateTime={at}> · {formatChatClock(at)}</time>}
                </div>
                <div className="ih-msg-body">
                  {question.text}
                  <div className="ih-options">
                    {question.options.map((option) => (
                      <button key={option} type="button" className={`ih-option${answer === option ? " on" : ""}`}
                        onClick={() => {
                          setSelections((current) => ({ ...current, [id]: current[id] === option ? "" : option }));
                          setWriting((current) => ({ ...current, [id]: false }));
                        }}>{option}</button>
                    ))}
                    {write ? (
                      <input
                        autoFocus={question.options.length > 0}
                        value={own ? answer : ""}
                        onChange={(event) => setSelections((current) => ({ ...current, [id]: event.target.value }))}
                        onBlur={(event) => { if (!event.currentTarget.value.trim()) setWriting((current) => ({ ...current, [id]: false })); }}
                        placeholder="write your own"
                        aria-label="Write your own answer"
                        style={{ flex: "1 1 200px", minWidth: 160, border: "1px solid var(--ih-control)", borderRadius: 3, background: "#fff", padding: "4px 10px", font: "400 12px var(--ih-mono)", color: "var(--ih-ink)", outline: "none" }}
                      />
                    ) : (
                      <button type="button" className="ih-option" onClick={() => {
                        setSelections((current) => ({ ...current, [id]: "" }));
                        setWriting((current) => ({ ...current, [id]: true }));
                      }}>write your own</button>
                    )}
                  </div>
                </div>
              </div>
            );
          }
          if (piece.kind === "answered-question") {
            return (
              <div key={piece.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Message who={`answered · ${askerLabel(piece.question)}`} at={at}>{piece.question.text}</Message>
                <div className="ih-msg-body mine">{piece.answer}</div>
              </div>
            );
          }
          return <Message key={piece.id} who="your agent" at={at}><Markdown text={piece.text} /></Message>;
        })}
        {waiting && <div className="ih-mono-sm">· thinking…</div>}
        <div ref={endRef} />
      </div>

      {chosen.length > 0 && (
        <div className="ih-answers">
          <span>
            {questions.length - chosen.length > 0 ? `${questions.length - chosen.length} of ${questions.length} unanswered` : "all answered · ready to send"}
          </span>
          <button type="button" className="ih-ghost" style={{ padding: "4px 10px", font: "500 11px var(--ih-sans)" }} disabled={sending} onClick={() => void sendAnswers()}>
            {sending ? "sending…" : chosen.length > 1 ? `send ${chosen.length} answers` : "send answer"}
          </button>
        </div>
      )}

      <form className="ih-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
          placeholder="message your agent…"
          aria-label="Message your agent"
          style={{ flex: 1, border: "none", outline: "none", resize: "none", background: "transparent", padding: "14px 0", font: "400 12.5px var(--ih-mono)", color: "var(--ih-ink)" }}
        />
        <button type="submit" className="ih-send" aria-label="send" title="send" disabled={!draft.trim() || sending}>↑</button>
      </form>
    </div>
  );
}
