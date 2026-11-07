import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient, APIError } from "@/lib/api";
import type { ConversationMessage } from "@/services/conversation";

/** Id prefix for the owner's message before the server has stored it. */
const PENDING = "pending-";

export interface HomeAgentMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  createdAt: string;
  /** Tools that changed something in this turn (agent messages only). */
  changed?: string[];
}

function toMessage(message: ConversationMessage): HomeAgentMessage {
  const text = (message.parts as { kind?: string; text?: string }[])
    .filter((part) => part?.kind === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const changed = (message.metadata as { changed?: unknown } | undefined)?.changed;
  return {
    id: message.id,
    role: message.role,
    text,
    createdAt: message.createdAt,
    changed: Array.isArray(changed) ? changed.map(String) : undefined,
  };
}

/**
 * The home screen's agent chat: one conversation where the owner's agent
 * creates and manages intents with the Index tools. `onChanged` runs after a
 * turn that changed something, so the page can refresh what it shows.
 */
export function useHomeAgentChat(onChanged: (tools: string[]) => void) {
  const [messages, setMessages] = useState<HomeAgentMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changedRef = useRef(onChanged);
  useEffect(() => { changedRef.current = onChanged; }, [onChanged]);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ messages: ConversationMessage[] }>("/home-agent/messages");
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
      const res = await apiClient.post<{ message: ConversationMessage; reply: ConversationMessage; changed: string[] }>("/home-agent/messages", { text });
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

  return { messages, loaded, loadFailed, sending, error, send, retry: load };
}
