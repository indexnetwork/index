import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useConversations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import { AGENT_DM_ID, type ConversationMessage, type PersonalAgentState, type PrincipalQuestion } from "@/services/conversation";
import { AgentFeedNote, AgentPortrait, DiscoveryTrace, OptionChip, WriteOwn, parseDiscovery } from "@/components/workbench/mac-blocks";

type Provenance = { kind?: string; questionId?: string; scope?: string; matches?: PrincipalQuestion["matches"] };

function messageText(message: ConversationMessage): string {
  return (message.parts as { kind?: string; text?: string }[])
    .filter((part) => part?.kind === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

type FeedPiece =
  | { kind: "user" | "note" | "progress"; id: string; text: string }
  | { kind: "discovery"; id: string; loading: string[]; plan: string; queries: string[]; discovered: number | null; reached: number | null; progress: string };

function isLoadingLine(text: string) {
  const line = text.endsWith(".") ? text.slice(0, -1) : text;
  return line === "Warming up" || line === "Working out who to reach";
}

/** Same classification as the Mac signal inbox: progress folds into one discovery trace, briefs stay inside it. */
function signalFeed(messages: ConversationMessage[], carded: Set<string>): FeedPiece[] {
  const feed: FeedPiece[] = [];
  let block: Extract<FeedPiece, { kind: "discovery" }> | null = null;
  const flush = () => { block = null; };
  for (const message of messages) {
    const text = messageText(message).trim();
    const provenance = message.metadata?.principalMessage as Provenance | undefined;
    if (!text) continue;
    if (message.role === "agent" && provenance?.kind === "message" && (text.startsWith("Stall: ") || text.startsWith("Resolved: "))) continue;
    if (provenance?.kind === "question" && provenance.questionId && carded.has(provenance.questionId)) continue;
    if (provenance?.kind === "question") {
      flush();
      feed.push({ kind: "note", id: message.id, text });
      continue;
    }
    if (provenance?.kind === "answer") {
      flush();
      feed.push({ kind: "user", id: message.id, text });
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
  return feed;
}

/** One private intent conversation; every open question is answered in a single submit. */
function questionAsker(question: PrincipalQuestion) {
  const people = (question.matches ?? [])
    .map((match) => match.counterparty)
    .filter((person): person is { id: string; name: string } => Boolean(person?.id && person.name));
  if (people.length === 1) return { label: `${people[0].name}'s agent`, owner: people[0] };
  if (people.length > 1) return { label: `${people.map((person) => person.name).join(", ")}'s agents`, owner: null };
  return { label: question.scope === "match" ? "this match's agent" : "your agent", owner: null };
}

export default function IntentNegotiatorChat({ intentId, onSelectMatch }: { intentId: string; onSelectMatch(opportunityId: string): void }) {
  const { user } = useAuthContext();
  const conversations = useConversations();
  const { subscribeConversationMessage, isConnected } = useConversation();
  const [draft, setDraft] = useState("");
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, boolean>>({});
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [agent, setAgent] = useState<PersonalAgentState>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const requests = useRef({ generation: 0, mounted: false });
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const questions = agent?.questions ?? [];
  const carded = new Set(questions.map((question) => question.id));
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
    } catch {
      // Keep the last good transcript; the stream or the next read reconciles it.
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

  const choose = (questionId: string, text: string) => {
    setSelections((current) => ({ ...current, [questionId]: current[questionId] === text ? "" : text }));
  };

  const feed = useMemo(() => signalFeed(messages, carded), [messages, questions]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} data-testid="intent-negotiator-chat">
      <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 22 }}>
      {loading ? <p style={{ fontFamily: "var(--mac-mono)", fontSize: 12 }}>loading…</p>
        : feed.length === 0 && questions.length === 0 ? <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>
          Ask about your matches, share a preference, or give your agent direction for this signal.
        </p> : feed.map((piece) => {
          if (piece.kind === "discovery") {
            return <DiscoveryTrace key={piece.id} loading={piece.loading} plan={piece.plan} queries={piece.queries} discovered={piece.discovered} reached={piece.reached} progress={piece.progress} />;
          }
          if (piece.kind === "user") {
            return (
              <div key={piece.id} style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{ maxWidth: "92%", padding: "11px 14px", background: "#2a2a2a", color: "#fff", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.5 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{piece.text}</ReactMarkdown>
                </div>
              </div>
            );
          }
          if (piece.kind === "progress") {
            return <p key={piece.id} style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>· {piece.text}</p>;
          }
          return (
            <AgentFeedNote key={piece.id}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{piece.text}</ReactMarkdown>
            </AgentFeedNote>
          );
        })}

      {questions.map((question) => {
        const asker = questionAsker(question);
        const owner = asker.owner;
        return (
        <article key={question.id} style={{ display: "flex", gap: 12 }}>
          <AgentPortrait id={owner?.id ?? user?.id} name={owner?.name ?? user?.name} photo={owner ? null : user?.avatar} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5 }}>
              <span style={{ background: "#111", color: "#fff", padding: "2px 6px", borderRadius: 3, fontFamily: "var(--mac-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em" }}>QUESTION</span>
              <button type="button" onClick={() => { const id = question.matches?.[0]?.opportunityId; if (id) onSelectMatch(id); }} style={{ background: "none", border: "none", padding: 0, cursor: question.matches?.[0] ? "pointer" : "default", fontFamily: "var(--mac-mono)", fontSize: 11, color: "#8f8f88", textTransform: "uppercase", letterSpacing: "0.05em" }}>{asker.label}</button>
            </div>
            <p style={{ margin: 0, maxWidth: "92%", fontFamily: "var(--mac-sans)", fontSize: 14, fontWeight: 600, lineHeight: 1.55, color: "#2a2a2a" }}>{question.question}</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {question.options?.map((option) => (
              <OptionChip key={option} label={option} selected={selections[question.id] === option && !writing[question.id]}
                onClick={() => { choose(question.id, option); setWriting((current) => ({ ...current, [question.id]: false })); }} />
            ))}
            <WriteOwn
              open={!!writing[question.id]}
              value={question.options?.includes(selections[question.id] ?? "") ? "" : selections[question.id] ?? ""}
              onOpen={() => setWriting((current) => ({ ...current, [question.id]: true }))}
              onChange={(value) => setSelections((current) => ({ ...current, [question.id]: value }))}
              onClose={() => setWriting((current) => ({ ...current, [question.id]: false }))}
            />
          </div>
          </div>
        </article>
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
          placeholder="Message your personal agent…"
          aria-label="Message your personal agent"
          style={{ flex: 1, border: "none", resize: "none", outline: "none", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4, background: "transparent", padding: "4px 0" }} />
        <button type="submit" disabled={!draft.trim() || sending} aria-label="send" title="send" style={{ background: "none", border: "none", color: draft.trim() && !sending ? "#111" : "#b9b3a4", cursor: draft.trim() ? "pointer" : "default" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="12" y1="20" x2="12" y2="5" /><polyline points="5,12 12,5 19,12" /></svg>
        </button>
      </form>
    </div>
  );
}
