import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useConversations } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { AGENT_DM_ID, type ConversationMessage, type PersonalAgentState, type PrincipalQuestion } from "@/services/conversation";
import { AgentFeedNote, DiscoveryTrace, OptionChip, parseDiscovery } from "@/components/workbench/mac-blocks";
import { MyAgentAvatar, TheirAgentAvatar, agentLabel } from "@/components/workbench/agent-avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatChatClock } from "@/lib/utils";

type Provenance = {
  kind?: string;
  record?: "brief" | "decision" | "stall" | "resolution" | "progress";
  questionId?: string;
  scope?: string;
  options?: string[];
  matches?: PrincipalQuestion["matches"];
};

export type QuestionCard = {
  questionId: string;
  text: string;
  options: string[];
  scope?: string;
  matches: PrincipalQuestion["matches"];
};

/** Id prefix of a message shown before the server has confirmed it. */
const PENDING = "pending-";

function messageText(message: ConversationMessage): string {
  return (message.parts as { kind?: string; text?: string }[])
    .filter((part) => part?.kind === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

export type FeedPiece =
  | { kind: "user" | "note" | "progress"; id: string; text: string }
  | { kind: "discovery"; id: string; loading: string[]; plan: string; queries: string[]; discovered: number | null; reached: number | null; progress: string }
  | { kind: "open-question"; id: string; question: QuestionCard }
  | { kind: "answered-question"; id: string; question: QuestionCard; answer: string };

function isLoadingLine(text: string) {
  const line = text.endsWith(".") ? text.slice(0, -1) : text;
  return line === "Warming up" || line === "Working out who to reach";
}

function questionCard(provenance: Provenance, text: string, live?: PrincipalQuestion): QuestionCard {
  return {
    questionId: provenance.questionId || live?.id || "",
    text: live?.question || text,
    options: live?.options ?? provenance.options ?? [],
    scope: live?.scope ?? provenance.scope,
    matches: live?.matches ?? provenance.matches ?? [],
  };
}

/** Same classification as the Mac intent inbox: a question stays where it was asked, and its answer sits on that card. */
function intentFeed(messages: ConversationMessage[], questions: PrincipalQuestion[]): FeedPiece[] {
  const live = new Map(questions.map((question) => [question.id, question]));
  const answers = new Map<string, string>();
  for (const message of messages) {
    const provenance = message.metadata?.principalMessage as Provenance | undefined;
    const text = messageText(message).trim();
    if (provenance?.kind === "answer" && provenance.questionId && text) answers.set(provenance.questionId, text);
  }
  const feed: FeedPiece[] = [];
  const seen = new Set<string>();
  let block: Extract<FeedPiece, { kind: "discovery" }> | null = null;
  const flush = () => { block = null; };
  for (const message of messages) {
    const text = messageText(message).trim();
    const provenance = message.metadata?.principalMessage as Provenance | undefined;
    if (!text) continue;
    if (provenance?.record === "stall" || provenance?.record === "resolution") continue;
    if (provenance?.kind === "answer" && provenance.questionId && answers.has(provenance.questionId)) continue;
    if (provenance?.kind === "question" && provenance.questionId) {
      flush();
      const question = questionCard(provenance, text, live.get(provenance.questionId));
      seen.add(provenance.questionId);
      const answer = answers.get(provenance.questionId);
      if (live.has(provenance.questionId)) feed.push({ kind: "open-question", id: message.id, question });
      else if (answer) feed.push({ kind: "answered-question", id: message.id, question, answer });
      continue;
    }
    if (provenance?.record === "brief" || provenance?.record === "decision") continue;
    if (message.role === "user") {
      flush();
      feed.push({ kind: "user", id: message.id, text });
      continue;
    }
    if (provenance?.record === "progress") {
      if (isLoadingLine(text)) {
        if (!block) {
          block = { kind: "discovery", id: message.id, loading: [], plan: "", queries: [], discovered: null, reached: null, progress: "" };
          feed.push(block);
        }
        block.loading.push(text);
        continue;
      }
      const trace = parseDiscovery(text);
      if (trace && (trace.plan || trace.queries.length || trace.discovered != null)) {
        if (block && !block.plan && !block.queries.length && block.discovered == null) {
          block.plan = trace.plan;
          block.queries = trace.queries;
          block.discovered = trace.discovered;
          block.reached = trace.reached;
          continue;
        }
        flush();
        feed.push({ kind: "discovery", id: message.id, loading: [], progress: "", ...trace });
        continue;
      }
      flush();
      feed.push({ kind: "progress", id: message.id, text });
      continue;
    }
    flush();
    feed.push({ kind: "note", id: message.id, text });
  }
  for (const question of questions) {
    if (seen.has(question.id)) continue;
    feed.push({
      kind: "open-question",
      id: question.id,
      question: { questionId: question.id, text: question.question, options: question.options ?? [], scope: question.scope, matches: question.matches },
    });
  }
  return feed;
}

/** One private intent conversation; every open question is answered in a single submit. */
export function questionAsker(question: { scope?: string; matches?: PrincipalQuestion["matches"] }) {
  const people = (question.matches ?? [])
    .map((match) => match.counterparty)
    .filter((person): person is { id: string; name: string } => Boolean(person?.name));
  if (people.length === 1) return { label: agentLabel(people[0].name), owner: people[0] };
  if (people.length > 1) return { label: `${people.map((person) => person.name).join(", ")}’s agents`, owner: null };
  return { label: question.scope === "match" ? "this match’s agent" : "your agent", owner: null };
}

function questionAskerLabel(question: QuestionCard, label: string, onSelectMatch?: (opportunityId: string) => void) {
  const opportunityId = question.matches?.[0]?.opportunityId;
  const style = { fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase" as const, letterSpacing: "0.08em" };
  if (!onSelectMatch || !opportunityId) return <span style={style}>{label}</span>;
  return <button type="button" onClick={() => onSelectMatch(opportunityId)} style={{ ...style, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>{label}</button>;
}

/**
 * Scrolls the question being answered to the top of its feed once the
 * keyboard has opened, so the question and its field both stay in view.
 */
function revealQuestion(field: HTMLElement) {
  const reveal = () => {
    const pane = field.closest(".mac-scroll");
    if (!(pane instanceof HTMLElement)) return;
    const paneTop = pane.getBoundingClientRect().top;
    const cardTop = (field.closest("article") ?? field).getBoundingClientRect().top - paneTop;
    const fieldBottom = field.getBoundingClientRect().bottom - paneTop;
    // The field wins when the whole card doesn't fit above the keyboard.
    let shift = cardTop - 12;
    if (fieldBottom - shift > pane.clientHeight) shift = fieldBottom - pane.clientHeight + 12;
    if (Math.abs(shift) > 2) pane.scrollBy({ top: shift, behavior: "smooth" });
  };
  window.visualViewport?.addEventListener("resize", reveal, { once: true });
  window.setTimeout(reveal, 350);
}

function OpenQuestion({ question, at, selections, setSelections, writing, setWriting, onSelectMatch }: {
  question: QuestionCard;
  at?: string;
  selections: Record<string, string>;
  setSelections: Dispatch<SetStateAction<Record<string, string>>>;
  writing: Record<string, boolean>;
  setWriting: Dispatch<SetStateAction<Record<string, boolean>>>;
  onSelectMatch(opportunityId: string): void;
}) {
  const id = question.questionId;
  const options = question.options;
  const answer = selections[id] || "";
  const asker = questionAsker(question);
  const owner = asker.owner;
  const own = !options.includes(answer) && answer;
  const write = writing[id] || options.length === 0;
  return (
    <article className="wb-stamped" style={{ display: "flex", gap: 10 }}>
      {owner ? <TheirAgentAvatar owner={owner} size={20} style={{ marginTop: 1 }} /> : <MyAgentAvatar size={20} style={{ marginTop: 1 }} />}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.08em" }}>
          <span>QUESTION</span>
          <span aria-hidden>·</span>
          {questionAskerLabel(question, asker.label, onSelectMatch)}
          {at && <time className="wb-stamp" dateTime={at} style={{ letterSpacing: 0 }}>{formatChatClock(at)}</time>}
        </div>
        <div style={{ background: "var(--wb-selected)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontFamily: "var(--wb-code)", fontSize: 12.5, lineHeight: 1.6, color: "var(--ink)", wordBreak: "break-word" }}>{question.text}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {options.map((option) => (
            <OptionChip key={option} label={option} selected={answer === option}
              onClick={() => {
                setSelections((current) => ({ ...current, [id]: current[id] === option ? "" : option }));
                setWriting((current) => ({ ...current, [id]: false }));
              }} />
          ))}
          {write ? (
            <input
              autoFocus={options.length > 0}
              value={own ? answer : ""}
              onChange={(event) => setSelections((current) => ({ ...current, [id]: event.target.value }))}
              onFocus={(event) => revealQuestion(event.currentTarget)}
              onBlur={(event) => { if (!event.currentTarget.value.trim()) setWriting((current) => ({ ...current, [id]: false })); }}
              onKeyDown={(event) => { if (event.key === "Escape" && !event.currentTarget.value.trim()) setWriting((current) => ({ ...current, [id]: false })); }}
              placeholder="write your own"
              aria-label="Write your own answer"
              style={{ flex: "1 1 200px", minWidth: 160, background: "#fff", padding: "4px 10px", fontFamily: "var(--wb-code)", fontSize: 12, color: "var(--ink)", outline: "none" }}
            />
          ) : (
            <OptionChip write label="write your own" onClick={() => {
              setSelections((current) => ({ ...current, [id]: "" }));
              setWriting((current) => ({ ...current, [id]: true }));
            }} />
          )}
        </div>
        </div>
      </div>
    </article>
  );
}

function AnsweredQuestion({ question, answer, at }: {
  question: QuestionCard;
  at?: string;
  answer: string;
}) {
  const asker = questionAsker(question);
  const owner = asker.owner;
  return (
    <article className="wb-stamped" style={{ display: "flex", gap: 10 }}>
      {owner ? <TheirAgentAvatar owner={owner} size={20} style={{ marginTop: 1 }} /> : <MyAgentAvatar size={20} style={{ marginTop: 1 }} />}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          <span style={{ color: "var(--wb-live)" }}>✓ answered</span>
          <span aria-hidden>·</span>
          <span>{asker.label}</span>
          {at && <time className="wb-stamp" dateTime={at} style={{ textTransform: "none", letterSpacing: 0 }}>{formatChatClock(at)}</time>}
        </div>
        <div style={{ background: "var(--wb-selected)", padding: "10px 12px", fontFamily: "var(--wb-code)", fontSize: 12.5, lineHeight: 1.6, color: "var(--ink)", wordBreak: "break-word" }}>{question.text}</div>
        <div style={{ marginTop: 4, padding: "10px 12px", background: "#fff", border: "1px solid var(--wb-hairline)", fontFamily: "var(--wb-code)", fontSize: 12.5, lineHeight: 1.6, color: "var(--ink)", wordBreak: "break-word" }}>{answer}</div>
      </div>
    </article>
  );
}

/** The intent's private agent conversation: transcript, open questions, and the two ways to write back. */
export function useIntentAgentChat(intentId: string) {
  const conversations = useConversations();
  const { subscribeConversationMessage, isConnected } = useConversation();
  const [draft, setDraft] = useState("");
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, boolean>>({});
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [agent, setAgent] = useState<PersonalAgentState>();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const requests = useRef({ generation: 0, mounted: false });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // An answer in the transcript settles its question, even while the server's list still holds it.
  const answered = new Set(messages.map((message) => (message.metadata?.principalMessage as Provenance | undefined)).filter((provenance) => provenance?.kind === "answer").map((provenance) => provenance!.questionId));
  const questions = (agent?.questions ?? []).filter((question) => !answered.has(question.id));
  // Read off the questions on screen, so a selection whose question is gone
  // counts for nothing and is never sent.
  const chosen = questions.filter((question) => selections[question.id]?.trim());

  const mergeMessages = useCallback((incoming: ConversationMessage[]) => {
    // A pending message gives way to the real one with the same text (and question, for an answer), whichever arrives first.
    const same = (message: ConversationMessage) => `${(message.metadata?.principalMessage as Provenance | undefined)?.questionId ?? ""}\n${messageText(message)}`;
    const real = new Set(incoming.filter((message) => message.role === "user" && !message.id.startsWith(PENDING)).map(same));
    setMessages((previous) => [...new Map([...previous.filter((message) => !message.id.startsWith(PENDING) || !real.has(same(message))), ...incoming].map((message) => [message.id, message])).values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
  }, []);

  const refresh = useCallback(async () => {
    if (!requests.current.mounted) return;
    const current = ++requests.current.generation;
    try {
      const loaded = await conversations.getMessages(AGENT_DM_ID, { intentId });
      if (current !== requests.current.generation) return;
      setConversationId(loaded.conversationId);
      mergeMessages(loaded.messages);
      setAgent(loaded.agent);
      setLoadFailed(false);
    } catch {
      // Keep the last good transcript; the stream or the next read reconciles it.
      // Only an empty transcript surfaces the failure (see the render below).
      if (current === requests.current.generation) setLoadFailed(true);
    } finally {
      if (current === requests.current.generation) setLoading(false);
    }
  }, [conversations, intentId, mergeMessages, requests]);

  useEffect(() => {
    const state = requests.current;
    state.mounted = true;
    void Promise.resolve().then(refresh);
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => { state.mounted = false; state.generation++; clearInterval(timer); };
  }, [refresh, isConnected, requests]);

  useEffect(() => subscribeConversationMessage(({ conversationId: id, message }) => {
    if (id !== conversationId || message.metadata?.intentId !== intentId) return;
    mergeMessages([message]);
    void refresh();
  }), [conversationId, intentId, mergeMessages, refresh, subscribeConversationMessage]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setSending(true);
    const parts = [{ kind: "text", text }];
    const pendingId = `${PENDING}${Date.now()}`;
    mergeMessages([{ id: pendingId, conversationId: conversationId ?? AGENT_DM_ID, senderId: "", role: "user", parts, metadata: { intentId }, createdAt: new Date().toISOString() }]);
    try {
      mergeMessages([await conversations.sendMessage(AGENT_DM_ID, parts, { metadata: { intentId } })]);
    } catch {
      // The refresh below is the transcript's only truth.
    } finally {
      setMessages((previous) => previous.filter((message) => message.id !== pendingId));
      setSending(false);
      inputRef.current?.focus();
      void refresh();
    }
  };

  /** Send every answered question as one write, so the agent decides from all of them at once. */
  const sendAnswers = async () => {
    if (!chosen.length || sending) return;
    const answers = chosen.map((question) => ({ questionId: question.id, text: selections[question.id]!.trim() }));
    const previous = { selections, writing };
    // Shown at once; each gives way to the real message, which names the same question.
    const pending = answers.map(({ questionId, text }): ConversationMessage => ({
      id: `${PENDING}${questionId}`, conversationId: conversationId ?? AGENT_DM_ID, senderId: "", role: "user",
      parts: [{ kind: "text", text }], metadata: { intentId, principalMessage: { kind: "answer", questionId } }, createdAt: new Date().toISOString(),
    }));
    mergeMessages(pending);
    setSelections({});
    setWriting({});
    setSending(true);
    try {
      mergeMessages(await conversations.sendAnswers(intentId, answers));
    } catch {
      // Put the answers back so they can be sent again.
      setSelections(previous.selections);
      setWriting(previous.writing);
    } finally {
      const ids = new Set(pending.map((message) => message.id));
      setMessages((current) => current.filter((message) => !ids.has(message.id)));
      setSending(false);
      void refresh();
    }
  };

  const feed = useMemo(() => intentFeed(messages, questions), [messages, questions]);
  // A piece takes its time from the message it was built from; a live question with no message yet has none.
  const timeById = useMemo(() => new Map(messages.map((message) => [message.id, message.createdAt])), [messages]);
  // Only a hosted agent answers here; an external one never will, so nothing waits on it.
  const hosted = agent?.status === "hosted";
  const waiting = hosted && messages.at(-1)?.role === "user";
  let firstWaiting = feed.length;
  while (waiting && firstWaiting > 0 && feed[firstWaiting - 1].kind === "user") firstWaiting--;

  const retry = () => { setLoading(true); void refresh(); };

  return { loading, loadFailed, retry, feed, questions, chosen, selections, setSelections, writing, setWriting, draft, setDraft, send, sendAnswers, sending, waiting, firstWaiting, timeById, inputRef };
}

export default function IntentNegotiatorChat({ intentId, onSelectMatch }: { intentId: string; onSelectMatch(opportunityId: string): void }) {
  const { loading, loadFailed, retry, feed, questions, chosen, selections, setSelections, writing, setWriting, draft, setDraft, send, sendAnswers, sending, waiting, firstWaiting, timeById, inputRef } = useIntentAgentChat(intentId);
  const endRef = useRef<HTMLDivElement>(null);
  // Follow new content, not an answer: it turns its question into an answered card in place, so the feed doesn't grow.
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [feed.length]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} data-testid="intent-negotiator-chat">
      <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      {loading ? <EmptyState tone="loading" align="start" style={{ padding: 0 }} />
        : feed.length === 0 && questions.length === 0 && loadFailed ? (
          <EmptyState
            tone="error"
            align="start"
            style={{ padding: 0 }}
            message="couldn't load your agent's messages."
            action={{ label: "try again", onClick: retry }}
          />
        ) : feed.length === 0 && questions.length === 0 ? <p style={{ margin: 0, fontFamily: "var(--wb-code)", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6 }}>
          ask about your matches, share a preference, or tell your agent what to look for.
        </p> : feed.map((piece, index) => {
          const at = timeById.get(piece.id);
          if (piece.kind === "discovery") {
            return <DiscoveryTrace key={piece.id} loading={piece.loading} plan={piece.plan} queries={piece.queries} discovered={piece.discovered} reached={piece.reached} progress={piece.progress} />;
          }
          if (piece.kind === "user") {
            return (
              <div key={piece.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.08em" }}>
                  YOU{at && <time dateTime={at} title={new Date(at).toLocaleString()} style={{ letterSpacing: 0 }}> · {formatChatClock(at)}</time>}
                </div>
                <div style={{ padding: "10px 12px", background: "#fff", border: "1px solid var(--wb-hairline)", fontFamily: "var(--wb-code)", fontSize: 12.5, lineHeight: 1.6, color: "var(--ink)", wordBreak: "break-word" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{piece.text}</ReactMarkdown>
                </div>
                {waiting && index > firstWaiting && <span style={{ fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.08em" }}>queued</span>}
              </div>
            );
          }
          if (piece.kind === "progress") {
            return <p key={piece.id} style={{ margin: 0, fontFamily: "var(--wb-code)", fontSize: 12, color: "var(--ink-2)" }}>· {piece.text}</p>;
          }
          if (piece.kind === "open-question") {
            return (
              <OpenQuestion key={piece.id} at={at} question={piece.question} selections={selections} setSelections={setSelections} writing={writing} setWriting={setWriting} onSelectMatch={onSelectMatch} />
            );
          }
          if (piece.kind === "answered-question") {
            return <AnsweredQuestion key={piece.id} at={at} question={piece.question} answer={piece.answer} />;
          }
          return (
            <AgentFeedNote key={piece.id} at={at}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{piece.text}</ReactMarkdown>
            </AgentFeedNote>
          );
        })}
      {waiting && <p style={{ margin: 0, fontFamily: "var(--wb-code)", fontSize: 12, color: "var(--ink-2)" }}>· thinking…</p>}
      <div ref={endRef} />
      </div>

      {chosen.length > 0 && (
        <div style={{ borderTop: "1px solid var(--wb-hairline)", padding: "10px 16px", background: "#fff", display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: 12 }}>
          <button type="button" className="wb-btn small" disabled={!chosen.length || sending} onClick={() => void sendAnswers()}>
            {sending ? "sending…" : chosen.length > 1 ? `send ${chosen.length} answers` : "send answer"}
          </button>
          <span style={{ flex: 1, fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)" }}>
            {questions.length - chosen.length > 0 ? `${questions.length - chosen.length} of ${questions.length} unanswered` : "all answered · ready to send"}
          </span>
        </div>
      )}

      <form onSubmit={(event) => { event.preventDefault(); void send(); }} style={{ display: "flex", gap: 10, alignItems: "center", borderTop: "1px solid var(--wb-hairline)", background: "#fff", padding: "0 8px 0 16px" }}>
        <textarea ref={inputRef} rows={1} value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
          placeholder="message your agent…"
          aria-label="Message your agent"
          style={{ flex: 1, border: "none", borderRadius: 0, resize: "none", outline: "none", fontFamily: "var(--wb-code)", fontSize: 12.5, lineHeight: 1.4, color: "var(--ink)", background: "transparent", padding: "14px 0" }} />
        <button type="submit" disabled={!draft.trim() || sending} aria-label="send" title="send" style={{ background: "none", border: "none", padding: "8px 10px", fontFamily: "var(--wb-code)", fontSize: 13, fontWeight: 500, color: draft.trim() && !sending ? "var(--ink)" : "#aaa", cursor: draft.trim() ? "pointer" : "default" }}>
          ↑
        </button>
      </form>
    </div>
  );
}

