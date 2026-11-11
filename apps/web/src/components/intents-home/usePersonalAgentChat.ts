import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient, APIError } from "@/lib/api";
import type { ConversationMessage } from "@/services/conversation";

/** Id prefix for the owner's message before the server has stored it. */
const PENDING = "pending-";

export interface PersonalAgentMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  createdAt: string;
  /** Tools that changed something in this turn (agent messages only). */
  changed?: string[];
  /** The intent this message announces, when it was started with the in-chat flow. */
  intentCreated?: string;
}

function toMessage(message: ConversationMessage): PersonalAgentMessage {
  const text = (message.parts as { kind?: string; text?: string }[])
    .filter((part) => part?.kind === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const meta = message.metadata as { changed?: unknown; intentCreated?: unknown } | undefined;
  const changed = meta?.changed;
  return {
    id: message.id,
    role: message.role,
    text,
    createdAt: message.createdAt,
    changed: Array.isArray(changed) ? changed.map(String) : undefined,
    intentCreated: typeof meta?.intentCreated === "string" ? meta.intentCreated : undefined,
  };
}

/**
 * The personal agent's chat: one conversation where the owner's agent
 * creates and manages intents with the Index tools. `onChanged` runs after a
 * turn that changed something, so the page can refresh what it shows.
 */
export function usePersonalAgentChat(onChanged: (tools: string[]) => void) {
  const [messages, setMessages] = useState<PersonalAgentMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changedRef = useRef(onChanged);
  useEffect(() => { changedRef.current = onChanged; }, [onChanged]);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ messages: ConversationMessage[] }>("/personal-agent/messages");
      setMessages(res.messages.map(toMessage));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return false;
    setError(null);
    setSending(true);
    const pendingId = `${PENDING}${Date.now()}`;
    setMessages((prev) => [...prev, { id: pendingId, role: "user", text, createdAt: new Date().toISOString() }]);
    try {
      const res = await apiClient.post<{ message: ConversationMessage; reply: ConversationMessage; changed: string[] }>("/personal-agent/messages", { text });
      setMessages((prev) => [...prev.filter((m) => m.id !== pendingId), toMessage(res.message), toMessage(res.reply)]);
      if (res.changed?.length) changedRef.current(res.changed);
      return true;
    } catch (err) {
      const message = err instanceof APIError && err.status !== 0 ? err.message : "couldn't reach your agent.";
      setError(message);
      // The server keeps the owner's message even when the turn fails; reread to match it.
      await load();
      return false;
    } finally {
      setSending(false);
    }
  }, [sending, load]);

  /** Set the current chat aside and start an empty one. */
  const newChat = useCallback(async () => {
    if (sending) return;
    setError(null);
    try {
      await apiClient.post("/personal-agent/new", {});
      setMessages([]);
    } catch (err) {
      setError(err instanceof APIError && err.status !== 0 ? err.message : "couldn't start a new chat.");
    }
  }, [sending]);

  /** Save an intent made with the in-chat new intent flow, so the chat and the agent remember it. */
  const recordIntent = useCallback(async (intentId: string, asked: string) => {
    try {
      const res = await apiClient.post<{ message: ConversationMessage | null; reply: ConversationMessage }>("/personal-agent/intent-created", { intentId, asked });
      setMessages((prev) => [...prev, ...(res.message ? [toMessage(res.message)] : []), toMessage(res.reply)]);
    } catch {
      // The intent exists either way; the chat just won't mention it. Reread in case it was saved.
      await load();
    }
  }, [load]);

  return { messages, loaded, loadFailed, sending, error, send, newChat, recordIntent, retry: load };
}
