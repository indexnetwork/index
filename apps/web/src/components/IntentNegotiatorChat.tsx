import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useConversations } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { AGENT_DM_ID, type ConversationMessage, type PersonalAgentState, type PrincipalQuestion } from "@/services/conversation";
import { AgentFeedNote, DiscoveryTrace, OptionChip, parseDiscovery } from "@/components/workbench/mac-blocks";
import { MyAgentAvatar, TheirAgentAvatar, agentLabel } from "@/components/workbench/agent-avatar";
import { EmptyState } from "@/components/ui/EmptyState";

type Provenance = {
  kind?: string;
  questionId?: string;
  scope?: string;
  options?: string[];
  matches?: PrincipalQuestion["matches"];
};

type QuestionCard = {
  questionId: string;
  text: string;
  options: string[];
  scope?: string;
  matches: PrincipalQuestion["matches"];
};

function messageText(message: ConversationMessage): string {
  return (message.parts as { kind?: string; text?: string }[])
    .filter((part) => part?.kind === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

type FeedPiece =
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

/** Same classification as the Mac signal inbox: a question stays where it was asked, and its answer sits on that card. */
function signalFeed(messages: ConversationMessage[], questions: PrincipalQuestion[]): FeedPiece[] {
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
    if (message.role === "agent" && provenance?.kind === "message" && (text.startsWith("Stall: ") || text.startsWith("Resolved: "))) continue;
    if (provenance?.kind === "answer" && provenance.questionId && answers.has(provenance.questionId)) continue;
    if (provenance?.kind === "question" && provenance.questionId) {
      flush();
      const question = questionCard(provenance, text, live.get(provenance.questionId));
      seen.add(provenance.questionId);
      const answer = answers.get(provenance.questionId);
      if (live.has(provenance.questionId)) feed.push({ kind: "open-question", id: message.id, question });
      else if (answer) feed.push({ kind: "answered-question", id: `answered-${provenance.questionId}`, question, answer });
      continue;
    }
    if (text.startsWith("Brief: ") || text.startsWith("Decision: ")) continue;
    if (message.role === "user") {
      flush();
      feed.push({ kind: "user", id: message.id, text });
      continue;
    }
    if (text.startsWith("Progress: ")) {
      const body = text.slice("Progress: ".length);
      if (isLoadingLine(body)) {
        if (!block) {
          block = { kind: "discovery", id: message.id, loading: [], plan: "", queries: [], discovered: null, reached: null, progress: "" };
          feed.push(block);
        }
        block.loading.push(body);
        continue;
      }
      const trace = parseDiscovery(body);
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
      feed.push({ kind: "progress", id: message.id, text: body });
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
function questionAsker(question: { scope?: string; matches?: PrincipalQuestion["matches"] }) {
  const people = (question.matches ?? [])
    .map((match) => match.counterparty)
    .filter((person): person is { id: string; name: string } => Boolean(person?.name));
  if (people.length === 1) return { label: agentLabel(people[0].name), owner: people[0] };
  if (people.length > 1) return { label: `${people.map((person) => person.name).join(", ")}’s agents`, owner: null };
  return { label: question.scope === "match" ? "this match’s agent" : "your agent", owner: null };
}

function questionAskerLabel(question: QuestionCard, label: string, onSelectMatch?: (opportunityId: string) => void) {
  const opportunityId = question.matches?.[0]?.opportunityId;
  const style = { fontFamily: "var(--mac-mono)", fontSize: 11, color: "#8f8f88", textTransform: "uppercase" as const, letterSpacing: "0.05em" };
  if (!onSelectMatch || !opportunityId) return <span style={style}>{label}</span>;
  return <button type="button" onClick={() => onSelectMatch(opportunityId)} style={{ ...style, background: "none", border: "none", padding: 0, cursor: "pointer" }}>{label}</button>;
}

function OpenQuestion({ question, selections, setSelections, writing, setWriting, onSelectMatch }: {
  question: QuestionCard;
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
    <article style={{ display: "flex", gap: 12 }}>
      {owner ? <TheirAgentAvatar owner={owner} size={30} style={{ marginTop: 2 }} /> : <MyAgentAvatar size={30} style={{ marginTop: 2 }} />}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5 }}>
            <span style={{ background: "#111", color: "#fff", padding: "2px 6px", borderRadius: 3, fontFamily: "var(--mac-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em" }}>QUESTION</span>
            {questionAskerLabel(question, asker.label, onSelectMatch)}
          </div>
          <div style={{ maxWidth: "92%", fontFamily: "var(--mac-sans)", fontSize: 14, fontWeight: 600, lineHeight: 1.55, color: "#2a2a2a" }}>{question.text}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
              onBlur={(event) => { if (!event.currentTarget.value.trim()) setWriting((current) => ({ ...current, [id]: false })); }}
              onKeyDown={(event) => { if (event.key === "Escape" && !event.currentTarget.value.trim()) setWriting((current) => ({ ...current, [id]: false })); }}
              placeholder="write your own"
              aria-label="Write your own answer"
              style={{ flex: "1 1 220px", minWidth: 180, minHeight: 36, border: "1px solid #000", padding: "8px 14px", fontFamily: "var(--mac-mono)", fontSize: 12, color: "#111", outline: "none" }}
            />
          ) : (
            <OptionChip write label="write your own" onClick={() => {
              setSelections((current) => ({ ...current, [id]: "" }));
              setWriting((current) => ({ ...current, [id]: true }));
            }} />
          )}
        </div>
      </div>
    </article>
  );
}

function AnsweredQuestion({ question, answer }: {
  question: QuestionCard;
  answer: string;
}) {
  const asker = questionAsker(question);
  const owner = asker.owner;
  return (
    <article style={{ display: "flex", gap: 12 }}>
      {owner ? <TheirAgentAvatar owner={owner} size={30} style={{ marginTop: 2 }} /> : <MyAgentAvatar size={30} style={{ marginTop: 2 }} />}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5, fontFamily: "var(--mac-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <span style={{ color: "#2f7d4f", fontWeight: 600 }}>✓ answered</span>
            <span style={{ color: "#8f8f88" }}>{asker.label}</span>
          </div>
          <div style={{ maxWidth: "92%", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.55, color: "#2a2a2a" }}>{question.text}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ maxWidth: "92%", padding: "11px 14px", background: "#2a2a2a", color: "#fff", borderRadius: "4px 4px 2px 4px", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.5, wordBreak: "break-word" }}>{answer}</div>
        </div>
      </div>
    </article>
  );
}

export default function IntentNegotiatorChat({ intentId, onSelectMatch }: { intentId: string; onSelectMatch(opportunityId: string): void }) {
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
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const questions = agent?.questions ?? [];
  // Read off the questions on screen, so a selection whose question is gone
  // counts for nothing and is never sent.
  const chosen = questions.filter((question) => selections[question.id]?.trim());

  const mergeMessages = useCallback((incoming: ConversationMessage[]) => {
    setMessages((previous) => [...new Map([...previous, ...incoming].map((message) => [message.id, message])).values()]
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

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages.length, questions.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setSending(true);
    try {
      mergeMessages([await conversations.sendMessage(AGENT_DM_ID, [{ kind: "text", text }], { metadata: { intentId } })]);
    } catch {
      // Nothing to say: the refresh below is the transcript's only truth.
    } finally {
      await refresh();
      setSending(false);
      inputRef.current?.focus();
    }
  };

  /** Send every answered question as one write, so the agent decides from all of them at once. */
  const sendAnswers = async () => {
    if (!chosen.length || sending) return;
    const answers = chosen.map((question) => ({ questionId: question.id, text: selections[question.id]!.trim() }));
    setSelections({});
    setWriting({});
    setSending(true);
    try {
      mergeMessages(await conversations.sendAnswers(intentId, answers));
    } catch {
      // Nothing to say: the refresh below is the transcript's only truth.
    } finally {
      await refresh();
      setSending(false);
    }
  };

  const feed = useMemo(() => signalFeed(messages, questions), [messages, questions]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} data-testid="intent-negotiator-chat">
      <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 22 }}>
      {loading ? <EmptyState tone="loading" align="start" style={{ padding: 0 }} />
        : feed.length === 0 && questions.length === 0 && loadFailed ? (
          <EmptyState
            tone="error"
            align="start"
            style={{ padding: 0 }}
            message="couldn't load your agent's messages."
            action={{ label: "try again", onClick: () => { setLoading(true); void refresh(); } }}
          />
        ) : feed.length === 0 && questions.length === 0 ? <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>
          ask about your matches, share a preference, or tell your agent what to look for.
        </p> : feed.map((piece) => {
          if (piece.kind === "discovery") {
            return <DiscoveryTrace key={piece.id} loading={piece.loading} plan={piece.plan} queries={piece.queries} discovered={piece.discovered} reached={piece.reached} progress={piece.progress} />;
          }
          if (piece.kind === "user") {
            return (
              <div key={piece.id} style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{ maxWidth: "92%", padding: "11px 14px", background: "#2a2a2a", color: "#fff", borderRadius: "4px 4px 2px 4px", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.5, wordBreak: "break-word" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{piece.text}</ReactMarkdown>
                </div>
              </div>
            );
          }
          if (piece.kind === "progress") {
            return <p key={piece.id} style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>· {piece.text}</p>;
          }
          if (piece.kind === "open-question") {
            return (
              <OpenQuestion key={piece.id} question={piece.question} selections={selections} setSelections={setSelections} writing={writing} setWriting={setWriting} onSelectMatch={onSelectMatch} />
            );
          }
          if (piece.kind === "answered-question") {
            return <AnsweredQuestion key={piece.id} question={piece.question} answer={piece.answer} />;
          }
          return (
            <AgentFeedNote key={piece.id}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{piece.text}</ReactMarkdown>
            </AgentFeedNote>
          );
        })}
      <div ref={endRef} />
      </div>

      {chosen.length > 0 && (
        <div style={{ borderTop: "1px solid #000", padding: "10px 14px", background: "#fff", display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: 12 }}>
          <button type="button" disabled={!chosen.length || sending} onClick={() => void sendAnswers()} style={{
            fontFamily: "var(--mac-mono)", fontSize: 12, padding: "8px 18px",
            background: !sending ? "#111" : "#fff", color: !sending ? "#fff" : "#999", border: "1px solid #000",
          }}>{sending ? "sending…" : chosen.length > 1 ? `send ${chosen.length} answers` : "send answer"}</button>
          <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: "#8f8f88" }}>
            {questions.length - chosen.length > 0 ? `${questions.length - chosen.length} of ${questions.length} unanswered` : "all answered · ready to send"}
          </span>
        </div>
      )}

      <form onSubmit={(event) => { event.preventDefault(); void send(); }} style={{ display: "flex", gap: 10, alignItems: "flex-end", borderTop: "1px solid #000", background: "#fff", padding: "7px 12px 8px" }}>
        <textarea ref={inputRef} rows={1} value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
          placeholder="message your agent…"
          aria-label="Message your agent"
          style={{ flex: 1, border: "none", resize: "none", outline: "none", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4, background: "transparent", padding: "4px 0" }} />
        <button type="submit" disabled={!draft.trim() || sending} aria-label="send" title="send" style={{ background: "none", border: "none", color: draft.trim() && !sending ? "#111" : "#b9b3a4", cursor: draft.trim() ? "pointer" : "default" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="12" y1="20" x2="12" y2="5" /><polyline points="5,12 12,5 19,12" /></svg>
        </button>
      </form>
    </div>
  );
}
