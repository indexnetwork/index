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

/** One private intent conversation; browser input follows the question actually shown while it was drafted. */
export default function IntentNegotiatorChat({ intentId, onSelectMatch }: { intentId: string; onSelectMatch(opportunityId: string): void }) {
  const { user } = useAuthContext();
  const conversations = useConversations();
  const { subscribeUserEvent, isConnected } = useConversation();
  const storageKey = `principal-draft:${user?.id}:${intentId}`;
  const [draft, setDraft] = useState<{ text: string; questionId: string | null }>(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) ?? "null") ?? { text: "", questionId: null }; }
    catch { return { text: "", questionId: null }; }
  });
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
  const pending = agent?.pending;
  const draftChanged = draft.text.length > 0 && draft.questionId !== (pending?.id ?? null);
  const canSend = agent?.status === "running" || agent?.status === "external";

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
    return () => { state.mounted = false; state.generation++; };
  }, [refresh, isConnected, requests]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout>;
    const unsubscribe = subscribeUserEvent((event) => {
      if (event.type === 'message') {
        if (event.message?.metadata?.intentId !== intentId) return;
        mergeMessages([event.message]);
      } else if (!['question.pending', 'intent.lifecycle', 'agent.configuration', 'agent.status'].includes(event.type)
        || event.data?.intentId && event.data.intentId !== intentId) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { void refresh(); }, 100);
    });
    return () => { unsubscribe(); clearTimeout(refreshTimer); };
  }, [intentId, mergeMessages, refresh, subscribeUserEvent]);

  useEffect(() => { sessionStorage.setItem(storageKey, JSON.stringify(draft)); }, [draft, storageKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages.length, pending?.id]);

  const send = async (suggested?: string) => {
    const text = (suggested ?? draft.text).trim();
    if (!text || !conversationId || sending || !canSend || suggested === undefined && draftChanged) return;
    const submittedDraft = draft;
    const questionId = suggested === undefined ? draft.questionId : pending?.id ?? null;
    setSending(true);
    setError("");
    try {
      const message = await conversations.sendMessage(conversationId, [{ kind: "text", text }], { metadata: { intentId }, questionId });
      mergeMessages([message]);
      if (suggested === undefined) {
        if (sessionStorage.getItem(storageKey) === JSON.stringify(submittedDraft)) sessionStorage.removeItem(storageKey);
        setDraft((current) => current === submittedDraft ? { text: "", questionId: null } : current);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not send your message. Your draft is kept.");
    } finally {
      await refresh();
      setSending(false);
      inputRef.current?.focus();
    }
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
        {agent?.status === "running" ? "Your agent is active across all matches."
          : agent?.status === "external" ? "Messages go to your selected negotiator."
            : agent?.status === "paused" ? "Resume this intent to continue with your agent."
              : agent?.status === "unavailable" ? "Your agent is temporarily unavailable."
                : "Connecting to your personal agent…"}
      </p>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {loading ? <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-gray-400" />
          : messages.length === 0 ? <div className="flex items-start gap-2 text-sm text-gray-600">
            <BotMessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Ask about your matches, share a preference, or give your agent direction for this intent.</p>
          </div> : messages.map((message) => {
            const content = messageText(message);
            const provenance = message.metadata?.principalMessage as Provenance | undefined;
            if (!content || provenance?.kind === "question" && provenance.questionId === pending?.id) return null;
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

      {pending && <section aria-label="Your agent's question" className="mt-3 max-h-72 shrink-0 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="mb-2 text-xs font-semibold text-amber-800">Your agent needs your input</p>
        {references(pending.scope, pending.matches)}
        <p className="mb-3 whitespace-pre-wrap text-sm text-gray-900">{pending.question}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {pending.options?.map((option) => <button key={option} type="button" disabled={sending || !canSend} onClick={() => void send(option)}
            className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-sm text-gray-800 hover:border-amber-400 disabled:opacity-50">{option}</button>)}
        </div>
        <p className="mt-2 text-xs text-amber-800">Choose an answer or write your own below.{agent.queuedQuestions > 0 ? ` ${agent.queuedQuestions} other request${agent.queuedQuestions === 1 ? " is" : "s are"} waiting.` : ""}</p>
      </section>}

      {(error || loadError) && <p role="alert" className="mt-2 text-sm text-red-700">{error || loadError}</p>}
      {draftChanged && <div className="mt-2 text-xs text-gray-600">
        The question changed while you were writing. Your draft is kept.{" "}
        <button type="button" className="font-medium underline" onClick={() => setDraft((current) => ({ ...current, questionId: pending?.id ?? null }))}>
          {pending ? "Use this draft as an answer" : "Send it as a message"}
        </button>
      </div>}
      <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="mt-3 flex shrink-0 items-end gap-2 rounded-3xl border border-gray-200 bg-gray-50 px-4 py-3">
        <textarea ref={inputRef} rows={2} value={draft.text}
          onChange={(event) => { setError(""); setDraft({ text: event.target.value, questionId: draft.text ? draft.questionId : pending?.id ?? null }); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
          placeholder={pending ? "Write your answer…" : "Message your personal agent…"}
          aria-label={pending ? "Answer your personal agent" : "Message your personal agent"}
          className="max-h-32 min-w-0 flex-1 resize-y border-none bg-transparent text-sm leading-6 text-gray-900 outline-none" />
        <button type="submit" disabled={!draft.text.trim() || !conversationId || sending || !canSend || draftChanged}
          aria-label={pending ? "Send answer" : "Send message"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#041729] text-white disabled:opacity-50">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
