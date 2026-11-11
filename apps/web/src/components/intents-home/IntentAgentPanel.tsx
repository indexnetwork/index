import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { questionAsker, useIntentAgentChat, type QuestionCard } from "@/components/IntentNegotiatorChat";
import QuestionItem from "@/components/intents-home/QuestionItem";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import { AgentFeedNote, DiscoveryTrace } from "@/components/workbench/mac-blocks";
import { formatChatClock } from "@/lib/utils";

/** One line of the chat, drawn like Home's agent window: my avatar and a bubble, yours on the right. */
function Line({ who, at, mine = false, open = false, children }: { who: ReactNode; at?: string; mine?: boolean; open?: boolean; children: ReactNode }) {
  return (
    <div className={`pl-agent-line${mine ? " mine" : ""}${open ? " pl-agent-open" : ""}`}>
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
/** A new intent's first steps can take a while to arrive; until then it reads as warming up. */
const FRESH_MS = 30 * 60_000;

export default function IntentAgentPanel({ intentId, paused, createdAt }: {
  intentId: string;
  paused: boolean;
  createdAt?: string;
}) {
  const {
    loading, loadFailed, retry, feed, questions, draft, setDraft, send, answerOne, sending, waiting, firstWaiting, timeById, inputRef,
  } = useIntentAgentChat(intentId);
  const endRef = useRef<HTMLDivElement>(null);
  // Read once on mount: whether this intent is new enough that my first steps are still on their way.
  const [fresh] = useState(() => !paused && !!createdAt && Date.now() - new Date(createdAt).getTime() < FRESH_MS);
  // Follow new content, not an answer: it turns its question into an answered card in place.
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [feed.length]);

  const askerLabel = (question: QuestionCard) => questionAsker(question).label;

  return (
    <div className="pl pl-agent pl-intent-agent" data-testid="intent-agent-panel">
      <div className="pl-agent-head">
        <span>talk to me about this intent</span>
      </div>
      <div className="pl-agent-log">
        {loading && !fresh ? (
          <p className="pl-dim pl-small">loading…</p>
        ) : feed.length === 0 && questions.length === 0 && loadFailed ? (
          <p className="pl-dim pl-small">couldn&apos;t load this chat. <button type="button" onClick={retry}>try again</button></p>
        ) : feed.length === 0 && questions.length === 0 ? (
          // Nothing from me yet: a new intent starts on my trace, as on production; an older one on a note.
          fresh
            ? <DiscoveryTrace loading={["Warming up"]} />
            : <AgentFeedNote>ask me about your matches, share a preference, or tell me what to look for.</AgentFeedNote>
        ) : feed.map((piece, index) => {
          const at = timeById.get(piece.id);
          if (piece.kind === "discovery") {
            // How I went looking, drawn as on production: steps, the queries I ran, who I found.
            return <DiscoveryTrace key={piece.id} loading={piece.loading} plan={piece.plan} queries={piece.queries} discovered={piece.discovered} reached={piece.reached} progress={piece.progress} />;
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
            // The same question card as Home's: who's asking, the question, radios, send answer and skip.
            const { question } = piece;
            return (
              <ul key={piece.id} className="pl-cards pl-q-list pl-chat-q">
                <QuestionItem
                  question={{ id: question.questionId, question: question.text, options: question.options, scope: question.scope === "match" ? "match" : "intent", matches: question.matches ?? [], intentId }}
                  onAnswer={(_, questionId, text) => answerOne(questionId, text)}
                />
              </ul>
            );
          }
          if (piece.kind === "answered-question") {
            return (
              <div key={piece.id} className="pl-answered">
                <Line who={`answered · ${askerLabel(piece.question)}`} at={at} open>{piece.question.text}</Line>
                <Line who="you" mine>{piece.answer}</Line>
              </div>
            );
          }
          return <AgentFeedNote key={piece.id} at={at}><Markdown text={piece.text} /></AgentFeedNote>;
        })}
        {waiting && (
          <div className="pl-agent-line">
            <MyAgentAvatar size={22} />
            <div className="pl-agent-bubble pl-dim">working on it<span className="pl-blink">_</span></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

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
