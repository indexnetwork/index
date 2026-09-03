import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, BotMessageSquare, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useConversations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import type { ConversationMessage } from "@/services/conversation";
import { cn } from "@/lib/utils";
import { log } from "@/lib/logger";

const logger = log.ui.from("IntentNegotiatorChat");

/** "Seref's Negotiator" from the owner's own name; the agent has no user row. */
function negotiatorName(userName?: string | null): string {
  const firstName = (userName ?? "").trim().split(/\s+/)[0];
  return firstName ? `${firstName}'s Negotiator` : "your Negotiator";
}

function messageText(message: ConversationMessage): string {
  const parts = message.parts as { text?: string }[] | undefined;
  return parts?.find((part) => part.text)?.text ?? "";
}

/**
 * The owner's line to their negotiator about one signal.
 *
 * One agent DM per owner carries every signal, so a message belongs to the
 * signal it is tagged with: this reads only this signal's, and tags what the
 * owner sends. Nothing answers in-process: a reply arrives when the owner's
 * agent posts one.
 */
export default function IntentNegotiatorChat({ intentId }: { intentId: string }) {
  const { user } = useAuthContext();
  const conversationsService = useConversations();
  const { subscribeConversationMessage } = useConversation();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const agentName = negotiatorName(user?.name);

  const appendMessage = useCallback((message: ConversationMessage) => {
    setMessages((previous) => (
      previous.some((existing) => existing.id === message.id)
        ? previous
        : [...previous, message]
    ));
  }, []);

  // Mounted with key={intentId}, so `loading` starts true for every signal.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const conversation = await conversationsService.getOrCreateAgentDm();
        const loaded = await conversationsService.getMessages(conversation.id, { intentId });
        if (!active) return;
        setConversationId(conversation.id);
        setMessages(loaded);
      } catch (error) {
        if (active) logger.error("Failed to load agent DM", { error, intentId });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [conversationsService, intentId]);

  // The DM carries every signal, so live messages need the same tag the read
  // filters on: this signal's, and nothing else.
  useEffect(() => subscribeConversationMessage(({ conversationId: id, message }) => {
    if (id !== conversationId) return;
    const tag = (message.metadata as { intentId?: string } | undefined)?.intentId;
    if (tag !== intentId) return;
    appendMessage(message);
  }), [appendMessage, conversationId, intentId, subscribeConversationMessage]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [input]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !conversationId || sending) return;
    setSending(true);
    try {
      const message = await conversationsService.sendMessage(
        conversationId,
        [{ kind: "text", text }],
        { metadata: { intentId } },
      );
      appendMessage(message);
      setInput("");
    } catch (error) {
      logger.error("Failed to send message", { error, intentId });
    } finally {
      setSending(false);
      // Sending with the button leaves focus on it; put it back so the next
      // message is just typing.
      inputRef.current?.focus();
    }
  }, [appendMessage, conversationId, conversationsService, input, intentId, sending]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="intent-negotiator-chat">
      <div className="min-h-0 flex-1 space-y-3 lg:overflow-y-auto lg:pr-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-start gap-2 font-ibm-plex-mono text-sm text-gray-600">
            <BotMessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            <p>
              This is your direct line to {agentName} about this signal — ask who
              it found, why, what it&apos;s waiting on, or tell it how to
              negotiate on your behalf.
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const content = messageText(message);
            if (!content.trim()) return null;
            const isOwn = message.role === "user";
            return (
              <div
                key={message.id}
                className={cn("flex", isOwn ? "justify-end" : "justify-start")}
              >
                <article
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2 text-sm",
                    isOwn ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-900",
                  )}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </article>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => { event.preventDefault(); void handleSend(); }}
        className="mt-3 flex shrink-0 items-end gap-2 rounded-4xl border border-[#E9E9E9] bg-[#FCFCFC] px-4 py-3"
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder={`Message ${agentName}…`}
          disabled={!conversationId}
          className="max-h-32 flex-1 resize-none overflow-hidden border-none bg-transparent py-0.5 leading-6 text-gray-900 outline-none placeholder:text-gray-500"
        />
        <button
          type="submit"
          disabled={!input.trim() || !conversationId || sending}
          aria-label="Send message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#041729] text-white transition-colors hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
