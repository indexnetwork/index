import { useCallback, useEffect, useRef, useState } from "react";

import { useConversations } from "@/contexts/APIContext";
import { AGENT_DM_ID, type PrincipalQuestion } from "@/services/conversation";

const QUESTIONS_POLL_MS = 30_000;

export interface AgentQuestion extends PrincipalQuestion {
  intentId: string;
}

/**
 * Every open question the agents are waiting on, across the given intents.
 * Each intent's agent DM is read a few at a time, then re-read on a slow poll,
 * so the home page never floods the API the way a 5s per-intent poll would.
 */
export function useAgentQuestions(intentIds: string[]) {
  const conversations = useConversations();
  const [byIntent, setByIntent] = useState<Record<string, PrincipalQuestion[]>>({});
  const [loaded, setLoaded] = useState(false);
  // Answered here but maybe still listed by the server until the agent picks it up.
  const answered = useRef(new Set<string>());
  const key = intentIds.join(",");

  const loadAll = useCallback(async (ids: string[]) => {
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          const history = await conversations.getMessages(AGENT_DM_ID, { intentId: id, limit: 1 });
          const open = history.agent?.questions ?? [];
          setByIntent((prev) => ({ ...prev, [id]: open }));
        } catch {
          // Keep whatever was shown; the next poll tries again.
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }, [conversations]);

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    let active = true;
    void loadAll(ids).finally(() => { if (active) setLoaded(true); });
    const timer = setInterval(() => { void loadAll(ids); }, QUESTIONS_POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [key, loadAll]);

  const questions: AgentQuestion[] = (key ? key.split(",") : []).flatMap((intentId) =>
    (byIntent[intentId] ?? [])
      .filter((question) => !answered.current.has(question.id))
      .map((question) => ({ ...question, intentId })),
  );

  const answer = useCallback(async (intentId: string, questionId: string, text: string) => {
    answered.current.add(questionId);
    setByIntent((prev) => ({ ...prev }));
    try {
      await conversations.sendAnswers(intentId, [{ questionId, text }]);
    } catch (error) {
      answered.current.delete(questionId);
      setByIntent((prev) => ({ ...prev }));
      throw error;
    }
  }, [conversations]);

  return { questions, loaded: loaded || !key, answer };
}
