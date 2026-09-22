import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, BotMessageSquare, Check, ChevronDown, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useConversations } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { AGENT_DM_ID, type ConversationMessage, type PersonalAgentState, type PrincipalQuestion } from "@/services/conversation";
import { cn } from "@/lib/utils";

type Match = PrincipalQuestion["matches"][number];

/** Entry kinds exactly as the agent persists them. */
type PrincipalKind = "user" | "answer" | "message" | "question" | "expire" | "brief" | "decision" | "stall" | "progress";

type Provenance = { kind?: PrincipalKind; questionId?: string; scope?: string; matches?: Match[] };

/**
 * The agent's own record-keeping. It is addressed to a negotiator, not to the
 * principal, so it never appears between messages — it collects in the activity
 * strip above the conversation.
 */
const BOOKKEEPING: ReadonlySet<PrincipalKind> = new Set(["brief", "decision", "stall", "progress", "expire"]);

interface Entry {
  id: string;
  kind: PrincipalKind;
  text: string;
  questionId?: string;
  match?: Match;
}

interface ActivityGroup {
  /** Opportunity id, or `discovery` for the intent-level pass that opened them. */
  key: string;
  name: string;
  decision?: string;
  waiting: boolean;
  entries: Entry[];
}

const DECISION_STYLES: Record<string, string> = {
  continue: "bg-blue-100 text-blue-700",
  accept: "bg-green-100 text-green-700",
  decline: "bg-red-100 text-red-700",
  stop: "bg-red-100 text-red-700",
};

function messageText(message: ConversationMessage): string {
  return (message.parts as { kind?: string; text?: string }[])
    .filter((part) => part?.kind === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

function readEntry(message: ConversationMessage): Entry {
  const provenance = message.metadata?.principalMessage as Provenance | undefined;
  return {
    id: message.id,
    kind: provenance?.kind ?? (message.role === "user" ? "user" : "message"),
    text: messageText(message),
    questionId: provenance?.questionId,
    match: provenance?.matches?.[0],
  };
}

/** One private intent conversation; every open question is answered in a single submit. */
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
  const [sending, setSending] = useState(false);
  const requests = useRef({ generation: 0, mounted: false });
  const wokenRef = useRef<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const questions = useMemo(() => agent?.questions ?? [], [agent]);
  // Read off the questions on screen, so a selection whose question is gone
  // counts for nothing and is never sent.
  const chosen = questions.filter((question) => selections[question.id]?.trim());

  // Bookkeeping collects into the strip; everything else is the conversation.
  const { conversation, activity, asked, open } = useMemo(() => {
    const conversation: Entry[] = [];
    const groups = new Map<string, ActivityGroup>();
    const asked = new Map<string, string>();
    for (const message of messages) {
      const entry = readEntry(message);
      if (!entry.text) continue;
      if (entry.kind === "question" && entry.questionId) asked.set(entry.questionId, entry.text);
      if (!BOOKKEEPING.has(entry.kind)) {
        conversation.push(entry);
        continue;
      }
      const key = entry.match?.opportunityId ?? "discovery";
      const group = groups.get(key)
        ?? { key, name: entry.match?.counterparty.name ?? "Discovery", waiting: false, entries: [] };
      if (entry.kind === "decision") group.decision = entry.text;
      group.entries.push(entry);
      groups.set(key, group);
    }
    const open = new Map(questions.map((question) => [question.id, question]));
    for (const group of groups.values()) {
      group.waiting = questions.some((question) => question.matches[0]?.opportunityId === group.key);
    }
    return { conversation, activity: [...groups.values()], asked, open };
  }, [messages, questions]);

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
      if (wokenRef.current !== intentId) {
        wokenRef.current = intentId;
        void conversations.wake(intentId).catch(() => {
          // Harmless: subsequent polls and interactions reconcile state.
        });
      }
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

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [conversation.length, questions.length]);

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

  const jumpToQuestion = () => {
    streamRef.current?.querySelector("[data-open-question]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /** Where a note points, never who wrote it: the agent wrote every one of these. */
  const matchLink = (match?: Match) => match && (
    <button type="button" onClick={() => onSelectMatch(match.opportunityId)}
      className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-700">
      <span aria-hidden>↗</span>{match.counterparty.name ?? "View match"}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="intent-negotiator-chat">
      <p className="mb-3 text-xs text-gray-500" aria-live="polite">
        {agent ? "Your inbox for this intent." : "Loading your agent conversation…"}
      </p>

      {activity.length > 0 && <ActivityStrip groups={activity} onSelectMatch={onSelectMatch} />}

      <div ref={streamRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {loading ? <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-gray-400" />
          : conversation.length === 0 ? <div className="flex items-start gap-2 text-sm text-gray-600">
            <BotMessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Ask about your matches, share a preference, or give your agent direction for this intent.</p>
          </div> : conversation.map((entry) => {
            // A resolved question is carried by whatever resolved it: the answer
            // quotes it, and the retraction is recorded in the activity strip.
            if (entry.kind === "question") {
              const question = entry.questionId ? open.get(entry.questionId) : undefined;
              if (!question) return null;
              return <QuestionCard key={entry.id} question={question} selected={selections[question.id]}
                writing={Boolean(writing[question.id])} disabled={sending} onSelectMatch={onSelectMatch}
                onChoose={(text) => { choose(question.id, text); setWriting((current) => ({ ...current, [question.id]: false })); }}
                onWrite={() => setWriting((current) => ({ ...current, [question.id]: true }))}
                onType={(text) => setSelections((current) => ({ ...current, [question.id]: text }))} />;
            }

            if (entry.kind === "answer") {
              const question = entry.questionId ? asked.get(entry.questionId) : undefined;
              if (question) return <AnswerPair key={entry.id} question={question} answer={entry.text}
                match={entry.match} onSelectMatch={onSelectMatch} />;
            }

            const own = entry.kind === "user" || entry.kind === "answer";
            return <div key={entry.id} className={cn("flex", own ? "justify-end" : "justify-start")}>
              <article className={cn("max-w-[92%] rounded-2xl px-4 py-3 text-sm", own ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-900")}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.text}</ReactMarkdown>
                {!own && matchLink(entry.match)}
              </article>
            </div>;
          })}
        <div ref={endRef} />
      </div>

      {questions.length > 0 && <div className="mt-3 shrink-0">
        {chosen.length > 0
          ? <button type="button" disabled={sending} onClick={() => void sendAnswers()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#041729] px-3 py-2 text-sm text-white disabled:opacity-50">
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            {chosen.length > 1 ? `Send ${chosen.length} answers` : "Send answer"}
          </button>
          : <button type="button" onClick={jumpToQuestion}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            {questions.length > 1 ? `${questions.length} questions waiting` : "1 question waiting"} ↓
          </button>}
      </div>}

      <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="mt-3 flex shrink-0 items-end gap-2 rounded-3xl border border-gray-200 bg-gray-50 px-4 py-3">
        <textarea ref={inputRef} rows={2} value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
          placeholder="Message your personal agent…"
          aria-label="Message your personal agent"
          className="max-h-32 min-w-0 flex-1 resize-y border-none bg-transparent text-sm leading-6 text-gray-900 outline-none" />
        <button type="submit" disabled={!draft.trim() || sending}
          aria-label="Send message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#041729] text-white disabled:opacity-50">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}

/**
 * Everything the agent recorded rather than said, closed by default.
 * Its headline is all a principal reads unless they go looking.
 */
function ActivityStrip({ groups, onSelectMatch }: { groups: ActivityGroup[]; onSelectMatch(opportunityId: string): void }) {
  const matches = groups.filter((group) => group.key !== "discovery").length;
  const waiting = groups.filter((group) => group.waiting).length;

  return (
    <details className="mb-3 shrink-0 rounded-xl border border-gray-200 bg-gray-50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-gray-600">
        <span className="font-semibold text-gray-700">Agent activity</span>
        <span>{matches} {matches === 1 ? "match" : "matches"}{waiting > 0 && ` · ${waiting} waiting on you`}</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 text-gray-400" />
      </summary>
      <div className="border-t border-gray-200 px-2 pb-2">
        {groups.map((group) => <details key={group.key} className="border-t border-gray-100 first:border-t-0">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-xs text-gray-600 hover:bg-white">
            {group.key === "discovery"
              ? <span className="font-semibold text-gray-700">Discovery</span>
              : <button type="button" onClick={(event) => { event.preventDefault(); onSelectMatch(group.key); }}
                className="font-semibold text-gray-700 underline underline-offset-2">{group.name}</button>}
            {group.decision && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", DECISION_STYLES[group.decision] ?? "bg-gray-200 text-gray-600")}>{group.decision}</span>}
            {group.waiting && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">waiting on you</span>}
            <ChevronDown className="ml-auto h-3.5 w-3.5 text-gray-300" />
          </summary>
          <div className="px-2 pb-2">
            {group.entries.map((entry) => <div key={entry.id} className="flex gap-2 border-t border-dashed border-gray-200 py-2">
              <span className={cn("w-16 shrink-0 text-[10px] font-bold uppercase tracking-wide", entry.kind === "stall" ? "text-amber-800" : "text-gray-400")}>{entry.kind}</span>
              <span className="whitespace-pre-wrap text-xs text-gray-600">{entry.text}</span>
            </div>)}
          </div>
        </details>)}
      </div>
    </details>
  );
}

/** A question and the answer that settled it, as one unit rather than two messages. */
function AnswerPair({ question, answer, match, onSelectMatch }: {
  question: string; answer: string; match?: Match; onSelectMatch(opportunityId: string): void;
}) {
  return (
    <div className="flex justify-end">
      <article className="max-w-[92%] overflow-hidden rounded-2xl bg-gray-100">
        <div className="px-4 py-2.5">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            <Check className="h-3 w-3 text-green-700" />You answered
            {match && <button type="button" onClick={() => onSelectMatch(match.opportunityId)}
              className="text-[11px] font-semibold normal-case tracking-normal text-gray-500 underline underline-offset-2">
              · {match.counterparty.name ?? "this match"}
            </button>}
          </p>
          <p className="mt-1 text-xs text-gray-600">{question}</p>
        </div>
        <p className="whitespace-pre-wrap bg-gray-900 px-4 py-3 text-sm text-white">{answer}</p>
      </article>
    </div>
  );
}

/** An open question, answered where it was asked. */
function QuestionCard({ question, selected, writing, disabled, onChoose, onWrite, onType, onSelectMatch }: {
  question: PrincipalQuestion;
  selected?: string;
  writing: boolean;
  disabled: boolean;
  onChoose(text: string): void;
  onWrite(): void;
  onType(text: string): void;
  onSelectMatch(opportunityId: string): void;
}) {
  const match = question.matches[0];
  return (
    <article data-open-question className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />Needs you
        {match
          ? <button type="button" onClick={() => onSelectMatch(match.opportunityId)}
            className="text-[11px] font-semibold normal-case tracking-normal text-gray-500 underline underline-offset-2">
            · {match.counterparty.name ?? "this match"}
          </button>
          : <span className="text-[11px] font-semibold normal-case tracking-normal text-gray-500">· this intent</span>}
      </p>
      <p className="mb-3 whitespace-pre-wrap text-sm text-gray-900">{question.question}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {question.options?.map((option) => <button key={option} type="button" disabled={disabled}
          aria-pressed={selected === option} onClick={() => onChoose(option)}
          className={cn("rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50",
            selected === option
              ? "border-amber-500 bg-amber-100 font-medium text-gray-900"
              : "border-amber-200 bg-white text-gray-800 hover:border-amber-400")}>{option}</button>)}
      </div>
      {writing
        ? <input autoFocus value={question.options?.includes(selected ?? "") ? "" : selected ?? ""}
          onChange={(event) => onType(event.target.value)}
          placeholder="Write your answer…" aria-label="Write your own answer"
          className="mt-2 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-amber-400" />
        : <button type="button" className="mt-2 text-xs text-amber-800 underline underline-offset-2"
          onClick={onWrite}>write your own</button>}
    </article>
  );
}
