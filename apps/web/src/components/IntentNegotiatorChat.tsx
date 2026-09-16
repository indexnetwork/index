import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, BotMessageSquare, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useConversations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import { AGENT_DM_ID, type ConversationMessage, type PersonalAgentState, type PrincipalQuestion } from "@/services/conversation";
import { cn } from "@/lib/utils";

type Provenance = { kind?: string; questionId?: string; scope?: string; matches?: PrincipalQuestion["matches"] };

function messageText(message: ConversationMessage): string {
  return (message.parts as { kind?: string; text?: string }[])
    .filter((part) => part?.kind === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

/** One private intent conversation; every open question is answered in a single submit. */
export default function IntentNegotiatorChat({ intentId, onSelectMatch }: { intentId: string; onSelectMatch(opportunityId: string): void }) {
  const { user } = useAuthContext();
  const conversations = useConversations();
  const { subscribeConversationMessage, isConnected } = useConversation();
  const storageKey = `principal-draft:${user?.id}:${intentId}`;
  const [draft, setDraft] = useState(() => sessionStorage.getItem(storageKey) ?? "");
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, boolean>>({});
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [agent, setAgent] = useState<PersonalAgentState>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const requests = useRef({ generation: 0, mounted: false });
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const questions = agent?.questions ?? [];
  const carded = new Set(questions.map((question) => question.id));
  // Read off the questions on screen, so a selection whose question is gone
  // counts for nothing and is never sent.
  const chosen = questions.filter((question) => selections[question.id]?.trim());
  const canSend = agent?.status === "external";

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
      setLoadError("");
    } catch (failure) {
      if (current === requests.current.generation) setLoadError(failure instanceof Error ? failure.message : "Could not load your conversation.");
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

  useEffect(() => { sessionStorage.setItem(storageKey, draft); }, [draft, storageKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages.length, questions.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !conversationId || sending || !canSend) return;
    setSending(true);
    setError("");
    try {
      const message = await conversations.sendMessage(conversationId, [{ kind: "text", text }], { metadata: { intentId } });
      mergeMessages([message]);
      sessionStorage.removeItem(storageKey);
      setDraft("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not send your message. Your draft is kept.");
    } finally {
      await refresh();
      setSending(false);
      inputRef.current?.focus();
    }
  };

  /** Send every answered question as one write, so the agent decides from all of them at once. */
  const sendAnswers = async () => {
    if (!chosen.length || sending || !canSend) return;
    setSending(true);
    setError("");
    try {
      const sent = await conversations.sendAnswers(intentId, chosen.map((question) => (
        { questionId: question.id, text: selections[question.id]!.trim() }
      )));
      mergeMessages(sent);
      setSelections({});
      setWriting({});
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not send your answers. Your choices are kept.");
    } finally {
      await refresh();
      setSending(false);
    }
  };

  const choose = (questionId: string, text: string) => {
    setError("");
    setSelections((current) => ({ ...current, [questionId]: current[questionId] === text ? "" : text }));
  };

  const references = (scope?: string, matches?: PrincipalQuestion["matches"]) => (
    <div className="mb-1 flex flex-wrap items-center gap-1 text-xs">
      {scope && <span className="opacity-70">{scope === "match" ? "For this match" : "For this intent"}</span>}
      {matches?.map((match) => <button key={match.opportunityId} type="button" onClick={() => onSelectMatch(match.opportunityId)}
        className="rounded px-1.5 py-0.5 underline decoration-current/30 underline-offset-2 hover:bg-black/5">
        {match.counterparty.name ?? "View match"}
      </button>)}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="intent-negotiator-chat">
      <p className="mb-3 text-xs text-gray-500" aria-live="polite">
        {agent?.status === "external" ? "Messages go to your selected negotiator."
          : agent?.status === "hosted" ? "The Index negotiator handles matches but does not chat. Select a negotiator in Settings to message your agent."
            : "Loading your agent conversation…"}
      </p>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {loading ? <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-gray-400" />
          : messages.length === 0 ? <div className="flex items-start gap-2 text-sm text-gray-600">
            <BotMessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Ask about your matches, share a preference, or give your agent direction for this intent.</p>
          </div> : messages.map((message) => {
            const content = messageText(message);
            const provenance = message.metadata?.principalMessage as Provenance | undefined;
            if (!content || provenance?.kind === "question" && provenance.questionId && carded.has(provenance.questionId)) return null;
            const own = message.role === "user";
            return <div key={message.id} className={cn("flex", own ? "justify-end" : "justify-start")}>
              <article className={cn("max-w-[92%] rounded-2xl px-4 py-3 text-sm", own ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-900")}>
                {references(provenance?.scope, provenance?.matches)}
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </article>
            </div>;
          })}
        <div ref={endRef} />
      </div>

      {questions.length > 0 && <section aria-label="Your agent's questions" className="mt-3 shrink-0">
        <p className="mb-2 text-xs font-semibold text-amber-800">
          Your agent needs your input{questions.length > 1 ? ` on ${questions.length} things` : ""}
        </p>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {questions.map((question) => <article key={question.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            {references(question.scope, question.matches)}
            <p className="mb-3 whitespace-pre-wrap text-sm text-gray-900">{question.question}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {question.options?.map((option) => <button key={option} type="button" disabled={sending || !canSend}
                aria-pressed={selections[question.id] === option}
                onClick={() => { choose(question.id, option); setWriting((current) => ({ ...current, [question.id]: false })); }}
                className={cn("rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50",
                  selections[question.id] === option
                    ? "border-amber-500 bg-amber-100 font-medium text-gray-900"
                    : "border-amber-200 bg-white text-gray-800 hover:border-amber-400")}>{option}</button>)}
            </div>
            {writing[question.id]
              ? <input autoFocus value={question.options?.includes(selections[question.id] ?? "") ? "" : selections[question.id] ?? ""}
                onChange={(event) => { setError(""); setSelections((current) => ({ ...current, [question.id]: event.target.value })); }}
                placeholder="Write your answer…" aria-label="Write your own answer"
                className="mt-2 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-amber-400" />
              : <button type="button" className="mt-2 text-xs text-amber-800 underline underline-offset-2"
                onClick={() => setWriting((current) => ({ ...current, [question.id]: true }))}>write your own</button>}
          </article>)}
        </div>
        <button type="button" disabled={!chosen.length || sending || !canSend} onClick={() => void sendAnswers()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#041729] px-3 py-2 text-sm text-white disabled:opacity-50">
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          {chosen.length > 1 ? `Send ${chosen.length} answers` : "Send answer"}
        </button>
      </section>}

      {(error || loadError) && <p role="alert" className="mt-2 text-sm text-red-700">{error || loadError}</p>}
      <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="mt-3 flex shrink-0 items-end gap-2 rounded-3xl border border-gray-200 bg-gray-50 px-4 py-3">
        <textarea ref={inputRef} rows={2} value={draft}
          onChange={(event) => { setError(""); setDraft(event.target.value); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
          placeholder="Message your personal agent…"
          aria-label="Message your personal agent"
          className="max-h-32 min-w-0 flex-1 resize-y border-none bg-transparent text-sm leading-6 text-gray-900 outline-none" />
        <button type="submit" disabled={!draft.trim() || !conversationId || sending || !canSend}
          aria-label="Send message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#041729] text-white disabled:opacity-50">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
