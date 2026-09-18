import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, BotMessageSquare, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useConversations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import { AGENT_DM_ID, type ConversationMessage, type PersonalAgentState } from "@/services/conversation";
import { cn } from "@/lib/utils";

type Provenance = { kind?: string; questionId?: string; scope?: string; matches?: { opportunityId: string; counterparty: { name: string | null } }[] };
type Draft = { message: string; answers: Record<string, string> };

function messageText(message: ConversationMessage): string {
  return (message.parts as { kind?: string; text?: string }[])
    .filter((part) => part?.kind === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

/** Describe only current work; completed tool calls are not chat messages or proof of an outcome. */
function reviewActivity(agent?: PersonalAgentState): string | null {
  if (!agent?.reviewing) return null;
  const tool = agent.toolCalls?.findLast((call) => call.status === "running");
  switch (tool?.name) {
    case "save_standing_brief": return "Updating your brief…";
    case "discover_counterparties": return "Looking for matches…";
    case "open_negotiation": return "Exploring a potential match…";
    case "review_principal_inbox": return "Reviewing what you’ve shared…";
    default: return "Thinking…";
  }
}

/** One private intent conversation; browser input follows the question actually shown while it was drafted. */
export default function IntentNegotiatorChat({ intentId, onSelectMatch }: { intentId: string; onSelectMatch(opportunityId: string): void }) {
  const { user } = useAuthContext();
  const conversations = useConversations();
  const { subscribeConversationMessage, subscribeAgentChange, isConnected } = useConversation();
  const storageKey = `principal-batch-draft:${user?.id}:${intentId}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) ?? "null") ?? { message: "", answers: {} }; }
    catch { return { message: "", answers: {} }; }
  });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [agent, setAgent] = useState<PersonalAgentState>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const requests = useRef({ mounted: false, inFlight: false, queued: false });
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pending = agent?.pending ?? [];
  const pendingIds = pending.map((question) => question.id).join(',');
  const batchComplete = pending.length > 0 && pending.every((question) => draft.answers[question.id]?.trim());
  const canSend = agent?.status === "running" || agent?.status === "external";
  const activity = reviewActivity(agent);

  const mergeMessages = useCallback((incoming: ConversationMessage[]) => {
    setMessages((previous) => [...new Map([...previous, ...incoming].map((message) => [message.id, message])).values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
  }, []);

  const refresh = useCallback(async () => {
    const state = requests.current;
    if (!state.mounted) return;
    if (state.inFlight) {
      state.queued = true;
      return;
    }
    state.inFlight = true;
    try {
      do {
        state.queued = false;
        try {
          const loaded = await conversations.getMessages(AGENT_DM_ID, { intentId });
          if (!state.mounted) return;
          setConversationId(loaded.conversationId);
          mergeMessages(loaded.messages);
          setAgent(loaded.agent);
          setLoadError("");
        } catch (failure) {
          if (state.mounted) setLoadError(failure instanceof Error ? failure.message : "Could not load your conversation.");
        } finally {
          if (state.mounted) setLoading(false);
        }
        // Polls and SSE changes request one follow-up, never invalidate a usable
        // response. Otherwise reads slower than the poll interval starve forever.
      } while (state.mounted && state.queued);
    } finally {
      state.inFlight = false;
    }
  }, [conversations, intentId, mergeMessages]);

  useEffect(() => {
    const state = { mounted: true, inFlight: false, queued: false };
    requests.current = state;
    void Promise.resolve().then(() => { if (state.mounted) void refresh(); });
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => { state.mounted = false; clearInterval(timer); };
  }, [refresh]);

  useEffect(() => { if (isConnected) void refresh(); }, [isConnected, refresh]);

  useEffect(() => subscribeConversationMessage(({ conversationId: id, message }) => {
    if (id !== conversationId || message.metadata?.intentId !== intentId) return;
    mergeMessages([message]);
    void refresh();
  }), [conversationId, intentId, mergeMessages, refresh, subscribeConversationMessage]);

  useEffect(() => subscribeAgentChange((changedIntentId) => {
    if (!changedIntentId || changedIntentId === intentId) void refresh();
  }), [intentId, refresh, subscribeAgentChange]);

  useEffect(() => { sessionStorage.setItem(storageKey, JSON.stringify(draft)); }, [draft, storageKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages.length, pendingIds]);

  const send = async () => {
    const text = draft.message.trim();
    if (!text || !conversationId || sending || !canSend) return;
    const submitted = draft.message;
    setSending(true);
    setError("");
    try {
      const message = await conversations.sendMessage(conversationId, [{ kind: "text", text }], { metadata: { intentId } });
      mergeMessages([message]);
      setDraft((current) => current.message === submitted ? { ...current, message: "" } : current);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not send your message. Your draft is kept.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
      void refresh();
    }
  };

  const sendAnswers = async () => {
    if (!conversationId || sending || !canSend || !batchComplete) return;
    const answers = pending.map((question) => ({ questionId: question.id, text: draft.answers[question.id] }));
    setSending(true);
    setError("");
    try {
      mergeMessages(await conversations.answerQuestions(conversationId, intentId, answers));
      setDraft((current) => {
        const remaining = { ...current.answers };
        for (const answer of answers) if (remaining[answer.questionId] === answer.text) delete remaining[answer.questionId];
        return { ...current, answers: remaining };
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save your answers. Drafts are kept; refresh before retrying.");
    } finally {
      setSending(false);
      void refresh();
    }
  };

  const wake = async () => {
    if (!conversationId || sending || agent?.status !== "running") return;
    setSending(true);
    setError("");
    try {
      await conversations.wakeAgent(conversationId, intentId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not wake your agent.");
    } finally {
      setSending(false);
      void refresh();
    }
  };

  const draftAnswer = (questionId: string, text: string) => {
    setError("");
    setDraft((current) => ({ ...current, answers: { ...current.answers, [questionId]: text } }));
  };

  const references = (scope?: string, matches?: Provenance["matches"]) => (
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
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <p className="text-xs text-gray-500" aria-live="polite">
          {agent?.status === "running" ? "Your agent is active across all matches."
            : agent?.status === "external" ? "Messages go to your selected negotiator."
              : agent?.status === "paused" ? "Resume this intent to continue with your agent."
                : agent?.status === "unavailable" ? "Your agent is temporarily unavailable."
                  : "Connecting to your personal agent…"}
        </p>
        {agent?.status === "running" && <button type="button" onClick={() => void wake()} disabled={sending}
          className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">Wake</button>}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {loading ? <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-gray-400" />
          : messages.length === 0 ? !activity && <div className="flex items-start gap-2 text-sm text-gray-600">
            <BotMessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Ask about your matches, share a preference, or give your agent direction for this intent.</p>
          </div> : messages.map((message) => {
            const content = messageText(message);
            const provenance = message.metadata?.principalMessage as Provenance | undefined;
            if (!content || provenance?.kind === "question" && pending.some((question) => question.id === provenance.questionId)) return null;
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

      {activity && <p role="status" aria-live="polite" aria-atomic="true" className="mt-2 flex shrink-0 items-center gap-2 px-1 py-2 text-sm text-gray-500">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400 motion-safe:animate-pulse" />
        <span>{activity}</span>
      </p>}
      {agent?.reviewNotice && <p role="status" className="mt-2 shrink-0 text-sm text-amber-800">{agent.reviewNotice}</p>}

      {pending.length > 0 && <section aria-label="Your agent's questions" className="mt-3 max-h-80 shrink-0 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="mb-2 text-xs font-semibold text-amber-800">Answer all {pending.length} questions, then submit together.</p>
        {pending.map((question, index) => <fieldset key={question.id} className="mb-4" disabled={sending || !canSend}>
          <legend className="mb-3 whitespace-pre-wrap text-sm text-gray-900">{index + 1}. {question.question}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {question.options?.map((option) => <button key={option} type="button" onClick={() => draftAnswer(question.id, option)}
              aria-pressed={draft.answers[question.id] === option}
              className={cn("rounded-lg border bg-white px-3 py-2 text-left text-sm text-gray-800 hover:border-amber-400 disabled:opacity-50",
                draft.answers[question.id] === option ? "border-amber-600" : "border-amber-200")}>{option}</button>)}
          </div>
          <textarea aria-label={`Answer ${index + 1}`} placeholder="Choose a suggestion or write your own answer…" rows={2}
            value={draft.answers[question.id] ?? ""} onChange={(event) => draftAnswer(question.id, event.target.value)}
            className="mt-2 w-full rounded-lg border border-amber-200 bg-white p-2 text-sm" />
        </fieldset>)}
        <button type="button" disabled={!batchComplete || sending || !canSend} onClick={() => void sendAnswers()}
          className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50">Submit all answers</button>
        <p className="mt-2 text-xs text-amber-800">Drafts are not sent until you submit the complete batch.</p>
      </section>}

      {(error || loadError) && <p role="alert" className="mt-2 text-sm text-red-700">{error || loadError}</p>}
      <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="mt-3 flex shrink-0 items-end gap-2 rounded-3xl border border-gray-200 bg-gray-50 px-4 py-3">
        <textarea ref={inputRef} rows={2} value={draft.message}
          onChange={(event) => { setError(""); setDraft((current) => ({ ...current, message: event.target.value })); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
          placeholder="Message your personal agent…"
          aria-label="Message your personal agent"
          className="max-h-32 min-w-0 flex-1 resize-y border-none bg-transparent text-sm leading-6 text-gray-900 outline-none" />
        <button type="submit" disabled={!draft.message.trim() || !conversationId || sending || !canSend}
          aria-label="Send message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#041729] text-white disabled:opacity-50">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
